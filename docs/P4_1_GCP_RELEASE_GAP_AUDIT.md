# FIXPROOF P4.1 — EXISTING GCP DEPLOYMENT INVENTORY & RELEASE GAP AUDIT

Audit date: 2026-11-03. Read-only: no code, config, Git, cloud, or Supabase
state changed; no secrets printed. Companion to
`docs/P4_DEPLOYMENT_READINESS_AUDIT.md` (§11 covers the Nemotron/Nebius audit).

## 1. Executive summary

The repository is **not** the code that is deployed. The last deployment-era
commits are `c4df378`/`2cd8d92` (frontend configuration + Tailwind fix,
Oct–Nov); since then **14 commits** landed (Muse provider migration, SAM,
voice, Copilot 2.0, P3 temporal, NL actions, voice-first), plus uncommitted
work in progress (new `evidence_summaries` modules, Muse approval edits).
Backend image inputs (Dockerfile, `requirements.txt`) are unchanged since the
deployment era, so a new backend image builds from familiar inputs — but the
application inside it is substantially different: ~29 additional routes,
a different default AI provider selection, and new secrets required.

GCP itself could not be inventoried: **no credentialed gcloud account exists
on this machine** (`gcloud auth list` → "No credentialed accounts", project
unset). Every deployed-service fact below is therefore either (a) verified
from the repository, or (b) labelled UNVERIFIED. The previously observed
public-backend HTTP 403 (Google edge page, reproduced twice) remains
unexplained from here.

## 2. Current repository state

