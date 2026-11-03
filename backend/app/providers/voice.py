"""Meta recording ASR contract; no realtime, decoding conversion or speech synthesis."""
import io
import json
import os
import struct
import wave

from openai import AuthenticationError, PermissionDeniedError, APITimeoutError, APIConnectionError, RateLimitError, APIError

from app.providers.base import BaseVoiceProvider, TranscriptionResult
from app.providers.meta_client import DEFAULT_VOICE_MODEL, MetaAPIError, configured_timeout, get_meta_sdk_client

# Conservative client limits, below the documented 32 MB multipart request cap.
MAX_AUDIO_BYTES = 25 * 1024 * 1024
MAX_AUDIO_SECONDS = 600


class MetaVoiceProvider(BaseVoiceProvider):
    provider_name = property(lambda self: "muse")
    model_id = property(lambda self: os.getenv("MUSE_VOICE_MODEL", DEFAULT_VOICE_MODEL))

    def transcribe(self, audio_bytes: bytes, *, language_bias: list[str] | None = None) -> TranscriptionResult:
        if not isinstance(audio_bytes, bytes) or not audio_bytes:
            raise MetaAPIError("EMPTY_AUDIO")
        if len(audio_bytes) > MAX_AUDIO_BYTES:
            raise MetaAPIError("AUDIO_TOO_LARGE")
        try:
            with wave.open(io.BytesIO(audio_bytes), "rb") as audio:
                if (audio.getnchannels() != 1 or audio.getsampwidth() != 2
                        or audio.getframerate() not in (16000, 24000)
                        or audio.getcomptype() != "NONE"):
                    raise MetaAPIError("UNSUPPORTED_AUDIO_FORMAT")
                frames = audio.getnframes()
                if frames == 0:
                    raise MetaAPIError("EMPTY_AUDIO")
                if frames / audio.getframerate() > MAX_AUDIO_SECONDS:
                    raise MetaAPIError("AUDIO_TOO_LONG")
                if len(audio.readframes(frames)) != frames * 2:
                    raise MetaAPIError("INVALID_AUDIO")
        except MetaAPIError:
            raise
        except (wave.Error, EOFError, ValueError, struct.error):
            raise MetaAPIError("UNSUPPORTED_AUDIO_FORMAT") from None

        if language_bias is not None and (not isinstance(language_bias,list) or not language_bias or len(language_bias)>2
                or any(language not in ('English','Hindi') for language in language_bias)):
            raise MetaAPIError('INVALID_LANGUAGE_HINT')
        model = self.model_id.strip()
        if not model:
            raise MetaAPIError("INVALID_VOICE_MODEL")
        try:
            # Use the shared SDK's generic HTTP operation, NOT audio.transcriptions.
            client = get_meta_sdk_client().with_options(timeout=min(configured_timeout(45),45), max_retries=0)
            settings={"model":model,"audioEncoding":"WAV","mode":"PUSH_TO_TALK",
                      "keywords":["FixProof","Muse","SAM","Supabase","timestamps"]}
            if language_bias:settings['languageBias']=language_bias
            result = client.post("/asr/transcribe", cast_to=dict, body={}, files=[
                ("request", (None, json.dumps(settings), "application/json")),
                ("audio", ("recording.wav", audio_bytes, "audio/wav")),
            ], options={"headers": {"Content-Type": "multipart/form-data", "Accept": "application/json"}})
            if not isinstance(result, dict) or not isinstance(result.get("transcript"), str):
                raise MetaAPIError("INVALID_TRANSCRIPTION_RESPONSE")
            # No language identification field is documented by Meta's ASR contract.
            return TranscriptionResult(text=result["transcript"], provider=self.provider_name, model_id=model)
        except MetaAPIError:
            raise
        except (AuthenticationError, PermissionDeniedError):
            raise MetaAPIError("AUTHENTICATION_ERROR") from None
        except APITimeoutError:
            raise MetaAPIError("API_TIMEOUT") from None
        except RateLimitError:
            raise MetaAPIError("RATE_LIMIT_EXCEEDED") from None
        except APIConnectionError:
            raise MetaAPIError("CONNECTION_ERROR") from None
        except APIError:
            raise MetaAPIError("PROVIDER_API_ERROR") from None
        except Exception:
            raise MetaAPIError("INVALID_TRANSCRIPTION_RESPONSE") from None
