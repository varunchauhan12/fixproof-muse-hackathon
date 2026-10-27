"""
Bounded Nemotron Report Generator module for FixProof Milestone 6C.6B.
Converts structured computer-vision match evidence and clustered timeline intervals
into validated forensic intelligence reports using NVIDIA Nemotron via Nebius Token Factory.

Operational Constraints:
- Primary Model: nvidia/Nemotron-3_5-Lightning for text-based evidence interpretation.
- Bounded Output: Requests valid structured JSON with response_format={"type": "json_object"}.
- Reasoning Token Protection: Enforces max_tokens >= 1500 to prevent reasoning token starvation.
- Non-Adjudicative: Model is an evidence analyst, not a judge of legal infringement.
- Strict Grounding: Rejects or flags findings that reference nonexistent evidence IDs.
- Privacy & Cleanliness: NEVER stores, exposes, or returns private internal chain-of-thought traces.
"""

from datetime import datetime, timezone
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional, Set, Tuple
import uuid

from openai import OpenAI, APIError, APITimeoutError, RateLimitError, APIConnectionError

from app.evidence_models import (
    InvestigationInput,
    InvestigationReport,
    TimelineInterval,
    FindingItem,
    RecommendedAction,
    ConfidenceAssessment,
    validate_report_evidence_references,
)

logger = logging.getLogger(__name__)

PROMPT_VERSION = "v1.0"
DEFAULT_MODEL = "nvidia/Nemotron-3_5-Lightning"
DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"
DEFAULT_TIMEOUT_SEC = 90.0
DEFAULT_MAX_TOKENS = 16384

ALLOWED_MODELS: Set[str] = {
    "nvidia/Nemotron-3_5-Lightning",
    "nvidia/Nemotron-3.5-Super-VL",
}

SWAGGER_PLACEHOLDERS: Set[str] = {
    "string",
    "<string>",
    "null",
    "none",
    "undefined",
}


def get_allowed_models() -> Set[str]:
    """Returns the set of valid Nemotron models, including any configured via NEBIUS_MODEL."""
    allowed = set(ALLOWED_MODELS)
    env_model = os.getenv("NEBIUS_MODEL")
    if env_model and env_model.strip():
        allowed.add(env_model.strip())
    return allowed


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


def resolve_model_id(model_override: Optional[str] = None) -> str:
    """
    Resolves and validates the model ID.
    - If model_override is absent, blank, or placeholder, returns configured default.
    - If a nonempty model_override is provided, validates against the allowed model set.
    - Raises ValueError if an invalid model is explicitly requested.
    """
    normalized = normalize_model_override(model_override)
    if not normalized:
        return os.getenv("NEBIUS_MODEL", DEFAULT_MODEL)
    allowed = get_allowed_models()
    if normalized not in allowed:
        raise ValueError(
            f"Invalid model override '{model_override}'. Allowed models: {sorted(allowed)}"
        )
    return normalized


VALID_ACTIONS: Set[RecommendedAction] = {
    "ESCALATE_LEGAL_TAKEDOWN",
    "FLAG_FOR_BROKER_LICENSING",
    "DISMISS_FAIR_USE",
    "NEEDS_FULL_VIDEO_REVIEW",
    "MONITOR_ACCOUNT",
}

