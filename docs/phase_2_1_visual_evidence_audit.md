# FixProof — Phase 2.1: Visual Timeline & Video Evidence Audit

**Status:** Complete Audit & Architecture Specification (Implementation Plan Only)  
**Date:** October 27, 2026  
**Scope:** `~/projects/FIXPROOF` and `~/projects/fixproof-muse-hackathon`  
**Reference (Read-Only):** `~/projects/mediaguardsports`  

---

## 1. Executive Summary & Objective

Phase 2 of FixProof introduces synchronized source/suspect video playback, interactive timeline scrubbing, match markers, and evidence overlays. 

This document constitutes the **Phase 2.1 Audit and Implementation Plan**. In accordance with Phase 2.1 requirements:
- **No application code has been modified.**
- **No commits or pushes have been made.**
- **MediaGuardSports remains strictly read-only.**
- Both FixProof repositories (`FIXPROOF` and `fixproof-muse-hackathon`) remain configured on the **Nemotron-backed implementation** (no Muse provider replacement during this phase).

This audit identifies existing capabilities, uncovers architectural and mathematical defects in the current matching pipeline, evaluates the feasibility of multimodal vision verification with Nemotron on Nebius Token Factory, designs a bounded multi-frame candidate matching architecture, and presents a minimal, reliable implementation plan for Phase 2.2.

---

## 2. Git State & Two-Repository Audit

Both repositories were inspected for Git state, branches, remotes, working tree cleanliness, and commit history.

| Repository | Path | Branch | Remote Tracking | HEAD Commit | Working Tree |
|---|---|---|---|---|---|
| **NVIDIA / Nemotron** | `~/projects/FIXPROOF` | `main` | `origin/main` | `26364c7` (Phase 1.5) | Clean |
| **Meta Hackathon** | `~/projects/fixproof-muse-hackathon` | `main` | `origin/main` | `50af8fd` (Phase 1.5) | Clean |
| **Reference (Read-Only)** | `~/projects/mediaguardsports` | `main` | `origin/main` | Read-only | Unmodified |

### Repository Parity Analysis
A recursive differential audit between `/FIXPROOF/backend/app` and `/fixproof-muse-hackathon/backend/app` confirms **bit-for-bit source code identity**:
- All 15 Python modules in `backend/app/` are identical.
- All TypeScript types in `frontend/lib/types.ts` and components in `frontend/components/dashboard/` are identical.
- Differences are confined entirely to runtime ephemeral artifacts (local database files, `.pyc` cache files, and local test video storage).
- Both repositories have implemented Phase 1.4 (Report History & Multi-Version Auditing) and Phase 1.5 (Cryptographically Signed Evidence Packages with Ed25519 signatures, canonical manifests, and ReportLab PDF summaries).

---

## 3. Existing Capabilities & Source File Inventory

The existing media ingestion, vector similarity, and incident response architecture spans the following modules:

```
[ Upload / URL ] ──> [ Preflight & Ingestion ] ──> [ Frame Extractor ] ──> [ MobileNetV3 Embedder ]
                                                                                   │
                                                                                   ▼
[ Incident Report ] <── [ Nemotron Engine ] <── [ Temporal Clustering ] <── [ FAISS L2 + pHash Matcher ]
```

### 3.1 Backend Endpoints & Source Files

