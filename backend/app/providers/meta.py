"""Opt-in Meta adapters preserving the existing FixProof provider interfaces."""
import base64
from datetime import datetime, timezone
import io
import json
import os
import time
import uuid

from PIL import Image
from pydantic import BaseModel, ConfigDict
from typing import Any, Dict, List, Literal, Optional

from app.providers.base import BaseVisionProvider, BaseReasoningProvider
from app.providers.meta_client import MuseClient, MetaAPIError, DEFAULT_MODEL

VISION_PROMPT_VERSION = "meta-vision-v1"
REASONING_PROMPT_VERSION = "meta-reasoning-v1"


class VisionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    visual_correspondence: Literal["HIGH_CORRESPONDENCE", "POSSIBLE_REUSE", "UNRELATED_SCENE", "UNVERIFIED"]
    confidence_assessment: Literal["HIGH", "MODERATE", "LOW", "INCONCLUSIVE"]
    matching_features: List[str]
    contradictions: List[str]
    reasoning: str
    uncertainty_factors: List[str]


def schema_format(name, schema):
    return {"type": "json_schema", "json_schema": {"name": name, "strict": False, "schema": schema}}


class MetaVisionProvider(BaseVisionProvider):
    provider_name = property(lambda self: "muse")
    model_id = property(lambda self: os.getenv("MUSE_VISION_MODEL", DEFAULT_MODEL))

    def verify_candidate_pair(
        self,
        suspect_image_bytes: bytes,
        reference_image_bytes: bytes,
        suspect_metadata: Optional[Dict[str, Any]] = None,
        reference_metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        # Reuse only deterministic image preparation and model-keyed cache utilities.
        from app import vision_verifier as verifier
        suspect, reference = suspect_metadata or {}, reference_metadata or {}
        context = {"candidate_pair_index": suspect.get("candidate_pair_index", 0),
                   "suspect_timestamp_sec": suspect.get("timestamp_sec", 0.0),
                   "reference_timestamp_sec": reference.get("timestamp_sec", 0.0),
                   "source_asset_id": reference.get("asset_id", ""), "model_id": self.model_id,
                   "verified_at": datetime.now(timezone.utc).isoformat()}
        started = time.perf_counter()
        failure_status = "FAILED"
        response_received = False
        try:
            with Image.open(io.BytesIO(suspect_image_bytes)) as s, Image.open(io.BytesIO(reference_image_bytes)) as r:
                _, sb = verifier.resize_image_for_verification(s)
                _, rb = verifier.resize_image_for_verification(r)
            key = verifier.compute_pair_cache_key(sb, rb, self.model_id, VISION_PROMPT_VERSION)
            cached = verifier.get_cached_verification(key)
            if cached:
                caller_context = {k: v for k, v in context.items() if k != "verified_at"}
                return {**cached, **caller_context, "cached": True}
            failure_status = "VERIFICATION_UNAVAILABLE"
            images = [{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(data).decode("ascii")}} for data in (sb, rb)]
            response = MuseClient().complete({"model": self.model_id,
                "messages": [{"role": "user", "content": [{"type": "text", "text": verifier.VERIFICATION_SYSTEM_PROMPT}] + images}],
                "response_format": schema_format("frame_verification", VisionOutput.model_json_schema()),
                "max_tokens": verifier.DEFAULT_REASONING_MAX_TOKENS, "temperature": 0.1},
                timeout_sec=verifier.VERIFICATION_TIMEOUT_SEC,
                timeout_ceiling_sec=verifier.VERIFICATION_TIMEOUT_SEC)
            response_received = True
            failure_status = "FAILED"
            data = json.loads(response.choices[0].message.content)
            failure_status = "SCHEMA_VIOLATION"
            parsed = VisionOutput.model_validate(data)
            if not parsed.reasoning.strip():
                raise ValueError("Missing reasoning")
            result = {**parsed.model_dump(), "reasoning": parsed.reasoning.strip(), **context, "validation_status": "VERIFIED", "cached": False,
                      "latency_ms": int((time.perf_counter() - started) * 1000)}
            verifier.store_cached_verification(key, result)
            return result
        except Exception as exc:
            category = exc.category if isinstance(exc, MetaAPIError) else "INVALID_VISION_RESPONSE"
            telemetry = {"latency_ms": int((time.perf_counter() - started) * 1000)} if response_received else {}
            return {**context, **telemetry, "visual_correspondence": "UNVERIFIED", "confidence_assessment": "INCONCLUSIVE",
                    "matching_features": [], "contradictions": [], "reasoning": f"Meta vision unavailable ({category}).",
                    "uncertainty_factors": [category], "validation_status": failure_status}


