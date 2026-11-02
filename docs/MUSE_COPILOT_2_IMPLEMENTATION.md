# Muse Copilot 2.0 — Demo-Ready Intelligence & Document Workflows

Implemented 2026-11-03. No commits, pushes, deployments, branch changes, new
dependencies, database tables, or migrations. Protected repositories untouched.
P3 temporal work (uncommitted) preserved.

## What already existed (verified, not rebuilt)

- Grounded, read-only Muse: `MuseAssistant` (`backend/app/muse_orchestrator.py`)
  with plan→validate→respond loop, 6 read tools (`backend/app/muse_tools.py`),
  citation validation, session re-authorization, redaction, bounded calls.
- Conversation lifecycle (`backend/app/muse_conversations.py`,
  `backend/app/muse_conversation_api.py`): in-memory, session-scoped, revision-checked.
- Report generation + ReportLab PDF + download endpoints
  (`backend/app/detailed_report.py`); saved-report listing/retrieval.
- Copyright-notice and revenue-share draft templates
  (`backend/app/nemotron_action.py`) with dual-confirmation email gate.
- Resend integration with honest not-configured behaviour and audit log.
- P3 temporal evidence (`backend/app/temporal_evidence.py`) already flowing
  into Muse's matching tool, detailed reports, and the dashboard.

## What changed

### Backend
- `backend/app/sam_workspace_api.py` + `backend/app/sam_workspace.py`: new
  read-only `read_cached_context` — Muse can describe *already cached* SAM
  observations with exact candidate/target association. Never runs inference,
  never loads frames, expires with the existing 30-min process cache, and
  states plainly that a missing cache does not mean SAM never ran. No tracking,
  correspondence, or mask-decoding claims.
- `backend/app/muse_tools.py`: evidence bundle now carries `sam_context`
  (labels sanitised like other projections; no masks/payloads exposed).
- `backend/app/muse_orchestrator.py`: system instructions teach Muse to use
  `sam_context`, explain cache limitations, and route document/report/email
  requests to the UI Document Studio instead of claiming actions happened.
- `backend/app/detailed_report.py`: evidence bundles no longer synthesise
  timestamps (`idx * 5.0` removed); missing stays `null`/"Not recorded".
  Reports embed the canonical P3 temporal block and the SAM cache context;
  prompt rules forbid unsampled-footage and legal conclusions. Email send now
  accepts reviewed `subject_override`/`body_override` (validated), and reports
  Resend *acceptance* (`ACCEPTED`), never "delivered".
- `backend/app/nemotron_action.py`: drafts no longer invent commercial terms —
  revenue share, deadline, parties, and emails are `[To be proposed]` /
  `[… — not supplied]` placeholders unless the user supplies them; every draft
  is prefixed with a human-review warning; telemetry wording corrected
  ("Recorded CV candidate telemetry (heuristic, human review required)").
- `backend/app/main.py`: email endpoint requires explicit `user_confirmed`
  plus a valid session header *before* any report/incident read; draft inputs
  (`rev_share_pct`, `response_deadline_days`) default to `None` (no silent
  50%/14-day assumptions); session-scoped report sending.

### Frontend
- **New** `frontend/components/muse/MuseDocumentWorkspace.tsx`: Document Studio
  with five workflows (Investigation report, Copyright notice, Licensing
  proposal, Professional summary, Email report). Prepare → readable preview →
  edit → copy/export text → download saved PDF → reviewed send. Generation and
  sending are separate human actions; nothing runs on mount; drafts/edits stay
  in the browser; email requires recipient + full review checkbox; Resend
  acceptance is reported as acceptance, not delivery.
- `frontend/lib/muse-assistant.ts`: typed workflow routing
  (`workflowForText`) — natural-language requests open the right workspace;
  this never grants the model tools or executes actions.
- `frontend/components/muse/FloatingMuseChat.tsx`: active-incident selector,
  suggested actions (Explain investigation, Temporal analysis, SAM findings,
  Generate report, Copyright notice, Licensing proposal, Prepare email),
  honest waiting copy; chat keeps all existing grounding behaviour.
- `frontend/components/dashboard/NemotronCenter.tsx`: embeds the Document
  Studio for the selected incident; accepts `ACCEPTED` outcome honestly.
