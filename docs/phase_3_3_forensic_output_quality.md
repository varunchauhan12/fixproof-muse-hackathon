# FixProof Phase 3.3 — Forensic Output Quality Validation Report

## Executive Summary

FixProof is an evidence-grounded copyright investigation platform designed for sports media and live broadcast rights holders. This validation phase audited and hardened the forensic pipeline across both FixProof repositories (`~/projects/FIXPROOF` and `~/projects/fixproof-muse-hackathon`) to eliminate false confidence, low-entropy metric leakage, silent failure states, and session isolation gaps prior to the NVIDIA demo.

All heuristic scores are uncalibrated visual feature distances, not legal probabilities of infringement. FixProof produces non-adjudicative forensic evidence packages that assist rights holders and legal investigators.

---

## 1. Scoring Pipeline and Metric Calibration

### Architecture of the Visual Comparison Pipeline
The multi-layer forensic detection pipeline operates across three distinct evaluation tiers:

1. **Layer 1: Deep Visual Embeddings (MobileNetV3 + FAISS L2 Search)**
   - Pretrained MobileNetV3 feature extractor computes 1024-dimensional normalized embeddings for every sampled frame ($t \in [0, 5, 10, \dots]$ seconds).
   - FAISS L2 Euclidean distance index searches for nearest reference vectors.
   - **Distance Interpretation:**
     - $L2 \in [0.0, 0.55)$: Candidate match threshold (`MATCH_THRESHOLD = 0.55`).
     - $L2 \in [0.55, 0.75)$: Proximity suspect threshold (`SUSPECT_THRESHOLD = 0.75`).
     - $L2 \ge 0.75$: Unrelated / noise floor.
   - Heuristic percentage mapping:
     $$\text{Visual Similarity} = \begin{cases} 
     100.0 - (L2 / 0.55) \times 20.0 & \text{if } L2 \le 0.55 \\
     80.0 - ((L2 - 0.55) / 0.20) \times 30.0 & \text{if } 0.55 < L2 \le 0.75 \\
     \max(0.0, 50.0 - ((L2 - 0.75) / 0.75) \times 50.0) & \text{if } L2 > 0.75 
     \end{cases}$$

2. **Layer 2: Perceptual Hashing Cross-Check (pHash)**
   - 64-bit Discrete Cosine Transform (DCT) based perceptual hash computed on suspect and nearest reference candidate.
   - Hamming distance $< 10$ bits qualifies as `phash_match = True`.
   - Raw metrics preserved: `l2_distance`, `hamming_distance` (preserved as `phash_distance`), `phash_score` ($0-100$).

3. **Layer 3: Shannon Entropy Filter (Blank & Low-Information Detection)**
   - Shannon entropy $H = -\sum_{i} p_i \log_2(p_i)$ calculated on grayscale pixel histogram.
   - Images with $H < 1.5$ (e.g. solid black broadcast fades, bumpers, solid graphics) are flagged with `low_entropy_flag = True`.
   - **Critical Vulnerability Fixed:** Solid black frames previously produced FAISS $L2 \approx 0.02$ against other black frames in the reference library. While `match_confirmed` was prevented, `lowest_l2_distance` and `highest_confidence` previously ingested the low-entropy frame, turning clean videos into `overall_status = "SUSPECT"` with 98% visual similarity.
   - **Remediation:** Low-entropy frames have `visual_similarity_score` and `confidence_score` zeroed out ($0.0$), `severity` set to `"INFO"`, and `similarity_status` set to `"NO_MATCH"`. Only non-low-entropy frames contribute to `highest_confidence`, `lowest_l2_distance`, `candidate_matches_found`, and `matched_asset_ids`.

### Heuristic Disclaimer Notice
Every API response and evidence package embeds:
> **Notice:** Visual similarity measurements are uncalibrated heuristic computer vision metrics and do NOT represent legal probabilities of copyright infringement.

---

## 2. Deterministic Test Suite and Scenarios

A comprehensive deterministic test suite was added in `backend/tests/test_forensic_output_quality.py`, exercising 11 forensic edge cases using deterministic synthetic imagery:

