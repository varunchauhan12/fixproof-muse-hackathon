"""
Nemotron Multimodal Vision-Assisted Verification Module for FixProof (Phase 2.2).
Performs objective, structured pairwise visual verification of candidate frame matches
using nvidia/Nemotron-3.5-Super-VL via Nebius Token Factory.

Invariants:
- Targets strictly nvidia/Nemotron-3.5-Super-VL for vision tasks (never text-only models).
- Structured output: validated JSON with visual_correspondence, matching_features,
  contradictions, reasoning, and uncertainty_factors.
- Non-adjudicative: Model assesses visual correspondence, NOT legal copyright infringement.
- Bounded compute: Max 3 candidate pairs per incident, resized to max 512px.
- Caching: SHA-256 evidence hash cache prevents duplicate API calls.
- Never called automatically during report history navigation or video playback scrubbing.
- Graceful degradation: On error or timeout (15s), returns UNVERIFIED without crashing.
"""

from datetime import datetime, timezone
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import time
from typing import Any, Dict, List, Literal, Optional, Tuple

import openai
from PIL import Image

logger = logging.getLogger(__name__)

VISION_MODEL_ID = "nvidia/Nemotron-3.5-Super-VL"
DEFAULT_BASE_URL = os.getenv("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1/")
MAX_IMAGE_DIM = 512
VERIFICATION_TIMEOUT_SEC = 15.0
MAX_CANDIDATE_PAIRS = 3
DEFAULT_REASONING_MAX_TOKENS = 2048

CACHE_FILE = Path(__file__).resolve().parent.parent / "storage" / "cache" / "vision_verification_cache.json"

# In-memory session cache for fast deduplication
_MEMORY_CACHE: Dict[str, Dict[str, Any]] = {}


def _load_disk_cache() -> Dict[str, Dict[str, Any]]:
    """Loads cached vision verification results from local disk."""
    if not CACHE_FILE.exists():
        return {}
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"[VisionVerifier] Failed to load cache from {CACHE_FILE}: {e}")
        return {}


def _save_disk_cache(cache_data: Dict[str, Dict[str, Any]]) -> None:
    """Persists vision verification cache to disk safely."""
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache_data, f, indent=2)
    except Exception as e:
        logger.warning(f"[VisionVerifier] Failed to save cache to {CACHE_FILE}: {e}")


def resize_image_for_verification(img: Image.Image, max_dim: int = MAX_IMAGE_DIM) -> Tuple[Image.Image, bytes]:
    """
    Resizes an image preserving aspect ratio so max(width, height) <= max_dim.
    Returns the resized PIL image and its JPEG bytes.
    """
    w, h = img.size
    if max(w, h) > max_dim:
        scale = max_dim / float(max(w, h))
        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))
        resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    else:
        resized = img.copy()

    # Convert to RGB if needed (handling RGBA / P modes)
    if resized.mode != "RGB":
        resized = resized.convert("RGB")

    buf = io.BytesIO()
    resized.save(buf, format="JPEG", quality=85, optimize=True)
    return resized, buf.getvalue()


def compute_pair_cache_key(
    suspect_bytes: bytes,
    ref_bytes: bytes,
    model_id: str = VISION_MODEL_ID,
) -> str:
    """Computes a deterministic SHA-256 cache key from input evidence bytes and model ID."""
    hasher = hashlib.sha256()
    hasher.update(b"suspect:")
    hasher.update(suspect_bytes)
    hasher.update(b"|ref:")
    hasher.update(ref_bytes)
    hasher.update(b"|model:")
    hasher.update(model_id.encode("utf-8"))
    return hasher.hexdigest()


def get_cached_verification(cache_key: str) -> Optional[Dict[str, Any]]:
    """Retrieves a cached verification result from memory or disk cache."""
    if cache_key in _MEMORY_CACHE:
        return _MEMORY_CACHE[cache_key]
    disk = _load_disk_cache()
    if cache_key in disk:
        _MEMORY_CACHE[cache_key] = disk[cache_key]
        return disk[cache_key]
    return None


def store_cached_verification(cache_key: str, result: Dict[str, Any]) -> None:
    """Stores a verification result in memory and disk cache."""
    _MEMORY_CACHE[cache_key] = result
    disk = _load_disk_cache()
    disk[cache_key] = result
    _save_disk_cache(disk)


