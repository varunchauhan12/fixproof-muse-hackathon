# Working Muse demo — voice, incident explanation and follow-up

This slice connects the existing transcription and conversation APIs. No mock mode
is part of the application. Automated tests use isolated fixtures/mocked providers.

## Open the demo

The dedicated local demo uses:
- Frontend: http://127.0.0.1:3001/muse
- Backend: http://127.0.0.1:8001
- Original backend/frontend on ports 8000/3000 remain separate.

Use the same existing client session as your investigation. Session storage is
origin-specific: a new port can have different localStorage. If the demo shows no
incidents, copy the existing dashboard's `session_id` query parameter to the demo
URL, or open it with `?session_id=<your-existing-session>`; the existing session
helper accepts that parameter. Do not create fake incidents to populate the demo.
The incident selector lists only exact-session records (maximum 25); latest is
resolved through the existing authorized latest tool when Send is pressed.

The dedicated backend serves voice/chat/incident-list/health routes only. Use the
original application to scan/upload/manage videos; its scan/vault/report routes
are intentionally absent from this demo entry point. The normal app.main also
registers the same new read-only incident-list route for later normal startup.

## Start without touching the original backend

Terminal 1:

```sh
cd ~/projects/fixproof-muse-hackathon/backend
.venv/bin/python -B -m uvicorn app.muse_demo:app --host 127.0.0.1 --port 8001 --no-access-log
```

This entry point reuses existing routers, manager, provider factory, tool registry
and retrieval functions. It does not import app.main or app.vault, expose report/
email/scan endpoints, or perform startup reconciliation. Its process-local database
manager sets and verifies transaction read-only on every PostgreSQL connection.
No production database/registry configuration or normal startup was changed.
Existing backend credentials/configuration are loaded normally, never hardcoded.
Local registry reads remain supported when local mode is configured.

Terminal 2 (production build, separate frontend port):

