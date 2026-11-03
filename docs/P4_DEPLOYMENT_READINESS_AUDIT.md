# FIXPROOF P4 — DEPLOYMENT READINESS & SUPABASE INTEGRATION AUDIT

Audit date: 2026-11-03. Read-only; no code, config, data, or Git state changed;
no migrations run; no emails sent; no secrets printed (names/presence only).
Working tree at audit start: `2da94ab` plus uncommitted follow-up edits to
`backend/app/muse_actions.py`, `backend/tests/test_muse_approvals.py`,
`docs/MUSE_COPILOT_2_IMPLEMENTATION.md` — preserved untouched.

## 1. Executive verdict

**CONDITIONALLY READY for a controlled hackathon demo; NOT production-ready.**

Deployable today: the two-service Cloud Run shape is correct and the Docker
builds pass. Likely to fail if deployed naively: (a) the public backend URL
currently answers HTTP 403 from outside; (b) detailed reports, conversations,
and SAM results live in process-local/disk state and vanish on restart or
instance change; (c) ~25 consumed environment variables are missing from
`.env.example`, so a fresh environment configured from the template will
misbehave silently (Resend, CORS, demo mode, rate limit, timeouts).

Already verified (this session): git clean baseline history, local servers
healthy, backend suites (128 + 79), offline action harness (42), frontend
111/111, TypeScript clean, production frontend build passes, migrations
001+002 cover the 9 tables the code queries, all six Storage buckets are
referenced by their exact current names in code.

Still unknown: live Cloud Run IAM/ingress state, RLS/storage policies in the
actual Supabase project, Resend domain verification, and real Muse entitlement
at production scale — none can be confirmed without authenticated cloud access
(gcloud has no credentials on this machine; earlier `auth list` was empty).

## 2. Actual architecture (implemented, not planned)

```text
Browser (Next.js standalone, :3000 dev / :8080 container)
  └─ frontend/lib/api.ts  API_BASE = NEXT_PUBLIC_API_URL (build-time)
       └─ FastAPI backend/app/main.py (:8000 dev / :8080 container)
            ├─ CV: extractor → matcher/vault (FAISS, in-memory + snapshots)
            ├─ Temporal: temporal_evidence.py (deterministic, stateless)
            ├─ SAM: providers/sam.py + sam_workspace.py (PROCESS CACHE 30m)
            ├─ Muse: muse_orchestrator → muse_tools (6 read tools)
            │        → providers/meta.py (api.meta.ai/v1, Bearer MODEL_API_KEY)
            │        → muse_actions.py (approval-only; Resend via
            │          detailed_report.send_detailed_report_email)
            ├─ Reports: detailed_report.py → storage/detailed_reports/ (DISK)
            └─ Data: registry.py/db.py → Supabase Postgres (psycopg)
                     + Supabase Storage REST (storage.py, signed URLs)
External: Meta Model API, Nebius (retained fallback), Resend, yt-dlp targets.
```

## 3. Supabase readiness

| Area | Score | Evidence |
|---|---|---|
| DB connectivity | 7/10 | `db.py` fail-fast mode select (`FIXPROOF_DB_MODE`/`STORAGE_BACKEND`, default `local`); cloud requires `SUPABASE_DB_URL`; never silently falls back. Local mode ≠ production data — a mis-set mode yields an empty-but-healthy app. |
| Schema/migrations | 8/10 | `001_initial_schema.sql` + `002_cloud_persistence_expansion.sql` create the exact 9 tables queried (`reference_assets/frames/vectors`, `investigation_jobs`, `incidents`, `nemotron_reports`, `vault_snapshots`, `vision_verifications`, `evidence_packages`). No migration needed for Muse/temporal/SAM (they add no tables). A clean project can be initialised from these two files + bucket creation (buckets are NOT in migrations — console/API step). |
| Storage | 7/10 | All six buckets referenced by exact name: `reference-assets` (5), `reference-frames` (7), `vault-snapshots` (8), `suspect-frames` (6), `suspect-videos` (2), `evidence-packages` (1) call sites. Signed URLs via service-role server-side client (`storage.py`). |
| RLS | Unknown | 002 enables RLS with public-read SELECT on 6 tables; write paths use the service-role key server-side (bypasses RLS by design). Live policy state in the real project was not inspectable. |
| Persistence | 4/10 | Incidents/vault/packages are durable; detailed reports (disk), conversations (memory), SAM (memory) are not. See §5. |
| Security | 4/10 | Service-role key never reaches the frontend (verified: no Supabase keys in `frontend/`). But session IDs are client-chosen demo identifiers (`muse_conversations.validate_session` checks shape only); demo mode can widen reads (`security.py:is_demo_mode`). Not authentication. |