- `frontend/lib/types.ts`, `frontend/lib/api.ts`: typed email overrides and
  forced `user_confirmed` propagation; SAM/temporal section types.

## User workflows supported

1. Open an incident → ask Muse to explain it (grounded chat, citations).
2. Ask for temporal analysis (P3 offset/inversion facts with limitations).
3. Ask "What does the SAM investigation tell us?" (cached observations or an
   honest unavailable/expired answer; never fabricated detections).
4. "Generate an investigation report." → Document Studio prepares the report
   via the existing renderer, shows a labelled preview (measured vs AI
   interpretation), downloads the saved PDF.
5. "Prepare a copyright notice." / "Prepare a licensing proposal." →
   evidence-based draft with placeholders, editable, exportable.
6. "Prepare an email." → load saved report, edit recipient/subject/body,
   tick the review confirmation, send via Resend; result reported as
   accepted-not-verified.

## Tests executed (2026-11-03, this continuation)

- Backend Muse suites (`test_muse_tools/orchestrator/conversations/
  conversation_api/demo/grounding_diagnostics`): 118 passed.
- Backend report/temporal suites (`test_detailed_report`,
  `test_forensic_report_pdf`, `test_nemotron_action`, `test_temporal_evidence`,
  `test_temporal_evidence_api`, `test_temporal_consumers`): 66 passed.
- Offline copilot harness (`backend/tests/run_copilot_offline.py`, network
  blocked, temp storage): 42 passed — including confirmation/session gates,
  cross-incident attachment refusal, header-injection rejection, placeholder
  honesty, missing-timestamp preservation.
- Earlier session: 147 backend tests (temporal/SAM/Muse batches) passed.
- Frontend: all 14 `frontend/tests/*.mjs` suites — 96 passed, 0 failed.
  Two stale live-integration suites were updated: provider expectations now
  match the Muse migration (`muse-wonder-1.0` / `muse-spark-1.3`), and the
  email section now tests the confirmation gate instead of live-sending
  (no real email is sent from tests). Note: these two suites hit the running
  dev server and will trip its 30 req/min limiter if run back-to-back;
  wait ~60s between runs.
- TypeScript: `npx tsc --noEmit --incremental false` — clean.
- Lint (new files): `MuseDocumentWorkspace.tsx`, `muse-assistant.ts` — clean.
  Pre-existing lint debt unchanged (documented, not introduced here):
  `FloatingMuseChat.tsx` hook-pattern warnings present in HEAD, `lib/types.ts`
  `no-explicit-any` ×2.
- Production build: `npm run build` — passes (routes `/`, `/dashboard`,
  `/muse`, `/voice-test`).

## Browser verification

Headless Chrome against the already-running dev servers (no restarts):
`/muse` renders the investigation chat correctly; `/dashboard` renders the
full console (sidebar, overview) — data panels show backend-offline in
headless because that browser profile has no demo session; use your normal
browser session for the live demo. Interactive click-through of the Document
Studio in a real session is the one step not captured here; the component is
covered by 96 passing component/handler tests with mocked transport.

## Known limitations and demo risks

- Conversations remain in-memory (restart/TTL expiry loses them) — by design
  per task scope; do not promise persistence in the demo.
- SAM context in Muse/reports reflects the process-local cache only;
  after a restart Muse will honestly say the snapshot is unavailable.
- Report generation against the live provider takes ~30s (observed);
  rehearse once before the demo and keep a saved report ready to load.
- The dev backend rate limiter (30/min) can 429 rapid-fire manual clicking
  across test suites; normal demo use is unaffected.
- Email "delivery" is never claimed; only Resend acceptance. Keep a exported
  draft/PDF fallback ready.
- Licensing/copyright drafts are templates with placeholders — a lawyer must
  review before any real use; the UI says so in every draft.

## Deliberately deferred (per task scope)

Persistent conversations, Report Studio versioning, ActionService/approval
tokens, case management, tasks/notifications, new auth, SAM mask decoding,
object tracking/correspondence. See `docs/META_MIGRATION_INVESTIGATION.md`
and the P4.0 blueprint discussion for the staged path.
