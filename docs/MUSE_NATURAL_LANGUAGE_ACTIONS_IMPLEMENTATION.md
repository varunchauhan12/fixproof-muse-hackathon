# Muse natural-language actions

Implemented and validated on 2026-11-03. This extends the existing Copilot 2.0 implementation; it replaces UI-only intent navigation with actual backend execution through the existing conversation API.

## Root causes

1. The model plan schema allowed only grounded answers, clarification and six read-only tools. Generation/email functions were deliberately absent; a model could explain them but could not execute them.
2. The initial frontend intent handler opened Document Studio and returned early instead of sending the instruction to the server.
3. Conversation responses and client message metadata did not carry generated artifact references. Even a successful service operation had no structured chat result renderer.
4. Reports/PDFs already shared a working pipeline; separating them in chat was a wiring problem, not a missing renderer.
5. Fresh live report testing exposed deterministic fallback from the previous JSON-object/report synthesis path. The original failure category was not preserved, so its exact historical cause cannot be established. The repaired request uses the existing Meta `schema_format` helper and established 16,384-token reasoning budget (honoring `MUSE_MAX_TOKENS` within bounds), with safe fallback diagnostic categories. A final live request successfully returned `muse-wonder-1.0`, `ai_synthesized=true`, and an actual PDF.

## Execution flow

`FloatingMuseChat` → `MuseConversationClient.send()` → existing `POST /api/muse/conversations/{conversation_id}/messages` → existing conversation revision/reservation checks → explicit `action_for_text()` → session-owned incident lookup through the existing tool registry → `MuseActions` → existing report/document/Resend functions → typed artifacts in the saved assistant message and response → `MuseArtifactView`.

The action dispatcher examines only the current literal user instruction. It never dispatches from retrieved records, transcripts quoted as data, model responses or arbitrary function names. Explicit supported imperative phrases execute deterministically without requiring a separate intent-model call. Explanation and analysis requests continue through the original Muse planner, six-tool allowlist and grounding validation. Unsupported phrasing may still require clarification.

Supported actions:

- Report/PDF: load an existing associated saved report with usable PDF, or run `build_evidence_bundle` → `synthesize_detailed_report` → `generate_detailed_report_pdf` → `save_detailed_report`. A fresh/regenerate request runs the pipeline again.
- Copyright notice: reuse `generate_copyright_notice_draft`, with recorded incident evidence and explicit unknown-field placeholders.
- Licensing proposal: reuse `generate_rev_share_proposal_draft`. No assumed percentages, amounts, deadlines or agreements. An explicit 0% remains 0% rather than triggering a default percentage.
- Professional summary: editable document projection of the same existing detailed report, retaining provenance and limitations. No parallel report generator.
- Edit document: reopen the existing conversation artifact. Browser edits are keyed by artifact ID and retained when that draft is reopened during the current session/incident view.
- Prepare email: prepare editable subject/body and associate the actual saved PDF; never send.
- Send registered email: a clear direct instruction resolves the fixed recipient on the server and invokes existing PDF-attachment sending. No redundant chat checkbox. Arbitrary destinations and unrelated copyright/licensing attachments are rejected.

Conversation `MessageResponse` and message metadata now include bounded `artifacts` (at most four; body at most 20,000 characters per artifact, with an explicit truncation flag). They contain incident/report identifiers, kind, title, body, model provenance and actual status. PDF paths are not supplied by the model: the client downloads by the validated report ID through the existing authenticated API helper.

Optional typed `email_draft` parameters carry a user-edited subject/body and report ID. There is no recipient parameter. The report ID must match the selected incident's chosen saved report before sending. The frontend forwards prepared cover-note edits; they cannot change the destination or attachment association.

## Registered recipient and email safety

