# P1 — Forensic Investigation Room

Implemented 2026-11-02. No backend, schema, provider, environment or deployment changes.

## Existing implementation and data flow

`DashboardConsole` supplies incidents to `IncidentResponse`; selecting an incident opens its dossier. Its Forensic Evidence & Provenance tab renders `ForensicEvidenceExperience`. `IncidentResponse` retrieves existing detailed-report history and the selected report. Report generation/export and the dual-player ledger remain intact.

Previously the frame viewer preferred report correlations, ignored alternative candidates, synthesized filenames from rounded/guessed timestamps, and substituted zero for missing measurements. Activity-context updates could reset selection. Model provenance included hardcoded model names and successful API-validation claims.

## Implemented

- Reference asset IDs, suspect identity, incident status and separately labelled backend threshold-match count.
- Recorded `best_match` and `top_candidates` deduplicated per sampled frame with original rank and frame-match array index retained. `candidate_matches_found` counts confirmed frames in the backend, not all nearest neighbours; the explorer reports its actual candidate count separately.
- Responsive, balanced Reference/Suspect image panels; independent loading/error/unavailable states and explicit retry. Existing frame-stream API with recorded filenames/path basenames only; no filename or timestamp synthesis.
- Candidate list, previous/next and chronological sampled timeline share selection. Existing temporal clusters select only evidence with a matching source asset.
- CV measurements separated from AI explanation. L2, similarity index, pHash Hamming distance, source/suspect frame IDs, rank, original array index and temporal offset remain unavailable when absent. No fake evidence IDs or infringement probabilities.
- Report correlations are a labelled fallback only when raw frame records are absent. Reports associated with another incident are rejected. Report/export functionality retained.
- Provenance now describes stored annotations, not live API success; missing clusters no longer imply no matches. No guessed sampling cadence.
- Existing Ask Muse and activity-context handoff retained; no new conversation architecture, tools or grounding rules.

## Exact task files

1. Modified `frontend/components/dashboard/ForensicEvidenceExperience.tsx`, preserving its pre-existing session-aware Copilot edits.
2. Created `frontend/components/dashboard/InvestigationWorkspace.tsx`.
3. Created `frontend/lib/forensic-evidence.ts`.
4. Created `frontend/tests/test_investigation_workspace.mjs`.
5. Created `docs/P1_INVESTIGATION_ROOM.md`.
6. Created `docs/P1_INVESTIGATION_ROOM.jpg` (browser verification).

Other working-tree modifications were pre-existing or concurrent and were not staged or discarded.

## Actual APIs and fields

- Existing incident APIs already provide `MatchAnalysisResult`: incident/submitted asset IDs, suspect filename, status, counts, matched assets and frame matches.
- `backend/app/matcher.py:match_frame_against_vault` returns `best_match` and `top_candidates` with vector/source/frame IDs, source timestamp/filename/path, L2, `visual_similarity_score` (legacy `confidence_score` alias), confirmation/status and optional pHash/vision metadata. `analyze_asset_matches` supplies the incident summary and submitted-frame records.
- Submitted frame fields: `frame_index`, `timestamp_sec`, `filename`, `frame_path`.
- `getAssetFrameUrl` → `GET /api/vault/assets/{asset_id}/frames/{frame_filename}` → `backend/app/main.py:stream_asset_frame`. This existing endpoint resolves approved local/cloud storage roots and incident aliases.
- Reports: `sections.frame_correlations`, `sections.timeline_intervals`, `model_id`, `ai_synthesized`.
- Copilot: `ActivityContext.setActiveIncidentId`, `fixproof_muse_select_incident` and `fixproof_open_muse`. `FloatingMuseChat` binds its existing client to the selected incident. Candidate selection does not transmit unvalidated SAM/candidate context.

## Verification

From repository root:

```
node --test frontend/tests/test_investigation_workspace.mjs frontend/tests/test_forensic_evidence_experience.mjs frontend/tests/test_floating_muse_chat.mjs
npx --prefix frontend --no-install tsc --noEmit --incremental false --project frontend/tsconfig.json
git diff --check
```

