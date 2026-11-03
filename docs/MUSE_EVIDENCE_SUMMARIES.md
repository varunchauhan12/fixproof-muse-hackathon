# SAM and temporal evidence summaries

Implemented locally on 2026-11-03. No deployment, credentials, database schema or incident records changed.

## Findings and behavior

The assistant previously reconstructed SAM/temporal answers through its bounded reasoning planner. SAM evidence was available only through an expiring process-local snapshot; neither workspace had a saved dedicated summary or summary PDF. The reported generic `PROVIDER_ERROR` does not identify the historical upstream failure: no precise upstream cause can be established from that message alone.

Explicit SAM/temporal findings/summary requests now read an authorized saved artifact directly, before generic report actions or planner inference. Existing email/share requests keep their separate approval workflow. No saved summary means an honest unavailable state with instructions to open the relevant incident workspace, never a fabricated result. Technical/general chat remains on the existing planner.

- SAM: after the candidate batch settles, the UI requests a summary of available validated snapshot observations. Failed pairs/expired or bounded cache coverage cannot establish exhaustive investigation coverage. A summary may be partial and is labelled as a historical snapshot.
- Temporal: after canonical statistics load in its tab, the UI requests a summary, preserving per-reference-asset populations, median/MAD, missing pairs and ordering statistics. No sampling cadence, probability or copying conclusion is invented.
- Both workspaces display actual provenance/time, a collapsible brief, explicit failure/retry states and a summary PDF button. Chat returns the same brief and PDF control.
- Unchanged evidence reuses a saved summary. Refresh does not force new inference for unchanged evidence. Failures are not automatically retried. One bounded Spark request selects salient recorded fact IDs; displayed sentences are deterministic projections of those facts. This is an extractive evidence brief, not unrestricted model-written prose. Unknown/duplicate IDs, insufficient selection and mismatched model provenance are rejected before saving.
- Model: `muse-spark-1.3` through the existing `MuseClient.complete` structured chat-completions contract. Configured provider must be Muse; reasoning/vision/SAM provider behavior and Nemotron rollback remain unchanged.

## Storage and access

Saved JSON lives under ignored `backend/storage/evidence_summaries/`, keyed by a hash of session/incident/kind. Files are written atomically after successful validation. No original incident, evidence, report, vault or database write occurs. Fingerprints invalidate a saved artifact when its incident record changes. Saved SAM briefs survive local process restarts/cache expiration but remain explicitly historical; current images are not revalidated merely by reading a summary.

All endpoints require a valid client session and the existing incident-workspace access policy, including downloads: ownership in normal mode, the existing demo-showcase convention, or explicitly configured demo access. Saved artifacts remain keyed by the viewing session. GET and PDF never infer. Downloads include the expected summary fingerprint: an old chat card cannot silently download a replacement summary.

- `GET /api/incidents/{id}/evidence-summaries/{sam|temporal}`: saved artifact or 404.
- `POST` on the same path: generate/reuse from existing canonical evidence; 409 if unavailable or Muse is not selected; sanitized 502 on provider/validation/storage failure.
- `GET .../{sam|temporal}/pdf?summary_id={fingerprint}`: generate PDF bytes from saved artifact only; 409 if replaced.

This follows the existing local demo artifact-storage model. Cloud Run ephemeral disks do **not** provide durable storage across instance replacement or shared state across instances. No new cloud storage/schema was provisioned. The lock/deduplication is process-local, intended for the existing single-process demo. Temporal brief projection includes up to ten reference assets; SAM up to forty current cached observations. Full measured evidence remains in the investigation workspace.

## Files changed for this request

Created:
- `backend/app/evidence_summaries.py`
- `backend/app/evidence_summary_api.py`
- `backend/tests/test_evidence_summaries.py`
- `frontend/lib/evidence-summaries.ts`
- `frontend/components/dashboard/EvidenceSummaryPanel.tsx`
- `frontend/tests/test_evidence_summaries.mjs`
- This document and the two `MUSE_EVIDENCE_SUMMARIES*.png` browser proof images.

