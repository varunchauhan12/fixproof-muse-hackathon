# SAM queue and performance follow-up

2026-11-02. Supersedes the selected-pair-only behavior in the earlier automatic-SAM notes.

- SAM queue now requires the backend's literal `match_confirmed: true` flag, excludes explicit NO_MATCH and retains the existing CV eligibility/entropy/timestamp checks. The matcher sets this flag for CV-threshold-passed candidates; no match thresholds or CV algorithms were changed. Negative/unconfirmed observations remain available in the normal CV viewer but are excluded from SAM inference.
- Opening an incident's SAM tab prepares its entire confirmed/CV-passed queue automatically with two candidate workers. Browsing is independent and remains enabled while work runs. No further candidate clicks are needed to calculate results.
- Remaining jobs pause when the tab is inactive; already-started jobs drain and save their results. Reopening skips previously attempted candidates; failures require explicit retry.
- Backend uses a shared four-worker concept pool and maximum four simultaneous SAM calls, plus maximum two discovery calls. Reference/suspect concepts can be processed concurrently instead of serially.
- Exact physical-frame inference is reused across candidates only when session, model, prompt, asset/frame identity, timestamp, filename and image SHA-256 match. Raw cached inference is validated before reuse, and each response gets a freshly resolved current candidate/target association. An alternative reference never inherits the best reference's annotation.
- Single-flight frame requests prevent duplicate work for overlapping pairs. Successful target/aggregate caches remain bounded and TTL-limited; no database persistence was added.
- UI shows actual prepared/running counts and per-candidate SAM state. No fabricated percent-complete model progress.

## Validation

- Backend: `.venv/bin/python -B -m unittest tests.test_sam_workspace tests.test_sam_scene tests.test_sam_provider` from backend: **41 passed**.
- Frontend: `node --test frontend/tests/test_sam_workspace.mjs frontend/tests/test_investigation_workspace.mjs frontend/tests/test_forensic_evidence_experience.mjs frontend/tests/test_floating_muse_chat.mjs`: **48 passed**.
- TypeScript and focused SAM/investigation-room lint passed; git diff whitespace checks passed. Existing Muse Center lint debt is documented in the previous follow-up and was not introduced by this task. No production build was run during this optimization.
- Tests cover explicit confirmed-only gating, all-pair preloading, two candidate workers, continuation after a failure, inactive-tab stopping, a global four-call localization limit, cache reuse and preserving distinct candidate associations for a shared suspect frame.
- Real browser: opening SAM started two of **six** eligible pairs immediately; all six reached prepared state without choosing further candidates. The prior twelve-item list's unconfirmed entries were excluded. Selecting already-prepared pair #6 displayed real validated results immediately (reference 10s, suspect 15s; five reference regions, two suspect regions).
- Screenshot: `SAM_BATCH_READY.jpg`. This is a live API/browser check, distinct from mocked unit tests. No fixed latency reduction is promised: provider latency and throttling vary. The implementation removes serial localization and selection-dependent waiting.

No reports/PDFs/emails, database mutations, environment changes or deployment actions were invoked. No new dependencies. Existing production provider selection, rollback support, voice flow, CV matching and reports remain unchanged.

The combined local checkpoint includes the previously completed P2 workspace and Muse layout/automatic-label work, their tests and documentation, plus this performance follow-up. Environment files, credentials, recordings, databases, uploaded media, dependency directories and runtime artifacts are excluded. Documentation screenshots and the explicitly sanitized smoke-test JSON are intentional verification artifacts.