29 tests passed: 11 new actual adapter/component-handler tests, 14 existing forensic fixture tests and 4 mocked chat tests. Includes candidate deduplication, ordering, missing/zero measurements, original identities, report association, selection/navigation/timeline, exact frame URL inputs and loading/error/retry/unavailable transitions. No wildcard/live integration scripts ran. TypeScript passed.

Targeted ESLint from `frontend`:

```
npx --no-install eslint components/dashboard/InvestigationWorkspace.tsx lib/forensic-evidence.ts components/dashboard/ForensicEvidenceExperience.tsx
```

Zero errors; one advisory `no-img-element` warning. Native images use the existing frame stream with explicit load/error handling. Production build was not run; the already-running Next development server compiled the dashboard route.

Browser validation against existing local processes (`http://localhost:3000/dashboard`, backend port 8000 health 200), without restarts:

- Opened existing incident list and an actual stored investigation: 12 candidates across four sampled frames; four backend threshold matches.
- Both reference and suspect images decoded at 2560×1440.
- Direct candidate selection, previous/next and chronological selection updated frames, timestamps, metrics and selection together.
- Verified alternate pair reference 10.00s / suspect 15.00s, L2 0.4358, similarity index 84.2/100, offset +5.00s. Another pair reference 10.00s / suspect 0.00s loaded both frames successfully.
- Opened/minimized Ask Muse without sending any message. Incident handoff verified through source and existing mocked chat tests; no live inference.
- Inspected default mobile viewport and desktop 1440×900 breakpoint; reset temporary override.
- No scan, report generation/export, email, SAM inference or mutation controls exercised. Existing frame retrieval may populate local cloud cache; this behavior was not changed.

## Limitations

Some records lack evidence IDs, locations, annotations or temporal clusters. Missing evidence is shown honestly and cannot be reconstructed in this frontend task. Report-only correlations remain weaker provenance than original candidates. Real storage failures were not deliberately induced; error transitions were tested offline. Full scan/video playback, report generation/export, voice and external inference were not exercised. No claim of a complete pipeline revalidation or user-facing SAM integration is made.

## Next SAM 3.1 task

Existing schemas already allow per-frame or best-match `sam_segmentation` / `ref_sam_segmentation`. `SAMSegmentationResult` carries incident/asset/evidence/frame IDs, timestamp, target, frame reference, model/provider, validation/decoding status and `objects` or legacy `detected_objects`.

1. Bind annotations to incident + original frame-match array index + candidate source asset/frame identity + target + original dimensions. Array index differs from recorded frame ID. Best-match SAM must not be inherited by an alternative candidate.
2. Validate normalized `[x1,y1,x2,y2]` or pixel boxes with declared `w/h`. Legacy array boxes may be normalized or pixels. Reject nonfinite/invalid bounds and align coordinates with the actual object-contain image rectangle, including letterboxing.
3. Existing `/api/incidents/{incident_id}/frames/{pair_index}/annotated?target=...` (`stream_annotated_incident_frame`) renders stored boxes or original bytes. It resolves only the BEST match, requires session headers outside demo mode and may populate cloud cache. A regular image tag cannot attach the session header. Introduce a session-aware fetch/blob client and validated candidate association before using it here. HTTP 200 alone does not prove SAM is available.
4. Preserve mask encoding/raw payload, dimensions, offsets and decoding status. `lossless_base85` / RAW_PRESERVED is not a browser polygon. Establish and validate the supported decoder and coordinate transform before rendering masks; never fabricate polygons.
5. Add per-target provenance/validation, overlay visibility controls and offline alignment tests. No automatic provider inference when selecting a frame.
6. Muse needs an allowlisted projection of selected candidate/evidence identity, target, dimensions, labels/boxes, model/provider and validation state, with grounded citations. The current incident-only handoff does not carry selected candidate or raw masks. Extend the existing read-only tool/grounding contract in that separately authorized stage.

No commits, pushes or deployments. Protected repositories untouched.
