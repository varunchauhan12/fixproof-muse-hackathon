"""
Base classes for vision verification and forensic reasoning providers in FixProof.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


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
    ) -> Any:
        """
        Generates a structured, evidence-grounded investigation report from timeline clusters.
        """
        pass
