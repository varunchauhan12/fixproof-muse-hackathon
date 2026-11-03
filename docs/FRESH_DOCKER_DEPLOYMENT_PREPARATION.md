# Fresh two-service Docker deployment preparation

2026-11-03. Local preparation only. Baseline `main` at `955bc09`, which already contains the Muse-only migration. The attachment's `24930e9` baseline predates that migration commit.

## Current release gate

**NOT READY — FIXES REQUIRED** for the requested GitHub push/deployment handoff: the owner answered “I'm not sure” about automatic deployment triggers watching `main`. No push is permitted until that uncertainty is resolved. A local deployment-preparation commit is permitted and does not publish code. No GCP resources were accessed or changed.

`origin` is `https://github.com/varunchauhan12/fixproof-muse-hackathon.git`; upstream is `origin/main`. A real `git fetch --no-tags origin` succeeded. At that check there were 16 local-only commits and zero remote-only commits. The proposed local preparation commit adds one more. No force push, merge, reset or rebase is planned. If remote work changes before a future push, stop for review.

### Browser check required before a later push

In the correct Google Cloud project and every relevant region, open **Cloud Build → Triggers**. Inspect repository, branch/tag expression, event, inline/repository build configuration and deployment targets for each trigger. Also inspect **Developer Connect** repository connections and the existing Cloud Run services' connected source/build settings. Confirm that a push to `main` cannot automatically rebuild or redeploy an existing service. No GitHub Actions workflow was found in the repository, but that does not establish that external triggers are absent. Do not delete services or modify triggers as part of this local task. Ask the owner to provide an explicit safe-trigger confirmation before publishing this branch.

## Necessary local changes

- `frontend/Dockerfile`: removed the old backend URL default; requires a nonempty `NEXT_PUBLIC_API_URL` build argument. An executed Node validation step rejects malformed origins, non-HTTPS URLs, localhost/loopback hosts, credentials, URL paths, queries and fragments. It does not print the supplied URL. The existing standalone image, non-root user, port and command remain unchanged.
- `frontend/next.config.ts`: proxy destinations use the same configured backend origin as the browser client. The localhost fallback remains for local development; the production Docker guard prevents using it in a Docker release. No API contract or route is redesigned.
- `backend/.dockerignore`: excludes all `.env*`, Git metadata, virtual environments, Python/tool caches, logs, local storage, local databases, private key files and media. The backend Dockerfile still copies only source, migrations and scripts.
- `frontend/.dockerignore`: additionally excludes incremental build metadata, caches and private key files; existing `.env*`, dependencies, build and test exclusions remain.
- `frontend/tests/test_docker_deployment.mjs`: offline checks for URL rejection, rewrite destinations, existing startup/standalone contracts, COPY sources, instruction/JSON syntax structure and context exclusion patterns.
- This document. No `.env`, `.env.example`, provider implementation, dependency manifest, database migration or cloud configuration was changed.

## Images, contexts and entry points

| Property | Backend | Frontend |
|---|---|---|
| Build context | `backend/` | `frontend/` |
| Dockerfile relative to context | `Dockerfile` | `Dockerfile` |
| Base | Python 3.11 slim | Node 20 Alpine, three-stage standalone build |
| Container port | `8080` by default; uses Cloud Run `PORT` | `8080` by default; standalone server uses `PORT` |
| Bind | `0.0.0.0` | `HOSTNAME=0.0.0.0` |
| Startup | `sh -c 'exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}'` | `node server.js` |
| Build argument | None | `NEXT_PUBLIC_API_URL` required |
| Basic availability | `/health` or `/api/health` | `/` or `/dashboard` |

The root-level Dockerfile is not used for either of these builds. Do not build with the whole repository as Docker context. In a Cloud Build checkout at repository root, set the build step directory to `backend` or `frontend` and use `.` as its context.

Backend packages include FFmpeg, libgl1, libglib2.0-0 and curl, CPU Torch/torchvision wheels and the existing Python requirements for FastAPI, OpenCV, FAISS, PostgreSQL, cryptography and ReportLab. The stack is unchanged. Fresh Linux image compilation and native-library loading remain unverified because the Docker daemon is unavailable. No alternative dependency stack or package installation was introduced.

## Backend runtime checklist — before first deployment

All credentials are backend-only Secret Manager references. Never place values in Docker build args, source, frontend configuration, logs or this document.