- Local `backend/.env` now contains `MUSE_REGISTERED_EMAIL` using the student address supplied by the user. No other environment values were changed by this extension. Its value is intentionally omitted here.
- `backend/.env.example` documents the variable with an empty value. No address or credential is hardcoded in source or frontend configuration.
- Missing/invalid fixed-recipient configuration blocks a send before generating another report. Resend availability is also checked before generation for a send request.
- Clear requests such as “Send the PDF report to my email” authorize that specific registered-recipient send. “Prepare an email but don't send it” only drafts. A raw address in chat is not used as a destination.
- Existing manual Document Studio and rights-document sending safeguards remain. The registered-recipient chat workflow is the narrow exception authorized by the user.
- Existing `send_detailed_report_email` attaches the saved binary PDF, accepts the reviewed cover note, and records the attempt through the existing audit mechanism.
- Only actual provider `ACCEPTED` results produce acceptance success text. Acceptance never implies delivery.
- Process-local duplicate protection keys sends by session, incident, saved report and fixed recipient. Accepted, in-flight, failed or uncertain attempts are not silently repeated for ten minutes. Concurrent generation for the same session/incident is also guarded. Conversation client-message deduplication and revision checks remain in effect.
- A failed/uncertain send keeps the usable PDF artifact available and does not automatically retry. Inspect the audit before another attempt. These protections are demo/process-local and reset with a restart; they are not durable exactly-once delivery.
- Resend key availability is not proof that a sender domain or this recipient is permitted in the account's current mode. That restriction cannot be confirmed without a real provider send. No real email was sent in this validation.

## Interface and reliability

Natural-language instructions execute through chat and return actual artifact cards, editable text and working PDF downloads. Suggested actions submit the same requests. Optional manual Document Studio remains available, but it is not a required extra generation step.

Generation/loading states describe the pending operation without decorative agent progress. Artifact errors and deterministic synthesis provenance are visible. Session/incident changes clear edits and advance the response epoch so obsolete replies cannot overwrite another incident. Client requests have a bounded timeout; conversation recovery remains read-only and never retries inference or sending automatically. Read-only citation validation, prompt-injection checks and tool budgets are preserved.

No new conversation database, migrations, generic workflow engine, multi-agent system, provider architecture or authentication system was introduced. P1/P2/P3 source and functionality are preserved. SAM context remains read-only, exact-association scoped and honest about expired caches, without tracking or mask decoding claims.

## Automated validation

Core backend (191 passed), from `backend`:

```sh
.venv/bin/python -B -m unittest tests.test_muse_actions tests.test_muse_orchestrator tests.test_muse_tools tests.test_muse_conversations tests.test_muse_conversation_api tests.test_temporal_evidence tests.test_temporal_evidence_api tests.test_temporal_consumers tests.test_sam_workspace tests.test_sam_scene tests.test_sam_provider tests.test_voice_api tests.test_voice_provider
```

Report/PDF/email regressions (42 passed):

```sh
.venv/bin/python -B -m tests.run_copilot_offline
```

This explicit harness runs existing detailed-report, document-action and forensic-PDF tests plus focused workflow tests using temporary storage, injected infrastructure and a blocked network. Mocked Resend tests verify exact edited content, actual attachment encoding, `ACCEPTED`, confirmation gates and incident/report association. They do not send email or start `app.main`/vault startup.

Frontend (70 passed), from repository root:

```sh
node --test frontend/tests/test_muse_workflows.mjs frontend/tests/test_floating_muse_chat.mjs frontend/tests/test_muse_assistant.mjs frontend/tests/test_temporal_evidence.mjs frontend/tests/test_sam_workspace.mjs frontend/tests/test_investigation_workspace.mjs frontend/tests/test_forensic_evidence_experience.mjs
```

Production `npm run build`, TypeScript and targeted lint for `FloatingMuseChat.tsx`, `MuseArtifactView.tsx`, `MuseDocumentWorkspace.tsx` and `muse-assistant.ts` passed. `git diff --check` passed. No wildcard/live integration test command was used.

## Actual browser verification

Used the existing local frontend/backend and an existing session-owned incident. No frontend API mocks or substituted backend responses were used in the browser.

