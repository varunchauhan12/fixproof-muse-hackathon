# Muse-only provider migration — final verification

2026-11-03. Repository: `fixproof-muse-hackathon`; branch `main`, HEAD `24930e9`. The earlier uncommitted migration was present at the start and has been preserved. This pass did not redesign the application, add provider abstractions, rename modules, redesign routes, modify deployment settings, or change credentials.

## Outcome

**Provider migration complete:** active provider registration, transport, defaults and environment reads are Muse-only. No active frontend provider reference to Nemotron/Nebius remains. Unsupported selectors fail explicitly. No alternate AI-provider fallback exists.

**Overall deployment verdict: NOT READY — FIXES REQUIRED.** The provider transition itself passes regression verification, but 39 pre-existing targeted lint errors remain, live Muse operation and fresh container operation are untested, and the preceding readiness report identifies the existing Cloud Run upload-size mismatch. This pass does not change cloud settings or expand into those unrelated repairs.

## Exactly what changed in this pass

1. `backend/app/main.py`: restored investigation `model_override` validation to the original Muse behavior: only the selected reasoning model is accepted by that endpoint. The preceding migration had unnecessarily broadened it to the provider's additional allowed Muse models. The correction occurs before incident reads or inference and leaves existing request/response models intact.
2. `backend/tests/test_muse_only.py`: added an offline endpoint regression proving a different Muse model is rejected with HTTP 400 before incident access or model completion.
3. `docs/MUSE_ONLY_RELEASE_READINESS.md`: added a pointer to this updated verification. Previous findings, file inventory and the disclosed prior test incident are retained.
4. This document: records the final allowlist, remaining references and fresh verification results.

No other source edits were needed. Existing uncommitted neutral helper extractions, provider removals, frontend symbol changes and compatibility aliases were inspected and retained; they are described in the preceding readiness report. Existing Docker/ignore-file edits were already pending and were not changed in this pass.

## Production call-chain checks

| Operation | Preserved implementation |
|---|---|
| Incident investigation | `main.investigate_threat_incident` → reasoning factory → `MetaReasoningProvider.generate_investigation_report` |
| Diagnose | `main.diagnose` → reasoning factory → Meta completion |
| Document polishing | `document_actions` → reasoning factory → Meta completion |
| Detailed synthesis | `detailed_report.synthesize_detailed_report` → reasoning factory → Meta completion |
| Match vision | `matcher.analyze_asset_matches` → vision factory → `MetaVisionProvider` |
| URL preview vision | `url_screener.screen_video_url` → vision factory → `MetaVisionProvider` |
| SAM/localization | segmentation factory → existing `MetaSAMProvider` |
| Voice | voice factory → existing `MetaVoiceProvider` |
| Copilot/actions/summaries | existing orchestrator/tool/action/summary boundaries and Meta reasoning client |

The original provider-independent evidence/system prompts, failed-report construction, image resizing, cache keys/persistence and document/email logic survive in `investigation_support`, `vision_support`, and `document_actions`. The OpenAI SDK remains the existing Meta transport dependency; its presence does not mean Nebius is used.

Missing Muse credentials or failed inference remain sanitized error/unavailable/failed-validation outcomes. Existing deterministic templates and report generation remain explicitly labelled deterministic (`ai_enhanced`/`ai_synthesized` false, deterministic model identifier and synthesis failure metadata where applicable). They are not another AI provider and are not represented as successful Muse inference. No template/PDF/email workflow was removed to enforce provider selection.

## API, schema and provenance

Existing `/api/nemotron/` HTTP paths are retained as hidden compatibility aliases for the same Muse-backed functions under `/api/muse/`. They are not provider selectors. Their endpoint identity and the unchanged health/status contracts are tested offline. Current frontend callers use the neutral Muse paths. No additional routes were introduced in this pass.

