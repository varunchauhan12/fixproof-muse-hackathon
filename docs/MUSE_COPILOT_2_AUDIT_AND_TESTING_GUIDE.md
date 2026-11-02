# Muse Copilot 2.0 — Complete Implementation Audit and Manual Testing Guide

Audit date: 2026-11-03. Read-only; no code, config, data, or Git state changed.
Evidence classes: VERIFIED (executed), AUTOMATED-TESTED (tests pass, not manually
run end-to-end), PARTIALLY WORKING, UNVERIFIED, UNSUPPORTED.

## 1. Executive summary

Muse is a grounded, read-only investigation assistant (LLM + six allowlisted
evidence tools + citation validation) with a deterministic Document Studio for
reports, copyright/licensing drafts, and reviewed email. The LLM itself holds
no write tools: every output that leaves the product passes through existing
deterministic services and, for email, an explicit human confirmation. What is
real and tested: conversation lifecycle, evidence explanation with validated
citations, CV/temporal/SAM-cache retrieval, report+PDF generation, draft
templates with honest placeholders, Resend acceptance with audit. What is not
persistent: conversations (in-memory), SAM snapshots (process cache). What must
never be claimed: email *delivery* (only provider *acceptance*), legal
infringement, SAM tracking/correspondence, decoded masks.

## 2. Current architecture

```text
FloatingMuseChat.tsx / app/muse/page.tsx
  └─ lib/muse-assistant.ts (MuseConversationClient, workflowForText routing)
       └─ POST /api/muse/conversations, POST …/{id}/messages
            └─ MuseAssistant (backend/app/muse_orchestrator.py:275)
                 plan loop: MAX_TOOLS=3, MAX_MODEL_CALLS=4, 48KB ctx, 96KB prompt
                 grounding: _validate_response (:343), _reauthorize (:287)
                 └─ MuseToolRegistry (backend/app/muse_tools.py) — 6 read tools
                      list_recent_incidents / get_latest_incident /
                      get_incident_details / get_matching_timestamps /
                      get_evidence_bundle / get_investigation_reports
                 └─ providers/meta.py → api.meta.ai/v1 (wonder-1.0 / spark-1.3)
Document Studio (components/muse/MuseDocumentWorkspace.tsx)
  └─ existing services only: detailed_report.py (ReportLab PDF),
     nemotron_action.py (templates + Resend), temporal_evidence.py,
     sam_workspace read_cached_context (cache-only, no inference)
Conversations: ConversationManager (muse_conversations.py:114)
  in-memory dict, TTL 1800s, ≤256 conversations, ≤40 retained messages,
  revision-checked appends, session-ownership 403.
```

## 3. Feature inventory (A–J)

**A. NL investigation assistant** — Floating chat + `/muse` page; needs session
(always present via `X-Client-Session-ID` from `lib/api.ts:getClientSessionId`);
incident optional (selected via header or chat selector). LLM: wonder-1.0.
Output: grounded text + citations + tool receipts. Limitation: in-memory only.

**B. Evidence explanation & citations** — every citation must resolve to an
authorized source node; timestamps require evidence anchors
(`_validate_response`, muse_orchestrator.py:343). Output carries
`citations[]` + `tool_results[]` (≤3). Mismatched citations are rejected
server-side (`UNGROUNDED_RESPONSE`), never rendered as fact.

**C. CV matching access** — `get_matching_timestamps` returns frames with both
timestamps, L2, similarity index, status; `get_evidence_bundle` adds per-frame
observations. Similarity is explicitly an uncalibrated heuristic, not an
infringement probability (limitations string shipped to the model).

**D. Temporal evidence** — same tool embeds `temporal_summary`
(median offset, MAD, tolerance band, ≤5 inversions, LIS, consistency ratio,
trend, cluster count, `is_report_fallback_only`) from
`temporal_evidence.build_temporal_evidence_for_incident`. Reports recompute
from raw candidates; report-fallback-only data is flagged, never mixed.

