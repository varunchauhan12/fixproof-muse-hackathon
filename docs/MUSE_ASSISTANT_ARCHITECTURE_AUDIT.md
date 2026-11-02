# Stage 3, Step 3A — Muse conversational assistant architecture audit

Date: November 1, 2026. Baseline: 5ddfeb19354c9cd896d9fe427350bb9e2a0fbade.
Method: source inspection only. Working tree was clean on entry. This requested
report is the only new file; no code/configuration/environment/dependency/data
changes, tests, application imports, network requests, inference, email, process
restarts, commit or push were performed. Creating this report is the explicit
exception to the request to preserve a clean tree. No operational email or model
availability was checked during this audit.

## 1. Verified existing architecture

### Incident creation, storage and retrieval

- `backend/app/main.py:759` scan_suspect_video performs uploaded-video extraction,
  matching and persistence synchronously. `:885` screen_video_url_endpoint invokes
  the existing URL-screening workflow; that workflow is preliminary preview analysis,
  not guaranteed acquisition/analysis of an entire remote video.
- `backend/app/registry.py:568` save_incident persists cloud incident columns plus
  cv_evidence_dossier JSON, or local storage/incidents.json. Dossier includes frame
  matches, submitted asset identity, limitations and workflow information. Database
  selection comes from `backend/app/db.py:74`; local persistence is JSON/filesystem,
  not SQLite. Do not infer database mode from frontend branding.
- `registry.py:385` load_incidents orders PostgreSQL results by scanned_at DESC,
  limits the list to 200 and applies conditional session filtering. Local records
  are sorted by scanned_at strings. The first permitted item is the current practical
  meaning of latest; a future tool should define stable ordering by timestamp and
  incident ID, distinguish latest scan from latest reasoning report, and disclose
  list limits. Never let Muse invent which incident is latest.
- `main.py:940` GET /api/incidents; `:946` GET /api/incidents/{incident_id}.
  `registry.py:697` get_incident_by_id is an internal retrieval function, not an
  authorization boundary. Tool wrappers must check ownership before calling it or
  consuming its result.
- `frontend/lib/api.ts:33` getClientSessionId reads query overrides/localStorage;
  `:53` setClientSessionId updates stored/URL context and emits session-change events.
  `:82` fetchNoCache adds X-Client-Session-ID. Upload XHR also sends that header.
  `:252` getIncidentsList loads shared incident data.
- `frontend/components/dashboard/DashboardConsole.tsx` owns dashboard lists and
  selection, handles fixproof_session_changed, and passes preselectedIncident to
  NemotronCenter (`:355`). Selection is currently component state, not an app-wide
  case context available to a root-level assistant.

### Evidence and reasoning

- `backend/app/evidence_models.py:50,74,94` define FrameEvidence, TimelineInterval,
  InvestigationInput. `:206` build_frame_evidence_from_matches and `:283`
  build_investigation_input_from_incident normalize actual incident evidence.
  `backend/app/timeline.py` clusters measured frame matches; timestamps must come
  from those results, not from model estimates.
- `main.py:970` investigate_threat_incident authorizes the incident, resolves the
  selected reasoning provider/model, checks usable cached reports, builds evidence
  and intervals, optionally selects temporal keyframes, calls the provider and saves
  its report. A persistence failure can return a report with operational errors;
  an assistant must not describe that as successfully saved.
- `backend/app/providers/factory.py` selects existing reasoning/vision providers.
  `providers/meta_client.py:10` defaults reasoning to muse-wonder-1.0; vision stays
  muse-spark-1.3 and voice muse-voice-transcribe-1.0. Environment overrides still
  apply; none were inspected here. Report actual executed model IDs.
- `providers/meta.py:102` MetaReasoningProvider supports configured Wonder reasoning
  and its explicit Muse model allowlist. `:117` build_multimodal_message bounds and
  prepares evidence images; `:232` generate_investigation_report validates structured
  report data/evidence references, controls provenance and enforces human review.
  Existing prompt builders in nemotron_engine are reusable evidence/report helpers;
  their names do not mean a Muse operation invokes Nebius.