The `nemotron_reports` table, `nemotron_reports.json` local filename, migrations and historical provenance remain intentionally intact. Existing records are not rewritten. No Supabase connectivity request, migration, export, vault synchronization, report generation against real data or email operation was performed in this pass. Actual startup was tested only with local mode in an environment-isolated disposable copy, never against the configured Supabase project.

## Local configuration observation — names only

`backend/.env` has a configured Meta key and a Muse selector (or valid default). Contrary to the assumption that every old entry has gone, the file still contains nonempty `NEBIUS_API_KEY` and `NEBIUS_MODEL` entries. Their values were not displayed, copied into this report or changed. Their validity was not tested. The application does not read them. The fresh regression run removes all legacy environment variables and succeeds. No local env file was edited, and no secret deletion was attempted.

## Final application environment allowlist

| Category | Variables |
|---|---|
| Muse credential | `MODEL_API_KEY` (backend secret) |
| Provider selection | `FIXPROOF_AI_PROVIDER` (optional; only `muse`, default `muse`) |
| Optional Muse tuning | `MUSE_BASE_URL`, `MUSE_REASONING_MODEL`, `MUSE_VISION_MODEL`, `MUSE_SAM_MODEL`, `MUSE_VOICE_MODEL`, `MUSE_REASONING_EFFORT`, `MUSE_TIMEOUT_SEC`, `MUSE_MAX_TOKENS`, `MUSE_CONVERSATION_TTL_SECONDS` |
| Full cloud persistence | `FIXPROOF_DB_MODE`, `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| DB compatibility aliases | `DATABASE_URL`, `POSTGRES_URL`, `STORAGE_BACKEND` |
| Optional component DB configuration | `SUPABASE_DB_HOST`, `SUPABASE_DB_USER`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_NAME`, `SUPABASE_DB_PORT` |
| Optional DB tuning | `SUPABASE_DB_SSLMODE`, `SUPABASE_DB_TIMEOUT_SEC`, `SUPABASE_DB_MAX_CONNECTIONS` |
| Storage fallback | `SUPABASE_ANON_KEY` (unnecessary with backend service-role credentials) |
| Email | `RESEND_API_KEY`, `FROM_EMAIL`, `MUSE_REGISTERED_EMAIL` |
| Evidence signing | `FIXPROOF_SIGNING_KEY_HEX`, `FIXPROOF_SIGNING_KEY_PEM`, `FIXPROOF_SIGNING_KEY_PATH`, `FIXPROOF_SIGNING_KEY_ID`, `FIXPROOF_REQUIRE_CONFIGURED_SIGNING_KEY` |
| Backend safety/access | `FIXPROOF_CORS_ORIGINS`, `FIXPROOF_ENV`, `FIXPROOF_DEMO_MODE`, `FIXPROOF_RATE_LIMIT_PER_MINUTE` |
| Frontend build | `NEXT_PUBLIC_API_URL` (public; not a secret) |
| Container/platform conventions | `PORT`, `NODE_ENV`, `HOSTNAME`, `NEXT_TELEMETRY_DISABLED`, `PYTHONDONTWRITEBYTECODE`, `PYTHONUNBUFFERED`; existing code sets `KMP_DUPLICATE_LIB_OK` |

The AST audit finds **39 distinct direct backend environment reads**. For full cloud operation prefer `SUPABASE_DB_URL`; some existing vault paths do not consume every DB alias. Supply only one DB URL and one signing-key format. No backend credentials belong in frontend variables. Full defaults and deployment caveats remain in the preceding report.

Obsolete application configuration, safe to omit manually: `NEBIUS_API_KEY`, `NEBIUS_MODEL`, `NEBIUS_BASE_URL`, `NEBIUS_TIMEOUT_SEC`, `NEBIUS_MAX_TOKENS`, any other `NEBIUS_*` entries, and `DETAILED_REPORT_MODEL`. No current application module reads them. `DETAILED_REPORT_MODEL` has been replaced by the selected Muse reasoning model. Existing cloud secrets were not inspected or deleted.

