# META MIGRATION INVESTIGATION — Nemotron → Meta Models

Investigation date: 2026-11-01. Scope: `~/projects/fixproof-muse-hackathon` (FixProof Meta).
Status: investigation only — no code changed, no live API calls made, no credits consumed.

## 1. Executive summary

FixProof Meta's AI surface is six operations: pairwise vision verification, investigation
report generation, `/diagnose`, copyright/revenue-share draft polishing, detailed-report
synthesis, and (non-AI) gated email dispatch. All AI traffic today uses one integration:
the OpenAI Python SDK pointed at Nebius Token Factory (`https://api.tokenfactory.nebius.com/v1/`)
with `NEBIUS_API_KEY`. Models in production use: `nvidia/Nemotron-3.5-Super-VL` (vision),
`nvidia/Nemotron-3_5-Lightning` (reasoning default), `nvidia/nemotron-3-super-120b-a12b`
(detailed reports, Lightning fallback).

Meta's official replacement surface is the **Meta Model API** (`https://api.meta.ai/v1`),
which is OpenAI-compatible and documents Chat Completions / Responses / Messages protocols,
structured (JSON-Schema) output, multi-image understanding, video understanding, speech-to-text,
and SAM media segmentation, authenticated by a Bearer `MODEL_API_KEY`. Because the wire format
matches the existing client, migration is an adapter/base-URL/model-ID change behind the existing
Phase 0A provider interfaces — not a rewrite. SAM 3.1 is additionally available as open weights
(`facebook/sam3.1`, Hugging Face) and through the Model API's segmentation capability.

Blockers before implementation: (1) no investigation file containing an actual Meta key was found
in the repository — only placeholder values in `backend/.env.example`; (2) the placeholder model
ID `meta-models/muse-spark-open` does not match the documented API model IDs
(`muse-spark-1.1/1.2/1.3`), so the intended access path (API vs open weights vs Nebius-hosted)
must be confirmed; (3) API access sufficiency can only be verified by an authorized live test.

## 2. Complete Nemotron call-site inventory

Production call sites (verified by reading the files):

| File | Role | Nebius dependency |
|---|---|---|
| `backend/app/vision_verifier.py` | Pairwise image verification (`verify_candidate_pair`) | `openai.OpenAI` → `NEBIUS_BASE_URL`, `NEBIUS_API_KEY`, `VISION_MODEL_ID=nvidia/Nemotron-3.5-Super-VL`, 15s timeout, `json_object`, base64 512px JPEG, max 3 pairs |
| `backend/app/nemotron_engine.py` | Investigation report (`generate_nemotron_report`) | OpenAI SDK, `NEBIUS_MODEL` default `nvidia/Nemotron-3_5-Lightning`, allowlist {Lightning, Super-VL}, 90s timeout, `json_object`, temp 0.1, error taxonomy |
| `backend/app/providers/nemotron.py` | Provider adapters (vision delegates to verifier; reasoning delegates to engine; `create_text_completion` for `/diagnose`) | Delegates only; no direct config |
| `backend/app/main.py:1178` | `POST /diagnose` — debug assistant completion | Via `NemotronReasoningProvider.create_text_completion` with explicit `OpenAI(**client_options)` |
| `backend/app/nemotron_action.py` | Copyright notice + revenue-share drafts (deterministic templates + optional Nebius polish) | Nebius polish call; sending via Resend gated by dual confirmation (not AI) |
| `backend/app/detailed_report.py` | Detailed report synthesis | `DETAILED_REPORT_MODEL=nvidia/nemotron-3-super-120b-a12b`, fallback `nvidia/Nemotron-3_5-Lightning`, via engine pathway |
| `backend/app/matcher.py`, `backend/app/url_screener.py` | CV matching; URL screening | No direct Nebius config — call `vision_verifier.verify_candidate_pair` (matcher + screener, max 3 pairs) |
| `backend/app/providers/factory.py` | Provider selection via `FIXPROOF_AI_PROVIDER` (default `nemotron`) | Registers `nemotron` + `muse` providers |
| `backend/app/providers/muse.py` | Muse scaffold | `MuseVisionProvider` / `MuseReasoningProvider` raise `NotImplementedError`; model IDs `meta-llama/Llama-Vision-Free`, `meta-llama/Llama-3.3-70B-Instruct` (placeholder strings, no endpoint/auth code) |
| `backend/app/test_nubius.py` | Ad-hoc manual connectivity probe | Test-only, not production |

