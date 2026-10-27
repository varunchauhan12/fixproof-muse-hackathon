# FixProof Milestone 6C.6B Completion Report
## Evidence-Grounded Nemotron Foundation & Temporal Correspondence Clustering

**Document Version:** 1.0.0  
**Date:** October 27, 2026  
**Status:** COMPLETE & VERIFIED  
**Author:** Antigravity Agentic Systems  
**Milestone:** 6C.6B (Evidence-Grounded Nemotron Foundation)

---

## Executive Summary

Milestone 6C.6B establishes the foundational layer of FixProof's **Nemotron Investigation Engine**. It bridges the gap between raw computer-vision (CV) matches and forensic intelligence reports without introducing premature autonomy or ungrounded generative speculation.

### Core Objectives Achieved
1. **Typed Evidence Contract:** Defined robust Pydantic v2 data models (`backend/app/evidence_models.py`) enforcing that every finding cites verifiable evidence identifiers. References to nonexistent evidence are strictly rejected or flagged.
2. **Deterministic Temporal Clustering:** Implemented a multi-asset correspondence aggregator (`backend/app/timeline.py`) that clusters frame matches into continuous time intervals while handling gaps, out-of-order frames, duplicate matches, and reverse source timestamps.
3. **Bounded Nemotron Engine:** Built a production-grade investigation engine (`backend/app/nemotron_engine.py`) using Nebius Token Factory (`nvidia/Nemotron-3_5-Lightning`). It enforces structured JSON output, guards against reasoning-token starvation with a calibrated token budget (`max_tokens = 6144`), strictly avoids legal infringement adjudication, and enforces non-adjudicative rules on URL screening.
4. **Privacy & Reasoning Separation:** Strictly separates internal chain-of-thought traces (`reasoning_content`) from the public report. Only validated findings and operational metadata (latency, token metrics, validation status, error logs) are persisted or returned.
5. **Dual-Mode Report Persistence:** Implemented report persistence in `backend/app/registry.py` supporting both local mode (`backend/storage/nemotron_reports.json`) and Supabase PostgreSQL mode (table `nemotron_reports`), with explicit failure reporting and zero destructive migrations.
6. **API Integration & Compatibility:** Added endpoints `POST /api/threats/{incident_id}/investigate`, `GET /api/threats/{incident_id}/report`, and `GET /api/threats/reports/{report_id}` to `backend/app/main.py`. The legacy debugging assistant `POST /diagnose` remains 100% backward-compatible.

---

## 1. Files Changed & Implementation Architecture

| File Path | Status | Purpose / Architecture |
|:---|:---:|:---|
| `backend/app/evidence_models.py` | **NEW** | Typed Pydantic v2 models: `FrameEvidence`, `TimelineInterval`, `InvestigationInput`, `FindingItem`, `InvestigationReport`. Conversion helpers from CV matches and evidence validation logic. |
| `backend/app/timeline.py` | **NEW** | Deterministic temporal correspondence clustering algorithm with configurable gap (`max_suspect_gap_sec = 15.0s`) and drift (`max_drift_sec = 5.0s`) thresholds. |
| `backend/app/nemotron_engine.py` | **NEW** | OpenAI-compatible client integration for Nebius Token Factory (`nvidia/Nemotron-3_5-Lightning`). System prompts, JSON schema enforcement, reasoning token protection (`DEFAULT_MAX_TOKENS = 6144`), and truncation recovery. |
| `backend/app/registry.py` | **MODIFIED** | Added `NEMOTRON_REPORTS_FILE`, `save_nemotron_report()`, `load_nemotron_reports()`, `get_nemotron_report_by_id()`, `get_nemotron_reports_for_incident()`, and `get_incident_by_id()`. |
| `backend/app/main.py` | **MODIFIED** | Added `POST /api/threats/{incident_id}/investigate`, `GET /api/threats/{incident_id}/report`, and `GET /api/threats/reports/{report_id}`. Preserved `POST /diagnose` backward compatibility. |
| `backend/tests/test_nemotron_engine.py` | **NEW** | Comprehensive 12-test automated suite covering clustering, multi-asset handling, hallucination rejection, truncated output, timeout/rate-limit handling, local/cloud persistence, and API endpoints. |
| `backend/.env` | **MODIFIED** | Preserved default runtime mode `FIXPROOF_DB_MODE=local`. |

