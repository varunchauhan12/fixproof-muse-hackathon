> Latest narrowly scoped provider verification: [Muse-only migration verification](MUSE_ONLY_MIGRATION_VERIFICATION.md). The results below record the preceding migration pass and its disclosed safety exception.

# Muse-only refactor and pre-deployment readiness

Date: 2026-11-03. Baseline actually inspected: `main`, `24930e9` (not the older `6aae7fe` in the request). Working tree initially clean. Remote: `https://github.com/varunchauhan12/fixproof-muse-hackathon.git`. Cached tracking state: 15 ahead, 0 behind `origin/main`. No fetch was performed; live remote state and automatic deployment triggers are unknown. No staging, commit, push, GCP authentication, cloud-console access or deployment was performed.

## Verdict

**NOT READY — FIXES REQUIRED**

The local Muse-only refactor and regression checks pass, but the targeted lint gate still reports 39 pre-existing errors, and the Cloud Run upload-limit discrepancy needs an explicit demo constraint or a separately reviewed solution. Live Muse entitlement, real email delivery, fresh container builds and actual cloud configuration remain unverified. Proceed to a read-only GCP inventory after review; this report is not deployment authorization.

## Safety exception during validation — requires review

I mistakenly selected `frontend/tests/test_addendum_workflow.mjs` before completing its safety inspection. It contacted the existing backend at localhost:8000. It fetched provider status, incident listings, a short summary, a signed evidence ZIP and a nonexistent PDF (404). The summary and ZIP returned 200. The script did not request model inference or email delivery.

The ZIP export GET is **not read-only in cloud mode**: `main.py` uploads to `evidence-packages` and inserts an `evidence_packages` row after constructing the ZIP. HTTP 200 does not establish whether persistence occurred because persistence errors are caught. The process's persistence outcome was not independently inspected, so a new storage object/database row is possible. No compensating deletion, database inspection or record alteration was attempted. Existing records and artifacts were not cleaned up. This prevents a blanket claim that no persistent external data changed. Review this possible package creation separately; do not rerun the script for investigation. No further live integration script was executed. The four frontend live integration scripts now require the explicit test-only `FIXPROOF_ALLOW_LIVE_TESTS=1` opt-in before any request. This is a local test-safety guard, not an application setting or permission to run them. Their syntax was checked without executing them.

All subsequent backend tests used a disposable copy with environment-file loading disabled and socket connections blocked. Frontend regression tests use mocks; the separate dashboard static check additionally blocked global fetch. No live Meta/Nebius model call or email send was requested by these checks. Existing application processes were not restarted.

## Refactor and shared code

- `providers/factory.py` defaults reasoning, vision, voice and SAM to Muse. Every factory rejects unsupported or empty explicit selectors and unsupported environment selectors. There is no fallback to another provider.
- Removed the Nemotron provider, inactive Muse scaffold, old reasoning transport and old vision transport modules.
- `investigation_support.py` contains the original bounded evidence prompt, system prompt, override normalization and explicit failed-report builder. No provider client is present.
- `vision_support.py` contains the original resize/JPEG preparation, model-keyed cache operations and visual comparison prompt. It does not construct an API client. Missing historical cache provenance is `not-recorded`.
- `document_actions.py` preserves the original document templates, incident-fact serialization, optional Muse polishing, explicit confirmation checks, Resend delivery and audit handling. Its live behavior was not exercised.
- Muse reasoning/vision continue to use the existing Meta client. OpenAI SDK remains required for that client; it is not a Nebius-specific dependency. SAM, ASR, CV embeddings, FAISS, FFmpeg, temporal selectors, grounding and approval semantics remain in place.
- Failed Muse requests remain explicit failed/unavailable results. Existing deterministic document/report output is retained, labelled as deterministic/not AI-synthesized with failure metadata; no alternate model/provider is attempted. This is not a successful Muse response.
- Dashboard component/type/callback names and labels are Muse-specific. The prior voice transcript-in-composer behavior is preserved.
- Removed the Dockerfile's historical backend URL default. A frontend build now requires an explicit nonempty `NEXT_PUBLIC_API_URL`.

## API and database compatibility

