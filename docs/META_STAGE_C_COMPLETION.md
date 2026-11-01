# Stage C — selected-provider vision migration

## Contract recorded before implementation

The two production inference callers are `matcher.analyze_asset_matches` and
`url_screener.screen_video_url`. Both currently explicitly select Nemotron through
the factory. The underlying `vision_verifier` remains the Nemotron rollback engine.

The provider interface accepts suspect image bytes first, reference image bytes
second, plus optional timestamp/pair-index/asset-ID metadata. Callers send lossless
PNG; the adapter reuses the existing deterministic RGB JPEG preparation: longest
edge at most 512 pixels, aspect ratio preserved, quality 85, optimize enabled.
Callers rank existing candidates and verify at most three; token limit is 2048,
timeout 15 seconds. No extraction, CV, ranking or threshold changes are needed.

The output is a dictionary with visual_correspondence (HIGH_CORRESPONDENCE,
POSSIBLE_REUSE, UNRELATED_SCENE, UNVERIFIED), confidence_assessment (HIGH, MODERATE,
LOW, INCONCLUSIVE), matching_features[], contradictions[], reasoning,
uncertainty_factors[], validation_status, model_id, verified_at, pair index,
suspect/reference timestamps and source asset ID. Successful validated responses
also contain cached and latency_ms. VERIFIED means schema validated, not a
successful match. Invalid JSON/preparation uses FAILED, invalid schema uses
SCHEMA_VIOLATION, unavailable inference uses VERIFICATION_UNAVAILABLE; each error
returns UNVERIFIED/INCONCLUSIVE. Model output cannot control provenance/status.

Caching hashes the prepared suspect/reference bytes, model ID and prompt version;
only validated results are stored. Cache hits update caller context but retain
the original verification timestamp. Existing memory/local/cloud cache storage
is reused without schema changes. No live cache/database operations are needed
for this implementation.

The Stage A Meta adapter already constructs the two-image Chat Completions request.
Meta's official image-understanding documentation confirms multiple image inputs,
base64 URLs and Chat Completions image_url objects:
https://dev.meta.ai/docs/image-understanding . This supports transport semantics;
it does not establish sports-footage accuracy.

## Implementation

With `FIXPROOF_AI_PROVIDER=muse`, both production callers now resolve
`MetaVisionProvider`; neither pins Nemotron. Model selection remains
`MUSE_VISION_MODEL=muse-spark-1.3` by default. The factory default remains Nemotron
when no selection is configured. No real environment setting was changed.

The Meta request is one user message containing the unchanged forensic prompt,
suspect JPEG then reference JPEG, JSON Schema response format (`strict=false`
with strict local validation), temperature 0.1, and 2048 output tokens. It uses
the Stage A client at `https://api.meta.ai/v1/chat/completions`, authenticated only
with backend `MODEL_API_KEY`. No Nebius key/options/model fallback is forwarded.
The optional general timeout setting can lower vision's timeout, but cannot
increase its existing 15-second cap; reasoning's timeout behavior is unchanged.
SDK retries remain disabled. No new image preparation/pipeline was introduced.

Malformed JSON is FAILED, missing/invalid fields, enums, list elements or blank
reasoning are SCHEMA_VIOLATION, and missing credentials/API/connection/timeout or
truncation errors are VERIFICATION_UNAVAILABLE. All errors retain
UNVERIFIED/INCONCLUSIVE with safe category strings; failures are not cached.
Model-supplied provenance/status fields are rejected. Valid negative/inconclusive
responses remain negative/inconclusive even though their schema status is VERIFIED.
Caller-level missing-frame fallbacks retain their structure and selected model ID.
Existing CV candidate status is not rewritten by model failure or success.

Cache keys retain prepared bytes, model and Meta prompt version `meta-vision-v1`;
the Nemotron engine retains its distinct model/prompt namespace. Cache hits retain
the original verified_at while updating pair/timestamp/asset context. Existing
cache storage code and schemas are untouched.

The existing status route reports the selected vision model and credential-presence
boolean. This is configuration status, not proof of live availability. Detailed
reports/PDFs now use recorded vision model IDs instead of inventing Nemotron
provenance. Historical Nemotron IDs remain historical; missing IDs are
`not-recorded`, and mixed evidence lists the distinct recorded IDs. Deterministic
report wording no longer claims visual correspondence without recorded verification.
UI changes only remove hardcoded vision labels/fallback provenance; existing status
and report fields still supply actual model IDs. No new UI feature or API field.

