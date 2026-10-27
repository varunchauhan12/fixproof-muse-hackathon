# MediaGuardSports Reference Notes for FixProof

## Overview
This document records engineering patterns and architectural concepts reviewed from the reference project `~/projects/mediaguardsports` to guide FixProof's multi-phase roadmap.

> **Constraint Reminder:** `mediaguardsports` is strictly READ-ONLY. No edits, commits, or pushes may be made there. Code and patterns are analyzed for conceptual parity, clean interfaces, and architectural alignment.

---

## 1. Modules Inspected

| Module / Path | Responsibilities & Capabilities |
|---|---|
| `agents/adjudicator.py` | Structured legal triage, confidence scoring heuristics, statutory defense analysis (fair use, transformative work, de minimis), and recommendation schema. |
| `agents/sentinel.py` | Multi-candidate temporal alignment, frame-level visual verification, perceptual hash Hamming thresholding, and continuous segment clustering. |
| `agents/archivist.py` | Incident evidence archiving, report versioning, cryptographic payload hashing, and persistence across local storage and relational backends. |
| `Frontend/src/components/dashboard/IncidentTable.jsx` | Incident triage listing, status filtering, severity badges, and fast report preview selection. |
| `Frontend/src/components/dashboard/ThreatHunter.jsx` | Side-by-side video frame inspection, MobileNet feature distance visualization, timeline scrubbing, and investigation launch controls. |

---

## 2. Patterns Relevant to FixProof Phases

### Phase 1.4: Report History & Multi-Version Auditing (Current)
- **Compact Report Indexing:** `archivist.py` generates lightweight metadata summaries for historical listing while lazily loading heavy evidence graphs on demand by report ID. FixProof adopted this pattern via `ReportHistoryItem` and `GET /api/threats/{incident_id}/reports`.
- **Zero-Model Report Recall:** Inspecting historical audit reports must never re-trigger reasoning models; reports are immutable snapshots keyed by report ID.
- **Incident State Isolation:** Report queries must enforce strict incident ID isolation to prevent cross-incident data leaks.

### Future Phase 2: Advanced Temporal Clustering & Video Scrubbing
- **Interval Synthesis:** Rather than raw independent frame hits, grouping consecutive matches with small temporal gaps into coherent clip intervals (`start_time_s`, `end_time_s`, `duration_s`).
- **Visual Confidence Heatmaps:** Dynamic scoring that elevates confidence when consecutive frames maintain consistent perceptual hash distance.

### Future Phase 3: Adaptive Agent Orchestration
- **Dual-Tier Reasoning:** Fast pre-screening with lightweight vision models followed by deep-reasoning synthesis for borderline confidence scores.
- **Explainable Limitations:** Explicit tracking of why certain evidence could not be confirmed (e.g., occlusion, low resolution, heavy compression).
