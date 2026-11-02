# P3 temporal evidence review and improvements

Reviewed and improved the uncommitted P3 implementation on 2026-11-03. P2 is already committed as `85248a0`. No branch change, staging, commit, push or deployment was performed.

## Findings corrected

- Alternative candidates inherited frame-level/best-match confirmation and SAM metadata. Confirmation now comes only from the actual candidate. Frame-level legacy SAM metadata is associated only with the actual best match; the temporal UI does not query or display SAM observations.
- Chronology compared unrelated reference assets and considered alternative matches at the same suspect timestamp to be ordering reversals. Comparisons now remain within a reference asset and require strictly increasing suspect time. LIS must increase in both streams. Repeated timestamps remain ambiguous, rather than being described as strictly monotonic.
- Zero MAD was described as all offsets being identical. It only establishes that at least half the absolute deviations are zero; an outlier can coexist with zero MAD. No artificial band is introduced.
- Candidate IDs depended on rank and ignored filenames in deduplication. IDs now depend on recorded provenance, not rank. Deduplication agrees with the CV explorer's recorded frame identity.
- Cluster joins used shared evidence IDs and could attach alternatives or another source to an interval. Internal joins now use unique candidate identities, while exposing recorded evidence IDs separately. The existing clustering algorithm and thresholds are unchanged.
- Candidates with failed CV gates were described as eligible. Population membership is now explicit, and excluded observations remain in the canonical candidate list.
- Empty populations inherited global measurements, and an unavailable slope displayed as `1.00x`. Every view now uses its own source/population measurements and shows unavailable values honestly.
- Clicking a temporal point passed a raw frame-match array index into a sorted CV-pair list. Selection now resolves both original array index and candidate rank; the browser confirmed that an alternative opens the exact matching CV item.
- The route permitted missing sessions and logged session identifiers. The independent read-only router requires a valid session and follows P2 ownership/demo conventions without logging identifiers. Offline API tests no longer import `app.main` or initialize the vault.
- Muse and report projections omitted provenance/methodology and suppressed errors misleadingly. Canonical measurements are reused, report paragraphs include populations, clusters, methods and limitations, and Muse preserves its bounded-output fail-closed behavior.

## Metric definitions and populations

Only recorded candidates are extracted. Complete measurements pass through the existing `build_frame_evidence_from_matches` normalizer. Its legacy missing-time/ordinal defaults are deliberately not used for incomplete records: those retain null timestamps/indices at the temporal boundary. No changes were made to `evidence_models.py`, `timeline.py`, CV thresholds, SAM behavior or providers.

Eligibility: recorded reference identity, no low-entropy flag or explicit `NO_MATCH`, and recorded candidate confirmation or finite nonnegative L2 below the existing 0.75 suspect gate. Confirmation is the stored candidate `match_confirmed is True` flag, produced by the matcher's L2/entropy gate; it is not independent identity verification.

Three populations are exposed: all eligible, backend-confirmed eligible, and eligible unconfirmed. Missing-time candidates remain in their population's denominator. Alternatives count separately and are explicitly not independent sampled frames. Top-level raw counts cover all recorded observations; `metric_population=all_eligible` identifies the global metric scope. `by_source` provides the same three populations separately for each reference asset.

- Offset = suspect timestamp − reference timestamp. Minimum, maximum, median and MAD use valid pairs only; source candidate IDs, valid and missing counts and formula accompany the values.
- MAD = median absolute deviation from the measured median. A descriptive median ± 2.5 MAD band is shown only for at least three valid pairs and positive MAD. This is a heuristic dispersion band, not a statistical confidence interval. Zero MAD has no band.
- Inversion = earlier strictly smaller suspect time with larger reference time, within the same reference asset. Actual candidate identities and timestamps are returned.
- LIS = longest subsequence strictly increasing in both timestamps within each reference asset. Overall LIS length is the sum of per-source lengths, divided by valid pair count for the descriptive ratio. Equal timestamps and alternatives can reduce this ratio without an inversion.
- OLS reference-time slope = Cov(suspect, reference) / Var(suspect). Offset slope = 1 − reference slope. Requires one source and at least three distinct timestamps in each stream. It describes the sample regression, not proven playback speed.
- Existing `cluster_frame_matches` retains its original selection, deduplication and thresholds. Cluster offset summaries require at least two retained valid candidates. Singleton summaries remain unavailable. Deviation baselines name the exact cluster, or the source-specific eligible population if cluster support is insufficient.

Report fallback correlations never enter raw statistics. An empty incident is distinguished from one actually containing report fallback correlations. SAM metadata/cache availability does not change temporal metrics.

## API and interaction

`GET /api/incidents/{incident_id}/temporal-evidence`

Requires `X-Client-Session-Id` matching existing syntax. Statuses: 400 invalid identifier/session, 404 missing incident, 403 ownership mismatch, 200 typed `TemporalEvidenceResult`. Missing owners are not public. Existing explicit demo behavior and `demo-showcase` compatibility remain. Registry access uses `strict_read=True`; the route performs no model call or record mutation.