## 4. Environment variable matrix (names only)

Required in production: `NEXT_PUBLIC_API_URL` (frontend, **build-time**),
`FIXPROOF_DB_MODE=supabase`, `SUPABASE_DB_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `MODEL_API_KEY`, `MUSE_REGISTERED_EMAIL`
(chat-email feature), `RESEND_API_KEY`, `FROM_EMAIL`,
`FIXPROOF_SIGNING_KEY_HEX`, `FIXPROOF_CORS_ORIGINS` (exact frontend origin —
default is localhost-only, `security.py:14`).

Optional/tuning: `MUSE_BASE_URL`, `MUSE_REASONING_MODEL` (`muse-wonder-1.0`),
`MUSE_VISION_MODEL` (`muse-spark-1.3`), `MUSE_SAM_MODEL` (`sam-3.1`),
`MUSE_VOICE_MODEL`, `MUSE_TIMEOUT_SEC`, `MUSE_MAX_TOKENS`,
`MUSE_CONVERSATION_TTL_SECONDS`, `FIXPROOF_RATE_LIMIT_PER_MINUTE` (30),
`FIXPROOF_AI_PROVIDER` (`muse` default; `nemotron` rollback),
`FIXPROOF_SIGNING_KEY_ID/PATH/PEM`, `FIXPROOF_REQUIRE_CONFIGURED_SIGNING_KEY`.

Feature-gated fallback (retained): `NEBIUS_API_KEY/MODEL/BASE_URL/TIMEOUT_SEC/MAX_TOKENS`.

**Template gap (concrete):** `.env.example` omits ~25 consumed variables,
including production-critical `RESEND_API_KEY`, `FROM_EMAIL`,
`FIXPROOF_CORS_ORIGINS`, `FIXPROOF_DEMO_MODE`/`FIXPROOF_ENV`, and all
`SUPABASE_DB_*` discrete fields. Anyone configuring production from the
template gets: email silently unconfigured, CORS rejecting the real frontend
origin, and local-mode defaults. Fix = documentation-only update of
`.env.example` (names + empty values).

## 5. Workflow persistence matrix (verified)

| Workflow | Stores | Retrieves | Survives restart? |
|---|---|---|---|
| Open investigation | Postgres `incidents` (cloud) / local JSON | registry | Yes (cloud) |
| CV candidates | incident record (JSONB-ish fields) | matcher output persisted in incident | Yes (cloud) |
| Reference/suspect frames | Storage buckets + local cache fallback | signed URL / frame routes | Yes (buckets) |
| Temporal evidence | recomputed deterministically per request | `/api/incidents/{id}/temporal-evidence` | Yes (pure function) |
| SAM inference + cache | **process memory only** (30-min TTL, ≤64) | sam_workspace cache | **No** |
| Muse conversation | **process memory only** (TTL 1800s, ≤256) | conversation API | **No** |
| Muse tools/citations | stateless reads of incident data | per-turn | Yes (source data) |
| Action proposals/approvals | in-turn artifacts + audit JSON on disk | chat state | Partial (audit persists; pending approvals do not) |
| Report generation | **local disk** `storage/detailed_reports/` (detailed_report.py:73) | disk search dirs | **No** (lost on new instance) |
| Saved report retrieval | disk | listing endpoints | **No** across instances |
| PDF download | rendered/stored on disk | pdf endpoints | **No** across instances |
| Evidence packages | `evidence-packages` bucket + table | export/verify routes | Yes |
| Footage upload | buckets (cloud) / local storage (local mode) | vault routes | Yes (cloud) |
| Document drafts | browser-only state | — | No (by design) |
| Email draft + approval | browser + in-turn state; send via Resend | audit log JSON on disk | Audit yes; draft no |

**Reports (special attention):** still disk-based. On Cloud Run the filesystem
is ephemeral and per-instance: after restart/scale-out, previously generated
reports 404, listings empty, PDFs undownloadable; regeneration is safe
(deterministic inputs) but costs a ~30s provider call each time. No Supabase
Storage integration for detailed reports exists today (buckets cover evidence
packages, not report PDFs). For the demo: single pinned instance + pre-generated
report on that instance, or accept regeneration.

**Muse (special attention):** browser refresh survives (same process);
conversation close/restart/instance replacement loses history and pending
approvals. This is the top demo risk (see §9).

**SAM (special attention):** results exist only in the serving process.
Restart, eviction (65th target), TTL (30 min), or a second instance all yield
honest "unavailable/expired" — correct behaviour, wrong demo timing if unplanned.

## 6. Deployment blockers

| # | Severity | Location | Issue |
|---|---|---|---|
| B1 | **Critical** | Cloud Run ingress (no repo file) | Public backend URL returns Google HTML 403 to unauthenticated curl (reproduced twice). Evidence points to the edge/IAM layer, not the app: the app returns JSON errors; Google's HTML 403 page + healthy local service indicate requests never reach FastAPI. Likely `--allow-unauthenticated` absent or org policy. Diagnosis is INFERRED — no authenticated gcloud on this machine to confirm. Fix requires explicit owner approval in Cloud Console; do not weaken security blindly — confirm the intended public surface first. |
| B2 | **Critical** | `backend/app/detailed_report.py:73` | Reports/PDFs on ephemeral disk; multi-instance or restart loses them (§5). Demo fix: 1 pinned instance + pre-generated artefacts. Real fix (future): report PDFs to `evidence-packages`-style bucket. |
| B3 | **High** | `backend/app/muse_conversations.py:140` | Conversations/approvals process-local; Cloud Run scale-out or restart breaks chat mid-demo. Demo fix: `--min-instances=1 --max-instances=1`, session affinity not available — accept single instance. |
| B4 | **High** | `backend/app/sam_workspace.py:102` | SAM cache process-local (same mitigation as B3; run SAM shortly before presenting). |
| B5 | **High** | `backend/.env.example` | ~25 consumed vars undocumented (§4) → silent feature loss in fresh deploys. Docs-only fix. |
| B6 | **Medium** | `frontend/Dockerfile:21` | Build-arg default points at `fixproofbackendv2-…run.app`, while earlier docs/commits reference `fixproof-backend-meta-…run.app`. Two backend identities exist in project history. A frontend built without an explicit `--build-arg NEXT_PUBLIC_API_URL` may target the wrong backend. Decide the canonical backend and pin the arg explicitly at build time. |
| B7 | **Medium** | `frontend/lib/api.ts:24` | Non-Docker fallback is `http://127.0.0.1:8000`. Harmless inside Docker (ARG wins) but any standalone `next start` outside Docker points judges' browsers at their own localhost. Keep Docker as the only production path. |
| B8 | **Medium** | `backend/app/security.py:14` + rate limiter | CORS defaults to localhost origins; production must set `FIXPROOF_CORS_ORIGINS` to the exact frontend origin or every browser call fails. 30 req/min limiter will 429 load-test-style clicking (observed in test suites). |
| B9 | **Low** | `backend/app/db.py:80` | Default mode is `local`; a missing `FIXPROOF_DB_MODE` yields a healthy but empty app (silent divergence risk for operators, mitigated by fail-fast only in cloud direction). Set explicitly in the service env. |

