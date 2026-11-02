# P2 SAM audit — completed before implementation

> Follow-up: the user subsequently requested automatic labeled localization and removal of investigations from Muse Center. See [MUSE_LAYOUT_AND_AUTOMATIC_SAM.md](MUSE_LAYOUT_AND_AUTOMATIC_SAM.md) for the current UX and live verification; the initial manual workflow below is historical.
2026-11-02. Repository-only inspection; no provider inference performed during audit. Working tree was clean at task start (P1 and earlier work already committed by the user). Protected repositories untouched.

## Verified capability matrix

| Capability | Repository evidence | Status |
|---|---|---|
| Single image, explicit text concept | `providers/sam.py:MetaSAMProvider.segment_frame`, Responses HTTP payload with `input_text` + one `input_image` | Implemented; offline mocked transport tested |
| Multiple objects / boxes | `parse_sam_grammar`, `sam_models.py:SegmentedObject/BoundingBox`, multi-object unit fixture | Implemented; offline tested |
| Labels | Parser assigns the user prompt as each object's label | Prompt label, not independently inferred class taxonomy |
| Masks | Parses offsets/dimensions/encoding/raw base85 data; leaves RAW_PRESERVED and is_decoded=false | Payload retention implemented/tested; no verified decoder |
| Visual prompt / exemplar | No request contract or provider method exposed | Not supported by current integration; remote capability unverified |
| Video / temporal tracking | One image per request; parser copies object_id into tracking_id; no temporal linking | Not implemented; copied ID is NOT tracking evidence |
| Independent reference/suspect analysis | `temporal_selector.ground_candidate_frames_with_sam` invokes provider per image | Implemented; not object correspondence |
| Cross-video object identity/correspondence | No validated operation, identity model or association contract | Not supported by current integration |

No live inference fixture with trustworthy provenance was found in the inspected test/doc paths. `tests/test_sam_provider.py` uses explicit mocked HTTP responses and grammar strings; these do not establish remote availability or entitlement. Broader model capabilities are not inferred from the SAM name or schema comments.

## Current contracts and gaps

- `/api/sam/segment` in `main.py`: text prompt plus base64 or incident; incident lookup can fall back to first submitted frame, frame_index does not select it, target absent. Unsuitable for exact alternative-candidate investigation.
- `/api/incidents/{id}/sam-investigation` (alias sam-grounding): calls temporal selector, best matches only, up to 3 pairs / 6 single-image calls; persists annotated incident. Does not implement tracking. Existing behavior must remain intact.
- Annotated frame GET resolves original frame-match array index and best match only; optional session header, boxes rendered server-side. 200 may return an unannotated original. Cannot safely use this for alternate candidates.
- `matcher.match_frame_against_vault` emits ranked top_candidates, L2, status, source IDs/timestamp/filename/path; `temporal_selector.select_temporal_candidate_pairs` eligibility requires L2 < existing SUSPECT_THRESHOLD and no low_entropy_flag. Use this same gate, not a new score threshold. An explicit backend match_confirmed flag controls CV glow only.
- Original submitted frame index and frame-match array index differ. Filenames/timestamps must come from stored records, never guessed. Existing frame loader supports approved filesystem roots/cloud fallback and may populate local frame cache.
- Provider resizes to longest edge 1024 with aspect preserved and JPEG re-encodes. Existing result omits original/prepared dimensions: add provenance so normalized boxes can be validated against input aspect and rendered on the original image.
- Existing normalization clamps invalid coordinates; new workspace must independently reject nonfinite/inverted/out-of-range boxes and ambiguous coordinate conventions.
- Schema says proprietary mask decoding requires a parser but no verified parser is bundled. Do not install/invent one. Raw masks are retained, not rendered; bounding boxes are localization, not segmentation-mask shapes.
- Provider uses `MUSE_SAM_MODEL` (default sam-3.1), existing MODEL_API_KEY/MUSE_BASE_URL, request timeout configured through existing client (90-second default), no automatic retries. No verified video/exemplar request exists here.
- Existing stored SAM may lack candidate, source-frame, dimension or prompt provenance. Do not reuse by model/status alone or inherit best-match output for alternatives.
- Existing demo/session conventions permit demo-showcase access; new routes require a syntactically valid existing session header, then enforce owner/demo rules. This is demo session scoping, not new authentication.

## Recommended implementation

Keep CV/report/voice/provider selection behavior. Add a small dedicated SAM router/service with server-resolved eligible candidate identities, session-aware exact frame GET, explicit one-candidate/two-target POST, bounded process-local cache and in-flight deduplication. No database migration or automatic cloud persistence. Reuse stored results only when full candidate/frame/prompt/model/image provenance is verifiable; otherwise explain/recompute explicitly. Preserve raw mask data and surface decoding unavailable. Side-by-side boxes align via SVG viewBox over aspect-preserving images, with per-target object selection and provenance. No fake tracking timeline or physical-identity claims. Muse integration remains documentation only.

## Implementation findings

Implemented the audited single-image subset in a separate SAM tab with a dedicated candidate-bound router/service. CV/report/voice paths and existing SAM endpoints remain intact. No tracking/exemplar/correspondence/mask decoder was invented.

- Queue eligibility reuses the existing temporal-selector gate: finite nonnegative L2 < existing SUSPECT_THRESHOLD, no low-entropy flag, valid recorded timestamps and registered source identity. Alternatives are supported using server-resolved immutable candidate identity, not array rank alone.
- New observations retain original and provider-prepared dimensions, exact frame association and image SHA-256. Box validation rejects invalid canvases; frontend additionally requires matching original dimensions/content hash. SVG image and boxes share one coordinate plane, preventing letterbox offsets.
- Successful cached outputs are reusable for 30 minutes; sanitized failures remain inspectable but require explicit retry. Cache is single-process memory, bounded to 64 target outputs. Legacy annotations lack the new candidate/hash provenance and are deliberately not imported. No incident/database writes or migrations added.
- 32 backend tests and 43 frontend tests passed; TypeScript and targeted lint passed (one existing native-image advisory). Real browser verified candidate selection, frame retrieval, no-candidate empty state, tab separation and mobile layout.
- One explicit live pair investigation was started through the UI using the prompt “person”. The tab became unavailable before completion could be captured. A read-only cache check did not establish success; no automatic retry was made. Do not describe this as a successful live SAM validation or infer object counts from it.

See `P2_SAM_IMPLEMENTATION.md` for exact routes, file list, commands, limitations and next validation steps.