**E. SAM snapshot access** — evidence bundle carries `sam_context` from the
process-local SAM cache (30-min TTL, ≤64 targets). Muse must state
availability/expired status and may only quote validated labels for the exact
candidate/target. No inference is triggered by chat. Expired = honestly
unavailable; absence never implies SAM never ran.

**F. Detailed report generation** — Document Studio "Investigation report":
`POST /api/nemotron/detailed-report` → `build_evidence_bundle` →
`synthesize_detailed_report` (detailed_report.py). Content: measured CV
correlations (missing timestamps stay "Not recorded"), canonical temporal
block, SAM cache context, AI interpretation labelled as interpretation,
limitations. Deterministic fallback exists when the provider is unavailable
(UI says so; no AI success is claimed).

**G. PDF preview/download** — saved-report listing + `GET
/api/nemotron/detailed-report/{id}/pdf` (ReportLab, headers/footers, page
numbers). Preview in Studio is a labelled text rendering; the PDF is the
original saved artifact (edits export separately as text).

**H. Document Studio** — Copyright notice / Licensing proposal / Summary /
Email workflows (MuseDocumentWorkspace.tsx). Templates from
`nemotron_action.py` (deterministic; optional AI polish currently disabled in
Studio flow). Unsupplied parties, shares, deadlines, emails render as
`[To be proposed]` / `[… — not supplied]`; every draft carries a human-review
warning. Editing is local; export = copy / .txt download / saved PDF.

**I. Email preparation** — Load saved report → prefilled subject/body →
edit recipient/subject/body → review checkbox → Send. Backend
(`POST /api/nemotron/email-detailed-report`) requires `user_confirmed: true`
+ valid session *before* any incident/report read, re-checks report↔incident
ownership, attaches the pinned PDF bytes, calls Resend once, returns
`ACCEPTED` + provider id, writes an audit entry. Recipient is never inferred;
ChatGPT account email is never available to the app.

**J. Conversation management** — create/get/delete/message routes
(muse_conversation_api.py:61-81). History lives in process memory; refresh of
the page keeps it (same backend process), backend restart or 30-min idle TTL
loses it; another session gets 403. No cross-device history. This is
demo-scoping, not authentication.

## 4. Verification matrix

| Feature | Class | Evidence |
|---|---|---|
| Tool allowlist, bounded calls, error taxonomy | AUTOMATED-TESTED | 118 Muse backend tests pass |
| Grounding/citation rejection | AUTOMATED-TESTED | grounding diagnostics tests + observed rejection logs |
| Conversation lifecycle, session 403, revision conflicts | AUTOMATED-TESTED | conversation API tests |
| Temporal summary in tool + report | AUTOMATED-TESTED | 66 report/temporal tests |
| Confirmation/session gates, cross-incident attachment refusal, header-injection rejection | AUTOMATED-TESTED | offline harness, 42 tests (network blocked) |
| Document Studio render, workflow routing, suggested actions | AUTOMATED-TESTED | 96 frontend tests (mocked transport) |
| Report generation + PDF (6.3MB, %PDF) | VERIFIED (live integration) | detailed-report integration suite, 37/37 |
| Email dispatch mechanics (payload, attachment) | AUTOMATED-TESTED (mocked Resend) | offline harness; live send deliberately not executed |
| /muse page + dashboard rendering | VERIFIED (headless render) | screenshots 2026-11-03 |
| Live LLM answer quality on real incidents | UNVERIFIED here | requires interactive session; test manually (§5) |

## 5. Manual testing guide

General: use your normal browser at http://localhost:3000 (backend :8000).
Backend logs: terminal running uvicorn. API base: http://127.0.0.1:8000.
Never paste real secrets anywhere; session IDs are demo identifiers only.

