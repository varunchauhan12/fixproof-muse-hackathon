"""Offline SDK multipart contract and safe voice failure tests."""
import io
import json
import os
import unittest
import wave
from email.parser import BytesParser
from email.policy import default
from unittest.mock import patch

import httpx2
from openai import OpenAI
from app.providers import factory, meta_client
from app.providers.voice import MetaVoiceProvider


def wav(rate=16000, channels=1, width=2, frames=16):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as audio:
        audio.setparams((channels, width, rate, 0, "NONE", "not compressed"))
        audio.writeframes(b"\0" * frames * channels * width)
    return buf.getvalue()


class TestVoiceProvider(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.status = 200
        self.payload = {"transcript": "Review frame five.", "turns": [], "audioDurationMs": 1}
        self.failure = None
        def handler(request):
            self.calls.append(request)
            if self.failure:
                raise self.failure("dummy-secret", request=request)
            return httpx2.Response(self.status, json=self.payload)
        self.http = httpx2.Client(transport=httpx2.MockTransport(handler))
        self.client = OpenAI(api_key="dummy-secret", base_url="https://api.meta.ai/v1", http_client=self.http, max_retries=0)
        patcher = patch("app.providers.voice.get_meta_sdk_client", return_value=self.client)
        self.getter = patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.client.close)
        env = patch.dict(os.environ, {"FIXPROOF_AI_PROVIDER": "muse", "MUSE_VOICE_MODEL": "muse-voice-transcribe-1.0"})
        env.start()
        self.addCleanup(env.stop)

    def test_actual_sdk_serializes_meta_multipart_contract(self):
        audio = wav()
        result = factory.get_voice_provider().transcribe(audio)
        self.assertEqual(result.text, "Review frame five.")
        self.assertEqual(result.provider, "muse")
        self.assertEqual(result.model_id, "muse-voice-transcribe-1.0")
        self.assertIsNone(result.language)
        req = self.calls[0]
        self.assertEqual(str(req.url), "https://api.meta.ai/v1/asr/transcribe")
        self.assertEqual(req.headers["authorization"], "Bearer dummy-secret")
        self.assertEqual(req.headers["accept"], "application/json")
        msg = BytesParser(policy=default).parsebytes(b"Content-Type: " + req.headers["content-type"].encode() + b"\r\n\r\n" + req.content)
        parts = {p.get_param("name", header="content-disposition"): p for p in msg.iter_parts()}
        self.assertEqual(json.loads(parts["request"].get_payload(decode=True)), {"model": result.model_id, "audioEncoding": "WAV", "mode": "PUSH_TO_TALK", "keywords": ["FixProof","Muse","SAM","Supabase","timestamps"]})
        self.assertIsNone(parts["request"].get_filename())
        self.assertEqual(parts["audio"].get_payload(decode=True), audio)
        self.assertEqual(parts["audio"].get_content_type(), "audio/wav")
        self.assertEqual(len(self.calls), 1)

    def test_empty_corrupt_and_unsupported_audio_never_calls_client(self):
        for audio in (b"", b"mp3 data", wav(frames=0), wav(rate=44100), wav(channels=2), wav(width=1), wav()[:-4]):
            with self.subTest(size=len(audio)), self.assertRaises(meta_client.MetaAPIError):
                MetaVoiceProvider().transcribe(audio)
        self.getter.assert_not_called()

    def test_24khz_and_empty_transcript_are_valid(self):
        self.payload = {"transcript": ""}
        self.assertEqual(MetaVoiceProvider().transcribe(wav(rate=24000)).text, "")

    def test_response_validation(self):
        for payload in ({}, {"transcript": None}, {"text": "wrong schema"}, ["wrong schema"]):
            self.payload = payload
            with self.assertRaises(meta_client.MetaAPIError) as err:
                MetaVoiceProvider().transcribe(wav())
            self.assertEqual(err.exception.category, "INVALID_TRANSCRIPTION_RESPONSE")

    def test_safe_http_errors_no_retries(self):
        for status, category in ((401, "AUTHENTICATION_ERROR"), (403, "AUTHENTICATION_ERROR"), (429, "RATE_LIMIT_EXCEEDED"), (500, "PROVIDER_API_ERROR"), (400, "PROVIDER_API_ERROR")):
            self.status = status
            self.payload = {"error": {"message": "dummy-secret"}}
            self.calls.clear()
            with self.assertRaises(meta_client.MetaAPIError) as err:
                MetaVoiceProvider().transcribe(wav())
            self.assertEqual(err.exception.category, category)
            self.assertNotIn("dummy-secret", str(err.exception))
            self.assertEqual(len(self.calls), 1)

    def test_timeout_connection_errors(self):
        for failure, category in ((httpx2.ReadTimeout, "API_TIMEOUT"), (httpx2.ConnectError, "CONNECTION_ERROR")):
            self.failure = failure
            with self.assertRaises(meta_client.MetaAPIError) as err:
                MetaVoiceProvider().transcribe(wav())
            self.assertEqual(err.exception.category, category)

    def test_missing_key_safe(self):
        meta_client.get_meta_sdk_client.cache_clear()
        with patch("app.providers.voice.get_meta_sdk_client", meta_client.get_meta_sdk_client), patch.dict(os.environ, {"MODEL_API_KEY": ""}), patch.object(meta_client, "OpenAI") as sdk:
            with self.assertRaises(meta_client.MetaAPIError) as err:
                MetaVoiceProvider().transcribe(wav())
            sdk.assert_not_called()
        self.assertEqual(err.exception.category, "CLIENT_INITIALIZATION_ERROR")
        self.assertEqual(self.calls, [])

    def test_size_and_duration_bounds_before_client(self):
        from app.providers import voice
        with patch.object(voice, "MAX_AUDIO_BYTES", 10):
            with self.assertRaises(meta_client.MetaAPIError) as err:
                MetaVoiceProvider().transcribe(wav())
            self.assertEqual(err.exception.category, "AUDIO_TOO_LARGE")
        with patch.object(voice, "MAX_AUDIO_SECONDS", 0):
            with self.assertRaises(meta_client.MetaAPIError) as err:
                MetaVoiceProvider().transcribe(wav())
            self.assertEqual(err.exception.category, "AUDIO_TOO_LONG")
        self.getter.assert_not_called()

    def test_factory_rollback_selection_and_model_override(self):
        with self.assertRaises(ValueError):
            factory.get_voice_provider("nemotron")
        with patch.dict(os.environ, {"MUSE_VOICE_MODEL": "configured-voice-model"}):
            result = MetaVoiceProvider().transcribe(wav())
            self.assertEqual(result.model_id, "configured-voice-model")
        with patch.dict(os.environ, {"FIXPROOF_AI_PROVIDER": "nemotron"}):
            with self.assertRaises(ValueError): factory.get_voice_provider()
            self.assertEqual(factory.get_vision_provider().provider_name, "nemotron")

    def test_language_bias_uses_documented_multipart_field(self):
        MetaVoiceProvider().transcribe(wav(rate=24000),language_bias=['Hindi','English'])
        req=self.calls[0]
        msg=BytesParser(policy=default).parsebytes(b'Content-Type: '+req.headers['content-type'].encode()+b'\r\n\r\n'+req.content)
        part=next(p for p in msg.iter_parts() if p.get_param('name',header='content-disposition')=='request')
        self.assertEqual(json.loads(part.get_payload(decode=True))['languageBias'],['Hindi','English'])
        self.assertEqual(len(self.calls),1)

    def test_invalid_language_hint_never_initializes_transport(self):
        for hint in (['Invented'],[],['English','Hindi','English'],'English'):
            with self.subTest(hint=hint),self.assertRaises(meta_client.MetaAPIError):MetaVoiceProvider().transcribe(wav(),language_bias=hint)
        self.getter.assert_not_called()