- `providers/meta.py:202` create_text_completion supports existing text/JSON request
  shapes and Wonder reasoning_effort configuration. `providers/meta_client.py:47`
  MuseClient.complete invokes Chat Completions with retries disabled. It rejects
  finish reasons other than stop and absent text content. Native tool_calls responses
  can therefore fail before any future orchestrator sees them. Passing tools through
  an SDK is not proof that current provider behavior supports native tool execution.
- `registry.py:850` save_nemotron_report persists report provenance/full JSON in
  nemotron_reports or local report JSON, rejecting/stripping private reasoning traces.
  `:971` get_nemotron_reports_for_incident orders report history newest first.
- Existing reasoning reads: `main.py:1061` latest report; `:1082` history;
  `:1110` report by ID. Frontend helpers are `api.ts:276,291,306`.
- No conversation model, persisted chat history, conversation API, general assistant
  dispatcher, structured application-tool registry or tool-result conversation loop
  was found in app source. Existing endpoint-specific prompts and activity logs are
  not a conversation system. Model-native tool API compatibility/entitlement remains
  unverified; this audit makes no external documentation/API request.

### Detailed reports and evidence exports

- `backend/app/detailed_report.py:335` build_evidence_bundle assembles real incident
  metrics, matched assets, vision model observations, SAM findings where recorded,
  frame image paths, timeline intervals and up to three prior reports. It limits
  frame correlations to 15. A summary must disclose that bound and absent images.
  It is a useful bounded evidence builder after authorization, not an ownership check.
- `:496` synthesize_detailed_report resolves selected reasoning and validates report
  sections. Deterministic fallback is explicitly marked ai_synthesized=false. The
  assistant must distinguish fallback from successful model synthesis.
- `:720` generate_detailed_report_pdf renders existing report/evidence data;
  `:1410` generates the short summary; `:1482` saves detailed JSON/PDF locally;
  `:1502,1516,1530` retrieve JSON, PDF bytes and per-incident listing.
- `main.py:1489` POST /api/nemotron/detailed-report generates and stores JSON/PDF.
  IMPORTANT: supplying recipient_email also invokes email dispatch in that request.
  A future generation tool must omit the recipient and never combine these actions.
- `main.py:1550` detailed JSON lookup; `:1656` per-incident detailed list; `:1727`
  summary download; `:1121` signed evidence package export; `:1230` package verification.
  Existing evidence hashes/signatures and heuristic disclaimers must remain intact.
- `main.py:1575` PDF GET is not universally read-only. When a report lookup misses
  but its supplied ID identifies an incident, it can synthesize a new report and
  save it (`:1608`). Existing PDFs can also be re-rendered and re-saved on GET.
  The assistant's retrieval tool must use the stored-file service after ownership
  checks, not blindly invoke this GET as a harmless read. Generation requires an
  explicitly separate action/cost boundary.
- Detailed PDFs/JSON are filesystem artifacts, unlike cloud incident/reasoning rows.
  They are not shared automatically across instances and can disappear on ephemeral
  runtimes. A filesystem return path is not proof of durable storage or a working
  download on another instance. Select persistent storage before promising hosted
  report/email reliability; this audit introduces no migration.

### Resend: implemented, with correctness gaps

- `backend/app/nemotron_action.py:34` get_email_config checks RESEND_API_KEY presence
  and selects FROM_EMAIL or a default sender. This does not validate sender-domain
  entitlement. `:457` send_nemotron_document_email sends reviewed notice/proposal
  text using Resend; it requires user_confirmed, plus rights_declaration_confirmed
  for copyright notices. `main.py:1417` is its existing route.
- `detailed_report.py:1558` send_detailed_report_email sends an existing PDF as a
  base64 attachment; `main.py:1677` checks incident/report association and PDF
  availability before invoking it. Existing templates contain incident/report
  references and a human-review disclaimer.