Tests additionally use API target variables and the explicit test-only `FIXPROOF_ALLOW_LIVE_TESTS` guard. These are not application runtime requirements and were not enabled. The old integration scripts were not run.

## Fresh verification

- Backend: `backend/.venv/bin/python -B backend/tests/run_phase0a_checks.py --release` — **600 run, 593 passed, 7 skipped; 0 failures, 0 errors**. Explicit offline module list; disposable source/storage copy; `.env` loading disabled; legacy credentials stripped; socket connections blocked. Includes actual FastAPI local startup/health, four Muse-only factories, unsupported-selector rejection, missing-key handling, compatibility aliases, mocked reasoning/vision/SAM/ASR, CV/ingestion/vault, Copilot/tools/approvals, Studio/document/PDF workflows, temporal/SAM/evidence summaries, email guards and evidence export/signature checks.
- Frontend: explicitly selected offline voice, chat, workflow, summaries, temporal, SAM, investigation, forensic and dashboard tests — **120 passed**. Global fetch additionally blocked with a temporary preload; API behavior is mocked by the fixtures. No physical-microphone or live transcription claim is made.
- TypeScript: `tsc --noEmit --incremental false` passed.
- Production frontend build: `npm run build` passed.
- Targeted lint: **39 errors**, matching the baseline error counts under the same configuration: DashboardConsole 5; IncidentResponse 14; SwarmLogsView 2; ActivityContext 1; types 2; MuseCenter/previous NemotronCenter 15. This remains a failing check, not silently waived. No frontend source changed in this pass.
- Final `git diff --check` passed. No dependency installs, Docker image builds, live model calls, live integration scripts, emails, real incident operations or cloud/database changes in this pass.

The earlier readiness report discloses a live export integration-test mistake from the preceding pass. Its possible persistence outcome remains unverified; nothing was deleted or rewritten to conceal it. This fresh run did not repeat that action.

## All remaining reference locations

Active legacy provider/client/configuration dependencies: **zero**. Active frontend legacy provider references: **zero**. The locations below intentionally retain names for HTTP/data compatibility, historical fixtures, manual schema utilities, or audit history. This report itself also uses the names while documenting their removal. Env files, ignored local artifacts, dependency trees and Git internals are excluded from the source inventory; the local env observation is separate above.

