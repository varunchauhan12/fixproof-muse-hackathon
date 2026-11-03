"""Muse-only providers. Unsupported selectors fail explicitly; no fallback."""
import os
from typing import Optional
from app.providers.base import BaseVisionProvider, BaseReasoningProvider, BaseSegmentationProvider, BaseVoiceProvider
from app.providers.meta import MetaVisionProvider, MetaReasoningProvider
from app.providers.sam import MetaSAMProvider
from app.providers.voice import MetaVoiceProvider


def _selected(provider_name: Optional[str] = None) -> str:
    name = (provider_name if provider_name is not None else os.getenv("FIXPROOF_AI_PROVIDER", "muse")).strip().lower()
    if name != "muse":
        raise ValueError("Unsupported AI provider. Supported: muse")
    return name


def get_reasoning_provider(provider_name: Optional[str] = None) -> BaseReasoningProvider:
    _selected(provider_name)
    return MetaReasoningProvider()


def get_vision_provider(provider_name: Optional[str] = None) -> BaseVisionProvider:
    _selected(provider_name)
    return MetaVisionProvider()


def get_segmentation_provider(provider_name: Optional[str] = None) -> BaseSegmentationProvider:
    _selected(provider_name)
    return MetaSAMProvider()


def get_voice_provider(provider_name: Optional[str] = None) -> BaseVoiceProvider:
    _selected(provider_name)
    return MetaVoiceProvider()


def reasoning_is_configured(provider: BaseReasoningProvider) -> bool:
    """Check the selected provider credential without exposing it."""
    return provider.provider_name == "muse" and bool(os.getenv("MODEL_API_KEY", "").strip())