```sh
cd ~/projects/fixproof-muse-hackathon/frontend
NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 npm run build
cp -R .next/static .next/standalone/.next/
cp -R public .next/standalone/
PORT=3001 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

NEXT_PUBLIC_API_URL is a public build setting, so rebuilding is necessary when it
changes. No .env file edit is required. This uses the existing standalone output
configuration; the copies contain generated assets and existing public files.
For frontend development, after stopping any other `next dev` for this checkout:

```sh
NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 npm run dev -- --hostname 127.0.0.1 --port 3001
```

Only one Next development process should own this checkout's .next/dev directory.
The demo backend permits the existing configured CORS origins plus local port 3001.
Bind the demo services to localhost; this is not a production deployment recipe.

## Demo script

1. Open the demo with the existing investigation session. Select an incident or
   leave “Latest incident in this session”.
2. Press Record question and say: “Show me the latest incident and explain what
   happened.” Press Stop recording.
3. Review playback, then press Transcribe recording. The transcript appears in the
   editable composer. Edit recognition errors. Recording/transcription never sends
   a chat message automatically.
4. Press Send to Muse. Read the actual answer, citations, provider/model provenance
   and visible incident context.
5. Record/transcribe or type: “Can you explain the evidence in more detail?” Press
   Send. It reuses the same conversation ID, current revision and incident context.
6. For a clean incident ask: “Were there any candidate matches?” NO_MATCH is a valid
   recorded result, not suspicious evidence. For a positive incident ask about its
   measured timestamps; missing annotations must remain unknown.

Changing the incident starts a new conversation. Session-change events clear the
old UI and cancel pending audio responses. New conversation clears the chat only;
no database incident or report is deleted.

## Evidence correction

get_evidence_bundle now retains bounded valid frame observations across NO_MATCH,
SUSPECT_MATCH, CONFIRMED_MATCH and UNVERIFIED classifications, using the existing
normalizer. It returns stored/returned/classification counts, measured timestamps
and scores, bounded recorded vision annotations, SAM-annotation presence, recorded
limitations and existing investigation report summaries. No new visual descriptions
or analysis are created. Classification normalization is explicitly disclosed.

Positive timestamp correspondences remain a separate matching_evidence section.
Zero positive matches yields an empty matching frame/timeline list in a valid
bundle. Empty/malformed frame evidence still returns DATA_UNAVAILABLE. Existing
get_matching_timestamps retains its strict matching-only semantics. Missing reports
remain an empty list in a bundle; no reports are synthesized. Ownership and report
association checks run before data is returned. Follow-up cache authorization also
covers reports included in the new bundle. No PDF builder/vault dependency was added.

The existing grounding validator additionally recognizes the explicit
similarity_status field. It still checks citations against returned authorized
records, timestamp/evidence association, numeric values and status labels. The
three-tool/four-completion limits, no-retry behavior and safe diagnostics remain.

## UI and failure behavior

The /muse page has microphone/permission/conversion/transcription states, playback,
optional WAV upload, editable text, explicit Send, history, incident selection,
loading/error states and server provenance. Existing /voice-test uses the same
extracted recorder and transcription helper; it remains a standalone test page.

A synchronous client guard blocks duplicate Send actions. Successful replies advance
the local revision from the server response. On a conflict/provider/network error,
the client reads conversation history to recover the revision without retrying AI.
If recovery cannot complete, Check conversation is offered; requests do not silently
switch sessions or substitute a fake success. Text is retained for review on errors.
Backend errors may have already appended a user and failed assistant message.

## Files changed in this slice

Modified:
- backend/app/main.py — register exact-session Muse incident-list route.
- backend/app/muse_conversation_api.py — read-only incident selector endpoint.
- backend/app/muse_tools.py — valid zero-match bundles, observations and report projection.
- backend/app/muse_orchestrator.py — source classifications, negative-result guidance,
  and reauthorization of report context included in bundles.
- frontend/app/layout.tsx — link to the Muse assistant.
- frontend/app/voice-test/page.tsx — reuse extracted capture/transcription helpers.

Created:
- backend/app/muse_demo.py — separate local read-only voice/chat entry point.
- backend/tests/test_muse_demo.py — read-only connection and route/lifecycle tests.
- backend/tests/test_muse_vertical_slice.py — real routers/tools with mocked reasoning.
- frontend/app/muse/page.tsx — assistant interface.
- frontend/hooks/useVoiceRecorder.ts — existing recorder extracted for shared use.
- frontend/lib/muse-assistant.ts — API types, transcription helper and conversation client.
- frontend/tests/test_muse_assistant.mjs — offline client, recorder and UI-handler tests.
- docs/MUSE_DEMO_VERTICAL_SLICE.md — this guide.

All unrelated pre-existing Stage 3A–3D.1 changes are preserved.

## Verification and practical limits

Backend, from backend/:

```sh
.venv/bin/python -B -m unittest tests.test_muse_demo tests.test_muse_vertical_slice tests.test_muse_grounding_diagnostics tests.test_muse_orchestrator tests.test_muse_tools tests.test_muse_conversations tests.test_muse_conversation_api tests.test_voice_api tests.test_voice_provider
```

Result: 137 passed. Tests cover clean/positive/missing observations, isolation,
annotations, report associations, existing real routes and grounded follow-ups,
read-only connection verification, absent write/vault lifecycle, grounding,
revisions/concurrency and voice provider/API behavior. No live DB/model requests.

Frontend, from repository root:

```sh
node --test frontend/tests/test_muse_assistant.mjs frontend/tests/test_voice_audio.mjs
```

Result: 18 passed. The tests execute actual client/UI event handlers with isolated
hook/media/fetch fixtures, plus actual WAV encoding and backend format validation.
They cover transcript insertion, explicit Send, revisions, duplicate guards,
loading/errors, selected incident/session switches, capture/cleanup and follow-ups.
They are not a real browser/microphone/live inference acceptance test.

Frontend TypeScript and targeted ESLint pass. The existing layout font markup has
one pre-existing lint warning. Production build succeeds with /muse and /voice-test.
HTTP smoke checks verify the demo health/OpenAPI and frontend routes/assets without
performing inference or querying incident data. Original backend process stays up.

The complete live microphone → ASR → new evidence bundle → Muse → follow-up flow
still requires a manual browser test using real credentials and an existing session.
No live inference was made during this implementation. Previous ASR/live reasoning
checks do not substitute for testing this newly connected UI with a microphone.
Grounding remains conservative and can reject model output; failures are visible.
Only bounded stored evidence is described, never a fresh visual examination.
Conversations are ephemeral, single-process and page-local; leaving/reloading the
page starts a new UI conversation. No realtime streaming, TTS, email, PDFs, OAuth,
new persistence, schemas, providers or other excluded features were added.

No Supabase writes, reports, email, credential edits, commits, pushes or deployments.
