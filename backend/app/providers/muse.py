"""
Muse provider scaffold for FixProof (Meta Hackathon).
Scaffolded interface prepared for Phase 4. Both repositories remain on Nemotron for Phase 3.1.
"""

from typing import Any, Dict, Optional

from app.providers.base import BaseVisionProvider, BaseReasoningProvider


class MuseVisionProvider(BaseVisionProvider):
    """Scaffolded vision provider for Muse multimodal models."""

    @property
    def provider_name(self) -> str:
        return "muse"

    @property
    def model_id(self) -> str:
        return "meta-llama/Llama-Vision-Free"

    def verify_candidate_pair(
        self,
        suspect_image_bytes: bytes,
        reference_image_bytes: bytes,
        suspect_metadata: Optional[Dict[str, Any]] = None,
        reference_metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        raise NotImplementedError(
            "Muse vision provider is scaffolded for Phase 4. FixProof currently operates on Nemotron Super-VL."
        )


class MuseReasoningProvider(BaseReasoningProvider):
    """Scaffolded reasoning provider for Muse reasoning models."""

    @property
    def provider_name(self) -> str:
        return "muse"

    @property
    def model_id(self) -> str:
        return "meta-llama/Llama-3.3-70B-Instruct"

    def generate_investigation_report(
        self,
        investigation_input: Any,
        model_override: Optional[str] = None,
    ) -> Any:
        raise NotImplementedError(
            "Muse reasoning provider is scaffolded for Phase 4. FixProof currently operates on Nemotron Lightning."
        )
