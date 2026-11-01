"""Bounded recording upload API. Meta request construction remains in the provider."""
from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

from app.providers.factory import get_voice_provider
from app.providers.meta_client import MetaAPIError
from app.providers.voice import MAX_AUDIO_BYTES

router = APIRouter(prefix="/api/voice", tags=["voice"])

ERRORS = {
    "EMPTY_AUDIO": (400, "Supply a nonempty WAV recording."),
    "UNSUPPORTED_AUDIO_FORMAT": (415, "Use mono, 16-bit PCM WAV at 16 or 24 kHz."),
    "INVALID_AUDIO": (400, "The WAV recording is malformed or truncated."),
    "AUDIO_TOO_LARGE": (413, "Audio exceeds the 25 MiB upload limit."),
    "AUDIO_TOO_LONG": (413, "Audio exceeds the 10-minute duration limit."),
    "CLIENT_INITIALIZATION_ERROR": (503, "Voice credentials or configuration are unavailable."),
    "INVALID_VOICE_MODEL": (503, "The voice model is not configured."),
    "AUTHENTICATION_ERROR": (502, "The transcription provider rejected the server credentials."),
    "API_TIMEOUT": (504, "The transcription provider timed out."),
    "RATE_LIMIT_EXCEEDED": (503, "The transcription provider is busy. Try later."),
    "CONNECTION_ERROR": (502, "Unable to connect to the transcription provider."),
    "INVALID_TRANSCRIPTION_RESPONSE": (502, "The transcription provider returned an invalid response."),
    "PROVIDER_API_ERROR": (502, "The transcription provider request failed."),
    "VOICE_UNAVAILABLE": (503, "The selected provider does not support voice transcription."),
}


@router.post("/transcribe")
def transcribe_audio(file: UploadFile = File(...)):
    """Runs in FastAPI's worker pool; always closes the multipart temporary file."""
    try:
        if not file.filename or not file.filename.lower().endswith(".wav"):
            raise MetaAPIError("UNSUPPORTED_AUDIO_FORMAT")
        audio = file.file.read(MAX_AUDIO_BYTES + 1)
        if len(audio) > MAX_AUDIO_BYTES:
            raise MetaAPIError("AUDIO_TOO_LARGE")
        try:
            provider = get_voice_provider()
        except ValueError:
            raise MetaAPIError("VOICE_UNAVAILABLE") from None
        result = provider.transcribe(audio)
        return {"success": True, "transcript": result.text, "provider": result.provider,
                "model_id": result.model_id, "language": result.language}
    except MetaAPIError as exc:
        status, message = ERRORS.get(exc.category, ERRORS["PROVIDER_API_ERROR"])
        return JSONResponse({"success": False, "error": exc.category if exc.category in ERRORS else "PROVIDER_API_ERROR",
                             "detail": message}, status_code=status)
    except Exception:
        return JSONResponse({"success": False, "error": "TRANSCRIPTION_FAILED",
                             "detail": "Unable to process the audio recording."}, status_code=500)
    finally:
        file.file.close()
