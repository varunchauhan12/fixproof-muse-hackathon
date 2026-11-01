# Voice Intelligence — Step 2B

## Endpoint

POST /api/voice/transcribe accepts multipart field `file`, named with .wav suffix.
The route reads at most 25 MiB plus one byte, delegates audio/content/duration
validation and transcription to get_voice_provider().transcribe(), and closes the
upload in finally. Blocking provider work runs in FastAPI's worker thread pool.
No audio is written to application storage; multipart temporary files are closed.
The existing request-protection middleware and CORS still apply.

Example response (illustrative, not a new live request):

```json
{
  "success": true,
  "transcript": "Review the selected footage.",
  "provider": "muse",
  "model_id": "muse-voice-transcribe-1.0",
  "language": null
}
```

Missing upload: 422. Empty/truncated audio: 400. Unsupported extension, WAV encoding,
channels or sample rate: 415. Size/duration limit: 413. Configuration/unavailable
provider/rate limit: 503. Provider authentication, connection, response or API failure:
502. Timeout: 504. Errors contain success=false, a fixed error category and safe
detail; raw upstream text is never returned. Unexpected failures use a fixed 500.
WAV validation is reused from the provider, not duplicated in the API route.

## Manual interface and startup

http://127.0.0.1:3000/voice-test provides WAV selection, explicit Transcribe action,
loading/error/result states, and actual returned provider/model metadata. No upload
or inference occurs automatically. Accepted WAV is mono 16-bit PCM at 16/24 kHz,
at most 25 MiB and 10 minutes. Microphone recording/stop controls are not implemented:
browser MediaRecorder WebM/Opus cannot be passed as WAV, and no conversion dependency
was added. There is no chatbot, TTS, command execution or incident integration.

Backend (from backend directory):

```sh
./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Frontend (from frontend directory; existing dev script already selects webpack):

```sh
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Both are running in persistent terminal sessions. Backend health and frontend page
returned 200. Voice upload CORS preflight returned 200 and allowed the actual frontend
origin and session header. Browser inspection confirmed the test page, WAV picker
and initially disabled Transcribe button. The button was not clicked.

Existing backend MODEL_API_KEY is available. FIXPROOF_AI_PROVIDER=muse selects voice;
MUSE_VOICE_MODEL optionally overrides muse-voice-transcribe-1.0. Existing Meta base
URL configuration is reused. No environment changes are required for this checkout.
No .env modification or credential output occurred.

## Changed files in Step 2B

- backend/app/voice_api.py (new): dedicated APIRouter.
- backend/app/main.py: router import/registration only.
- backend/tests/test_voice_api.py (new): isolated API and cleanup tests.
- backend/tests/run_phase0a_checks.py: --voice-api option.
- frontend/app/voice-test/page.tsx (new): temporary manual testing page.
- docs/VOICE_STEP_2B.md (new): this delivery report.

All pre-existing uncommitted provider work was preserved. No existing investigation
workflow, database schema, model defaults or application persistence code changed.

## Verification

- Focused offline API suite: 8 passed, zero failures/errors/skips.
- Full offline backend suite: 358 run, 351 passed, 7 skipped, zero failures/errors.
- Production frontend build: passed, including TypeScript and all six static pages.
- Diff whitespace check: passed.

API tests cover mocked success, missing/empty/malformed/unsupported audio, size and
duration limits, configuration/authentication/timeout/connection/API/response errors,
unsupported provider selection, safe unexpected errors, response structure and upload
closure on success/failure. Existing provider tests run as part of the full suite.
The offline runner disables dotenv, strips credentials, and blocks socket connects.
No live integration scripts or wildcard frontend tests ran.

The configured database is Supabase. Before starting the actual application, a
read-only check confirmed no orphan snapshot vectors needing startup reconciliation.
No database records/schema were changed. Startup and page verification used only
health/page reads and CORS OPTIONS, not audio submission. No additional live Meta
requests, incident/report creation, Resend calls, commits, pushes or deployments.

The complete browser-to-live-Meta endpoint flow remains for the owner's manual test;
automated API validation is mocked. The earlier Step 2A direct provider smoke test
does not substitute for that new manual integration test. Stop here for feedback.
