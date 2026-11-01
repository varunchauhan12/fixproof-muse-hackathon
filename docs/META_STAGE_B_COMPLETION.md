# Meta Stage B — reasoning migration and requested UI branding

Implemented locally; earlier Phase 0A, Phase 0B and Stage A changes remain pending.
No deployment, commit, push, database operation/migration, cloud change, real .env
inspection/edit, credential exposure, live inference request or email dispatch was
performed. Runtime key loading by the existing application is unchanged.

## Contracts traced before adapting the execution paths

| Operation | Existing input/output | Errors/fallback | Persistence/frontend assumptions |
|---|---|---|---|
| Investigation | Incident + optional force_refresh/model_override -> InvestigationReport | Failed report taxonomy, evidence validation, cached valid reports | Same nemotron_reports persistence and route/schema |
| /diagnose | issue_description -> diagnosis, model, provider | Missing credential 500, request failure 502 | No report persistence; route and schema unchanged |
| Draft polishing | Incident facts + user inputs + use_ai_synthesis -> document dict | Keep deterministic template when unavailable/malformed/failing | Same declarations, statuses, email confirmation gates and caller contract |
| Detailed synthesis | Evidence bundle + optional model_override -> section dict/PDF | Original model fallback on Nemotron; deterministic sections if AI unavailable | Same JSON/PDF disk persistence, PDF format and download routes |

## Implemented provider isolation

Investigation resolves the selected reasoning provider before validating model
overrides. Muse permits only its configured reasoning model and does not reuse
valid Nemotron cached reports. Evidence IDs are validated by the Stage A adapter;
application IDs, intervals and provenance stay application-controlled. URL-only
limitations and mandatory human review are retained. Database names are unchanged.

/diagnose checks only the selected credential. The Muse request never receives
Nebius client options; Nemotron retains its explicit client settings and response
provider name. Response keys, token limit 500 and temperature remain unchanged.

Both draft operations check the selected credential and use the selected model.
Muse-polished documents accurately record the Muse model. Deterministic templates,
wording safeguards in the polishing prompts, output format and fallbacks remain.
No generation step was added to email dispatch and no confirmation boundary changed.
These remain prompt-based polishing safeguards, not a claim that model wording
cannot deviate; authorized human review is still required.

Detailed synthesis uses one Muse model/call and never retries with a Nebius model.
Nemotron retains its existing primary/Lightning sequence. Both validate required
section shapes before marking synthesis successful, so malformed JSON objects do
not produce empty successful PDFs. Existing deterministic fallback still generates
an explicitly non-AI report. PDF formatting, evidence bundle, disk save and API
response shapes are unchanged. Model-independent token budgets and timeouts were
not increased (diagnose 500, drafts 2500, detailed 4000, investigation existing budget).

Production matcher and URL-screening vision resolution now explicitly requests
the Nemotron provider, preventing FIXPROOF_AI_PROVIDER=muse from implicitly
activating Stage C. No CV logic, vision-verifier implementation, cache behavior,
URL validation, session checks, upload validation, signatures or hashing changed.

The existing status endpoint now reports the selected reasoning model and its key
availability independently of the retained Nemotron vision configuration.
Configured/available means configuration is present, not that a live API worked.

## Files changed during Stage B

Backend production:

- backend/app/providers/factory.py — credential-presence helper (returns no key).
- backend/app/main.py — investigation selection/model validation/cache isolation,
  provider-aware diagnose and status; existing route contracts retained.
- backend/app/nemotron_action.py — selected-provider credential/model checks for
  copyright and revenue-share polish, retaining deterministic fallbacks.
- backend/app/detailed_report.py — Muse-only model sequence, structured section
  validation, unchanged PDF/disk behavior and Nemotron fallback sequence.
- backend/app/providers/meta.py — validate JSON-object completion content in adapter.
- backend/app/matcher.py, backend/app/url_screener.py — explicit Nemotron vision pin.

Tests/runner:

- backend/tests/test_meta_reasoning_migration.py (new) — mocked production route and
  function paths; inherits Stage A HTTP transport contract tests.
- backend/tests/test_factory_wiring.py — assertions now require explicit Nemotron
  vision selection; other assertions remain.
- backend/tests/run_phase0a_checks.py — --reasoning mode.
- frontend/tests/test_dashboard_refinement.mjs — expects requested Muse reasoning
  label; still asserts actual Nemotron vision subsystem is retained.

Requested frontend branding, preserving API paths, field names, tab IDs, component
identifiers and historical model provenance:

