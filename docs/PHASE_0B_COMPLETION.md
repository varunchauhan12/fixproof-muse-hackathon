# Phase 0B — security foundations and feature readiness

Scope: local changes only, layered on the uncommitted Phase 0A patch. No deployment,
cloud/database operations, migrations, .env edits, dependency changes, commits or
pushes. Running development servers were not restarted with these changes.

## Findings (verified from source)

| Severity | Finding | Disposition |
|---|---|---|
| Critical | No authenticated identity or consistent case/tenant authorization | Requires a separate narrowly scoped authorization phase; not claimed fixed |
| High | Existing session guards allow omitted headers | Fixed in all 12 existing guards; session spoofing is still possible |
| High | Unauthenticated upload/scan/index/sync/delete/model/email routes permit resource use and mutations | Basic rate/body limits added; authenticated authorization remains required |
| High | Multipart parsing happens before video endpoint size checks; ZIP endpoint reads entire upload before checking | Bounded pre-parser request spooling and bounded ZIP read added |
| High | Exception interpolation can disclose internal details in 5xx client responses; DB connection exceptions can log passwords | Safe 5xx responses and DB diagnostic masking added |
| Medium | All origins allowed by CORS, credentials disabled | Exact configurable allowlist added, credentials remain disabled |
| Medium | No distributed quota, hard processing deadline, or worker isolation for CV | Basic per-worker request quota added; remaining limits documented |
| Medium | Detailed PDFs/email audit and other outputs use ephemeral local storage | Persistence phase remains needed |

Case authorization is NOT genuinely enforced. Current browser sessions are random
localStorage identifiers passed in X-Client-Session-Id, not authenticated users.
Comparing a supplied value does not establish ownership. Null-session/demo-showcase
records retain legacy access. This phase only closes the missing-header bypass.

Examples of remaining exposure: global reference asset listing/detail, asset
delete/index/sync/matches/ingest, direct report lookup
`GET /api/threats/reports/{report_id}`, package listing
`GET /api/threats/{incident_id}/packages`, media/frame routes and suspect-thumbnail
routes do not consistently require an owner. Media requests can resolve incident or
submitted-asset IDs. Detailed-PDF checks are conditional on resolving the incident;
the email audit endpoint allows broad access without a session. Private buckets
protect direct storage access, but the privileged backend can still serve data or
issue signed URLs to unauthenticated callers. CORS does not protect against CLI or
server-to-server clients. Neither obscure UUIDs nor matching headers are authentication.

Smallest next security implementation: select an identity mechanism explicitly,
verify its credentials in one FastAPI dependency, resolve incident/report/media
ownership server-side for every read/write, authorize reference-vault mutations,
and explicitly gate demo/admin access. HTML video/image downloads need authorized
media delivery (e.g. owner-checked short-lived URLs), not an assumed custom header.
Require one deny-by-default endpoint inventory/test matrix before public multi-user use.
No identity provider, new database table, or rushed replacement auth system was added.

## Existing protections retained

- Parameterized database queries, explicit DB mode and private Storage access.
- Video extension allowlist including MOV; generated UUID storage filenames;
  50 MiB endpoint limit, empty-file rejection and failed-upload cleanup.
- OpenCV preflight checks actual decodability and nonzero dimensions/frames;
  advertised MIME is not trusted as proof of content. Client octet-stream and
  mismatched MIME remain compatible if the underlying supported video decodes.
- Frame/media identifier regexes and local path-containment checks.
- URL SSRF validation, private/link-local address blocking, guarded thumbnail
  redirects, 10 MiB thumbnail limit and bounded network timeouts.
- Evidence ZIP path and expanded-size safeguards (100 MiB expanded cap), hash
  checks and Ed25519 signatures; human email-confirmation boundaries.
- Bounded vision candidates, original model timeouts/cache, explicit UNVERIFIED
  provider failures, and deterministic CV/timeline computations.

There is no CLIP implementation in this repository. MobileNetV3, FAISS, pHash,
entropy, OpenCV and forensic signing remain unchanged. No model swap occurred.

## Implemented changes and files

- `backend/app/security.py` (new): origin parsing; request-body buffering into a
  spooled temporary file with a 51 MiB total cap and 1 MiB memory threshold;
  a bounded per-peer sliding-window quota; diagnostic credential/URI masking.
  The 51 MiB cap allows multipart overhead around existing 50 MiB file limits.
  Both declared-length and undeclared/chunked bodies are bounded before parsing.
- `backend/app/main.py`: registers protections/CORS; all 12 existing session
  guards now reject missing or different headers for session-owned records;
  raw session values removed from denial logs; safe 5xx/unhandled error responses;
  ZIP reads stop at the 50 MiB cap plus one byte and uploads close afterward.
- `backend/app/db.py`: masks connection exceptions before logging/rethrowing.
- `backend/tests/test_security_foundations.py` (new): ten focused security tests.
- `backend/tests/run_phase0a_checks.py`: adds --security and raises quotas for
  ordinary test isolation. Dedicated tests verify low quotas directly.
