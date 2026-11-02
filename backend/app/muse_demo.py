"""Local voice/chat entry point; no vault, report, scan or write routes.

Run: .venv/bin/python -m uvicorn app.muse_demo:app --host 127.0.0.1 --port 8001
Normal app.main startup is unchanged. PostgreSQL connections are transaction-read-only.
"""
from datetime import datetime, timezone
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app import registry
from app.db import DatabaseManager, get_db_config
from app.muse_conversation_api import router, incident_router, get_conversation_manager, get_muse_assistant
from app.muse_conversations import ConversationManager, validate_session
from app.muse_orchestrator import MuseAssistant
from app.muse_tools import MuseToolRegistry, RegistryReadStore
from app.security import RequestProtectionMiddleware, cors_origins
from app.voice_api import router as voice_router


class ReadOnlyDatabaseManager(DatabaseManager):
    def connect(self):
        connection = super().connect()
        try:
            connection.read_only = True
            with connection.cursor() as cursor:
                cursor.execute("SHOW transaction_read_only")
                value = cursor.fetchone()[0]
                if isinstance(value, bytes):
                    value = value.decode("ascii")
                if value != "on":
                    raise RuntimeError("Read-only database transaction is required.")
            return connection
        except BaseException:
            connection.close()
            raise


def parse_utc_timestamp(val):
    if not val:
        return None
    try:
        from datetime import datetime, timezone
        if isinstance(val, datetime):
            return val.replace(tzinfo=timezone.utc) if val.tzinfo is None else val.astimezone(timezone.utc)
        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except Exception:
        return None


def list_demo_incidents(limit: int = 50, reg=None) -> dict:
    """Read-only cross-session incident listing for the isolated demo.

    Never exposes session IDs in the returned records.
    Orders by actual stored timestamps, newest first.
    """
    from datetime import datetime, timezone
    r = reg or registry
    records = r.load_incidents()
    total_count = len(records)

    def sort_key(rec):
        ts = parse_utc_timestamp(rec.get("scanned_at"))
        return (ts or datetime.min.replace(tzinfo=timezone.utc), str(rec.get("incident_id") or ""))

    sorted_records = sorted(records, key=sort_key, reverse=True)
    items = []
    for rec in sorted_records[:limit]:
        ts = parse_utc_timestamp(rec.get("scanned_at"))
        items.append({
            "incident_id": str(rec.get("incident_id")),
            "suspect_filename": rec.get("suspect_filename"),
            "scanned_at": ts.isoformat() if ts else None,
            "overall_status": rec.get("overall_status"),
            "candidate_matches_found": rec.get("candidate_matches_found") or 0,
            "highest_confidence": float(rec.get("highest_confidence")) if rec.get("highest_confidence") is not None else None,
            "lowest_l2_distance": float(rec.get("lowest_l2_distance")) if rec.get("lowest_l2_distance") is not None else None,
            "investigation_type": rec.get("investigation_type") or "FULL_VIDEO_SCAN",
            "total_frames_analyzed": rec.get("total_frames_analyzed"),
            "duration_seconds": rec.get("duration_seconds"),
            "has_frame_evidence": bool(rec.get("frame_matches")),
        })

    return {
        "incidents": items,
        "total_count": total_count,
        "returned_count": len(items),
        "truncated": total_count > limit,
        "latest_incident_id": items[0]["incident_id"] if items else None,
        "latest_suspect_filename": items[0]["suspect_filename"] if items else None,
    }


def select_demo_incident(incident_id: str, reg=None):
    """Resolves owner/session internally on the server from authoritative stored record.

    Calls existing authorized retrieval functions without exposing session ID to caller.
    """
    r = reg or registry
    record = r.get_incident_by_id(incident_id)
    if not record:
        raise ValueError(f"Incident {incident_id} not found.")

    session_id = record.get("session_id")
    if not session_id:
        raise ValueError(f"Incident {incident_id} has no associated session.")
    validate_session(session_id)

    store = RegistryReadStore(r)
    tools = MuseToolRegistry(store)
    bundle_result = tools.execute("get_evidence_bundle", session_id=session_id, arguments={"incident_id": incident_id})
    if bundle_result.status != "success":
        err_msg = bundle_result.error.detail if bundle_result.error else "Failed to retrieve evidence bundle."
        raise RuntimeError(f"Evidence bundle retrieval failed: {err_msg}")

    return {
        "session_id": session_id,
        "incident": record,
        "evidence_bundle": bundle_result.data,
    }


def create_app():
    # Only this separate process receives the read-only DB dependency.
    registry.default_db_manager = ReadOnlyDatabaseManager(get_db_config())
    manager = ConversationManager.from_environment()
    tools = MuseToolRegistry(RegistryReadStore(registry))
    assistant = MuseAssistant(manager, tools=tools)
    app = FastAPI(title="FixProof Muse local demo")
    app.include_router(router)
    app.include_router(incident_router)
    app.include_router(voice_router)
    app.dependency_overrides[get_conversation_manager] = lambda: manager
    app.dependency_overrides[get_muse_assistant] = lambda: assistant
    app.add_middleware(RequestProtectionMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=list(dict.fromkeys(cors_origins() + [
        "http://localhost:3001", "http://127.0.0.1:3001"])),
        allow_methods=["GET", "POST", "DELETE"], allow_headers=["*"], allow_credentials=False)

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "FixProof Muse demo", "database_writes": False}

    @app.get("/api/demo/incidents")
    def demo_incidents(limit: int = 50):
        return list_demo_incidents(limit=min(max(limit, 1), 100))

    @app.get("/api/demo/incidents/{incident_id}/evidence")
    def demo_incident_evidence(incident_id: str):
        try:
            data = select_demo_incident(incident_id)
            return {"status": "success", "incident_id": incident_id, "evidence_bundle": data["evidence_bundle"]}
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc))

    return app


app = create_app()