| Request/workflow | Actual outcome |
| --- | --- |
| Explain this investigation | Live Muse grounded response with real CV/temporal data, citations and unavailable/expired SAM caveat. |
| Generate a detailed report | Existing saved report was reused and its deterministic provenance disclosed. |
| Generate a fresh detailed report | Existing renderer generated a PDF. Initial synthesis fell back honestly; after request repair, final live Muse Wonder synthesis succeeded. |
| Generate a PDF of this investigation | Reused the actual saved PDF and exposed a working download control. |
| Create a copyright notice | Editable evidence-based template returned; unknown parties remained placeholders. No model success or legal finding claimed. |
| Create a licensing proposal | Editable draft with `[To be proposed]` percentages/deadline; actual textarea edit tested. |
| Prepare a professional investigation summary | Editable report-derived document returned. |
| Edit the licensing proposal | Reopened the original artifact with the browser edit preserved. |
| Prepare an email but don't send it | Editable draft and correct PDF artifact returned; no send occurred. |
| Send to an arbitrary third-party address | Rejected with a clear fixed-recipient restriction; no send occurred. |
| Send the PDF to my email | Automated mocked coverage only. Deliberately not exercised against real Resend in the browser. |

Final successful live report: `muse-wonder-1.0`, `ai_synthesized=true`. Its downloaded PDF was verified as 6,355,258 bytes, valid PDF header/EOF, five page objects. Local artifact:

`/Users/varunchauhan/Downloads/fixproof-f6aa02de-2629-442f-915f-c2f761b904aa.pdf`

Screenshot: `docs/MUSE_NATURAL_LANGUAGE_ACTIONS_BROWSER.jpg`. Zero browser error logs were observed during verification. Real explanation/model synthesis/PDF generation and actual downloads are verified. Real Resend acceptance/delivery and sender/recipient entitlement remain unverified.

## Files and Git safety

Modified by this extension:

- `backend/.env.example`
- `backend/.env` (ignored local configuration; only the registered-recipient entry)
- `backend/app/detailed_report.py`
- `backend/app/muse_conversations.py`
- `backend/app/muse_orchestrator.py`
- `backend/app/nemotron_action.py`
- `frontend/components/muse/FloatingMuseChat.tsx`
- `frontend/lib/muse-assistant.ts`
- `frontend/tests/test_floating_muse_chat.mjs`
- `docs/MUSE_COPILOT_2_IMPLEMENTATION.md` (current-execution addendum)

New/untracked:

- `backend/app/muse_actions.py`
- `backend/tests/test_muse_actions.py`
- `frontend/components/muse/MuseArtifactView.tsx`
- `frontend/tests/test_muse_workflows.mjs`
- `docs/MUSE_NATURAL_LANGUAGE_ACTIONS_IMPLEMENTATION.md`
- `docs/MUSE_NATURAL_LANGUAGE_ACTIONS_BROWSER.jpg`

Work began with P3 and initial Copilot work uncommitted. Another process created commit `59b7c7d` during this session; that checkpoint was preserved. This task did not issue staging, commit, push, deployment or branch-change commands. Branch remains `main`. All changes listed above remain uncommitted. No protected repository was modified. Browser report generation created real report/PDF artifacts in the existing report storage; no incident/evidence records or database schemas were modified by these tests.

## Limits and deliberately deferred items

- Intent recognition is a bounded set of explicit supported phrases, not an unrestricted semantic action planner. Reported/quoted instructions and ambiguous sending do not grant authority.
- In-memory conversations, draft edits and duplicate caches are demo state. Restart/navigation may lose them; report PDFs use the existing persistence flow.
- Copyright/licensing templates are deterministic, explicitly review-required drafts. No autonomous enforcement or legal execution.
- Professional summary exports are text projections of the existing report; edited text does not rewrite the saved PDF.
- Chat sending supports the associated investigation PDF to the configured owner destination. Rights-document third-party sending remains in the existing explicit-review manual workflow.
- No live email was sent; verify Resend sender-domain/account restrictions before demonstrating actual acceptance. Delivery still requires provider delivery events outside this scope.