- Recipient is supplied by frontend form/request, not resolved as an authenticated
  user's email address. FROM_EMAIL is a sender, not the configured destination for
  “email me.” No verified per-user recipient resolver was found. The assistant must
  ask for/resolve a recipient and present it for confirmation; never infer one from
  model output, untrusted metadata, sender configuration or prior unrelated audit.
- Both send implementations use requests.post to the Resend emails API. Missing
  configuration returns NOT_CONFIGURED; rejection/exception returns FAILED; audit
  entries are written. `nemotron_action.py:42,54` stores audit JSON locally and
  truncates to the latest 200 entries; write failures are logged rather than making
  it a durable action ledger.
- Both implementations label HTTP 200/201 as DELIVERED and allow a missing provider
  ID. That proves at most API acceptance, not inbox delivery. No delivery-webhook
  confirmation handler was found. Future chat should say “accepted by Resend” only
  after validated success/provider ID, and “delivered” only on verified delivery
  evidence. Timeout is uncertain submission, not safely retryable proof of failure.
- Detailed-PDF email service/route does not share the explicit confirmation flags
  enforced by the notice sender. The assistant must enforce its own server-checked
  confirmation boundary before this service. Existing raw provider error strings in
  some email responses/audit also need a sanitized wrapper.
- Implementation is present, not absent. Current configured/operational state and
  actual delivery were deliberately not tested; no email or external request made.

### Frontend integration surface

- `frontend/app/layout.tsx:20` wraps all routes with ActivityProvider and renders
  AppStatusIsland after children. This is the appropriate persistent app-shell mount
  for a future MuseAssistantProvider and one client floating button/panel, avoiding
  duplicate assistants on dashboard tab switches. Decide explicitly whether landing
  and /voice-test should show the launcher.
- `frontend/components/dashboard/NemotronCenter.tsx:180` is the current task-oriented
  Muse workspace. It holds selection/report history, synthesis, draft and email state
  locally, with inline modals and loading components. Reuse design conventions and
  services, not this entire large component as the chat implementation.
- `frontend/context/ActivityContext.tsx` tracks transient tasks/backend health. It
  is appropriate for action progress but not durable conversation/action storage.
  Account for the existing bottom status island when positioning a floating launcher.
- No existing general-purpose chat/Copilot component was found. Sidebar/mobile
  navigation and inline email/history modals provide existing panel patterns. New
  chat should support focus management, keyboard close, mobile sizing, accessible
  transcript roles and a visible loading/error/retry state.
- `frontend/app/voice-test/page.tsx` implements microphone permission, start/stop,
  playback/discard and explicit submission. `frontend/lib/voice-audio.ts` converts
  supported browser recordings to mono PCM WAV. `backend/app/voice_api.py` accepts
  multipart audio and calls the voice factory; `providers/voice.py` validates bounds
  and calls Meta ASR. Refactor/reuse capture logic in a later approved step. A voice
  transcript becomes the same editable user message as typed input; stopping
  recording or successful transcription must not execute an action automatically.

## 2. Security and correctness findings that affect the design

