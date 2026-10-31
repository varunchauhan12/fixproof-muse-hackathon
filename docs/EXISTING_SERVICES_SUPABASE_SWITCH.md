# Switch existing Cloud Run services to the new Supabase project

> Historical alternative, superseded by the owner's decision to create NEW services.
> Use [ISOLATED_DEPLOYMENT_V2.md](ISOLATED_DEPLOYMENT_V2.md) for the current plan.
> Do not apply the existing-service updates below.

No new Cloud Run services. All GCP updates are manual owner actions.
The repository's committed frontend configuration identifies the existing backend as:
`https://fixproof-backend-meta-1097663016023.europe-west1.run.app`.
Confirm this against the actual existing backend service URL in Cloud Run before building.
Live GCP settings and Developer Connect triggers were not inspected. Historical
README NVIDIA deployment URLs are not authoritative for this Meta deployment.

## Existing backend: exact configuration changes

Open the existing Meta backend service, Containers > Variables & Secrets. Keep the
service name, URL, image (if compatible), region, port 8080 and all AI configuration.

| Environment variable | Manual action |
|---|---|
| FIXPROOF_DB_MODE | Set to supabase |
| SUPABASE_URL | Replace with new project's URL from backend/.env |
| SUPABASE_DB_URL | Bind to a new Secret Manager secret/version containing the working new-project session-pooler URI from backend/.env |
| SUPABASE_SERVICE_ROLE_KEY | Bind to a new Secret Manager secret/version containing the new project's service-role key |
| SUPABASE_ANON_KEY | If currently configured, replace with the new project's anon key; otherwise optional |
| SUPABASE_DB_SSLMODE | Set/retain require |

Use new secret resources or explicitly pinned new versions for the changed bindings;
do not overwrite a shared old secret's value or move other consumers to new credentials.
Grant the existing backend runtime service account access to the new secrets.
Preserve existing NEBIUS_API_KEY, NEBIUS_MODEL, NEBIUS_BASE_URL, FIXPROOF_AI_PROVIDER,
DETAILED_REPORT_MODEL, RESEND_API_KEY, FROM_EMAIL and all other AI/email tuning.
Local email configuration is not automatically transferred to Cloud Run: if mail
is absent there, add a server-only RESEND_API_KEY secret and verified FROM_EMAIL.

Inspect DATABASE_URL, POSTGRES_URL and SUPABASE_DB_HOST/USER/PASSWORD/NAME/PORT if
present. Remove obsolete aliases from this service's new revision or update them
consistently; never leave a fallback pointing at the old project. Do not delete old
Secret Manager resources or old project data. Preserve timeout/pool tuning unless needed.

Retain existing signing credentials if continuity is desired. To use the new local
v2 signing identity instead, update FIXPROOF_SIGNING_KEY_HEX through a new secret,
FIXPROOF_SIGNING_KEY_ID with its matching identifier, and
FIXPROOF_REQUIRE_CONFIGURED_SIGNING_KEY=true as one coordinated change. Never mix
the key and identifier from different signing identities or copy keys into frontend.

Review the revision diff before manually applying. Updating configuration creates
a new revision of the same service and retains its service URL. A config-only change
does not transfer uncommitted code into the deployed image: confirm the current image
already supports both migrations and empty-cloud-vault startup. Any later image update
also targets this same existing service. No deployment was performed by this task.

## Existing frontend

Keep its existing service and public URL. If its current browser bundle already
calls the existing Meta backend URL above, no frontend change is needed for this
database switch. Never put Supabase credentials on the frontend service.

For a later frontend image rebuild, retain the explicit Docker build argument:

```sh
docker build -f frontend/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://fixproof-backend-meta-1097663016023.europe-west1.run.app -t fixproof-frontend-review frontend
```

This is an example build command, not a deployment. Docker context is frontend/;
port is 8080. NEXT_PUBLIC_API_URL is embedded at build time. Runtime-only changes
will not repair a bundle built for localhost or another backend. Local .env.local
intentionally continues to use http://localhost:8000. Do not deploy that local build.

Backend Docker options remain root context + root Dockerfile, or backend/ context
+ backend/Dockerfile. No new cloudbuild config or trigger is required for a
configuration-only service update. Inspect existing Developer Connect trigger branch
filters before a future push so a source change does not deploy unexpectedly.

## Verified local state

Credential project identities agree; no conflicting exported environment values.
All nine tables exist: reference_assets, reference_frames, reference_vectors,
investigation_jobs, incidents, nemotron_reports, vault_snapshots,
vision_verifications and evidence_packages. Migration 002 incident columns exist.
The database contains user test data; do not rerun the empty-project initializer.
Six private buckets exist with 50 MiB limits: reference-assets, reference-frames,
vault-snapshots, suspect-videos, suspect-frames and evidence-packages.

The working local backend reports Supabase mode, one reference asset and three FAISS
vectors at verification time. Nemotron reasoning and Resend configuration are available.
This verifies configuration and reads, not successful external model/email calls.
Local URLs: http://127.0.0.1:8000 and http://127.0.0.1:3000.

After manually switching the existing backend revision, verify /health,
/api/vault/status and the existing frontend's asset list against the new project.
Old assets will no longer be listed through that revision, but remain in the old
Supabase project. This application uses ephemeral Cloud Run disk for some detailed
report files; database credentials do not make those files durable.
