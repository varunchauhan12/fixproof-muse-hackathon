"""
Visual Matching and Perceptual Hashing module for FixProof (Phase 2.2).
Ported and adapted from MediaGuard Sports Sentinel (agents/sentinel.py).

Features:
- Queries the existing FAISS Reference Vault using MobileNetV3 (576-dim) embeddings.
- Layer 1: L2 similarity search with calibrated visual similarity scoring and thresholding.
- Layer 2: pHash verification (using imagehash.phash) comparing suspect vs. matched reference frames.
- Image Entropy Filter: Detects and flags low-information / blank frames (H < 1.5).
- Nemotron Vision Verification: Shortlists top candidate pairs (max 3) for multimodal pair verification.
- Strictly prevents self-matching against the submitted asset.
- All outputs represent candidate visual similarity, not definitive legal findings.
"""

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
import logging
import math

import imagehash
import numpy as np
from PIL import Image

from app.vault import ReferenceVault, extract_image_embedding

logger = logging.getLogger(__name__)

MATCH_THRESHOLD = 0.55    # L2 distance < 0.55 -> confirmed candidate visual match
SUSPECT_THRESHOLD = 0.75  # L2 distance < 0.75 -> suspect match (triggers pHash check)
PHASH_MATCH_HAMMING_THRESHOLD = 15  # Hamming distance < 15 -> perceptual hash match confirmed
MIN_IMAGE_ENTROPY = 0.5   # Shannon entropy threshold; strictly solid/uniform frames (H < 0.5) are flagged as blank/solid

SCORE_VERSION = "v1.1-uncalibrated-heuristic"
VISUAL_SIMILARITY_NOTICE = "Visual similarity measurements are not calibrated probabilities of infringement."


def compute_image_entropy(img: Image.Image) -> float:
    """
    Computes Shannon entropy of an image histogram in range [0.0, 8.0].
    Solid black, solid white, or uniform test patterns yield H < 1.0.
    Natural video frames typically yield H >= 4.0.
    """
    gray = img.convert("L")
    hist = gray.histogram()
    total = sum(hist)
    if total == 0:
        return 0.0
    entropy = 0.0
    for count in hist:
        if count > 0:
            p = count / total
            entropy -= p * math.log2(p)
    return round(entropy, 4)


def l2_to_visual_similarity(distance: float) -> float:
    """
    Computes an uncalibrated heuristic visual feature similarity percentage (0.0 to 100.0%)
    from the L2 distance between normalized MobileNetV3 feature embeddings.
    
    Mathematical Context:
    For L2-normalized vectors in the non-negative orthant R^{576}_{>=0}, unrelated natural images
    yield an expected dot product of ~0.45 to ~0.55 (Euclidean distance d ~ 0.95 to 1.05).
    Under legacy linear scaling (1 - d/2)*100, unrelated images exhibited ~50% confidence.
    
    This transparent, uncalibrated piecewise heuristic anchors to FixProof's verified thresholds:
    - d <= 0.00: 100.0% (exact identical embedding)
    - 0.00 < d <= 0.55 (MATCH_THRESHOLD): 80.0% to 100.0% (candidate visual match band)
    - 0.55 < d <= 0.75 (SUSPECT_THRESHOLD): 50.0% to 80.0% (suspect visual proximity band)
    - 0.75 < d <= 1.05: 5.0% to 50.0% (weak ambient feature overlap)
    - d > 1.05: rapidly decays to 0.0% (random noise floor for distinct scenes)
    
    Notice:
    This metric is a distance-derived similarity index, NOT a calibrated legal probability.
    """
    d = max(0.0, float(distance))
    if d == 0.0:
        return 100.0
    if d <= MATCH_THRESHOLD:  # 0.0 < d <= 0.55
        return round(100.0 - (d / MATCH_THRESHOLD) * 20.0, 2)
    elif d <= SUSPECT_THRESHOLD:  # 0.55 < d <= 0.75
        ratio = (d - MATCH_THRESHOLD) / (SUSPECT_THRESHOLD - MATCH_THRESHOLD)
        return round(80.0 - ratio * 30.0, 2)
    elif d <= 1.05:  # 0.75 < d <= 1.05
        ratio = (d - SUSPECT_THRESHOLD) / (1.05 - SUSPECT_THRESHOLD)
        return round(50.0 - ratio * 45.0, 2)
    elif d <= 1.414:  # 1.05 < d <= 1.414
        ratio = (d - 1.05) / (1.414 - 1.05)
        return round(max(0.0, 5.0 - ratio * 5.0), 2)
    else:
        return 0.0


# Legacy alias preserved for backwards compatibility with callers and tests
l2_to_confidence = l2_to_visual_similarity


