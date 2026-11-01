"""
Base classes for vision verification and forensic reasoning providers in FixProof.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from dataclasses import dataclass


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    provider: str
    model_id: str
    language: Optional[str] = None


class BaseVoiceProvider(ABC):
    """Recording transcription only; implementations raise safe categorized errors."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        pass

    @property
    @abstractmethod
    def model_id(self) -> str:
        pass

    @abstractmethod
    def transcribe(self, audio_bytes: bytes) -> TranscriptionResult:
        pass


class BaseVisionProvider(ABC):
    """Abstract interface for paired vision verification models."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Returns the identifier name of this provider (e.g. 'nemotron', 'muse')."""
        pass

    @property
    @abstractmethod
    def model_id(self) -> str:
        """Returns the specific model identifier (e.g. 'nvidia/Nemotron-3.5-Super-VL')."""
        pass

    @abstractmethod
    def verify_candidate_pair(
        self,
        suspect_image_bytes: bytes,
        reference_image_bytes: bytes,
        suspect_metadata: Optional[Dict[str, Any]] = None,
        reference_metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Performs objective, pairwise visual verification between suspect and reference frames.
        Returns validated structured dictionary containing visual_correspondence,
        matching_features, contradictions, reasoning, and uncertainty_factors.
        """
        pass


class BaseReasoningProvider(ABC):
    """Abstract interface for forensic investigation report generation models."""

    def create_text_completion(
        self,
        request: Dict[str, Any],
        client_options: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Complete existing drafting/diagnostic requests without changing their schemas.

        client_options preserves legacy callers' explicit client settings. Providers
        which do not implement text completion must fail explicitly.
        """
        raise NotImplementedError("Text completion is unavailable for this provider")

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Returns the identifier name of this provider."""
        pass

    @property
    @abstractmethod
    def model_id(self) -> str:
        """Returns the primary reasoning model identifier."""
        pass

    @abstractmethod
    def generate_investigation_report(
        self,
        investigation_input: Any,
        model_override: Optional[str] = None,
        frame_images: Optional[List[Dict[str, Any]]] = None,
    ) -> Any:
        """
        Generates a structured, evidence-grounded investigation report from timeline clusters.
        """
        pass


class BaseSegmentationProvider(ABC):
    """Abstract interface for specialist visual segmentation/localization models (SAM 3.1)."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Returns the identifier name of this provider (e.g. 'muse')."""
        pass

    @property
    @abstractmethod
    def model_id(self) -> str:
        """Returns the specific model identifier (e.g. 'sam-3.1')."""
        pass

    @abstractmethod
    def segment_frame(
        self,
        image_bytes: bytes,
        prompt: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """
        Performs visual concept segmentation/localization on a single frame.
        Returns a normalized, typed SegmentationResult.
        """
        pass