| Finding | Source/effect | Required assistant boundary |
|---|---|---|
| Sessions are not authenticated identities | api.ts:33 uses URL/localStorage overrides and a constant fallback session ID; :74 lists discoverable sessions | Require explicit session context and do not present it as secure user authentication |
| Missing-header list exposure | registry.py:385,475 returns all sessions when no session is provided, even outside demo mode | Assistant list/latest tools must require a session and apply explicit allow rules, never use missing-header fallback |
| Session discovery | main.py:934 exposes active session identifiers; registry.py:501 has no caller ownership filter | Do not expose session-switch/discovery as an assistant tool; knowable IDs are not access rights |
| Demo bypass | security.py:23 permits deliberate all-session demo inspection; production env disables that flag | Never enable demo mode or broaden its policy as part of chat; state controlled-demo limits |
| Mixed detail authorization | many incident routes check session; main.py:1110 report-by-ID lacks ownership validation | Reauthorize through parent incident for every report/evidence tool, even when existing route does not |
| Orphan report access | detailed JSON/PDF checks depend on resolving a parent incident | Deny assistant access when parent/ownership cannot be established |
| Evidence/frame routes | main.py:344,427 take asset IDs with no session-header ownership check | Do not accept arbitrary paths/IDs from model; map authorized incident evidence to bounded references |
| Side effects in reads | PDF GET can synthesize/save; export can create artifacts | Classify tools by actual execution, not HTTP verb/name; no paid or mutating operation in automatic reads |
| Generation can send | detailed generation with recipient invokes email | Always split generation from external send |
| Accepted is not delivered | send functions map HTTP success to DELIVERED | Deterministic action status cards, truthful acceptance terminology, no fabricated delivery |
| Audit/persistence limits | JSON files, truncated logs, ephemeral reports, no confirmed idempotency | Separate durable action history design; do not blindly retry uncertain sends |

These findings are verified code behavior, not a claim that someone exploited them.
No existing rule is changed by this audit. A controlled demo can retain current
session mechanics, but assistant wrappers must not weaken them or inherit broad
fallback behavior. Public multi-user release would require a separate identity
decision; OAuth/enterprise architecture is not required for the initial demo plan.

Treat filenames, URL metadata, report/model text, transcripts, OCR and retrieved
documents as untrusted data. They must not override system instructions, choose
recipients, supply authorization flags, request secrets, or trigger tool execution.
Delimit data from instructions, minimize context, schema-validate all model output,
and re-check ownership/tool eligibility on every invocation. Prompt wording alone
is not an enforcement boundary.

`backend/app/security.py:13` supplies CORS allowlisting; `:58` request middleware
uses a 51 MiB body cap and per-peer/per-worker quotas (30 costly requests/minute by
default). These are not per-user model-spend limits. Conversation endpoints should
have much smaller text/history/tool-result bounds, capped iterations/output tokens,
timeouts, cancellation and generation/send quotas. Existing safe main exception
handlers do not sanitize every third-party string returned by lower-level services.
Tool results/errors should use fixed categories and exclude private filesystem
paths, credentials, raw upstream payloads and internal reasoning traces.

## 3. Recommended architecture — PROPOSED, not implemented

### Conversation API and context

Introduce one dedicated backend conversation router, with typed contracts and a
thin service orchestrator. Do not make the frontend invoke backend Python functions
or allow the model to name arbitrary endpoints/functions. Resolve tools only from
a fixed server registry. Keep all model credentials backend-only.

Proposed initial requests:

```json
POST /api/muse/conversations
{ "selected_incident_id": null }

POST /api/muse/conversations/{conversation_id}/messages
{ "client_message_id": "unique-id", "text": "Show the matching timestamps", "expected_revision": 1 }
```

Use the existing session header, required by this router. Conversation IDs are
server-generated and bound to that session; they are not standalone access tokens.
Server context holds owner session, revision, bounded messages, explicitly selected
incident, any compared incident IDs, last authorized tool references and pending
action. A frontend ID is only a hint until reauthorized. A conversation pins its
resolved case; “latest” resolves deterministically in the authorized list at the
time of the request. “Previous” uses explicit ordered references, not model guesses.
Case/session switches must clear or rebind context, cancel stale responses and
invalidate pending confirmations. Include current case title/ID visibly in the panel.

For the first local single-process demo use bounded server-side memory with TTL and
an explicit restart-reset notice. Do not store complete forensic data or session
IDs in untrusted client history. Durable/multi-worker history needs a separately
approved storage choice; no conversation table exists today. Historical message
citations still require fresh authorization on retrieval.

Proposed response:

```json
{
  "conversation_id": "server-generated",
  "revision": 2,
  "message_id": "server-generated",
  "status": "completed",
  "text": "Grounded explanation or a clarification question",
  "citations": [{ "incident_id": "authorized-id", "evidence_id": "existing-frame-id", "timestamp_sec": 5 }],
  "tool_results": [{ "tool": "get_matching_timestamps", "status": "completed", "result_ref": "server-generated" }],
  "pending_action": null,
  "provider": "muse",
  "model_id": "actual-executed-model"
}
```

