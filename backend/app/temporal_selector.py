"""
Temporal evidence selector and multimodal grounding bridge for Stage 1C / Stage 1E.
Connects deterministic CV candidate discovery (MobileNetV3/FAISS/pHash),
SAM 3.1 specialist localization, and Muse Wonder multimodal reasoning.
"""

from io import BytesIO
import logging
import os
from pathlib import Path
import tempfile
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

from app.matcher import load_reference_frame_image, SUSPECT_THRESHOLD, MATCH_THRESHOLD
from app.providers import factory as provider_factory
from app.providers.sam_models import SegmentationResult

logger = logging.getLogger(__name__)


def get_storage_roots() -> List[Path]:
    """Returns canonical, approved storage roots where evidence frames and thumbnails may reside."""
    storage_base = Path(__file__).resolve().parent.parent / "storage"
    roots = [
        storage_base / "suspects" / "frames",
        storage_base / "cloud_cache" / "frames",
        storage_base / "frames",
        storage_base / "suspects" / "thumbnails",
        storage_base / "staging" / "frames",
    ]
    # Allow system temporary directory for test suites and sandbox environments
    tmp_dir = Path(tempfile.gettempdir())
    roots.append(tmp_dir)
    try:
        roots.append(tmp_dir.resolve())
    except Exception:
        pass
    return roots


def is_safe_storage_path(target_path: Path, allowed_roots: Optional[List[Path]] = None) -> bool:
    """
    Prevents path traversal attacks by verifying the resolved target path
    is strictly contained within one of the approved storage roots.
    """
    roots = allowed_roots or get_storage_roots()
    try:
        resolved = target_path.resolve()
        for root in roots:
            root_res = root.resolve()
            if resolved == root_res or root_res in resolved.parents:
                return True
        return False
    except Exception:
        return False


def resolve_frame_path(
    path_str: Optional[str],
    asset_id: Optional[str] = None,
    filename: Optional[str] = None,
) -> Tuple[Optional[Path], Optional[str]]:
    """
    Deterministically resolves a stored frame path to a readable file on the local host.
    Handles container prefixes (e.g., '/app/storage/...'), host absolute paths,
    and relative storage paths across all approved roots.

    Returns:
        (resolved_path, error_reason)
        If successfully resolved, error_reason is None.
        If resolution fails, resolved_path is None and error_reason is a clear diagnostic string.
    """
    if not path_str and not (asset_id and filename):
        return None, "Empty path and missing asset/filename identifiers"

    storage_base = Path(__file__).resolve().parent.parent / "storage"
    roots = get_storage_roots()
    candidates: List[Path] = []

    if path_str:
        norm_path = path_str.replace("\\", "/")

        # Check for path traversal indicators
        if norm_path.startswith("..") or "/../" in norm_path or norm_path.endswith("/.."):
            return None, f"Path traversal attempt rejected: {path_str}"

        # 1. Container prefix handling: e.g. '/app/storage/suspects/frames/...' -> 'suspects/frames/...'
        if "/storage/" in norm_path:
            sub = norm_path.split("/storage/", 1)[1]
            candidates.append(storage_base / sub)
        elif norm_path.startswith("storage/"):
            sub = norm_path.split("storage/", 1)[1]
            candidates.append(storage_base / sub)

        # 2. Direct path interpretation
        candidates.append(Path(path_str))

    # 3. Asset ID and filename candidate lookup across all approved roots
    clean_fn = Path(filename).name if filename else (Path(path_str).name if path_str else None)
    clean_aid = Path(asset_id).name if asset_id else None

    if clean_fn:
        if clean_aid:
            for r in roots:
                candidates.append(r / clean_aid / clean_fn)
        for r in roots:
            candidates.append(r / clean_fn)

    # Validate candidates deterministically
    checked_paths: List[str] = []
    for cand in candidates:
        try:
            cand_res = cand.resolve()
            checked_paths.append(str(cand))
            if not is_safe_storage_path(cand_res, roots):
                continue
            if cand_res.exists() and cand_res.is_file():
                return cand_res, None
        except Exception as e:
            logger.debug(f"[TemporalSelector] Error checking candidate {cand}: {e}")
            continue

    # 4. If running in cloud mode and file is not yet cached locally, attempt retrieval from cloud buckets
    try:
        from app.db import get_db_config
        from app.storage import SupabaseStorageClient
        if get_db_config().is_cloud and clean_aid and clean_fn:
            cache_target = storage_base / "cloud_cache" / "frames" / clean_aid / clean_fn
            if is_safe_storage_path(cache_target, roots):
                client = SupabaseStorageClient()
                for bucket in ["suspect-frames", "reference-frames"]:
                    try:
                        storage_path = f"{clean_aid}/{clean_fn}"
                        frame_bytes = client.download_file(bucket, storage_path)
                        if frame_bytes:
                            cache_target.parent.mkdir(parents=True, exist_ok=True)
                            cache_target.write_bytes(frame_bytes)
                            return cache_target.resolve(), None
                    except Exception:
                        pass
    except Exception as e:
        logger.debug(f"[TemporalSelector] Cloud storage frame cache retrieval skipped: {e}")

    return None, f"Frame not found across approved storage roots. Checked: {checked_paths[:3]}"


