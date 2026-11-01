# Local Muse activation and dashboard integration repair

## Observed diagnosis

The Muse page mounted successfully in the browser; no missing page route or component
crash was reproduced. The confirmed integration problems were:

1. The running backend predated Stage C. Before restart, its actual status response
   reported Muse Spark reasoning/detailed synthesis but Nemotron vision. The status
   route was correct; the process had old code loaded.
2. backend/.env had MODEL_API_KEY configured but lacked FIXPROOF_AI_PROVIDER. The
   factory intentionally defaults to nemotron (`providers/factory.py:14,32,46`).
   The old local process depended on a shell override for Muse reasoning.
3. `NemotronCenter.loadStatus` swallowed errors, retained prior status on refresh
   failure, and used hardcoded Muse/model transport fallbacks. Credential presence
   was labeled “Service Online”, although no model access was checked.
4. `DashboardConsole.loadBackendState` turned incident-load errors into empty lists;
   the Muse component similarly suppressed report/history and detailed-list errors.
   Failures could therefore appear as missing records instead of a visible error.
5. The reproduced browser session had no incidents. GET /api/incidents with a fresh
   session header returned HTTP 200 with zero records. This is consistent with the
   local session filter in `registry.py:483-490`; it is not a reason to bypass access
   checks, fabricate incidents, or run inference.

Source locations after repair:

- `frontend/components/layout/Sidebar.tsx:54`: Muse navigation retains internal ID nemotron.
- `frontend/components/dashboard/DashboardConsole.tsx:307`: renders existing NemotronCenter.
- `frontend/lib/api.ts:350`: GET /api/nemotron/status, using the existing API base.
- `frontend/lib/api.ts:235,250,439`: saved report/history/detail-list reads.
- `backend/app/main.py:1270`: existing provider/status endpoint.
- `frontend/lib/types.ts:245`: status response type.
- `frontend/components/dashboard/NemotronCenter.tsx:336,375,395`: status/report loaders.
- `frontend/components/dashboard/DashboardConsole.tsx:104`: incident-load error propagation.

NEXT_PUBLIC_API_URL was already local; no URL configuration change was needed.
Legacy /api/nemotron routes are compatibility names and remain valid. Existing
response names were compatible; provider identity was missing from the status
contract, so four additive metadata fields were added to that existing endpoint.

## Configuration and runtime

Only `FIXPROOF_AI_PROVIDER=muse` was appended to backend/.env. Existing settings,
including MODEL_API_KEY and database credentials, were not rewritten, printed or
duplicated. No .env.example or .env.local change was made during this task.
Model/base-URL defaults remain muse-spark-1.3 / https://api.meta.ai/v1. The source
factory default remains Nemotron and rollback adapters remain intact.

The old backend was identified by exact working directory, uvicorn entry point,
localhost host/port and listener PID, then stopped with SIGTERM. Its replacement
uses the existing virtual environment and preserves the prior process's local
database override:

```sh
# Working directory: backend
FIXPROOF_DB_MODE=local ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The override is intentional preservation of the previously running local instance.
The environment file's Supabase mode/settings remain untouched. This local runtime
does not load cloud-only incidents or the Supabase vault. No cloud startup sync or
database change was invoked.

The actual restarted API returned HTTP 200 for /health, /api/nemotron/status and
/api/vault/status, with:

```json
{
  "provider": "muse",
  "vision_provider": "muse",
  "status_scope": "configuration",
  "db_mode": "local",
  "configured_model": "muse-spark-1.3",
  "vision_model": "muse-spark-1.3",
  "detailed_report_model": "muse-spark-1.3",
  "text_reasoning_available": true,
  "vision_verification_available": true
}
```

These booleans establish configured credentials, not successful inference. The
factory constructors and status path do not instantiate Nebius clients. Isolated
Muse tests also assert no Nebius initialization. No real inference was triggered.

## Minimum repair

The existing status endpoint now adds provider, vision_provider, status_scope and
db_mode. Existing fields/routes remain; no new endpoint was introduced. New frontend
type fields are optional for compatibility.

The existing page now displays selected provider/transport and returned model IDs,
loading status, visible status-fetch errors and unavailable configuration. A failed
status refresh clears stale status. “Credentials configured” replaces “Service
Online”, with an explicit untested-access disclaimer. Nemotron selection produces
Nemotron/Nebius labels; missing identity does not become fake Muse success.

Report and incident load failures are visible instead of silently converted into
ordinary empty data. The incident list distinguishes loading, failure, no records
for the current session, and no filter matches. Recorded report model provenance
is retained; static activity text no longer hardcodes a Muse model. AI generation,
email handlers, authorization, CV, candidate limits, signatures and provider
implementations were not changed.

## Files changed during this task

- backend/.env — append only the nonsecret provider selection; ignored by Git.
- backend/app/main.py — additive configuration-status metadata.
- backend/tests/test_meta_vision_migration.py — assert selected provider identity,
  configuration scope and local database mode for Muse and Nemotron status cases.
- frontend/lib/types.ts — optional status metadata fields.
- frontend/components/dashboard/DashboardConsole.tsx — propagate incident loading/errors.
- frontend/components/dashboard/NemotronCenter.tsx — actual status/provenance and visible states.
- docs/LOCAL_MUSE_ACTIVATION.md — this report.

Generated local frontend runtime output was refreshed under frontend/.next/standalone.
The previous generated output was preserved at
frontend/.next/standalone-before-muse-activation. These are ignored build outputs,
not checkpoint source files. A partial output merge initially retained an old page
bundle; the final installation uses a complete matching generated build, including
prerendered payloads and static files. The served dashboard bundle was checked to
contain “Credentials configured” and the explicit error message, without the old
“Service Online” claim.

No earlier Phase 0A/0B or Stage A/B/C work was discarded. No protected repository,
deployment, cloud setting, production environment or database record was changed.
No commit or push occurred.

## Safe verification

| Check | Result |
|---|---|
| Isolated Stage C vision/status | 13 passed |
| Isolated Stage B reasoning, including inherited Stage A tests | 17 passed |
| Isolated Phase 0A parity | 91 passed |
| Isolated Phase 0B security | 10 passed |
| Frontend landing static suite | 28/28 assertions passed |
| Frontend dashboard static suite | 22/22 assertions passed |
| Mocked frontend investigation integration | 14/14 passed |
| TypeScript noEmit | Passed |
| Production webpack build and TypeScript/static generation | Passed |
| Python syntax and diff whitespace | Passed |
| Actual local health/configuration/vault GET checks | HTTP 200, Muse/Muse, local mode |
| Fresh browser load | Correct Meta Muse title, both Muse models, configuration-only notice |

Backend tests ran through run_phase0a_checks.py using temporary copies, disabled
dotenv, cleared model/cloud settings, dummy credentials and blocked outbound socket
connections. Only the three explicitly named static/mocked frontend scripts ran.
No wildcard command, prohibited integration script, email-dispatch test, live video
script or test_nubius execution occurred.

The frontend was built in disposable copies under ignored backend/storage, excluding
real environment files and existing .next output, with minimal build environment,
disabled telemetry, and an explicit local public API URL. Existing dependencies were
copied; no package installation occurred. Only the identified localhost frontend
process was replaced to serve the refreshed standalone output.

The browser inspection showed the real returned configuration. Its console/reload
inspection interface reported a browser-session binding error, so console absence
is not claimed; a fresh browser load and direct served-bundle inspection verified
the update instead. The prior full-backend baseline failures were not rerun or
claimed fixed by this focused repair.

## Remaining limits and local URLs

- Local backend: http://127.0.0.1:8000
- Muse page: http://127.0.0.1:3000/dashboard?tab=nemotron
- Current browser session has no incidents; no records were generated to populate it.
- Cloud-only history is unavailable in the preserved local runtime mode.
- Live Muse reasoning/vision access, response quality and latency were not tested
  during this task. No report, draft, incident or email was generated or sent.
- No new authentication, dashboard redesign, provider removal or deployment work.

Both local processes are left running for owner inspection.