| Category | File | Matching lines |
|---|---|---|
| Historical documentation/current audit | `README.md` | 12, 46, 60, 96, 105, 109, 110, 111, 113, 135, 146 |
| Historical documentation/current audit | `TESTING_AND_VALIDATION.md` | 25, 130, 195, 200, 205, 206, 207, 249 |
| Historical schema/storage | `backend/app/db.py` | 350, 357 |
| Historical schema/storage | `backend/app/detailed_report.py` | 1755 |
| Historical schema/storage | `backend/app/evidence_models.py` | 133 |
| HTTP compatibility aliases | `backend/app/main.py` | 1385, 1415, 1477, 1523, 1535, 1552, 1615, 1644, 1681, 1703, 1760 |
| Historical schema/storage | `backend/app/registry.py` | 26, 823, 859, 918, 962 |
| Historical schema/manual utility | `backend/migrations/001_initial_schema.sql` | 140, 141, 142, 144, 147, 176, 177 |
| Historical schema/manual utility | `backend/migrations/002_cloud_persistence_expansion.sql` | 24, 78, 96, 97 |
| Historical schema/manual utility | `backend/scripts/apply_schema.py` | 30 |
| Historical schema/manual utility | `backend/scripts/initialize_new_project.py` | 17 |
| Historical schema/manual utility | `backend/scripts/reset_everything.py` | 5, 133 |
| Historical schema/manual utility | `backend/scripts/verify_schema.py` | 14, 40 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/run_phase0a_checks.py` | 51 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_copilot_workflows.py` | 27, 51 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_db.py` | 249, 294, 295, 349 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_detailed_report.py` | 65, 286, 292, 299, 311, 317, 325 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_document_actions.py` | 2, 23 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_evidence_package.py` | 79, 103, 118 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_factory_wiring.py` | 64 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_forensic_report_pdf.py` | 214, 236, 253, 254 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_investigation_support.py` | 3, 10, 13, 329, 395 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_meta_provider.py` | 130, 157, 166 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_meta_reasoning_migration.py` | 16, 108, 117 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_meta_vision_migration.py` | 40, 125, 126 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_muse_only.py` | 20, 26, 35, 36, 48, 51, 52 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_muse_orchestrator.py` | 299, 300 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_pdf_retrieval_stabilization.py` | 8, 167, 179, 217, 228, 236 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_phase_3_1.py` | 3, 110 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_pipeline_repair.py` | 66, 76 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_report_history.py` | 59, 81, 103, 178, 189 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_sam_provider.py` | 240 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_security_foundations.py` | 44 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_vision_verifier.py` | 2 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_voice_provider.py` | 123, 127 |
| Rejection tests, historical fixtures or milestone descriptions | `backend/tests/test_wonder_provider.py` | 295 |
| Historical documentation/current audit | `docs/EXISTING_SERVICES_SUPABASE_SWITCH.md` | 31, 79, 86 |
| Historical documentation/current audit | `docs/FRONTEND_UX_ACCESSIBILITY_REPORT.md` | 32, 50, 110, 137, 195 |
| Historical documentation/current audit | `docs/ISOLATED_DEPLOYMENT_V2.md` | 12, 93, 104, 106, 107, 108 |
| Historical documentation/current audit | `docs/LOCAL_MUSE_ACTIVATION.md` | 9, 12, 14, 27, 28, 29, 33, 37, 47, 64, 82, 83, 94, 95, 109, 112, 166 |
| Historical documentation/current audit | `docs/META_MIGRATION_INVESTIGATION.md` | 1, 11, 12, 13, 27, 30, 34, 36, 37, 38, 39, 40, 41, 42, 43, 47, 48, 57, 59, 60, 63, 65, 70, 73, 75, 76, 77, 115, 117, 118, 119, 120, 121, 137, 140, 143, 144, 158, 161, 168, 176, 189, 199, 201, 203, 209, 210, 232 |
| Historical documentation/current audit | `docs/META_MIGRATION_MODEL_MATRIX.md` | 4, 6, 8, 9, 11, 12, 28 |
| Historical documentation/current audit | `docs/META_STAGE_A_COMPLETION.md` | 3, 22, 32, 51, 59, 105, 109, 111, 121, 126 |
| Historical documentation/current audit | `docs/META_STAGE_B_COMPLETION.md` | 12, 15, 21, 26, 36, 37, 45, 50, 60, 63, 65, 71, 75, 82, 95, 97, 128, 130, 145, 154, 155, 160 |
| Historical documentation/current audit | `docs/META_STAGE_C_COMPLETION.md` | 6, 7, 41, 42, 49, 64, 70, 71, 77, 81, 99, 143, 146, 169, 202, 212, 213, 218, 219 |
| Historical documentation/current audit | `docs/MUSE_ASSISTANT_ARCHITECTURE_AUDIT.md` | 40, 63, 64, 71, 72, 73, 95, 115, 117, 131, 153 |
| Historical documentation/current audit | `docs/MUSE_ASSISTANT_STEP_3B.md` | 152 |
| Historical documentation/current audit | `docs/MUSE_ASSISTANT_STEP_3C.md` | 58, 78 |
| Historical documentation/current audit | `docs/MUSE_COPILOT_2_AUDIT_AND_TESTING_GUIDE.md` | 37, 75, 83, 89, 96, 167, 204, 232, 233, 234, 235, 236, 237, 238, 239, 240 |
| Historical documentation/current audit | `docs/MUSE_COPILOT_2_IMPLEMENTATION.md` | 19, 44, 69, 94 |
| Historical documentation/current audit | `docs/MUSE_EVIDENCE_SUMMARIES.md` | 15 |
| Historical documentation/current audit | `docs/MUSE_LAYOUT_AND_AUTOMATIC_SAM.md` | 9, 41 |
| Historical documentation/current audit | `docs/MUSE_NATURAL_LANGUAGE_ACTIONS_IMPLEMENTATION.md` | 113 |
| Historical documentation/current audit | `docs/MUSE_ONLY_RELEASE_READINESS.md` | 19, 24, 28, 35, 53, 86, 155, 186, 192, 256, 257, 263, 279, 280, 292, 306 |
| Historical documentation/current audit | `docs/P3_TEMPORAL_REVIEW.md` | 101 |
| Historical documentation/current audit | `docs/P4_1_GCP_RELEASE_GAP_AUDIT.md` | 5, 83, 121, 167 |
| Historical documentation/current audit | `docs/P4_2_BROWSER_DEPLOYMENT_INVENTORY.md` | 29, 32, 60, 66, 77, 89, 90, 91, 92, 93, 96, 131, 209, 243, 251, 322, 341, 349, 351, 355, 356, 357, 360, 361, 362, 363, 366, 368, 370, 377, 378, 379, 381, 392, 416 |
| Historical documentation/current audit | `docs/P4_DEPLOYMENT_READINESS_AUDIT.md` | 48, 56, 75, 78, 164, 184, 196, 199, 201, 207, 213, 214, 215, 216, 217, 219, 220, 222, 226, 229, 231, 236, 237, 240, 241, 246, 250, 267, 268, 269, 273, 279, 280, 284 |
| Historical documentation/current audit | `docs/PHASE_0A_COMPLETION.md` | 9, 16, 23, 29, 31, 38, 40, 41, 42, 49, 51, 56 |
| Historical documentation/current audit | `docs/PIPELINE_REPAIR_PROGRESS.md` | 32, 58, 139 |
| Historical documentation/current audit | `docs/TESTING_AND_VALIDATION.md` | 23, 128, 193, 198, 203, 204, 205, 247 |
| Historical documentation/current audit | `docs/VOICE_PROVIDER_STEP_1.md` | 7 |
| Historical documentation/current audit | `docs/analytics_and_swarm_logs_audit.md` | 16, 33, 79, 85 |
| Historical documentation/current audit | `docs/intelligence_analytics_data_audit.md` | 17, 28, 33 |
| Historical documentation/current audit | `docs/mediaguardsports_incident_response_audit.md` | 76, 88 |
| Historical documentation/current audit | `docs/mediaguardsports_location_map_audit.md` | 85 |
| Historical documentation/current audit | `docs/milestone_6c6a_capability_audit.md` | 1, 14, 18, 19, 20, 21, 24, 62, 65, 66, 70, 71, 80, 81, 84, 106, 112, 113, 116, 126, 140, 160, 190, 232, 286, 291, 293, 300, 303, 337, 375, 378, 380, 381, 407, 408, 423, 426, 429, 430, 431, 436 |
| Historical documentation/current audit | `docs/milestone_6c6b_completion.md` | 2, 8, 14, 19, 21, 32, 33, 35, 46, 64, 65, 70, 84, 89, 91, 108, 111, 121, 122, 136, 155, 156, 170, 171, 173, 195, 198, 217 |
| Historical documentation/current audit | `docs/nemotron_intelligence_center_audit.md` | 1, 14, 19, 23, 26, 27, 41, 46, 66, 78, 83, 95, 96, 97, 105, 106, 113, 125, 126, 132, 139, 142, 143, 144, 158, 161 |
| Historical documentation/current audit | `docs/phase_2_1_visual_evidence_audit.md` | 18, 20, 30, 51, 68, 255, 257, 259, 263, 264, 267, 284, 333, 383, 424, 429, 462, 474, 475 |
| Historical documentation/current audit | `docs/phase_3_3_forensic_output_quality.md` | 64, 72, 75, 92, 161, 169 |
| Historical documentation/current audit | `docs/phase_3_4_step_1_overview_asset_vault.md` | 57, 58, 211 |