New canonical prefix: `/api/muse/`. For **each** suffix below, the old `/api/nemotron/` path remains an OpenAPI-hidden alias of the exact same Muse-backed endpoint, with the same validation/session/approval behavior:

| Method | Suffix |
|---|---|
| GET | `status` |
| POST | `draft-document` |
| POST | `send-email` |
| GET | `email-status` |
| GET | `email-audit-log` |
| POST | `detailed-report` |
| GET | `detailed-report/{report_id}` |
| GET | `detailed-report/{report_id}/pdf` |
| GET | `detailed-reports/{incident_id}` |
| POST | `email-detailed-report` |
| GET | `summary-download/{incident_id}` |

All current frontend callers use the canonical prefix. Generated PDF URLs also use it. Investigation routes under `/api/threats`, voice, SAM, summaries, conversations, health and vault routes remain unchanged.

The `nemotron_reports` database table and local `storage/nemotron_reports.json` filename remain intentionally unchanged. Registry function names are neutral (`get_investigation_*`, `save_investigation_report`, `load_investigation_reports`). No migration, table, bucket or historical record was deleted/renamed. Historical model IDs are preserved exactly. Detailed report synthesis no longer relabels historical vision evidence as the currently selected Muse model. Evidence package provenance uses the recorded model, or `not-recorded`, rather than inventing a legacy default. Missing report-history model IDs also stay `not-recorded`.

### Frontend API-call audit

A TypeScript-AST inventory found 42 API string/template expressions across `app`, `components`, `lib`, `hooks`, and `context`. 38 match backend decorator routes directly. Four dynamic expressions were checked manually:

- `email-audit-log${q}` adds only a query string.
- `evidence-summaries/${kind}/pdf${...}` adds an optional `summary_id` query.
- Conversation `actions/${actionId}/${cancel ? ...}` resolves to registered approve/cancel routes.
- `SAMWorkspaceClient.request` appends candidates/frames/automatic suffixes to its base prefix; these match the existing SAM router.

This is source contract coverage, not a claim of live success for every workflow. The offline endpoint tests cover the retained aliases and representative request/response validation.

## Exact runtime environment allowlist

Required for full Muse AI operation: `MODEL_API_KEY` (backend secret). `FIXPROOF_AI_PROVIDER=muse` is recommended explicitly, but omission now selects Muse.

Optional Muse variables: `MUSE_BASE_URL` (default `https://api.meta.ai/v1`), `MUSE_REASONING_MODEL` (default `muse-wonder-1.0`), `MUSE_VISION_MODEL` (`muse-spark-1.3`), `MUSE_SAM_MODEL` (`sam-3.1`), `MUSE_VOICE_MODEL` (`muse-voice-transcribe-1.0`), `MUSE_REASONING_EFFORT` (validated supported values only), `MUSE_TIMEOUT_SEC` (positive finite seconds; operation-specific ceilings still apply), `MUSE_MAX_TOKENS` (default 16384), `MUSE_CONVERSATION_TTL_SECONDS` (default 1800). Leave defaults unless the Meta entitlement and contract support the override.

Database/storage: set `FIXPROOF_DB_MODE=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (backend secret) and `SUPABASE_DB_URL` (backend secret including password). `DATABASE_URL` and `POSTGRES_URL` are accepted DB URL aliases; **use SUPABASE_DB_URL for the full application**, because vault/cloud-ingest paths read fewer aliases. Do not configure multiple conflicting URLs. `STORAGE_BACKEND` is a backward-compatible mode alias; omit it when using `FIXPROOF_DB_MODE`.

Component DB fields `SUPABASE_DB_HOST`, `SUPABASE_DB_USER`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_NAME`, `SUPABASE_DB_PORT` are supported by DB configuration when no URL exists; omit for the deployment above. Optional DB controls: `SUPABASE_DB_SSLMODE` (require), `SUPABASE_DB_TIMEOUT_SEC` (10), `SUPABASE_DB_MAX_CONNECTIONS` (10). `SUPABASE_ANON_KEY` is an accepted storage fallback; omit it for backend private-bucket access and use the service-role key. No Supabase credential belongs in the frontend.

Email: `RESEND_API_KEY` (backend secret), `FROM_EMAIL` (verified sender), `MUSE_REGISTERED_EMAIL` (fixed approved demo destination). Omit all three if email is intentionally unavailable; preparation/PDF functionality still exists, sending must report unavailable. The code's default sender is not proof of domain verification.