---

## 2. Evidence Contract & Temporal Clustering Approach

### 2.1 Typed Evidence Schema (`evidence_models.py`)
- **`FrameEvidence`:** Normalized frame comparison record with `evidence_id` (`frame_{idx}_t{sec}s`), suspect timestamp, source asset ID, source timestamp, FAISS L2 distance, pHash Hamming score, and match status (`CONFIRMED_MATCH`, `SUSPECT_MATCH`, `NO_MATCH`).
- **`TimelineInterval`:** Continuous sequence of matches against a single reference asset with `interval_id`, suspect interval `[start, end]`, reference interval `[start, end]`, duration, mean L2 distance, pHash match ratio, continuity status (`CONTINUOUS_MATCH`, `SPARSE_MATCH`, `SINGLETON`), and underlying `evidence_ids`.
- **`FindingItem`:** Atomic finding containing `finding_id`, `category`, factual `statement`, measured metrics, and non-empty `evidence_ids`.
- **`InvestigationReport`:** Final report aligned with database table `nemotron_reports`: `report_id`, `incident_id`, `model_id`, `summary`, `recommended_action`, `confidence_assessment`, `human_review_required`, `timeline_intervals`, `findings`, `unresolved_questions`, `contradictions_detected`, `limitations_disclosed`, `evidence_references`, and `operational_metadata`.

### 2.2 Temporal Correspondence Clustering (`timeline.py`)
Clustering takes discrete 5s-interval frame matches and forms verified video-to-video intervals:
1. **Asset Partitioning:** Frames are strictly partitioned by `source_asset_id`. Different reference assets can never be grouped into the same interval.
2. **Chronological Sorting & Deduplication:** Suspect frames are sorted by timestamp. If duplicate frames exist at the same timestamp, the one with lower L2 distance is selected.
3. **Continuity Constraints:**
   - Suspect forward progression: `dt_suspect > 0`.
   - Maximum allowable gap: `dt_suspect <= max_suspect_gap_sec` (default 15.0s, allowing up to 2 dropped 5s samples).
   - Source forward progression: `dt_source > 0` (if source jumps backwards, interval terminates).
   - Playback rate synchronization: `abs(dt_source - dt_suspect) <= max_drift_sec` (default 5.0s tolerance for 1.0x playback rate).
4. **Singleton Preservation:** If a frame match is isolated and cannot be linked to neighboring frames, it is returned as a `SINGLETON` interval (`duration_sec = 0.0`), preserving all metrics without inventing continuous duration.

---

## 3. Model Configuration & Error Handling

### 3.1 Token Budget & Empirical Reasoning Discovery
During empirical testing against live Nebius Token Factory, we observed:
- `nvidia/Nemotron-3_5-Lightning` produces **2,500 to 4,300 reasoning tokens** for forensic evidence analysis tasks before emitting content.
- When `max_tokens` was configured to 1500 or 3000, the model generated reasoning tokens until reaching the ceiling, resulting in `finish_reason = "length"` and empty content (`content: None`).
- **Production Solution:** Configured `DEFAULT_MAX_TOKENS = 6144` and `DEFAULT_TIMEOUT_SEC = 45.0s`. At 6144 tokens, the model completed 4,282 reasoning tokens and cleanly generated valid JSON with `finish_reason = "stop"` (latency: ~19s).

### 3.2 Non-Adjudicative Bounded Prompting
- Instructs Nemotron: *"You are an evidence analyst, NOT a judge of legal copyright infringement or fair use rights. You MUST NOT claim copyright infringement, piracy, legal ownership, or liability."*
- **URL Screening Invariant:** For `investigation_type == "URL_SCREENING"`, only the public thumbnail was analyzed. The engine strictly enforces `recommended_action = "NEEDS_FULL_VIDEO_REVIEW"` and injects mandatory limitation disclosures, even if the model attempts to recommend legal takedown.
- **Evidence Reference Validation:** Every evidence ID in `finding.evidence_ids` is cross-checked against valid interval and frame IDs. Nonexistent IDs are stripped or flagged with `validation_status = "PARTIALLY_VALIDATED"`.