Additional statuses: needs_clarification, awaiting_confirmation, failed. Do not
claim asynchronous progress/job IDs unless an actual job service is implemented.
Initial bounded synchronous turns are practical; lengthy generation must return
completed only after persistence/downloadability checks, or move to an explicit
real job contract in a later approved step.

### Deterministic tool registry

| Proposed tool | Existing service to wrap | Effect / output |
|---|---|---|
| list_recent_incidents | registry.load_incidents plus explicit owner filter | Read; bounded summaries, deterministic ordering |
| get_incident | registry.get_incident_by_id plus parent authorization | Read; actual status, workflow, metrics, durations, limitations |
| get_matching_timestamps | evidence_models + timeline; recorded vision findings | Read; evidence IDs/intervals, not inferred times |
| get_evidence_bundle | detailed_report.build_evidence_bundle | Read; bounded facts, omit internal paths/raw bytes |
| compare_incidents | two authorized incident bundles | Read; deterministic comparison, model explanation with citations |
| get_investigation_report | report services plus parent authorization | Read; actual report provenance/validation/persistence status |
| get_detailed_report | stored JSON/PDF services, not dynamic PDF GET | Read; existing report ID and authorized download reference |
| generate_detailed_report | bundle → synthesize → render → save | Paid/mutating; separate approved action, recipient omitted |
| prepare_report_email | existing stored report + validated recipient | No send; returns exact preview and confirmation challenge |
| confirm_report_email | existing detailed email service | External action; only after server-validated explicit confirmation |

Each tool defines strict input/output schemas, effects, ownership policy, bounds,
timeout and error taxonomy. Disallow arbitrary SQL, URLs, filesystem paths, model
overrides, session IDs or recipient resolution supplied by model. Check every
compared incident, report-to-incident binding, evidence membership and actual file
availability. Do not expose delete, session switching, vault sync, email-audit-wide
lookup or unrestricted network tools in the first registry.

### Model orchestration and follow-ups

First reuse get_reasoning_provider().create_text_completion with bounded messages
and a locally validated JSON action plan: either answer/clarify or one allowed tool
and validated arguments. Treat it as a suggestion, not authorization. Server
registry dispatches; sanitized structured tool output is then supplied as data for
the next model response. Bound the loop (for example three read tools/turn) and
require the model to stop/clarify on missing or failed data. Do not dispatch free
text or eval/exec. Verify citations against the authorized result set and render
metrics/status/action receipts from server data rather than trusting paraphrases.

A future native tool-calling implementation needs separate provider/client support
for tool_calls finish reasons, nullable content, tool-call IDs, tool-result messages,
argument validation and model/API compatibility testing. Do not weaken existing
report completion validation or silently assume Wonder entitlement supports that
contract. The JSON-plan approach also needs mocked tests and separate authorized
live validation before being claimed operational.

Voice ASR returns text into the same editable composer as typed input. The user
reviews it and sends a message explicitly. Transcription errors (including the
known sports/spots ambiguity) can change intent; no send/generation confirmation
should be inferred from an unreviewed transcript. TTS is outside this architecture.

### External-action confirmation and audit

Use a two-step prepare/confirm server action, distinct from model text. A confirmation
preview identifies recipient, report/incident, attachment, subject and effect. Bind
a short-lived, single-use server challenge to conversation/session, action arguments,
report ID/content digest and revision. Require an explicit UI confirmation and any
applicable rights declaration. Never accept a model-produced user_confirmed flag.
If the recipient/report changes, reconfirm. Validate recipients server-side and do
not interpret FROM_EMAIL as the destination. Optional deployment recipient
allowlisting is a product decision, not existing functionality.