| Test Case | Description | Measured Input Metrics | Expected Output Verdict | Actual Outcome | Status |
|---|---|---|---|---|---|
| **Case 1** | Identical Frames | Suspect = Reference ($H > 4.0$) | $L2 \le 0.001$, pHash diff $= 0$, Conf $= 100\%$ | `CANDIDATE_MATCH`, Heuristic Notice preserved | Passed |
| **Case 2** | Resized & Re-encoded | 640x480 $\to$ 240x180, JPEG Q=30 | $L2 < 0.55$, pHash diff $< 15$, Conf $\ge 80\%$ | `CANDIDATE_MATCH`, Confirmed | Passed |
| **Case 3** | Mild Crops / Transforms | 8% border crop & brightness shift | $L2 < 0.75$, Conf $> 50\%$ | `SUSPECT` / `CANDIDATE_MATCH` | Passed |
| **Case 4** | Unrelated Frames | Distinct patterns ($H > 4.0$) | $L2 = 1.03 > 0.85$, pHash diff $> 25$ | `CLEAN`, `NO_MATCH`, matches $= 0$ | Passed |
| **Case 5** | Blank / Low-Entropy | Solid black frame vs black frame | Entropy $0.0 < 1.5$, `low_entropy_flag = True` | `CLEAN`, Conf $= 0.0\%$, $L2 = \text{None}$ | Passed |
| **Case 6** | Missing Reference Frame | Indexed vector, frame deleted on disk | Local & cloud retrieval unavailable | `UNVERIFIED`, `VERIFICATION_UNAVAILABLE` | Passed |
| **Case 7** | Missing Suspect Frame | Frame path unreadable on disk | Local file missing during verification | `UNVERIFIED`, `VERIFICATION_UNAVAILABLE` | Passed |
| **Case 8** | Empty Reference Vault | Zero vectors in FAISS vault | Vault `ntotal == 0` | `NO_REFERENCE_DATA`, matches $= 0$ | Passed |
| **Case 9A** | Vision Provider Timeout | Mock `TimeoutError` after 15s | Provider request timeout | `UNVERIFIED`, `VERIFICATION_UNAVAILABLE` | Passed |
| **Case 9B** | Malformed Non-JSON | Model returns unstructured text | JSON parser exception | `UNVERIFIED`, `FAILED` | Passed |
| **Case 9C** | Schema Key Violation | Model returns invalid schema dict | Missing forensic schema fields | `UNVERIFIED`, `SCHEMA_VIOLATION` | Passed |
| **Case 9D** | Missing API Key | `NEBIUS_API_KEY=""` | Provider configuration missing | `UNVERIFIED`, `VERIFICATION_UNAVAILABLE` | Passed |
| **Case 10A**| URL Single-Thumbnail | 1 static thumbnail candidate | Single thumbnail evaluation mode | `SINGLE_FRAME_PRELIMINARY`, `NEEDS_FULL_VIDEO_REVIEW` | Passed |
| **Case 10B**| URL Multi-Preview | 3 candidate preview thumbnails | Multi-frame thumbnail mode | `MULTI_FRAME_PREVIEW_SCREENING`, 3 frames | Passed |
| **Case 10C**| URL SSRF Defense | Loopback, 169.254.169.254, RFC1918 | SSRF validator blocks unsafe IPs | `SSRFValidationError` raised | Passed |
| **Case 11** | Temporal Clustering | 3 contiguous + 1 black + 1 other | Continuous interval spanning frames 0-2 | `CONTINUOUS_MATCH` (3 frames), low-entropy excluded | Passed |

---

## 3. Nemotron Multimodal Vision Verification

### Dual Model Pipeline Architecture
1. **Multimodal Vision Verifier:** `nvidia/Nemotron-3.5-Super-VL`
   - Invoked exclusively for top $\le 3$ candidate evidence pairs meeting CV thresholds ($L2 < 0.75$ and not low-entropy).
   - Images preprocessed to bounded max dimension ($512\times 512$) preserving aspect ratio.
   - Cache key computed using SHA-256 over suspect JPEG bytes, reference JPEG bytes, model ID, and `PROMPT_VERSION` (`v1.1-forensic`).
   - Strict JSON schema enforced:
     ```json
     {
       "visual_correspondence": "HIGH_CORRESPONDENCE" | "POSSIBLE_REUSE" | "UNRELATED_SCENE" | "UNVERIFIED",
       "confidence_assessment": "HIGH" | "MODERATE" | "LOW" | "INCONCLUSIVE",
       "matching_features": ["..."],
       "contradictions": ["..."],
       "reasoning": "...",
       "uncertainty_factors": ["..."]
     }
     ```
   - Any schema violation or non-JSON output now cleanly produces `validation_status = "SCHEMA_VIOLATION"` or `"FAILED"`, preventing unvalidated model responses from looking verified.

2. **Forensic Reasoning Engine:** `nvidia/Nemotron-3_5-Lightning`
   - Receives strictly typed, validated `InvestigationInput` (containing measured MobileNetV3 distances, pHash evidence, temporal intervals, and vision verification summaries).
   - Operational system prompt explicitly constrains the model to cite only verified interval IDs and evidence IDs.
   - Distinguishes measured computer vision metrics from multimodal visual correspondence.
   - Disclaims legal infringement determinations.

---

## 4. Evidence Package & PDF Summary Fixes

### Manifest and Version Traceability
Exported ZIP evidence packages (`/api/threats/evidence-package/{incident_id}`) include:
- `manifest.json`: Cryptographic manifest containing SHA-256 digests of all package files, incident ID, report ID, report version, timestamp, and metadata.
- `report.json`: Full structured JSON report.
- `report_summary.pdf`: Printable forensic investigation report with Ed25519 digital signature.
- `frames/`: Extracted suspect frames and matched reference frames.

