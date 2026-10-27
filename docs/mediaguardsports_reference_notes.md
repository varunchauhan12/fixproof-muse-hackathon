# MediaGuardSports Reference Notes for FixProof

## Overview
This document records engineering patterns and architectural concepts reviewed from the reference project `~/projects/mediaguardsports` to guide FixProof's multi-phase roadmap.

> **Constraint Reminder:** `mediaguardsports` is strictly READ-ONLY. No edits, commits, or pushes may be made there. Code and patterns are analyzed for conceptual parity, clean interfaces, and architectural alignment.

---

## 1. Modules Inspected

| Module / Path | Responsibilities & Capabilities |
|---|---|
| `Backend/agents/adjudicator.py` | Structured legal triage, confidence scoring heuristics, statutory defense analysis (fair use, transformative work, de minimis), and recommendation schema. |
| `Backend/agents/sentinel.py` | MobileNetV3 (576-dim) feature extraction, FAISS vector search, perceptual hash Hamming thresholding, and thumbnail triage. |
| `Backend/agents/archivist.py` | Video frame extraction via OpenCV (`cv2.VideoCapture`), frame embedding generation, and reference library indexing. |
| `Backend/agents/spider.py` | OSINT query generation via LLM, YouTube metadata crawling via `yt-dlp` (`download=False`), and geographic threat aggregation. |
| `Frontend/src/components/dashboard/IncidentTable.jsx` | Incident triage listing, status filtering, severity badges, and fast report preview selection. |
| `Frontend/src/components/dashboard/Analytics.jsx` | Recharts timeline line chart of confidence scores across scanned clips. |

---

## 2. Patterns Relevant to FixProof Phases

### Phase 1.4: Report History & Multi-Version Auditing
- **Compact Report Indexing:** `archivist.py` generates lightweight metadata summaries for historical listing while lazily loading heavy evidence graphs on demand by report ID. FixProof adopted this pattern via `ReportHistoryItem` and `GET /api/threats/{incident_id}/reports`.
- **Zero-Model Report Recall:** Inspecting historical audit reports must never re-trigger reasoning models; reports are immutable snapshots keyed by report ID.
- **Incident State Isolation:** Report queries must enforce strict incident ID isolation to prevent cross-incident data leaks.

### Phase 1.5: Signed Evidence Packages & Chain of Custody
- **Integrity Attestation & Proof References:** `enforcer.py` references cryptographic integrity proofs (`Integrity Hash (FAISS Proof)`) when assembling formal DMCA notices under 17 U.S.C. § 512(c).
- **Canonical Ledger & Cryptographic Signatures:** FixProof advanced this pattern into an Ed25519-signed packaging pipeline:
  - Hash-linked `chain_of_custody.json` tracking genesis, report iterations, and export events with SHA-256 sequential linking.
  - Deterministic manifest canonicalization (`manifest.json` signed as `manifest.sig`).
  - Professional ReportLab `summary.pdf` generation with forensic disclaimers and human-review attestation.
  - In-memory package export and verification endpoints with path-traversal (ZipSlip) defense.

### Phase 2.1 Audit Insights: Video Playback, Frame Matching & Scoring Limitations

1. **Origin of the ~50% Confidence Score Anomaly:**
   - In `sentinel.py`:
     ```python
     def _l2_to_confidence(distance: float) -> float:
         return round(max(0.0, (1.0 - distance / 2.0)) * 100, 2)
     ```
   - This formula was directly adopted in FixProof's `matcher.py`.
   - Because MobileNetV3 features in the positive orthant $\mathbb{R}^{576}_{\ge 0}$ have an expected dot product of $\approx 0.50$ for unrelated natural images, their Euclidean distance naturally clusters around $d = \sqrt{2(1 - 0.50)} = 1.00$.
   - This produces an artificial ~50% confidence score on unrelated images, misleading human reviewers. FixProof Phase 2.2 must replace this linear heuristic with a piecewise calibrated curve where the noise floor ($d \ge 0.85$) evaluates to $0\%$.

2. **Hardcoded Frame 0 Flaw in MediaGuardSports Sentinel:**
   - In `sentinel.py:73-84`:
     ```python
     vault_meta = metadata_store.get("0", {})
     video_path = vault_meta.get("video_path", "")
     if video_path and os.path.exists(video_path):
         cap = cv2.VideoCapture(video_path)
         ret, frame = cap.read() # Reads frame 0 of video 0!
     ```
   - When checking pHash, MediaGuardSports hardcoded asset `"0"` and read frame 0, rather than comparing against the actual matching frame at the matched timestamp!
   - FixProof avoids this defect: `matcher.py:load_reference_frame_image` dynamically resolves the exact matched frame file from disk or Supabase Storage.

3. **Absence of Video Playback in MediaGuardSports:**
   - MediaGuardSports had **no side-by-side video playback**, **no dual video elements**, and **no synchronized timeline scrubbing**.
   - Its frontend rendered only static image cards and a Recharts line graph.
   - FixProof Phase 2.2 introduces an actual synchronized dual HTML5 video player with master-follower playback and offset alignment ($\Delta t = t_{\text{suspect}} - t_{\text{ref}}$).

4. **Multi-Frame Storyboard Extraction:**
   - MediaGuard's `spider.py` only passed a single thumbnail URL to `sentinel.py`.
   - FixProof's Phase 2.2 design incorporates public storyboard/sprite sheets (when exposed in public metadata) to allow multi-frame candidate screening without downloading third-party streams.

### Future Phase 3: Adaptive Agent Orchestration
- **Dual-Tier Reasoning:** Fast pre-screening with lightweight vision models followed by deep-reasoning synthesis for borderline confidence scores.
- **Explainable Limitations:** Explicit tracking of why certain evidence could not be confirmed (e.g., occlusion, low resolution, heavy compression).
