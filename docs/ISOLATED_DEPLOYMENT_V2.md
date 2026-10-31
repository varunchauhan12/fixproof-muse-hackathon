# Isolated FixProof v2 deployment

> Current decision: create NEW services `fixproof-backend-v2` and
> `fixproof-frontend-v2`, following this guide. Keep existing services unchanged.
> The new database and six private buckets are already initialized; do not rerun
> the empty-project initializer. Build the frontend with the new backend URL.

Confirmed backend URL: `https://fixproofbackendv2-1097663016023.europe-west1.run.app`.
The frontend Dockerfile defaults its NEXT_PUBLIC_API_URL build argument to this
service. An explicit build argument can override it; local .env.local stays local.

New Supabase initialization is complete; no GCP deployment was executed. Keep Nemotron and all current
provider code. Existing deployment secrets and resources must remain unchanged.

## Audit

Backend database configuration (`app/db.py`): `FIXPROOF_DB_MODE=supabase`;
`SUPABASE_DB_URL` (preferred), aliases `DATABASE_URL`, `POSTGRES_URL`;
or `SUPABASE_DB_HOST`, `SUPABASE_DB_USER`, `SUPABASE_DB_PASSWORD`,
`SUPABASE_DB_NAME`, `SUPABASE_DB_PORT`. Tuning variables:
`SUPABASE_DB_SSLMODE` (require), `SUPABASE_DB_TIMEOUT_SEC` (10),
`SUPABASE_DB_MAX_CONNECTIONS` (10). `STORAGE_BACKEND` is an alternative mode switch.
Storage uses `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally
`SUPABASE_ANON_KEY`. Use the service-role key for the server; anon alone is not
sufficient for the private storage workflow.

These are backend runtime variables only. The frontend needs no Supabase keys.
`NEXT_PUBLIC_API_URL` is a frontend BUILD variable embedded in browser JavaScript.
Changing it only in Cloud Run runtime settings does not update an existing bundle.

Schema 001 creates seven tables; 002 adds incident fields, vision_verifications,
evidence_packages, and RLS/read policies. The legacy apply_schema.py runs only 001;
do not use it alone for a new deployment. Neither migration creates buckets.
Application startup expects these tables, but needs no pre-seeded rows: an absent
ACTIVE vault snapshot initializes an empty vault. Startup can reconcile and
checkpoint an existing vault, so never start against an unconfirmed project.
The staging/migration/reset scripts are operational tools, not initialization steps.
Never run migrate_to_supabase.py or reset scripts for this setup.

No live Supabase project host is hardcoded in application configuration. Fixed
bucket and table names are part of the schema contract. Historical deployed URLs
remain in README.md, TESTING_AND_VALIDATION.md and docs/TESTING_AND_VALIDATION.md;
they are documentation examples, not v2 targets. Test fixtures/manifests also contain
historical identifiers; do not import them into the new project.
The active frontend URL defaults in lib/api.ts and Dockerfile were removed from
production targeting: local fallback is localhost; Docker requires an explicit URL.

Detailed report PDFs/JSON and some caches remain on local disk. Cloud Run's disk is
ephemeral and not shared across replicas; this existing limitation is not fixed by
new credentials. Backend APIs also lack a general authorization layer; private
Storage buckets do not make public backend write/delete APIs private. Decide API
access protection before making v2 generally public. No auth behavior was changed.

## Manual Supabase checklist — NEW PROJECT ONLY

1. Confirm the new project reference in the dashboard. Store its DB connection URI,
   project URL, and service-role key only in backend secrets. URL-encode special
   characters in the database password. Prefer the session pooler URI if direct
   database IPv6 connectivity is unavailable. All three must belong to this project.
2. Set backend/.env yourself (already done by owner); shell-exported variables take
   precedence over this file. Restart processes after configuration changes.
3. From the repository root, run a read-only schema preflight:
   `backend/.venv/bin/python backend/scripts/initialize_new_project.py --confirm-new-project NEW_PROJECT_REF`
4. After confirming the target, append `--apply` to initialize. This refuses ANY
   existing public tables and verifies project host/DB identity. It applies both
   migrations in one transaction and revokes anon/authenticated table access.
   The backend uses privileged DB credentials. No data is copied or seeded.
   Reruns intentionally refuse an initialized project; use reviewed migrations later.
5. In Storage, create these EXACT bucket IDs, all **Private**:

   | ID | Contents | Suggested allowed MIME types |
   |---|---|---|
   | reference-assets | Official reference videos | Leave unrestricted for supported video formats |
   | reference-frames | Reference JPEG frames | image/jpeg |
   | vault-snapshots | FAISS index and JSON | application/octet-stream, application/json |
   | suspect-videos | Uploaded suspect videos | Leave unrestricted for supported video formats |
   | suspect-frames | JPEG previews/keyframes | image/jpeg |
   | evidence-packages | Signed ZIPs | application/zip |

6. Set project and bucket file-size limits to accommodate the backend's current
   50 MiB limit; the UI currently advertises 500 MiB, an existing mismatch.
7. Keep storage.objects RLS enabled. Add no anon/public read or write policies.
   The backend's service-role key bypasses RLS and serves signed/authenticated data.
   Never add that key to NEXT_PUBLIC variables or the frontend service.
8. Verify nine public application tables exist. Leave assets, incidents and snapshots
   empty. Enable no import/reset task. The new private buckets should be empty.

## Cloud Run console and build checklist

Create isolated v2 Secret Manager secrets and a dedicated backend service account
with access only to those secrets. Do not edit or reuse existing secret versions.
Use the same provider/model settings as the current implementation, with separate
secret resources. No Muse activation or Nemotron migration is required.

| Setting | fixproof-backend-v2 | fixproof-frontend-v2 |
|---|---|---|
| Docker build context | repository root | frontend/ |
| Dockerfile | Dockerfile | frontend/Dockerfile (Dockerfile relative to context) |
| Alternative backend build | backend/ context, backend/Dockerfile | n/a |
| Container port | 8080 | 8080 |
| Bind address | 0.0.0.0 via uvicorn | 0.0.0.0 via standalone Node server |
| Build arguments | none | NEXT_PUBLIC_API_URL=https://NEW_BACKEND_V2_URL |
| Runtime plain variables | FIXPROOF_DB_MODE=supabase, SUPABASE_URL=new project URL, SUPABASE_DB_SSLMODE=require | NODE_ENV=production |
| Runtime secrets | SUPABASE_DB_URL, SUPABASE_SERVICE_ROLE_KEY, NEBIUS_API_KEY, FIXPROOF_SIGNING_KEY_HEX | none |

Backend additional runtime settings: preserve NEBIUS_MODEL, NEBIUS_BASE_URL (if used),
DETAILED_REPORT_MODEL and all existing Nemotron tuning. Leave FIXPROOF_AI_PROVIDER
unchanged (current factory default is nemotron). Set FIXPROOF_SIGNING_KEY_ID to a
new v2 identifier and FIXPROOF_REQUIRE_CONFIGURED_SIGNING_KEY=true; provide a new
32-byte Ed25519 private seed as 64 hex characters through Secret Manager. Optional
RESEND_API_KEY and FROM_EMAIL enable mail; omit them to keep mail unavailable.
SUPABASE_ANON_KEY is optional when service-role is supplied. Do not set DB aliases
alongside SUPABASE_DB_URL with conflicting values.

Build backend and create the new backend service first, using a separately tagged
image. Record its generated URL. Then build frontend with that exact HTTPS URL.
For example, locally:

```sh
docker build -f Dockerfile -t fixproof-backend-v2 .
docker build -f frontend/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://NEW_BACKEND_V2_URL -t fixproof-frontend-v2 frontend
```

These are build examples, not commands executed during preparation. Both services
can deploy independently. Frontend calls backend directly from the browser, so
Cloud Run IAM-only backend access requires an authentication/proxy design before
it can work; do not assume frontend service identity authenticates browser fetches.
Current FastAPI CORS allows all origins; it supports a separate frontend origin.
Use a suitable backend memory/CPU allocation for Torch and request timeout for
video processing; start conservatively (e.g. 2 CPU/4 GiB) and validate with real data.
Use one backend instance initially to reduce existing in-memory FAISS consistency
risks. This does not provide durable local report storage.

## Developer Connect / Cloud Build trigger gate

Live triggers were NOT verified: no gcloud CLI or connected GCP tooling is available
in this environment. Repository checkout was clean on main at inspection. No branch
was switched. Do not push main until the following console inspection is complete:

1. Open Cloud Build > Triggers in each relevant region/project. Inspect Developer
   Connect repository association, branch regex, build config, substitutions, deploy
   step service name, image name and service account for EVERY existing trigger.
2. Ensure a proposed v2-only branch (e.g. deploy/fixproof-v2) matches NO existing
   production trigger. Broad regexes like .* need owner review before any push.
   Do not modify existing triggers during this preparation.
3. Create two NEW triggers or use manual builds for v2. Scope new triggers to
   ^deploy/fixproof-v2$, exact service names fixproof-backend-v2 and
   fixproof-frontend-v2, separate image tags and v2 service accounts/secrets.
4. Set frontend Docker context and build argument explicitly. A runtime variable
   alone or an automatically selected root Dockerfile will produce the wrong build.
5. Inspect preview build/deploy steps for old service names/URLs before enabling.
   Trigger creation, branch creation, pushes and deployment remain manual owner steps.

## Review before launch

Confirm source and target Supabase project refs differ, frontend bundle contains
the v2 URL, health responds, vault starts at zero and all six buckets are private.
Exercise upload/scan/report with new test data only. Confirm existing services and
their revisions/secrets have not changed. Database initialization and bucket creation
were completed in a subsequent execution step. Do not repeat initialization.
