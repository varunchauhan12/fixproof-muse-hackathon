"""Bounded, deterministic read tools. No providers, actions, endpoint calls or I/O on import.

Caller supplies session context separately from model arguments. Bind RegistryReadStore
with the application's already-loaded registry module; this module never initializes
its vault, report generator, database or filesystem services.
"""
from datetime import datetime, timezone
import json
import math
import re
from types import MappingProxyType
from typing import Literal

from pydantic import Field, ValidationError

from app.evidence_models import build_frame_evidence_from_matches
from app.muse_conversations import Contract, Reference, validate_session, ConversationError
from app.security import safe_diagnostic
from app.timeline import cluster_frame_matches

MAX_INCIDENTS = 25
MAX_FRAMES = 50
MAX_REPORTS = 20
MAX_RESULT_BYTES = 96 * 1024


class ToolFailure(Exception):
    def __init__(self, code):
        self.code = code


ERRORS = {
    "NOT_FOUND": "The requested stored data was not found.",
    "ACCESS_DENIED": "The requested data does not belong to this session.",
    "INVALID_ARGUMENT": "Supply a known tool, valid session and valid tool arguments.",
    "DATA_UNAVAILABLE": "Stored data is unavailable or cannot be safely represented within tool limits.",
    "INTERNAL_ERROR": "The read operation could not be completed.",
}


class ToolError(Contract):
    code: Literal["NOT_FOUND", "ACCESS_DENIED", "INVALID_ARGUMENT", "DATA_UNAVAILABLE", "INTERNAL_ERROR"]
    detail: str


class MuseToolResult(Contract):
    tool: str
    status: Literal["success", "error"]
    data: dict | None = None
    error: ToolError | None = None


class ListArguments(Contract):
    limit: int = Field(default=10, strict=True, ge=1, le=MAX_INCIDENTS)


class EmptyArguments(Contract):
    pass


class IncidentArguments(Contract):
    incident_id: Reference


class RegistryReadStore:
    """Only existing retrieval services; no history helper that guesses provider/model.

    Explicit module injection avoids importing registry (which creates directories)
    during tool import or execution. The normal app already loads registry at startup.
    """
    def __init__(self, registry_module):
        self.registry = registry_module

    def list_incidents(self, session_id):
        return self.registry.load_incidents(session_id=session_id, exact_session=True)

    def get_incident(self, incident_id):
        return self.registry.get_incident_by_id(incident_id, strict_read=True)

    def get_reports(self, incident_id):
        return self.registry.get_investigation_reports_for_incident(incident_id, strict_read=True)


def text(value, limit=500):
    if not isinstance(value, str):
        return None
    value = safe_diagnostic(value)
    # No URLs (including signed URLs/credentials), absolute filesystem paths or key assignments.
    value = re.sub(r"(?:https?|file)://\S+", "[redacted URL]", value, flags=re.I)
    value = re.sub(r"(?<!\w)(?:[A-Za-z]:[\\/]|/)[^\s,;]+", "[redacted path]", value)
    value = re.sub(r"(?i)\b(?:api[_ -]?key|password|secret|token|authorization)\s*[:=]\s*\S+", "[redacted credential]", value)
    return value[:limit]


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def reference(value):
    return value if isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", value) else None


def strings(value):
    return [text(item) for item in value[:10] if isinstance(item, str)] if isinstance(value, list) else []


def timestamp(value):
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        # Legacy naive stored timestamps are interpreted as UTC, never local machine time.
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError):
        return None


def timestamp_text(value):
    parsed = timestamp(value)
    return parsed.isoformat() if parsed else None


def ordering(record, id_field, date_field):
    parsed = timestamp(record.get(date_field))
    return (parsed or datetime.min.replace(tzinfo=timezone.utc), str(record.get(id_field, "")))


