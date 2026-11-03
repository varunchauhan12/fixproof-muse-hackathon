"""Provider-independent evidence prompts, model override normalization and failed reports."""
from datetime import datetime, timezone
import json
import uuid
from typing import Optional, Set
from app.evidence_models import InvestigationInput, InvestigationReport

PROMPT_VERSION = "v1.0"

SWAGGER_PLACEHOLDERS: Set[str] = {
    "string",
    "<string>",
    "null",
    "none",
    "undefined",
}

def normalize_model_override(raw: Optional[str]) -> Optional[str]:
    """
    Normalizes a model override string.
    Returns None if raw is None, empty, whitespace-only, or a Swagger placeholder ('string').
    """
    if raw is None:
        return None
    val = raw.strip()
    if not val or val.lower() in SWAGGER_PLACEHOLDERS:
        return None
    return val

SYSTEM_PROMPT = """You are FixProof's forensic evidence analyst.
Your objective is to analyze computer vision match metrics, perceptual hashing (pHash) scores,
and reconstructed timeline intervals to synthesize an evidence-grounded investigation report.

CRITICAL OPERATIONAL RULES:
1. You are an evidence analyst, NOT a judge of legal copyright infringement or fair use rights.
2. You MUST NOT claim copyright infringement, piracy, legal ownership, or liability.
3. Every finding in "findings" MUST reference one or more valid evidence IDs provided in the evidence payload
   (either an interval ID like "interval_1_..." or a frame evidence ID like "frame_0_t...").
   Reject or omit any assertion not backed by supplied evidence.
4. If investigation_type is "URL_SCREENING":
   - Only the public static thumbnail was evaluated. The underlying video was NOT downloaded or scanned.
   - You MUST select recommended_action = "NEEDS_FULL_VIDEO_REVIEW".
   - You MUST include a limitation noting that the video content remains unverified.
5. Do NOT call an L2 distance or similarity score a probability. Do NOT invent confidence percentages.
6. Clearly state what cannot be determined from the available data in "unresolved_questions" and "limitations_disclosed".
7. If "vision_verification" is present on matching frames:
   - Report whether the multimodal vision model found "HIGH_CORRESPONDENCE", "POSSIBLE_REUSE", "UNRELATED_SCENE", or "UNVERIFIED".
   - If visual_correspondence is "UNVERIFIED", note that visual verification was unavailable or inconclusive; do NOT claim verified visual correspondence.
   - Clearly separate measured computer-vision metrics (L2 distance, pHash) from model-generated visual correspondence findings.
8. Return ONLY a single valid JSON object strictly matching the required schema. No markdown fences.
9. When visual keyframes (suspect and reference pairs) are provided in the multimodal request:
   - Analyze visual correspondence, scene continuity, and feature persistence across sampled timestamps.
   - Note observed transformations (cropping, scaling, overlay graphics, compression).
   - Explicitly disclose ambiguities, alternative explanations, and limitations of still-frame sampling.
"""