| Capability | Source Module | Existing Implementation & Endpoints |
|---|---|---|
| **Reference Asset Registration** | `app/main.py:205-228`, `app/registry.py:60-91` | `POST /api/vault/ingest` accepts video uploads, validates extensions (`.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, etc.), enforces `MAX_FILE_SIZE_BYTES` (500 MB), extracts frames, computes 576-dim embeddings, indexes into FAISS `IndexFlatL2`. |
| **Reference Video Streaming** | `app/main.py:298-348` | `GET /api/vault/assets/{asset_id}/video` streams video with HTTP range support. In local mode, serves from `storage/videos/{asset_id}.*`. In cloud mode, generates 30-minute presigned Supabase Storage URLs. |
| **Reference Frame Streaming** | `app/main.py:230-296` | `GET /api/vault/assets/{asset_id}/frames/{frame_filename}` safely streams JPEGs with regex validation (`SAFE_FRAME_REGEX = ^frame_\d{4}s\.jpg$`) and path containment checks. |
| **Suspect Video Upload & Scan** | `app/main.py:572-669` | `POST /api/threats/scan` ingests untrusted suspect video, saves to `storage/suspects/videos/{suspect_id}.*`, extracts frames to `storage/suspects/frames/{suspect_id}/`, runs CV matching against reference vault, and records incident. **Suspect vectors are strictly isolated and never indexed into the reference vault.** |
| **Suspect Frame Streaming** | `app/main.py:242-252` | `GET /api/vault/assets/{asset_id}/frames/{frame_filename}` checks `storage/suspects/frames/{asset_id}/` first. If present, returns suspect frame JPEG. |
| **URL Screening (No Stream Download)** | `app/url_screener.py`, `app/main.py:671-693` | `POST /api/threats/screen-url` uses `yt-dlp` (`download=False`) to extract metadata and public thumbnail URL. Safely downloads thumbnail (max 10 MB, SSRF-guarded), matches against FAISS reference vault. Video streams are **never downloaded**. |
| **Suspect Thumbnail Preview** | `app/main.py:695-703` | `GET /api/threats/suspect-thumbnail/{incident_id}` serves cached thumbnail from `storage/suspects/thumbnails/{incident_id}.jpg`. |
| **CV Matcher & pHash** | `app/matcher.py` | Extracts 576-dim MobileNetV3 penultimate features, L2-normalized. Layer 1: FAISS L2 nearest neighbors (`MATCH_THRESHOLD = 0.55`, `SUSPECT_THRESHOLD = 0.75`). Layer 2: `imagehash.phash` 64-bit DCT hash (`hamming_diff < 15`, `phash_score = max(0, 100 - diff * 4)`). Prevents self-matching. |
| **Temporal Clustering** | `app/timeline.py` | `cluster_frame_matches()` groups discrete frame matches into `TimelineInterval` records based on forward temporal progression, maximum gap (`max_suspect_gap_sec = 15.0s`), and drift tolerance (`abs(dt_source - dt_suspect) <= 5.0s`). Partitions strictly by `source_asset_id`. |
| **Evidence Data Contracts** | `app/evidence_models.py` | Typed Pydantic v2 models: `FrameEvidence`, `TimelineInterval`, `InvestigationInput`, `FindingItem`, `InvestigationReport`, `ReportHistoryItem`. |
| **Investigation Report Generation** | `app/nemotron_engine.py`, `app/main.py:721-779` | `POST /api/threats/{incident_id}/investigate` synthesizes timeline intervals and frame evidence into structured legal triage reports using `nvidia/Nemotron-3_5-Lightning`. |

### 3.2 Frontend Media Components & Source Files

| Component | Source File | Existing Capabilities | Missing for Phase 2 |
|---|---|---|---|
| **Asset Vault** | `frontend/components/dashboard/AssetVault.tsx` | Reference asset grid, video modal preview with HTML5 `<video controls autoPlay src="...">` at line 893. | No dual player; only previews single reference video. |
| **Threat Hunter** | `frontend/components/dashboard/ThreatHunter.tsx` | Drag-and-drop video upload, URL input with SSRF telemetry, progress animation, scan summary cards. | No timeline scrubbing; no video player. |
| **Incident Response** | `frontend/components/dashboard/IncidentResponse.tsx` | Incident selector, multi-report version history, Ed25519 evidence export modal, synthesized timeline interval cards (lines 990-1050), side-by-side static frame images (`img`) at lines 1184-1260, frame selector timeline chips (lines 1300-1338). | **No synchronized side-by-side video player.** **No visual scrubbing bar.** **No interactive match markers on video progress.** |
| **API Client** | `frontend/lib/api.ts` | Video scanning (`scanSuspectVideo`), URL screening (`screenSuspectUrl`), incident queries, report history, package export/verify. | No video playback synchronization helpers or timeline seek controllers. |

---

## 4. Identified Gaps & Missing Capabilities

1. **No Side-by-Side Synchronized Video Player:**  
   `IncidentResponse.tsx` currently renders only static JPEG frame snapshots in `<img>` tags (`selectedFrameMatch.submitted_frame` vs `selectedFrameMatch.best_match`). Reviewers cannot play the suspect video alongside the reference video to observe motion, continuity, or audio-visual correspondence.
2. **Identifier Mismatch Between Video Storage and Incident:**  
   In `backend/app/main.py:591-646`:
   ```python
   suspect_id = str(uuid.uuid4())
   stored_filename = f"{suspect_id}{file_ext}"
   target_path = SUSPECTS_VIDEOS_DIR / stored_filename
   ...
   match_results["incident_id"] = str(uuid.uuid4())  # Generated separately!
   match_results["submitted_asset_id"] = suspect_id
   ```
   The video is stored on disk as `{suspect_id}.mp4`. However, the incident ID is a different UUID. The route `GET /api/vault/assets/{asset_id}/video` checks for `SUSPECTS_VIDEOS_DIR / f"{asset_id}.*"`. If the frontend queries using `incident.incident_id`, the endpoint returns `404 Not Found`. It must query using `incident.submitted_asset_id`, or the backend route must resolve `incident_id` to its underlying `submitted_asset_id`.
3. **Missing Suspect Video Stream in URL Screening:**  
   For incidents originating from `POST /api/threats/screen-url`, no suspect video stream is stored on disk (per platform terms and anti-circumvention protections). The frontend currently assumes `submitted_asset_id` has frame endpoints; when rendering URL screening incidents, it falls back to the static thumbnail preview. However, there is no UI component that plays the reference video alongside the static thumbnail with synchronized timestamp bookmarks.
4. **No Continuous Timeline Scrubber:**  
   The current UI only provides discrete button chips for each sampled frame (e.g. `[0s] [5s] [10s]`). There is no continuous progress bar showing total clip duration, match interval spans, or scrubber needles.
5. **Score Confusion (~50% Anomaly):**  
   The metric `l2_to_confidence` maps unrelated images ($d \approx 1.0$) to 50%, confusing reviewers into believing there is a 50% probability of infringement.

---

## 5. MediaGuardSports Comparative Review (Read-Only)

We inspected `~/projects/mediaguardsports` to assess its media processing patterns:

### 5.1 Reviewed Modules & Capabilities

- **`Backend/agents/archivist.py`:**  
  Extracts frames using OpenCV `cv2.VideoCapture` sampled at 1 frame per second (`step = int(fps)`). Embeds with MobileNetV3 (576-dim), indexes into FAISS `IndexFlatL2`.
- **`Backend/agents/sentinel.py`:**  
  Takes a suspect thumbnail URL via `requests.get()`, extracts MobileNetV3 embedding, and queries FAISS `vector_db.search(embedding, k=3)`. Converts distance via `_l2_to_confidence(dist) = round(max(0.0, (1.0 - dist / 2.0)) * 100, 2)`.
  - **Severe Limitation Identified in MediaGuardSports:**  
    In `sentinel.py` lines 73-84, MediaGuardSports attempts a pHash cross-check:
    ```python
    vault_meta = metadata_store.get("0", {})
    video_path = vault_meta.get("video_path", "")
    cap = cv2.VideoCapture(video_path)
    ret, frame = cap.read() # Reads frame 0 of video 0!
    ```
    MediaGuardSports hardcodes `metadata_store.get("0")` and reads the very first frame of asset 0, rather than loading the actual matching frame at the matched timestamp! FixProof has already resolved this in `matcher.py:load_reference_frame_image()` by dynamically resolving the exact frame path and timestamp.
- **`Frontend/src/components/dashboard/Analytics.jsx` & `IncidentTable.jsx`:**  
  MediaGuardSports does **not** have a side-by-side video player or synchronized video scrubbing. It displays a Recharts line chart of confidence scores and static thumbnail comparison cards.

### 5.2 Reusable Insights for FixProof
1. **Lightweight Frame Decoupling:** Keep video playback independent of vector extraction. Video streams should be served natively via browser HTML5 `<video>` tags with range request support (`206 Partial Content`), while frame metadata drives the scrubber overlays.
2. **Do Not Blindly Port MediaGuard's Scoring:** MediaGuard's `_l2_to_confidence` is the direct origin of the ~50% anomaly. FixProof must replace this linear heuristic with calibrated threshold bands.

---

## 6. Audit of URL Thumbnail Matching & The ~50% Score Anomaly

### 6.1 Current URL Matching Code Path

1. User submits URL in Threat Hunter $\to$ `POST /api/threats/screen-url`.
2. `url_screener.py:screen_video_url(url)` executes:
   - `validate_url_for_ssrf(url)` verifies scheme, blocks private RFC 1918 IPs, loopback (`127.0.0.1`), link-local/cloud metadata (`169.254.169.254`).
   - `extract_public_video_metadata(url)` invokes `yt_dlp.YoutubeDL({'skip_download': True, 'extract_flat': False})`. Retrieves video title, platform, duration, and `thumbnail_url`.
   - `fetch_suspect_thumbnail_image(thumbnail_url)` streams image bytes with a 10 MB ceiling and preflight redirect validation.
   - Saves raw thumbnail to `storage/suspects/thumbnails/{incident_id}.jpg`.
3. **Matching Behavior (Verified from Code):**
   - The screener calls `match_single_frame(pil_img, submitted_asset_id=incident_id, vault=vault, k=3)`.
   - **Crucial Finding:** The URL screening pipeline compares **only ONE static image**—the public thumbnail—against the reference vault.
   - It does **not** compare multiple frames.
   - It does **not** inspect video content.
   - If the vault has reference frames indexed, FAISS searches the 576-dim L2 space for the nearest $k=3$ vectors.

### 6.2 Mathematical Root Cause of the ~50% Score Anomaly

In `backend/app/matcher.py:30-32`:
```python
def l2_to_confidence(distance: float) -> float:
    return round(max(0.0, (1.0 - distance / 2.0)) * 100, 2)
```

Why do visually unrelated thumbnail/frame pairs frequently receive scores around ~50%?

#### 1. Geometry of Normalized Embeddings on the Unit Hypersphere
All MobileNetV3 embeddings are L2-normalized:
$$\|u\|_2 = 1, \quad \|v\|_2 = 1$$
The Euclidean distance $d(u, v)$ between two unit vectors is directly related to their cosine similarity $\cos(\theta) = u \cdot v$:
$$d(u, v)^2 = \|u - v\|_2^2 = \|u\|^2 + \|v\|^2 - 2(u \cdot v) = 2 - 2\cos(\theta)$$
$$d(u, v) = \sqrt{2(1 - \cos(\theta))}$$

- If vectors are identical: $\cos(\theta) = 1 \implies d = 0 \implies \text{confidence} = (1 - 0/2) \times 100 = 100\%$.
- If vectors are orthogonal: $\cos(\theta) = 0 \implies d = \sqrt{2} \approx 1.4142 \implies \text{confidence} = (1 - 0.7071) \times 100 = 29.3\%$.
- If vectors are diametrically opposite: $\cos(\theta) = -1 \implies d = 2.0 \implies \text{confidence} = 0\%$.

#### 2. The Positive Orthant Bias of ReLU Activations
MobileNetV3 penultimate features are extracted after global average pooling following ReLU (or Hardswish) activation functions:
$$u_i \ge 0 \quad \forall i \in \{1, \dots, 576\}$$
Because all components are non-negative, **all embedding vectors lie entirely within the positive orthant** $\mathbb{R}^{576}_{\ge 0}$.

In a high-dimensional positive orthant:
- True orthogonality ($\cos(\theta) = 0$) requires non-overlapping supports (i.e., whenever $u_i > 0$, $v_i = 0$). Natural images share pervasive low-level spatial and texture features, so their supports overlap heavily.
- Opposite vectors ($\cos(\theta) < 0$) are **mathematically impossible**.
- For two random, completely unrelated natural images, their cosine similarity is concentrated around:
  $$\mathbb{E}[\cos(\theta)] \approx 0.40 \text{ to } 0.55$$
  Substituting $\cos(\theta) = 0.50$:
  $$d(u, v) = \sqrt{2(1 - 0.50)} = \sqrt{1.0} = 1.000$$
  Substituting $d = 1.000$ into FixProof's formula:
  $$\text{confidence} = \left(1.0 - \frac{1.000}{2.0}\right) \times 100 = 50.0\%$$

#### 3. Why This Is Misleading to Reviewers
- The metric is labeled in the UI as **"Confidence Score: 50%"** or **"50% Match"**.
- A legal investigator or reviewer interprets "50% Match" as: *"There is a 50% probability this thumbnail is a copy of the broadcast."*
- In mathematical reality, **$d = 1.0$ is the random noise floor for unrelated images**. A score of 50% represents zero evidence of similarity!
- Legitimate matches occur only when $d < 0.55$ ($\cos(\theta) > 0.85$), and suspect matches occur when $0.55 \le d < 0.75$ ($\cos(\theta) > 0.72$).

### 6.3 Remediation Strategy for UI & Calibration
1. **Relabel UI Metric:** Rename "Confidence Score" to **"Visual Feature Similarity Index"** or **"Embedding Distance"**.
2. **Apply Piecewise Calibration:** Calibrate the displayed score so that the noise floor ($d \ge 0.85$) maps to $0\%$, while candidate matches ($d < 0.55$) map to $80\% - 100\%$:
   $$\text{Calibrated Score}(d) = \begin{cases} 
   100 - 36.36 \cdot d & \text{if } d < 0.55 \quad (\implies 80\% \text{ to } 100\%) \\
   80 - 233.33 \cdot (d - 0.55) & \text{if } 0.55 \le d < 0.85 \quad (\implies 10\% \text{ to } 80\%) \\
   0 & \text{if } d \ge 0.85 \quad (\text{Noise floor})
   \end{cases}$$
3. **Mandatory UI Footnote:** *"Feature distance metric; not a calibrated probability of infringement."*

---

## 7. Multi-Frame Candidate Matching Architecture

To replace the single-thumbnail limitation without violating platform protections or downloading full video streams, we design a bounded multi-frame candidate matching pipeline.

### 7.1 Pipeline Specification

```
[ Public Video URL ]
         │
         ▼
[ yt-dlp Metadata Extraction (download=False) ]
         │
         ├───> [ Public Static Thumbnail ]
         │
         └───> [ Permitted Storyboard / Preview Sprites ] (If exposed in public metadata)
         │
         ▼
[ Bounded Candidate Frames (M ≤ 5) ]
         │
         ▼
[ MobileNetV3 Embedding (576-dim) ] ──> [ FAISS L2 Query (k=5) ]
                                                    │
                                                    ▼
                                      [ Top K Candidate Pairs ]
                                                    │
                                                    ├──> Layer 1: L2 Distance (d < 0.75)
                                                    │
                                                    ├──> Layer 2: pHash Hamming Distance (h < 15)
                                                    │
                                                    └──> Layer 3: Image Entropy / Uniformity Filter
                                                                    │
                                                                    ▼
                                                  [ Ranked Candidate Matches ]
```

### 7.2 Key Engineering Rules

1. **Platform Protection Compliance:** Under no circumstances should `yt-dlp` download the actual `.mp4`/HLS/DASH media stream. For URL screening, candidate frames must come from:
   - The primary public thumbnail.
   - Any public storyboard sprite sheets or preview thumbnails already provided in `info_dict["thumbnails"]`.
   - If no preview storyboard exists, the system evaluates the single primary thumbnail and explicitly marks the result as `SINGLE_FRAME_PRELIMINARY`.
2. **Uploaded Suspect Videos:** For uploaded files (`POST /api/threats/scan`), sample 1 frame every 5 seconds up to a maximum ceiling of $N = 120$ frames (10 minutes of video). Clips exceeding 10 minutes are sampled at adaptive intervals ($T_{\text{sample}} = \text{duration} / 120$) to bound CPU and memory usage.
3. **Entropy / Uniformity Filter:** Natural video contains fade-to-black scene transitions, solid title cards, and blank frames. In MobileNetV3, solid black or white frames produce identical vectors ($d \approx 0.05$) across completely different programs. FixProof must compute Shannon image entropy:
   $$H = -\sum_{i=0}^{255} p_i \log_2(p_i)$$
   Any frame with $H < 3.0$ (uniform color) is flagged as `LOW_ENTROPY_STATIC` and excluded from candidate matching.
4. **Composite Ranking:** Rank candidate pairs using a dual-metric composite score:
   $$S_{\text{composite}} = 0.6 \cdot (1.0 - \min(d_{L2}, 1.0)) + 0.4 \cdot \left(\frac{\max(0, 64 - 4 \cdot h_{\text{phash}})}{64}\right)$$
   This ensures that candidates cannot be selected solely by L2 distance if their perceptual hash structure differs completely.

---

## 8. Nemotron-Assisted Pair Verification Design

### 8.1 Model Audit & Feasibility Findings on Nebius Token Factory

We audited model capabilities on our configured Nebius Token Factory endpoint (`https://api.studio.nebius.ai/v1`):

| Model Name | Endpoint Support | Image Input (`image_url`) | Structured JSON | Audit Result & Observations |
|---|---|---|---|---|
| **`nvidia/Nemotron-3_5-Lightning`** | Active | **FAIL (400 Bad Request)** | FAIL (strict mode) | **Text-only LLM.** Nebius explicitly returns: `400 Invalid request: This model does not support image input`. **Must NOT be sent images.** |
| **`nvidia/Nemotron-3.5-Super-VL`** | Active | **PASS (Multimodal)** | **PASS (`json_object`)** | **Vision-Language Model.** Confirmed working on Nebius Token Factory. Accepts base64 data URIs. Processes ~258 image tokens per call with ~0.5s - 1.2s latency. |
| **`meta-models/muse-spark-open`** | Active | **PASS (Multimodal)** | **PASS (`json_object`)** | Multimodal model for hackathon evaluation; tested and verified. |

> **Audit Conclusion:** Second-stage visual pair verification MUST target `nvidia/Nemotron-3.5-Super-VL`. The existing text-only report generator continues using `nvidia/Nemotron-3_5-Lightning` for narrative synthesis, preserving strict architectural separation.

### 8.2 Bounded Verification Flow

To prevent token exhaustion, cost spikes, and latency bottlenecks:
- **Maximum Candidates Evaluated:** $K \le 3$ candidate frame pairs per incident.
- **Trigger Condition:** Pair verification is invoked **only** for pairs that passed CV Layer 1 ($d_{L2} < 0.75$) and CV Layer 2 ($h_{\text{phash}} < 18$). Pairs above $d = 0.75$ are never sent to the model.
- **Image Preprocessing:** Images are downscaled to a maximum of $512 \times 512$ pixels before base64 encoding, capping image token consumption at ~258 tokens per image.
- **Request Budget:** `max_tokens: 450`, `temperature: 0.1`, `timeout: 12.0s`.

### 8.3 Structured Output Schema

The model is prompted to perform objective visual comparison (NOT copyright adjudication):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "NemotronVisualVerificationResult",
  "type": "object",
  "required": [
    "candidate_pair_index",
    "suspect_timestamp_sec",
    "reference_timestamp_sec",
    "visual_correspondence",
    "confidence_assessment",
    "matching_features",
    "contradictions",
    "reasoning",
    "uncertainty_factors"
  ],
  "properties": {
    "candidate_pair_index": { "type": "integer" },
    "suspect_timestamp_sec": { "type": "number" },
    "reference_timestamp_sec": { "type": "number" },
    "visual_correspondence": {
      "type": "string",
      "enum": ["DEFINITIVE_MATCH", "HIGH_CORRESPONDENCE", "POSSIBLE_REUSE", "UNRELATED_SCENE"]
    },
    "confidence_assessment": {
      "type": "string",
      "enum": ["HIGH", "MODERATE", "LOW", "INCONCLUSIVE"]
    },
    "matching_features": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Specific visible features shared between images (e.g. scoreboard graphics, camera angle, player jerseys, logos)."
    },
    "contradictions": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Specific visible discrepancies (e.g. different channel watermarks, different background crowd, differing text overlays)."
    },
    "reasoning": {
      "type": "string",
      "description": "Concise technical description of visual correspondence without legal conclusions."
    },
    "uncertainty_factors": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Factors hindering certainty (e.g. severe JPEG compression, motion blur, heavy cropping, low resolution)."
    }
  }
}
```

### 8.4 Fail-Safe & Fallback Handling
- If `nvidia/Nemotron-3.5-Super-VL` times out or returns HTTP 429/500, the verification result records `status: "VERIFICATION_UNAVAILABLE"` with the error message.
- The investigation engine **never halts** on model failure; it retains the CV measurements (FAISS L2 and pHash) and marks the model verification column as `UNVERIFIED_DUE_TO_TIMEOUT`.

---

## 9. False-Positive Evaluation & Labeled Test Matrix

Arbitrary thresholds ($0.55$, $0.75$) must be verified against an empirical test matrix.

### 9.1 Labeled Test Scenarios

| Test Scenario ID | Visual Condition | Expected L2 Distance | Expected pHash Diff | Expected Model Verdict | Target Outcome |
|---|---|---|---|---|---|
| **TP-01** | Exact identical frame | $d < 0.05$ | $0$ | `DEFINITIVE_MATCH` | Confirmed Match |
| **TP-02** | Re-encoded / compressed clip (720p to 480p) | $0.10 \le d < 0.35$ | $2 \le h \le 8$ | `HIGH_CORRESPONDENCE` | Confirmed Match |
| **TP-03** | Cropped broadcast (10% border zoom) | $0.30 \le d < 0.50$ | $6 \le h \le 12$ | `HIGH_CORRESPONDENCE` | Confirmed Match |
| **FP-01** | Unrelated images (Current ~50% anomaly) | $0.90 \le d \le 1.15$ | $25 \le h \le 40$ | `UNRELATED_SCENE` | **Clean (Rejected by L2 noise floor)** |
| **FP-02** | Color palette collision (e.g. green soccer field vs green golf fairway) | $0.65 \le d \le 0.78$ | $20 \le h \le 35$ | `UNRELATED_SCENE` | **Suspect (Rejected by pHash layer)** |
| **FP-03** | Uniform test patterns (Black / White screen) | $d < 0.20$ | $0$ | N/A | **Rejected by Entropy Filter ($H < 3.0$)** |
| **TN-01** | Different game, same broadcast graphics | $0.55 \le d \le 0.70$ | $14 \le h \le 22$ | `POSSIBLE_REUSE` | Flagged for Human Review |

### 9.2 Threshold Evaluation Methodology
In Phase 2.2 testing, evaluate Precision-Recall curves over a synthetic test dataset of 50 positive pairs and 50 negative pairs to empirically validate that the threshold boundary $d < 0.55$ yields $0\%$ False Positives on `FP-01` and `FP-02`.

---

## 10. Phase 2.2 Implementation Plan & Architecture

Phase 2.2 will implement the synchronized player, visual timeline, match markers, and evidence overlays in both repositories.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             INCIDENT RESPONSE DASHBOARD                          │
├────────────────────────────────────────┬─────────────────────────────────────────┤
│         REFERENCE SOURCE VIDEO         │           SUSPECT VIDEO STREAM          │
│  ┌──────────────────────────────────┐  │  ┌───────────────────────────────────┐  │
│  │                                  │  │  │                                   │  │
│  │      <video id="ref-player">     │  │  │      <video id="suspect-player">  │  │
│  │                                  │  │  │   (or Screened Thumbnail Badge)   │  │
│  └──────────────────────────────────┘  │  └───────────────────────────────────┘  │
│  Asset: ref-champions-league.mp4       │  Suspect: pirated_stream_rip.mp4        │
├────────────────────────────────────────┴─────────────────────────────────────────┤
│                       SYNCHRONIZED TIMELINE & SCRUBBER                           │
│  [Play/Pause] [Seek Match] [Speed: 1x ▾]                                         │
│  00:15 / 02:30 ──────────────────────●────────────────────────────────── 02:30   │
│  Match Markers:      ▲ (Conf: 94%)       ▲ (Suspect: 68%)                        │
│  Interval Bands:     [====== Match 1 ======]         [=== Match 2 ===]           │
├──────────────────────────────────────────────────────────────────────────────────┤
│                       SIDE-BY-SIDE EVIDENCE & VERIFICATION                       │
│  Selected: Match 1 (ts: 15s ↔ 10s)  │  L2: 0.124  │  pHash: 100% (diff 0)       │
│  Nemotron-3.5-Super-VL: HIGH_CORRESPONDENCE ("Matching scoreboard bug & jerseys")│
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 10.1 Feature A: Source and Suspect Video Playback

1. **Player Layout:**  
   Implement a dual-viewport container in `IncidentResponse.tsx` with two HTML5 `<video>` elements side by side.
2. **Media Stream Resolution:**
   - **Reference Video:** Streamed from `/api/vault/assets/{matched_asset_id}/video`.
   - **Suspect Video:** Streamed from `/api/vault/assets/{submitted_asset_id}/video`.
   - **Backend Fix for Identifier Resolution:** Update `stream_asset_video(asset_id: str)` in `backend/app/main.py` so that if `asset_id` matches an `incident_id`, the backend automatically resolves `incident.submitted_asset_id` from the incident registry and serves the corresponding video file.
3. **Protected / URL Media Fallback:**  
   When `investigation_type === "URL_SCREENING"`, render the reference video player on the left, and an authenticated preview frame on the right displaying the cached suspect thumbnail with an explicit badge:  
   `[ PLATFORM PROTECTED — VIDEO STREAM NOT ACQUIRED ]`.  
   Provide a secondary link button to open the original public webpage in an external tab.

### 10.2 Feature B: Synchronized Timeline Scrubbing

1. **Mathematical Timestamp Mapping:**  
   When a user selects a match interval $I = [t_{\text{suspect, start}}, t_{\text{suspect, end}}]$ matching reference interval $[t_{\text{ref, start}}, t_{\text{ref, end}}]$, calculate the constant temporal offset:
   $$\Delta t = t_{\text{suspect, start}} - t_{\text{ref, start}}$$
2. **Master-Follower Playback Synchronization:**
   - The suspect video acts as the primary clock.
   - When the user scrubs suspect time to $t$, the controller seeks the reference video to:
     $$t_{\text{ref}} = \text{clamp}(t - \Delta t, 0, \text{duration}_{\text{ref}})$$
   - When the master video is played or paused, the follower video synchronizes playback state.
   - If drift exceeds $0.25\text{s}$ (detected via `timeupdate`), the follower executes a fine seek to re-align.
3. **Discontinuous & Unmatched Regions:**  
   If playback scrubs into a timeline region where no correspondence was identified, display an indicator: `[ UNMATCHED FOOTAGE — INDEPENDENT SCRUBBING ]`, allowing both players to seek independently.

### 10.3 Feature C: Match Markers & Visual Status Indicators

1. **Timeline Track Visualization:**  
   Render an interactive SVG/HTML canvas scrubber bar above the timeline showing:
   - Green / Red colored interval spans representing `TimelineInterval` durations (`CONTINUOUS_MATCH`, `SPARSE_MATCH`).
   - Vertical tick markers for individual extracted frames.
   - Marker colors:
     - **Red (`#ef4444`):** Confirmed candidate match ($d < 0.55$).
     - **Amber (`#f59e0b`):** Suspect candidate match ($0.55 \le d < 0.75$).
     - **Slate (`#475569`):** Clean frame ($d \ge 0.75$).
     - **Purple Badge (`#a855f7`):** Nemotron VL Verified match.