**T01 — Muse without incident.** Prereq: none. Dashboard → Muse tab (or
/muse). Ask "Explain what happened." *Success:* Muse asks you to select an
incident or explains latest-in-session only; no invented incident. *Failure:*
fabricated incident details. Inspect: POST /api/muse/conversations…/messages.

**T02 — Muse with incident.** Select an incident in the dashboard, open chat.
*Success:* "Discussing: <incident>" context; selector shows the incident.
*Failure:* context lost after tab switch. Inspect: `selected_incident_id` in
conversation GET.

**T03 — Basic question.** Prompt: "Explain what happened in this incident."
*Success:* summary cites recorded matches/timestamps with citation chips;
limitations mentioned. *Failure:* numbers without citations, infringement
claim. Inspect: response `citations[]`, `tool_results[]`.

**T04 — Why was this candidate matched?** Open CV Investigation, note a
candidate (timestamps, L2). Ask Muse about it. *Success:* explanation quotes
the same L2/similarity/status, calls similarity a heuristic. *Failure:*
different numbers than the CV tab. Cross-check `GET
/api/incidents/{id}/temporal-evidence`.

**T05 — Temporal explanation.** Suggested action "Temporal analysis".
*Success:* median offset/MAD/inversions explained as sampled-evidence
patterns with "does not prove infringement". *Failure:* claims about
unsampled footage. Inspect: tool data `temporal_evidence`.

**T06 — SAM findings.** Run a SAM investigation first (SAM tab, explicit
Start), then ask "SAM findings". *Success:* validated labels for exact
candidates, or honest unavailable. *Failure:* tracking/mask claims.

**T07 — SAM expired.** Restart backend (demo only) or wait 30 min; ask again.
*Success:* "snapshot unavailable/expired; does not mean SAM never ran."
*Failure:* invented objects or silent empty answer presented as fact.

**T08 — Generate report.** Chat: "Generate an investigation report." Studio
opens → Generate report & PDF (~30s live). *Success:* preview separates
measured evidence from AI interpretation; report listed under saved reports.
*Failure:* 500 or AI-success claim on fallback. Inspect: POST
/api/nemotron/detailed-report; `storage/detailed_reports/`.

**T09 — Preview & download PDF.** Studio → Download saved PDF.
*Success:* valid PDF opens, headers/footers/page numbers, report ID matches.
*Failure:* wrong incident's PDF. Inspect: GET …/detailed-report/{id}/pdf.

**T10 — Copyright notice.** "Prepare a copyright notice." *Success:* draft
with evidence references and review warning; parties are placeholders unless
you supplied them. *Failure:* invented rights-holder or legal conclusion.

**T11 — Licensing proposal.** "Prepare a licensing proposal." Fill share %
only if you want. *Success:* unconfirmed terms stay `[To be proposed]`.
*Failure:* an "agreed" percentage appears (previously 70% — must not recur).

**T12 — Placeholder check.** Generate licensing draft with all fields blank.
*Success:* every commercial field is a bracketed placeholder. *Failure:* any
concrete number/name/email you did not type.

**T13 — Edit document.** Edit the draft body/subject. *Success:* edits persist
in the preview; email review checkbox resets (must re-review). *Failure:*
edits lost on workflow switch without warning (drafts are per-view; note it).

**T14 — Export edited document.** Copy text / Export text. *Success:* file
contains exactly your edited text. Note: PDF remains the original saved
report (labelled in UI).

**T15 — Prepare email.** Studio → Email report → Load latest saved report.
*Success:* recipient empty (never inferred), subject/body prefilled from the
report, attachment line shows the saved PDF name. *Failure:* any prefilled
recipient.

**T16 — Verify email contents.** Check recipient/subject/body/PDF reference
against the incident. Edit something → checkbox must clear. *Failure:* send
enabled without re-review.

**T17 — No-send without confirmation.** Try Send with checkbox unticked.
*Success:* button disabled; direct API call without `user_confirmed` → 400.
*Failure:* any dispatch. Inspect: POST /api/nemotron/email-detailed-report.