| Setting | Requirement |
|---|---|
| `MODEL_API_KEY` | Required for Muse inference; backend secret |
| `FIXPROOF_AI_PROVIDER=muse` | Recommended explicit selector; omission also defaults to Muse |
| `FIXPROOF_DB_MODE=supabase` | Required to use the intended cloud database/storage |
| `SUPABASE_DB_URL` | Required full DB URL, backend secret; prefer this over compatibility aliases used inconsistently by older vault paths |
| `SUPABASE_URL` | Required intended Supabase project endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | Required backend private-storage access secret; never expose to frontend |
| `FIXPROOF_ENV=production` | Recommended deployed safety mode; forces demo-mode bypass off |
| `FIXPROOF_CORS_ORIGINS` | Exact final frontend HTTPS origin, no wildcard. If unknown before first backend deployment, explicitly use an empty allowlist, then update manually once the frontend URL is known |
| `FIXPROOF_REQUIRE_CONFIGURED_SIGNING_KEY=true` | Recommended for deployed evidence export |
| One of `FIXPROOF_SIGNING_KEY_HEX`, `FIXPROOF_SIGNING_KEY_PEM`, or mounted secret file plus `FIXPROOF_SIGNING_KEY_PATH` | Required for stable, configured evidence signing with the preceding flag |
| `FIXPROOF_SIGNING_KEY_ID` | Optional stable signing identity label |
| `RESEND_API_KEY` | Required only for email sending; backend secret |
| `FROM_EMAIL` | Required verified sender for the intended email workflow; code default is not proof of domain verification |
| `MUSE_REGISTERED_EMAIL` | Required fixed approved destination for Copilot email actions |

For the full demo, supply the signing and email rows if those features will be demonstrated. With email omitted, the UI must report sending unavailable; document preparation remains usable. Explicit user approval before sending is unchanged.

Optional model/tuning controls, normally omitted to retain repository defaults: `MUSE_BASE_URL` (`https://api.meta.ai/v1`), `MUSE_REASONING_MODEL` (`muse-wonder-1.0`), `MUSE_VISION_MODEL` (`muse-spark-1.3`), `MUSE_SAM_MODEL` (`sam-3.1`), `MUSE_VOICE_MODEL` (`muse-voice-transcribe-1.0`), `MUSE_REASONING_EFFORT`, `MUSE_TIMEOUT_SEC`, `MUSE_MAX_TOKENS`, `MUSE_CONVERSATION_TTL_SECONDS`, `SUPABASE_DB_SSLMODE` (`require`), `SUPABASE_DB_TIMEOUT_SEC`, `SUPABASE_DB_MAX_CONNECTIONS`, and `FIXPROOF_RATE_LIMIT_PER_MINUTE`.

The full compatibility-variable inventory is in `docs/MUSE_ONLY_MIGRATION_VERIFICATION.md`; no obsolete provider variables are required for this deployment. Do not supply redundant DB URL/component fields. The frontend needs no backend credential and no Supabase service-role key. Cloud Run supplies `PORT`; Docker supplies the existing Python/Node production conventions.

Before starting a cloud-configured backend, the owner must verify the correct Supabase project, existing nine application tables, six private buckets, existing migrations, database connectivity and storage privileges. Normal backend startup can reconcile/checkpoint the vault; it is not a read-only database check. No migration or initialization was run here.

## Backend-first browser deployment sequence — future owner actions

These are instructions only. No build, registry publication, deployment, cloud CLI command or trigger modification was executed.

1. Resolve the old auto-deployment-trigger gate above before any GitHub push. Once explicitly confirmed and separately resumed, re-fetch/check `origin/main`, review the outgoing commit range and push only a safe fast-forward.
2. In the intended project, choose/verify an Artifact Registry Docker repository and authorized build/service identities. Use a manual **build-only** configuration with source at the reviewed release commit. Do not reuse an old deployment trigger blindly.
3. Build the backend image with `dir: backend`, `Dockerfile`, context `.`. Record the immutable image digest. Supply no backend secrets to this build.
4. Cloud Run → Services → create the intended new backend service from that image. Before deployment, enter the backend runtime/secret checklist, container port 8080, deliberate ingress/auth policy and measured resource settings. Use the existing single Uvicorn process. Browser clients currently do not mint Cloud Run IAM tokens, so a private IAM-only backend needs a separately approved access design; no such design was added here.
5. Copy the actual new backend service URL from Cloud Run. Verify `/health`, startup logs and `/api/muse/status` (configuration scope only). Do not infer a URL from old documentation. Database/SAM/AI/report endpoints can have side effects and are not generic health probes.
6. For the frontend manual build, supply **Docker build arg `NEXT_PUBLIC_API_URL`** equal to that verified HTTPS origin. If using the sample below, enter it as Cloud Build substitution **`_BACKEND_URL`**. The build passes it to Docker explicitly. Runtime environment variables alone do not modify compiled browser bundles or build-generated rewrites.
7. Build from `dir: frontend`, `Dockerfile`, context `.`, record its image digest, then create a separate Cloud Run frontend service from that image, port 8080. Retain the standalone startup. It requires no backend secrets.
8. Record the actual frontend URL. If it was not known earlier, manually update the backend CORS allowlist to that exact origin. This creates a backend revision and can restart/reconcile the cloud vault; perform it deliberately.
9. In the browser, load the frontend and inspect Network/Console. Confirm API requests target the new backend and that session-header preflights and real reads succeed. Old URLs, mixed content, CORS failures or runtime-only frontend URL edits are failures. Model/voice/video/email tests require separate controlled authorization.