2. **Interactive Hover Tooltips:**  
   Hovering over any match marker reveals:
   - Suspect timestamp vs reference timestamp.
   - Measured L2 distance and pHash Hamming distance.
   - Verification status from `Nemotron-3.5-Super-VL`.

### 10.4 Feature D: Side-by-Side Evidence Inspection & Overlays

1. **Side-by-Side Frame Freeze:**  
   Clicking any match marker freezes video playback and loads full-resolution frames side by side.
2. **Difference & Overlay Inspection:**  
   Provide an interactive overlay mode with an opacity slider ($0\% \to 100\%$) and difference blending to visually reveal altered broadcast watermarks or re-scaled borders.
3. **Legal Disclaimer & Provenance Preservation:**  
   Maintain persistent links to:
   - Report History ID (`/api/threats/reports/{report_id}`).
   - Signed Evidence Package (`/api/threats/{incident_id}/reports/export`).
   - Statutory notice: *"Candidate visual similarity only; does not constitute a legal finding of copyright infringement."*

### 10.5 Feature E: Test Suite Specification

| Test Category | Target Module | Scope & Acceptance Criteria |
|---|---|---|
| **Unit: Timestamp Mapping** | `tests/test_timeline.py` | Verify offset calculation $\Delta t$, drift tolerance, clamp boundaries, and out-of-order interval handling. |
| **Unit: Calibrated Scores** | `tests/test_matcher.py` | Verify that L2 distance $1.0$ evaluates to $0\%$ confidence score under calibrated scoring, while $d < 0.05$ evaluates to $> 98\%$. |
| **Unit: Uniformity Filter** | `tests/test_matcher.py` | Verify that all-black and all-white synthetic frames are rejected with `LOW_ENTROPY_STATIC`. |
| **Integration: Video Stream Route** | `tests/test_threat_scan.py` | Verify `GET /api/vault/assets/{incident_id}/video` correctly resolves and streams uploaded suspect video with HTTP 200/206. |
| **Integration: URL Media Fallback** | `tests/test_url_screener.py` | Verify URL screening incidents return valid thumbnail URLs and stream 404/fallback cleanly without crashing. |
| **Frontend: Synchronized Playback** | Jest / Cypress | Verify dual player seeking, play/pause synchronization, and missing video fallback rendering. |