def severity_from_confidence(confidence: float) -> str:
    """Classifies match severity from visual feature similarity percentage."""
    if confidence >= 80.0:
        return "CRITICAL"
    if confidence >= 50.0:
        return "WARNING"
    return "INFO"


def compute_phash_evidence(
    suspect_img: Image.Image,
    ref_img: Image.Image,
) -> Dict[str, Any]:
    """
    Computes perceptual hash comparison between suspect and matched reference frame.
    Returns hamming distance, pHash match flag, and 0-100 score.
    """
    suspect_hash = imagehash.phash(suspect_img)
    ref_hash = imagehash.phash(ref_img)
    hamming_diff = int(suspect_hash - ref_hash)
    phash_score = max(0, 100 - (hamming_diff * 4))
    phash_match = bool(hamming_diff < PHASH_MATCH_HAMMING_THRESHOLD)

    return {
        "suspect_phash": str(suspect_hash),
        "matched_phash": str(ref_hash),
        "hamming_distance": hamming_diff,
        "phash_score": phash_score,
        "phash_match": phash_match,
    }


def load_reference_frame_image(meta: Dict[str, Any]) -> Optional[Image.Image]:
    """
    Loads a reference frame PIL image from local disk, or from Supabase Storage
    when running in cloud mode.
    """
    ref_path_str = meta.get("source_frame_path") or meta.get("frame_path")
    if ref_path_str:
        ref_path = Path(ref_path_str)
        if ref_path.exists() and ref_path.is_file():
            try:
                return Image.open(ref_path)
            except Exception as e:
                logger.warning(f"[Matcher] Could not open local frame {ref_path}: {e}")

    # If running in cloud mode, attempt authenticated retrieval from reference-frames bucket
    try:
        from app.db import get_db_config
        from app.storage import SupabaseStorageClient
        if get_db_config().is_cloud:
            asset_id = meta.get("source_asset_id") or meta.get("asset_id")
            filename = meta.get("source_filename") or meta.get("filename")
            if asset_id and filename:
                cloud_cache_file = Path(__file__).resolve().parent.parent / "storage" / "cloud_cache" / "frames" / asset_id / filename
                if cloud_cache_file.exists():
                    return Image.open(cloud_cache_file)

                # Download from reference-frames bucket
                client = SupabaseStorageClient()
                storage_path = f"{asset_id}/{filename}"
                frame_bytes = client.download_file("reference-frames", storage_path)
                cloud_cache_file.parent.mkdir(parents=True, exist_ok=True)
                cloud_cache_file.write_bytes(frame_bytes)
                import io
                return Image.open(io.BytesIO(frame_bytes))
    except Exception as e:
        logger.warning(f"[Matcher] Could not load cloud reference frame for {meta}: {e}")

    return None


def match_single_frame(
    suspect_img: Image.Image,
    submitted_asset_id: str,
    vault: ReferenceVault,
    k: int = 3,
) -> Optional[Dict[str, Any]]:
    """
    Searches the FAISS vault for the best candidate match for a single frame,
    excluding any vectors belonging to the submitted asset (prevents self-matching).
    """
    if vault.vector_db.ntotal == 0:
        return None

    # Entropy check for blank/solid color images
    entropy_val = compute_image_entropy(suspect_img)
    is_low_entropy = bool(entropy_val < MIN_IMAGE_ENTROPY)

    suspect_embedding = extract_image_embedding(suspect_img)

    # Query up to 20 neighbors so we can filter out self-matches
    query_k = min(vault.vector_db.ntotal, max(k * 4, 10))
    distances, indices = vault.vector_db.search(suspect_embedding, query_k)

    candidates = []
    for dist, idx in zip(distances[0], indices[0]):
        if idx == -1:
            continue
        meta = vault.metadata_store.get(str(idx), {})

        # Prevent self-matching
        if meta.get("asset_id") == submitted_asset_id:
            continue

        l2_dist = float(round(float(dist), 4))
        visual_similarity = l2_to_visual_similarity(l2_dist)

        # Do not confirm match if frame is blank/low-entropy
        match_confirmed = bool(l2_dist < MATCH_THRESHOLD and not is_low_entropy)
        effective_similarity = 0.0 if is_low_entropy else visual_similarity

        candidates.append({
            "vector_id": int(idx),
            "source_asset_id": meta.get("asset_id", "unknown"),
            "source_frame_id": meta.get("frame_id", 0),
            "source_timestamp_sec": meta.get("timestamp_sec", 0),
            "source_filename": meta.get("filename", ""),
            "source_frame_path": meta.get("frame_path", ""),
            "l2_distance": l2_dist,
            "visual_similarity_score": effective_similarity,
            "confidence_score": effective_similarity,  # Legacy alias
            "score_calibration_notice": VISUAL_SIMILARITY_NOTICE,
            "score_version": SCORE_VERSION,
            "severity": "INFO" if is_low_entropy else severity_from_confidence(visual_similarity),
            "match_confirmed": match_confirmed,
            "entropy": entropy_val,
            "low_entropy_flag": is_low_entropy,
        })

        if len(candidates) >= k:
            break

    if not candidates:
        return None

    best = candidates[0]

    # Layer 2: pHash cross-check if candidate is within suspect threshold
    phash_evidence = None
    if best["l2_distance"] < SUSPECT_THRESHOLD and not is_low_entropy:
        ref_pil = load_reference_frame_image(best)
        if ref_pil is not None:
            try:
                phash_evidence = compute_phash_evidence(suspect_img, ref_pil)
            except Exception as e:
                logger.warning(f"[Matcher] Could not compute pHash against reference frame: {e}")

    best["phash_match"] = phash_evidence["phash_match"] if phash_evidence else False
    best["phash_score"] = phash_evidence["phash_score"] if phash_evidence else 0
    best["phash_distance"] = phash_evidence["hamming_distance"] if phash_evidence else None
    best["phash_evidence"] = phash_evidence

    if is_low_entropy:
        best["similarity_status"] = "NO_MATCH"
    elif best["match_confirmed"]:
        best["similarity_status"] = "CONFIRMED_MATCH"
    elif best["l2_distance"] < SUSPECT_THRESHOLD:
        best["similarity_status"] = "SUSPECT_MATCH"
    else:
        best["similarity_status"] = "NO_MATCH"

    return {
        "best_match": best,
        "top_candidates": candidates,
    }


