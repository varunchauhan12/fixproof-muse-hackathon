"""
Nemotron implementation of Vision and Reasoning providers for FixProof.
Targets:
- Vision: nvidia/Nemotron-3.5-Super-VL via Nebius Token Factory.
- Reasoning: nvidia/Nemotron-3_5-Lightning (or Nemotron-3.5-Super-VL) via Nebius Token Factory.
"""

from typing import Any, Dict, Optional

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
        return verify_candidate_pair(
            suspect_image_bytes=suspect_image_bytes,
            reference_image_bytes=reference_image_bytes,
            suspect_metadata=suspect_metadata,
            reference_metadata=reference_metadata,
        )


class NemotronReasoningProvider(BaseReasoningProvider):
    """Forensic investigation reasoning provider using Nemotron models."""

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
    ) -> Any:
        from app.nemotron_engine import generate_nemotron_report
        return generate_nemotron_report(
            investigation_input=investigation_input,
            model_override=model_override,
        )
