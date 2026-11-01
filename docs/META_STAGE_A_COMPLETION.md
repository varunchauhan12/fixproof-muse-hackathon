# Meta Stage A — provider foundation

Scope: foundation only. Nemotron remains the factory default. No production
callsite, active environment setting, deployment, database, CV or frontend changed.
Phase 0A/0B changes are preserved. No live model requests were made, no credits
consumed, and the real .env/credentials were not read, printed, copied or edited.
All test credentials are dummy strings and HTTP responses are in-memory mocks.

## Architecture and changed files

- New `backend/app/providers/meta_client.py`: shared, lazy OpenAI-compatible client
  explicitly receives MODEL_API_KEY and MUSE_BASE_URL. One cached SDK transport per
  process; no dotenv loading or implicit OpenAI credentials. Retries are disabled
  explicitly (including SDK defaults). Vision/reasoning default timeouts are 15/90s.
  Missing keys, client initialization, timeout, connection, rate-limit and provider
  errors map to fixed safe MetaAPIError messages without raw upstream exceptions.
  Truncation, absent choices and incomplete content are not successful completions.
- New `backend/app/providers/meta.py`: MetaVisionProvider and MetaReasoningProvider
  implement all existing interface signatures without changing base.py. Vision
  prepares suspect-then-reference bounded JPEGs and requests structured output.
  Cache keys include the configured model and a separate Meta prompt version;
  Nemotron results cannot satisfy these requests. Uses existing cache utilities
  without changing their storage format. Failure results remain UNVERIFIED and
  VERIFICATION_UNAVAILABLE, not successful matches.
- Reasoning adapter builds existing evidence-grounded prompts, validates the
  InvestigationReport schema and evidence citations, replaces model-supplied IDs,
  timestamps/timeline and provenance with application-controlled values, and keeps
  human review mandatory. URL-only reports retain the full-video-review action and
  caveat. Failed calls return FAILED_VALIDATION reports with safe error categories.
  Ordinary text completions return the existing SDK choices/message response shape.
- `backend/app/providers/factory.py`: existing muse selection now points to the Meta
  adapters. Existing nemotron selection/default and provider interfaces unchanged.
- `backend/.env.example`: corrected safe placeholders; MODEL_API_KEY is the single
  Meta credential name. Removed obsolete MUSE_API_KEY/MUSE_MODEL placeholders.
- New `backend/tests/test_meta_provider.py`: 13 mocked HTTP/contract tests.
- `backend/tests/run_phase0a_checks.py`: --meta selection and removal of inherited
  MODEL_API_KEY/MUSE variables in the isolated test process.
- `backend/tests/test_phase_3_1.py`: legacy scaffold test explicitly instantiates
  legacy scaffold classes. Its NotImplementedError assertions are retained. New
  tests cover factory selection of actual Meta adapters. The old scaffold file
  remains import-compatible but is not selected by the factory anymore.
- This report: `docs/META_STAGE_A_COMPLETION.md`.

The two migration-investigation documents pre-existed this stage and were not edited.
Existing Phase 0A/0B pending files were neither reverted nor overwritten.

## Configuration (real environment unchanged)

| Variable | Meaning/default |
|---|---|
| FIXPROOF_AI_PROVIDER | nemotron remains default; muse explicitly opts in |
| MODEL_API_KEY | Explicit backend-only Meta credential; no other credential alias |
| MUSE_BASE_URL | https://api.meta.ai/v1 |
| MUSE_VISION_MODEL | muse-spark-1.3 |
| MUSE_REASONING_MODEL | muse-spark-1.3 |
| MUSE_TIMEOUT_SEC | Optional positive timeout override; otherwise 15s vision / 90s reasoning |
| MUSE_MAX_TOKENS | Optional investigation output budget; defaults to 16384 |

Client initialization is lazy: default Nemotron startup never requires a Meta key.
SDK client configuration is cached for the process; restart after credential or
base-URL changes. Model IDs are configurable but account entitlements are untested.
No key was duplicated in example configuration, frontend, logs or tests.

Official references verified through public documentation (no inference requests):

- https://dev.meta.ai/docs/overview — base URL, model IDs and Bearer MODEL_API_KEY.
- https://dev.meta.ai/docs/cookbook/quickstart-chat-completions — explicit API key
  configuration, request/response shape.
- https://dev.meta.ai/docs/structured-output — json_schema response format.
- https://dev.meta.ai/docs/image-understanding — image_url inputs and data URLs.

The adapters request JSON Schema with strict=false and always validate locally.
No guarantee of model quality or account-specific supported limits is inferred.

## Tests

Run from repository root using the unchanged existing virtualenv:

```sh
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --meta
backend/.venv/bin/python backend/tests/run_phase0a_checks.py
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --security
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --full
```

| Run | Result |
|---|---|
| Stage A | 13 passed, zero failures/errors/skips |
| Phase 0A | 91 passed, zero failures/errors/skips |
| Phase 0B | 10 passed, zero failures/errors/skips |
| Full isolated suite | 250 run: 230 passed, 8 failures, 5 errors, 7 skips |
| Syntax/import and git diff --check | Passed |

Full-suite failures match the documented 0B baseline exactly (8 failures/5 errors,
7 skips). They concern matcher/forensic reference-registration fixtures,
session-persistence fixture behavior, and an offline mocked storage test requiring
configuration. No failing test assertion was deleted, weakened or skipped.
Tests cover actual SDK request serialization and Bearer headers through MockTransport,
model configuration, image requests, schemas, normalization, missing credentials,
timeouts/connection/API errors, no retries, safe errors, factory selection, rollback,
signature parity, cache isolation, URL caveats and invented-evidence rejection.

## Unsupported paths and unresolved issues

Stage B/C production migration is NOT complete. Existing routes still use Nebius
credential gates, model allowlists, explicit diagnostic client options, status labels
and detailed-report fallback model IDs. These were intentionally not changed.
Meta text completion rejects explicit legacy client_options and model IDs different
from MUSE_REASONING_MODEL rather than forwarding a Nebius key/URL or silently
substituting models. Therefore setting muse alone is not a promise that all existing
endpoints are migration-ready; keep the active provider on Nemotron for now.

Streaming and request extra_headers/extra_body are explicitly unsupported by this
foundation's normalized completion path. SAM, native video, voice, tool orchestration,
retry/backoff and new agents are not implemented. Live access, model entitlement,
quality/parity, costs and per-account limits remain unverified. Phase 0B authorization
and distributed resource-control limitations remain unchanged.

## Rollback preserving Phase 0A and Phase 0B

Keep FIXPROOF_AI_PROVIDER=nemotron (no real configuration was changed here). Restore
only factory.py's muse mappings/import to the old providers/muse.py classes, and
restore the previous example placeholders if desired. Remove meta.py, meta_client.py,
test_meta_provider.py and this report; undo only the --meta/MUSE environment-isolation
additions in the offline runner and the two scaffold-instantiation lines in
test_phase_3_1.py. Do not reset main.py, base.py, nemotron.py or the whole worktree:
those contain intentional Phase 0A/0B work. No data/dependency/cloud rollback is needed.

Stage A foundation is complete under mocked tests; production migration and live
API validation are not claimed. Stop here for owner approval before Stage B/C.
