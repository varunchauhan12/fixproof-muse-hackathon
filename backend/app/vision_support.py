"""Shared image preparation, evidence-keyed cache and visual comparison prompt. No API client."""
from datetime import datetime, timezone
import hashlib
import io
import json
import logging
from pathlib import Path
import time
from typing import Any, Dict, List, Literal, Optional, Tuple

from PIL import Image

logger = logging.getLogger(__name__)

VISION_MODEL_ID = "not-recorded"
PROMPT_VERSION = "v1.1-forensic"
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
    prompt_version: str = PROMPT_VERSION,
) -> str:
    """Computes a deterministic SHA-256 cache key from input evidence bytes, model ID, and prompt version."""
    hasher = hashlib.sha256()
    hasher.update(b"suspect:")
    hasher.update(suspect_bytes)
    hasher.update(b"|ref:")
    hasher.update(ref_bytes)
    hasher.update(b"|model:")
    hasher.update(model_id.encode("utf-8"))
    hasher.update(b"|prompt:")
    hasher.update(prompt_version.encode("utf-8"))
    return hasher.hexdigest()


def get_cached_verification(cache_key: str) -> Optional[Dict[str, Any]]:
    """Retrieves a cached verification result from memory, Supabase DB, or disk cache."""
    if cache_key in _MEMORY_CACHE:
        return _MEMORY_CACHE[cache_key]

    try:
        from app.registry import is_cloud_mode
        if is_cloud_mode():
            from app.db import default_db_manager
            row = default_db_manager.fetch_one(
                """
                SELECT visual_correspondence, confidence_assessment, matching_features,
                       contradictions, reasoning, uncertainty_factors, validation_status,
                       model_id, latency_ms, created_at
                FROM vision_verifications
                WHERE cache_key = %s;
                """,
                (cache_key,),
            )
            if row:
                m_features = row.get("matching_features") or []
                if isinstance(m_features, str):
                    try:
                        m_features = json.loads(m_features)
                    except Exception:
                        m_features = []
                contras = row.get("contradictions") or []
                if isinstance(contras, str):
                    try:
                        contras = json.loads(contras)
                    except Exception:
                        contras = []
                uncertain = row.get("uncertainty_factors") or []
                if isinstance(uncertain, str):
                    try:
                        uncertain = json.loads(uncertain)
                    except Exception:
                        uncertain = []

                res = {
                    "cache_key": cache_key,
                    "visual_correspondence": row.get("visual_correspondence") or "UNVERIFIED",
                    "confidence_assessment": row.get("confidence_assessment") or "INCONCLUSIVE",
                    "matching_features": m_features,
                    "contradictions": contras,
                    "reasoning": row.get("reasoning") or "",
                    "uncertainty_factors": uncertain,
                    "validation_status": row.get("validation_status") or "VERIFIED",
                    "model_id": row.get("model_id") or VISION_MODEL_ID,
                    "latency_ms": int(row.get("latency_ms") or 0),
                    "created_at": str(row.get("created_at") or ""),
                    "cached": True,
                }
                _MEMORY_CACHE[cache_key] = res
                return res
    except Exception as e:
        logger.warning(f"[VisionVerifier] Cloud cache lookup error: {e}")

    disk = _load_disk_cache()
    if cache_key in disk:
        _MEMORY_CACHE[cache_key] = disk[cache_key]
        return disk[cache_key]
    return None


def store_cached_verification(cache_key: str, result: Dict[str, Any]) -> None:
    """Stores a verification result in memory, Supabase DB (cloud), and disk cache."""
    _MEMORY_CACHE[cache_key] = result

    try:
        from app.registry import is_cloud_mode
        if is_cloud_mode():
            from app.db import default_db_manager
            m_feat = result.get("matching_features", [])
            contra = result.get("contradictions", [])
            uncert = result.get("uncertainty_factors", [])
            default_db_manager.execute(
                """
                INSERT INTO vision_verifications (
                    cache_key, visual_correspondence, confidence_assessment,
                    matching_features, contradictions, reasoning, uncertainty_factors,
                    validation_status, model_id, latency_ms, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (cache_key) DO UPDATE SET
                    visual_correspondence = EXCLUDED.visual_correspondence,
                    confidence_assessment = EXCLUDED.confidence_assessment,
                    matching_features = EXCLUDED.matching_features,
                    contradictions = EXCLUDED.contradictions,
                    reasoning = EXCLUDED.reasoning,
                    uncertainty_factors = EXCLUDED.uncertainty_factors,
                    validation_status = EXCLUDED.validation_status;
                """,
                (
                    cache_key,
                    result.get("visual_correspondence", "UNVERIFIED"),
                    result.get("confidence_assessment", "INCONCLUSIVE"),
                    json.dumps(m_feat),
                    json.dumps(contra),
                    result.get("reasoning", ""),
                    json.dumps(uncert),
                    result.get("validation_status", "VERIFIED"),
                    result.get("model_id", VISION_MODEL_ID),
                    int(result.get("latency_ms") or 0),
                ),
            )
    except Exception as e:
        logger.warning(f"[VisionVerifier] Cloud cache store error: {e}")

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