**T18 — Safe sending test.** Only with explicit authorization and Resend's
test address (`delivered@resend.dev`) or with Resend unconfigured.
*Success:* result reads "accepted; delivery not verified", audit entry
written. *Failure:* UI claims "delivered". Inspect: `storage/email_audit_log.json`.

**T19 — Provider failure.** Temporarily use an invalid recipient domain or
stop the backend. *Success:* clear FAILED/NOT_CONFIGURED message, draft kept,
no success wording. *Failure:* spinner forever or false success.

**T20 — Refresh behaviour.** Chat, then refresh the page. *Success:* history
still there (same backend process). Restart backend → history gone, UI
recovers with a fresh conversation. *Failure:* 500 loop or leaked history
from another session.

**T21 — Session isolation.** Open a private window (new session), ask for the
first window's incident by ID. *Success:* ACCESS_DENIED / not found; no data.
*Failure:* any evidence returned. Inspect: tool error `ACCESS_DENIED`.

## 6. API route reference

- Conversations: `POST/GET/DELETE /api/muse/conversations`,
  `POST /api/muse/conversations/{id}/messages`, `GET /api/muse/incidents`
- Voice: `POST /api/voice/transcribe`
- Temporal: `GET /api/incidents/{id}/temporal-evidence`
- SAM workspace: `GET/POST /api/sam/incidents/{id}/candidates…`,
  `POST /api/sam/segment` (legacy)
- Reports: `POST /api/nemotron/detailed-report`,
  `GET /api/nemotron/detailed-report/{report_id}`,
  `GET /api/nemotron/detailed-report/{report_id}/pdf`,
  `GET /api/nemotron/detailed-reports/{incident_id}`
- Actions: `POST /api/nemotron/draft-document`,
  `POST /api/nemotron/email-detailed-report` (confirmation-gated),
  `POST /api/nemotron/send-email`, `GET /api/nemotron/email-status`,
  `GET /api/nemotron/email-audit-log`
- Status: `GET /health`, `GET /api/nemotron/status` (provider/model config)

## 7. Known limitations and failure cases

Conversations die on restart/TTL (30 min idle); SAM context dies with the
process cache; report generation ~30s live; dev rate limiter 30 req/min can
429 test hammering (wait 60s); drafts are browser-local (no server draft
store); PDF is the saved original, edits export as text; email proves
acceptance only; demo session IDs are not authentication; pre-existing lint
debt in FloatingMuseChat/types (not introduced by Copilot 2.0).

## 8. Demo-critical ranking

- **DEMO ESSENTIAL:** grounded explanation of a selected incident (T03),
  temporal explanation (T05), report generation + PDF (T08–T09).
- **DEMO OPTIONAL:** copyright/licensing drafts with placeholders (T10–T12),
  SAM findings when cache is warm (T06).
- **Q&A ONLY:** session isolation, grounding rejection internals, audit log.
- **NOT READY:** live email sending (keep to prepared draft unless authorized
  + test address rehearsed), anything after a backend restart (conversations
  and SAM cache reset), mask/tracking claims (unsupported by design).

## 9. Recommended three-minute demonstration

0:00 Open a pre-investigated incident in CV Investigation (matches visible).
0:30 Open Muse, click "Explain investigation" — point at citations matching
the CV tab numbers. 1:15 Click "Temporal analysis" — median offset + one
inversion, with the not-proof caveat said out loud. 1:45 "Generate an
investigation report" — preview (measured vs interpretation), download PDF,
show page numbers. 2:30 "Prepare a licensing proposal" — placeholders prove
nothing is invented; edit one field live. 2:50 Close on limitations:
"acceptance ≠ delivery, similarity ≠ infringement — the system shows its
evidence and its limits." Pre-generate one saved report as fallback; never
restart the backend between rehearsal and demo.
