# FixProof Audit: Nemotron Intelligence & Action Center Architecture

**Phase:** 3.5 — Step 1  
**Date:** October 28, 2026  
**Repositories:**
- Primary (NVIDIA): `~/projects/FIXPROOF`
- Secondary (Meta): `~/projects/fixproof-muse-hackathon`
- Read-Only Reference: `~/projects/mediaguardsports`

---

## 1. Executive Summary

This audit establishes the baseline capabilities, data flows, model configurations, and missing components required to build the dedicated **Nemotron Intelligence & Action Center** in FixProof.

FixProof is an evidence-first video investigation platform. Its AI capabilities assist human investigators by synthesizing computer vision data into structured findings, evaluating visual frame correspondence, and drafting formal legal notices and commercial licensing proposals.

This page connects the complete end-to-end operational pipeline:
$$\text{Investigated Video} \longrightarrow \text{Forensic Evidence} \longrightarrow \text{Nemotron Analysis} \longrightarrow \text{Draft Document} \longrightarrow \text{Human Review} \longrightarrow \text{Email Delivery}$$

---

## 2. Audit of Existing Nemotron Capabilities

### 2.1 Text Reasoning & Forensic Report Synthesis
- **Component**: `backend/app/nemotron_engine.py` (`generate_nemotron_report`).
- **Configured Model**: `nvidia/Nemotron-3_5-Lightning` via Nebius Token Factory (`https://api.tokenfactory.nebius.com/v1/`).
- **Endpoint**: `POST /api/threats/{incident_id}/investigate` (payload: `InvestigateIncidentRequest`).
- **Prompt Version**: `v1.0`. System prompt enforces strict non-adjudicative constraints:
  - Model acts strictly as an evidence analyst, not a judge of copyright infringement.
  - Model must cite valid evidence IDs (`interval_id` or `evidence_id`) provided in the evidence payload.
  - Single-frame screens (`URL_SCREENING`) require `NEEDS_FULL_VIDEO_REVIEW`.
- **Output Schema**: Pydantic typed `InvestigationReport`:
  - `summary`: Concise factual synthesis.
  - `recommended_action`: `ESCALATE_LEGAL_TAKEDOWN`, `FLAG_FOR_BROKER_LICENSING`, `DISMISS_FAIR_USE`, `NEEDS_FULL_VIDEO_REVIEW`, `MONITOR_ACCOUNT`.
  - `confidence_assessment`: `HIGH_CONFIDENCE_MATCH`, `MODERATE_PROBABILITY`, `INCONCLUSIVE_DATA`, `CONFIRMED_DISTINCT`.
  - `human_review_required`: Boolean flag.
  - `findings`: Array of `FindingItem` objects citing valid evidence IDs.
  - `limitations_disclosed`, `unresolved_questions`, `contradictions_detected`.
- **Validation**: `validate_report_evidence_references` verifies that all cited evidence IDs exist.
- **Persistence**: `save_nemotron_report` saves to PostgreSQL `nemotron_reports` or `storage/nemotron_reports.json`.
- **Error Handling**: `build_failed_report` explicitly constructs an incomplete report on timeout (90s) or API error; never fabricates a fake success.

### 2.2 Multimodal Vision-Assisted Verification
- **Component**: `backend/app/vision_verifier.py` (`verify_candidate_pair`).
- **Configured Model**: `nvidia/Nemotron-3.5-Super-VL` via Nebius Token Factory.
- **Call Sites**:
  - `backend/app/matcher.py`: Executed on candidate frame matches during video scan.
  - `backend/app/url_screener.py`: Executed on thumbnail matches during URL screening.
- **Operational Bounds**:
  - Max 3 candidate pairs per incident.
  - Images resized to max 512px maintaining aspect ratio.
  - 15-second timeout with graceful fallback returning `UNVERIFIED`.
- **Output Schema**: Validated JSON containing:
  - `visual_correspondence`: `HIGH_CORRESPONDENCE`, `POSSIBLE_REUSE`, `UNRELATED_SCENE`, `UNVERIFIED`.
  - `matching_features`: Array of observed visual correlations.
  - `contradictions`: Array of visual discrepancies.
  - `reasoning`: Concise factual explanation.
- **Caching**: SHA-256 evidence hash cache (`storage/cache/vision_verification_cache.json` and Supabase DB `vision_verification_cache`).