## Boundary confirmation

All earlier uncommitted work remains present. No files in the protected repositories were touched. No environment file, secret, deployment setting, production service, database schema or real data was changed in this pass. No staging, commit, push or deployment occurred. Stop here for user review.

## Local commit scope

The intended local checkpoint includes only the following reviewed changed paths (including deletions and neutral renames). Docker and ignore-file changes are excluded. Historical audit inventories above describe the broader working tree, not this commit scope.

```text
README.md
TESTING_AND_VALIDATION.md
backend/app/detailed_report.py
backend/app/document_actions.py
backend/app/evidence_models.py
backend/app/evidence_package.py
backend/app/investigation_support.py
backend/app/main.py
backend/app/muse_actions.py
backend/app/muse_tools.py
backend/app/nemotron_action.py
backend/app/nemotron_engine.py
backend/app/providers/__init__.py
backend/app/providers/base.py
backend/app/providers/factory.py
backend/app/providers/meta.py
backend/app/providers/muse.py
backend/app/providers/nemotron.py
backend/app/registry.py
backend/app/vision_support.py
backend/app/vision_verifier.py
backend/tests/run_copilot_offline.py
backend/tests/run_phase0a_checks.py
backend/tests/test_copilot_workflows.py
backend/tests/test_detailed_report.py
backend/tests/test_document_actions.py
backend/tests/test_evidence_package.py
backend/tests/test_factory_wiring.py
backend/tests/test_forensic_output_quality.py
backend/tests/test_forensic_report_pdf.py
backend/tests/test_investigation_support.py
backend/tests/test_meta_provider.py
backend/tests/test_meta_reasoning_migration.py
backend/tests/test_meta_vision_migration.py
backend/tests/test_muse_demo.py
backend/tests/test_muse_only.py
backend/tests/test_muse_tools.py
backend/tests/test_nemotron_action.py
backend/tests/test_nemotron_engine.py
backend/tests/test_pdf_retrieval_stabilization.py
backend/tests/test_phase_3_1.py
backend/tests/test_provider_parity.py
backend/tests/test_report_history.py
backend/tests/test_temporal_consumers.py
backend/tests/test_vision_verifier.py
backend/tests/test_voice_provider.py
docs/MUSE_ONLY_MIGRATION_VERIFICATION.md
docs/MUSE_ONLY_RELEASE_READINESS.md
frontend/components/dashboard/DashboardConsole.tsx
frontend/components/dashboard/ForensicEvidenceExperience.tsx
frontend/components/dashboard/IncidentResponse.tsx
frontend/components/dashboard/MuseCenter.tsx
frontend/components/dashboard/NemotronCenter.tsx
frontend/components/dashboard/SecondaryViews.tsx
frontend/components/dashboard/SwarmLogsView.tsx
frontend/components/layout/Sidebar.tsx
frontend/components/muse/MuseDocumentWorkspace.tsx
frontend/context/ActivityContext.tsx
frontend/lib/api.ts
frontend/lib/types.ts
frontend/tests/test_addendum_workflow.mjs
frontend/tests/test_dashboard_refinement.mjs
frontend/tests/test_detailed_report_integration.mjs
frontend/tests/test_forensic_evidence_experience.mjs
frontend/tests/test_investigation_integration.mjs
frontend/tests/test_muse_action_integration.mjs
frontend/tests/test_muse_workflows.mjs
frontend/tests/test_nemotron_action_integration.mjs
```

Deliberately excluded and preserved unstaged:

- `frontend/Dockerfile`: require explicit frontend API build URL.
- `backend/.dockerignore`: broaden environment/Git/log context exclusions.

No `.gitignore` edits were pending. No environment files, credential values, local storage, recordings, generated reports, build outputs or private files are selected. Whitespace and secret checks precede staging; the exact staged set is checked again before committing. No push is authorized.
