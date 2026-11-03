# P4.2 — Browser-only deployment inventory and release planning

Audit date: 2026-11-03 (Asia/Calcutta). Repository: `~/projects/fixproof-muse-hackathon`. Local branch reference: `main`; HEAD reference: `490f4bfc81c725aa46213bfe3b6d81bec6b7cb7b`.

## 1. Scope, evidence and verdict

**Release gate: BLOCKER — live inventory is incomplete.** This is a repository-backed inspection and a browser-only manual inspection guide, not a verified inventory of the deployed services.

Repository source, Dockerfiles, migration SQL, initialization code, provider factories, API clients, persistence code and existing deployment/audit documents were inspected through filesystem APIs. No terminal, shell, Git CLI, cloud CLI, application startup, test script, database connection or live model request was used. Official platform documentation was consulted for navigation. No authenticated GCP Console or Supabase Dashboard was inspected in this task. No live frontend/backend endpoint was invoked.

The only intended file creation is this requested report. No source, environment file, credential, database, cloud configuration, traffic allocation or Git index/reference is changed by this audit. Neither protected repository was accessed or modified.

Evidence labels used throughout:

- **REPOSITORY VERIFIED**: current source/configuration establishes the claim; it does not establish deployment state.
- **MANUAL / NOT INSPECTED**: an owner must verify the specified browser metadata.
- **UNKNOWN**: unavailable until that inspection or later separately approved testing.

The earlier P4/P4.1 documents are historical observations and contain conflicting assumptions. Their claims about public HTTP 403, absent CLI credentials, successful builds, deployed commit count or release readiness are **not reverified here**. Approximately fourteen commits since deployment is a planning estimate, not an established release diff: the deployed source SHA is still unknown. HEAD identity was read directly; no Git status/diff commands were run and no clean-working-tree claim is made in this audit.

## 2. Current architecture — repository verified

| Component | Source / build context | Entrypoint / port | Dependencies and state |
|---|---|---|---|
| Browser frontend | `frontend/`, `frontend/Dockerfile`; Node 20 multi-stage Next.js standalone build | `node server.js`; container 8080; dev convention 3000 | Browser calls FastAPI directly through `frontend/lib/api.ts`. Needs a public API origin baked at build time. No Supabase service key or DB password belongs here. |
| Backend, root-context option | Repository root, root `Dockerfile` | `uvicorn app.main:app` via existing container startup; `PORT` defaults to 8080 | Python 3.11, FastAPI, CPU PyTorch/torchvision, FAISS, OpenCV, FFmpeg, Postgres/Supabase Storage, Meta and optional Resend. |
| Backend, backend-context option | `backend/`, `backend/Dockerfile` | Same application and port | Equivalent source layout using paths relative to `backend/`. Do not confuse this Dockerfile's context with the root Dockerfile's context. |
| Cloud data | `backend/app/db.py`, `storage.py`, `registry.py`, `cloud_ingest.py`, `vault.py` | Runtime configuration | Nine application tables, six fixed bucket IDs. DB and Storage are separate credentials/access paths that must identify the same Supabase project. |
| AI | `providers/factory.py`, `providers/meta_client.py`, `meta.py`, `sam.py`, `voice.py` | Backend runtime | Muse Wonder reasoning; Spark vision, object-concept discovery and evidence brief selection; SAM localization; voice transcription. Legacy Nemotron remains selectable/default for reasoning/vision. |
| Conversation/action state | `muse_conversations.py`, `muse_orchestrator.py`, `muse_actions.py` | Backend process | In-memory conversations/approval state and process-local email deduplication. Not a durable multi-instance queue. |
| SAM results | `sam_workspace.py` | Backend process cache | Bounded, expiring, session-scoped cached observations; not durable tracking or exhaustive scene detection. |
| Reports / briefs / email audit | `detailed_report.py`, `evidence_summaries.py`, `nemotron_action.py` | Local backend storage directories | Detailed report JSON/PDF, saved evidence briefs and email audit are disk state. Summary PDFs are rendered from saved JSON on download. Cloud Run instance replacement can lose these. |
| Temporal statistics | `temporal_evidence.py` | Deterministic on existing incident evidence | Recomputed per request; no new database schema. Spark briefs add a separate saved artifact and inference step. |

Frontend and backend can be built and deployed independently, but their API contracts and the frontend's baked backend origin must match. Backend configuration is runtime configuration; editing a frontend runtime variable does not change JavaScript already produced by Next.js.

**Startup is not read-only.** `backend/app/main.py:83` imports `app.vault`. The startup handler at `main.py:220–231` validates configuration, reloads the vault and synchronizes registered assets. `vault.py` creates directories, writes local snapshot caches and can checkpoint reconciled cloud snapshots. Do not start/restart/deploy a backend or assume a cold-start health request is side-effect-free during this inventory.

## 3. All identified Cloud Run service / URL references

These are repository strings, **not confirmed live services**. A project number in a `run.app` hostname is not the human-readable GCP project ID.

| Repository candidate | Role suggested by source | Evidence |
|---|---|---|
| `fixproofbackendv2` — `https://fixproofbackendv2-1097663016023.europe-west1.run.app` | Backend; current frontend Docker build default | `frontend/Dockerfile:21`; `docs/ISOLATED_DEPLOYMENT_V2.md:8` |
| `fixproof-backend-meta` — `https://fixproof-backend-meta-1097663016023.europe-west1.run.app` | Alternative backend referenced in earlier switching plan | `docs/EXISTING_SERVICES_SUPABASE_SWITCH.md:9,62`; P4.1 |
| `fixproof-git` — `https://fixproof-git-214713402646.europe-west1.run.app` | Historical backend in an older project number | Root and `docs/TESTING_AND_VALIDATION.md:153–198` |
| `fixproof-frontend` — `https://fixproof-frontend-214713402646.europe-west1.run.app` | Historical public frontend | `README.md:12` |
| `fixproof-backend-v2` / `fixproof-frontend-v2` | Proposed service names, not proof of creation | `docs/ISOLATED_DEPLOYMENT_V2.md:3–4,95,147–148` |
| `NEW_BACKEND_V2_URL` / exact `deploy/fixproof-v2` branch expression | Documentation placeholders / proposed isolation trigger | `docs/ISOLATED_DEPLOYMENT_V2.md:121,147`; not a live URL or verified trigger |