### PDF Report Alignment
Audited and resolved a key mismatch between `evidence_models.py` and `evidence_package.py`:
- `target_asset` fallbacks added for `submitted_asset_id` and `incident_id`.
- Interval table columns updated to read `duration_sec`, `suspect_start_sec`, `suspect_end_sec`, `source_start_sec`, `source_end_sec`, and `continuity_status`.
- Finding item statements updated to read `category` and `statement`.
- Generated PDFs now render complete findings and intervals without empty text or 0.0s durations.

---

## 5. URL Screening Behavior and SSRF Defenses

1. **Strictly Non-Downloading:**
   - Evaluates only public video metadata and discovered static preview images (e.g. YouTube `/hqdefault.jpg`, storyboard sprite sheet keyframe tiles).
   - Never downloads full third-party video bitstreams, respecting platform terms of service and bandwidth bounds.
2. **SSRF Protections (`validate_url_for_ssrf`):**
   - Blocks loopback targets (`127.0.0.1`, `localhost`, `::1`).
   - Blocks cloud instance metadata endpoints (`169.254.169.254`, `metadata.google.internal`).
   - Blocks private RFC1918 networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
   - Blocks non-HTTP protocols (`file://`, `ftp://`, `gopher://`).
   - Validates all HTTP redirect targets iteratively up to 5 hops.
3. **Disclosure of Limitations:**
   - Preliminary URL screenings explicitly carry the recommendation: `NEEDS_FULL_VIDEO_REVIEW`.
   - Screening disclaimers state that thumbnail analysis cannot establish continuous video correspondence.

---

## 6. Multi-Session Isolation and Security Findings

### Current Session Model
- Clients supply an `X-Client-Session-ID` HTTP header (UUID v4 generated by the browser and stored in `localStorage`).
- In cloud mode:
  - If `session_id` is provided: queries filter by `WHERE (session_id = %s OR session_id = 'demo-showcase')`.
  - If `session_id` is NOT provided: queries filter by `WHERE (session_id IS NULL OR session_id = 'demo-showcase')`.
- Endpoints `GET /api/threats/incidents/{incident_id}`, `POST /api/threats/investigate/{incident_id}`, `GET /api/threats/reports/{incident_id}/latest`, `GET /api/threats/reports/{incident_id}/history`, and `GET /api/threats/evidence-package/{incident_id}` verify session ownership and return `403 Forbidden` if an incident belongs to another private session.

### Security Audit Findings & Risks
1. **Session ID is Untrusted Identifier, Not Authentication:**
   - The browser-supplied session ID is arbitrary and unauthenticated. A user who guesses or discovers another session ID could pass it in the `X-Client-Session-ID` header.
   - *Status:* Documented limitation. True cryptographic authorization requires user accounts and JWT verification (Supabase Auth).
2. **Backend Service Role Key Usage:**
   - The FastAPI backend connects to Supabase PostgreSQL using connection pooling credentials and bypasses Row Level Security (RLS) for server-side pipeline tasks.
   - Filtering is enforced in application SQL queries rather than at the database RLS layer.
   - *Status:* Working as intended for backend pipeline services; isolation is enforced via parameterized backend queries.
3. **Public Showcase Isolation:**
   - Pre-seeded showcase incidents use `session_id = 'demo-showcase'`.
   - Users cannot overwrite or delete showcase assets without admin privileges.

---

## 7. Synchronized Repositories and Validation Results

All shared changes have been validated and ported across both repositories:
- `~/projects/FIXPROOF` (NVIDIA Nemotron platform)
- `~/projects/fixproof-muse-hackathon` (Meta hackathon platform)

### Full Backend Test Suite Execution Results
- `tests/test_forensic_output_quality.py`: **11/11 tests passed** (OK)
- `tests/test_matcher.py`: **7/7 tests passed** (OK)
- `tests/test_vision_verifier.py`: **6/6 tests passed** (OK)
- `tests/test_url_screener.py`: **20/20 tests passed** (OK)
- `tests/test_nemotron_engine.py`: **16/16 tests passed** (OK)
- `tests/test_evidence_package.py`: **15/15 tests passed** (OK)
- `tests/test_phase_3_1.py`: **8/8 tests passed** (OK)
- `tests/test_threat_scan.py`: **11/11 tests passed** (OK)
- `tests/test_report_history.py`: **7/7 tests passed** (OK)
- `tests/test_playback_sync.py`: **2/2 tests passed** (OK)
- `tests/test_vault.py`: **11/11 tests passed** (OK)
- `tests/test_vault_assets.py`: **6/6 tests passed** (OK)
- **Frontend Next.js Build:** Compiled successfully with 0 errors.
