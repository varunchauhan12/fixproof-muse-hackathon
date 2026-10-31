# FixProof — Testing and Validation Report

> **Document version:** 1.0.0  
> **Audit date:** October 29, 2026  
> **Audience:** Hackathon technical judges and QA reviewers  
> **Repository:** [varunchauhan12/FIXPROOF](https://github.com/varunchauhan12/FIXPROOF)

This report records the build checks, test suites, browser inspections, and deployment probes described in the validation notes for FixProof. Results are tied to the commands and timestamps below; they should not be interpreted as proof that every possible workflow has been tested.

> [!IMPORTANT]
> **Verification scope:** The results below reflect the executions recorded in the source report. Re-run time-sensitive checks before submission if the code, configuration, or deployment has changed. Tests with environment prerequisites or known failures are disclosed separately.

## At a glance

| Check | Recorded result | Scope |
|---|---|---|
| Frontend production build | **Passed** | Next.js production build |
| Backend cloud-runtime and vault tests | **25 tests, 1 skipped; no failures/errors** | Selected Python unit tests |
| Frontend integration suites | **163/163 passed** | Six named Node.js test suites |
| Browser typography check | **Passed** | Headless Chrome computed styles |
| Production health probe | **HTTP 200** | `GET /health` |
| Vault status probe | **HTTP 200** | `GET /api/vault/status` |
| Nemotron status probe | **HTTP 200** | `GET /api/nemotron/status` |
| Matcher test suite | **Known failures in an unseeded cloud DB setup** | See [Known Matcher Test Failures](#6-known-matcher-test-failures) |

## 1. Frontend production build

**Command**

```bash
cd frontend && npm run build
```

| Detail | Recorded value |
|---|---|
| Environment | Next.js 16.4.3, React 19.3.0, TypeScript 5.x |
| Execution time | October 29, 2026, 16:38:44 IST |
| Compile time | 744 ms |
| Total run time | 3.8 s |
| Result | **Passed** — 0 errors and 0 warnings reported |

The recorded build output generated these routes:

| Route | Rendering |
|---|---|
| `/` | Static |
| `/_not-found` | Static |
| `/dashboard` | Static |

<details>
<summary>Recorded build output</summary>

```text
> frontend@0.1.0 build
> next build

▲ Next.js 16.4.3 (Turbopack)
- Environments: .env.local
✓ Running next.config.ts took 86ms
- Cache Components enabled
- Partial Prefetching enabled
- Experiments (use with caution):
  ✓ agentFeedback

Creating an optimized production build ...
✓ Compiled successfully in 744ms
Finished TypeScript in 1002ms
Collecting page data using 6 workers in 278ms
✓ Generating static pages using 6 workers (5/5) in 359ms
Finalizing page optimization in 207ms

Route (app)
○ /
├ ○ /_not-found
└ ○ /dashboard

○ (Static) prerendered as static content
```

</details>

## 2. Backend cloud-runtime and vault unit tests

**Command**

```bash
cd backend && .venv/bin/python -m unittest tests.test_cloud_runtime tests.test_vault
```

| Detail | Recorded value |
|---|---|
| Environment | Python 3.14.0, arm64 Darwin; PyTorch 2.4; FAISS-CPU 1.8.0 |
| Execution time | October 29, 2026, 16:39:40 IST |
| Duration | 37.803 s |
| Result | **Passed** — 25 tests ran, 1 skipped, 0 failures, 0 errors |

### Scope covered

- FAISS `IndexFlatL2` vector-vault initialization, L2-distance queries, and vector normalization.
- Recovery from corrupt snapshots and fallback to clean index initialization.
- Snapshot hydration from Supabase Object Storage cache.
- Asset removal and deterministic index compaction ordered by `(asset_id, frame_id)`.

The test output included expected error-path logging for invalid video/image fixtures and a corrupt FAISS snapshot. The test runner completed with `OK (skipped=1)`.

<details>
<summary>Recorded test summary</summary>

```text
Ran 25 tests in 37.803s

OK (skipped=1)
```

</details>

## 3. Frontend integration and workflow test suites

The source report records the following suites as executed against the running backend at `http://127.0.0.1:8000` and the client components.

| Test suite | Command | Coverage described in the report | Result |
|---|---|---|---:|
| Landing Page V2 | `node frontend/tests/test_landing_v2.mjs` | Landing-page UI, WebGL integration, technical metrics, scroll-story assertions, and prohibited-claim checks | **28/28 passed** |
| Dashboard Refinement | `node frontend/tests/test_dashboard_refinement.mjs` | Design tokens, collapsible sidebar, tooltips, mobile navigation, and route preservation | **22/22 passed** |
| Investigation Integration | `node frontend/tests/test_investigation_integration.mjs` | Saved-report browsing, clipboard error handling, incident switching, and evidence ZIP parsing | **14/14 passed** |
| Addendum Workflow | `node frontend/tests/test_addendum_workflow.mjs` | Status checks, multi-file constraints, batch-error isolation, and download headers | **20/20 passed** |
| Detailed Report Integration | `node frontend/tests/test_detailed_report_integration.mjs` | Detailed-report workflow, PDF response validation, and email integration behavior | **37/37 passed** |
| Nemotron Action Center | `node frontend/tests/test_nemotron_action_integration.mjs` | Notice drafting, revenue-share calculations, human-confirmation barrier, and email audit logging | **42/42 passed** |
| **Total** | — | Six named suites | **163/163 passed** |

> **Interpretation:** These are the totals recorded for the named suites. They do not establish that every deployment environment, external provider, or real-world investigation scenario has been tested.

## 4. Browser typography verification

A headless Google Chrome check was recorded for the frontend at `http://localhost:3000`.

| Detail | Recorded value |
|---|---|
| Browser | Google Chrome 155.0.8059.85, headless |
| Inspection date | October 29, 2026 (per audit report) |
| Result | **Passed** |

The computed font family for `body`, `h1`, and `button` was recorded as:

```text
"Bricolage Grotesque", "Bricolage Grotesque Fallback"
```

The report states that Bricolage Grotesque font faces at weights 400, 600, and 700 were loaded in `document.fonts`.

## 5. Production deployment verification

**Service:** [FixProof backend on Google Cloud Run](https://fixproof-git-214713402646.europe-west1.run.app)  
**Recorded probe time:** October 29, 2026, 14:09:43 IST

### 5.1 Health probe

**Request**

```bash
curl -s -w "\nHTTP_STATUS: %{http_code}\nTIME_TOTAL: %{time_total}s\n" \
  https://fixproof-git-214713402646.europe-west1.run.app/health
```

| Field | Recorded result |
|---|---|
| HTTP status | `200 OK` |
| Latency | `0.722 s` |
| Response | `{"status":"ok","service":"FixProof API"}` |

### 5.2 Vault status probe

**Request**

```bash
curl -s https://fixproof-git-214713402646.europe-west1.run.app/api/vault/status
```

The recorded response reported:

| Field | Recorded value |
|---|---|
| `status` | `ready` |
| `vault_size` | `5` |
| `embedding_dim` | `576` |
| `total_indexed_assets` | `1` |
| `snapshot_version` | `12` |
| `mode` / `db_mode` | `supabase` |
| `is_cloud` | `true` |

The original response also included asset identifiers and internal storage paths. Those details are omitted here because they are not needed to establish that the status endpoint responded.

### 5.3 Nemotron status probe

**Request**

```bash
curl -s https://fixproof-git-214713402646.europe-west1.run.app/api/nemotron/status
```

The recorded response reported `status: ready` and these configured models:

- `nvidia/Nemotron-3_5-Lightning`
- `nvidia/Nemotron-3.5-Super-VL`
- `nvidia/nemotron-3-super-120b-a12b`

It also reported text reasoning, vision verification, and email delivery as available. A status response confirms reported configuration/availability; by itself, it is not proof that every model or email workflow has just completed a successful end-to-end transaction.

## 6. Known matcher test failures

The source report records failures when running the matcher test suite against a cloud database configuration without seeded reference assets.

**Command**

```bash
cd backend && .venv/bin/python -m unittest tests.test_matcher
```

**Recorded result:** `FAILED (failures=2, errors=1)`

Reported assertion mismatches included:

```text
AssertionError: 'NO_REFERENCE_DATA' != 'CLEAN'
AssertionError: 'NO_REFERENCE_DATA' != 'CANDIDATE_MATCH'
```

### Diagnosis recorded in the source report

1. In cloud mode, `get_valid_asset_ids()` in `backend/app/matcher.py` queries PostgreSQL for registered reference assets.
2. When the target database has no registered reference assets, the matcher returns `NO_REFERENCE_DATA` rather than evaluating candidates against an empty vault.
3. The tests were described as having originally assumed local JSON/filesystem fixtures, so the unseeded cloud configuration does not meet their expected setup.

### Suggested remediation

- Mock `get_valid_asset_ids()` when testing vector/matcher logic in isolation; or
- Run the relevant tests in local mode with the expected sample assets loaded.

Do not describe the full backend test suite as passing until these matcher test prerequisites or failures are resolved and the relevant suite is rerun.

## 7. Test categories and boundaries

| Category | Examples | What it demonstrates |
|---|---|---|
| Unit tests | `tests.test_cloud_runtime`, `tests.test_vault` | Selected in-process behavior for vault/index operations and runtime handling |
| Integration/workflow tests | Six named `frontend/tests/*.mjs` suites | The behavior asserted by those test scripts across UI and workflow paths |
| Deployment probes | `/health`, `/api/vault/status`, `/api/nemotron/status` | The deployed service responded to those requests at the recorded time |
| Browser inspection | Headless Chrome computed-style check | The tested page reported the expected computed font styles |

No single category proves the entire product is free of defects. Live external-service behavior can change with credentials, provider availability, database contents, deployment revisions, and configuration.

## 8. Security and reliability checks to reconfirm

The source checklist reports checks for the following areas. Confirm these against the current repository and deployment before treating them as current security guarantees.

- Secret files and credentials are not committed to Git.
- Cloud database failures do not silently divert persistence to local files.
- Evidence-package verification checks signatures and payload digests and applies archive path/size safeguards.
- Notice and proposal dispatch requires explicit human confirmation and a rights declaration.
- Database Row Level Security policies enforce the intended access model.

> **Security note:** Never add API keys, service-role keys, signing-key material, authorization headers, private asset identifiers, or sensitive production responses to public documentation.

## 9. Reproducibility notes

- The commands and timestamps in this document reflect the recorded audit dated October 29, 2026.
- Re-run relevant checks after code changes or a new deployment.
- Record the commit SHA, environment, command, exit code, and test summary when updating this report.
- Keep local credentials in untracked environment files; do not commit `.env` or `.env.local`.
- Report skipped tests and known environment prerequisites rather than silently excluding them.

## 10. Final status

The recorded checks provide evidence for a successful frontend production build, selected backend unit tests, six frontend workflow suites, a browser typography check, and three production status probes. The matcher suite has a documented environment/fixture issue and should not be represented as passing in that configuration.

**FixProof's matching scores are heuristic candidate signals, not calibrated probabilities of infringement. AI-generated findings assist investigation and require human review; they do not independently establish copyright infringement or legal admissibility.**
