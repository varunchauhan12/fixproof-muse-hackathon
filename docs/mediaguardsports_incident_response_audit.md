# MediaGuardSports Incident Response & "Leak Chain" Audit

**Audit Date:** 2026-10-28  
**Auditor:** FixProof Forensic Engineering Team  
**Reference Repository:** `~/projects/mediaguardsports` (Audited in Read-Only Mode)  
**Target Repositories:** `~/projects/FIXPROOF` (NVIDIA) and `~/projects/fixproof-muse-hackathon` (Meta)  

---

## 1. Executive Summary

A comprehensive source code audit of `~/projects/mediaguardsports` was conducted to establish whether its referenced "LEAK CHAIN" or provenance feature is backed by real source-propagation data, calculated network relationships, hardcoded values, or demo fixtures.

**Definitive Finding:**  
MediaGuardSports contains **no genuine leak-chain engine, no provenance graph, no parent-to-child repost tracking, and no stream-propagation data model**.  
The references to "leak" in MediaGuardSports are strictly:
1. A hardcoded social handle string (`@SportsLeaks_HD`) inside a static landing page demo card.
2. A search query heuristic string in the Spider crawler agent (`f"{base} leaked stream"`).
3. Marketing copy referring to "Zero-Leak Fingerprinting" on static technology/security pages.

FixProof's design principle is **forensic integrity and zero fabrication**. FixProof will not invent a simulated or deceptive "leak chain" visualizer. If provenance or network propagation tracking is introduced in future phases, it must be substantiated by real crawler telemetry, platform lineage metadata, or verifiable repost timestamps.

---

## 2. MediaGuardSports Source Code Evidence

### 2.1 Front-End Audit

1. **`Frontend/src/pages/Landing.jsx` (Lines 630–640) & `Frontend/src/components/landing/TechSection.jsx` (Lines 97–109):**
   - Contains a static mock card entitled `Live Threat Detected`.
   - The data is hardcoded as an array of literal strings:
     ```javascript
     [
       ['platform',    'YouTube',                            '#fbbf24'],
       ['account',     '@SportsLeaks_HD',                    '#e2e8f0'],
       ['title',       '"Champions League Final Full Match"', '#e2e8f0'],
       ['l2_distance', '0.12',                               '#f87171'],
       ['phash_match', 'true',                               '#f87171'],
     ]
     ```
   - No interactive node graph, DAG, or provenance tree exists in the component hierarchy.

2. **`Frontend/src/components/dashboard/IncidentTable.jsx`:**
   - Renders a standard tabular/card feed of detected incidents.
   - Filterable by platform, severity, and status.
   - Each incident contains only flat scalar fields: `platform`, `account_handle`, `title`, `country`, `confidence_score`, `severity`, and `status`.
   - There are no lineage fields, no `parent_incident_id`, no `repost_source_id`, and no propagation edges.

3. **`Frontend/src/pages/Security.jsx` (Line 25):**
   - Marketing heading: `Zero-Leak Fingerprinting`.
   - Discusses SHA-256 integrity hashing and Polygon blockchain registration, but contains no leak-propagation logic.

### 2.2 Back-End Audit

1. **`Backend/agents/spider.py` (Line 59):**
   - The Spider agent constructs search query keywords:
     ```python
     f"{base} leaked stream",
     ```
   - This is purely an outbound search phrase used to query external platforms for unauthorized streams.

2. **`Backend/server/controllers/` (`archivistController.js`, `enforcerController.js`, `brokerController.js`, `swarmController.js`):**
   - Schema models in MongoDB store independent flat incident documents.
   - The "Blockchain" component (`generateHash` in `utils/blockchain.js`) computes standard local SHA-256 checksums and pairs them with mock transaction strings (`0x...`). No distributed ledger or graph traversal occurs.

---

## 3. Comparison with FixProof Architecture

| Capability | MediaGuardSports Implementation | FixProof Implementation |
| :--- | :--- | :--- |
| **Data Provenance / Leak Chain** | **Non-existent / Marketing string** (`@SportsLeaks_HD`) | **Honest Architectural Boundary**: FixProof evaluates direct video and URL evidence. Does not claim unrecorded propagation graphs. |
| **Computer Vision Matching** | Single float distance (`l2_distance: 0.12`) | **MobileNetV3 1024-dim L2 cosine distances + FAISS indexing** |
| **Perceptual Hashing** | Binary flag (`phash_match: true`) | **16x16 hex perceptual hash with hamming distance calculation** |
| **Evidence Inspection** | Flat metadata card without synchronized video | **Frame-accurate synchronized video player, offset adjustment, and difference-blend overlay** |
| **AI Forensic Investigation** | Standalone prompt generation | **Multi-stage NVIDIA Nemotron 3.5 synthesis (reasoning, interval derivation, risk tiering, caveats)** |
| **Export & Verification** | Mock blockchain hash strings | **Cryptographic ZIP packages with SHA-256 manifest and digital signature verification** |

---

## 4. Recommendations for FixProof Incident Response

1. **Do not fabricate a "Leak Chain" widget:**  
   Screenshots or mock concepts from MediaGuardSports showing leak trees should not be copied as simulated data. Presenting simulated propagation graphs would breach FixProof's forensic rigor.
2. **Focus on Verified Incident Evidence:**  
   The primary visual anchor must remain the **Evidence Viewer** (suspect video vs. vaulted reference video, keyframe markers, synchronized transport, difference-blend inspection, and frame similarity metrics).
3. **Streamline Investigation Workflow:**  
   Retain the full NVIDIA Nemotron 3.5 investigation report, report history, and evidence package export/verification in a consolidated, compact layout directly beneath the evidence viewer.