VERIFICATION_SYSTEM_PROMPT = """You are a forensic computer vision verification assistant for copyright and visual-asset workflows.
Your role is to perform an objective, evidence-grounded visual comparison of two images:
- Image 1: Suspect footage (extracted frame or public preview thumbnail).
- Image 2: Reference vault footage (official broadcast reference frame).

Analyze visible features including:
1. Scene composition, camera angle, and perspective.
2. Broadcast graphics, scoreboard bugs, watermarks, lower-thirds, or text overlays.
3. Player jerseys, team colors, numbers, sponsor logos, or attire.
4. Visible objects, court/field markings, crowd backgrounds, and lighting.
5. Contradictions or differences (different teams, different watermarks, different years/broadcasts).

NON-ADJUDICATIVE CONSTRAINT:
You must assess objective visual correspondence only. You must NOT issue a legal conclusion of copyright infringement or ownership.

You MUST respond with a valid, strictly formatted JSON object adhering to this schema:
{
  "visual_correspondence": "HIGH_CORRESPONDENCE" | "POSSIBLE_REUSE" | "UNRELATED_SCENE" | "UNVERIFIED",
  "confidence_assessment": "HIGH" | "MODERATE" | "LOW" | "INCONCLUSIVE",
  "matching_features": ["concise feature description", ...],
  "contradictions": ["concise difference description", ...],
  "reasoning": "A concise 2-4 sentence technical explanation of visual correspondence.",
  "uncertainty_factors": ["e.g. low resolution, heavy compression, motion blur", ...]
}
"""