def load_frame_image_bytes(
    path_str: Optional[str],
    asset_id: Optional[str] = None,
    filename: Optional[str] = None,
) -> Tuple[Optional[bytes], Optional[str]]:
    """
    Loads raw image bytes for a frame, returning (bytes, error_reason).
    """
    resolved_path, err = resolve_frame_path(path_str, asset_id=asset_id, filename=filename)
    if not resolved_path:
        return None, err

    try:
        data = resolved_path.read_bytes()
        if not data:
            return None, f"File at {resolved_path} is 0 bytes (empty)"
        return data, None
    except Exception as e:
        return None, f"Error reading file at {resolved_path}: {e}"


def select_investigation_keyframes(
    incident: Dict[str, Any],
    max_pairs: int = 3,
) -> List[Dict[str, Any]]:
    """
    Selects a deterministic, bounded set of high-value candidate frame pairs
    from existing CV match results for multimodal inspection.

    Guarantees:
      - Does not run CV matching or recompute embeddings.
      - Bounded to max_pairs (default: 3 pairs = max 6 frames).
      - Enforces temporal diversity (prefers distinct timestamp intervals).
      - Loads real frame bytes for both suspect and reference images via safe path resolution.
    """
    matches = incident.get("frame_matches") or []
    if not matches:
        return []

    ranked_pairs: List[Dict[str, Any]] = []

    for idx, item in enumerate(matches):
        sub = item.get("submitted_frame") or {}
        best = item.get("best_match")
        if not best:
            continue

        l2_dist = best.get("l2_distance")
        if l2_dist is None or l2_dist >= SUSPECT_THRESHOLD:
            continue

        if best.get("low_entropy_flag"):
            continue

        phash_score = float(best.get("phash_score") or 0.0)
        dist_score = max(0.0, 1.0 - min(1.0, float(l2_dist)))
        composite_rank = 0.6 * dist_score + 0.4 * (phash_score / 100.0)

        ts_sec = float(sub.get("timestamp_sec") if sub.get("timestamp_sec") is not None else item.get("timestamp_sec", 0.0))
        frame_idx = sub.get("frame_index") if sub.get("frame_index") is not None else item.get("frame_idx", idx)
        ev_id = f"frame_{frame_idx}_t{int(ts_sec)}s"

        ranked_pairs.append({
            "pair_index": idx,
            "evidence_id": ev_id,
            "suspect_timestamp_sec": ts_sec,
            "suspect_frame_idx": frame_idx,
            "suspect_frame_path": sub.get("frame_path"),
            "suspect_frame_filename": sub.get("filename"),
            "submitted_frame": sub,
            "best_match": best,
            "composite_rank": composite_rank,
            "l2_distance": l2_dist,
            "phash_score": phash_score,
            "source_asset_id": best.get("source_asset_id", "unknown"),
            "source_timestamp_sec": best.get("source_timestamp_sec", 0.0),
            "source_frame_id": best.get("source_frame_id", 0),
            "source_frame_path": best.get("source_frame_path"),
            "source_filename": best.get("source_filename"),
            # Preserve existing valid SAM results if already attached
            "sam_segmentation": best.get("sam_segmentation") or item.get("sam_segmentation"),
            "ref_sam_segmentation": best.get("ref_sam_segmentation") or item.get("ref_sam_segmentation"),
        })

    if not ranked_pairs:
        return []

    # Sort descending by composite rank
    ranked_pairs.sort(key=lambda x: x["composite_rank"], reverse=True)

    # Temporal diversity filter: avoid selecting frames within 2 seconds of each other if alternatives exist
    selected_pairs: List[Dict[str, Any]] = []
    selected_timestamps: List[float] = []

    for cand in ranked_pairs:
        if len(selected_pairs) >= max_pairs:
            break
        ts = cand["suspect_timestamp_sec"]
        if not any(abs(ts - existing_ts) < 2.0 for existing_ts in selected_timestamps):
            selected_pairs.append(cand)
            selected_timestamps.append(ts)

    # If diversity filter was too strict and fewer than max_pairs were picked, fill with remaining top ranks
    if len(selected_pairs) < max_pairs:
        for cand in ranked_pairs:
            if len(selected_pairs) >= max_pairs:
                break
            if cand not in selected_pairs:
                selected_pairs.append(cand)

    # Resolve frame image bytes for suspect and reference using safe path resolution
    resolved_pairs: List[Dict[str, Any]] = []

    for pair in selected_pairs:
        # 1. Load suspect frame bytes
        sub_aid = pair["submitted_frame"].get("asset_id") or incident.get("submitted_asset_id")
        sub_fn = pair.get("suspect_frame_filename") or f"frame_{int(pair['suspect_timestamp_sec']):04d}s.jpg"
        suspect_bytes, s_err = load_frame_image_bytes(
            pair.get("suspect_frame_path"),
            asset_id=sub_aid,
            filename=sub_fn,
        )

        # Fallback to suspect thumbnail if suspect frame unavailable
        if not suspect_bytes:
            thumb_path_str = incident.get("thumbnail_storage_path") or incident.get("suspect_thumbnail_preview_url")
            if thumb_path_str:
                thumb_bytes, _ = load_frame_image_bytes(thumb_path_str, filename=Path(thumb_path_str).name)
                if thumb_bytes:
                    suspect_bytes = thumb_bytes
                    s_err = None

        # 2. Load reference frame bytes
        best = pair["best_match"]
        ref_aid = best.get("source_asset_id") or pair.get("source_asset_id")
        ref_fn = best.get("source_filename") or f"frame_{int(pair['source_timestamp_sec']):04d}s.jpg"
        ref_bytes, r_err = load_frame_image_bytes(
            best.get("source_frame_path"),
            asset_id=ref_aid,
            filename=ref_fn,
        )

        # Fallback to load_reference_frame_image (supports cloud storage and legacy paths)
        if not ref_bytes:
            ref_pil = load_reference_frame_image(best)
            if ref_pil:
                try:
                    buf = BytesIO()
                    ref_pil.convert("RGB").save(buf, format="JPEG", quality=90)
                    ref_bytes = buf.getvalue()
                    r_err = None
                except Exception as e:
                    r_err = f"Could not encode reference PIL image: {e}"

        pair["suspect_image_bytes"] = suspect_bytes
        pair["suspect_load_error"] = s_err
        pair["reference_image_bytes"] = ref_bytes
        pair["reference_load_error"] = r_err
        resolved_pairs.append(pair)

    return resolved_pairs


