"""
Nemotron implementation of Vision and Reasoning providers for FixProof.
Targets:
- Vision: nvidia/Nemotron-3.5-Super-VL via Nebius Token Factory.
- Reasoning: nvidia/Nemotron-3_5-Lightning (or Nemotron-3.5-Super-VL) via Nebius Token Factory.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
import io

from PIL import Image

from app.providers.base import BaseVisionProvider, BaseReasoningProvider


class NemotronVisionProvider(BaseVisionProvider):
    """Pairwise visual verification provider using nvidia/Nemotron-3.5-Super-VL."""

    @property
    def provider_name(self) -> str:
        return "nemotron"

    @property
    def model_id(self) -> str:
        from app.vision_verifier import VISION_MODEL_ID
        return VISION_MODEL_ID

    def verify_candidate_pair(
        self,
        suspect_image_bytes: bytes,
        reference_image_bytes: bytes,
        suspect_metadata: Optional[Dict[str, Any]] = None,
        reference_metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        from app.vision_verifier import verify_candidate_pair
        suspect = suspect_metadata or {}
        reference = reference_metadata or {}
        context = dict(
            suspect_timestamp_sec=float(suspect.get("timestamp_sec", 0.0)),
            reference_timestamp_sec=float(reference.get("timestamp_sec", 0.0)),
            source_asset_id=str(reference.get("asset_id", "")),
            candidate_pair_index=int(suspect.get("candidate_pair_index", 0)),
        )
        try:
            with Image.open(io.BytesIO(suspect_image_bytes)) as suspect_img, Image.open(io.BytesIO(reference_image_bytes)) as ref_img:
                return verify_candidate_pair(suspect_img=suspect_img, ref_img=ref_img, **context)
        except Exception as exc:
            return {
                **context,
                "visual_correspondence": "UNVERIFIED",
                "confidence_assessment": "INCONCLUSIVE",
                "matching_features": [], "contradictions": [],
                "reasoning": f"Vision verification unavailable: {exc}",
                "uncertainty_factors": ["Provider failure"],
                "validation_status": "VERIFICATION_UNAVAILABLE",
                "model_id": self.model_id,
                "verified_at": datetime.now(timezone.utc).isoformat(),
            }


class NemotronReasoningProvider(BaseReasoningProvider):
    """Forensic investigation reasoning provider using Nemotron models."""

    def create_text_completion(
        self,
        request: Dict[str, Any],
        client_options: Optional[Dict[str, Any]] = None,
    ) -> Any:
        from app.nemotron_engine import get_openai_client
        from openai import OpenAI
        if client_options is not None:
            # /diagnose historically used an explicitly configured, unpooled client.
            with OpenAI(**client_options) as client:
                return client.chat.completions.create(**request)
        return get_openai_client().chat.completions.create(**request)

    @property
    def provider_name(self) -> str:
        return "nemotron"

    @property
    def model_id(self) -> str:
        from app.nemotron_engine import DEFAULT_MODEL
        return DEFAULT_MODEL

    def generate_investigation_report(
        self,
        investigation_input: Any,
        model_override: Optional[str] = None,
        frame_images: Optional[List[Dict[str, Any]]] = None,
    ) -> Any:
        from app.nemotron_engine import generate_nemotron_report
        return generate_nemotron_report(
            input_data=investigation_input,
            model_override=model_override,
        )