- `docs/PHASE_0B_COMPLETION.md` (this report).

Phase 0A production changes in other files remain intact. No changes to
cloud_ingest.py, its rollback, provider selection, frontend, .env or deployment files.

## Configuration behavior (not applied to any cloud service)

`FIXPROOF_CORS_ORIGINS` accepts comma-separated exact origins, for example
`https://YOUR_ACTUAL_V2_FRONTEND_HOST,http://localhost:3000,http://127.0.0.1:3000`.
No paths, trailing slashes, credentials or wildcard. Missing configuration defaults
to the two local origins. A separate hosted frontend MUST be explicitly included
before this patch is deployed; the actual v2 frontend origin was not available in
the inspected app configuration, so no hostname was guessed. Public API access
remains subject to the separate authentication limitation above.

`FIXPROOF_RATE_LIMIT_PER_MINUTE` defaults to 30 expensive requests per peer per
worker over a sliding minute. Applies to API POST/DELETE, /diagnose and evidence
report export GET. Exceeding returns 429 with Retry-After. OPTIONS and regular
reads are unaffected. Windows have a 4096-peer memory bound. Middleware uses the
ASGI peer, not arbitrary forwarding headers; correctly trusted proxy configuration
is still needed at deployment. Shared NAT users can share a quota. Quotas reset on
restart and are not coordinated across workers/instances; they are not account quotas.

## Tests and exact results

All commands below run from the repository root using the existing virtualenv:

```sh
backend/.venv/bin/python backend/tests/run_phase0a_checks.py
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --security
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --full
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --full --baseline
git diff --check
```

| Check | Result |
|---|---|
| Phase 0A focused suite | 91 passed, zero failures/errors/skips |
| New security suite | 10 passed, zero failures/errors/skips |
| Full working-tree suite | 237 run: 217 passed, 8 failures, 5 errors, 7 skipped |
| Unchanged committed baseline | 215 run: 195 passed, same 8 failures, 5 errors, 7 skipped |
| Changed Python syntax/imports and diff whitespace | Passed |

Full-suite failing IDs match baseline: matcher/forensic fixtures use reference
assets absent from the active registry, producing NO_REFERENCE_DATA, empty arrays
or null scores; a session-persistence fixture fails; the mocked batch-storage-delete
test requires configured credentials. Seven live-cloud tests skip. No existing
assertion was removed or weakened. During implementation two diagnostic-format
regressions were identified and corrected; only baseline failures remain.

Tests verify missing/cross-session denial, valid owner-header behavior, supported
origins and denied origins, wildcard rejection, invalid/malformed/oversized videos,
bounded ZIP reads, chunked request limits, 429 behavior and forwarding spoof
resistance, masked diagnostics and safe client errors. Existing Phase 0A tests cover
missing model keys, failed API calls, timeouts and retained UNVERIFIED semantics.

The runner uses a disposable copy, disables .env loading, strips cloud/provider
configuration and blocks outbound socket connections. Model calls are mocked.
No real email, model, Supabase or deployed-runtime calls were made.

## Remaining limits and readiness

- No authentication, reliable tenant isolation, vault-admin privileges or durable
  authenticated audit trail. Do not expose private multi-user data on this basis.
- Per-process limits do not provide global concurrency or spending protection.
  CV is synchronous; there is no hard decode deadline or process memory sandbox.
  Many concurrent slow uploads can still occupy connections and temporary disk.
- Successful structured AI responses may include upstream error diagnostics; this
  phase does not claim comprehensive redaction of every provider message, stored
  report, email audit entry or third-party log. Safe client 5xx handling and DB
  connection masking were verified; broader logging/redaction remains a follow-up.
- UI advertises 500 MiB while backend enforces 50 MiB; UI behavior was not changed.
- Ephemeral PDF/email audit storage and baseline fixture failures remain.

Ready for additive Supabase persistence design and offline implementation: YES,
provided ownership/access requirements are designed alongside the data model.
Live migrations are not authorized by this phase. Ready for a public multi-user
release, Muse cutover or agent rollout: NO. Local agent/Muse planning can follow
owner approval, but their implementation should not outrun authorization,
persistence and resource-budget decisions. Phase 0B is not production readiness.

## Rollback preserving Phase 0A

Remove security middleware/imports, exception handlers, ZIP bounded-read changes,
and the 12 missing-header guard changes from main.py; restore prior session-log
text only if explicitly desired. Restore db.py's pre-0B connection diagnostics.
Remove security.py and test_security_foundations.py, and revert only the --security
and quota additions in run_phase0a_checks.py. Remove this report if desired.
Do NOT restore all of main.py from HEAD: that would discard Phase 0A provider wiring.
No .env, database, frontend, dependency or cloud rollback is needed.

Stop here for owner review; Phase 1, schema changes, agents and Muse were not started.