def _is_valid_sam_result(res: Any, expected_model: str) -> bool:
    """Returns True if res is an existing valid SAM result with matching model."""
    if not res:
        return False
    if isinstance(res, dict):
        status = res.get("validation_status")
        model = res.get("model_id") or res.get("operational_metadata", {}).get("model_id")
        return status in ("VALIDATED", "NO_OBJECTS_DETECTED") and (not model or model == expected_model)
    if isinstance(res, SegmentationResult):
        return res.validation_status in ("VALIDATED", "NO_OBJECTS_DETECTED") and res.model_id == expected_model
    return False


def ground_candidate_frames_with_sam(
    candidate_pairs: List[Dict[str, Any]],
    prompt: str = "broadcast subject",
    max_sam_calls: int = 6,
    force: bool = False,
) -> List[Dict[str, Any]]:
    """
    Passes selected candidate frame pairs through SAM 3.1 for visual localization.
    Grounds BOTH reference and suspect frames independently.
    Handles missing frame bytes and provider failures independently without blocking other frames.
    Avoids repeated provider calls when valid results are already present unless force=True.
    Never overwrites existing valid evidence with an unexpected network failure.
    """
    if not candidate_pairs:
        return candidate_pairs

    try:
        sam_provider = provider_factory.get_segmentation_provider()
    except Exception as exc:
        logger.info(f"[TemporalSelector] SAM provider unavailable, skipping segmentation: {exc}")
        return candidate_pairs

    expected_model = getattr(sam_provider, "model_id", "sam-3.1")
    sam_calls = 0

    for pair in candidate_pairs:
        # ─── A. Ground Suspect Frame ───
        existing_s_sam = pair.get("sam_segmentation") or pair.get("suspect_sam_segmentation")
        if not force and _is_valid_sam_result(existing_s_sam, expected_model):
            # Reuse existing valid suspect result
            pair["sam_segmentation"] = existing_s_sam
            pair["suspect_sam_segmentation"] = existing_s_sam
        else:
            s_bytes = pair.get("suspect_image_bytes")
            if s_bytes and sam_calls < max_sam_calls:
                s_filename = pair.get("suspect_frame_filename") or pair.get("suspect_filename")
                try:
                    meta = {
                        "evidence_id": pair.get("evidence_id", "suspect_frame"),
                        "frame_index": pair.get("suspect_frame_idx", 0),
                        "timestamp_sec": pair.get("suspect_timestamp_sec", 0.0),
                        "target": "suspect",
                        "frame_filename": s_filename,
                    }
                    res = sam_provider.segment_frame(
                        image_bytes=s_bytes,
                        prompt=prompt,
                        metadata=meta,
                    )
                    res_dict = res.model_dump(mode="json") if isinstance(res, SegmentationResult) else res
                    res_dict["target"] = "suspect"
                    if s_filename and not res_dict.get("frame_filename"):
                        res_dict["frame_filename"] = s_filename
                    pair["sam_segmentation"] = res_dict
                    pair["suspect_sam_segmentation"] = res_dict
                    sam_calls += 1
                except Exception as e:
                    logger.warning(f"[TemporalSelector] SAM suspect segmentation failed on pair {pair['evidence_id']}: {e}")
                    if _is_valid_sam_result(existing_s_sam, expected_model):
                        # Preserve existing valid result
                        pair["sam_segmentation"] = existing_s_sam
                        pair["suspect_sam_segmentation"] = existing_s_sam
                    else:
                        pair["sam_segmentation"] = {
                            "validation_status": "FAILED_VALIDATION",
                            "target": "suspect",
                            "error": str(e),
                            "model_id": expected_model,
                            "frame_filename": s_filename,
                        }
                        pair["suspect_sam_segmentation"] = pair["sam_segmentation"]
            elif not s_bytes:
                if _is_valid_sam_result(existing_s_sam, expected_model):
                    pair["sam_segmentation"] = existing_s_sam
                    pair["suspect_sam_segmentation"] = existing_s_sam
                else:
                    pair["sam_segmentation"] = {
                        "validation_status": "FAILED_VALIDATION",
                        "target": "suspect",
                        "error": pair.get("suspect_load_error") or "Suspect frame bytes unavailable for localization",
                        "model_id": expected_model,
                        "frame_filename": pair.get("suspect_frame_filename") or pair.get("suspect_filename"),
                    }
                    pair["suspect_sam_segmentation"] = pair["sam_segmentation"]

        # ─── B. Ground Reference Frame (Independent of suspect outcome) ───
        existing_r_sam = pair.get("ref_sam_segmentation")
        if not force and _is_valid_sam_result(existing_r_sam, expected_model):
            # Reuse existing valid reference result
            pair["ref_sam_segmentation"] = existing_r_sam
        else:
            r_bytes = pair.get("reference_image_bytes")
            if r_bytes and sam_calls < max_sam_calls:
                r_filename = pair.get("source_filename") or pair.get("reference_filename") or pair.get("ref_filename")
                try:
                    ref_meta = {
                        "evidence_id": f"ref_{pair.get('source_frame_id', '0')}_t{int(pair.get('source_timestamp_sec', 0.0))}s",
                        "frame_index": pair.get("source_frame_id", 0),
                        "timestamp_sec": pair.get("source_timestamp_sec", 0.0),
                        "target": "reference",
                        "frame_filename": r_filename,
                    }
                    ref_res = sam_provider.segment_frame(
                        image_bytes=r_bytes,
                        prompt=prompt,
                        metadata=ref_meta,
                    )
                    ref_dict = ref_res.model_dump(mode="json") if isinstance(ref_res, SegmentationResult) else ref_res
                    ref_dict["target"] = "reference"
                    if r_filename and not ref_dict.get("frame_filename"):
                        ref_dict["frame_filename"] = r_filename
                    pair["ref_sam_segmentation"] = ref_dict
                    sam_calls += 1
                except Exception as e:
                    logger.warning(f"[TemporalSelector] SAM reference segmentation failed on pair {pair['evidence_id']}: {e}")
                    if _is_valid_sam_result(existing_r_sam, expected_model):
                        pair["ref_sam_segmentation"] = existing_r_sam
                    else:
                        pair["ref_sam_segmentation"] = {
                            "validation_status": "FAILED_VALIDATION",
                            "target": "reference",
                            "error": str(e),
                            "model_id": expected_model,
                            "frame_filename": r_filename,
                        }
            elif not r_bytes:
                if _is_valid_sam_result(existing_r_sam, expected_model):
                    pair["ref_sam_segmentation"] = existing_r_sam
                else:
                    pair["ref_sam_segmentation"] = {
                        "validation_status": "FAILED_VALIDATION",
                        "target": "reference",
                        "error": pair.get("reference_load_error") or "Reference frame bytes unavailable for localization",
                        "model_id": expected_model,
                    }

    return candidate_pairs


