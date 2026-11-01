# Stage 2, Step 1 — isolated voice provider

BaseVoiceProvider.transcribe(audio_bytes) returns a frozen TranscriptionResult:
text, provider, model_id, language. MetaVoiceProvider lives in providers/voice.py,
alongside the existing specialist SAM module. get_voice_provider resolves explicit
selection or FIXPROOF_AI_PROVIDER, with muse as its voice-only default. Unsupported
providers, including Nemotron, raise ValueError; no fallback occurs. Existing
vision/reasoning selection and implementation are unchanged.

Contract checked against https://dev.meta.ai/docs/speech-to-text on November 1, 2026:
POST /v1/asr/transcribe with Bearer authentication, multipart JSON request settings
and audio file, WAV encoding and PUSH_TO_TALK mode. The response transcript is
normalized to text. Language is null because no identification field is documented.
Only mono 16-bit PCM WAV at 16/24 kHz is accepted. Other formats require conversion
outside this layer. The generic shared SDK client's POST is used; the OpenAI audio
transcriptions endpoint is not used. No live request or entitlement check occurred.

Client policy: 25 MiB audio cap, 600-second duration cap, existing configured timeout
(90 seconds by default), zero retries. Structural WAV validation rejects corrupt,
truncated, empty, unsupported or oversized input before client initialization.
Valid silence may produce an empty transcript. Typed MetaAPIError categories expose
no upstream error text. Missing credentials, authentication, timeout, connection,
rate-limit, API and malformed-response failures are handled explicitly.

Changed files:
- backend/app/providers/base.py
- backend/app/providers/voice.py (new)
- backend/app/providers/meta_client.py
- backend/app/providers/factory.py
- backend/app/providers/__init__.py
- backend/.env.example
- backend/tests/test_voice_provider.py (new)
- backend/tests/run_phase0a_checks.py
- docs/VOICE_PROVIDER_STEP_1.md (new)

Verification: --voice passed 9 tests. Existing focused provider/factory suite passed
91 tests. Final full suite: 350 run, 343 passed, 7 skipped, zero failures/errors.
All used the disposable offline runner with dotenv disabled,
credentials cleared, dummy keys and external socket connections blocked. Tests
check actual SDK multipart serialization using MockTransport, not just call arguments.

Compatibility limits: public documentation supports the wire contract; account
access, accuracy and live latency remain unverified. The SDK generic POST helper is
lower-level than a model-specific API and must retain serialization regression
coverage on SDK upgrades. No language is inferred from hints or transcript text.
The prior voice architecture audit was not found in this checkout; no claim of
audit-specific parity is made. No frontend, route, TTS, database, dependency, real
environment, application-process or protected-repository changes. No commit/push.
