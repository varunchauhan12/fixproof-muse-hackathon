"""
Factory for resolving Vision and Reasoning providers in FixProof.
Defaults to 'nemotron' across all environments during Phase 3.1.
Configurable via environment variable: FIXPROOF_AI_PROVIDER
"""

import os
from typing import Optional

from app.providers.base import BaseVisionProvider, BaseReasoningProvider, BaseSegmentationProvider
from app.providers.nemotron import NemotronVisionProvider, NemotronReasoningProvider
from app.providers.meta import MetaVisionProvider, MetaReasoningProvider
from app.providers.sam import MetaSAMProvider

_DEFAULT_PROVIDER = "nemotron"

_VISION_PROVIDERS = {
    "nemotron": NemotronVisionProvider,
    "muse": MetaVisionProvider,
}

_REASONING_PROVIDERS = {
    "nemotron": NemotronReasoningProvider,
    "muse": MetaReasoningProvider,
}

_SEGMENTATION_PROVIDERS = {
    "muse": MetaSAMProvider,
}


def get_vision_provider(provider_name: Optional[str] = None) -> BaseVisionProvider:
    """
    Returns an instantiated vision verification provider.
    Defaults to FIXPROOF_AI_PROVIDER environment variable, or 'nemotron'.
    """
    name = (provider_name or os.getenv("FIXPROOF_AI_PROVIDER", _DEFAULT_PROVIDER)).strip().lower()
    provider_cls = _VISION_PROVIDERS.get(name)
    if not provider_cls:
        raise ValueError(
            f"Unsupported vision provider '{name}'. Supported: {sorted(_VISION_PROVIDERS.keys())}"
        )
    return provider_cls()


def get_reasoning_provider(provider_name: Optional[str] = None) -> BaseReasoningProvider:
    """
    Returns an instantiated forensic reasoning provider.
    Defaults to FIXPROOF_AI_PROVIDER environment variable, or 'nemotron'.
    """
    name = (provider_name or os.getenv("FIXPROOF_AI_PROVIDER", _DEFAULT_PROVIDER)).strip().lower()
    provider_cls = _REASONING_PROVIDERS.get(name)
    if not provider_cls:
        raise ValueError(
            f"Unsupported reasoning provider '{name}'. Supported: {sorted(_REASONING_PROVIDERS.keys())}"
        )
    return provider_cls()


def reasoning_is_configured(provider: BaseReasoningProvider) -> bool:
    """Check only the selected provider's credential, without returning it."""
    key_name = "MODEL_API_KEY" if provider.provider_name == "muse" else "NEBIUS_API_KEY"
    return bool(os.getenv(key_name, "").strip())


def get_segmentation_provider(provider_name: Optional[str] = None) -> BaseSegmentationProvider:
    """
    Returns an instantiated specialist visual segmentation provider (SAM 3.1).
    Defaults to 'muse'.
    """
    name = (provider_name or os.getenv("FIXPROOF_AI_PROVIDER", "muse")).strip().lower()
    # If set to nemotron or other, fall back to muse as SAM is a Meta capability
    provider_cls = _SEGMENTATION_PROVIDERS.get(name) or _SEGMENTATION_PROVIDERS.get("muse")
    if not provider_cls:
        raise ValueError(f"No segmentation provider available for '{name}'.")
    return provider_cls()