### 3.3 Privacy & Reasoning Trace Protection
In accordance with Milestone 6C.6B instructions:
- `response.choices[0].message.reasoning_content` is **never exposed in public API responses or written to disk**.
- Only validated findings, summaries, and non-sensitive operational metadata (`model_id`, `latency_ms`, token usage, `validation_status`, `errors`, `created_at`) are persisted and returned.

---

## 4. Report Persistence Architecture

### 4.1 Local Mode (`FIXPROOF_DB_MODE=local`)
- Reports are stored in `backend/storage/nemotron_reports.json`.
- Idempotent upsert: New reports are prepended to the list or updated if `report_id` matches.
- File writes are guarded; any I/O error explicitly raises an exception.

### 4.2 Supabase Mode (`FIXPROOF_DB_MODE=supabase`)
- Persisted to PostgreSQL table `nemotron_reports` using parameterized SQL:
  ```sql
  INSERT INTO nemotron_reports (
      report_id, incident_id, model_id, prompt_version, summary,
      recommended_action, confidence_assessment, human_review_required,
      contradictions_detected, limitations_disclosed, full_report_json,
      raw_model_response, prompt_tokens, completion_tokens, latency_ms, created_at
  ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
  ON CONFLICT (report_id) DO UPDATE ...
  ```
- Database check constraints for `recommended_action` and `confidence_assessment` are respected.
- Database operational failures are explicitly raised, ensuring the caller is never misled into believing persistence succeeded when it failed.

---

## 5. Test Execution Results

All focused and regression suites were executed using the active Python virtual environment (`backend/.venv`) and frontend build tooling.

### 5.1 Focused Suite: `tests/test_nemotron_engine.py` (12 Tests)

```bash
source backend/.venv/bin/activate && cd backend && python -m unittest tests/test_nemotron_engine.py
```
**Result:** **12/12 PASSED (0 failures, 0 errors, 0.027s execution)**

| Test Case | Method | Verdict | Description |
|:---|:---|:---:|:---|
| 1 | `test_1_temporal_clustering_basic` | **PASS** | Validates continuous 10s interval across 3 frames with 1.0x playback alignment. |
| 2 | `test_2_multiple_source_assets_and_noncontiguous_gaps` | **PASS** | Verifies asset partition (Alpha vs Beta) and 35s gap segmentation. |
| 3 | `test_3_temporal_clustering_edge_cases` | **PASS** | Handles out-of-order frames, duplicate suspect timestamps, and reverse source jumps. |
| 4 | `test_4_evidence_reference_validation` | **PASS** | Detects and flags nonexistent evidence ID references (`f_phantom_99s`). |
| 5 | `test_5_valid_structured_nemotron_response` | **PASS** | Validates structured JSON parsing, finding mapping, and operational metadata. |
| 6 | `test_6_malformed_and_truncated_nemotron_responses` | **PASS** | Gracefully handles `finish_reason='length'`, malformed JSON, and empty bodies. |
| 7 | `test_7_api_timeout_and_provider_failure` | **PASS** | Verifies `APITimeoutError` and `RateLimitError` (HTTP 429) fallback handling. |
| 8 | `test_8_local_report_persistence` | **PASS** | Tests file creation and retrieval in isolated temporary directory. |
| 9 | `test_9_supabase_persistence_mocked` | **PASS** | Verifies parameterized SQL query construction and parameter mapping without live DB writes. |
| 10 | `test_10_no_fabrication_invariants_and_url_screening` | **PASS** | Enforces `NEEDS_FULL_VIDEO_REVIEW` on URL screening regardless of model claim. |
| 11 | `test_11_diagnose_backward_compatibility` | **PASS** | Verifies legacy `POST /diagnose` endpoint functions without regression. |
| 12 | `test_12_api_investigation_endpoints_end_to_end` | **PASS** | Validates `POST /investigate` idempotency, report caching, 400 on bad ID, 404 on missing. |

