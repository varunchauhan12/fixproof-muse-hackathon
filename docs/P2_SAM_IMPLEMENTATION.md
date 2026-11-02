# P2 — Separate SAM Investigation Workspace

> Follow-up: the user subsequently requested automatic labeled localization and removal of investigations from Muse Center. See [MUSE_LAYOUT_AND_AUTOMATIC_SAM.md](MUSE_LAYOUT_AND_AUTOMATIC_SAM.md) for the current UX and live verification; the initial manual workflow below is historical.
2026-11-02. Audit completed first in `P2_SAM_AUDIT.md`; implementation uses only verified repository contracts. Working tree was clean at the start of this task. No commits, pushes, deployments, schema changes or credential edits.

## What existed and what works now

The application already had the P1 CV candidate explorer, a text-prompted SAM single-image provider, grammar parser, raw masks/boxes, a generic segment endpoint, a best-match-only bulk grounding endpoint and annotated-image rendering. The parser's tracking_id is simply a copied local object ID and does not establish tracking.

The Investigation Room now has separate **CV Investigation** and **SAM Investigation** tabs sharing the incident context. CV evidence/timeline/report controls are preserved. The SAM component mounts only after first opening and remains mounted across tab switches, preserving prompt/selection/results without triggering inference.

SAM tab includes:

- Server-resolved eligible CV candidate selector, with original timestamps, per-frame rank, status, source identity, evidence ID when recorded, L2 and similarity index.
- Explicit text concept and **Start SAM Investigation** action: at most two independent image calls for the selected candidate, reference then suspect. No automatic retries, inference on selection, or all-frame loops.
- Session-aware frame fetches → blob URLs; automatic cleanup on candidate/session change/unmount. No session tokens embedded in URLs.
- Independent target status, errors, provenance, original/prepared dimensions, hash, latency and returned objects. Prompt labels are described as prompt labels, not inferred categories.
- Bounding-box visibility, keyboard/clickable per-target object selection and multiple-object inspection. SVG image and overlay share an image-sized viewBox with aspect preserved. Original dimensions AND exact image hash must agree; malformed/nonfinite/out-of-bounds/inverted/inconsistent boxes are rejected. Failed-validation outputs are not overlaid.
- Combined review of CV measurements and independent SAM observations, with explicit absence of tracking/cross-video identity/correspondence.
- Raw mask encoding/payload/decoding state preserved in the result. No unverified mask decoder, polygon or fake tracking timeline.
- CV viewer's subtle white outer highlight only when the original backend `match_confirmed` boolean is literally true. Similarity and textual status never infer the glow.

## Exact API contracts

All new routes require `X-Client-Session-ID`. Syntactically valid existing session context is required even in demo mode. Owner/demo-showcase conventions and explicitly configured demo mode remain in use; no new authentication system is introduced. Incident reads use `strict_read=True`; no registry writes are called.

1. `GET /api/sam/incidents/{incident_id}/candidates`

Returns `{ "candidates": [...] }`. Eligible records come from `best_match` + deduplicated `top_candidates`, preserving per-frame order/rank. Gate matches the existing temporal selector: finite nonnegative L2 below existing `SUSPECT_THRESHOLD`, no low-entropy flag, recorded nonnegative timestamps, valid source identity. Missing measured values stay missing. No report-synthesized candidates, guessed timestamps or manual frame injection.

Each candidate contains:

```
incident_id, candidate_id, frame_match_index, rank, evidence_id,
confirmed, status, l2_distance, visual_similarity_score,
reference: {asset_id, frame_id, filename, timestamp_sec},
suspect:   {asset_id, frame_id, filename, timestamp_sec}
```

The candidate ID is a SHA-256-derived fingerprint of incident, original array index and both exact frame associations. It is not an authentication credential. Eligibility and session are rechecked on every request; the browser cannot submit arbitrary image bytes, storage paths or source IDs here.

2. `POST /api/sam/incidents/{incident_id}/candidates/{candidate_id}`

Body: `{ "prompt": "explicit object concept" }`, trimmed 1–200 characters, extra fields rejected. No model override or force-refresh flag. Valid current cached targets are reused before any provider call; failed targets retry only on this explicit action. Missing frame bytes skip inference and return unavailable status.

Response:

```
candidate: <resolved candidate>,
targets: {
  reference: <observation>,
  suspect: <observation>
},
tracking_supported: false,
correspondence_supported: false,
cache_scope: <single-process/TTL notice>
```

