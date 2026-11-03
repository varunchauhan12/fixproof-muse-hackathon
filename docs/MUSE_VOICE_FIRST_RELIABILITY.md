# Muse voice-first interaction, approved actions and chat stability

Validated 2026-11-03 in the active Meta repository. This supersedes the earlier direct-send/UI-only descriptions in the Copilot documents. No new provider, database schema, persistent conversation store or workflow framework was introduced.

## Root causes found

- Voice was press-and-hold, with overlapping mouse/touch/pointer handlers. Stopping automatically transcribed and submitted a command without an action review boundary.
- The old transcription timeout cleared the UI but did not abort the request; a late result could still submit after closing/switching context. A permission request stopped before resolution also needed generation-safe cleanup.
- Action dispatch depended on imperative phrase patterns. Broader requests had no validated semantic action-plan variant, and the system prompt still contradicted action support by describing all generation requests as outside read-only limits.
- Every `messages`/`busy` update called `scrollIntoView`, even while someone was reading history. The message scroll region lacked an explicit `min-height: 0`, and message entrance transforms added unnecessary movement around long artifact cards. Root height used `100vh` rather than the dynamic viewport.
- Registered-recipient chat sends previously treated clear wording as sufficient authorization. The new requirement adds a separate, exact, single-use approval before any send.

No artifact component was found using absolute/fixed positioning over individual messages. The persistent chat drawer is intentionally fixed; cards now remain in normal message flow, bounded by the message scroll container. Z-index values were not used as a workaround.

## Voice workflow

1. Click **Click to record** / accessible **Start voice recording**.
2. The existing recorder requests the microphone and shows the real permission/recording state, elapsed time and the existing sound-reactive bars.
3. Click the same control to stop. WAV conversion and the existing Muse Voice transcription happen automatically; there is no separate transcribe button.
4. The transcript appears in a review strip and as the conversation's user message. Muse interprets it but only proposes document/email actions.
5. Review the action card, then approve or cancel. **Edit and resubmit as text** cancels the prior proposal before using corrected text.
6. An approved document action returns the actual existing service output. An email is sent only by **Approve and Send** on its exact prepared card.

Capture/transcription cancellation is available while recording, converting or transcribing. Closing chat, page hide/unmount, session/incident changes and a new conversation discard capture and abort transcription. Generation/epoch checks suppress late permission results, conversion and network replies. Starting another recording cannot be disrupted by cleanup from an earlier aborted transcription. Transcription has a 45-second abort timeout, a one-shot submission guard, and empty/error states. Recording and meter resources remain owned by the existing shared recorder; no new microphone/provider implementation was added.

Ordinary text chat and optional Document Studio remain available. A grounded explanation uses the original read tools and does not create a report or send email.

## Natural-language understanding

The existing Muse JSON planner now accepts one additional validated `propose_action` variant:

```json
{
  "action": "propose_action",
  "intent": "send_registered",
  "confidence": 0.96,
  "incident_id": "existing-selected-incident"
}
```

Allowed intents are report/PDF, copyright notice, licensing proposal, professional summary, prepare email, registered PDF email, and reopen an editable draft. Explanation/investigation remains supported by the original answer/clarification/read-tool plans.

Confidence must be a finite number from 0 to 1; below 0.8 causes a short clarification question. A supplied incident must match the authorized selection. Unknown actions/extra fields are rejected. A bare **email** asks whether the user wants a draft or the current PDF emailed. Explicit “don't send” wording is constrained to drafting even if a model proposes sending.

Obvious existing non-email commands can take the bounded literal fast path. Flexible email/share/inbox phrasing uses the existing configured Muse model in the same planning loop; it does not add a separate classifier pass before that planner. A proposal can therefore be identified in one completion with no evidence-tool/model loop when enough context exists. Read explanations retain their existing tool and grounding budgets. No unrestricted function names, paths, arbitrary recipients or provider APIs are exposed to the model.

## Exact approval protocol

New routes reuse the existing conversation router and session dependency:

- `POST /api/muse/conversations/{conversation_id}/actions/{action_id}/approve`
- `POST /api/muse/conversations/{conversation_id}/actions/{action_id}/cancel`

The only decision parameters are `expected_revision` and `selected_incident_id`. The client cannot replace a recipient, body, subject or attachment in an approval request.

A pending proposal is process-local and tied to the session, conversation, selected incident, revision and a ten-minute expiry (conversation expiry can end it sooner). The manager atomically consumes/claims it before executing anything. Concurrent submissions and replay are rejected. A new user turn invalidates the prior pending proposal. Cancellation creates only conversation messages.