---

## 11. Two-Repository Workflow & Synchronization Strategy

To ensure zero drift across repositories:
1. **Identical Implementation:** The Phase 2.2 implementation will be coded identically in both `~/projects/FIXPROOF` and `~/projects/fixproof-muse-hackathon`.
2. **Single Checkpoint Verification:** Both repositories will run tests and production builds (`npm run build` and `pytest`).
3. **Synchronized Commits & Pushes:** Only after verification passes in both repositories will changes be committed and pushed to their respective `origin/main` remotes.
4. **No Provider Drift:** Both repositories remain on Nemotron until Phase 2 is fully completed and verified.

---

## 12. Risks & Assumptions

1. **Browser Codec Compatibility:**  
   Uploaded suspect videos may use codecs not natively supported by HTML5 `<video>` (e.g. HEVC/H.265 or MPEG-2 in certain browsers).  
   *Mitigation:* Preflight check detects codec; if unsupported, UI informs the user that playback requires H.264/AAC, while static extracted frames remain viewable.
2. **Network Bandwidth on Dual Streaming:**  
   Streaming two concurrent 1080p video streams can saturate client connections.  
   *Mitigation:* Use HTTP range requests (`206 Partial Content`) and moderate buffer limits.
3. **Nebius Multimodal Rate Limits:**  
   `nvidia/Nemotron-3.5-Super-VL` has token and request rate limits.  
   *Mitigation:* Bounding verification to $K \le 3$ candidate pairs per incident and downscaling images ensures negligible token footprint.