Observation includes association (incident/candidate/array index/evidence/target plus frame asset/ID/filename/timestamp), status, objects, prompt, provider/model, original/prepared dimensions, image SHA-256, cache provenance, latency, rejection/truncation metadata and sanitized error where applicable. Objects preserve local IDs, labels, original boxes, validated normalized boxes, masks and optional provider confidence. `tracking_id` is intentionally excluded because it is not a verified temporal identity.

3. `GET /api/sam/incidents/{incident_id}/candidates/{candidate_id}?prompt=...`

Read-only inspection of exact current association/cache. No inference. Never-run targets return NOT_RUN; recorded failures are inspectable without retrying; unavailable source frames remain unavailable. No globally unscoped result listing.

4. `GET /api/sam/incidents/{incident_id}/candidates/{candidate_id}/frames/{reference|suspect}`

Session-authorized exact recorded frame bytes, proper detected image MIME and no-store/nosniff headers. Uses existing `load_frame_image_bytes` storage resolver, without thumbnail/timestamp-derived filename substitution. Its existing cloud resolver may populate a local cache; this behavior was not rewritten.

Existing `/api/sam/segment`, bulk `/api/incidents/{id}/sam-investigation` / sam-grounding, annotated frame endpoint, CV matching and report APIs are unchanged.

## Provider / storage / reuse

Existing MetaSAMProvider / MuseClient POST `/responses` request retained: model from `MUSE_SAM_MODEL` (default `sam-3.1`), one input_text + one input_image, stream false, existing configured timeout (90 seconds by default), no automatic retries. Only provider change adds actual original/prepared dimensions after existing aspect-preserving 1024-long-edge resize/JPEG preparation. Reasoning/vision/voice provider behavior is untouched.

Results are process-memory only: 30-minute TTL, at most 64 target outcomes. Key includes session, candidate fingerprint, configured model, exact prompt, target and original image hash. Concurrent duplicate candidate/prompt/model requests return 409; frontend shares a pending promise and blocks duplicate clicks. Successful targets are reused; sanitized failures are retained for inspection but never treated as successful cache hits. A retry can call only the failed side. Restart/worker change/expiry/eviction loses results. There is no durable Supabase SAM evidence store in this step.

Legacy best-match SAM annotations do not establish the new exact candidate/image-hash provenance. They are not silently imported, and especially never assigned to alternative candidates. The UI states this policy. There is no destructive migration or overwrite of old annotations.

## Tests and checks

Backend (from `backend`):

```
.venv/bin/python -B -m unittest tests.test_sam_workspace tests.test_sam_provider
```

**32 passed:** 19 new service/router/resize tests plus 13 existing mocked provider tests. Covers gate/empty queue, source/target/array/frame association, sessions, demo convention, alternative candidates, cache invalidation/TTL/bounds, duplicate guard, explicit partial retry, retained sanitized failures, missing images, coordinate validation, wrong canvases, real resize dimensions, request validation, frame GET and no inference on GET.

Frontend (from repository root):

```
node --test frontend/tests/test_sam_workspace.mjs frontend/tests/test_investigation_workspace.mjs frontend/tests/test_forensic_evidence_experience.mjs frontend/tests/test_floating_muse_chat.mjs
npx --prefix frontend --no-install tsc --noEmit --incremental false --project frontend/tsconfig.json
git diff --check
```

**43 passed:** actual client/component-handler tests with mocked transport/media/hooks, existing CV fixtures and floating-chat regression tests. Includes explicit action/double click, candidate state isolation, session headers, empty state, errors/retry, exact overlay geometry/hash/dimension checks, visibility and backend-only glow. No wildcard or live integration scripts were run. Unsupported mask formats are tested for honest non-decoding, not fake successful decoding. Tracking absence/target-local IDs tested; no tracking algorithm claimed.

From `frontend`:

```
npx --no-install eslint components/dashboard/SAMInvestigationWorkspace.tsx components/dashboard/ForensicEvidenceExperience.tsx components/dashboard/InvestigationWorkspace.tsx lib/sam-workspace.ts lib/forensic-evidence.ts
```

TypeScript passed. Targeted lint: zero errors, one existing advisory for native images in the CV viewer. Production build not run (not required by P2); existing Next dev server compiled the changed dashboard. Backend health 200; workspace registered as three OpenAPI paths/four operations.

## Real browser versus live provider verification

Existing frontend `http://localhost:3000/dashboard`, backend port 8000. No manual process restart. Existing development reload picked up changes.