Signing/export: choose one of `FIXPROOF_SIGNING_KEY_HEX` or `FIXPROOF_SIGNING_KEY_PEM` (backend secrets), or mount a private secret file and use `FIXPROOF_SIGNING_KEY_PATH`. Optional `FIXPROOF_SIGNING_KEY_ID`; recommend `FIXPROOF_REQUIRE_CONFIGURED_SIGNING_KEY=true` for deployed signed exports. Without configured signing and without the require flag, the existing development-key behavior is unsuitable for stable deployment provenance.

Backend security/deployment: `FIXPROOF_ENV=production`, `FIXPROOF_CORS_ORIGINS` with the exact frontend HTTPS origin, `FIXPROOF_DEMO_MODE` (explicit demo decision; production environment currently forces demo-mode off), `FIXPROOF_RATE_LIMIT_PER_MINUTE` (30 by default). `PORT` is supplied by Cloud Run and respected by the Docker command. `PYTHONDONTWRITEBYTECODE=1` and `PYTHONUNBUFFERED=1` are Docker defaults. `KMP_DUPLICATE_LIB_OK` is set by application code for the existing Torch/FAISS integration; no user setting is required. Library-managed variables such as `TORCH_HOME`/proxy settings are not application configuration reads.

Frontend build time: `NEXT_PUBLIC_API_URL` must be the **later verified final backend service URL**. It is compiled into browser bundles. A runtime-only environment edit cannot change that bundle. `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1` are Docker defaults; runtime `PORT=8080`, `HOSTNAME=0.0.0.0` are runner defaults. No frontend secrets are required.

### Variables safe to remove/omit

From the retired runtime reads: `DETAILED_REPORT_MODEL`, `NEBIUS_API_KEY`, `NEBIUS_BASE_URL`, `NEBIUS_MAX_TOKENS`, `NEBIUS_MODEL`, `NEBIUS_TIMEOUT_SEC`. Remove these manually from the **new release configuration only after review**; no local `.env`, `.env.example` or cloud secret was modified. Omit any additional `NEBIUS_*` entries: no application module reads them now. `DETAILED_REPORT_MODEL` is retired in favor of the selected Muse reasoning model. Removing a local variable does not revoke a key; cloud secret deletion/rotation is outside this task.

For the full-demo allowlist above, also omit redundant `DATABASE_URL`, `POSTGRES_URL`, component DB fields, `STORAGE_BACKEND`, `SUPABASE_ANON_KEY`, unused signing formats, and all optional Muse/DB tuning variables whose defaults suffice. Email variables may be omitted only if sending is not part of the demo. Persistent configured signing is required for stable exported evidence identity.

### All direct backend environment reads (names and source locations only)

