# FixProof Audit: Intelligence & Analytics and Swarm Logs Architecture

**Phase:** 3.4 — Step 4  
**Date:** October 28, 2026  
**Repositories:**
- Primary (NVIDIA): `~/projects/FIXPROOF`
- Secondary (Meta): `~/projects/fixproof-muse-hackathon`
- Read-Only Reference: `~/projects/mediaguardsports`

---

## 1. Executive Summary

This audit assesses the data provenance, persistence layer, calculation fidelity, and operational event mechanisms for FixProof's **Intelligence & Analytics** and **Forensics Swarm Logs** interfaces.

FixProof is a video evidence investigation platform built around reference-asset ingestion, MobileNetV3 feature extraction (576-dim L2-normalized embeddings), FAISS index similarity matching, perceptual hashing (pHash), temporal match clustering, NVIDIA Nemotron-3.5-Lightning forensic legal triage, Ed25519-signed evidence package generation, and dual-mode persistence (local JSON/filesystem or Supabase PostgreSQL/Storage).

FixProof is **not** a speculative social media crawler or simulated autonomous agent swarm. Every displayed metric, chart, log entry, and status indicator must be grounded in genuine database records and verified backend operations, or explicitly designated as unavailable.

---

## 2. MediaGuardSports Comparative Evaluation

Inspection of `mediaguardsports/Frontend/src/components/dashboard/Analytics.jsx`, `Overview.jsx`, `Notifications.jsx`, and backend handlers reveals the following widget reality:

| Widget / Feature | MediaGuardSports Implementation | Grounding in MediaGuardSports | FixProof Architectural Status |
| :--- | :--- | :--- | :--- |
| **Confidence Trend** | Recharts line graph plotting last 24 incidents' `confidence_score`. | Derived from mock database records | **Supported via real records**: FixProof records `highest_confidence` and `lowest_l2_distance` per incident with ISO timestamps. |
| **Platform Breakdown** | Recharts pie chart categorizing incident platform names (`YouTube`, `TikTok`, etc.). | Derived from hardcoded string tags on mock incidents | **Partially supported**: Real URL screening incidents record `platform` and `source_url`. Video file uploads are direct file scans (platform N/A). |
| **Classification Distribution** | Pie chart dividing incidents into `SEVERE PIRACY`, `FAIR USE / FAN CONTENT`, `UNREVIEWED`. | Derived from mock field values | **Supported via real records**: FixProof records `overall_status` (`CANDIDATE_MATCH`, `SUSPECT`, `NEEDS_FULL_VIDEO_REVIEW`, `CLEAN`, `NO_REFERENCE_DATA`). FixProof strictly distinguishes heuristic visual match from legal infringement. |
| **DMCA Actions & Licensing** | Line chart plotting mock DMCA takedowns and contract licensing events over time. | Derived from mock collections | **Unavailable**: FixProof does not execute commercial copyright licensing contracts or automated DMCA filings without human review. |
| **Revenue Protected** | KPI card claiming `$revenueProtected` derived from `(views / 1000) * cpm`. | **Completely simulated**: Generates fake dollar estimates and fake `0x...` Polygon hashes. | **Omitted**: FixProof is a forensic verification tool, not a monetization engine. Financial estimates are ungrounded. |
| **Agent Swarm Heartbeat** | 6 cards with pulsing indicators for `Archivist`, `Spider`, `Sentinel`, `Adjudicator`, `Enforcer`, `Broker`. | **Simulated animation**: Cycles progress bars and status text via timer. | **Replaced**: Real pipeline stages (Vault Ingest, Feature Extraction, FAISS Indexing, URL Screening, Nemotron Synthesis, Evidence Export). |
| **Swarm Logs / Activity** | Live terminal feed in `Notifications.jsx` populated by WebSocket. | WebSocket messages pushed from mock background loop | **Replaced**: Replaced with a structured Forensic Event Explorer grounded in real database records and execution telemetry. |

---

## 3. Data Source Classification for Analytics

Every metric on the Intelligence & Analytics page is classified by its source of truth:

| Metric / Widget | Data Source | Storage / Query | Classification | Provenance & Calculation Details |
| :--- | :--- | :--- | :--- | :--- |
| **Registered Reference Assets** | `reference_assets` | Supabase PostgreSQL or `assets_metadata.json` | **Persisted** | Direct count of official reference assets registered by the rights-holder. |
| **Indexed FAISS Vectors** | `vault.vector_db.ntotal` | FAISS Index / `vault_snapshots` / `vaultStatus` | **Persisted & Live** | Exact count of 576-dimensional MobileNetV3 vectors currently loaded into the active FAISS index. |
| **Indexed Reference Assets** | `reference_assets.indexed_vectors_count` | PostgreSQL or `vault.metadata_store` | **Derived** | Number of assets having `indexed_vectors > 0`. Distinguishes fully/partially indexed assets from unindexed ones. |
| **Total Extracted Frames** | `reference_assets.frame_count` | PostgreSQL or disk frame directories | **Persisted** | Sum of sampled video frames extracted at 5-second intervals. |
| **Total Investigations** | `incidents` | Supabase PostgreSQL or `incidents.json` | **Persisted** | Count of recorded threat scans and screenings. |
| **Modality Breakdown** | `incidents.investigation_type` | Filter: `FULL_VIDEO_SCAN` vs `URL_SCREENING` | **Persisted** | Differentiates deep multi-frame video file scans from single-thumbnail URL screenings. |
| **Outcome Distribution** | `incidents.overall_status` | Status aggregation | **Persisted** | Counts: `CANDIDATE_MATCH`, `SUSPECT`, `NEEDS_FULL_VIDEO_REVIEW`, `CLEAN`, `NO_REFERENCE_DATA`. Grounded in L2 distance (< 0.15) and pHash corroboration. |
| **Chronological Telemetry** | `incidents.scanned_at` | Ordered by timestamp | **Persisted** | Plots genuine timestamped scan events, showing observed similarity % and lowest L2 distances. No interpolated or synthetic time-series. |
| **Asset Exposure Footprint** | `incidents.matched_asset_ids` | Cross-referenced against `assets.asset_id` | **Derived** | Actual count of how many suspect scans triggered similarity matches against each reference asset in the vault. |
| **Screening Platforms** | `incidents.platform` | Aggregated from `URL_SCREENING` incidents | **Persisted (Partial)** | Grounded in URL metadata parser (`url_screener.py`). Applies only to URL screenings, not video file uploads. |
| **Cross-Platform Leak Trees** | N/A | None | **Unavailable** | Disclosed transparently as requiring verified repost lineages or cryptographic watermarks. |
| **Geographic Pins / Map** | N/A | None | **Unavailable** | Excluded pursuant to the Phase 3.4 Location Audit Decision. |

---

## 4. Swarm Logs: Operational Architecture & Event Provenance

### 4.1 Audit of Existing Implementation

Prior to this redesign, `SwarmLogsView` in `SecondaryViews.tsx` exhibited the following defects:
1. **Loop-Constructed Pseudo-Terminal**: It mapped over `assets` and `incidents` arrays in a monolithic text block, artificially prepending `[ARCHIVIST]` and `[SENTINEL]` labels.
2. **Repeated Asset Entries**: Every asset currently registered in the vault was re-emitted as a log line on every view, creating the false appearance of an active swarm session.
3. **No Event Metadata**: No exact timestamps, severity levels, event IDs, execution latencies, or structured payloads were inspectable.
4. **No Distinction of Telemetry**: System health checks, static asset inventory, and scan outcomes were blurred into a single terminal dump.

### 4.2 Actual Backend Operations and Persistent Event Records

FixProof possesses concrete operational event sources across its backend pipeline:

| Pipeline Stage | Backend Component | Event Type | Persisted Source of Truth | Event Payload Content |
| :--- | :--- | :--- | :--- | :--- |
| **Vault Ingestion** | `extractor.py`, `registry.py` | `VAULT_INGEST` | `reference_assets`, `frames/` | `asset_id`, `filename`, `duration_seconds`, `frame_count`, `uploaded_at` |
| **Vector Indexing** | `vault.py`, `cloud_ingest.py` | `VAULT_INDEXED` | `vault_snapshots`, FAISS index | `asset_id`, `indexed_vectors`, `vector_dim` (576), `faiss_metric` (L2) |
| **Video Investigation** | `matcher.py`, `timeline.py` | `VIDEO_SCAN_COMPLETED` | `incidents` table / JSON | `incident_id`, `suspect_filename`, `highest_confidence`, `lowest_l2_distance`, `total_frames_analyzed`, `overall_status`, `scanned_at` |
| **URL Screening** | `url_screener.py` | `URL_SCREENING_COMPLETED`| `incidents` table / JSON | `incident_id`, `source_url`, `platform`, `thumbnail_url`, `overall_status`, `scanned_at` |
| **AI Synthesis** | `nemotron_engine.py` | `NEMOTRON_REPORT_SYNTHESIZED`| `nemotron_reports` table / JSON | `report_id`, `incident_id`, `model_id`, `validation_status`, `recommended_action`, `tokens`, `latency_ms`, `created_at` |
| **Evidence Packaging** | `evidence_package.py` | `EVIDENCE_PACKAGE_EXPORTED` | `evidence_packages`, Chain-of-Custody | `package_id`, `incident_id`, `sha256_hash`, `signing_key_id`, `chain_length`, `created_at` |
| **Service Health** | `main.py` (`/health`) | `SYSTEM_HEARTBEAT` | Live REST endpoint | `status`, `vault_size`, `embedding_dim`, `cloud_mode` |