## 7. Deployment checklist (sequential)

1. Supabase: run `001`, `002`; create the six buckets (private); confirm RLS
   state; note service-role key stays server-side only.
2. Decide canonical backend URL (resolves B6); resolve B1 ingress decision
   with the account owner (public vs authenticated frontend→backend).
3. Backend service env: all §4 required vars; `FIXPROOF_DB_MODE=supabase`;
   `FIXPROOF_CORS_ORIGINS=<frontend origin>`; min=max=1 instance initially;
   request timeout ≥ 300s (30s reports, 50MB uploads); memory ≥ 2Gi (FAISS/torch).
4. Build backend image (root or `backend/Dockerfile`, port 8080); deploy;
   `GET /health` from outside must return JSON 200 (not Google 403 HTML).
5. Build frontend with explicit `--build-arg NEXT_PUBLIC_API_URL=<backend>`;
   deploy; open the public URL.
6. Smoke (public): open investigation → CV tab → temporal tab → Muse explain
   → generate/load report → download PDF → prepare email draft (no send
   without authorization) → session-isolation spot check.
7. Demo prep: pre-generate the report, run SAM within 30 min of presenting,
   never restart the backend afterwards; record a backup video.

## 8. Safe deployment plan

Safe without further approval: documentation fixes (B5), local builds/tests,
read-only cloud inspection once authenticated. Requiring explicit owner
approval: any Cloud Run IAM/ingress change (B1), bucket/policy changes,
secret creation/rotation, DNS/domain changes, and the first production email
send. Preserve the working local system throughout: deploy to the existing
services, keep `FIXPROOF_AI_PROVIDER=muse` with Nebius as documented
rollback, and keep the current production data untouched (no migration beyond
001/002 is required or permitted by this audit).