| Variable | Source reads |
|---|---|
| `DATABASE_URL` | `backend/app/db.py:101`; `backend/app/db.py:309`; `backend/app/cloud_ingest.py:68`; `backend/app/vault.py:134`; `backend/app/vault.py:453`; `backend/app/vault.py:542` |
| `FIXPROOF_AI_PROVIDER` | `backend/app/providers/factory.py:11` |
| `FIXPROOF_CORS_ORIGINS` | `backend/app/security.py:14` |
| `FIXPROOF_DB_MODE` | `backend/app/db.py:80`; `backend/app/storage.py:83` |
| `FIXPROOF_DEMO_MODE` | `backend/app/security.py:35` |
| `FIXPROOF_ENV` | `backend/app/security.py:32` |
| `FIXPROOF_RATE_LIMIT_PER_MINUTE` | `backend/app/security.py:61` |
| `FIXPROOF_REQUIRE_CONFIGURED_SIGNING_KEY` | `backend/app/evidence_package.py:91` |
| `FIXPROOF_SIGNING_KEY_HEX` | `backend/app/evidence_package.py:87` |
| `FIXPROOF_SIGNING_KEY_ID` | `backend/app/evidence_package.py:90` |
| `FIXPROOF_SIGNING_KEY_PATH` | `backend/app/evidence_package.py:89` |
| `FIXPROOF_SIGNING_KEY_PEM` | `backend/app/evidence_package.py:88` |
| `FROM_EMAIL` | `backend/app/document_actions.py:36`; `backend/app/detailed_report.py:1910` |
| `MODEL_API_KEY` | `backend/app/main.py:1391`; `backend/app/providers/factory.py:39`; `backend/app/providers/meta_client.py:35` |
| `MUSE_BASE_URL` | `backend/app/providers/meta_client.py:38` |
| `MUSE_CONVERSATION_TTL_SECONDS` | `backend/app/muse_conversations.py:162` |
| `MUSE_MAX_TOKENS` | `backend/app/detailed_report.py:615`; `backend/app/providers/meta.py:258` |
| `MUSE_REASONING_EFFORT` | `backend/app/providers/meta.py:217` |
| `MUSE_REASONING_MODEL` | `backend/app/providers/meta.py:103` |
| `MUSE_REGISTERED_EMAIL` | `backend/app/muse_actions.py:65` |
| `MUSE_SAM_MODEL` | `backend/app/providers/sam.py:187` |
| `MUSE_TIMEOUT_SEC` | `backend/app/providers/meta_client.py:25` |
| `MUSE_VISION_MODEL` | `backend/app/providers/meta.py:45` |
| `MUSE_VOICE_MODEL` | `backend/app/providers/voice.py:20` |
| `POSTGRES_URL` | `backend/app/db.py:102` |
| `RESEND_API_KEY` | `backend/app/document_actions.py:35` |
| `STORAGE_BACKEND` | `backend/app/db.py:80`; `backend/app/storage.py:83` |
| `SUPABASE_ANON_KEY` | `backend/app/storage.py:65` |
| `SUPABASE_DB_HOST` | `backend/app/db.py:106` |
| `SUPABASE_DB_MAX_CONNECTIONS` | `backend/app/db.py:124` |
| `SUPABASE_DB_NAME` | `backend/app/db.py:109` |
| `SUPABASE_DB_PASSWORD` | `backend/app/db.py:108` |
| `SUPABASE_DB_PORT` | `backend/app/db.py:110` |
| `SUPABASE_DB_SSLMODE` | `backend/app/db.py:122` |
| `SUPABASE_DB_TIMEOUT_SEC` | `backend/app/db.py:123` |
| `SUPABASE_DB_URL` | `backend/app/db.py:100`; `backend/app/db.py:309`; `backend/app/cloud_ingest.py:68`; `backend/app/vault.py:134`; `backend/app/vault.py:453`; `backend/app/vault.py:542` |
| `SUPABASE_DB_USER` | `backend/app/db.py:107` |
| `SUPABASE_SERVICE_ROLE_KEY` | `backend/app/storage.py:64` |
| `SUPABASE_URL` | `backend/app/storage.py:63` |

## Docker and deployment preparation

| Setting | Backend | Frontend |
|---|---|---|
| Build context | `backend/` | `frontend/` |
| Dockerfile relative to context | `Dockerfile` | `Dockerfile` |
| Base | Python 3.11 slim | Node 20 Alpine; standalone multi-stage Next build |
| Port | `${PORT:-8080}` | `${PORT}`; default 8080 |
| Command | `uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}` | `node server.js` |
| Build arguments | None | `NEXT_PUBLIC_API_URL` required |
| Runtime secrets | Meta, DB URL, service-role, optional Resend and signing | None |
| Health | `/health` or `/api/health` | `/` or `/dashboard` |

Backend installs FFmpeg/OpenCV system libraries and CPU Torch/torchvision wheels before Python requirements. OpenAI SDK is retained for Muse. Backend copies only `app`, migrations and scripts, and creates writable storage directories. Its ignore file now excludes **all `.env*` files**, Git metadata and logs in addition to storage/venv/tests. Frontend ignores all `.env*`, dependencies, build outputs and tests. Neither image should contain local credentials or storage datasets. Docker image builds were not executed; the production Next build was executed locally.

Deploy independently, then build frontend with the verified backend URL. No old URL in historical documentation is canonical. Browser-to-backend requests use a session header and CORS; the current frontend does not mint Cloud Run IAM identity tokens. Configure ingress/auth deliberately during inventory; do not deploy a public unauthenticated demo without accepting its existing session-only security boundary. No authentication architecture was added.