def build_user_prompt(input_data: InvestigationInput) -> str:
    """Constructs the bounded evidence payload sent to the AI model."""
    interval_summaries = []
    for itv in input_data.timeline_intervals:
        interval_summaries.append({
            "interval_id": itv.interval_id,
            "source_asset_id": itv.source_asset_id,
            "suspect_time_range_sec": [itv.suspect_start_sec, itv.suspect_end_sec],
            "source_time_range_sec": [itv.source_start_sec, itv.source_end_sec],
            "duration_sec": itv.duration_sec,
            "frame_count": itv.frame_count,
            "mean_l2_distance": itv.mean_l2_distance,
            "phash_match_ratio": itv.phash_match_ratio,
            "continuity_status": itv.continuity_status,
            "evidence_ids": itv.evidence_ids,
        })

    matching_frames = []
    for f in input_data.frames_evidence:
        if f.similarity_status in ("CONFIRMED_MATCH", "SUSPECT_MATCH") or (f.l2_distance is not None and f.l2_distance < 0.75):
            f_item = {
                "evidence_id": f.evidence_id,
                "suspect_timestamp_sec": f.suspect_timestamp_sec,
                "source_asset_id": f.source_asset_id,
                "source_timestamp_sec": f.source_timestamp_sec,
                "l2_distance": f.l2_distance,
                "phash_match": f.phash_match,
                "similarity_status": f.similarity_status,
            }
            if f.vision_verification:
                f_item["vision_verification"] = {
                    "visual_correspondence": f.vision_verification.get("visual_correspondence"),
                    "confidence_assessment": f.vision_verification.get("confidence_assessment"),
                    "matching_features": f.vision_verification.get("matching_features", []),
                    "contradictions": f.vision_verification.get("contradictions", []),
                    "reasoning": f.vision_verification.get("reasoning", ""),
                    "validation_status": f.vision_verification.get("validation_status"),
                }
            if getattr(f, "sam_segmentation", None):
                sam_data = f.sam_segmentation
                f_item["sam_localization"] = {
                    "model_id": sam_data.get("model_id", "sam-3.1"),
                    "objects_detected": len(sam_data.get("objects", [])),
                    "objects": [
                        {
                            "label": obj.get("label"),
                            "box": obj.get("box", {}).get("normalized_coords") if isinstance(obj.get("box"), dict) else None,
                            "tracking_id": obj.get("tracking_id"),
                        }
                        for obj in sam_data.get("objects", [])
                    ],
                }
            matching_frames.append(f_item)

    payload = {
        "incident_id": input_data.incident_id,
        "investigation_type": input_data.investigation_type,
        "platform": input_data.platform,
        "suspect_filename": input_data.suspect_filename,
        "duration_seconds": input_data.duration_seconds,
        "overall_cv_status": input_data.overall_cv_status,
        "matched_assets": input_data.matched_assets,
        "total_frames_analyzed": len(input_data.frames_evidence),
        "timeline_intervals": interval_summaries,
        "matching_frame_evidence": matching_frames,
    }

    return (
        f"Analyze this computer-vision evidence payload and produce a structured investigation report in JSON.\n\n"
        f"EVIDENCE PAYLOAD:\n{json.dumps(payload, indent=2)}\n\n"
        f"REQUIRED JSON FORMAT:\n"
        f"{{\n"
        f'  "summary": "concise evidence summary (2-3 sentences)",\n'
        f'  "recommended_action": "ESCALATE_LEGAL_TAKEDOWN" | "FLAG_FOR_BROKER_LICENSING" | "DISMISS_FAIR_USE" | "NEEDS_FULL_VIDEO_REVIEW" | "MONITOR_ACCOUNT",\n'
        f'  "confidence_assessment": "HIGH_CONFIDENCE_MATCH" | "MODERATE_PROBABILITY" | "INCONCLUSIVE_DATA" | "CONFIRMED_DISTINCT",\n'
        f'  "human_review_required": false,\n'
        f'  "findings": [\n'
        f'    {{\n'
        f'      "finding_id": "finding_1",\n'
        f'      "category": "TIMELINE_CORRESPONDENCE",\n'
        f'      "statement": "Factual observation citing exact timestamps and metrics.",\n'
        f'      "evidence_ids": ["<must be a valid interval_id or evidence_id from the evidence payload>"]\n'
        f'    }}\n'
        f'  ],\n'
        f'  "unresolved_questions": [],\n'
        f'  "contradictions_detected": [],\n'
        f'  "limitations_disclosed": [],\n'
        f'  "evidence_references": ["<list of all cited evidence_ids>"]\n'
        f"}}\n"
    )

def build_failed_report(
    input_data: InvestigationInput,
    model_id: str,
    failure_type: str,
    error_message: str,
    latency_ms: int = 0,
) -> InvestigationReport:
    """
    Constructs an explicit failed/incomplete report record.
    Never silently fabricates a successful report when the model fails.
    """
    return InvestigationReport(
        report_id=str(uuid.uuid4()),
        incident_id=input_data.incident_id,
        model_id=model_id,
        prompt_version=PROMPT_VERSION,
        summary=f"Investigation incomplete: {failure_type}. {error_message}",
        recommended_action="NEEDS_FULL_VIDEO_REVIEW",
        confidence_assessment="INCONCLUSIVE_DATA",
        human_review_required=True,
        timeline_intervals=input_data.timeline_intervals,
        findings=[],
        unresolved_questions=[f"Automated analysis failed: {error_message}"],
        contradictions_detected=[],
        limitations_disclosed=[
            "AI model investigation did not complete successfully.",
            f"Failure category: {failure_type}",
        ],
        evidence_references=[],
        operational_metadata={
            "model_id": model_id,
            "latency_ms": latency_ms,
            "validation_status": "FAILED_VALIDATION",
            "failure_type": failure_type,
            "errors": [error_message],
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    )