- frontend/components/dashboard/DashboardConsole.tsx
- frontend/components/dashboard/IncidentResponse.tsx
- frontend/components/dashboard/NemotronCenter.tsx
- frontend/components/dashboard/Overview.tsx
- frontend/components/dashboard/SwarmLogsView.tsx
- frontend/components/dashboard/ThreatHunter.tsx
- frontend/components/landing/AgentScrollStory.tsx
- frontend/components/landing/GridBeamCapabilities.tsx
- frontend/components/layout/Sidebar.tsx
- frontend/components/ui/NvidiaJudgePreloader.tsx
- frontend/lib/api.ts (neutral service-error wording only)
- docs/META_STAGE_B_COMPLETION.md (this report)

Reasoning/navigation copy now uses Muse/Spark 1.3 and Meta Model API. Intro branding
uses Meta judges. Vision copy is neutral where appropriate and retains actual
Nemotron model identifiers on capability/provenance displays: falsely renaming
those to Muse would contradict Stage B's explicit no-vision-migration requirement.
Legacy internal names and /api/nemotron paths are compatibility identifiers, not
proof of which reasoning provider executed. Synthesized log previews no longer
invent a Muse model ID for historical incidents; they point to report provenance.

## Tests and exact results

```sh
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --reasoning
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --meta
backend/.venv/bin/python backend/tests/run_phase0a_checks.py
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --security
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --full
node frontend/tests/test_landing_v2.mjs
node frontend/tests/test_dashboard_refinement.mjs
cd frontend && npm run build
```

| Check | Result |
|---|---|
| Stage B reasoning | 17 passed (includes 13 inherited Stage A tests) |
| Stage A | 13 passed |
| Phase 0A | 91 passed |
| Phase 0B | 10 passed |
| Full isolated backend | 267 run: 247 passed, 8 failures, 5 errors, 7 skips |
| Frontend static suites | Landing 28/28; dashboard refinement 22/22 |
| Webpack production build + TypeScript | Passed |
| Syntax/imports and git diff --check | Passed |

Stage B success/failure tests separately exercise investigation, diagnose,
copyright polish, revenue-share polish and detailed synthesis. Subtests cover
missing keys, malformed content, timeouts, connection/API failure and expected
fallbacks. A guard fails if any Muse operation initializes a Nebius client.
PDF signature is verified, email dispatch is mocked/asserted absent, legacy-cache
reuse is rejected and actual vision provenance is retained. Existing Nemotron
regressions pass via the 91-test suite. No failing baseline assertion was removed.

The full suite has exactly the same failing IDs as the documented baseline:
matcher/forensic unregistered-reference fixtures, session-persistence fixture and
offline storage-delete configuration requirement. Seven live-cloud tests skip.
There are no new backend failures in the comparison; the full suite is not green.

## Running local applications

Backend: http://127.0.0.1:8000 ; frontend: http://127.0.0.1:3000 .
The local backend process uses FIXPROOF_AI_PROVIDER=muse and FIXPROOF_DB_MODE=local
as shell overrides, leaving .env unchanged and avoiding cloud startup reconciliation.
The local reference library may differ from the Supabase-backed session. The actual
backend status reports muse-spark-1.3 for reasoning/detailed reports and
nvidia/Nemotron-3.5-Super-VL for vision. Health returns 200.
Frontend is served from the fresh standalone production build. The dashboard and
Muse page were inspected in the browser with working styling and API status.
No model-generation or email button was triggered. Manual inference remains
untested; the owner must separately authorize live model validation.

## Remaining limits and rollback

Live Meta model entitlement, limits, response quality, latency and agreement with
Nemotron remain unverified. No retries were introduced. Invalid Muse model overrides
fail safely; no provider mixing or silent fallback to Nemotron occurs. Detailed AI
failure still falls back to deterministic sections, and polishing failure retains
templates. Pre-existing deterministic report narrative/authorization/storage
limitations are not claimed fixed. Stage C vision migration was not started.

To roll back runtime reasoning, restart with FIXPROOF_AI_PROVIDER=nemotron; do not
change the real .env unless explicitly desired by the owner. To revert this patch,
undo only the Stage B hunks in the listed files, remove the new reasoning test and
this report, restore the earlier test assertions and remove --reasoning. Preserve
the Phase 0A/0B/Stage A additions in shared files. Undo only the frontend branding
hunks if older display copy is desired. No schema, cloud, dependency or data rollback
is needed. No commit, push or deployment was performed.