## 9. Demo-critical risks

Backend restart (kills Muse + SAM + unsaved reports) > cold start on a
scaled-to-zero service (torch/FAISS warm-up + first-request latency) > 403
ingress surprise on the public URL > 30s live report generation > rate-limiter
429s under frantic clicking > SAM cache expiring between rehearsal and stage.

## 10. Final verdict

**CONDITIONALLY READY** — deployable for a controlled demo after B1 (ingress
decision), B3/B4 (single pinned instance), B5 (env documentation), B6
(canonical backend URL), and one full public smoke pass. Not production-ready:
session-ID demo scoping is not authentication, report/conversation/SAM state
is not durable, and delivery guarantees (email) are acceptance-only by design.
Do not advertise otherwise.

## 11. Nemotron / Nebius reference audit (additional P4 requirement)

Audit date: 2026-11-03. Search scope: tracked + untracked source, config,
docs, tests, deployment files (dependency caches and build output excluded).
Final intended provider: Meta Model API (`https://api.meta.ai/v1`,
`backend/app/providers/meta_client.py:9-14`: reasoning `muse-wonder-1.0`,
vision `muse-spark-1.3`, SAM `sam-3.1`, voice `muse-voice-transcribe-1.0`,
key env `MODEL_API_KEY`).

### 11.1 The one deployment-critical finding

**A production deploy can accidentally select the old provider.**
`backend/app/providers/factory.py:25` sets `_DEFAULT_PROVIDER = "nemotron"`,
and `get_reasoning_provider()` (:61) and `get_vision_provider()` (:47) fall
back to it when `FIXPROOF_AI_PROVIDER` is unset. The module docstring (:2-4)
still says "Defaults to 'nemotron' across all environments during Phase 3.1".
Every production path goes through this factory (`main.py:1060,1339,1401,1404`;
`muse_orchestrator.py:162-163`; `nemotron_action.py:242,401`;
`detailed_report.py:78-79,535,743`), so the *only* thing keeping production on
Meta is the env var. Local works because `backend/.env` sets
`FIXPROOF_AI_PROVIDER` (name verified; value not printed). Voice (:20) and
segmentation (:81) correctly default to `muse` — the inconsistency is the bug.
Severity: **High** (silent wrong-provider selection, wrong-model reports,
possible Nebius billing). No code changed by this audit.

### 11.2 Runtime-active references (reachable in production)

| Location | Reference | Classification |
|---|---|---|
| `backend/app/providers/factory.py:11,25-35,47,61` | Nemotron provider classes registered; default selection | Runtime-active (fallback/default risk, §11.1) |
| `backend/app/providers/nemotron.py` (whole file) | Working Nemotron vision/reasoning adapters via Nebius | Runtime-active when selected; intended retained fallback |
| `backend/app/nemotron_engine.py`, `backend/app/vision_verifier.py` | Nebius OpenAI-SDK engines (`NEBIUS_API_KEY/MODEL/BASE_URL`, models `nvidia/Nemotron-3_5-Lightning`, `nvidia/Nemotron-3.5-Super-VL`) | Runtime-active only under `nemotron` selection; `main.py:111` still imports engine helpers (`get_allowed_models`, `normalize_model_override`, `DEFAULT_MODEL`) at startup — verify these resolve provider-aware values (model-override allowlist may still be Nemotron-shaped) |
| `backend/app/main.py` (12 routes) | `/api/nemotron/*` route prefix (status, draft, send-email, detailed-report…) | Runtime-active naming legacy; handlers are provider-agnostic. User-facing API naming debt, not a dependency |
| `backend/app/nemotron_action.py` | Misnamed live module: draft templates + Resend sending (provider via factory :242,401) | Runtime-active, name only |
| `backend/app/detailed_report.py:1388`, `:735` | `VISION_MODEL_ID` provenance fallback from `vision_verifier` | Runtime-active (provenance default) |
| `nemotron_reports` table (migrations 001/002) | Table name | Schema naming legacy; stores current Muse reports too. Renaming = migration, out of scope |
| `frontend/components/dashboard/NemotronCenter.tsx`, `frontend/lib/api.ts` (`getNemotronStatus`, `draftNemotronDocument`, `sendNemotronEmail`) | UI component + client names for the Muse Intelligence & Action Center | Runtime-active UI naming |
| `frontend/components/ui/NvidiaJudgePreloader.tsx` | NVIDIA-branded preloader component | **User-facing branding — obsolete for the Meta deployment; highest-visibility cleanup item after §11.1** |
| `backend/app/registry.py`, `db.py`, `evidence_models.py`, `muse_tools.py`, `muse_actions.py`, `detailed_report.py`, `main.py` | Incidental `nemotron_reports`/status naming in queries and payloads | Runtime-active naming only |

