"""Offline route tests; no model calls, database or application startup."""
import io
import unittest
from unittest.mock import patch, Mock
from fastapi import FastAPI, UploadFile
from fastapi.testclient import TestClient
from app import voice_api
from app.providers.base import TranscriptionResult
from app.providers.meta_client import MetaAPIError
from app.providers.voice import MetaVoiceProvider
from tests.test_voice_provider import wav


class TestVoiceAPI(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(voice_api.router)
        self.client = TestClient(app)

    def send(self, data=None, name="test.wav"):
        return self.client.post("/api/voice/transcribe", files={"file": (name, wav() if data is None else data, "audio/wav")})

    def test_success_schema_and_no_implicit_extra_calls(self):
        provider = Mock()
        provider.transcribe.return_value = TranscriptionResult("Review footage", "muse", "muse-voice-transcribe-1.0")
        with patch.object(voice_api, "get_voice_provider", return_value=provider):
            response = self.send()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"success": True, "transcript": "Review footage", "provider": "muse", "model_id": "muse-voice-transcribe-1.0", "language": None})
        provider.transcribe.assert_called_once_with(wav())

    def test_missing_file(self):
        self.assertEqual(self.client.post("/api/voice/transcribe").status_code, 422)

    def test_invalid_audio_rejected_before_transport(self):
        with patch.object(voice_api, "get_voice_provider", return_value=MetaVoiceProvider()), patch("app.providers.voice.get_meta_sdk_client") as sdk:
            for data, name, status in ((b"", "empty.wav", 400), (b"corrupt", "bad.wav", 415), (wav(), "audio.webm", 415), (wav(rate=44100), "bad.wav", 415), (wav()[:-4], "truncated.wav", 400)):
                with self.subTest(name=name): self.assertEqual(self.send(data, name).status_code, status)
            sdk.assert_not_called()

    def test_upload_size_limit(self):
        with patch.object(voice_api, "MAX_AUDIO_BYTES", 10), patch.object(voice_api, "get_voice_provider") as provider:
            self.assertEqual(self.send(b"x" * 11).status_code, 413)
            provider.assert_not_called()

    def test_duration_limit(self):
        with patch.object(voice_api, "get_voice_provider", return_value=MetaVoiceProvider()), patch("app.providers.voice.MAX_AUDIO_SECONDS", 0):
            self.assertEqual(self.send().status_code, 413)

    def test_safe_provider_errors(self):
        for category, status in (("AUTHENTICATION_ERROR", 502), ("CLIENT_INITIALIZATION_ERROR", 503), ("API_TIMEOUT", 504), ("PROVIDER_API_ERROR", 502), ("INVALID_TRANSCRIPTION_RESPONSE", 502), ("CONNECTION_ERROR", 502), ("RATE_LIMIT_EXCEEDED", 503)):
            provider = Mock()
            provider.transcribe.side_effect = MetaAPIError(category)
            with self.subTest(category=category), patch.object(voice_api, "get_voice_provider", return_value=provider):
                response = self.send()
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.json()["error"], category)
                self.assertFalse(response.json()["success"])

    def test_unsupported_provider_and_unexpected_error_safe(self):
        for error, status in ((ValueError("dummy-secret"), 503), (RuntimeError("dummy-secret"), 500)):
            with patch.object(voice_api, "get_voice_provider", side_effect=error):
                response = self.send()
                self.assertEqual(response.status_code, status)
                self.assertNotIn("dummy-secret", response.text)

    def test_upload_closed_on_success_and_failure(self):
        for outcome in (TranscriptionResult("", "muse", "test"), MetaAPIError("API_TIMEOUT")):
            provider = Mock()
            if isinstance(outcome, Exception): provider.transcribe.side_effect = outcome
            else: provider.transcribe.return_value = outcome
            stream = io.BytesIO(wav())
            with patch.object(voice_api, "get_voice_provider", return_value=provider):
                result=voice_api.transcribe_audio(UploadFile(filename="test.wav", file=stream))
                if isinstance(outcome,TranscriptionResult):
                    self.assertTrue(result["success"]);provider.transcribe.assert_called_once_with(wav())
            self.assertTrue(stream.closed)

    def test_supported_language_hint_forwarded_without_claiming_detected_language(self):
        provider=Mock();provider.transcribe.return_value=TranscriptionResult('Review footage','muse','muse-voice-transcribe-1.0')
        with patch.object(voice_api,'get_voice_provider',return_value=provider):
            response=self.client.post('/api/voice/transcribe',files={'file':('test.wav',wav(),'audio/wav')},data={'language':'en-hi'})
        self.assertEqual(response.status_code,200);self.assertIsNone(response.json()['language'])
        provider.transcribe.assert_called_once_with(wav(),language_bias=['Hindi','English'])

    def test_unknown_language_rejected_without_provider_call(self):
        with patch.object(voice_api,'get_voice_provider') as factory:
            response=self.client.post('/api/voice/transcribe',files={'file':('test.wav',wav(),'audio/wav')},data={'language':'invented'})
        self.assertEqual(response.status_code,422);factory.assert_not_called()
