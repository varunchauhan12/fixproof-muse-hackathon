"""
Temporal evidence selector and multimodal grounding bridge for Stage 1C.
Connects deterministic CV candidate discovery (MobileNetV3/FAISS/pHash),
SAM 3.1 specialist localization, and Muse Wonder multimodal reasoning.
"""

from io import BytesIO
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from PIL import Image

from app.matcher import load_reference_frame_image, SUSPECT_THRESHOLD, MATCH_THRESHOLD
from app.providers import factory as provider_factory
from app.providers.sam_models import SegmentationResult

logger = logging.getLogger(__name__)


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
      - Loads real frame bytes for both suspect and reference images.
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
            "submitted_frame": sub,
            "best_match": best,
            "composite_rank": composite_rank,
            "l2_distance": l2_dist,
            "phash_score": phash_score,
            "source_asset_id": best.get("source_asset_id", "unknown"),
            "source_timestamp_sec": best.get("source_timestamp_sec", 0.0),
            "source_frame_id": best.get("source_frame_id", 0),
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

    # Resolve frame image bytes for suspect and reference
    resolved_pairs: List[Dict[str, Any]] = []

    for pair in selected_pairs:
        # Load suspect frame bytes
        suspect_bytes: Optional[bytes] = None
        s_path_str = pair.get("suspect_frame_path")
        if s_path_str:
            s_path = Path(s_path_str)
            if s_path.is_file():
                try:
                    suspect_bytes = s_path.read_bytes()
                except Exception as e:
                    logger.warning(f"[TemporalSelector] Could not read suspect frame {s_path}: {e}")

        # Fallback to suspect thumbnail if frame_path unavailable
        if not suspect_bytes:
            thumb_path_str = incident.get("thumbnail_storage_path") or incident.get("suspect_thumbnail_preview_url")
            if thumb_path_str:
                tp = Path(__file__).resolve().parent.parent / "storage" / "suspects" / "thumbnails" / Path(thumb_path_str).name
                if tp.is_file():
                    try:
                        suspect_bytes = tp.read_bytes()
                    except Exception:
                        pass

        # Load reference frame bytes
        ref_bytes: Optional[bytes] = None
        ref_pil = load_reference_frame_image(pair["best_match"])
        if ref_pil:
            try:
                buf = BytesIO()
                ref_pil.convert("RGB").save(buf, format="JPEG", quality=90)
                ref_bytes = buf.getvalue()
            except Exception as e:
                logger.warning(f"[TemporalSelector] Could not encode reference PIL image: {e}")

        pair["suspect_image_bytes"] = suspect_bytes
        pair["reference_image_bytes"] = ref_bytes
        resolved_pairs.append(pair)

    return resolved_pairs


def ground_candidate_frames_with_sam(
    candidate_pairs: List[Dict[str, Any]],
    prompt: str = "broadcast subject",
    max_sam_calls: int = 3,
) -> List[Dict[str, Any]]:
    """
    Passes selected candidate frame pairs through SAM 3.1 for visual localization.
    Keeps SAM strictly optional: failures degrade gracefully without aborting investigation.
    """
    if not candidate_pairs:
        return candidate_pairs

    try:
        sam_provider = provider_factory.get_segmentation_provider()
    except Exception as exc:
        logger.info(f"[TemporalSelector] SAM provider unavailable, skipping segmentation: {exc}")
        return candidate_pairs

    sam_calls = 0

    for pair in candidate_pairs:
        if sam_calls >= max_sam_calls:
            break

        s_bytes = pair.get("suspect_image_bytes")
        if s_bytes and not pair.get("sam_segmentation"):
            try:
                meta = {
                    "evidence_id": pair["evidence_id"],
                    "frame_index": pair["suspect_frame_idx"],
                    "timestamp_sec": pair["suspect_timestamp_sec"],
                }
                res = sam_provider.segment_frame(
                    image_bytes=s_bytes,
                    prompt=prompt,
                    metadata=meta,
                )
                if isinstance(res, SegmentationResult):
                    pair["sam_segmentation"] = res.model_dump(mode="json")
                elif isinstance(res, dict):
                    pair["sam_segmentation"] = res
                sam_calls += 1
            except Exception as e:
                logger.warning(f"[TemporalSelector] Optional SAM segmentation failed on pair {pair['evidence_id']}: {e}")
                pair["sam_segmentation"] = {
                    "validation_status": "FAILED_VALIDATION",
                    "error": str(e),
                    "model_id": getattr(sam_provider, "model_id", "sam-3.1"),
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
                sam_desc = f" | SAM localized {len(sam_meta['objects'])} object(s)"

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

            items.append({
                "image_bytes": r_bytes,
                "evidence_id": r_ev_id,
                "timestamp_sec": r_ts,
                "frame_type": f"reference{l2_label}",
                "asset_id": r_asset,
            })

    return items[:max_items]