Intentionally unchanged: `vision_verifier.py`, `providers/nemotron.py`, provider
interfaces/factory/default, Stage B reasoning dispatch/model sequence, deterministic
CV, extraction, entropy, pHash, MobileNetV3, FAISS, ranking, thresholds, clustering,
uploads, SSRF/URL fetch rules, evidence hashing/signatures and database schema.
The standalone manual Nebius probe remains outside production dispatch.

## Every Stage C source/document file changed

| File | Stage C change |
|---|---|
| backend/app/matcher.py | Selected vision provider; missing-frame model provenance; comments |
| backend/app/url_screener.py | Same for actual URL-screening inference; fetch/safety logic untouched |
| backend/app/providers/meta.py | Failure status normalization, timestamp preservation, telemetry, shared limits |
| backend/app/providers/meta_client.py | Optional per-call timeout ceiling used only by vision |
| backend/app/main.py | Selected vision configuration status, same response keys |
| backend/app/detailed_report.py | Recorded model provenance and provider-neutral vision wording |
| backend/tests/test_meta_vision_migration.py | New 13-test Stage C suite with subcase matrices |
| backend/tests/test_factory_wiring.py | Require configuration-based vision selection, retain dispatch assertions |
| backend/tests/test_meta_reasoning_migration.py | Expect selected vision status and no invented provenance for empty evidence |
| backend/tests/test_detailed_report.py | Explicit historical model IDs in existing vision fixtures; assertions retained |
| backend/tests/run_phase0a_checks.py | Add --vision; existing isolation mechanisms retained |
| frontend/components/dashboard/Overview.tsx | Neutral selected-provider vision label |
| frontend/components/dashboard/NemotronCenter.tsx | Status/provenance fallbacks no longer invent Nemotron |
| frontend/tests/test_dashboard_refinement.mjs | Assert selected-provider label; retain reasoning/subsystem checks |
| docs/META_STAGE_C_COMPLETION.md | Contract, changes, results, incident and rollback |

Other pending files listed by git predate Stage C and were preserved. No dependency
or real environment files were edited. No branch switch, commit, push or deployment.

## Automated validation

Backend commands run from repository root with the existing virtual environment:

```sh
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --vision
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --reasoning
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --meta
backend/.venv/bin/python backend/tests/run_phase0a_checks.py
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --security
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --full
backend/.venv/bin/python backend/tests/run_phase0a_checks.py --full --baseline
```

These backend runs copy code to disposable directories, disable dotenv, strip model
and cloud environment settings, and block outbound socket connects. Meta responses
use the actual SDK with an in-memory HTTP transport and dummy keys. Temporary
CV/reference data is isolated from the real vault. No live inference is used by
these backend tests.

| Check | Final result |
|---|---|
| Stage C vision | 13 passed, zero failures/errors/skips |
| Stage B reasoning (includes inherited Stage A checks) | 17 passed |
| Stage A standalone | 13 passed |
| Phase 0A parity | 91 passed |
| Phase 0B security | 10 passed |
| Full backend | 280 run: 260 passed, 8 failures, 5 errors, 7 skips |
| Fresh committed HEAD baseline | 215 run: 195 passed, same 8 failures, 5 errors, 7 skips |
| Frontend static/mocked checks | Landing 28/28; dashboard 22/22; mocked investigation 14/14 |
| TypeScript noEmit | Passed |
| Production webpack build | Passed, including TypeScript/static generation/standalone tracing, in an environment-file-free disposable copy |
| Python syntax and git diff --check | Passed |

Vision tests cover distinct-image ordering, exact bounded JPEG byte preparation,
request schema/token/timeout limits, success and negative enums, metadata,
malformed JSON, every missing required field, wrong enums/types, attempted provenance
injection, invalid images, missing Meta key despite available dummy Nebius key,
timeouts, connections, 401/429/500 errors, truncation, no retries, no successful
verification on failure, cache model/prompt/order isolation, timestamp retention,
explicit Nemotron delegation, and selected status. Guards assert no Nebius client
initializes in Muse tests. Real matcher execution verifies at most three of six
eligible frames, success/failure attachment and unchanged deterministic frame
results; matcher and URL missing-frame fallbacks are covered. URL screening executes
the actual selected adapter for both success and provider failure with URL/media
fetches mocked. Recorded historical/new/missing report model IDs are checked.

Frontend safe command:

```sh
node --test frontend/tests/test_landing_v2.mjs frontend/tests/test_dashboard_refinement.mjs frontend/tests/test_investigation_integration.mjs
```