Health verifies process availability, **not** Meta entitlement, Supabase consistency, email deliverability, or warmed model weights. `/api/muse/status` explicitly reports configuration scope, not live provider success. `/api/vault/status` reads registry state; `/api/vault/sync`, evidence export, report generation, SAM inference, summary generation and email routes are not read-only smoke tests.

### Supabase dependencies — inventory only

Nine existing application tables: `reference_assets`, `reference_frames`, `reference_vectors`, `investigation_jobs`, `incidents`, `nemotron_reports`, `vault_snapshots`, `vision_verifications`, `evidence_packages`.

Six private buckets: `reference-assets`, `reference-frames`, `vault-snapshots`, `suspect-videos`, `suspect-frames`, `evidence-packages`. Keep existing migrations `001_initial_schema.sql` and `002_cloud_persistence_expansion.sql`. `initialize_new_project.py` requires verified project identity and an empty public schema; it was not executed. Use the Supabase dashboard later to verify actual schema, bucket privacy and access. No live project identity or table/bucket existence is claimed here.

Normal application startup can hydrate/reconcile/checkpoint the cloud vault. The test startup ran only with local mode in a disposable copy. Starting the cloud-configured app is not a read-only connectivity check.

### Initial Cloud Run settings — recommendations requiring measurement

| Setting | Backend | Frontend |
|---|---|---|
| CPU | 4 vCPU | 1 vCPU |
| Memory | 8 GiB | 512 MiB; raise to 1 GiB if measured pressure |
| Request timeout | 900 seconds | 300 seconds |
| Concurrency | 1 | 20 |
| Min instances | 1 during scheduled demo; 0 outside if cold starts accepted | 0, or 1 for demo responsiveness |
| Max instances | 1 for current demo state model | 2 |
| Processes | Existing single Uvicorn process | Existing single standalone server |