Payload includes candidates, raw counts, population metrics, source-scoped populations, offsets, ordering comparisons/LIS, clusters, trend availability, methods and limitations. Candidate identities retain array index separately from submitted frame index. API, reports and Muse use the same builder.

The workspace lazily requests data only when active and aborts obsolete requests. It offers reference-source and population filters, measured cards, recorded scatter points, median/heuristic guides, separate sampled timelines, exact pair inspection, inversion identities, provenance table and methodology. Missing timestamps remain visible in counts and individual timeline records. Controls, plot points and exact-pair actions support keyboard access. The table scrolls inside its container on narrow screens.

Muse's existing matching/evidence tool is extended; no new model tools are introduced. Its temporal projection retains canonical statistics/provenance but excludes full candidate rows and duplicated `by_source` detail to preserve existing output limits. A bounded candidate provenance projection explicitly reports truncation; metrics are not recomputed from that truncated projection. Oversize results fail closed under the existing tool byte limit. Grounding validation is preserved. No live Muse inference was used to test this integration.

## Validation actually performed

Backend, from `backend`:

```sh
.venv/bin/python -B -m unittest tests.test_temporal_evidence tests.test_temporal_evidence_api tests.test_temporal_consumers tests.test_muse_tools tests.test_muse_orchestrator tests.test_muse_conversations tests.test_muse_conversation_api tests.test_voice_provider tests.test_voice_api tests.test_sam_workspace tests.test_sam_scene tests.test_sam_provider
```

Result: **179 tests passed**. Includes the supplied temporal fixtures, new regressions, isolated API authorization, canonical Muse/report equality and isolated temporal report paragraph rendering. Report consumer tests execute only the relevant code with injected read dependencies; they do not import normal app startup, initialize providers, create a PDF or send email.

Frontend, from repository root:

```sh
node --test frontend/tests/test_temporal_evidence.mjs frontend/tests/test_sam_workspace.mjs frontend/tests/test_investigation_workspace.mjs frontend/tests/test_forensic_evidence_experience.mjs frontend/tests/test_floating_muse_chat.mjs
```

Result: **54 tests passed**. New tests execute the actual temporal component handlers, including keyboard selection, alternative rank selection, unavailable slope and empty population behavior.

From `frontend`:

```sh
npx --no-install tsc --noEmit --incremental false
npx --no-install eslint components/dashboard/TemporalEvidenceWorkspace.tsx components/dashboard/ForensicEvidenceExperience.tsx lib/temporal-evidence.ts --quiet
npm run build
```

TypeScript, targeted lint and production build passed. The build generated all seven static pages successfully. `git diff --check` passed. No wildcard test commands were used. The full backend suite was not run because it contains unrelated live/persistent integration paths.

Browser: existing local backend health returned 200. At `http://localhost:3000/dashboard`, opened an existing incident and the Temporal Evidence tab: nine real candidate points loaded. Clicking rank 2 at the first sampled frame selected that exact CV alternative. Selecting the empty unconfirmed population showed unavailable values with no borrowed global statistics. At a 390px viewport, workspace width/scroll width were both 313px and chart width was 279px; viewport restored afterward. Zero browser error logs were observed. Screenshot: `docs/P3_TEMPORAL_REVIEW.jpg`.

## Files in the P3 change set

Modified:

- `backend/app/detailed_report.py`
- `backend/app/main.py`
- `backend/app/muse_orchestrator.py`
- `backend/app/muse_tools.py`
- `frontend/components/dashboard/ForensicEvidenceExperience.tsx`
- `frontend/lib/types.ts`

New:

- `backend/app/temporal_evidence.py`
- `backend/app/temporal_evidence_api.py`
- `backend/tests/test_temporal_evidence.py`
- `backend/tests/test_temporal_evidence_api.py`
- `backend/tests/test_temporal_consumers.py`
- `frontend/components/dashboard/TemporalEvidenceWorkspace.tsx`
- `frontend/lib/temporal-evidence.ts`
- `frontend/tests/test_temporal_evidence.mjs`
- `docs/P3_TEMPORAL_REVIEW.md`
- `docs/P3_TEMPORAL_REVIEW.jpg`

Other concurrent frontend edits appeared during this work in globals, AssetVault, IncidentResponse, InvestigationWorkspace, NemotronCenter, Overview, ThreatHunter, Header, AppStatusIsland and SessionSwitcher. They were not edited or staged by this review and remain in the working tree. A concurrent `docs/FRONTEND_UX_ACCESSIBILITY_REPORT.md` also appeared and was left untouched. All P3 changes also remain uncommitted.

## Limits and safety

Ordering comparisons enumerate actual inversions and can grow quadratically for large candidate sets. There is no inferred sampling cadence, interpolation, playback correction, sequence alignment, legal conclusion, cross-video tracking or mask decoding. SAM cache joining is intentionally not added. Live model inference and live report/PDF generation remain untested here. Existing legacy report sections outside the canonical temporal section retain their prior behavior.

No credentials/environment changes, explicit database writes/migrations, report/email actions, provider changes, deployments, commits or pushes were performed. The existing development reloader picked up code changes normally. Protected repositories were not modified.
