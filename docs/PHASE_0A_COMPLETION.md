# Phase 0A implementation and validation

Changes are local and uncommitted. No deployment, database access/migration, .env
editing, dependency changes, or changes to the two reference repositories occurred.
The existing running backend was not restarted with this code.

## Bugs and wiring

NemotronVisionProvider previously forwarded suspect_image_bytes,
reference_image_bytes, suspect_metadata and reference_metadata to a function
which accepts PIL images plus timestamp/asset/index fields. It raised TypeError.
The wrapper now decodes bytes and maps metadata into the original verifier.
Production CV callers serialize PIL images as lossless PNG so the verifier's JPEG
preprocessing, model/prompt/image hash cache, 15-second timeout and output remain
unchanged. Decode/SDK construction failures return explicit UNVERIFIED results.
NemotronReasoningProvider also forwarded an invalid investigation_input keyword;
the engine actually accepts input_data. This wrapper is now corrected.

Production dispatch boundaries:

- matcher.py and url_screener.py resolve one vision provider per verification batch.
- main.py resolves a reasoning provider for investigation reports and /diagnose.
- nemotron_action.py resolves reasoning for copyright/revenue-share draft polishing.
- detailed_report.py resolves reasoning for detailed report synthesis.

The existing BaseReasoningProvider gains create_text_completion(request,
client_options=None), a non-abstract extension for existing draft/diagnostic request
formats. Its default raises NotImplementedError; Muse remains unimplemented.
Nemotron delegates pooled requests to the original engine client and preserves
/diagnose's explicitly configured client settings. The factory itself is unchanged,
honors FIXPROOF_AI_PROVIDER, and defaults to Nemotron. No new abstraction was added.
The wrappers are stateless; engine clients and verifier caches remain shared.

Model IDs, endpoints, prompt bodies, response parsing, deterministic fallbacks,
report persistence, session checks, SSRF validation and frontend contracts remain.
OpenCV, MobileNet, FAISS, pHash, entropy, timeline clustering, signing and hashing
remain outside AI providers. cloud_ingest.py, its rollback, vision_verifier.py,
nemotron_engine.py, Muse implementation, frontend and configuration are unchanged.

SDK calls remain inside providers/nemotron.py, vision_verifier.py and
nemotron_engine.py as the retained Nemotron implementation. Model allowlists,
normalization and status reporting still depend on Nemotron configuration to retain
existing public API behavior. app/test_nubius.py is an unchanged standalone manual
probe and is not a production route. No Muse API requests were added.

## Files

Production files modified: backend/app/providers/base.py,
backend/app/providers/nemotron.py, backend/app/matcher.py,
backend/app/url_screener.py, backend/app/main.py,
backend/app/nemotron_action.py, backend/app/detailed_report.py.

New tests: backend/tests/test_provider_parity.py and test_factory_wiring.py.
New offline runner: backend/tests/run_phase0a_checks.py.
Existing test mock boundaries updated (assertions retained):
backend/tests/test_nemotron_engine.py (/diagnose client moved behind provider),
backend/tests/test_evidence_package.py (assert no reasoning provider is invoked
during export/verification). This document is the final added file.

## Validation

Run from repository root:

```sh
backend/.venv/bin/python backend/tests/run_phase0a_checks.py
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --full
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --full --baseline
```

Runner copies code/tests/migrations/demo videos to a disposable directory, disables
.env loading, clears cloud/model configuration and blocks outbound socket connects.
Persistent test writes are confined to the temporary copy. Models are mocked.

Focused suite: 91 passed, zero failures/errors/skips. Covers the added contract,
factory dispatch, cache equivalence, failure/timeout, successful vision, reasoning,
diagnostic/API, evidence export, detailed report and action/URL screening tests.

Full suite at the broad validation point: 226 run, 206 passed, eight failures,
five errors, seven skips. Subsequently added one URL factory-dispatch regression
also passes in the final focused suite. Baseline HEAD: 215 run, 195 passed, same
eight failures, five errors and seven skips. No new failures in that comparison.
Matcher and forensic-quality fixture failures stem from unregistered reference
assets being filtered, yielding NO_REFERENCE_DATA or empty match arrays; the
session-isolation fixture also fails. A mocked storage-delete test still demands
configured storage credentials even offline. Seven live-cloud tests skip.
No existing failing assertion was removed, weakened, or skipped to obtain a pass.

Changed Python modules passed py_compile, and imports/routes were exercised by
the isolated tests. git diff --check passed. No real model/API, cloud database,
deployed runtime, frontend browser flow, or production load testing was performed.

## Rollback and acceptance

Revert the seven production files listed above together to their pre-Phase-0A
versions. Revert the two adjusted test files and remove the three new test/runner
files and this report if rolling back the complete patch. No environment,
database, dependency or deployment rollback is needed because none was changed.

Phase 0A wiring and focused parity checks pass. The requirement for a fully green
existing matcher/backend suite is NOT satisfied: baseline failures remain.
This is not a claim of full production validation or approval to deploy.
Await owner review; do not proceed to Phase 0B or Muse implementation.