def build_multimodal_frame_items(
    candidate_pairs: List[Dict[str, Any]],
    incident_id: str = "incident",
    max_items: int = 6,
) -> List[Dict[str, Any]]:
    """
    Transforms grounded candidate pairs into an ordered list of frame items
    compliant with MetaReasoningProvider.build_multimodal_message.
    """
    items: List[Dict[str, Any]] = []

    for pair in candidate_pairs:
        if len(items) >= max_items:
            break

        # 1. Suspect frame
        s_bytes = pair.get("suspect_image_bytes")
        if s_bytes:
            ev_id = pair.get("evidence_id", "suspect_frame")
            ts = float(pair.get("suspect_timestamp_sec") or 0.0)
            sam_meta = pair.get("sam_segmentation") or {}

            sam_desc = ""
            if sam_meta.get("objects"):
                sam_desc = f" | SAM suspect localized {len(sam_meta['objects'])} object(s)"

            items.append({
                "image_bytes": s_bytes,
                "evidence_id": ev_id,
                "timestamp_sec": ts,
                "frame_type": f"suspect{sam_desc}",
                "asset_id": incident_id,
            })

        if len(items) >= max_items:
            break

        # 2. Reference frame
        r_bytes = pair.get("reference_image_bytes")
        if r_bytes:
            best = pair.get("best_match") or {}
            r_asset = pair.get("source_asset_id", "vault_asset")
            r_ts = float(pair.get("source_timestamp_sec") or 0.0)
            r_ev_id = f"ref_{pair.get('source_frame_id', '0')}_t{int(r_ts)}s"
            l2 = pair.get("l2_distance")
            l2_label = f" | CV L2={l2:.3f}" if l2 is not None else ""
            ref_sam = pair.get("ref_sam_segmentation") or {}
            ref_sam_desc = ""
            if ref_sam.get("objects"):
                ref_sam_desc = f" | SAM reference localized {len(ref_sam['objects'])} object(s)"

            items.append({
                "image_bytes": r_bytes,
                "evidence_id": r_ev_id,
                "timestamp_sec": r_ts,
                "frame_type": f"reference{l2_label}{ref_sam_desc}",
                "asset_id": r_asset,
            })

    return items[:max_items]