def analyze_asset_matches(
    submitted_asset_id: str,
    frames_dir: Path,
    vault: ReferenceVault,
    k_candidates: int = 3,
    run_vision_verification: bool = True,
) -> Dict[str, Any]:
    """
    Analyzes all extracted frames of an already-uploaded video against the FAISS reference vault.
    Performs candidate ranking and executes bounded Nemotron vision verification on top pairs.

    Returns:
        Structured candidate similarity review containing match statistics,
        timestamps, distance scores, perceptual hash evidence, and vision verification.
    """
    disclaimer = "Candidate visual similarity only; not a definitive copyright-infringement finding."

    if not frames_dir.exists():
        raise FileNotFoundError(
            f"Asset '{submitted_asset_id}' not found. No extracted frames directory at {frames_dir}"
        )

    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    if not frame_files:
        raise ValueError(
            f"No extracted JPEG frames found for asset '{submitted_asset_id}'."
        )

    # Check if vault has any external vectors
    external_vectors_exist = False
    for meta in vault.metadata_store.values():
        if meta.get("asset_id") != submitted_asset_id:
            external_vectors_exist = True
            break

    if vault.vector_db.ntotal == 0 or not external_vectors_exist:
        return {
            "submitted_asset_id": submitted_asset_id,
            "disclaimer": disclaimer,
            "total_frames_analyzed": len(frame_files),
            "candidate_matches_found": 0,
            "highest_confidence": 0.0,
            "highest_visual_similarity": 0.0,
            "lowest_l2_distance": None,
            "overall_status": "NO_REFERENCE_DATA",
            "message": "Reference vault is empty or contains no external reference videos.",
            "matched_assets": [],
            "frame_matches": [],
            "score_version": SCORE_VERSION,
            "score_calibration_notice": VISUAL_SIMILARITY_NOTICE,
        }

    frame_matches = []
    highest_confidence = 0.0
    lowest_l2_distance = float("inf")
    matched_asset_ids = set()
    confirmed_match_count = 0

    candidate_pairs_to_verify: List[Dict[str, Any]] = []

    for idx, fpath in enumerate(frame_files):
        # Extract timestamp from filename: frame_0005s.jpg -> 5
        timestamp_sec = idx * 5
        try:
            parts = fpath.stem.split("_")
            if len(parts) > 1:
                timestamp_sec = int(parts[1].replace("s", ""))
        except Exception:
            pass

        try:
            with Image.open(fpath) as img:
                match_result = match_single_frame(
                    suspect_img=img,
                    submitted_asset_id=submitted_asset_id,
                    vault=vault,
                    k=k_candidates,
                )
        except Exception as e:
            logger.error(f"[Matcher] Error reading frame {fpath}: {e}")
            continue

        frame_info = {
            "frame_index": idx,
            "timestamp_sec": timestamp_sec,
            "filename": fpath.name,
            "frame_path": str(fpath),
        }

        if match_result and match_result.get("best_match"):
            best = match_result["best_match"]
            conf = best["confidence_score"]
            dist = best["l2_distance"]

            # Only informative non-blank frames contribute to incident similarity scores
            if not best.get("low_entropy_flag"):
                if conf > highest_confidence:
                    highest_confidence = conf
                if dist < lowest_l2_distance:
                    lowest_l2_distance = dist

                if best["match_confirmed"]:
                    confirmed_match_count += 1
                    matched_asset_ids.add(best["source_asset_id"])
                elif dist < SUSPECT_THRESHOLD:
                    matched_asset_ids.add(best["source_asset_id"])

            # Candidate selection for vision verification:
            # Must pass CV gates: dist < SUSPECT_THRESHOLD, not low-entropy
            if (
                dist < SUSPECT_THRESHOLD
                and not best.get("low_entropy_flag")
                and (best.get("match_confirmed") or best.get("phash_match") or (best.get("phash_score", 0) >= 30) or dist < MATCH_THRESHOLD)
            ):
                composite_rank = 0.6 * (1.0 - min(1.0, dist)) + 0.4 * (best.get("phash_score", 0) / 100.0)
                candidate_pairs_to_verify.append({
                    "frame_match_idx": len(frame_matches),
                    "suspect_frame_path": fpath,
                    "suspect_timestamp_sec": timestamp_sec,
                    "best_match": best,
                    "composite_rank": composite_rank,
                })

            frame_matches.append({
                "submitted_frame": frame_info,
                "best_match": best,
                "top_candidates": match_result.get("top_candidates", []),
            })
        else:
            frame_matches.append({
                "submitted_frame": frame_info,
                "best_match": None,
                "top_candidates": [],
            })

    if lowest_l2_distance == float("inf"):
        lowest_l2_distance = None

    if confirmed_match_count > 0:
        overall_status = "CANDIDATE_MATCH"
    elif lowest_l2_distance is not None and lowest_l2_distance < SUSPECT_THRESHOLD:
        overall_status = "SUSPECT"
    else:
        overall_status = "CLEAN"

    # Execute Bounded Nemotron Vision Verification on Top 3 Candidates
    if run_vision_verification and candidate_pairs_to_verify:
        try:
            from app.vision_verifier import verify_candidate_pair
            # Sort by composite rank descending
            candidate_pairs_to_verify.sort(key=lambda x: x["composite_rank"], reverse=True)
            top_pairs = candidate_pairs_to_verify[:3]

            for pair_idx, candidate in enumerate(top_pairs):
                best = candidate["best_match"]
                ref_pil = load_reference_frame_image(best)
                suspect_path = candidate["suspect_frame_path"]

                if ref_pil and suspect_path.exists():
                    with Image.open(suspect_path) as s_img:
                        v_res = verify_candidate_pair(
                            suspect_img=s_img,
                            ref_img=ref_pil,
                            suspect_timestamp_sec=float(candidate["suspect_timestamp_sec"]),
                            reference_timestamp_sec=float(best.get("source_timestamp_sec", 0.0)),
                            source_asset_id=str(best.get("source_asset_id", "")),
                            candidate_pair_index=pair_idx,
                        )
                        # Attach verification to the best_match in frame_matches
                        fm_idx = candidate["frame_match_idx"]
                        frame_matches[fm_idx]["best_match"]["vision_verification"] = v_res
                else:
                    reason = "Reference frame unavailable" if not ref_pil else "Suspect frame file missing"
                    unverified_res = {
                        "candidate_pair_index": pair_idx,
                        "suspect_timestamp_sec": float(candidate["suspect_timestamp_sec"]),
                        "reference_timestamp_sec": float(best.get("source_timestamp_sec", 0.0)),
                        "source_asset_id": str(best.get("source_asset_id", "")),
                        "visual_correspondence": "UNVERIFIED",
                        "confidence_assessment": "INCONCLUSIVE",
                        "matching_features": [],
                        "contradictions": [],
                        "reasoning": f"Vision verification unavailable: {reason}.",
                        "uncertainty_factors": [reason],
                        "validation_status": "VERIFICATION_UNAVAILABLE",
                        "model_id": "nvidia/Nemotron-3.5-Super-VL",
                        "verified_at": datetime.now(timezone.utc).isoformat(),
                    }
                    fm_idx = candidate["frame_match_idx"]
                    frame_matches[fm_idx]["best_match"]["vision_verification"] = unverified_res
        except Exception as e:
            logger.warning(f"[Matcher] Vision verification stage encountered error: {e}")

    return {
        "submitted_asset_id": submitted_asset_id,
        "disclaimer": disclaimer,
        "total_frames_analyzed": len(frame_files),
        "candidate_matches_found": confirmed_match_count,
        "highest_confidence": highest_confidence,
        "highest_visual_similarity": highest_confidence,
        "lowest_l2_distance": lowest_l2_distance,
        "overall_status": overall_status,
        "matched_assets": sorted(list(matched_asset_ids)),
        "frame_matches": frame_matches,
        "score_version": SCORE_VERSION,
        "score_calibration_notice": VISUAL_SIMILARITY_NOTICE,
    }