These are conservative starting settings, not benchmark-derived optima. Video decode, CPU Torch, FAISS and temporary media compete for CPU/RAM. Keep short demo clips and monitor peak RSS, filesystem use, latency and memory terminations. The writable Cloud Run filesystem uses instance memory and is ephemeral ([runtime contract](https://docs.cloud.google.com/run/docs/container-contract)). Low concurrency is appropriate to test first for global/process-local state and expensive work ([concurrency guidance](https://docs.cloud.google.com/run/docs/about-concurrency)).

In-memory conversations, pending approvals, caches and local report/audit files disappear on restart and are not shared between instances or revisions. Backend max=1 reduces cross-instance routing problems but does not guarantee persistence or prevent rolling-revision overlap. Session affinity does not guarantee returning to the same instance ([session affinity](https://docs.cloud.google.com/run/docs/configuring/session-affinity)). Cloud vault snapshots are durable, but unrelated local summaries/reports/email audits are not automatically made durable by Supabase mode. Do not add workers or scale the backend horizontally without a separate state/persistence review.

**HIGH: HTTP upload limit.** Current Uvicorn serves HTTP/1. Cloud Run limits HTTP/1 request bodies to 32 MiB, including multipart overhead ([quotas](https://docs.cloud.google.com/run/quotas)); application UI/server limits can be larger. Use clips comfortably under 30 MiB for the demo, or approve a separate upload architecture fix. Increasing timeout does not lift the body limit. The 900-second recommendation is within the service maximum, but client/provider deadlines remain independent ([request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout)).

MobileNetV3 pretrained weights are loaded lazily by Torchvision. The image currently does not prefetch them; first embedding extraction may require outbound download and adds latency. Verify egress/cache availability in a fresh image. No dependency lock/pinning change or weight download was introduced by this refactor.

## Verification and limitations

- Backend: `backend/.venv/bin/python -B backend/tests/run_phase0a_checks.py --release` — **599 run, 592 passed, 7 skipped, 0 failures/errors**. Explicit module list; disposable source copy; no `.env`; sockets blocked. Tests include actual local FastAPI startup/health, all four Muse-only factory defaults/rejections, missing-key handling, removed transports, alias identity, mocked SDK reasoning/vision/ASR/SAM, CV/ingest/vault, conversations/grounding/tools/actions, report/PDF rendering, approval guards, signatures/exports and storage mocks.
- Frontend: explicit safe list of voice, widget, workflow, evidence-summary, temporal, SAM, investigation and forensic tests — **119 passed**. Separate static dashboard refinement script with fetch blocked — **1 passed**. Earlier wrong-directory invocation failed two tests due to relative paths; correct repository-root execution passes.
- TypeScript: `tsc --noEmit --incremental false` passed. Production `next build --webpack` passed.
- Targeted ESLint: **39 errors** across six touched files; baseline comparison using committed content and the same local ESLint configuration found **39 errors before and after**. Files: DashboardConsole (5), IncidentResponse (14), SwarmLogsView (2), ActivityContext (1), types (2), MuseCenter/previous NemotronCenter (15). These are existing hook-effect/typing issues; they were not suppressed or expanded into an unrelated UI rewrite. This lint gate does not pass.
- `git diff --check` passed. No dependency install or Docker image build. No live Meta integration was run. Browser physical-microphone, actual fresh image processing, provider entitlement, email-domain deliverability, GCP secrets/IAM/CORS, DB connectivity and real Supabase behavior need later authorized validation.
- Existing API safety tests remain. Old provider-only transport tests were retired; shared timeline, grounding, persistence, storyboard and cache checks were retained and switched to neutral imports. Negative tests verify legacy selection cannot be used. Tests retain historical model-ID fixtures intentionally.

## Remaining references and next steps

Runtime **provider/transport/config** references to Nemotron/Nebius: zero. Active frontend provider references: zero. Necessary backend compatibility names remain only in hidden legacy HTTP routes, historical `nemotron_reports` schema/local filename and related comments/SQL. Migration/schema scripts intentionally preserve that table. Tests retain legacy-name rejection and historical-provenance fixtures. Earlier docs, pasted milestone narratives and historical validation reports remain historical records; the README now points to this report as current configuration. No `.env` file was edited.

Before deployment: review the accidental ZIP-export side-effect possibility; resolve/accept the separately identified pre-existing lint gate; enforce a small-clip demo constraint or approve an upload solution; inventory actual GCP services/revisions/triggers, final URLs and secret versions through the browser; verify the correct Supabase project/table/bucket configuration without mutations; review explicit demo access and signing settings; then separately authorize fresh-image and bounded live smoke tests. No deployment is authorized by completing this local refactor.

## Frontend API source map

Path shapes use `{param}` for dynamic TypeScript expressions; query strings are excluded. Backend methods list all registered methods for that shape.

| Frontend source | API path shape | Backend method/source |
|---|---|---|
| `frontend/lib/api.ts` | `/api/sessions` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/vault/status` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/vault/assets` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/vault/assets/{param}` | GET `backend/app/main.py`; DELETE `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/vault/ingest` | POST `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/vault/index/{param}` | POST `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/threats/scan` | POST `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/threats/screen-url` | POST `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/incidents` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/threats/{param}/report` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/threats/{param}/reports` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/threats/reports/{param}` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/threats/{param}/investigate` | POST `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/threats/{param}/reports/export` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/threats/reports/verify-package` | POST `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/vault/assets/{param}/video` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/vault/assets/{param}/frames/{param}` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/muse/status` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/muse/draft-document` | POST `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/muse/send-email` | POST `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/muse/email-status` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/muse/detailed-report` | POST `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/muse/detailed-report/{param}/pdf` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/muse/detailed-report/{param}` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/muse/detailed-reports/{param}` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/muse/email-detailed-report` | POST `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/muse/summary-download/{param}` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/incidents/{param}/frames/{param}/annotated` | GET `backend/app/main.py` |
| `frontend/lib/api.ts` | `/api/incidents/{param}/sam-investigation` | POST `backend/app/main.py` |
| `frontend/lib/evidence-summaries.ts` | `/api/incidents/{param}/evidence-summaries/{param}` | GET `backend/app/evidence_summary_api.py`; POST `backend/app/evidence_summary_api.py` |
| `frontend/lib/muse-assistant.ts` | `/api/muse/incidents` | GET `backend/app/muse_conversation_api.py` |
| `frontend/lib/muse-assistant.ts` | `/api/voice/transcribe` | POST `backend/app/voice_api.py` |
| `frontend/lib/muse-assistant.ts` | `/api/muse/conversations/{param}` | GET `backend/app/muse_conversation_api.py`; DELETE `backend/app/muse_conversation_api.py` |
| `frontend/lib/muse-assistant.ts` | `/api/muse/conversations` | POST `backend/app/muse_conversation_api.py` |
| `frontend/lib/muse-assistant.ts` | `/api/muse/conversations/{param}/messages` | POST `backend/app/muse_conversation_api.py` |
| `frontend/lib/temporal-evidence.ts` | `/api/incidents/{param}/temporal-evidence` | GET `backend/app/temporal_evidence_api.py` |
| `frontend/context/ActivityContext.tsx` | `/api/muse/status` | GET `backend/app/main.py` |

The four composed-path cases are explained in the API audit section above. No unmatched endpoint was inferred solely from a dynamic prefix.

## Exact changed-file inventory

Status against `24930e9`. Deleted and new paths include neutral renames/extractions; all changes remain unstaged.

```text
 M README.md
 M TESTING_AND_VALIDATION.md
 M backend/.dockerignore
 M backend/app/detailed_report.py
 M backend/app/evidence_models.py
 M backend/app/evidence_package.py
 M backend/app/main.py
 M backend/app/muse_actions.py
 M backend/app/muse_tools.py
 D backend/app/nemotron_action.py
 D backend/app/nemotron_engine.py
 M backend/app/providers/__init__.py
 M backend/app/providers/base.py
 M backend/app/providers/factory.py
 M backend/app/providers/meta.py
 D backend/app/providers/muse.py
 D backend/app/providers/nemotron.py
 M backend/app/registry.py
 D backend/app/vision_verifier.py
 M backend/tests/run_copilot_offline.py
 M backend/tests/run_phase0a_checks.py
 M backend/tests/test_copilot_workflows.py
 M backend/tests/test_detailed_report.py
 M backend/tests/test_evidence_package.py
 M backend/tests/test_factory_wiring.py
 M backend/tests/test_forensic_output_quality.py
 M backend/tests/test_forensic_report_pdf.py
 M backend/tests/test_meta_provider.py
 M backend/tests/test_meta_reasoning_migration.py
 M backend/tests/test_meta_vision_migration.py
 M backend/tests/test_muse_demo.py
 M backend/tests/test_muse_tools.py
 D backend/tests/test_nemotron_action.py
 D backend/tests/test_nemotron_engine.py
 M backend/tests/test_pdf_retrieval_stabilization.py
 M backend/tests/test_phase_3_1.py
 D backend/tests/test_provider_parity.py
 M backend/tests/test_report_history.py
 M backend/tests/test_temporal_consumers.py
 M backend/tests/test_vision_verifier.py
 M backend/tests/test_voice_provider.py
 M frontend/Dockerfile
 M frontend/components/dashboard/DashboardConsole.tsx
 M frontend/components/dashboard/ForensicEvidenceExperience.tsx
 M frontend/components/dashboard/IncidentResponse.tsx
 D frontend/components/dashboard/NemotronCenter.tsx
 M frontend/components/dashboard/SecondaryViews.tsx
 M frontend/components/dashboard/SwarmLogsView.tsx
 M frontend/components/layout/Sidebar.tsx
 M frontend/components/muse/MuseDocumentWorkspace.tsx
 M frontend/context/ActivityContext.tsx
 M frontend/lib/api.ts
 M frontend/lib/types.ts
 M frontend/tests/test_addendum_workflow.mjs
 M frontend/tests/test_dashboard_refinement.mjs
 M frontend/tests/test_detailed_report_integration.mjs
 M frontend/tests/test_forensic_evidence_experience.mjs
 M frontend/tests/test_investigation_integration.mjs
 M frontend/tests/test_muse_workflows.mjs
 D frontend/tests/test_nemotron_action_integration.mjs
?? backend/app/document_actions.py
?? backend/app/investigation_support.py
?? backend/app/vision_support.py
?? backend/tests/test_document_actions.py
?? backend/tests/test_investigation_support.py
?? backend/tests/test_muse_only.py
?? docs/MUSE_ONLY_RELEASE_READINESS.md
?? frontend/components/dashboard/MuseCenter.tsx
?? frontend/tests/test_muse_action_integration.mjs
```