### 2.3 Timeline Clustering & Match Continuity
- **Components**: `backend/app/timeline.py`, `backend/app/evidence_models.py`.
- **Function**: Clusters consecutive frame matches into `TimelineInterval` records:
  - `interval_id`, `suspect_time_range_sec`, `source_time_range_sec`, `duration_sec`, `frame_count`, `mean_l2_distance`, `phash_match_ratio`.
  - `continuity_status`: `CONTINUOUS_MATCH`, `SPARSE_MATCH`, `SINGLETON`.
- Pre-computed before Nemotron prompt synthesis.

### 2.4 Investigation History & Versioning
- **Endpoints**:
  - `GET /api/threats/{incident_id}/reports`: Returns list of `ReportHistoryItem` records ordered newest-first.
  - `GET /api/threats/reports/{report_id}`: Fetches specific report snapshot.
  - `GET /api/threats/{incident_id}/report`: Returns latest report.
- **Isolation**: Session-scoped via `x-client-session-id` header.

### 2.5 Current Enforcement & Licensing State
- **Component**: `frontend/components/dashboard/SecondaryViews.tsx` (`EnforcementView`).
- **Current State**: Displays incidents where `candidate_matches_found > 0`. "Draft Notice" and "Offer Rev-Share" buttons currently trigger client-side `alert()` dialogs.
- **Required Action**: Upgrade these actions to link into the new Nemotron Action Center with incident and document type preselected.

### 2.6 Email Delivery & Infrastructure
- **Current State**: **Unavailable / Not Implemented**. No email provider or dispatch routes exist in the backend.
- **Required Action**:
  - Implement server-side Resend email integration (`/api/nemotron/send-email`).
  - Read `RESEND_API_KEY` and `FROM_EMAIL` from server environment variables.
  - Provide a safe disabled state if credentials are not configured.
  - Enforce explicit human review and confirmation before sending.
  - Record audit log entries in `storage/email_audit_log.json` / database.

---

## 3. Provider and Model Verification

| Task | Specified Provider | Active Model ID | Configuration Source |
| :--- | :--- | :--- | :--- |
| **Forensic Reasoning** | Nebius Token Factory / NVIDIA | `nvidia/Nemotron-3_5-Lightning` | `NEBIUS_MODEL` / `DEFAULT_MODEL` in `nemotron_engine.py` |
| **Vision Verification** | Nebius Token Factory / NVIDIA | `nvidia/Nemotron-3.5-Super-VL` | `VISION_MODEL_ID` in `vision_verifier.py` |
| **Document Drafting** | Nebius Token Factory / NVIDIA | `nvidia/Nemotron-3_5-Lightning` | Document generator backend service |
| **Email Delivery** | Resend API | N/A (Email Service) | `RESEND_API_KEY`, `FROM_EMAIL` |
| **Meta Muse (Hackathon)** | Meta Muse (Scaffolding) | `meta-models/muse-spark-open` | Preserved in `providers/muse.py`; inactive for Phase 3.5 |

---

## 4. Integration & Implementation Plan

### Step 2: Dedicated Nemotron Action Center Page
- Add `nemotron` to `NavTab` in `Sidebar.tsx` and `DashboardConsole.tsx`.
- Visual styling: Dark charcoal surfaces (`#121211`, `#171615`), off-white typography (`#f4efe6`, `#eee7db`, `#aba497`), restrained teal accents.
- Section A: Model capability and live health overview.
- Section B: Investigation selector (browsing real incidents, outcomes, frame matches).
- Section C: Investigation workspace (inspecting evidence, report generation, findings citations, report history).

### Step 3: Evidence-Backed Document Generation
- Endpoint: `POST /api/nemotron/draft-document`.
- Document Type 1: **Draft Copyright Notice**:
  - Distinguishes imported evidence facts (suspect URL, matched frames, observation dates) from user-supplied rights-holder details and jurisdiction.
  - Requires user declarations (good faith statement, authority to act) without fabricating statutory representation.
- Document Type 2: **Draft Revenue-Sharing Offer**:
  - Formulates commercial outreach for discussion/licensing.
  - Incorporates user-specified split % and contact terms without inventing contracts or alleging guilt.

### Step 4: Shared Document Editor & Review
- Interactive editor supporting subject/body revision, missing-field highlights, and preview before confirmation.

### Step 5: Server-Side Email Delivery
- Endpoint: `POST /api/nemotron/send-email`.
- Status endpoint: `GET /api/nemotron/email-status`.
- Delivery via Resend API with server-side validation.
- Audit trail recorded in `storage/email_audit_log.json`.
- Safely disabled when `RESEND_API_KEY` is absent.

### Step 6: Enforcement & Licensing Linkage
- Update `EnforcementView` so "Draft Notice" and "Offer Rev-Share" buttons route to the Nemotron page with the target incident and document type pre-loaded.
