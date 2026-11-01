"""
Provider Abstraction Layer for FixProof (Phase 3.1).
Supports decoupled vision verification and forensic reasoning providers.
Default and primary implementation: Nemotron (NVIDIA Super-VL / Lightning via Nebius).
Scaffolded implementation: Muse (Meta Hackathon).
"""

from app.providers.factory import get_vision_provider, get_reasoning_provider, get_segmentation_provider
from app.providers.base import BaseVisionProvider, BaseReasoningProvider, BaseSegmentationProvider
from app.providers.base import BaseVoiceProvider, TranscriptionResult
from app.providers.factory import get_voice_provider

__all__ = [
    "get_voice_provider",
    "BaseVoiceProvider",
    "TranscriptionResult",
    "get_vision_provider",
    "get_reasoning_provider",
    "get_segmentation_provider",
    "BaseVisionProvider",
    "BaseReasoningProvider",
    "BaseSegmentationProvider",
]