Source references repeating these identities also exist in `docs/P4_DEPLOYMENT_READINESS_AUDIT.md` and `docs/P4_1_GCP_RELEASE_GAP_AUDIT.md`. No other concrete `run.app` identity was found in the inspected source/documentation corpus. Runtime custom domains and account-only services remain unknown.

**Expected frontend API origin:** the canonical backend URL selected from the live inventory. Current Docker default is the `fixproofbackendv2` URL above; it is correct only if that is the intended live backend. `frontend/lib/api.ts:23–25` falls back to `http://127.0.0.1:8000` outside an explicitly configured build. Local `frontend/.env.local` currently targets localhost:8000, appropriate for local development, not judges' browsers. No frontend Supabase key is required.

The old isolated-deployment guide's statement that the Dockerfile has no production URL default is stale: the current file does have the concrete default above. Do not treat a guide labelled 'confirmed' as live cloud evidence.

## 4. Runtime and build configuration inventory

Static inspection found **46 application-consumed environment names**, including aliases and optional legacy settings. Dynamic credential-name lookups resolve to `MODEL_API_KEY` or `NEBIUS_API_KEY`; no additional dynamic application key name was identified. Operational scripts were inspected separately; they are not deployment startup steps and must not be executed for this audit.

| Variable | Purpose / timing | Source |
|---|---|---|
| `DATABASE_URL` | Backend runtime; secret DB URI alias, after SUPABASE_DB_URL. | `backend/app/cloud_ingest.py:68`, `backend/app/db.py:101` |
| `DETAILED_REPORT_MODEL` | Backend runtime; legacy detailed-report model override; verify selected-provider branch before use. | `backend/app/detailed_report.py:80`, `backend/app/detailed_report.py:537` |
| `FIXPROOF_AI_PROVIDER` | Backend runtime; set muse explicitly for Meta. Reasoning/vision otherwise default to nemotron. | `backend/app/providers/factory.py:20`, `backend/app/providers/factory.py:47` |
| `FIXPROOF_CORS_ORIGINS` | Backend runtime; comma-separated exact frontend origins, no path or wildcard. Defaults are localhost only. | `backend/app/security.py:14` |
| `FIXPROOF_DB_MODE` | Backend runtime; supabase for cloud persistence; unset defaults to local. | `backend/app/db.py:80`, `backend/app/storage.py:83` |
| `FIXPROOF_DEMO_MODE` | Backend runtime; explicit demo reads across some sessions; not authentication. | `backend/app/security.py:35` |
| `FIXPROOF_ENV` | Backend runtime; production/prod disables demo mode. | `backend/app/security.py:32` |
| `FIXPROOF_RATE_LIMIT_PER_MINUTE` | Backend runtime; per-process request limit, default 30. | `backend/app/security.py:61` |
| `FIXPROOF_REQUIRE_CONFIGURED_SIGNING_KEY` | Backend runtime; true requires configured signing material for package signing. | `backend/app/evidence_package.py:91` |
| `FIXPROOF_SIGNING_KEY_HEX` | Backend runtime secret; Ed25519 seed option. | `backend/app/evidence_package.py:87` |
| `FIXPROOF_SIGNING_KEY_ID` | Backend runtime; signing-key identifier, not key material. | `backend/app/evidence_package.py:90` |
| `FIXPROOF_SIGNING_KEY_PATH` | Backend runtime; optional mounted private-key path; path is configuration, file contents are secret. | `backend/app/evidence_package.py:89` |
| `FIXPROOF_SIGNING_KEY_PEM` | Backend runtime secret; alternative Ed25519 PEM. | `backend/app/evidence_package.py:88` |
| `FROM_EMAIL` | Backend runtime; Resend verified sender configuration; do not publish its value in audit evidence. | `backend/app/detailed_report.py:1916`, `backend/app/nemotron_action.py:37` |
| `MODEL_API_KEY` | Backend runtime secret; shared Meta transport for Wonder, Spark, SAM and voice. | `backend/app/providers/meta_client.py:35` |
| `MUSE_BASE_URL` | Backend runtime; defaults to https://api.meta.ai/v1. | `backend/app/providers/meta_client.py:38` |
| `MUSE_CONVERSATION_TTL_SECONDS` | Backend runtime; conversation inactivity TTL, default 1800 seconds. | `backend/app/muse_conversations.py:162` |
| `MUSE_MAX_TOKENS` | Backend runtime; selected Meta reasoning/report token budget. | `backend/app/detailed_report.py:619`, `backend/app/providers/meta.py:259` |
| `MUSE_REASONING_EFFORT` | Backend runtime; selected Meta reasoning request option. | `backend/app/providers/meta.py:218` |
| `MUSE_REASONING_MODEL` | Backend runtime; defaults to muse-wonder-1.0. | `backend/app/providers/meta.py:104` |
| `MUSE_REGISTERED_EMAIL` | Backend runtime; fixed recipient for approved chat PDF emails; private contact configuration, no value recorded. | `backend/app/muse_actions.py:65` |
| `MUSE_SAM_MODEL` | Backend runtime; defaults to sam-3.1. | `backend/app/providers/sam.py:187` |
| `MUSE_TIMEOUT_SEC` | Backend runtime; provider timeout; operation-specific ceilings also apply. | `backend/app/providers/meta_client.py:25` |
| `MUSE_VISION_MODEL` | Backend runtime; defaults to muse-spark-1.3. | `backend/app/providers/meta.py:46` |
| `MUSE_VOICE_MODEL` | Backend runtime; defaults to muse-voice-transcribe-1.0. | `backend/app/providers/voice.py:20` |
| `NEBIUS_API_KEY` | Backend runtime secret; current Nemotron rollback/default branch only. Do not remove in this audit. | `backend/app/main.py:1343`, `backend/app/nemotron_engine.py:147` |
| `NEBIUS_BASE_URL` | Backend runtime; legacy Nebius endpoint override. | `backend/app/nemotron_engine.py:150`, `backend/app/vision_verifier.py:33` |
| `NEBIUS_MAX_TOKENS` | Backend runtime; legacy report token budget. | `backend/app/nemotron_engine.py:325` |
| `NEBIUS_MODEL` | Backend runtime; legacy Nemotron model and allowlist configuration. | `backend/app/main.py:1074`, `backend/app/main.py:1344` |
| `NEBIUS_TIMEOUT_SEC` | Backend runtime; legacy provider timeout. | `backend/app/nemotron_engine.py:151` |
| `NEXT_PUBLIC_API_URL` | Frontend BUILD TIME; public backend origin embedded in JavaScript. Runtime-only changes cannot repair an already-built bundle. | `frontend/lib/api.ts:24` |
| `POSTGRES_URL` | Backend runtime; secret DB URI alias, after DATABASE_URL. | `backend/app/db.py:102` |
| `RESEND_API_KEY` | Backend runtime secret; approval-controlled email feature. | `backend/app/nemotron_action.py:36` |
| `STORAGE_BACKEND` | Backend runtime; alternate mode selector, lower priority than FIXPROOF_DB_MODE. | `backend/app/db.py:80`, `backend/app/storage.py:83` |
| `SUPABASE_ANON_KEY` | Backend runtime optional legacy anon key; not a replacement for privileged private-storage access. Not required by this frontend. | `backend/app/storage.py:65` |
| `SUPABASE_DB_HOST` | Backend runtime; alternate discrete DB configuration. | `backend/app/db.py:106` |
| `SUPABASE_DB_MAX_CONNECTIONS` | Backend runtime; process-local pool limit, default 10. | `backend/app/db.py:124` |
| `SUPABASE_DB_NAME` | Backend runtime; discrete DB database, default postgres. | `backend/app/db.py:109` |
| `SUPABASE_DB_PASSWORD` | Backend runtime secret; discrete DB configuration alternative to a full URI. | `backend/app/db.py:108` |
| `SUPABASE_DB_PORT` | Backend runtime; discrete DB port, default 5432; pooler settings must match chosen connection mode. | `backend/app/db.py:110` |
| `SUPABASE_DB_SSLMODE` | Backend runtime; DB TLS policy, default require. | `backend/app/db.py:122` |
| `SUPABASE_DB_TIMEOUT_SEC` | Backend runtime; connection timeout, default 10. | `backend/app/db.py:123` |
| `SUPABASE_DB_URL` | Backend runtime secret; preferred Postgres connection URI. | `backend/app/cloud_ingest.py:68`, `backend/app/db.py:100` |
| `SUPABASE_DB_USER` | Backend runtime; alternate discrete DB configuration, default postgres. | `backend/app/db.py:107` |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend runtime secret; privileged private Supabase Storage requests. | `backend/app/storage.py:64` |
| `SUPABASE_URL` | Backend runtime; Supabase project API origin; must match intended DB project. | `backend/app/storage.py:63` |