class MuseToolRegistry:
    """One fixed allowlist; execute never dispatches arbitrary function names.

    store is an injected read-only adapter. No session may appear in arguments.
    Errors are fixed categories, never raw exception strings or logging payloads.
    """
    def __init__(self, store, sam_reader=None):
        self.store = store
        self.sam_reader = sam_reader
        self.tools = MappingProxyType({
            "list_recent_incidents": (ListArguments, self._list),
            "get_latest_incident": (EmptyArguments, self._latest),
            "get_incident_details": (IncidentArguments, self._details),
            "get_matching_timestamps": (IncidentArguments, self._matching),
            "get_evidence_bundle": (IncidentArguments, self._bundle),
            "get_investigation_reports": (IncidentArguments, self._history),
        })

    def execute(self, tool: str, *, session_id: str, arguments: dict | None = None) -> MuseToolResult:
        # Unknown names are not reflected, bounding and sanitizing even error results.
        safe_tool = tool if isinstance(tool, str) and tool in self.tools else "unknown"
        try:
            validate_session(session_id)
            if safe_tool == "unknown":
                raise ToolFailure("INVALID_ARGUMENT")
            schema, handler = self.tools[safe_tool]
            args = schema.model_validate({} if arguments is None else arguments)
            data = handler(session_id, args)
            if len(json.dumps(data, allow_nan=False).encode("utf-8")) > MAX_RESULT_BYTES:
                raise ToolFailure("DATA_UNAVAILABLE")
            return MuseToolResult(tool=safe_tool, status="success", data=data)
        except (ValidationError, ConversationError):
            code = "INVALID_ARGUMENT"
        except ToolFailure as exc:
            code = exc.code
        except (OSError, ValueError, TypeError, KeyError):
            code = "DATA_UNAVAILABLE"
        except Exception:
            code = "INTERNAL_ERROR"
        return MuseToolResult(tool=safe_tool, status="error", error=ToolError(code=code, detail=ERRORS[code]))

    def _incident(self, session, incident_id):
        record = self.store.get_incident(incident_id)
        if not record:
            raise ToolFailure("NOT_FOUND")
        if record.get("session_id") != session:
            raise ToolFailure("ACCESS_DENIED")
        if record.get("incident_id") != incident_id:
            raise ToolFailure("DATA_UNAVAILABLE")
        return record

    def _reports(self, incident_id):
        reports = self.store.get_reports(incident_id)
        # Fail closed for any mismatched/orphaned report, including outside returned bounds.
        if any(rep.get("incident_id") != incident_id for rep in reports):
            raise ToolFailure("ACCESS_DENIED")
        return sorted(reports, key=lambda rep: ordering(
            {**rep, "created_at": rep.get("created_at") or (rep.get("operational_metadata") or {}).get("created_at")},
            "report_id", "created_at"), reverse=True)

    def _summary(self, record):
        return {
            "incident_id": reference(record.get("incident_id")),
            "scanned_at": timestamp_text(record.get("scanned_at")),
            "overall_status": text(record.get("overall_status"), 128),
            "investigation_type": text(record.get("investigation_type"), 128),
            "suspect_filename": text(record.get("suspect_filename"), 128),
            "metrics": {key: number(record.get(key)) for key in (
                "total_frames_analyzed", "candidate_matches_found", "highest_confidence",
                "lowest_l2_distance", "duration_seconds")},
            "has_frame_evidence": bool(record.get("frame_matches")),
        }

    def _owned_list(self, session):
        records = self.store.list_incidents(session)
        # Defense in depth even when adapter already uses exact_session.
        records = [r for r in records if r.get("session_id") == session and reference(r.get("incident_id"))]
        return sorted(records, key=lambda rec: ordering(rec, "incident_id", "scanned_at"), reverse=True)

    def _list(self, session, args):
        records = self._owned_list(session)
        items = []
        for record in records[:args.limit]:
            item = self._summary(record)
            item["has_investigation_reports"] = bool(self._reports(record["incident_id"]))
            items.append(item)
        return {"incidents": items, "returned_count": len(items), "truncated": len(records) > args.limit,
                "source_limit_note": "Cloud reads cover at most the latest 200 session-owned incidents; local reads cover stored session records."}

    def _latest(self, session, args):
        records = self._owned_list(session)
        if not records:
            raise ToolFailure("NOT_FOUND")
        # Missing/invalid dates cannot establish a true latest incident.
        if any(timestamp(r.get("scanned_at")) is None for r in records):
            raise ToolFailure("DATA_UNAVAILABLE")
        return self._details(session, IncidentArguments(incident_id=records[0]["incident_id"]))

    def _details(self, session, args):
        record = self._incident(session, args.incident_id)
        result = self._summary(record)
        result.update({
            "investigation_status": text(record.get("investigation_status"), 128),
            "suspect_filename": text(record.get("suspect_filename"), 128),
            "platform": text(record.get("platform"), 128),
            "status_message": text(record.get("status_message")),
            "limitations": strings(record.get("limitations")),
            "disclaimer": text(record.get("disclaimer")),
            "has_investigation_reports": bool(self._reports(args.incident_id)),
        })
        return result

    def _frames(self, record, *, matches_only=True):
        raw = record.get("frame_matches") or []
        valid = []
        missing = 0
        # Do not use evidence helper's 0.0 fallback when the recorded timestamp is missing.
        for index, item in enumerate(raw[:MAX_FRAMES]):
            sub = item.get("submitted_frame") or {}
            suspect = sub.get("timestamp_sec") if sub.get("timestamp_sec") is not None else item.get("timestamp_sec")
            best = item.get("best_match") or {}
            source = best.get("source_timestamp_sec")
            if number(suspect) is None or suspect < 0 or (source is not None and (number(source) is None or source < 0)):
                missing += 1
                continue
            # Preserve the helper's original ordinal when earlier malformed entries
            # are omitted; otherwise normalized evidence IDs would shift.
            if sub.get("frame_index") is None:
                item = {**item, "submitted_frame": {**sub, "frame_index": item.get("frame_idx", index)}}
            valid.append(item)
        frames = build_frame_evidence_from_matches(valid)
        # Only timeline-eligible measured correspondences count as matching timestamps.
        if matches_only:
            frames = [f for f in frames if reference(f.source_asset_id) and f.source_timestamp_sec is not None
                      and f.similarity_status in ("CONFIRMED_MATCH", "SUSPECT_MATCH")]
        return frames, {"input_frame_count": len(raw), "examined_frame_count": min(len(raw), MAX_FRAMES),
                        "omitted_invalid_timestamps": missing, "truncated": len(raw) > MAX_FRAMES}

    def _matching_data(self, record):
        frames, bounds = self._frames(record)
        if not frames:
            raise ToolFailure("DATA_UNAVAILABLE")

        from app.temporal_evidence import build_temporal_evidence_for_incident
        # Same canonical object as the API/report; existing result byte limit fails
        # closed rather than silently replacing missing or truncated statistics.
        temporal_result = build_temporal_evidence_for_incident(record)
        temporal_summary = temporal_result.model_dump(mode="json", exclude={"candidates", "by_source"})
        temporal_summary["candidate_provenance"] = [
            {key: getattr(c, key) for key in ("candidate_id", "frame_match_index", "rank", "evidence_id", "source_asset_id")}
            for c in temporal_result.candidates[:MAX_FRAMES]]
        temporal_summary["provenance_truncated"] = len(temporal_result.candidates) > MAX_FRAMES
        temporal_summary["scope"] = "Metrics cover all raw eligible candidates; candidate detail projection is bounded separately."

        return {
            "incident_id": reference(record.get("incident_id")),
            "frames": [{key: (reference(getattr(f, key)) if key in ("evidence_id", "source_asset_id") else number(getattr(f, key)))
                        for key in ("evidence_id", "source_asset_id", "suspect_timestamp_sec", "source_timestamp_sec", "l2_distance", "visual_similarity_score")}
                       for f in frames],
            "timeline_intervals": [{**{key: getattr(interval, key) for key in (
                "suspect_start_sec", "suspect_end_sec", "source_start_sec", "source_end_sec", "duration_sec", "frame_count", "continuity_status")},
                "interval_id": reference(interval.interval_id), "source_asset_id": reference(interval.source_asset_id),
                "evidence_ids": [reference(eid) for eid in interval.evidence_ids[:MAX_FRAMES]]}
                for interval in cluster_frame_matches(frames)[:MAX_FRAMES]],
            "temporal_evidence": temporal_summary,
            "bounds": bounds,
            "limitations": [
                "Similarity metrics are uncalibrated heuristics, not infringement probabilities.",
                "Intervals connect sampled matching frames; they do not prove unsampled content.",
                "Temporal offset describes chronological difference, never proof of copying or infringement.",
                "Zero MAD does not require all offsets to be identical and does not verify unsampled footage.",
                "Unsampled intervals between sampled keyframes cannot be evaluated.",
            ],
        }

    def _matching(self, session, args):
        return self._matching_data(self._incident(session, args.incident_id))

    def _bundle(self, session, args):
        record = self._incident(session, args.incident_id)
        frames, bounds = self._frames(record, matches_only=False)
        if not frames:
            raise ToolFailure("DATA_UNAVAILABLE")
        observations = []
        for frame in frames:
            vision = frame.vision_verification or {}
            observations.append({
                "evidence_id": reference(frame.evidence_id),
                "suspect_timestamp_sec": number(frame.suspect_timestamp_sec),
                "source_asset_id": reference(frame.source_asset_id),
                "source_timestamp_sec": number(frame.source_timestamp_sec),
                "similarity_status": frame.similarity_status,
                "l2_distance": number(frame.l2_distance),
                "visual_similarity_score": number(frame.visual_similarity_score),
                "vision_annotation": {
                    "model_id": text(vision.get("model_id"), 128),
                    "visual_correspondence": text(vision.get("visual_correspondence"), 128),
                    "matching_features": strings(vision.get("matching_features")),
                    "contradictions": strings(vision.get("contradictions")),
                } if vision else None,
                "sam_annotation_recorded": bool(frame.sam_segmentation or frame.ref_sam_segmentation),
            })
        matching_frames, _ = self._frames(record)
        matching = self._matching_data(record) if matching_frames else {
            "incident_id": args.incident_id, "frames": [], "timeline_intervals": [], "bounds": bounds,
            "limitations": ["No eligible matching timestamp correspondences in the returned observations."],
        }
        sam = self.sam_reader(record, session) if self.sam_reader else {
            'availability': 'UNAVAILABLE_OR_EXPIRED', 'observations': [],
            'limitation': 'SAM cache is unavailable here; this does not establish that SAM never ran.'}
        # Apply the same text sanitation as other tool projections. Never expose masks or payloads.
        for observation in sam.get('observations', []):
            observation['labels'] = strings(observation.get('labels'))
        reports = self._reports(args.incident_id)
        # Pure evidence/timeline services avoid report module/vault initialization,
        # image path resolution, raw model reasoning and fabricated timestamp defaults.
        return {"incident_id": args.incident_id, "incident": self._summary(record),
                "frame_observations": observations,
                "observation_counts": {"stored": bounds["input_frame_count"], "returned": len(frames),
                    **{status: sum(f.similarity_status == status for f in frames)
                       for status in ("NO_MATCH", "SUSPECT_MATCH", "CONFIRMED_MATCH", "UNVERIFIED")}},
                "matching_evidence": matching, "sam_context": sam, "bounds": bounds,
                "investigation_reports": self._report_items(args.incident_id, reports),
                "reports_truncated": len(reports) > MAX_REPORTS,
                "recorded_limitations": strings(record.get("limitations")),
                "limitations": ["NO_MATCH observations are not suspicious matches.",
                    "Frame classifications are normalized from stored matching fields; no new image analysis was run.",
                    "Similarity scores are uncalibrated heuristics, not infringement probabilities."]}

    def _history(self, session, args):
        self._incident(session, args.incident_id)  # Parent must exist and belong to session first.
        reports = self._reports(args.incident_id)
        if not reports:
            raise ToolFailure("NOT_FOUND")
        return {"incident_id": args.incident_id, "reports": self._report_items(args.incident_id, reports),
                "truncated": len(reports) > MAX_REPORTS}

    def _report_items(self, incident_id, reports):
        items = []
        for rep in reports[:MAX_REPORTS]:
            meta = rep.get("operational_metadata") or {}
            items.append({
                "report_id": reference(rep.get("report_id")), "incident_id": incident_id,
                "created_at": timestamp_text(rep.get("created_at") or meta.get("created_at")),
                "model_id": text(rep.get("model_id") or meta.get("model_id"), 128),
                "provider": text(rep.get("provider") or meta.get("provider"), 128),
                "validation_status": text(rep.get("validation_status") or meta.get("validation_status"), 128),
                "persistence_status": "retrieved_from_store",
                "summary": text(rep.get("summary"), 1000),
                "recommended_action": text(rep.get("recommended_action"), 128),
                "human_review_required": rep.get("human_review_required") if isinstance(rep.get("human_review_required"), bool) else None,
                "limitations": strings(rep.get("limitations_disclosed")),
            })
        return items
