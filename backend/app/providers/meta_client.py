"""Meta Model API transport. No environment-file loading, implicit credentials or retries."""
from functools import lru_cache
import math
import os
from urllib.parse import urlsplit

from openai import OpenAI, APITimeoutError, APIConnectionError, RateLimitError, APIError

DEFAULT_BASE_URL = "https://api.meta.ai/v1"
DEFAULT_MODEL = "muse-spark-1.3"


class MetaAPIError(RuntimeError):
    def __init__(self, category):
        self.category = category
        super().__init__(f"Meta request unavailable ({category}).")


def configured_timeout(default):
    try:
        value = float(os.getenv("MUSE_TIMEOUT_SEC", str(default)))
        if not math.isfinite(value) or value <= 0:
            raise ValueError
        return value
    except ValueError:
        raise MetaAPIError("CLIENT_INITIALIZATION_ERROR") from None


@lru_cache(maxsize=1)
def get_meta_sdk_client():
    key = os.getenv("MODEL_API_KEY", "").strip()
    if not key:
        raise MetaAPIError("CLIENT_INITIALIZATION_ERROR")
    base_url = os.getenv("MUSE_BASE_URL", DEFAULT_BASE_URL).strip()
    try:
        parsed = urlsplit(base_url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError
        return OpenAI(api_key=key, base_url=base_url, timeout=configured_timeout(90), max_retries=0)
    except Exception:
        raise MetaAPIError("CLIENT_INITIALIZATION_ERROR") from None


class MuseClient:
    def complete(self, request, timeout_sec=90, timeout_ceiling_sec=None):
        try:
            client = get_meta_sdk_client()
            timeout = configured_timeout(timeout_sec)
            if timeout_ceiling_sec is not None:
                timeout = min(timeout, timeout_ceiling_sec)
            response = client.with_options(timeout=timeout, max_retries=0).chat.completions.create(**request)
            if not response.choices:
                raise MetaAPIError("EMPTY_CHOICES")
            if response.choices[0].finish_reason == "length":
                raise MetaAPIError("TOKEN_BUDGET_EXHAUSTED")
            if response.choices[0].finish_reason != "stop" or not response.choices[0].message.content:
                raise MetaAPIError("EMPTY_CONTENT")
            return response
        except MetaAPIError:
            raise
        except APITimeoutError:
            raise MetaAPIError("API_TIMEOUT") from None
        except RateLimitError:
            raise MetaAPIError("RATE_LIMIT_EXCEEDED") from None
        except APIConnectionError:
            raise MetaAPIError("CONNECTION_ERROR") from None
        except APIError:
            raise MetaAPIError("PROVIDER_API_ERROR") from None
        except Exception:
            raise MetaAPIError("PROVIDER_API_ERROR") from None