- Branch `main` @ `2da94ab` ("feat: complete Muse voice-first interaction
  and chat reliability"). Working tree **dirty**: 8 modified files
  (`backend/app/main.py`, `muse_actions.py`, tests, Muse UI/lib, docs) and
  untracked `backend/app/evidence_summaries.py`,
  `backend/app/evidence_summary_api.py`, voice-first docs/screenshots,
  `docs/P4_DEPLOYMENT_READINESS_AUDIT.md`. Development is actively ongoing —
  a release must start from a committed freeze, not this tree.
- Recent history (20): provider migration `5188d44` → SAM/Wonder `8f005bf` →
  multimodal pipeline `cc53908` → SAM decoupling `03ec12a` → voice `5ddfeb1`
  → copilot `29825f5` → hero perf `eddccd0` → sync fix `02b1be8` → batched
  SAM `85248a0` → P3+Copilot 2.0 `59b7c7d` → voice-first `2da94ab`.
- Last known deployment baseline: `c4df378`/`2cd8d92` (pushed for GCP
  Developer Connect frontend deploy) and `125579d`/`d0df48a` (isolated v2
  deployment configuration). Exact deployed commit is UNVERIFIED (needs
  Cloud Run revision metadata).
- Dockerfiles today: backend = Python 3.11, `uvicorn app.main:app` on
  `${PORT:-8080}` (root `Dockerfile` mirrors `backend/Dockerfile`); frontend
  = Node 20 standalone, port 8080, build-arg `NEXT_PUBLIC_API_URL`
  (default currently `fixproofbackendv2-…run.app`, `frontend/Dockerfile:21`).
- Startup/ports unchanged since deployment era. `.dockerignore` excludes
  `frontend/` from the backend context (root) as before.

## 3. Existing GCP deployment inventory

**BLOCKED — GCP ACCESS REQUIRED.** `gcloud auth list` shows no accounts;
no project configured. The following could NOT be inspected: project ID,
region confirmation, service names, revisions, image digests, traffic split,
instance/CPU/memory/timeout/concurrency settings, ingress, IAM,
health checks, deployed env var names, secret references/versions,
deployment timestamps.

What is known without cloud access (repo + prior probes):
- Two backend identities appear in project history:
  `fixproof-backend-meta-1097663016023.europe-west1.run.app` and
  `fixproofbackendv2-1097663016023.europe-west1.run.app` (frontend Dockerfile
  default). Which is canonical is UNVERIFIED.
- The meta backend URL returned Google HTML 403 to unauthenticated external
  curl (twice) — consistent with Cloud Run IAM/ingress requiring auth, not
  an application error (app returns JSON). UNVERIFIED root cause.
- Docs (`docs/ISOLATED_DEPLOYMENT_V2.md`) describe v2 services in
  `europe-west1` with Secret Manager-backed env — treated as intent, not
  verified state.

Permissions needed to complete this inventory: `gcloud auth login` with an
account holding at least `roles/run.viewer` (+ `roles/secretmanager.viewer`
for secret *names/versions* only) on the hosting project.

## 4. Current versus deployed release comparison

| Difference | Classification |
|---|---|
| Backend Dockerfile, `requirements.txt` unchanged since `c4df378` | Compatible — new build only |
| Frontend `package.json` (+`@tailwindcss/postcss`, webpack scripts) | Requires new build |
| Frontend Dockerfile ARG default → v2 backend URL | Requires build-arg discipline (pin explicitly) |
| Routes 34 → ~63 (main.py 47 + conversations 6, SAM 5, temporal 1, voice 1, evidence summaries 3) | Requires new build; additive, no removals observed |
| AI provider: factory default reasoning/vision = `nemotron` when env unset (`providers/factory.py:25,47,61`) | **Potentially breaking** — new runtime configuration mandatory (`FIXPROOF_AI_PROVIDER=muse`) |
| New env/secrets: `MODEL_API_KEY`, `MUSE_BASE_URL/MODELS`, `MUSE_REGISTERED_EMAIL`, `RESEND_API_KEY`, `FROM_EMAIL`, `FIXPROOF_CORS_ORIGINS`, `FIXPROOF_DEMO_MODE` | Requires new secrets + runtime configuration |
| Supabase integration (9 tables, 6 buckets, migrations 001/002) | Compatible — no migration required |
| Conversations, SAM cache, detailed reports | No new persistence — still process/disk state (P4 audit B2–B4); single-instance constraint carries over |
| Voice transcription (`POST /api/voice/transcribe`) | New route; same Meta key; browser mic requires HTTPS origin in production |
| Uncommitted `evidence_summaries` modules | Not deployable until committed + tested |

## 5. Required frontend changes

None in code. Release actions: rebuild with explicit
`--build-arg NEXT_PUBLIC_API_URL=<canonical backend URL>` (never rely on the
Dockerfile default, §2), confirm the baked URL inside the built image
(grep the standalone chunks, as done previously), deploy as a **new revision**.

## 6. Required backend changes

None in code for buildability. Release actions: build new image from
unchanged Dockerfile/requirements; set the §9 env/secrets; pin
min=max=1 instance initially (process-local state); request timeout ≥ 300s
(report generation ~30s, 50MB uploads); memory ≥ 2Gi (torch/FAISS).

## 7. Required Supabase configuration

Run migrations `001_initial_schema.sql` + `002_cloud_persistence_expansion.sql`
on a clean project; create six private buckets (`reference-assets`,
`reference-frames`, `vault-snapshots`, `suspect-videos`, `suspect-frames`,
`evidence-packages` — buckets are not created by migrations); backend env
`FIXPROOF_DB_MODE=supabase`, `SUPABASE_DB_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` (server-side only). No new migration is required
by the new code (Muse/temporal/SAM add no tables). Verify RLS state in
console (002 enables it; live state UNVERIFIED).

## 8. Required AI provider configuration

`MODEL_API_KEY` (Meta), `MUSE_BASE_URL=https://api.meta.ai/v1`,
`MUSE_REASONING_MODEL=muse-wonder-1.0`, `MUSE_VISION_MODEL=muse-spark-1.3`,
`MUSE_SAM_MODEL=sam-3.1`, `MUSE_VOICE_MODEL=muse-voice-transcribe-1.0`,
and **critically** `FIXPROOF_AI_PROVIDER=muse` (without it the factory
 silently selects Nemotron — P4 audit §11.1). Nebius `NEBIUS_*` variables
become obsolete once the fallback decision is made; retaining them keeps the
documented rollback alive. Do not remove during this release.

## 9. Missing secrets/configuration (names only)

Must exist in Secret Manager / service env before first boot: `MODEL_API_KEY`,
`SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
`FIXPROOF_SIGNING_KEY_HEX`. Must be set as plain env: `FIXPROOF_AI_PROVIDER=muse`,
`FIXPROOF_DB_MODE=supabase`, `SUPABASE_URL`, `FROM_EMAIL`,
`MUSE_REGISTERED_EMAIL`, `FIXPROOF_CORS_ORIGINS=<exact frontend origin>`.
Values were never read or printed in this audit. `.env.example` still omits
~25 consumed names (P4 audit B5) — configure from §8 of that report, not the template.

## 10. Cloud Run IAM and networking risks

Public-backend 403 (unexplained; likely invoker IAM not granted to
`allUsers` or org policy) — the frontend is a browser app, so the backend
must be intentionally public or fronted; either decision needs the owner.
CORS must name the exact frontend origin (no wildcards — `security.py:14`
enforces). Frontend→backend is browser-direct (no server-side proxy), so
backend ingress must accept judge browsers. Voice requires HTTPS + mic
permission on the deployed origin. Rate limiter (30/min) applies per instance.

## 11. Rollback strategy (UNVERIFIED against live traffic config)

Cloud Run's model supports the safe pattern — stated here as capability, not
as observed configuration: deploy the new backend revision with
`--no-traffic`, smoke it on its revision URL, then shift traffic; the previous
revision remains available for instant re-shift. Frontend and backend revise
independently (frontend only needs the backend URL baked at build). Database
risk on rollback: none from schema (no new migrations; new code writes only
existing tables), but reports/conversations created on the new revision are
process/disk state and do not migrate back — acceptable for a demo,
unacceptable to hide. Confirm the actual traffic/revision layout once
authenticated (§3 permissions) before relying on this.

## 12. Ordered safe redeployment checklist

1. Authenticate gcloud (viewer first); complete §3 inventory; confirm
   canonical backend service + URL and the 403 cause.
2. Freeze the repo: commit the in-flight Muse/evidence-summaries work;
   tag the release commit locally (no push without instruction).
3. Create/verify secrets (§9 names) in Secret Manager; grant the backend
   service account accessor roles (least privilege).
4. Build backend image; deploy new revision `--no-traffic` with §6 settings.
5. Smoke the revision URL: `/health` JSON 200, `/api/nemotron/status`
   provider=muse, one investigation read, temporal endpoint, report load.
6. Build frontend image with pinned `--build-arg`; deploy new revision
   `--no-traffic`; verify baked URL in the served chunks.
7. Shift backend traffic → smoke → shift frontend traffic → full guide
   (P4 audit §7 checklist; T03/T05/T08/T17/T21).
8. Demo hardening: pre-generate report, warm SAM < 30 min prior, never
   restart afterwards, backup recording ready.
9. Keep the previous revisions untouched until the demo ends (rollback = traffic re-shift).

## 13. Unverified items and required account permissions

UNVERIFIED: everything in §3 (revisions, digests, traffic, IAM, settings,
secret versions, timestamps), the exact deployed commit, the 403 root cause,
live RLS/storage policies, Resend domain verification, Muse entitlement at
production volume. Required to close: `roles/run.viewer` +
`roles/secretmanager.viewer` on the hosting project (read-only completion of
this inventory); `roles/run.admin` + secret accessor grants only later, at
deploy time, under separate authorization.

## Final verdict

**BLOCKED — GCP ACCESS REQUIRED.** The codebase is releasable after a commit
freeze and the §12 sequence, but no deployment inventory or safe redeploy can
be prepared until GCP is authenticated and §3 is completed. Nothing was
deployed, changed, or pushed by this audit.