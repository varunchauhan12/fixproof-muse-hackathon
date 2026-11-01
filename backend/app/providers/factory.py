"""
Factory for resolving Vision and Reasoning providers in FixProof.
Defaults to 'nemotron' across all environments during Phase 3.1.
Configurable via environment variable: FIXPROOF_AI_PROVIDER
"""

import os
from typing import Optional

from app.providers.base import BaseVisionProvider, BaseReasoningProvider
from app.providers.nemotron import NemotronVisionProvider, NemotronReasoningProvider
from app.providers.meta import MetaVisionProvider, MetaReasoningProvider

_DEFAULT_PROVIDER = "nemotron"

_VISION_PROVIDERS = {
    "nemotron": NemotronVisionProvider,
    "muse": MetaVisionProvider,
}

_REASONING_PROVIDERS = {
    "nemotron": NemotronReasoningProvider,
    "muse": MetaReasoningProvider,
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