VALID_ASSESSMENTS: Set[ConfidenceAssessment] = {
    "HIGH_CONFIDENCE_MATCH",
    "MODERATE_PROBABILITY",
    "INCONCLUSIVE_DATA",
    "CONFIRMED_DISTINCT",
}

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
"""

# Reusable client singleton with connection pooling
_client_instance: Optional[OpenAI] = None


def get_openai_client() -> OpenAI:
    """Returns a pooled, configured OpenAI client for Nebius Token Factory."""
    global _client_instance
    if _client_instance is None:
        api_key = os.getenv("NEBIUS_API_KEY")
        if not api_key:
            raise ValueError("NEBIUS_API_KEY is not configured in environment or .env file.")
        base_url = os.getenv("NEBIUS_BASE_URL", DEFAULT_BASE_URL)
        timeout = float(os.getenv("NEBIUS_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC)))
        _client_instance = OpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout,
        )
    return _client_instance


def reset_openai_client() -> None:
    """Resets the cached OpenAI client (useful for unit tests and configuration changes)."""
    global _client_instance
    _client_instance = None


def build_user_prompt(input_data: InvestigationInput) -> str:
    """Constructs the bounded evidence payload sent to the Nemotron model."""
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
            "Nemotron model investigation did not complete successfully.",
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


def generate_nemotron_report(
    input_data: InvestigationInput,
    client: Optional[OpenAI] = None,
    model_override: Optional[str] = None,
    max_tokens_override: Optional[int] = None,
) -> InvestigationReport:
    """
    Executes a bounded, evidence-grounded Nemotron investigation against Nebius Token Factory.
    
    Guarantees:
    - Validates prompt grounding against real evidence IDs.
    - Captures operational metadata (latency, tokens, finish_reason).
    - NEVER exposes or stores private internal reasoning traces.
    - Validates parsed JSON with Pydantic.
    - Rejects references to nonexistent evidence.
    - Returns explicit failed report on network, timeout, or schema errors.
    """
    try:
        model_id = resolve_model_id(model_override)
    except ValueError as ve:
        logger.error(f"[NemotronEngine] Invalid model requested: {ve}")
        return build_failed_report(
            input_data,
            model_override or "invalid_model",
            "INVALID_MODEL_OVERRIDE",
            str(ve),
        )
    max_tokens = max_tokens_override or int(os.getenv("NEBIUS_MAX_TOKENS", str(DEFAULT_MAX_TOKENS)))
    
    # Enforce minimum max_tokens to prevent reasoning token starvation
    if max_tokens < 8192:
        logger.warning(f"[NemotronEngine] max_tokens={max_tokens} is low; bumping to 16384 to prevent reasoning token starvation.")
        max_tokens = 16384

    # Collect all valid evidence IDs from input
    valid_ids: Set[str] = set()
    for itv in input_data.timeline_intervals:
        valid_ids.add(itv.interval_id)
        valid_ids.update(itv.evidence_ids)
    for f in input_data.frames_evidence:
        valid_ids.add(f.evidence_id)

    # Resolve client
    if client is None:
        try:
            client = get_openai_client()
        except Exception as e:
            logger.error(f"[NemotronEngine] Failed to initialize OpenAI client: {e}")
            return build_failed_report(input_data, model_id, "CLIENT_INITIALIZATION_ERROR", str(e))

    user_prompt = build_user_prompt(input_data)
    start_time = time.perf_counter()

    try:
        response = client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            max_tokens=max_tokens,
            temperature=0.1,
        )
    except APITimeoutError as te:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        logger.error(f"[NemotronEngine] API timeout after {latency_ms}ms: {te}")
        return build_failed_report(input_data, model_id, "API_TIMEOUT", f"Request timed out: {te}", latency_ms)
    except RateLimitError as rle:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        logger.error(f"[NemotronEngine] Rate limit exceeded: {rle}")
        return build_failed_report(input_data, model_id, "RATE_LIMIT_EXCEEDED", f"Rate limit: {rle}", latency_ms)
    except APIConnectionError as ace:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        logger.error(f"[NemotronEngine] Connection error: {ace}")
        return build_failed_report(input_data, model_id, "CONNECTION_ERROR", f"Connection error: {ace}", latency_ms)
    except APIError as apie:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        logger.error(f"[NemotronEngine] Provider API error: {apie}")
        return build_failed_report(input_data, model_id, "PROVIDER_API_ERROR", f"API error: {apie}", latency_ms)
    except Exception as exc:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        logger.error(f"[NemotronEngine] Unexpected error: {exc}")
        return build_failed_report(input_data, model_id, "UNEXPECTED_ERROR", str(exc), latency_ms)

    latency_ms = int((time.perf_counter() - start_time) * 1000)

    # 1. Inspect completion choice
    if not response.choices:
        return build_failed_report(input_data, model_id, "EMPTY_CHOICES", "Provider returned no completion choices.", latency_ms)

    choice = response.choices[0]
    finish_reason = choice.finish_reason

    # 2. Check for truncation due to token limits
    if finish_reason == "length":
        logger.warning(f"[NemotronEngine] Model stopped with finish_reason='length'. Content truncated.")
        return build_failed_report(
            input_data,
            model_id,
            "TOKEN_BUDGET_EXHAUSTED",
            "Model response was truncated before completion because reasoning tokens exhausted the token budget.",
            latency_ms,
        )

    # 3. Extract and parse JSON content
    raw_content = choice.message.content or ""
    if not raw_content.strip():
        return build_failed_report(input_data, model_id, "EMPTY_CONTENT", "Model returned an empty content string.", latency_ms)

    try:
        parsed_json = json.loads(raw_content)
    except json.JSONDecodeError as jde:
        logger.error(f"[NemotronEngine] Failed to parse model JSON: {jde}")
        return build_failed_report(input_data, model_id, "INVALID_JSON", f"Malformed JSON: {jde}", latency_ms)

    if not isinstance(parsed_json, dict):
        return build_failed_report(input_data, model_id, "INVALID_ROOT_TYPE", "Model output root must be a JSON object.", latency_ms)

    # 4. Extract token usage metadata
    usage = response.usage
    prompt_tokens = usage.prompt_tokens if usage else None
    completion_tokens = usage.completion_tokens if usage else None
    total_tokens = usage.total_tokens if usage else None

    # 5. Validate action and assessment against database check constraints
    rec_action = parsed_json.get("recommended_action")
    if rec_action not in VALID_ACTIONS:
        rec_action = "NEEDS_FULL_VIDEO_REVIEW"

    # Enforce URL_SCREENING mandatory rule
    if input_data.investigation_type == "URL_SCREENING":
        rec_action = "NEEDS_FULL_VIDEO_REVIEW"

    conf_assess = parsed_json.get("confidence_assessment")
    if conf_assess not in VALID_ASSESSMENTS:
        conf_assess = "INCONCLUSIVE_DATA"

    # 6. Parse findings and validate evidence references
    raw_findings = parsed_json.get("findings") or []
    validated_findings: List[FindingItem] = []
    finding_errors: List[str] = []

    for idx, f_item in enumerate(raw_findings):
        if not isinstance(f_item, dict):
            continue
        fid = str(f_item.get("finding_id") or f"finding_{idx + 1}")
        cat = f_item.get("category")
        if cat not in ("TIMELINE_CORRESPONDENCE", "PERCEPTUAL_SIMILARITY", "ANOMALY_OR_DISCREPANCY", "LIMITATION"):
            cat = "TIMELINE_CORRESPONDENCE"
        stmt = str(f_item.get("statement") or "")
        eids = f_item.get("evidence_ids") or []
        if isinstance(eids, str):
            eids = [eids]
        metrics = f_item.get("measured_metrics") or {}

        # Filter out invalid evidence references
        valid_f_eids = [eid for eid in eids if eid in valid_ids]
        invalid_f_eids = [eid for eid in eids if eid not in valid_ids]

        if invalid_f_eids:
            finding_errors.append(f"Finding '{fid}' cited nonexistent evidence IDs: {invalid_f_eids}")

        if valid_f_eids and stmt:
            validated_findings.append(
                FindingItem(
                    finding_id=fid,
                    category=cat,
                    statement=stmt,
                    evidence_ids=valid_f_eids,
                    measured_metrics=metrics if isinstance(metrics, dict) else {},
                )
            )

    # Enforce URL_SCREENING limitation disclosure
    limitations = parsed_json.get("limitations_disclosed") or []
    if input_data.investigation_type == "URL_SCREENING":
        url_lim = "Evaluated only public thumbnail artwork; underlying video frames were not acquired or verified."
        if url_lim not in limitations:
            limitations.insert(0, url_lim)

    evidence_refs = list({eid for f in validated_findings for eid in f.evidence_ids})

    validation_status = "VALIDATED"
    errors = finding_errors[:]
    if not validated_findings and input_data.timeline_intervals:
        validation_status = "PARTIALLY_VALIDATED"
        errors.append("Model failed to provide valid grounded findings matching timeline intervals.")

    operational_metadata = {
        "model_id": model_id,
        "latency_ms": latency_ms,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "finish_reason": finish_reason,
        "validation_status": validation_status,
        "errors": errors,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    return InvestigationReport(
        report_id=str(uuid.uuid4()),
        incident_id=input_data.incident_id,
        model_id=model_id,
        prompt_version=PROMPT_VERSION,
        summary=str(parsed_json.get("summary") or "Investigation completed with verified computer-vision evidence."),
        recommended_action=rec_action,
        confidence_assessment=conf_assess,
        human_review_required=bool(parsed_json.get("human_review_required", False)),
        timeline_intervals=input_data.timeline_intervals,
        findings=validated_findings,
        unresolved_questions=parsed_json.get("unresolved_questions") or [],
        contradictions_detected=parsed_json.get("contradictions_detected") or [],
        limitations_disclosed=limitations,
        evidence_references=evidence_refs,
        operational_metadata=operational_metadata,
    )