For email, the server resolves the latest usable saved report/PDF for that incident, reads `MUSE_REGISTERED_EMAIL`, prepares the cover note, and stores the exact report ID, recipient, subject, full body and PDF SHA-256 privately. The card displays the recipient, subject, body preview/full expandable text and exact attachment. No email address is invented or taken from arbitrary transcript text.

Approval rechecks session ownership, selected incident, report association, registered-recipient configuration and actual PDF bytes/hash. A changed PDF, report ownership or recipient fails closed. Resend configuration is checked during preparation and again at execution. Existing sending/audit functions are reused. Successful provider acceptance is reported as `ACCEPTED`, never delivery.

If no valid saved PDF exists, the first proposal offers to generate the report/PDF. Approving that step does not send anything. A separate exact email card follows for sending. Draft-only email preparation produces an editable draft without a send. Copyright/licensing attachments are not sent through this investigation-PDF approval path.

The obsolete immediate-send branch in `MuseActions.execute` was removed. Internal direct sending through that method now fails; only execution of the claimed prepared payload can submit a chat email. Existing manual document/email confirmation protections remain intact.

Failure/uncertain outcomes preserve the saved PDF and do not silently retry. Existing process-local duplicate-send protection is retained and bounded; in-flight entries are not evicted to admit another send. These protections are not durable exactly-once delivery across process restarts.

## Layout and state handling

- The conversation has one explicitly shrinkable `min-h-0` overflow region; composer/header remain anchored outside it.
- Message/artifact/approval cards stay in chronological normal flow with bounded width/overflow. Per-message entrance transforms were removed; drawer styling is preserved.
- The drawer uses `100dvh` for smaller screens.
- A near-bottom ref controls following new replies. Reading upward does not trigger forced scrolling. **New reply ↓** moves to the latest reply on demand.
- Session/incident/new-conversation epochs suppress obsolete asynchronous results and clear old proposals/edits. Session changes no longer reuse the previous session's selected incident hint.
- Old/consumed proposal cards remain readable as historical messages but their actions are inactive. Approval responses are validated by the client. Recovery reads history only; it never repeats an approval or send.

## Latency findings and measurements

Structural changes avoid duplicate pointer submissions, repeat transcription, a second intent-classifier pass, automatic report regeneration for email, repeated successful-conversation reloads, and unconditional scroll updates. Approval/cancellation do not rerun model intent detection. Existing report reuse and request/provider timeouts remain.

Measured live checks:

- A 5.2-second mono 16-bit 16kHz test WAV transcribed through `muse-voice-transcribe-1.0` in **3.0 seconds**.
- “Could you share the PDF with me?” returned a real `muse-wonder-1.0` email proposal in **2.99 seconds**, with zero evidence-tool calls. The planning loop ended after its intent result; no report generation or email sending was performed. Cancelling completed successfully.

These are individual smoke measurements, not controlled benchmarks. No before/after latency baseline was recorded, so no percentage speedup or general latency reduction is claimed.

## Tests actually executed

Core backend — **202 passed**:

```sh
cd backend
.venv/bin/python -B -m unittest tests.test_muse_approvals tests.test_muse_actions tests.test_muse_orchestrator tests.test_muse_tools tests.test_muse_conversations tests.test_muse_conversation_api tests.test_temporal_evidence tests.test_temporal_evidence_api tests.test_temporal_consumers tests.test_sam_workspace tests.test_sam_scene tests.test_sam_provider tests.test_voice_api tests.test_voice_provider
```

Includes bounded intent/confidence/context validation, all seven supplied email phrasings, no send on proposal/cancel, exact recipient/content/PDF binding, missing/corrupt PDF handling, expiry, session mismatch, request tampering, changed recipient/PDF, concurrent/replayed approvals, provider failure and uncertain outcome, plus existing grounding, P3, SAM and voice regressions. Equivalent-phrasing unit tests use mocked structured model plans; they do not prove general live model accuracy.

Existing isolated report/PDF/email suite — **42 passed**:

```sh
cd backend
.venv/bin/python -B -m tests.run_copilot_offline
```

The report harness uses temporary storage and blocks real network access. Email operations are mocked; no real Resend request is made by automated tests.

Frontend — **88 passed**:

```sh
node --test frontend/tests/test_floating_muse_chat.mjs frontend/tests/test_muse_assistant.mjs frontend/tests/test_muse_workflows.mjs frontend/tests/test_voice_audio.mjs frontend/tests/test_voice_meter.mjs frontend/tests/test_temporal_evidence.mjs frontend/tests/test_sam_workspace.mjs frontend/tests/test_investigation_workspace.mjs frontend/tests/test_forensic_evidence_experience.mjs
```

Includes click/start/stop, automatic transcription/review, cancellation of late transcription, permission failure, empty transcript, approval/cancellation dispatch, duplicate clicks, actual component containment, scroll-up stability and late responses after switching incidents.

Production build, TypeScript and targeted lint passed; `git diff --check` passed. No wildcard/live integration test script was run.

## Live browser and API verification

Used an actual existing incident/session and the actual localhost backend/frontend:

- “I need a copy of this investigation in my inbox.” produced a real model-classified exact email approval card. Cancel returned a cancellation result without sending.
- A bare “email” produced the expected short clarification question.
- “Just explain what you found.” returned a real grounded, cited explanation of the existing sampled frames, with no new document or email action.
- A locally synthesized, non-sensitive test WAV was submitted once to the real transcription endpoint. The actual returned transcript (“can you look at at this investigation? prepare the report and email me a copy?”) was then entered into the real browser chat; the real model recognized it and produced the email approval. No send was approved.
- Clicking the real microphone entered the browser permission state. Cancel returned it to idle. Microphone permission did not complete in the automation browser; no room audio was uploaded.
- “Make a copyright notice for this.” produced a proposal; **Approve action** returned the actual editable existing-template draft.
- Browser history scrollTop stayed **0 → 0** when a new proposal arrived while history was scrolled upward; the **New reply** indicator appeared. The log content grew from 1056px to 1457px while its reading position remained stable.
- At a **390px** viewport, the dialog measured **366px**, all cards stayed within it, and measured card overlap was false. Desktop card-overlap checks also returned false.
- Zero console errors were observed in the saved approval/result verification.

Evidence images: `docs/MUSE_VOICE_FIRST_APPROVAL.jpg` and `docs/MUSE_VOICE_FIRST_RESULT.jpg`. They deliberately show a rights-document example rather than persisting the configured recipient address in repository screenshots.

### What remains unverified

Full physical-microphone speech → browser transcription has not been verified because the automation browser remained at microphone permission. The live WAV/API transcription, actual transcript intent recognition, browser recording/cancel controls, and approved draft execution were verified separately; this is not presented as a complete physical-microphone end-to-end run.

Real email sending was not approved or exercised in this validation. Fixed-recipient dispatch, exact attachments and provider outcomes were tested with mocks. Resend sender/account/recipient eligibility and actual delivery remain unverified. No email was sent during browser testing.

## Files changed for this step

- `backend/app/muse_actions.py`
- `backend/app/muse_conversations.py`
- `backend/app/muse_conversation_api.py`
- `backend/app/muse_orchestrator.py`
- `backend/tests/test_muse_actions.py`
- `backend/tests/test_muse_approvals.py`
- `frontend/components/muse/FloatingMuseChat.tsx`
- `frontend/components/muse/MuseApprovalCard.tsx`
- `frontend/components/muse/MuseArtifactView.tsx`
- `frontend/lib/muse-assistant.ts`
- `frontend/tests/test_floating_muse_chat.mjs`
- `frontend/tests/test_muse_workflows.mjs`
- `docs/MUSE_VOICE_FIRST_RELIABILITY.md`
- `docs/MUSE_VOICE_FIRST_APPROVAL.jpg`
- `docs/MUSE_VOICE_FIRST_RESULT.jpg`
- Current-workflow notices in `docs/MUSE_COPILOT_2_IMPLEMENTATION.md` and `docs/MUSE_NATURAL_LANGUAGE_ACTIONS_IMPLEMENTATION.md`.

Existing metering/recording, report/PDF/Resend, P1/P2/P3 work and unrelated changes were preserved. No environment credentials, database schemas, incident/evidence records, protected repositories or cloud settings were changed in this step. The only live external inference was the explicitly tested Muse operations; no enforcement or email actions occurred.

Git note: work began on `main` at `59b7c7d` with uncommitted work. An external process created checkpoint `2da94ab` during this step, including work already in progress. This task did not issue stage/commit/push/deploy/branch-change commands and preserved that external checkpoint. Remaining changes are shown by the final Git status; they were not committed by this task.