Container/platform settings additionally include `PORT`, `HOSTNAME` (frontend bind address), `NODE_ENV`, `NEXT_TELEMETRY_DISABLED`, `PYTHONDONTWRITEBYTECODE` and `PYTHONUNBUFFERED` in Dockerfiles. `KMP_DUPLICATE_LIB_OK` is set internally for OpenMP compatibility (`main.py:10`); it is not a new credential or cloud requirement. No database/cloud credential is a frontend build argument.

### Local configuration presence — not deployment verification

Backend `.env` explicitly selects Muse and Supabase mode. Its non-secret `SUPABASE_URL` project identity is **`oaadpsarhnqmovuiitym`**. The DB connection identifier was checked privately and matches that project reference; no connection URI, username, password or key is reproduced. `MODEL_API_KEY`, `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `FIXPROOF_SIGNING_KEY_HEX` and `MUSE_REGISTERED_EMAIL` have nonempty local entries. This does not prove validity, entitlement, a running process's loaded configuration, or Cloud Run secret bindings.

Existing runtime environment variables can take precedence over a local dotenv file. Dockerfiles copy application directories selectively; the frontend Docker ignore excludes `.env*`. A local environment change is not propagated into deployed revisions automatically.

### Secret-name inventory and component ownership

Secret Manager IDs can differ from environment variable names. Record the actual mapping; names below are required **environment interfaces**, not assertions that GCP secrets with these exact IDs exist.

| Environment / material | Consumer | Requirement | Live Secret Manager status |
|---|---|---|---|
| `MODEL_API_KEY` | Backend Meta transport, all Meta operations | Required for live Meta features | NOT INSPECTED |
| `SUPABASE_DB_URL`, or one selected URI alias | Backend psycopg/registry/vault | Required for intended cloud DB mode, unless the discrete alternative is used | NOT INSPECTED |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend Storage REST / signing / upload paths | Required for intended privileged private-storage workflow | NOT INSPECTED |
| `SUPABASE_DB_PASSWORD` | Backend discrete DB configuration only | Alternative to credentials inside a full URI; do not configure conflicting alternatives casually | NOT INSPECTED |
| `RESEND_API_KEY` | Backend existing email service | Required for email demo; not needed to load a saved report | NOT INSPECTED |
| `FIXPROOF_SIGNING_KEY_HEX` or `FIXPROOF_SIGNING_KEY_PEM` or mounted private-key file | Backend Ed25519 evidence packages | Stable configured key required for dependable release provenance; mandatory when require-configured flag is true | NOT INSPECTED |
| `NEBIUS_API_KEY` | Existing Nemotron implementation | Only current rollback/default branch; not needed by selected Muse transport. Preserve until removal is approved and rollback addressed | NOT INSPECTED |
| `SUPABASE_ANON_KEY` | Optional backend Storage configuration | Not required by frontend; not a substitute for privileged access | NOT INSPECTED |

`MUSE_REGISTERED_EMAIL` and `FROM_EMAIL` are private contact/configuration values; list their names only. They may be managed as protected configuration or secrets by the owner, but their plaintext must not be copied into this report. `SUPABASE_URL` and model identifiers are configuration, not credentials. **The frontend should have no Meta key, DB password, service-role key, Resend key or signing private key.**

No secret is classified as actually missing or version-disabled without live inspection. Use the procedure below to mark individual missing/broken mappings; do not mistake absence of a same-named Secret Manager object for absence of a custom-named mapping.

## 5. Exact browser-only GCP inspection guide

Use [Google Cloud Console](https://console.cloud.google.com/) with an authorized viewer account. Do not open Cloud Shell. Record only metadata and sanitized notes. Do not export full service YAML, copy complete environment panels or download logs that may contain credentials.

### A. Identify the project and both services

1. Click the **project selector** in the top bar. Record display name, project ID and project number. Look for the project corresponding to number `1097663016023` first; `214713402646` appears in historical URLs and may be a different deployment. Do not select a project based only on a similar name.
2. Use the top search box for **Cloud Run** → **Services**. Clear restrictive region/name filters if needed. Record all FixProof services that actually appear, including region and URL.
3. Open each candidate service by clicking its name. Match frontend/backend using the container/source identity and route role, not merely the service name. Record any custom domain/load balancer separately. Do not create a service.
4. Record the canonical frontend/backend pair for the intended demo; leave selection unresolved if multiple services plausibly qualify.

### B. Revisions, resource settings and rollback metadata

Service details → **Revision history** (some console layouts label this **Revisions**) → click each revision receiving traffic. Record revision ID, traffic percentage, readiness, creation/deployment timestamp, image digest and linked build/source metadata. Repeat for zero-traffic prior revisions; newest does not necessarily mean serving. Official navigation: [Cloud Run revision inspection](https://docs.cloud.google.com/run/docs/managing/revisions).

In the selected revision's read-only details/containers panels, record CPU, memory, request timeout, request concurrency, container port, startup command/arguments, startup/liveness probes, execution environment, service account and revision-level scaling. Also inspect service-level scaling/settings; service and revision limits are distinct. Record CPU allocation/billing and startup boost if shown. Do not use **Edit & deploy new revision** to obtain missing information: mark it unverified if the console does not expose a read-only view. Settings inventory reference: [Cloud Run configuration](https://docs.cloud.google.com/run/docs/configuring).

Rollback inventory: list an actual prior Ready revision and its digest/configuration availability. Check that its referenced secret versions still exist and that its schema/API expectations remain compatible. An old revision existing is only a rollback candidate, not a tested rollback. Do not click **Manage traffic**, assign a tag, edit percentages or invoke an old revision. Platform capability reference: [Cloud Run rollback model](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration).

### C. Networking, authentication and environment names

- Service → **Networking**: record ingress mode, default URL exposure, VPC connector/direct VPC egress and egress routing if shown. Browser-direct API calls need an intentional browser-reachable path; internal ingress alone is insufficient for ordinary judge browsers. Do not change ingress. [Ingress inspection context](https://docs.cloud.google.com/run/docs/securing/ingress).
- Service → **Security**: record whether invoker authentication is required, any IAP arrangement and the runtime service account. If an invoker IAM check setting is visible, record it too; `allUsers` alone is not the complete story in every configuration. Inspect the service's **Permissions** view if available, or **IAM & Admin → IAM**, for service/project-level `roles/run.invoker` bindings and inherited access. Do not grant access or disable authentication. [IAM access model](https://docs.cloud.google.com/run/docs/securing/managing-access).
- Selected traffic-serving revision → **Containers** / environment and secret details: record variable **names**, whether each is plain configuration or Secret Manager-backed, secret resource ID/project and numeric version or alias. Also record mounted secret names/paths if used for signing. Do not reveal payloads or transcribe adjacent plaintext values. If a safe read-only metadata view is unavailable, leave those rows UNKNOWN; do not enter an edit workflow or export YAML to get around it.

Check names against section 4 for **each serving revision**, not only the service's latest template. A frontend `NEXT_PUBLIC_API_URL` runtime entry is not evidence of the built client URL. Secret env values are resolved for instances, so a version/alias and its enabled state matter for both new startup and rollback. [Secret bindings](https://docs.cloud.google.com/run/docs/configuring/services/secrets), [environment configuration](https://docs.cloud.google.com/run/docs/configuring/services/environment-variables).

### D. Build, Developer Connect and remote-source readiness

1. Service → **Source** / linked build details, if present. Record source repository, branch/ref, exact commit SHA, build ID, image digest, Dockerfile path and build context. A mutable image tag is insufficient release evidence.
2. Console search → **Cloud Build** → **History** → open the build linked to the serving revision. Inspect summary/configuration metadata only. Record which Dockerfile/context and frontend API build argument were used; do not expand logs/substitutions containing secrets.
3. **Cloud Build → Triggers**: inspect each FixProof trigger's repository, event, branch/tag expression, region, included/ignored paths, approval requirement, service account and deployment target. Do not press **Run**, enable/disable, edit or save anything. Inspect **Developer Connect → Connections** and the linked repository metadata if that integration is used; other projects may use Cloud Build repository connections instead. Do not reconnect or authorize broader access.
4. Verify whether `main` updates can redeploy either existing service automatically. Record risks to the other service/project; do not infer isolation from a trigger's name.
5. Compare the browser-visible remote commit/build SHA with local release `490f4bf`. A local commit not present in the connected remote cannot be built by a source trigger. Remote availability is UNKNOWN here; this audit does not push or trigger anything.
6. Frontend build must use the canonical backend API origin. Inspect the existing build recipe for explicit Docker build-argument support; if unavailable, record a future build-configuration change requirement. Do not assume a Cloud Run runtime variable or generic build substitution automatically becomes a Docker argument. Do not run a build to check this.

[Cloud Build trigger reference](https://docs.cloud.google.com/build/docs/automating-builds/create-manage-triggers). Browser UI availability depends on the actual integration and viewer permissions.

### E. Secret Manager — metadata only

Console search → **Secret Manager** → open each actual secret ID mapped by the backend revision → **Versions**. Record version number, state (Enabled/Disabled/Destroyed), creation time and any referenced alias. Check the **specific bound version**, not merely whether some enabled version exists; `latest` must be resolved to its actual target. Missing ID, missing version, disabled/destroyed version or inaccessible version is a broken binding, subject to distinguishing permission denial from true absence.

Use **Permissions** metadata, if permitted, to check whether the backend runtime service account has effective `Secret Manager Secret Accessor` access, including inheritance/conditions. Viewer permission allows metadata inspection without payload access. Do not select **View secret value**, copy payloads, add versions, rotate, disable, destroy or change permissions. [Secret version metadata guide](https://docs.cloud.google.com/secret-manager/docs/view-secret-version).

Fill one row per mapping:

| Consumer revision / env name | Actual secret resource ID | Bound numeric version or alias | Resolved version Enabled? | Runtime account access? | Result |
|---|---|---|---|---|---|
| Backend / each section-4 secret | NOT INSPECTED | NOT INSPECTED | UNKNOWN | UNKNOWN | Pending |
| Frontend / any secret reference found | NOT INSPECTED | NOT INSPECTED | UNKNOWN | UNKNOWN | Review whether it belongs here |

## 6. Supabase browser inspection — expected project and dependencies

Expected local configuration identity: **`oaadpsarhnqmovuiitym`**. This is a public project reference, not a credential. Do not assume a similarly named project or the old deployment uses it.

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → correct organization → project. Check the project reference in the browser URL and **Project Settings → General** (project/reference ID). Record name, reference, region and project status. Stop the comparison if identity differs; do not modify either project.
2. **Database → Tables** (or **Table Editor**, schema `public`): inspect definitions/columns, not application row contents. Confirm every table below. If the UI opens rows by default, switch to schema/definition view and do not copy personal data or incident content.
3. Confirm migration 002's incident fields `score_version`, `screening_mode`, `session_id`, `suspect_storage_path` and `thumbnail_storage_path` as well as the two added tables. Mere table-name presence is not full schema compatibility: compare definitions, indexes, constraints and relationships with the SQL files.
4. Inspect **Database → Migrations** if that read-only view exists. Otherwise inspect migration metadata as described below. SQL executed manually or through this repository's psycopg helper may not populate Supabase CLI history; no history row is not proof the schema is missing. Local migration manifests are historical evidence, not proof for this project. [Supabase migration-history caveat](https://supabase.com/docs/guides/deployment/database-migrations).
5. **Storage → Buckets**: record exact IDs, Private/Public indicators, size/MIME restrictions and availability. Open read-only bucket details/policies, not upload/create/edit controls. **Storage → Policies** and **Database → Policies** expose separate access controls. Check `storage.objects` RLS and matching bucket policies; do not add anonymous policies to make a demo appear functional. [Storage policy model](https://supabase.com/docs/guides/storage/security/access-control).
6. **Database → Policies** (and available table privileges/schema views): record RLS state, policy roles/expressions/operations and privileges. Do not toggle RLS, edit grants or execute migrations. A service-role storage credential is privileged; private buckets alone do not secure public backend mutation endpoints.

### Required nine application tables

| Table | Required role | Migration | Live status |
|---|---|---|---|
| `reference_assets` | Reference registry | 001 | NOT INSPECTED |
| `reference_frames` | Registered reference frames | 001 | NOT INSPECTED |
| `reference_vectors` | Vector metadata / lifecycle | 001 | NOT INSPECTED |
| `investigation_jobs` | Job state | 001 | NOT INSPECTED |
| `incidents` | Incident/evidence records, extended by 002 | 001 + 002 | NOT INSPECTED |
| `nemotron_reports` | Structured investigation reports, including current Muse reports | 001 | NOT INSPECTED |
| `vault_snapshots` | Active snapshot metadata/checkpoints | 001 | NOT INSPECTED |
| `vision_verifications` | Stored vision verification records | 002 | NOT INSPECTED |
| `evidence_packages` | Signed evidence package registry | 002 | NOT INSPECTED |

`backend/migrations/001_initial_schema.sql` creates seven tables and the `uuid-ossp` extension. `002_cloud_persistence_expansion.sql` adds two tables and incident fields. Neither creates storage buckets or seeds required demo data. Empty schema-compatible projects can start with an empty vault; a usable demo still needs existing authorized reference/evidence data.

There is no application-managed migration-history table in these two files. `scripts/apply_schema.py` applies only 001. `scripts/initialize_new_project.py` applies 001+002 only to an explicitly confirmed empty project and revokes anon/authenticated table access. **Do not run either now**, and never use the empty-project initializer on the existing project. Startup does not safely upgrade arbitrary deployed schemas.

Migration 002 enables RLS on seven tables and defines six broad public-read policies. The initializer's separate revocations change effective access; grants, policies and backend privilege must be inspected together. RLS is not enabled by 002 on `investigation_jobs` or `vault_snapshots`. Report actual live state rather than claiming all nine are protected simply because 002 ran.

### Required six buckets — intended Private

| Exact bucket ID | Content | Restriction to inspect, not change | Live status |
|---|---|---|---|
| `reference-assets` | Reference video | Supported video types and realistic upload size | NOT INSPECTED |
| `reference-frames` | Reference JPEGs | JPEG access | NOT INSPECTED |
| `vault-snapshots` | FAISS index / JSON | Binary and JSON allowed | NOT INSPECTED |
| `suspect-videos` | Suspect video | Supported video types, including MOV/MIME fallback | NOT INSPECTED |
| `suspect-frames` | Suspect JPEGs | JPEG access | NOT INSPECTED |
| `evidence-packages` | Signed ZIP archives | ZIP allowed | NOT INSPECTED |

Bucket IDs are fixed source contracts (`cloud_ingest.py`, `main.py`, `vault.py`, `registry.py`, `temporal_selector.py`); no environment variable renames them. Do not assume the six buckets also persist detailed report PDFs or new brief JSON: current code stores those on local disk.

### Optional browser SQL metadata inspection, read-only only

If the Dashboard lacks a suitable schema/policy/migration view, the owner may use **SQL Editor → New query** for the following metadata-only transaction. This is browser SQL, not a terminal/CLI command. It is provided as an inspection option, not executed by this audit. Do not paste migrations, press AI schema-change actions or modify the query into DDL/DML.

~~~sql
BEGIN TRANSACTION READ ONLY;
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN
 ('reference_assets','reference_frames','reference_vectors',
  'investigation_jobs','incidents','nemotron_reports','vault_snapshots',
  'vision_verifications','evidence_packages')
ORDER BY table_name;

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN
 ('reference_assets','reference_frames','reference_vectors',
  'investigation_jobs','incidents','nemotron_reports','vault_snapshots',
  'vision_verifications','evidence_packages')
ORDER BY table_name, ordinal_position;

SELECT schemaname, tablename, rowsecurity
FROM pg_tables WHERE schemaname = 'public'
ORDER BY tablename;

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname IN ('public','storage')
ORDER BY schemaname, tablename, policyname;

SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND grantee IN ('anon','authenticated')
ORDER BY table_name, grantee, privilege_type;

SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets ORDER BY id;

SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema='supabase_migrations' AND table_name='schema_migrations';
ROLLBACK;
~~~

Only if the last metadata query confirms the history table exists, inspect version/name metadata in a separate read-only transaction (first check its columns if needed). Do not select stored SQL statements or application rows:

~~~sql
BEGIN TRANSACTION READ ONLY;
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
ROLLBACK;
~~~

If permissions prevent inspection, mark UNKNOWN; do not grant yourself access or repair migration history. Cross-check migration history with actual definitions. ROLLBACK here closes the read-only transaction; no data changes are issued.

## 7. Browser inventory worksheet

All live cells begin unverified. Fill only what is actually visible to your authorized browser account. Share a sanitized transcription rather than full environment/YAML/log screenshots.

| Item | Frontend | Backend |
|---|---|---|
| GCP project ID / number | UNKNOWN | UNKNOWN |
| Actual service name / region | UNKNOWN | UNKNOWN |
| Service URL / custom origin | UNKNOWN | UNKNOWN |
| Serving revision(s) + traffic % totaling 100 | UNKNOWN | UNKNOWN |
| Revision timestamp + Ready status | UNKNOWN | UNKNOWN |
| Image digest / build ID / exact source SHA | UNKNOWN | UNKNOWN |
| Dockerfile / source context | UNKNOWN | UNKNOWN |
| CPU / memory / timeout / concurrency | UNKNOWN | UNKNOWN |
| Service + revision min/max instances | UNKNOWN | UNKNOWN |
| Runtime command / worker count / port | UNKNOWN | UNKNOWN |
| Ingress / auth / invoker-check / IAM | UNKNOWN | UNKNOWN |
| Runtime service account | UNKNOWN | UNKNOWN |
| Env names / secret resource + version names | UNKNOWN | UNKNOWN |
| Baked API origin matches canonical backend | UNKNOWN | N/A |
| Exact CORS frontend origin | N/A | UNKNOWN |
| Provider selector explicitly Muse | N/A | UNKNOWN |
| Supabase project identity match | N/A | UNKNOWN |
| Prior Ready revision + compatible secret versions | UNKNOWN | UNKNOWN |
| Connected remote source and auto-deploy trigger | UNKNOWN | UNKNOWN |

Supabase worksheet: project reference/region/status; nine table definitions; incident 002 fields; migration-history evidence; six private bucket IDs; MIME/size settings; table/Storage RLS policies and privileges; existing authorized demo evidence availability. Every item is currently **NOT INSPECTED**.

## 8. Health / smoke endpoints — plan only, not invoked

Do not use a live smoke test as a substitute for metadata inventory: cold-starting the backend can initialize/reconcile storage. Do not open SAM/temporal summary tabs or use voice/report actions during this read-only audit; those interfaces can initiate inference or saved artifacts.

| Route / page | Purpose and limitation | Gate |
|---|---|---|
| `GET /health` or `/api/health` | Returns shallow `status=ok`; does not prove DB, key validity, entitlement or email delivery | Later approved runtime smoke; startup caveat |
| `GET /api/nemotron/status` | Current selected provider/model names and configuration booleans despite legacy route name; `status_scope=configuration` | Later smoke; do not record `email_from` value |
| `GET /api/vault/status` | Vault counts, DB mode/cloud flag; may depend on privileged DB reads | Later approved runtime smoke |
| `GET /api/muse/incidents` | Session-scoped assistant incident list | Later smoke with existing valid session |
| `GET /api/incidents/{id}` | Existing authorized incident record | Later smoke; no invented IDs, no sensitive output in audit |
| `GET /api/incidents/{id}/temporal-evidence` | Deterministic statistics from recorded evidence | Later smoke with real existing session header |
| `GET /api/sam/incidents/{id}/candidates` | Existing eligible candidate queue, not automatic segmentation | Later smoke with valid session; GET is not inference success |
| `GET /api/incidents/{id}/evidence-summaries/{sam or temporal}` and `.../pdf` | Read an already saved brief/PDF; 404 can mean no artifact or ephemeral instance loss | Later smoke; POST on brief path DOES infer/save |
| `GET /api/reports/{report_id}` / `.../pdf` | Existing detailed-report aliases | Later smoke on an existing report, not report creation |
| Frontend `/`, `/dashboard`, `/muse`, `/voice-test` | Current page routes; browser Network can confirm public API origin after runtime testing is approved | Do not record/upload speech or use action buttons now |

`POST /diagnose`, conversation messages, voice transcription, automatic SAM, summary generation, investigation generation, PDFs/reports, email, ingestion/indexing/scanning and `POST /api/vault/sync` are **not read-only inventory checks**. PDF download of an existing report/brief is a read path; generating a new report/PDF is distinct. Never run wildcard integration tests, live-video scripts, `test_nubius.py`, reset or migration tools in this task.

## 9. Current code versus deployment-era assumptions

| Current repository fact | Release implication | Deployment state |
|---|---|---|
| Local HEAD reference is `490f4bf`, containing saved evidence summaries / approval hardening; prior documented checkpoints include `2da94ab` voice-first and `59b7c7d` P3/Copilot | Local completion does not mean remote source or deployed images contain it | Exact deployed SHA UNKNOWN |
| Muse providers, voice endpoint/capture, conversation lifecycle/orchestration, approval gates, SAM workspace, temporal API and saved-brief routes exist | Older frontend/backend contract combinations can fail; both images need a coordinated source target | Installed route versions UNKNOWN |
| Frontend API URL is baked during build; Dockerfile has a concrete v2 default | Earlier missing-build-argument workaround does not prove current bundle targets the intended backend | Built URL UNKNOWN |
| Reasoning/vision factory default remains `nemotron` | A fresh environment without explicit selector can call Nebius or fail; local Muse does not prove deployed Muse | Runtime selector UNKNOWN |
| Same 001/002 application schema supports current features; new chat/SAM/brief layers do not add tables | Do not run initialization merely because code is newer; inspect schema first | Live compatibility UNKNOWN |
| New brief JSON joins report/PDF/audit local disk; conversations/SAM remain in memory | Prior 'saved' behavior is not durable/shared Cloud Run persistence | Replica/worker settings UNKNOWN |
| Explicit exact email approval, fixed recipient, actual PDF checks and duplicate suppression are implemented | Resend key alone does not establish sender eligibility or delivered email | Sender/key entitlement UNKNOWN |
| Backend CPU ML dependencies use broad minimum versions in `requirements.txt` | A fresh image may resolve different dependencies even with similar Dockerfiles; capture build identity and perform later controlled verification | Old dependency/image identity UNKNOWN |

No claim is made that two Dockerfiles or dependency sets are byte-identical to an actual deployed revision without its source/image metadata. Repository docs mention candidate deployment-era commits `c4df378` / `2cd8d92`; those are leads, not a verified deployment baseline.

## 10. Nemotron / Nebius dependency map — removal audit only

**No removal is implemented.** There is no observed automatic failover from a failed Muse inference into Nemotron in the selected Meta implementations. The risk is default/explicit selection and retained shared code, not an invented failover claim.

| Dependency | Actual source / call chain | What breaks if simply deleted |
|---|---|---|
| Provider selection | `backend/app/providers/factory.py:11,25–35,47,61,72` imports/registers Nemotron classes and defaults reasoning/vision to it | Missing imports break factory load; unset-env behavior changes; rollback removed |
| Backend legacy implementation | `providers/nemotron.py` → `nemotron_engine.py` / `vision_verifier.py` | Explicit legacy provider operations cease; selected Muse still imports shared helpers below |
| Muse shared report helpers | `providers/meta.py:238–239` imports `build_user_prompt`, `build_failed_report`, `SYSTEM_PROMPT` from `nemotron_engine.py` | Muse investigation generation fails if module is deleted before extracting provider-neutral helpers |
| Muse shared image helpers | `providers/meta.py:56,153` imports `vision_verifier.py` for deterministic preparation/cache utilities | Muse vision/multimodal report preparation breaks even though transport is Meta |
| API startup/model validation | `main.py:113–117` imports legacy allowlist/default helpers; `main.py:1043–1120` has provider-aware investigation logic; `/diagnose` retains legacy branch | Import/override handling may break; no blanket search/replace |
| Document/email services | `main.py:119–126` and `muse_actions.py` reuse `nemotron_action.py`; that module imports engine model helpers at `:25` | Rights drafts, Resend, approvals and report-cover workflows break. The legacy filename is not an obsolete service |
| Legacy status route | `main.py:1399–1427` → provider factory; `frontend/lib/api.ts:391–392` → `/api/nemotron/status`, consumed by dashboard/Muse components | Dashboard/provider status breaks if route removed before coordinated client migration |
| Other legacy routes | `frontend/lib/api.ts:399–532` calls draft, email-status/audit/send and detailed-report/list/PDF/email/summary endpoints under `/api/nemotron/` | Removing prefix breaks current document/PDF/email workflows. Neutral `/api/reports/{id}` aliases cover some reads, not all routes |
| Report database | `registry.py:813–1012` loads/inserts/looks up `nemotron_reports`; `muse_tools.py:81` calls strict report reads; `main.py` and `detailed_report.py` read existing history | Both Muse and historical reports become unavailable; this table is provider-neutral in use despite its name |
| Schema/operations | `migrations/001_initial_schema.sql:144` creates table; 002 adds its RLS/policy; `db.py:350,357` recognizes table; migration/init/verification tools expect it | New-project initialization, schema checks and rollback compatibility diverge if old migration text is changed/deleted |
| Historical model provenance | `evidence_models.py:159` default; `evidence_package.py:199,724` legacy actor/model fallback; `detailed_report.py:735,1388` vision provenance fallback | Careless relabelling can falsely attribute old results to Meta or alter signed evidence provenance |
| Frontend names / branding | `NemotronCenter.tsx`, `frontend/lib/types.ts`, `lib/api.ts`; `NvidiaJudgePreloader.tsx`; historical assets/docs | Some are active component identifiers/brands, not provider calls. Rename only after tracing imports and preserving UI/API contracts |
| Unused scaffold / tests | `providers/muse.py` contains stale scaffold messaging; factory uses `meta.py` instead. Legacy parity/factory/engine/action tests remain | Deleting active tests hides compatibility regressions; scaffold retirement is separate from working Meta provider removal |
| Nebius configuration | `NEBIUS_API_KEY`, `NEBIUS_BASE_URL`, `NEBIUS_MODEL`, `NEBIUS_TIMEOUT_SEC`, `NEBIUS_MAX_TOKENS`; `main.py:1377` legacy URL; `nemotron_engine.py` and `vision_verifier.py` | Old revisions may still need these names and enabled secret versions for rollback |

Voice has no Nemotron voice implementation and rejects a non-Muse selection. SAM's factory defaults to Muse and can resolve its Meta specialist even if another global provider name is present. This mixed behavior is another reason to explicitly inventory **each capability**, not infer all providers from one status label.

### Safe future removal sequence — requires separate approval

1. Complete live source/revision/schema/secret inventory and identify a real rollback pair. Preserve old image digests, secret-version metadata and historical report data; do not expose key values.
2. Establish a Meta-only tested release baseline with explicit selector, correct model IDs and actual source SHA. Do not combine an unverified deployment refresh, destructive schema rename and provider removal into one irreversible release.
3. Extract provider-neutral prompt construction, failure builders, image preparation/cache helpers, document/email services and model-validation contracts. Update Meta imports and cover them offline before deleting legacy modules. Preserve CV/evidence semantics.
4. Introduce neutral status/document/report API contracts and update all frontend clients together. Keep temporary compatibility aliases while old frontend/backend revisions can still serve. Remove aliases only after that window closes; this is a staged path to eventual removal, not permission to leave an active Nemotron provider indefinitely.
5. Remove Nemotron registration, factories' default possibility, legacy network transports/URLs and active fallback configuration from the new release. Fail clearly on obsolete provider selection rather than silently selecting something else. Retire stale UI branding/scaffold references and update tests/docs.
6. Treat `nemotron_reports` as a separate data-compatibility migration. First expose neutral repository methods without changing storage. If final naming requires a new table/view, design a reviewed migration preserving primary IDs, incident links, JSON, timestamps, original model IDs and signed evidence references, with row/count/integrity checks and an explicit rollback strategy. No such migration is needed just to serve current Meta requests.
7. Retain immutable historical migrations and factual old-model provenance. Do not rewrite old report model IDs to Muse or regenerate signed history merely to remove a word. A compatible legacy physical table/view may need to remain until old revisions are retired; final active-name removal follows verified data migration, not deletion of historical evidence.
8. Only after old revisions no longer need Nebius and the owner accepts the new rollback strategy, separately approve removal of obsolete service env bindings and secret access/material. Do not delete/disable secrets while claiming the old revision still provides working rollback. No secret change is authorized now.

## 11. Deployment gaps, severity and evidence

Severity expresses release impact; UNKNOWN live state is not a proven outage.

| ID | Class | Finding | Evidence class | Required browser confirmation / disposition |
|---|---|---|---|---|
| G01 | BLOCKER | Canonical project/service pair, serving SHAs, traffic and image identities are unknown | MANUAL | Complete section 7 before planning an actual rollout |
| G02 | BLOCKER | Full Meta demo depends on mapped enabled secrets and intended Supabase identity/schema/buckets | Requirements REPOSITORY VERIFIED; live status UNKNOWN | Match runtime names to actual IDs/versions and project; missing/broken mappings block relevant feature |
| G03 | BLOCKER | Remote release source and Developer Connect/Cloud Build behavior unverified | MANUAL | Confirm release SHA is remote and trigger targets; do not push or run anything during audit |
| G04 | HIGH | Nemotron remains a real reasoning/vision default; final Meta-only objective not yet met | REPOSITORY VERIFIED | Verify explicit Muse selector in every serving backend revision; removal only after approved dependency work |
| G05 | HIGH | Potential frontend/backend URL mismatch across two project numbers and multiple backend identities | REPOSITORY VERIFIED candidates; live bundle UNKNOWN | Confirm canonical URL, baked build argument and CORS origin. Runtime-only frontend fix is insufficient |
| G06 | HIGH | Reports/briefs/audit on ephemeral disk; conversations/SAM/approval dedupe process-local | REPOSITORY VERIFIED | Record replica/worker/revision layout and acceptable demo limitations; single instance reduces routing issues but does not prevent restarts/loss |
| G07 | HIGH | Backend startup may reconcile/checkpoint the vault; 'smoke' can mutate cloud state | REPOSITORY VERIFIED | No runtime invocation/restart now; review correct project and side effects before separately approved deployment/testing |
| G08 | HIGH | Public browser API requires compatible ingress/auth; broad backend mutations lack general authentication | REPOSITORY VERIFIED architecture; live access UNKNOWN | Record intended access design/IAM. Do not blindly make backend public to resolve an old 403 claim |
| G09 | HIGH | RLS policy/privilege mix depends on how schema was initialized | REPOSITORY VERIFIED scripts; live grants UNKNOWN | Inspect all nine table grants/RLS and Storage policies; bucket privacy alone is insufficient |
| G10 | HIGH | Old Ready revisions may not be usable rollback if secret versions/schema/contracts change | MANUAL | Inventory previous revision plus its effective dependencies; do not change traffic to test now |
| G11 | MEDIUM | Fresh dependency resolution may drift; CPU/memory/timeouts/concurrency not established for new workloads | REPOSITORY VERIFIED requirements; live capacity UNKNOWN | Record old image/build/resources and plan later controlled build/runtime verification |
| G12 | MEDIUM | Resend config presence does not prove sender/account entitlement or delivery; approval dedupe is process-local | REPOSITORY VERIFIED; live service UNKNOWN | Verify metadata/configuration later; actual send requires separate explicit authorization |
| G13 | MEDIUM | Default DB mode local and default CORS localhost can make a fresh deployment appear empty/broken | REPOSITORY VERIFIED | Verify cloud mode and exact origin in intended backend revision without printing values |
| G14 | LOW | Stale deployment docs, legacy names and NVIDIA branding remain | REPOSITORY VERIFIED | Keep history; separately approve targeted documentation/branding cleanup |
| G15 | VERIFIED | Two independent Docker build contexts, backend 8080, frontend standalone 8080 | REPOSITORY VERIFIED only | Compare against live revision metadata; not a live build result |
| G16 | VERIFIED | Required schema is nine tables / six private buckets; current new features add no migration | REPOSITORY VERIFIED only | Presence/definitions/access in actual project still NOT INSPECTED |
| G17 | VERIFIED | Current Meta model defaults and 46 application environment names documented above | REPOSITORY VERIFIED only | Deployed provider and keys remain UNKNOWN |

## 12. Safe next steps, in order

1. **Next browser action:** open Google Cloud Console's project selector, identify project number `1097663016023` (or explicitly identify the actual demo project), then **Cloud Run → Services**. Record actual frontend/backend names, URLs and regions. Do not invoke application URLs yet.
2. For both services, open **Revision history**, record every serving revision's traffic, timestamp, digest/build/source SHA, resource metadata and one prior Ready rollback candidate. Confirm remote source availability and auto-deploy trigger targets before any later source publication.
3. Inspect **Security/Networking** and revision env/secret **names/references** read-only. Confirm the intended Muse/database/CORS configuration privately; do not send values.
4. Inspect **Secret Manager → each mapped secret → Versions** and effective runtime-account permissions. Identify precisely which referenced ID/version is missing, disabled, destroyed or inaccessible. Do not repair it now.
5. In Supabase, match reference `oaadpsarhnqmovuiitym`, then inspect schema, migration metadata, six buckets and access policies/privileges using section 6. Stop on identity mismatch; do not initialize an existing project.
6. Return only the sanitized worksheet: project/service/revision/build names, percentages, resource settings, configuration names, secret IDs/version states, table/bucket presence and policy summaries. Exclude payloads, connection strings, addresses and user/incident contents. UNKNOWN is acceptable where permissions/UI prevent safe inspection.
7. Review the resulting gaps and **obtain owner approval for a specific browser-only release plan**. Future release work must build from a known source SHA, preserve an actual rollback pair, account for vault-startup writes and match frontend build URL/backend runtime configuration. None of those actions is authorized by this report.
8. Schedule Nemotron removal as the separate dependency/data-compatibility sequence above. Do not remove it, modify secrets, run migrations, deploy a revision or change traffic until separately approved.

### Completion statement

This report inspects current repository requirements and supplies a browser checklist. It does **not** verify current Cloud Run deployment, external reachability, active Secret Manager versions, live Supabase schema/policies/data, remote release availability or rollback viability. No test/build was rerun, and no previous successful local test is presented as a cloud verification. Stop here for owner review.
