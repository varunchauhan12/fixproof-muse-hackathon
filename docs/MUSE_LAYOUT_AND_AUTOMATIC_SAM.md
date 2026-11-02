# Muse layout and automatic SAM follow-up

> Latest update: confirmed-only, automatic full-queue preparation and bounded parallel localization are documented in [SAM_BATCH_PERFORMANCE.md](SAM_BATCH_PERFORMANCE.md).

2026-11-02. This user-authorized change supersedes P2's initial manual-concept / explicit Start UX. All existing P1/P2 uncommitted work is preserved.

## Muse Center

- Removed the embedded ForensicEvidenceExperience entirely from NemotronCenter; CV and SAM investigation remain on Incident Response only.
- Replaced the internal 4/8-column incident-sidebar layout with a full-width incident-card list followed by a full-width selected Muse workspace. Back to incidents preserves selected draft state.
- Kept existing Muse report synthesis/history, detailed reports/PDF controls, action drafting and dispatch controls. None were executed during verification.
- Open CV / SAM investigation navigates to the existing incident page. The global application navigation remains consistent with the incident list page.
- Browser verified selection of an actual incident, full-width Muse report/action components, and the navigation handoff to the existing CV/SAM tabs.

## Automatic labeled localization

- Opening the SAM tab automatically investigates its selected eligible CV pair; selecting another pair starts that pair. Hidden/inactive SAM tabs do not start new work. No all-incident or all-frame background sweep.
- No object-concept input or Start button is required. Explicit retry remains for failures, with no automatic retry loop.
- A bounded Muse vision pass inspects the two actual images and returns up to four salient object categories per image, validated against a strict response schema. No hardcoded detected-object list or guessed boxes.
- Existing SAM single-image inference localizes each returned category independently on its own target image. At most one discovery completion plus eight SAM calls per uncached pair. Each label is a model-proposed concept localized by SAM, not an independently guaranteed taxonomy.
- Successful per-concept and aggregate results are reused by session/candidate/models/prompt/image hashes. In-flight duplicate requests are blocked; failures are remembered and require an explicit retry. Results remain process-local and expire after 30 minutes.
- Model-generated category labels appear beside returned bounding boxes and in per-target object lists. Multiple local object IDs remain scoped to category/image. Hash, dimensions, coordinate validation, raw-mask preservation and target association from P2 remain intact.
- Partial failures retain valid per-category observations with an explicit PARTIAL status. Missing categories/boxes are not invented. Tracking, physical identity across footage, exhaustive scene coverage and unsupported mask decoding are not claimed.
- Automatic discovery reuses the configured Muse vision model and existing MuseClient image-chat request format. Uses the existing vision schema_format convention and a 2048-token budget consistent with existing verification requests. No provider selection defaults or reasoning/voice architecture changes.
- Safe fixed error categories travel in X-SAM-Failure-Code, exposed to the browser. Existing global server error sanitization is preserved; no raw model responses, headers or secrets are returned as diagnostics.

## Validation

- Backend: `.venv/bin/python -B -m unittest tests.test_sam_workspace tests.test_sam_scene tests.test_sam_provider` from backend: **39 passed**.
- Frontend: `node --test frontend/tests/test_sam_workspace.mjs frontend/tests/test_investigation_workspace.mjs frontend/tests/test_forensic_evidence_experience.mjs frontend/tests/test_floating_muse_chat.mjs`: **46 passed**.
- TypeScript passed. Targeted new SAM client/workspace + investigation-room lint passed with zero errors. Muse Center has **15 pre-existing lint errors**, verified against HEAD; broad cleanup was not mixed into this layout change.
- `git diff --check` passed.
- Browser: full-width Muse list → selected report/action workspace; no embedded investigation. Its investigation link opens Incident Response with CV/SAM tabs.
- Live automatic check: initial 502 and a controlled diagnostic check are recorded in SAM_AUTOMATIC_SMOKE.json. Existing global error sanitization initially hid the category; diagnostics were made safely accessible and the request aligned with existing structured vision requests/token budget. No claim is made about an unrecorded original provider error category.
- Final controlled check: **HTTP 200, 21.71 seconds**, actual Muse Spark (`muse-spark-1.3`) discovery and SAM (`sam-3.1`) localization. Both reference and suspect returned **six validated regions**, across model-proposed labels **plate, french fry, aluminum foil, tarp**. These labels came from actual inference, not fixtures or default objects. Earlier failures were not portrayed as success.
- Live browser confirmation: both images rendered six real box overlays, with readable labels (~16px rendered height), validated original dimensions and matching content hashes. Browser-discovered categories included paper plate, french fry, aluminum foil and picnic blanket; label wording can vary across independent model runs. See SAM_AUTOMATIC_LABELS.jpg.
- Offline tests cover automatic active-tab behavior, candidate isolation, duplicate client requests, explicit failure retry, server-side bounded discovery, no default objects on empty/invalid output, target-specific label association, caching and request construction. Existing manual endpoint remains backward compatible.

## Files specific to this follow-up

- frontend/components/dashboard/NemotronCenter.tsx
- frontend/components/dashboard/ForensicEvidenceExperience.tsx (passes active-tab state)
- frontend/components/dashboard/SAMInvestigationWorkspace.tsx
- frontend/lib/sam-workspace.ts
- frontend/tests/test_sam_workspace.mjs
- backend/app/sam_scene.py (new)
- backend/app/sam_workspace.py
- backend/app/sam_workspace_api.py
- backend/tests/test_sam_scene.py (new)
- backend/tests/test_sam_workspace.py
- docs/MUSE_LAYOUT_AND_AUTOMATIC_SAM.md
- docs/MUSE_CENTER_LAYOUT.jpg
- docs/SAM_AUTOMATIC_LABELS.jpg
- docs/SAM_AUTOMATIC_SMOKE.json
- docs/P2_SAM_IMPLEMENTATION.md and docs/P2_SAM_AUDIT.md (supersession notes)

No commits, pushes, deployments, credential edits, database changes, PDFs or emails. Protected repositories untouched. The automatic workflow performs real model requests when the user opens an eligible pair's SAM tab; it does not promise to identify every object in an image.