def extract_sam_bounding_boxes(
    sam_data: Optional[Dict[str, Any]],
    im_w: int = 1024,
    im_h: int = 580,
) -> List[Dict[str, Any]]:
    """
    Extracts validated normalized bounding boxes from diverse SAM 3.1 schema representations.
    Returns list of dicts: {"label": str, "confidence": Optional[float], "nx1": float, "ny1": float, "nx2": float, "ny2": float}
    """
    if not sam_data or not isinstance(sam_data, dict):
        return []

    raw_list = (
        sam_data.get("detected_objects")
        if isinstance(sam_data.get("detected_objects"), list)
        else (sam_data.get("objects") if isinstance(sam_data.get("objects"), list) else [])
    )
    if not raw_list:
        return []

    parsed_boxes: List[Dict[str, Any]] = []
    for item in raw_list:
        if not item:
            continue
        label = item.get("label") or item.get("class_name") or "Object"
        conf = item.get("confidence") if item.get("confidence") is not None else item.get("confidence_score")
        box_data = item.get("box")
        if not box_data:
            continue

        nx1 = ny1 = nx2 = ny2 = None

        if isinstance(box_data, (list, tuple)) and len(box_data) >= 4:
            vals = [float(v) for v in box_data[:4]]
            if any(v > 1.0 for v in vals):
                nx1 = max(0.0, min(1.0, vals[0] / im_w))
                ny1 = max(0.0, min(1.0, vals[1] / im_h))
                nx2 = max(0.0, min(1.0, vals[2] / im_w))
                ny2 = max(0.0, min(1.0, vals[3] / im_h))
            else:
                nx1, ny1, nx2, ny2 = vals[0], vals[1], vals[2], vals[3]
        elif isinstance(box_data, dict):
            if "normalized_coords" in box_data and isinstance(box_data["normalized_coords"], (list, tuple)):
                nc = box_data["normalized_coords"]
                if len(nc) >= 4:
                    nx1 = max(0.0, min(1.0, float(nc[0])))
                    ny1 = max(0.0, min(1.0, float(nc[1])))
                    nx2 = max(0.0, min(1.0, float(nc[2])))
                    ny2 = max(0.0, min(1.0, float(nc[3])))
            elif "x1" in box_data and "x2" in box_data:
                bw = float(box_data.get("w") or im_w)
                bh = float(box_data.get("h") or im_h)
                if bw > 0 and bh > 0:
                    nx1 = max(0.0, min(1.0, float(box_data["x1"]) / bw))
                    ny1 = max(0.0, min(1.0, float(box_data.get("y1", 0)) / bh))
                    nx2 = max(0.0, min(1.0, float(box_data["x2"]) / bw))
                    ny2 = max(0.0, min(1.0, float(box_data.get("y2", 0)) / bh))

        if nx1 is not None and ny1 is not None and nx2 is not None and ny2 is not None:
            if nx1 > nx2:
                nx1, nx2 = nx2, nx1
            if ny1 > ny2:
                ny1, ny2 = ny2, ny1
            if (nx2 - nx1) > 0.002 and (ny2 - ny1) > 0.002:
                parsed_boxes.append({
                    "label": str(label),
                    "confidence": float(conf) if conf is not None else None,
                    "nx1": nx1,
                    "ny1": ny1,
                    "nx2": nx2,
                    "ny2": ny2,
                })

    return parsed_boxes