### Supplying the frontend build argument without a cloud CLI

Cloud Build supports manual invocations, inline YAML configuration and substitution values. After the push gate is resolved, the owner can prepare a **manual**, build-only configuration in **Cloud Build → Triggers**, select the intended repository/revision, choose **Cloud Build configuration → Inline → Open Editor**, and enter the relevant sample. Supply the substitution values in the console; do not attach these configurations to automatic push events or add deployment steps. Console labels can vary by repository connection generation. [Manual builds](https://docs.cloud.google.com/build/docs/manually-build-code-source-repos), [build configuration schema](https://docs.cloud.google.com/build/docs/build-config-file-schema), [substitutions](https://docs.cloud.google.com/build/docs/configuring-builds/substitute-variable-values).

Backend build-only sample (repository checkout root):

```yaml
steps:
  - name: gcr.io/cloud-builders/docker
    dir: backend
    args: ['build', '--file', 'Dockerfile', '--tag', '${_IMAGE}', '.']
images: ['${_IMAGE}']
```

Frontend build-only sample:

```yaml
steps:
  - name: gcr.io/cloud-builders/docker
    dir: frontend
    args:
      - build
      - --file
      - Dockerfile
      - --build-arg
      - NEXT_PUBLIC_API_URL=${_BACKEND_URL}
      - --tag
      - ${_IMAGE}
      - .
images: ['${_IMAGE}']
```

`_IMAGE` must be the owner-selected full Artifact Registry image URI and tag for the corresponding service. `_BACKEND_URL` must be the **actual verified new backend origin**. No real project, registry, service name or backend URL is invented here. These YAML snippets publish images when the owner runs them, but contain **no service deployment step**. They are documentation, not active repository trigger files. The owner must configure appropriate build identity/logging permissions when creating a future manual build.

## Verification results

- Backend explicit isolated release suite: **600 run, 593 passed, 7 skipped; zero failures/errors**. Temp-copy local storage, `.env` disabled, external sockets blocked. No cloud vault startup against real credentials.
- Frontend explicit offline regression suite: **120 passed**. No live integration scripts, model inference, exports or email sends.
- New Docker/deployment contract suite: **4 passed**, including executing the exact Dockerfile Node URL guard for valid and invalid dummy values. Static instruction/CMD structure, COPY-source existence and ignore patterns were checked; this is not a Docker engine parser/build.
- TypeScript passed. Targeted `next.config.ts` ESLint passed. Existing broader frontend lint debt from the preceding report remains outside these deployment edits.
- Production frontend build passed with the reserved fixture `https://example.invalid`. That was a test-only build input, never a proposed backend address or committed deployment default. No `.env` file was edited, and those local build artifacts must not be deployed as the release image. Inspecting the build rewrite manifest confirmed use of the fixture instead of the former localhost proxy target.
- Docker CLI exists, but `docker info` failed because the local Docker daemon socket was absent. **Neither actual Docker image was built or run.** Fresh Linux dependency resolution, native library loading, image startup and memory usage remain unverified. No daemon was started or machine configuration changed.
- The complete outgoing history was scanned for configured local credential/private values and credential-shaped text, without displaying those values. Placeholder URLs/redaction examples were reviewed separately. No actual credential exposure was identified. `.env.example` history contains documented placeholders, not the local env files.
- No active old-provider client, registration or fallback was reintroduced. Compatibility aliases and historical report schema remain unchanged. No database migration, Supabase action or secret modification occurred.

## Remaining deployment risks

- **Push blocked:** unknown automatic deployment triggers. The absence of an in-repository workflow does not prove a push is safe.
- Real image builds and actual new service URLs/credentials/IAM/CORS are unverified. Confirm secrets have active versions and service identities can access only the required secrets.
- Unpinned dependency ranges can resolve differently in fresh Linux images. The existing Torchvision embedding weights are loaded lazily and can require outbound download on first use; no new weight-fetch behavior was added.
- Existing process-local conversations, approvals, caches and some report/audit storage are ephemeral. Keep a single backend instance/process for the demonstration until shared-state behavior is addressed; restarts still lose memory state. The prior report's CPU/memory starting recommendations require actual testing.
- Existing HTTP/1 upload-limit mismatch remains: use small demo clips comfortably below the platform body limit or approve a separate upload change. This preparation does not redesign uploads.
- No live Muse entitlement, real microphone capture, email deliverability or real fresh-deployment database integration was tested. Health/configuration status is not proof of those workflows.

## Intended local commit

Only: `backend/.dockerignore`, `frontend/.dockerignore`, `frontend/Dockerfile`, `frontend/next.config.ts`, `frontend/tests/test_docker_deployment.mjs`, and this document. Backend Dockerfile and dependency stacks were audited without changes. Exclude all env files, secrets, storage, build outputs and unrelated files. No GitHub push is performed until the trigger safety gate is explicitly resolved.