Modified:
- `backend/app/main.py`: register the summary router.
- `backend/app/muse_actions.py`: optional typed artifact summary kind; preserve pre-existing email hardening.
- `backend/app/muse_orchestrator.py`: authorized saved-brief retrieval before generic planning/report generation.
- `frontend/lib/muse-assistant.ts`: optional summary kind in artifact contract; preserve prior edits.
- `frontend/components/muse/MuseArtifactView.tsx`: readonly evidence brief and exact summary PDF download.
- `frontend/components/dashboard/SAMInvestigationWorkspace.tsx`: summary after batch settlement.
- `frontend/components/dashboard/TemporalEvidenceWorkspace.tsx`: summary after canonical data load.
- `frontend/tests/test_temporal_evidence.mjs`: isolate the new summary component in existing canonical-statistics rendering tests.

Other initial working-tree changes and concurrently created P4 audit documents were preserved.

## Verification

- Backend: **227 tests passed** across explicit summary, approval, actions, orchestrator, tools, conversation/API, temporal, SAM and voice modules. Includes 25 new summary tests: storage/restart, ownership, replacement, deduplication, grounded selection validation, provider failures, PDF/API and chat bypass. Provider network access is blocked in the new tests.
- Existing isolated report/PDF/email harness: **42 passed**; no actual email dispatched.
- Frontend explicit offline list: **92 passed**, including four new summary client tests; no wildcard integration command.
- TypeScript, targeted ESLint and production frontend build passed.
- Actual existing incident temporal API returned nine candidate observations for one reference asset.
- One real Spark summary generation succeeded in **4.88 seconds**, reporting `muse / muse-spark-1.3`, selecting three fact IDs. Repeated GET returned the identical saved artifact; PDF was valid and 2,549 bytes.
- Actual conversation API returned the saved temporal summary with one artifact and zero planner tool calls. Browser confirmed the summary in the temporal tab, actual Muse chat response and successful chat PDF button download.
- A fresh live SAM localization batch was **not** started during validation. SAM summary generation and retrieval are covered offline using isolated evidence fixtures; live SAM summary will be generated at the next completed SAM workspace batch.

No email, new full report, video processing, database mutation, commit, push or deployment was initiated by this task. Local JSON summary artifacts and an ephemeral test conversation were created as part of the requested feature validation. Temporary PDF verification copy resides outside the repository.


## Follow-up: partial SAM and incident-workspace summary repair (2026-11-03)

Reproduced on the existing local server: a valid existing demo session could retrieve another demo incident's temporal evidence (HTTP 200), while the summary route returned HTTP 404, `Incident unavailable in this session.` Summary authorization was stricter than the incident/temporal/SAM workspace policy. Summary routes now use that existing policy; ordinary cross-session access remains rejected when demo mode is off, and missing/malformed sessions remain invalid. Read-only chat brief retrieval follows the same policy without changing other assistant tools or document/email action permissions.

SAM input now excludes failed/unavailable/unknown statuses before fact construction, inference, fingerprinting and PDF appendix storage. Validated objects from partial frames remain usable. Valid negative observations (no objects/concepts) are retained as negative observations, not invented detections. If no usable frame remains, generation returns a clear 409 without calling Spark. The brief discloses partial coverage instead of listing failed frame details. Existing incident/frame records are not modified or deleted.

Temporal fingerprints no longer include volatile `generated_at` metadata. Unchanged measurements reuse the same saved brief instead of regenerating every visit. Summary schema version 2 invalidates older cached briefs so previously included failed SAM observations are not served again. New briefs are saved only after successful model response validation. Spark selection uses the existing structured transport with a bounded 2,048-token budget; model errors remain errors, with no automatic retry or fabricated fallback.

The UI restores a valid saved brief before attempting refresh, preserving its PDF if that refresh fails. Effect cancellation/replay is covered offline, and ordinary rerenders do not retry failed inference.

Validation:
- **236 backend tests passed**, including 34 summary tests covering mixed SAM outcomes, all-failed/partial/negative cases, stable temporal cache identity, demo generation/read/PDF/chat access and normal-mode session rejection.
- **95 frontend tests passed**, including saved-brief preservation on refresh failure, cached reads while SAM is pending, and Strict Mode effect replay without duplicate dispatch.
- TypeScript, targeted ESLint, production frontend build and diff whitespace validation passed.
- Actual existing demo incident: temporal data returned six recorded raw candidates; real `muse-spark-1.3` summary generation succeeded in **3.54 seconds**; saved retrieval and PDF download returned HTTP 200.
- No fresh live SAM localization batch was started. Mixed-success SAM summary generation and exclusion were verified with network-blocked offline tests.

The pre-existing P4.2 browser inventory document was preserved. This repair was not committed, pushed or deployed; environment credentials and database schemas were not edited.