### 4.3 Classification of Event Sources

- **Persisted Events**: Ingestion, indexing, video scans, URL screenings, Nemotron reports, and evidence package exports are permanently persisted with timestamps and identifiers.
- **Live-Only Telemetry**: Backend connectivity status (`backendOnline`) and real-time FAISS index size are queried dynamically via `/health` and `/api/vault/status`.
- **WebSocket Streaming**: FixProof does not currently run a WebSocket daemon or Celery queue. Real-time polling is executed via REST intervals (`DashboardConsole.tsx`). Claiming WebSocket streaming or multi-agent swarm messaging is **Simulated** and must be avoided.

---

## 5. Architectural Redesign Decisions

### 5.1 Intelligence & Analytics
1. **Visual Style**: Dark charcoal foundation (`#121211`, `#171615`), warm off-white typography (`#f4efe6`, `#eee7db`, `#aba497`), restrained amber/teal emphasis, compact borders (`rgba(238, 231, 219, 0.08)`). Zero rainbow gradients or pulsing decorative rings.
2. **Top KPI Row**: 4 crisp, verifiable cards:
   - Protected Reference Assets (with indexed % and frame counts).
   - FAISS Feature Vectors (exact vector count and MobileNetV3 576-dim descriptor).
   - Total Investigations (modality split: video file scans vs URL screenings).
   - Candidate Matches Flagged (candidate match vs suspect vs clean vs unindexed).
3. **Outcome Distribution**: Real counts and percentages for `CANDIDATE_MATCH`, `SUSPECT`, `NEEDS_FULL_VIDEO_REVIEW`, `CLEAN`, and `NO_REFERENCE_DATA`.
4. **Chronological Telemetry**: Displays recent scans ordered by `scanned_at` with genuine similarity percentages and L2 distances.
5. **Reference Asset Footprint**: Tabular catalog showing frame count, indexed vector count, and observed incident match frequency per asset.
6. **Platform Intelligence**: Platform distribution displayed only for verified URL screenings (`YouTube`, `TikTok`, `X / Twitter`, `Web URL`). Clear disclosure that cross-platform leak trees require cryptographic watermarks or API repost lineages.

### 5.2 Swarm Logs (Forensic Event Explorer)
1. **Replace Monolithic Terminal**: Replace the fake looped terminal with a structured **Forensic Event Explorer**.
2. **Summary KPI Strip**: Total events in scope, investigation events, vault indexing events, AI reasoning events, and system connection health.
3. **Structured Event Feed**:
   - Timestamp (ISO time).
   - Category / Operation Badge (`INVESTIGATION`, `VAULT`, `AI REASONING`, `SYSTEM`).
   - Severity / Status (`FLAGGED`, `CLEAN`, `INDEXED`, `VALIDATED`, `ONLINE`).
   - Summary description with identifiers (`incident_id`, `asset_id`, `filename`).
4. **Functional Category Filters**: `All`, `Investigations`, `Vault & Indexing`, `AI Reports`, `Warnings / Flagged`.
5. **Interactive Search**: Filter by filename, identifier, or keyword.
6. **Expandable Payload Drawer**: Inspect structured JSON event details (L2 distances, frame counts, model parameters) without exposing backend secrets.
7. **Explicit Telemetry Separation**: System health and backend availability are cleanly separated from persistent forensic audit records.

---

## 6. Audit Sign-Off

- **NVIDIA Implementation**: In progress (`~/projects/FIXPROOF`).
- **Meta Implementation**: Synchronization scheduled (`~/projects/fixproof-muse-hackathon`).
- **MediaGuardSports**: Read-only reference preserved without modification.