def verify_candidate_pair(
    suspect_img: Image.Image,
    ref_img: Image.Image,
    suspect_timestamp_sec: float,
    reference_timestamp_sec: float,
    source_asset_id: str,
    candidate_pair_index: int = 0,
    model_id: str = VISION_MODEL_ID,
    timeout_sec: float = VERIFICATION_TIMEOUT_SEC,
) -> Dict[str, Any]:
    """
    Submits a candidate suspect/reference pair to nvidia/Nemotron-3.5-Super-VL
    for second-stage visual verification.
    
    Guarantees:
    - Downscales images to max 512px before encoding.
    - Checks in-memory and disk cache to avoid redundant API calls.
    - Gracefully handles timeouts, API errors, or unparseable JSON without crashing.
    - Never raises an unhandled exception.
    """
    import base64

    # 1. Preprocess and resize images
    try:
        _, suspect_bytes = resize_image_for_verification(suspect_img, MAX_IMAGE_DIM)
        _, ref_bytes = resize_image_for_verification(ref_img, MAX_IMAGE_DIM)
    except Exception as e:
        logger.error(f"[VisionVerifier] Error preprocessing images for pair {candidate_pair_index}: {e}")
        return {
            "candidate_pair_index": candidate_pair_index,
            "suspect_timestamp_sec": suspect_timestamp_sec,
            "reference_timestamp_sec": reference_timestamp_sec,
            "source_asset_id": source_asset_id,
            "visual_correspondence": "UNVERIFIED",
            "confidence_assessment": "INCONCLUSIVE",
            "matching_features": [],
            "contradictions": [],
            "reasoning": f"Image preprocessing failed: {e}",
            "uncertainty_factors": ["Preprocessing failure"],
            "validation_status": "FAILED",
            "model_id": model_id,
            "verified_at": datetime.now(timezone.utc).isoformat(),
        }

    # 2. Check cache
    cache_key = compute_pair_cache_key(suspect_bytes, ref_bytes, model_id)
    cached = get_cached_verification(cache_key)
    if cached:
        res = dict(cached)
        res["candidate_pair_index"] = candidate_pair_index
        res["suspect_timestamp_sec"] = suspect_timestamp_sec
        res["reference_timestamp_sec"] = reference_timestamp_sec
        res["source_asset_id"] = source_asset_id
        res["cached"] = True
        return res

    # 3. Check API key
    api_key = os.getenv("NEBIUS_API_KEY", "").strip()
    if not api_key:
        logger.warning("[VisionVerifier] NEBIUS_API_KEY not set. Returning UNVERIFIED.")
        return {
            "candidate_pair_index": candidate_pair_index,
            "suspect_timestamp_sec": suspect_timestamp_sec,
            "reference_timestamp_sec": reference_timestamp_sec,
            "source_asset_id": source_asset_id,
            "visual_correspondence": "UNVERIFIED",
            "confidence_assessment": "INCONCLUSIVE",
            "matching_features": [],
            "contradictions": [],
            "reasoning": "Nebius API key not configured for vision verification.",
            "uncertainty_factors": ["API key missing"],
            "validation_status": "VERIFICATION_UNAVAILABLE",
            "model_id": model_id,
            "verified_at": datetime.now(timezone.utc).isoformat(),
        }

    # 4. Prepare base64 data URIs
    b64_suspect = base64.b64encode(suspect_bytes).decode("utf-8")
    b64_ref = base64.b64encode(ref_bytes).decode("utf-8")

    client = openai.OpenAI(
        api_key=api_key,
        base_url=DEFAULT_BASE_URL,
        timeout=timeout_sec,
    )

    t0 = time.time()
    try:
        logger.info(f"[VisionVerifier] Calling {model_id} for pair {candidate_pair_index} ({source_asset_id})...")
        response = client.chat.completions.create(
            model=model_id,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": VERIFICATION_SYSTEM_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64_suspect}"},
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64_ref}"},
                        },
                    ],
                }
            ],
            max_tokens=DEFAULT_REASONING_MAX_TOKENS,
            response_format={"type": "json_object"},
        )
        latency_ms = int((time.time() - t0) * 1000)
        raw_content = response.choices[0].message.content or "{}"
        parsed = json.loads(raw_content)

        correspondence = parsed.get("visual_correspondence")
        if correspondence not in ("HIGH_CORRESPONDENCE", "POSSIBLE_REUSE", "UNRELATED_SCENE", "UNVERIFIED"):
            correspondence = "POSSIBLE_REUSE" if "match" in str(parsed).lower() else "UNVERIFIED"

        conf_assess = parsed.get("confidence_assessment")
        if conf_assess not in ("HIGH", "MODERATE", "LOW", "INCONCLUSIVE"):
            conf_assess = "MODERATE"

        result = {
            "candidate_pair_index": candidate_pair_index,
            "suspect_timestamp_sec": suspect_timestamp_sec,
            "reference_timestamp_sec": reference_timestamp_sec,
            "source_asset_id": source_asset_id,
            "visual_correspondence": correspondence,
            "confidence_assessment": conf_assess,
            "matching_features": list(parsed.get("matching_features") or []),
            "contradictions": list(parsed.get("contradictions") or []),
            "reasoning": str(parsed.get("reasoning") or "").strip(),
            "uncertainty_factors": list(parsed.get("uncertainty_factors") or []),
            "validation_status": "VERIFIED",
            "model_id": model_id,
            "latency_ms": latency_ms,
            "verified_at": datetime.now(timezone.utc).isoformat(),
            "cached": False,
        }

        # Store in cache
        store_cached_verification(cache_key, result)
        logger.info(f"[VisionVerifier] Pair {candidate_pair_index} verified: {correspondence} ({latency_ms}ms)")
        return result

    except openai.APITimeoutError:
        logger.warning(f"[VisionVerifier] Timeout ({timeout_sec}s) verifying pair {candidate_pair_index}.")
        return {
            "candidate_pair_index": candidate_pair_index,
            "suspect_timestamp_sec": suspect_timestamp_sec,
            "reference_timestamp_sec": reference_timestamp_sec,
            "source_asset_id": source_asset_id,
            "visual_correspondence": "UNVERIFIED",
            "confidence_assessment": "INCONCLUSIVE",
            "matching_features": [],
            "contradictions": [],
            "reasoning": f"Vision model request timed out after {timeout_sec} seconds.",
            "uncertainty_factors": ["API request timeout"],
            "validation_status": "VERIFICATION_UNAVAILABLE",
            "model_id": model_id,
            "verified_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.warning(f"[VisionVerifier] Failed to verify pair {candidate_pair_index}: {e}")
        return {
            "candidate_pair_index": candidate_pair_index,
            "suspect_timestamp_sec": suspect_timestamp_sec,
            "reference_timestamp_sec": reference_timestamp_sec,
            "source_asset_id": source_asset_id,
            "visual_correspondence": "UNVERIFIED",
            "confidence_assessment": "INCONCLUSIVE",
            "matching_features": [],
            "contradictions": [],
            "reasoning": f"Vision verification unavailable: {e}",
            "uncertainty_factors": [str(e)],
            "validation_status": "VERIFICATION_UNAVAILABLE",
            "model_id": model_id,
            "verified_at": datetime.now(timezone.utc).isoformat(),
        }