### 11.3 Configuration-only references

- `backend/.env.example:27-28` — `NEBIUS_API_KEY`, `NEBIUS_MODEL=nvidia/Nemotron-3_5-Lightning`
  presented as ordinary config. Should be labelled "retained fallback only" or
  removed when the fallback is retired (owner decision).
- `backend/.env` (gitignored, verified ignored) — contains `NEBIUS_API_KEY`
  and `FIXPROOF_AI_PROVIDER` names locally. Never commit; not inspected for values.
- No Nemotron/Nebius references in any Dockerfile, docker-compose (none
  present), or `.github` CI (no workflows found referencing them).

### 11.4 Documentation-only / generated references

`docs/nemotron_intelligence_center_audit.md`,
`docs/FixProof_AI_Model_Usage_Nebius_Integration_v2.pdf`,
`docs/ISOLATED_DEPLOYMENT_V2.md`, `docs/EXISTING_SERVICES_SUPABASE_SWITCH.md`,
`docs/LOCAL_MUSE_ACTIVATION.md`, several `docs/*_audit.md`,
`screenshots/NEMOTRON.png`, `docs/screenshots/dashboard_nemotron_view.png`,
`README.md`/`TESTING_AND_VALIDATION.md` (Nemotron-era probe docs). Historical
record — retain for provenance, do not present as current architecture.

### 11.5 Test references

`backend/tests/test_nemotron_engine.py`, `test_nemotron_action.py`,
`test_factory_wiring.py`, `test_meta_provider.py`,
`test_meta_reasoning_migration.py` (parity/migration coverage — keep while the
fallback exists), `run_phase0a_checks.py`, `run_copilot_offline.py`
(injected doubles). Live-integration `frontend/tests/test_nemotron_action_integration.mjs`
now asserts Muse model IDs (updated earlier). Tests do not create a runtime
dependency.

### 11.6 Git history

46 commits; old-provider references exist throughout history (e.g. pre-migration
checkpoints `a68cfbd`, migration `5188d44`). Deleting current references does
not erase history. Any history rewrite is a separate, explicitly approved
operation — **not** performed and **not** recommended for a hackathon repo
whose history is itself provenance.

### 11.7 Final-provider consistency verdict

Mostly consistent: one Meta client (`meta_client.py`), one key name
(`MODEL_API_KEY`), voice/segmentation hard-default to Meta, Muse orchestration
provider-agnostic. Inconsistent: (1) factory reasoning/vision default (§11.1);
(2) startup imports of Nemotron engine helpers in `main.py:111`;
(3) `/api/nemotron/*` naming; (4) NVIDIA-branded preloader in the Meta UI;
(5) `.env.example` presenting Nebius as co-equal config.

### 11.8 Cleanup checklist (requires explicit authorization — none executed)

1. [ ] Decide: retain Nemotron as documented fallback or retire it.
2. [ ] If retained: change factory default to `muse` *or* fail fast when
       `FIXPROOF_AI_PROVIDER` is unset in production; fix the stale docstring.
3. [ ] Set `FIXPROOF_AI_PROVIDER=muse` explicitly in the Cloud Run service env
       (do this regardless — zero code change, removes §11.1 today).
4. [ ] Replace/rename `NvidiaJudgePreloader` branding for the Meta deployment.
5. [ ] Label `.env.example` Nebius block "fallback only" (or remove on retire).
6. [ ] Plan `/api/nemotron/*` → neutral prefix as a versioned API change
       (frontend `lib/api.ts` + routes together; not a rename-only edit).
7. [ ] Verify `main.py:111` engine helpers are provider-aware or scoped to fallback.
8. [ ] Keep migration/parity tests while the fallback exists; archive
       Nemotron-era docs under a clearly historical heading.
9. [ ] Never rewrite Git history for this cleanup.