The original broad frontend wildcard command was unsafe; see the incident below.
Do not run live-server integration scripts without reviewing their side effects.
The production build uses a disposable frontend copy excluding `.env*` and `.next`,
an explicit local public API URL, and a minimal environment without model/cloud keys.
The existing running frontend's build is not replaced. No package installation.

Full-suite failure IDs match the fresh baseline: seven matcher/forensic status
fixtures with unregistered references plus session-isolation fixture (8 failures);
four matcher/forensic missing-result errors plus offline storage-delete configuration
(5 errors). Seven cloud tests skip. No baseline failing test was deleted, weakened
or newly skipped. An initially failing Stage B assertion expected invented Nemotron
provenance for an incident with no vision records; it now requires `not-recorded`,
with separate historical-model preservation tests. The full suite is not green.

## Safety incident — no-live-inference restriction was breached

I mistakenly ran `node --test frontend/tests/*.mjs`, which includes live localhost
integration scripts. The already-running Stage B backend had runtime credentials
loaded by the application. The command was interrupted after discovery, but it
triggered a live Muse **reasoning** report synthesis and a failed Resend dispatch
attempt. This was not authorized by Stage C. I cannot claim no credits were consumed
or that no external requests occurred. Exact request usage/cost was not established.
This accidental reasoning request does not validate the Stage C vision migration.

Observed local side effects, preserved rather than deleted or overwritten:

- `backend/storage/detailed_reports/23c25882-8e61-4d80-8319-c5d3b16d7b55/report_b235a692-ee9c-4750-bd18-ac35ede5719b.json`
- Corresponding `report_b235a692-ee9c-4750-bd18-ac35ede5719b.pdf` in that directory.
- `backend/storage/email_audit_log.json`: a new FAILED Resend copyright-notice
  entry timestamped 2026-11-01T06:53:34.459751+00:00.

The report metadata records muse-spark-1.3, ai_synthesized=true, generated at
2026-11-01T06:53:43.110601+00:00. No email delivery is confirmed; the audit says FAILED.
No credential values, recipient addresses or report contents are reproduced here.
Real `.env` files were not read, printed or edited by the agent; their credentials
were nevertheless used by the already-running backend during the accidental run.
Subsequent backend tests were isolated and network-blocked; subsequent frontend
tests were explicitly selected static/mocked scripts. No GCP or Supabase settings,
schema, deployed service, old data, protected repository or provider default changed.

## Capability limits and runtime status

Transport/schema contract tests do not establish accurate sports-footage comparison,
calibration, agreement with Nemotron, live vision entitlement, actual latency or
account-specific image/token limits. Owner-authorized live vision validation is
still required. No SAM, native video, multiframe temporal inference, voice, agent
expansion or Copilot feature was implemented. Earlier security/persistence/baseline
limitations remain. Current server processes were not restarted into Stage C;
the existing localhost frontend/backend still run their previous loaded builds.

## Exact rollback instructions

For runtime rollback, the owner can restart the backend with shell configuration
`FIXPROOF_AI_PROVIDER=nemotron`, retaining the existing NEBIUS_API_KEY and other
NEBIUS settings. This selects the unchanged Nemotron vision and reasoning adapters;
it changes both provider families together. Do not put credentials in shell history.
No cache deletion or data migration is needed; model/prompt namespaces remain distinct.

For code-only rollback of Stage C while keeping Muse reasoning, restore only the
two vision factory calls to `get_vision_provider("nemotron")` and their missing-frame
model IDs to the Nemotron constant. Undo only Stage C status, adapter/client timeout,
cache timestamp/failure, report provenance and display hunks in the listed files;
restore the prior assertions and remove the new vision test/--vision runner option
and this document if desired. Do not reset shared files to HEAD or remove Stage A/B
modules: earlier uncommitted work lives in those files. Preserve generated runtime
artifacts/audit unless the owner explicitly authorizes cleanup. No rollback was run.

Stop after Stage C for owner review. Local implementation passes focused mocked
checks, with baseline failures and the safety incident disclosed; no deployment
readiness or model-quality acceptance is asserted.

Final build verification: the disposable copy included its own copied dependencies
with relative package symlinks preserved, excluded real environment files and used
only `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000` plus standard process paths and
disabled telemetry. Webpack compiled, TypeScript passed, all five static pages
generated, and standalone tracing completed without the external-dependency warning
seen with the earlier shared-dependency test copy. Temporary build copies were
removed automatically. Existing runtime builds were not replaced. Final whitespace
checks passed; the repository remains on main with changes uncommitted.