def render_annotated_frame_bytes(
    image_bytes: bytes,
    sam_data: Optional[Dict[str, Any]],
) -> bytes:
    """
    Renders high-visibility, resolution-proportional SAM 3.1 bounding boxes and text pills
    directly onto the frame image using Pillow, returning high-quality JPEG bytes.
    If no valid boxes exist, returns the original image_bytes.
    """
    if not image_bytes or not sam_data:
        return image_bytes

    try:
        with Image.open(BytesIO(image_bytes)) as raw_im:
            im = raw_im.convert("RGB")
            im_w, im_h = im.size
            if im_w <= 0 or im_h <= 0:
                return image_bytes

            boxes = extract_sam_bounding_boxes(sam_data, im_w, im_h)
            if not boxes:
                return image_bytes

            annotated = im.copy()
            draw = ImageDraw.Draw(annotated)

            stroke_px = max(4, int(round(im_w * 0.007)))
            font_size = max(14, int(round(im_w * 0.016)))

            font = None
            for fc in (
                "/System/Library/Fonts/Helvetica.ttc",
                "/System/Library/Fonts/SFNS.ttf",
                "/System/Library/Fonts/Supplemental/Arial.ttf",
                "/Library/Fonts/Arial.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            ):
                if os.path.exists(fc):
                    try:
                        font = ImageFont.truetype(fc, font_size)
                        break
                    except Exception:
                        pass
            if not font:
                try:
                    font = ImageFont.load_default(size=font_size)
                except Exception:
                    font = ImageFont.load_default()

            teal_color = (45, 212, 191)  # #2dd4bf
            dark_bg = (15, 23, 42)       # Slate-900

            for b in boxes:
                px1 = max(0, min(im_w - 1, int(round(b["nx1"] * im_w))))
                py1 = max(0, min(im_h - 1, int(round(b["ny1"] * im_h))))
                px2 = max(0, min(im_w - 1, int(round(b["nx2"] * im_w))))
                py2 = max(0, min(im_h - 1, int(round(b["ny2"] * im_h))))
                if px2 <= px1 or py2 <= py1:
                    continue

                # 1. Outer dark contour
                draw.rectangle(
                    [px1 - 1, py1 - 1, px2 + 1, py2 + 1],
                    outline=(0, 0, 0),
                    width=stroke_px + 2,
                )
                # 2. Vibrant inner teal border
                draw.rectangle(
                    [px1, py1, px2, py2],
                    outline=teal_color,
                    width=stroke_px,
                )

                # 3. Label badge
                conf_suffix = (
                    f" {int(round(b['confidence'] * 100))}%"
                    if b.get("confidence") is not None
                    else ""
                )
                tag_text = f"SAM 3.1: {b['label']}{conf_suffix}"

                try:
                    tbox = draw.textbbox((0, 0), tag_text, font=font)
                    tw = tbox[2] - tbox[0]
                    th = tbox[3] - tbox[1]
                except Exception:
                    tw = len(tag_text) * int(font_size * 0.6)
                    th = font_size

                pad_x = int(font_size * 0.35)
                pad_y = int(font_size * 0.2)
                pill_w = tw + pad_x * 2
                pill_h = th + pad_y * 2

                if py1 >= pill_h + 4:
                    tag_y1 = max(0, py1 - pill_h - 4)
                else:
                    tag_y1 = py1 + 2
                tag_y2 = tag_y1 + pill_h
                tag_x2 = min(im_w - 1, px1 + pill_w)

                draw.rectangle([px1, tag_y1, tag_x2, tag_y2], fill=dark_bg)
                draw.rectangle([px1, tag_y1, tag_x2, tag_y2], outline=teal_color, width=max(2, stroke_px // 2))
                draw.text(
                    (px1 + pad_x, tag_y1 + pad_y),
                    tag_text,
                    font=font,
                    fill=(255, 255, 255),
                )

            out_buf = BytesIO()
            annotated.save(out_buf, format="JPEG", quality=92)
            return out_buf.getvalue()
    except Exception as exc:
        logger.warning(f"[VisualAnnotator] Failed to render annotated frame image: {exc}")
        return image_bytes


def ensure_incident_sam_grounded(
    incident: Dict[str, Any],
    prompt: str = "broadcast subject",
    max_pairs: int = 3,
    force: bool = False,
) -> bool:
    """
    Ensures an incident's top candidate frame matches have validated SAM 3.1
    bounding boxes for both suspect and reference frames.
    If already grounded and force is False, returns False without making redundant API calls.
    If grounded successfully, updates the incident record in-place and persists it.
    """
    fms = incident.get("frame_matches") or []
    if not fms:
        return False

    # Check if candidate matches exist and whether they already have valid SAM results
    all_grounded = True
    has_candidate = False
    for fm in fms:
        best = fm.get("best_match") or {}
        is_candidate = best.get("match_confirmed") or (
            best.get("l2_distance") is not None and best["l2_distance"] < 0.75
        )
        if is_candidate:
            has_candidate = True
            s_sam = fm.get("sam_segmentation") or best.get("sam_segmentation")
            r_sam = fm.get("ref_sam_segmentation") or best.get("ref_sam_segmentation")
            if not _is_valid_sam_result(s_sam, "sam-3.1") or not _is_valid_sam_result(r_sam, "sam-3.1"):
                all_grounded = False
                break

    if not force and all_grounded and has_candidate:
        return False

    try:
        selected_pairs = select_investigation_keyframes(incident, max_pairs=max_pairs)
        if not selected_pairs:
            return False

        grounded_pairs = ground_candidate_frames_with_sam(selected_pairs, prompt=prompt, force=force)
        incident_updated = False

        for p in grounded_pairs:
            idx = p.get("pair_index")
            if idx is not None and 0 <= idx < len(fms):
                fm = fms[idx]
                best = fm.setdefault("best_match", {})
                s_sam = p.get("sam_segmentation")
                r_sam = p.get("ref_sam_segmentation")
                if s_sam:
                    fm["sam_segmentation"] = s_sam
                    best["sam_segmentation"] = s_sam
                    incident_updated = True
                if r_sam:
                    fm["ref_sam_segmentation"] = r_sam
                    best["ref_sam_segmentation"] = r_sam
                    incident_updated = True

        if incident_updated:
            try:
                from app.registry import save_incident
                save_incident(incident, session_id=incident.get("session_id"))
                logger.info(f"[TemporalSelector] Grounded and saved incident {incident.get('incident_id')}")
            except Exception as save_err:
                logger.warning(f"[TemporalSelector] Failed to persist grounded incident: {save_err}")
            return True
    except Exception as exc:
        logger.warning(f"[TemporalSelector] SAM grounding failed non-fatally: {exc}")

    return False


def run_incident_sam_investigation(
    incident: Dict[str, Any],
    prompt: str = "broadcast subject",
    max_pairs: int = 3,
    force: bool = False,
) -> Dict[str, Any]:
    """
    Executes a manual SAM 3.1 specialist localization investigation on an incident's candidate frame pairs.
    Grounds up to max_pairs (up to 6 frames total: 3 suspect + 3 reference).
    Attaches grounded results back to incident["frame_matches"] and persists via save_incident.
    Returns investigation telemetry dictionary.
    """
    fms = incident.get("frame_matches") or []
    if not fms:
        return {
            "success": False,
            "incident_id": incident.get("incident_id"),
            "error": "Incident has no frame matches available for investigation.",
            "pairs_processed": 0,
            "frames_grounded": 0,
            "objects_detected": 0,
        }

    selected_pairs = select_investigation_keyframes(incident, max_pairs=max_pairs)
    if not selected_pairs:
        return {
            "success": False,
            "incident_id": incident.get("incident_id"),
            "error": "No eligible candidate frame pairs found in incident.",
            "pairs_processed": 0,
            "frames_grounded": 0,
            "objects_detected": 0,
        }

    grounded_pairs = ground_candidate_frames_with_sam(selected_pairs, prompt=prompt, force=force)
    incident_updated = False
    total_objects = 0
    frames_grounded = 0

    for p in grounded_pairs:
        idx = p.get("pair_index")
        if idx is not None and 0 <= idx < len(fms):
            fm = fms[idx]
            best = fm.setdefault("best_match", {})
            s_sam = p.get("sam_segmentation")
            r_sam = p.get("ref_sam_segmentation")

            if s_sam and s_sam.get("validation_status") != "FAILED_VALIDATION":
                fm["sam_segmentation"] = s_sam
                best["sam_segmentation"] = s_sam
                incident_updated = True
                frames_grounded += 1
                s_objs = len(s_sam.get("objects") or s_sam.get("detected_objects") or [])
                total_objects += s_objs
            elif s_sam and not fm.get("sam_segmentation"):
                fm["sam_segmentation"] = s_sam
                best["sam_segmentation"] = s_sam
                incident_updated = True

            if r_sam and r_sam.get("validation_status") != "FAILED_VALIDATION":
                fm["ref_sam_segmentation"] = r_sam
                best["ref_sam_segmentation"] = r_sam
                incident_updated = True
                frames_grounded += 1
                r_objs = len(r_sam.get("objects") or r_sam.get("detected_objects") or [])
                total_objects += r_objs
            elif r_sam and not fm.get("ref_sam_segmentation"):
                fm["ref_sam_segmentation"] = r_sam
                best["ref_sam_segmentation"] = r_sam
                incident_updated = True

    if incident_updated:
        try:
            from app.registry import save_incident
            save_incident(incident, session_id=incident.get("session_id"))
            logger.info(f"[TemporalSelector] Successfully saved SAM investigation for incident {incident.get('incident_id')}")
        except Exception as save_err:
            logger.error(f"[TemporalSelector] Error saving SAM investigation: {save_err}")

    return {
        "success": True,
        "incident_id": incident.get("incident_id"),
        "pairs_processed": len(grounded_pairs),
        "frames_grounded": frames_grounded,
        "objects_detected": total_objects,
        "incident": incident,
    }

