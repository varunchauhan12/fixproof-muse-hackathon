"""
Provider Abstraction Layer for FixProof (Phase 3.1).
Supports decoupled vision verification and forensic reasoning providers.
Default and primary implementation: Nemotron (NVIDIA Super-VL / Lightning via Nebius).
Scaffolded implementation: Muse (Meta Hackathon).
"""

from app.providers.factory import get_vision_provider, get_reasoning_provider
from app.providers.base import BaseVisionProvider, BaseReasoningProvider

__all__ = [
    "get_vision_provider",
    "get_reasoning_provider",
    "BaseVisionProvider",
    "BaseReasoningProvider",
]
