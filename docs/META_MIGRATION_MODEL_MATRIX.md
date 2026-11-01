# META MIGRATION — MODEL MATRIX (implementation reference)

Companion to `docs/META_MIGRATION_INVESTIGATION.md` (2026-11-01). No code changed.
Selection switch: `FIXPROOF_AI_PROVIDER=muse|nemotron`. Rollback = `nemotron`.

| # | FixProof operation | Entry point | Current (Nemotron) | Target (Meta) | API interface | Adapter | Expected output contract (unchanged) |
|---|---|---|---|---|---|---|---|
| 1 | Vision pair verification | `vision_verifier.verify_candidate_pair` via matcher + url_screener | `nvidia/Nemotron-3.5-Super-VL`, base64 512px, ≤3 pairs, 15s, `json_object` | Muse Spark `muse-spark-1.3` image understanding | Meta Model API Chat Completions, multi-image `image_url` (base64 `data:`) | `MetaVisionProvider` → `MuseClient` | JSON: `visual_correspondence`, `confidence_assessment`, `matching_features[]`, `contradictions[]`, `reasoning`, `uncertainty_factors[]`, `validation_status`, `model_id`, `verified_at`; failure → `UNVERIFIED`/`VERIFICATION_UNAVAILABLE`; SHA-256 cache keyed per `model_id` |
| 2 | Investigation report | `POST /api/threats/{id}/investigate` → `nemotron_engine.generate_nemotron_report` | `nvidia/Nemotron-3_5-Lightning`, 90s, temp 0.1, `json_object` | Muse Spark `muse-spark-1.3` reasoning | Chat Completions, `json_schema` (or `json_object`) | `MetaReasoningProvider` → `MuseClient` | `InvestigationReport`; findings cite valid evidence IDs; persisted `nemotron_reports`; failure taxonomy `API_TIMEOUT/RATE_LIMIT/CONNECTION_ERROR/PROVIDER_API_ERROR/CLIENT_INITIALIZATION_ERROR` |
| 3 | Diagnose | `POST /diagnose` | Lightning via `create_text_completion` | Muse Spark `muse-spark-1.3` | Chat Completions | `MetaReasoningProvider.create_text_completion` | Pass-through completion |
| 4 | Draft polishing (copyright + rev-share) | `/api/nemotron/draft-document` | Nebius polish over deterministic templates | Muse Spark `muse-spark-1.3` | Chat Completions (text) | `MetaReasoningProvider` | Draft text; templates remain fallback; send stays dual-confirmation gated (Resend, not AI) |
| 5 | Detailed report synthesis | `/api/nemotron/detailed-report` | `nvidia/nemotron-3-super-120b-a12b` (fallback Lightning) | Muse Spark `muse-spark-1.3` | Chat Completions (long-form) | `MetaReasoningProvider` | Detailed report JSON → PDF (disk-only today); context ceiling UNVERIFIED |
| 6 | SAM lens (new, Phase 3) | New endpoint (does not exist) | — | SAM 3.1 (`facebook/sam3.1` or Model API segmentation) | Media segmentation, text/box/point prompts | New `SamLensAdapter` | Masks + boxes + provenance (run variance documented by Meta); new storage required |
| 7 | Video/multiframe (future) | — | Super-VL frame bundles | Muse Spark video understanding | Video understanding API | TBD after caps verified | Structured temporal analysis (caps UNVERIFIED) |
| 8 | Speech (future) | — | — | Model API speech-to-text | Speech-to-text API | TBD | Transcript (details UNVERIFIED) |

## Config (target)

- `MUSE_API_KEY` (or `MODEL_API_KEY` — decision pending) — Secret Manager only, never `NEXT_PUBLIC_*`.
- `MUSE_BASE_URL=https://api.meta.ai/v1`; `MUSE_VISION_MODEL=muse-spark-1.3`;
  `MUSE_REASONING_MODEL=muse-spark-1.3`; optional `MUSE_TIMEOUT_SEC`, `MUSE_MAX_TOKENS`.
- Correct `.env.example` placeholders (`api.muse.example.com`, `meta-models/muse-spark-open` are not API identifiers).

## Invariants

Interfaces in `providers/base.py` unchanged; JSON keys/enums unchanged; UNVERIFIED fail-open;
error taxonomy unchanged; upload rules unchanged; session scoping unchanged; persistence columns
(`model_id`, `prompt_version`, tokens, latency) unchanged; no caller rewrites; no Nemotron removal
until parity + one dual-run release.

## Unverified before implementation

Official per-model context/output limits; image/video caps; per-model pricing mapping;
account entitlement (investigation file with key not yet located); parity agreement threshold;
`muse-spark-open` self-host deploy path (GPU) if API access insufficient.