Environment variables read in production: `NEBIUS_API_KEY`, `NEBIUS_MODEL`, `NEBIUS_BASE_URL`,
`NEBIUS_TIMEOUT_SEC`, `NEBIUS_MAX_TOKENS`. Documented but never read: `MUSE_API_KEY`,
`MUSE_BASE_URL` (placeholder `https://api.muse.example.com/v1`), `MUSE_MODEL`
(`meta-models/muse-spark-open`) — all only in `backend/.env.example`.

## 3. Current provider architecture

The Phase 0A boundaries are already correct and are preserved:

```text
Production callers (main.py, matcher.py, url_screener.py, nemotron_action.py, detailed_report.py)
  → provider interfaces (providers/base.py: BaseVisionProvider, BaseReasoningProvider)
    → NemotronVisionProvider / NemotronReasoningProvider (providers/nemotron.py)
      → vision_verifier.py / nemotron_engine.py (OpenAI SDK → Nebius)
```

Key properties: callers depend on the interface and on module-level functions, not on Nebius
directly (except `/diagnose`, which uses the reasoning provider's `create_text_completion`).
`NemotronVisionProvider.verify_candidate_pair` already normalizes failures to the
`UNVERIFIED` contract, so a Meta provider can mirror that behavior exactly.

Operation mapping (verified against code):

| Operation | Trigger / module | Input | Nebius receives | Output contract | On failure |
|---|---|---|---|---|---|
| Vision verification | `matcher.analyze_asset_matches`, `url_screener.screen_video_url` | 2 PIL images + timestamps + asset id (≤3 pairs) | Chat completion, 2 base64 JPEG (512px, q85), `json_object`, 2048 max tokens, 15s | JSON: `visual_correspondence`, `confidence_assessment`, `matching_features[]`, `contradictions[]`, `reasoning`, `uncertainty_factors[]`, `validation_status`, `model_id`, `verified_at` | Returns `UNVERIFIED` + `INCONCLUSIVE` + `VERIFICATION_UNAVAILABLE`; SHA-256 pair cache (memory + disk/cloud + `vision_verifications` table) |
| Investigation report | `POST /api/threats/{id}/investigate` → `generate_nemotron_report` | Timeline clusters + evidence IDs | Chat completion (system+user), `json_object`, temp 0.1, ≤16384 tokens, 90s | `InvestigationReport` (findings must cite valid evidence IDs); persisted to `nemotron_reports` | Failed report with taxonomy: `API_TIMEOUT / RATE_LIMIT / CONNECTION_ERROR / PROVIDER_API_ERROR / CLIENT_INITIALIZATION_ERROR` |
| Diagnose | `POST /diagnose` | Free-text request via provider `create_text_completion` | Chat completion (explicit unpooled client) | Pass-through completion | Exception surfaces to caller |
| Draft polishing | `/api/nemotron/draft-document` | Incident facts → deterministic template | Optional Nebius polish of template draft | Draft document | Template retained (polish optional) |
| Detailed report | `/api/nemotron/detailed-report` | Evidence bundle | Reasoning call, `nvidia/nemotron-3-super-120b-a12b` (fallback Lightning) | Detailed report JSON/PDF (disk-only today) | Fallback model |
| Email dispatch | `/api/nemotron/send-email` | Draft + dual confirmations | Not AI (Resend API) | Audit entry | Blocked without confirmations |

## 4. Official Meta API and Muse capability research

Primary source: Meta Model API documentation at `dev.meta.ai/docs` (accessed 2026-11-01) and
Meta AI's SAM 3 announcement at `ai.meta.com/blog/segment-anything-model-3` (accessed 2026-11-01).

**Meta Model API (officially documented):**
- Base URL `https://api.meta.ai/v1`; protocols: Chat Completions (`POST /v1/chat/completions`),
  Responses, Messages — OpenAI-compatible, so the existing `openai` SDK integration pattern applies.
- Authentication: `Authorization: Bearer $MODEL_API_KEY`; keys issued from the Model API dashboard.
- Models listed: `muse-spark-1.1`, `muse-spark-1.2`, `muse-spark-1.3` (+ contributor variants),
  plus `muse-spark-open` documented as an open-weight model (self-hosting docs: get-the-model,
  prompting, settings, deployment, hardware platforms).
- Capabilities documented: structured output via JSON Schema (`json_schema` response format;
  `strict` flag controls server-side schema validation; recursive schemas rejected with HTTP 400),
  image understanding (multiple images per request via several `image_url` items; public URLs,
  base64 `data:` URLs, or Files API `file_id`), video understanding, speech-to-text, image
  generation, media segmentation (SAM), tool calling/search, prompt caching, token counting.
- Pricing/rate-limits page exists (per-1M-token input/output pricing, per-image and per-frame
  media rates, RPM/TPM headers). Exact per-model figures were partially legible; per-model mapping
  of the extracted rates is UNVERIFIED (see §9).

**SAM 3.1 (officially documented):** Released 2026-03-27 (ai.meta.com/blog). Open checkpoint
`facebook/sam3.1` on Hugging Face; codebase `facebookresearch/sam3`. Text/concept/box/point
prompts, masks + boxes, video tracking (up to 16 objects per forward pass in 3.1 multiplex).
Also exposed through the Model API's media-segmentation capability with the same prompt types;
boxes/masks map onto original frames; results can vary slightly between runs.

**Not verified (do not assume):** per-model context limits and max output tokens for each
`muse-spark-*` ID; image count/resolution caps; video duration/frame caps; whether the
provided key (not yet located) grants API access vs open-weights-only; EU/region availability
(secondary sources describe a US-developer public preview, unconfirmed for this account). The repo's placeholder
`meta-models/muse-spark-open` and `https://api.muse.example.com/v1` are NOT the documented
API identifiers (`muse-spark-1.3` etc. at `https://api.meta.ai/v1`).

## 5. Model-selection matrix

| FixProof operation | Current Nemotron model | Recommended Meta model | Input compatibility | Output compatibility | Required adaptation | Confidence |
|---|---|---|---|---|---|---|
| Vision pair verification | `nvidia/Nemotron-3.5-Super-VL` (Nebius) | Muse Spark (`muse-spark-1.3`) image understanding | High — multi-image `image_url` items, base64 data URLs documented | JSON via `json_object`/`json_schema` documented | Prompt/format mapping; enforce schema; preserve UNVERIFIED mapping | Medium-high (format verified; verification quality unverified) |
| Investigation report | `nvidia/Nemotron-3_5-Lightning` | Muse Spark (`muse-spark-1.3`) reasoning | High — text chat completions | JSON object documented; evidence-ID citation is prompt-enforced (app-side) | Prompt re-validation; token budget mapping (16384 cap → model limit UNKNOWN) | Medium-high |
| `/diagnose` | `nvidia/Nemotron-3_5-Lightning` | Muse Spark (`muse-spark-1.3`) | High — pass-through completion | Pass-through | None beyond client swap | High |
| Draft polishing | Nebius polish over templates | Muse Spark (`muse-spark-1.3`) | High — text | Text | Keep templates; polish optional | High |
| Detailed report synthesis | `nvidia/nemotron-3-super-120b-a12b` (fallback Lightning) | Muse Spark (`muse-spark-1.3`) | High — long-form text | Structured report JSON | Context-limit check (UNKNOWN); length management | Medium |
| SAM segmentation lens (new) | None (does not exist) | SAM 3.1 via Meta Model API media segmentation (or open weights `facebook/sam3.1`) | Text/box/point prompts; masks + boxes | Requires new adapter + mask storage | New module; not a replacement | Medium (API documented; evidence-grade calibration unverified) |
| Video/multiframe (future) | Frame-bundle via Super-VL | Muse Spark video understanding | Documented capability | Structured analysis | Frame-bundle vs native-video decision | Low-medium (caps unverified) |
| Speech (future) | None | Model API speech-to-text (documented) | Audio | Transcript | New feature wiring | Low (details unverified) |

Why Muse Spark for all current LLM ops: single OpenAI-compatible surface with documented
structured output and multi-image input; operation shapes are unchanged, so one provider with
two adapters (reasoning/vision) suffices. SAM is a separate adapter only when the lens ships.

## 6. Input/output contract preservation

Non-negotiable (must not change): all provider-interface signatures in `providers/base.py`;
vision JSON keys and enum values (`visual_correspondence`, `confidence_assessment`,
`validation_status`, statuses incl. `UNVERIFIED`/`VERIFICATION_UNAVAILABLE`); report
`InvestigationReport` schema and evidence-ID citation rule; error taxonomy strings;
50MB/13-extension upload rules; session scoping (`X-Client-Session-ID`, 403 mismatch);
`nemotron_reports` / `vision_verifications` persistence columns (`model_id`, `prompt_version`,
tokens, latency); frontend assumptions (API routes and response shapes unchanged).

Meta differences requiring adaptation: (1) response-format mapping — Nebius `json_object`
vs Meta `json_schema` (preferred) — keep parsing lenient either way; (2) image input —
already base64 `data:` URLs, directly compatible; multi-image order must be suspect-then-reference
as today; (3) token ceilings — `NEBIUS_MAX_TOKENS` 16384 and vision 2048 need re-validation
against Muse limits (UNKNOWN); (4) cache keys must include `model_id` so Nemotron-era cached
verifications never satisfy Meta provider requests; (5) timeouts — keep 15s vision / 90s
reasoning defaults initially; retry/backoff does not exist today and should stay absent in
the migration phase to preserve failure semantics, then be added deliberately later.

## 7. Provider migration architecture

Smallest safe shape — no caller rewrites:

```text
Existing callers (unchanged)
  → providers/base.py (unchanged interfaces)
    → MetaVisionProvider / MetaReasoningProvider (NEW, providers/meta.py)
      → shared MuseClient (Bearer MODEL_API_KEY → https://api.meta.ai/v1, Chat Completions)
    → NemotronVisionProvider / NemotronReasoningProvider (RETAINED, default until cutover)
```

- Selection: `FIXPROOF_AI_PROVIDER=muse|nemotron` via `providers/factory.py`; one variable,
  one provider — no mixing (client validates its own env at construction).
- Config: `MUSE_API_KEY` (align with documented `MODEL_API_KEY` naming — decision needed),
  `MUSE_BASE_URL=https://api.meta.ai/v1`, `MUSE_VISION_MODEL=muse-spark-1.3`,
  `MUSE_REASONING_MODEL=muse-spark-1.3`, `MUSE_TIMEOUT_SEC`, `MUSE_MAX_TOKENS`.
  Placeholder values in `.env.example` must be corrected to these documented identifiers.
- Normalization: Meta responses converted to the exact FixProof JSON contracts inside the
  adapters (including UNVERIFIED synthesis on any failure), identical to `providers/nemotron.py`.
- Muse Spark Open self-hosting is the fallback if API access is insufficient: same adapter,
  different base URL (deploy specifics UNVERIFIED).

## 8. Environment variable and secret requirements

New: `MUSE_API_KEY` (or `MODEL_API_KEY` — pick one), `MUSE_BASE_URL`, `MUSE_VISION_MODEL`,
`MUSE_REASONING_MODEL` (+ optional `MUSE_TIMEOUT_SEC`, `MUSE_MAX_TOKENS`). Retained during
transition: all `NEBIUS_*`, `SUPABASE_*`, `RESEND_API_KEY`, `FIXPROOF_SIGNING_KEY_*`,
`FIXPROOF_DB_MODE`. Secret Manager: add the Meta key under its chosen name; never in
`NEXT_PUBLIC_*`; never committed. The secret investigation file referenced in the task brief
was **not found** in the repository (only placeholder values in `backend/.env.example`);
no key value was read, printed, or copied anywhere. Until the file is provided, intended
access (API vs open weights) cannot be confirmed without an authorized live test.

## 9. Cost, performance, reliability comparison

Official pricing page exists (dev.meta.ai/docs/pricing-rate-limits) with per-1M-token input/output
rates and media add-ons; extracted fragments ($0.01/image, $0.20/1000 frames, per-1M rates) could
not be reliably bound to specific model IDs from the rendered page — treat all figures as
UNVERIFIED until confirmed at the dashboard. Reliable statements today:
- Nemotron (Nebius): per-token billing, proven at current volume (≤3 vision pairs + ≤2 reasoning
  calls per incident; pair cache suppresses repeats).
- Meta Model API: same call shape; vision stays 1 call/pair with cache; reports 1 call (90s budget).
  Latency comparable in class; rate limiting via RPM/TPM response headers (values account-specific).
- Hackathon defaults: keep MAX_CANDIDATE_PAIRS=3, keep caches keyed per model, keep 512px images;
  batch nothing new; avoid native-video calls until frame/price caps are confirmed.

## 10. Migration stages (plan only — not executed)

- **Stage A — Foundation:** add `providers/meta.py` + `MuseClient` + factory registration +
  config docs; Nemotron stays default. Gate: mocked contract tests (tests-only change set).
- **Stage B — Reasoning:** report, `/diagnose`, draft polish, detailed report behind
  `FIXPROOF_AI_PROVIDER=muse` locally; schema-equality tests vs golden Nemotron fixtures.
- **Stage C — Vision:** matcher + url-screener verification via Meta provider; same-image
  agreement study vs Nemotron on fixtures; UNVERIFIED fail-open preserved.
- **Stage D — Validation:** full backend suite + mocked provider tests; frontend workflow smoke;
  only then an authorized live connectivity check (single low-cost call, user-approved).
- **Stage E — Deployment prep:** Secret Manager name, `.env.example` correction, runbook;
  deploy only on explicit instruction (none here).

Rollback: `FIXPROOF_AI_PROVIDER=nemotron` (one env var, no code change); Nemotron adapters and
Nebius secrets retained through one dual-run release; per-model cache keys prevent cross-provider
contamination either direction.

## 11. Regression testing strategy

Golden-fixture parity: fixed frame pairs + fixed incident bundles; assert JSON schema equality,
status enum-set equality, evidence-citation validity, and persistence-row shape under both
providers (mocked HTTP — no live keys in CI). Verdict agreement threshold for vision is a
product decision (UNKNOWN — human sign-off). Failure drills: timeout, 429, malformed JSON,
missing key → all must yield the existing UNVERIFIED/failed-report shapes.

## 12. Risks and unsupported capabilities

Hallucinated-verdict risk (new model calibration unknown); `json_object`-era prompts may need
re-tuning under `json_schema`; token/context ceilings unverified; SAM API run-to-run mask
variance documented by Meta itself (evidence overlays must record run provenance); API preview
status/region access may gate the account; `muse-spark-open` self-hosting needs GPU capacity
the deployment does not currently have.

## 13. Rollback strategy

See §10 (single env var; retained fallback; cache isolation). No data migration is introduced
by the provider swap — `nemotron_reports`/`vision_verifications` rows remain readable because
`model_id`/`prompt_version` columns already exist.

## 14. Official documentation sources (accessed 2026-11-01)

- Meta Model API docs (models, pricing/rate limits, structured output, image understanding,
  SAM overview/segmenting): https://dev.meta.ai/docs
- Meta AI, SAM 3 announcement (SAM 3.1 update 2026-03-27): https://ai.meta.com/blog/segment-anything-model-3/
- SAM 3.1 checkpoint: https://huggingface.co/facebook/sam3.1
- Secondary (verified-against-docs, not primary): promptfoo Meta provider docs
  https://www.promptfoo.dev/docs/providers/meta/ ; MarkTechPost Muse Spark 1.1 coverage (2026-07-09).