---

### 5.2 Full Regression Suite (87 Unit Tests + 6 Integration Stages)

```bash
# Core backend regression suite
python -m unittest tests/test_nemotron_engine.py tests/test_url_screener.py tests/test_vault.py tests/test_matcher.py tests/test_db.py tests/test_storage.py tests/test_ingest.py
```
**Result:** **87/87 PASSED (0 failures, 0 errors, 1.072s execution)**

```bash
# Milestone 6C.5 URL-Screening Integration Suite
python tests/verify_milestone_6c5.py
```
**Result:** **6/6 STAGES PASSED** (SSRF defenses, validation, preliminary screening, FAISS isolation, persistence).

```bash
# Frontend Next.js Production Build
cd frontend && npm run build
```
**Result:** **PASSED (0 errors, 355ms Turbopack compile)**. TypeScript 100% clean.

---

### 5.3 Live Token Factory Smoke Test Result
A live investigation call was executed against Nebius Token Factory with real credentials:
- **Model:** `nvidia/Nemotron-3_5-Lightning`
- **Tokens:** Prompt: 1,059 | Completion: 5,079 (Reasoning: ~4,200 tokens)
- **Latency:** 19,438 ms (~19.4s)
- **Report Status:** `VALIDATED`
- **Output:**
  - `recommended_action`: `"FLAG_FOR_BROKER_LICENSING"`
  - `confidence_assessment`: `"HIGH_CONFIDENCE_MATCH"`
  - `findings`: Grounded finding citing `interval_1_live_ref`, `frame_0_t0s`, `frame_1_t5s`
  - `operational_metadata`: Zero private reasoning traces exposed

---

## 6. Known Limitations & Outstanding Risks

1. **Nemotron Inference Latency (15s–25s):**
   Because `nvidia/Nemotron-3_5-Lightning` produces ~3,000–4,500 reasoning tokens per investigation, calls take 15–25 seconds. The API endpoint handles this synchronously, but for production high-throughput workloads, asynchronous background jobs (e.g. Celery or BullMQ) will be recommended in Milestone 6C.6C.
2. **Text-Only Scope in 6C.6B:**
   This milestone deliberately restricts automated investigation to `nvidia/Nemotron-3_5-Lightning` (text metrics). `nvidia/Nemotron-3.5-Super-VL` is preserved for a dedicated visual frame comparison milestone.
3. **No Direct Video Streaming:**
   Endpoints continue to reject raw MP4 stream ingestion. FixProof's local OpenCV frame extraction remains the mandatory ingestion boundary.

---

## 7. Manual Steps Required

**None.** All data models, clustering algorithms, client configurations, and endpoints are active and verified.

---

## 8. Repository State Verification

```
## main...origin/main
 M backend/app/main.py
 M backend/app/registry.py
 M backend/requirements.txt
 M frontend/components/dashboard/IncidentResponse.tsx
 M frontend/components/dashboard/ThreatHunter.tsx
?? backend/app/evidence_models.py
?? backend/app/nemotron_engine.py
?? backend/app/timeline.py
?? backend/app/url_screener.py
?? backend/tests/test_nemotron_engine.py
?? backend/tests/test_url_screener.py
?? backend/tests/verify_milestone_6c5.py
?? docs/
```

```
 backend/app/main.py                                | 126 +++++
 backend/app/registry.py                            | 228 +++++++-
 backend/requirements.txt                           |   4 +-
 frontend/components/dashboard/IncidentResponse.tsx | 107 +++-
 frontend/components/dashboard/ThreatHunter.tsx     | 574 +++++++++++++++++----
 5 files changed, 904 insertions(+), 135 deletions(-)
```

---

## Conclusion & Milestone Stop

Milestone 6C.6B is complete. FixProof now possesses an evidence-grounded Nemotron investigation layer, robust temporal clustering, dual-mode report persistence, and verified test suites. 

In strict adherence to instructions, **execution is stopped here**. Milestone 6C.6C will not begin without your explicit review and approval.