Verified in browser with actual local incident records:

- CV and SAM tabs separate; existing CV viewer retained.
- Populated queue with 12 real eligible candidate pairs; authorized reference/suspect frames loaded at original 2560×1440 dimensions.
- Selecting alternative candidate #2 changes reference time to 5s while suspect remains 0s; previous candidate's results are not shown. No inference on selection or tab switch.
- Real clean incident with no eligible candidates shows exactly: “No CV candidate pairs are available for SAM investigation.”
- Tab switch back to CV preserves the existing confirmed selection; returning to SAM preserves its independent candidate selection.
- Mobile 390×844 check: no document horizontal overflow. Temporary viewport override reset.
- Screenshot `P2_SAM_WORKSPACE.jpg` shows actual frames and NOT-RUN state, not a fabricated SAM success.

**Live attempt:** one explicit Start action on an existing pair with prompt “person”. The UI entered its genuine waiting state. The browser tab became unavailable before the response was captured. A read-only result check did not establish a completed cached success. No automatic retry was made. Actual provider completion, returned object count, latency, entitlement and live box alignment are therefore **unverified**, not passed. Later development reloads reset process-memory results. Credentials were locally configured (availability only checked; values never printed).

Offline green tests do not establish remote provider availability or prove live SAM output compatibility. A user-supervised captured run is the remaining live verification step.

## Exact files changed

Backend:

1. `backend/app/main.py` — register new router only.
2. `backend/app/providers/sam.py` — additive actual dimension provenance.
3. `backend/app/sam_workspace.py` — new scoped queue/service/cache/validation.
4. `backend/app/sam_workspace_api.py` — new scoped routes.
5. `backend/tests/test_sam_workspace.py` — isolated tests.

Frontend:

6. `frontend/components/dashboard/ForensicEvidenceExperience.tsx` — separate tabs, preserved CV/report state.
7. `frontend/components/dashboard/InvestigationWorkspace.tsx` — explicit-confirmation white highlight.
8. `frontend/components/dashboard/SAMInvestigationWorkspace.tsx` — separate SAM workflow/viewer.
9. `frontend/lib/forensic-evidence.ts` — preserve explicit confirmation flag.
10. `frontend/lib/sam-workspace.ts` — scoped client/types/association/coordinate validation.
11. `frontend/tests/test_investigation_workspace.mjs` — confirmation highlight regression.
12. `frontend/tests/test_sam_workspace.mjs` — offline client/UI/overlay tests.

Documentation:

13. `docs/P2_SAM_AUDIT.md`.
14. `docs/P2_SAM_IMPLEMENTATION.md`.
15. `docs/P2_SAM_WORKSPACE.jpg`.

## Blocked capabilities and exact next steps

1. **Captured live validation:** open an existing eligible incident → SAM Investigation → enter an explicit object prompt → Start once; wait for both target statuses. Record sanitized outcome, latency and returned dimensions; inspect boxes/visibility/object selection. Retry only explicitly after understanding an error. Do not assume a previous uncertain request failed without cost.
2. **Mask rendering:** obtain an authoritative encoding/decompression contract and verified parser compatible with actual returned payloads; test offsets, dimensions, corruption and round-trip identity. Until then render boxes only and preserve raw masks.
3. **Tracking:** establish a supported video/multi-frame provider request/response contract, stable within-clip identities, actual frame sampling/order and bounded inference budget. Single-image object IDs cannot be linked heuristically as tracked identities.
4. **Exemplar/correspondence:** verify a supported visual-prompt/exemplar operation separately, then define uncertain cross-clip observations. Never infer physical identity from boxes or appearance alone.
5. **Durability:** if required later, design session-authorized candidate/image-hash-bound persistence using existing incident evidence storage, with explicit overwrite/version policy. Current memory cache is intentionally not a durable report artifact.
6. **Muse readiness:** future allowlisted read-only projection needs incident/session, immutable candidate + original array index, exact asset/frame IDs/filenames/timestamps/hash/dimensions, target, object-local IDs/labels, validated boxes, mask encoding/validation/decoding metadata, supported tracking observations, provider/model/prompt and validation state. Exclude raw unvalidated masks/grammar and non-evidential tracking_id. No Muse tools or grounding changes were made now.

No email, PDF/report generation, voice changes, new dependencies, database writes/migrations, cloud configuration changes, commits, pushes or deployments were performed by the workspace implementation. Protected repositories untouched.
