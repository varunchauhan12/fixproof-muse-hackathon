# Chat microphone capture and transcription repair

Implemented locally on 2026-11-03. Existing summary repairs, untracked P4.2 audit, unrelated chat edits and prior uncommitted recording improvements were preserved. No dependency installation, environment edit, provider migration, commit, push or deployment was performed.

## Findings and changes

- The chat did not name the input device or offer microphone selection. It now lists permitted audio inputs after access is granted, shows the actual active track label, reports mute/disconnection, and retains the selected device in component state only. Device identifiers and labels are not logged or sent to the backend.
- A default-input constraint failure may use a basic microphone request, but permission denial and selected-device failure do not silently retry or switch microphones.
- The input meter's absolute threshold hid quiet signals. Metering now uses a lower noise floor and logarithmic scaling, with bars still driven solely by measured audio. This is sound-level feedback, not a claim of semantic speech detection. Quiet-background and zero-input cases are covered offline.
- The meter context is created/resumed from the recording click before the permission await. The same context is reused for the analyser; failure to run a meter does not prevent recording or fake activity.
- Existing final-data flushing and shorter recorder chunks were retained. Tracks are released after the recorder's final stop/data events. A late old stop callback cannot release a newer capture. Permission, conversion and transcription have separate UI feedback.
- An unanswered microphone permission request now produces actionable guidance after 20 seconds instead of appearing to wait forever. Cancel/unmount/timeout discard late permissions and stop any late-arriving stream.
- Browser recording conversion now uses mono, 16-bit PCM WAV at 24 kHz. Existing direct 16 kHz encoding/upload compatibility remains. Zero/DC-only recordings are rejected locally with microphone/input-volume guidance before upload. Existing bounded gain normalization was preserved.
- Chat captures are capped at 60 seconds for short commands. The existing file-upload/provider limits remain independent. The last clip is available for local playback after transcription until a new capture, cancellation, context switch or close discards it; nothing auto-plays.

## Model/API contract

The model remains the existing dedicated `muse-voice-transcribe-1.0`, not a general-purpose reasoning/vision model. Current official documentation lists this transcription model and documents the existing multipart `/v1/asr/transcribe` path. Native audio rate, vocabulary keywords and language-bias fields were checked against [Meta's speech-to-text documentation](https://dev.meta.ai/docs/speech-to-text).

The UI offers automatic language detection, English, Hindi and Hindi + English hints. Only explicit selections add `languageBias` to the multipart JSON request; auto mode does not force English. A fixed small vocabulary list supplies FixProof terminology. Hints are not guarantees or translation instructions. No detected-language value is invented; the existing `language` response remains null where the contract supplies no identification field.

The specialist provider retains zero automatic retries and sanitized errors. Its timeout is bounded at 45 seconds, while chat allows 50 seconds for response transit. This is a timeout bound, not a latency guarantee. Realtime streaming was not introduced, and API credentials remain server-side.

## Verification

- Focused voice/provider/factory checks: **25 passed**.
- Final explicit offline backend regression list: **240 passed** (voice, summaries, chat/actions/tools, temporal and SAM). Voice wire-contract tests use HTTP MockTransport and inspect the actual SDK multipart encoding, including language hints; no live inference occurs in these unit tests.
- Final explicit frontend list: **108 passed**, including microphone choice/errors, permission timeout and late-stream cleanup, final-chunk release ordering, stale stop callback protection, meter behavior, native WAV encoding, local silence rejection, language-hint propagation and existing chat workflows.
- TypeScript, targeted ESLint, production frontend build and diff whitespace validation passed.
- Exactly one live ASR smoke request used an outside-repository, locally synthesized non-sensitive 3.06-second recording, mono PCM 24 kHz. Through the actual backend endpoint with the Hindi + English hint, it returned HTTP 200 in **2.69 seconds**, provider `muse`, model `muse-voice-transcribe-1.0`, transcript: “FixProof show the matching timestamps.” Temporary audio was deleted after testing; no retry, report generation or email was triggered.
- Browser confirmed microphone and language controls plus capture/cancel states. The automation browser remained pending at microphone permission; it was canceled without uploading room audio. Physical microphone capture, accent accuracy, Hindi accuracy and device-specific noise conditions still require the user's test. A synthetic-file smoke test does not establish those properties or perfect transcription.

## User check

Open the local dashboard in a browser that can grant microphone access. Open Muse, click Record and allow Microphone. If no prompt is available in the in-app browser, open the same URL in Chrome or Safari. Choose the actual headset/computer input once device names appear. While recording, verify the named input and “Sound is reaching the microphone” feedback. Stop and listen to the playback if transcription is wrong. If playback is silent, check that microphone's physical mute, system input level and browser/system permission before changing the model. Choose Hindi + English when appropriate; otherwise leave automatic detection enabled.

Proof image: `docs/MUSE_MICROPHONE_REPAIR.png`.

## Files touched by this repair

- `backend/app/providers/base.py`
- `backend/app/providers/voice.py`
- `backend/app/voice_api.py`
- `backend/tests/test_voice_provider.py`
- `backend/tests/test_voice_api.py`
- `frontend/hooks/useVoiceRecorder.ts`
- `frontend/lib/voice-input.ts` (new)
- `frontend/lib/voice-audio.ts`
- `frontend/lib/voice-meter.ts`
- `frontend/lib/muse-assistant.ts`
- `frontend/components/muse/FloatingMuseChat.tsx`
- `frontend/tests/test_voice_input.mjs` (new)
- `frontend/tests/test_voice_audio.mjs`
- `frontend/tests/test_voice_meter.mjs`
- `frontend/tests/test_muse_assistant.mjs`
- This document and its proof image.

Unrelated environment-template and assistant-prompt changes also appeared during this session; they were preserved and are not authored by this microphone repair.