class MetaReasoningProvider(BaseReasoningProvider):
    provider_name = property(lambda self: "muse")
    model_id = property(lambda self: os.getenv("MUSE_REASONING_MODEL", DEFAULT_MODEL))

    def create_text_completion(
        self,
        request: Dict[str, Any],
        client_options: Optional[Dict[str, Any]] = None,
    ) -> Any:
        # Never forward legacy Nebius keys/endpoints or silently substitute model IDs.
        if client_options is not None:
            raise MetaAPIError("UNSUPPORTED_CLIENT_OPTIONS")
        payload = dict(request)
        model = payload.setdefault("model", self.model_id)
        if model != self.model_id:
            raise MetaAPIError("INVALID_MODEL_OVERRIDE")
        if payload.get("stream") or "extra_headers" in payload or "extra_body" in payload:
            raise MetaAPIError("UNSUPPORTED_REQUEST_OPTIONS")
        response = MuseClient().complete(payload)
        if payload.get("response_format", {}).get("type") == "json_object":
            try:
                parsed = json.loads(response.choices[0].message.content)
                if not isinstance(parsed, dict) or not parsed:
                    raise ValueError
            except (TypeError, ValueError):
                raise MetaAPIError("INVALID_STRUCTURED_OUTPUT") from None
        return response

    def generate_investigation_report(
        self,
        investigation_input: Any,
        model_override: Optional[str] = None,
    ) -> Any:
        from app.evidence_models import InvestigationReport, validate_report_evidence_references
        from app.nemotron_engine import build_user_prompt, build_failed_report, SYSTEM_PROMPT
        model = model_override or self.model_id
        def failure(category):
            report = build_failed_report(investigation_input, model, category, f"Meta investigation unavailable ({category}).")
            report.prompt_version = REASONING_PROMPT_VERSION
            report.limitations_disclosed[0] = "Meta model investigation did not complete successfully."
            return report
        if model != self.model_id:
            return failure("INVALID_MODEL_OVERRIDE")
        started = time.perf_counter()
        try:
            response = self.create_text_completion({"model": model,
                "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": build_user_prompt(investigation_input)}],
                "response_format": schema_format("investigation_report", InvestigationReport.model_json_schema()),
                "max_tokens": int(os.getenv("MUSE_MAX_TOKENS", "16384")), "temperature": 0.1})
            data = json.loads(response.choices[0].message.content)
            # Evidence and provenance are supplied by the application, never the model.
            for field in ("summary", "recommended_action", "confidence_assessment", "findings"):
                if field not in data:
                    raise ValueError("Incomplete report")
            if not isinstance(data["summary"], str) or not data["summary"].strip():
                raise ValueError("Missing report summary")
            report = InvestigationReport.model_validate({**data, "report_id": str(uuid.uuid4()), "incident_id": investigation_input.incident_id,
                "model_id": model, "prompt_version": REASONING_PROMPT_VERSION,
                "timeline_intervals": investigation_input.timeline_intervals, "human_review_required": True})
            valid_ids = {f.evidence_id for f in investigation_input.frames_evidence}
            for interval in investigation_input.timeline_intervals:
                valid_ids.add(interval.interval_id)
                valid_ids.update(interval.evidence_ids)
            valid, _ = validate_report_evidence_references(report, valid_ids)
            if not valid:
                return failure("INVALID_EVIDENCE_REFERENCES")
            report.evidence_references = sorted({eid for f in report.findings for eid in f.evidence_ids})
            if investigation_input.investigation_type == "URL_SCREENING":
                report.recommended_action = "NEEDS_FULL_VIDEO_REVIEW"
                report.limitations_disclosed.insert(0, "Evaluated only public thumbnail artwork; underlying video frames were not acquired or verified.")
            usage = response.usage
            report.operational_metadata = {"model_id": model, "latency_ms": int((time.perf_counter() - started) * 1000),
                "validation_status": "PARTIALLY_VALIDATED" if not report.findings and investigation_input.timeline_intervals else "VALIDATED",
                "prompt_tokens": getattr(usage, "prompt_tokens", None), "completion_tokens": getattr(usage, "completion_tokens", None),
                "total_tokens": getattr(usage, "total_tokens", None), "finish_reason": response.choices[0].finish_reason,
                "errors": [], "created_at": datetime.now(timezone.utc).isoformat()}
            return report
        except Exception as exc:
            return failure(exc.category if isinstance(exc, MetaAPIError) else "INVALID_REPORT_RESPONSE")