Record action ID, tool, owner context, validated argument digest, authorized target
IDs, timestamps, outcome, provider receipt and sanitized failure. Keep ASR audio
transient by default; do not log full sensitive case/chat/email content unnecessarily.
An idempotency key and action ledger must prevent double clicks or replayed messages
from sending twice. On timeout/uncertain acceptance, present unknown and require
receipt reconciliation rather than automatic retry. Return deterministic receipt
cards; let model text explain them without changing status. Existing truncated JSON
audit is reusable as legacy logging, not sufficient exactly-once/durable evidence.

## 4. Sequential implementation roadmap

1. **3B — conversation contracts and isolated service foundation.** Required session,
   server conversation identity/revision/TTL, bounded messages, strict schemas and
   predictable errors. Offline tests; no actions, UI or live calls yet.
2. **Read-only incident/evidence tools.** Add explicit authorization shared by every
   wrapper, deterministic latest/previous resolution, timestamps, stored reports,
   comparison and citations. Test absent/cross-session/demo/null-session cases,
   orphaned reports, missing evidence and empty lists. Never use unsafe GET fallbacks.
3. **Muse orchestration.** Implement bounded JSON action planning and result-to-answer
   cycle through existing provider. Mock hallucinated IDs, injection, invalid args,
   malformed output, timeouts, duplicate tools and exhausted budgets. Separately
   approve a minimal live read-only conversation test.
4. **Persistent frontend shell.** Floating Muse launcher and accessible panel under
   root layout, selected-case context bridge, request revision guards, text input,
   citations/status cards, cancellation and meaningful errors. No model calls on
   mount, navigation or reopening history. Avoid collision with AppStatusIsland.
5. **Voice integration.** Reuse capture/conversion/provider pipeline; editable ASR
   transcript feeds the same composer. Verify cleanup, permission denial, Safari
   codec handling, discard, cancellation and no automatic action on stop/ASR.
6. **Report generation in chat.** Explicit cost/action confirmation, existing
   evidence/synthesis/PDF/persistence services, no recipient in generation request.
   Return real artifact/report IDs and ai_synthesized/validation/error status.
   Address durable storage before multi-instance promises.
7. **Resend with confirmation.** Prepare/confirm, recipient validation, report binding,
   replay/idempotency protection, sanitized outcomes and truthful accepted-vs-delivered
   language. Never let model choose confirmation or claim success from intent.
8. **History and context continuity.** Bounded initial memory history may already
   support follow-ups; add selected durable storage only after schema/storage approval.
   Cover restart/expiration, revisions, ownership rechecks and stale pending actions.
9. **End-to-end acceptance.** Existing real video/evidence with mocked Muse/Resend
   first; prove list/detail/timestamps/report/download/action receipts and cross-session
   denial. Explicitly select safe tests, never wildcard live integration scripts.
   Real ASR/reasoning/email validation requires separately scoped authorization;
   email tests remain mocked unless the owner authorizes one named send.

## 5. Risks, dependencies and acceptance gates

Existing services substantially reduce implementation scope, but direct endpoint
reuse without policy wrappers would inherit real access and side-effect gaps.
Before write tools: resolve confirmation, recipient identity, missing-parent report
authorization, durable artifacts, deduplication and truthful Resend statuses.
Before real tool orchestration: verify the selected model's structured-plan/native
tool contract and preserve existing provider behavior. Before persistent history:
choose bounded storage/retention and deployment ownership assumptions explicitly.

For the controlled demo, first acceptance should be: authorized latest incident →
actual matching timestamps → evidence-grounded explanation → follow-up about that
same incident, with no extra model calls or side effects on history navigation.
All write/email/financial/legal actions remain unavailable until their later gates.
No architecture blocker prevents building that bounded read-only assistant, but
existing session mechanics do not justify a claim of secure multi-user isolation.

This audit does not establish current API keys, email sender verification, delivery,
database contents, hosted instance persistence, model entitlement or native tool
compatibility. Those require later approved checks. Stop at this report for owner
approval before Step 3B implementation.
