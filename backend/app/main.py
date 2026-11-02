import base64
import json
import mimetypes
import os
import re
from datetime import datetime, timezone
from typing import Optional, Union, List

# Prevent OpenMP duplicate runtime abort on macOS between PyTorch and FAISS
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import uuid
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File, Request, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, RedirectResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from app.security import RequestProtectionMiddleware, cors_origins, is_demo_mode
import logging
from pydantic import BaseModel, Field

load_dotenv()
logger = logging.getLogger("fixproof.main")

app = FastAPI(title="FixProof API")
from app.voice_api import router as voice_router
app.include_router(voice_router)
from app.muse_conversation_api import router as muse_conversation_router, incident_router as muse_incident_router
app.include_router(muse_conversation_router)
from app.sam_workspace_api import router as sam_workspace_router
app.include_router(sam_workspace_router)
app.include_router(muse_incident_router)
app.add_middleware(RequestProtectionMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(StarletteHTTPException)
async def safe_http_error(request, exc):
    if exc.status_code >= 500:
        logger.warning("Request failed: status=%s", exc.status_code)
        detail = "The operation could not be completed. Check server configuration and logs."
        if request.url.path == "/api/threats/scan":
            detail = "Failed to scan suspect video. Check server logs."
        return JSONResponse({"detail": detail}, status_code=exc.status_code, headers=exc.headers)
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)


@app.exception_handler(Exception)
async def safe_unhandled_error(request, exc):
    logger.error("Unhandled request failure: type=%s", type(exc).__name__)
    return JSONResponse({"detail": "Internal server error."}, status_code=500)


@app.middleware("http")
async def add_cache_control_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

import shutil
from app.extractor import extract_video_frames, preflight_video_file
from app.matcher import analyze_asset_matches, SCORE_VERSION
from app.url_screener import (
    screen_video_url,
    SSRFValidationError,
    UnsupportedPlatformError,
    MetadataExtractionError,
    SUSPECTS_THUMBNAILS_DIR,
)
from app.vault import default_vault
from app.db import get_db_config, default_db_manager
from app.storage import SupabaseStorageClient, StorageNotFoundError, StorageError
from app.registry import (
    register_asset,
    list_registered_assets,
    get_asset_detail,
    delete_asset_record,
    load_incidents,
    save_incident,
    get_incident_by_id,
    save_nemotron_report,
    get_nemotron_report_by_id,
    get_nemotron_reports_for_incident,
    get_nemotron_report_history,
    list_active_sessions,
    is_cloud_mode,
)
from app.evidence_models import (
    build_frame_evidence_from_matches,
    build_investigation_input_from_incident,
    ReportHistoryItem,
)
from app.evidence_package import (
    create_evidence_package,
    verify_evidence_package,
    SigningConfigurationError,
    PackageVerificationError,
)
from app.timeline import cluster_frame_matches
from app.nemotron_engine import (
    get_allowed_models,
    normalize_model_override,
    DEFAULT_MODEL,
)
from app.providers import factory as provider_factory
from app.nemotron_action import (
    get_email_config,
    load_email_audit_log,
    extract_incident_evidence_facts,
    generate_copyright_notice_draft,
    generate_rev_share_proposal_draft,
    send_nemotron_document_email,
)
from app.detailed_report import (
    build_evidence_bundle,
    synthesize_detailed_report,
    generate_detailed_report_pdf,
    generate_short_summary_download,
    save_detailed_report,
    get_detailed_report_record,
    get_detailed_report_pdf_bytes,
    list_detailed_reports_for_incident,
    send_detailed_report_email,
    DEFAULT_DETAILED_MODEL,
    FALLBACK_DETAILED_MODEL,
)
from typing import Optional, Dict, Any

class ScreenUrlRequest(BaseModel):
    url: str

class InvestigateIncidentRequest(BaseModel):
    force_refresh: bool = Field(
        default=False,
        description="If True, bypasses cached reports and executes a fresh model investigation.",
    )
    model_override: Optional[str] = Field(
        default=None,
        description="Optional model ID override. Defaults to configured provider model.",
        json_schema_extra={"example": None},
    )

class DraftDocumentRequest(BaseModel):
    incident_id: str
    document_type: str = Field(..., description="COPYRIGHT_NOTICE or REVENUE_SHARE_OFFER")
    rights_holder: Optional[str] = None
    authorized_rep: Optional[str] = None
    contact_email: Optional[str] = None
    work_title: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_email: Optional[str] = None
    jurisdiction: Optional[str] = "US_DMCA"
    custom_notes: Optional[str] = None
    rev_share_pct: Optional[float] = Field(default=None, ge=0, le=100)
    commercial_terms: Optional[str] = None
    response_deadline_days: Optional[int] = Field(default=None, ge=1, le=365)
    use_ai_synthesis: Optional[bool] = True

class SendDocumentEmailRequest(BaseModel):
    incident_id: str
    document_type: str
    recipient_email: str
    subject: str
    body: str
    cc_emails: Optional[List[str]] = None
    user_confirmed: bool = False
    rights_declaration_confirmed: bool = False

class DetailedReportRequest(BaseModel):
    incident_id: str
    recipient_email: Optional[str] = None
    model_override: Optional[str] = None

class EmailDetailedReportRequest(BaseModel):
    incident_id: str
    report_id: str
    recipient_email: str
    subject: Optional[str] = Field(default=None, min_length=1, max_length=200, pattern=r"^[^\r\n]+$")
    body: Optional[str] = Field(default=None, min_length=1, max_length=20000)
    user_confirmed: bool = False


def is_valid_completed_report(report: Dict[str, Any]) -> bool:
    """
    Returns True only if the report was successfully generated and validated.
    Failed/incomplete reports (PROVIDER_API_ERROR, FAILED_VALIDATION, etc.) must not
    act as cache hits for subsequent investigation requests.
    """
    op_meta = report.get("operational_metadata") or {}
    validation_status = op_meta.get("validation_status")
    failure_type = op_meta.get("failure_type")
    if validation_status == "FAILED_VALIDATION" or failure_type is not None:
        return False
    if not report.get("findings") and "Investigation incomplete" in (report.get("summary") or ""):
        return False
    return True



# Storage directory for official reference videos and extracted frames
STORAGE_DIR = Path(__file__).resolve().parent.parent / "storage" / "videos"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
FRAMES_DIR = Path(__file__).resolve().parent.parent / "storage" / "frames"
FRAMES_DIR.mkdir(parents=True, exist_ok=True)


@app.on_event("startup")
def startup_event():
    """
    Validates explicit cloud configuration and hydrates reference vault if cloud mode is enabled.
    Fails fast with clear exceptions if any required cloud setting is missing.
    """
    db_cfg = get_db_config()
    if db_cfg.is_cloud:
        from app.storage import validate_storage_config
        validate_storage_config(mode=db_cfg.mode.value)
        default_vault.reload(mode=db_cfg.mode.value)
        default_vault.sync_with_registered_assets()

# Isolated storage directory for untrusted suspect videos and frames
SUSPECTS_DIR = Path(__file__).resolve().parent.parent / "storage" / "suspects"
SUSPECTS_VIDEOS_DIR = SUSPECTS_DIR / "videos"
SUSPECTS_FRAMES_DIR = SUSPECTS_DIR / "frames"
SUSPECTS_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
SUSPECTS_FRAMES_DIR.mkdir(parents=True, exist_ok=True)

# Allowed video extensions and 50 MB size limit for reference uploads
ALLOWED_EXTENSIONS = {
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
    ".m4v",
    ".flv",
    ".wmv",
    ".ts",
    ".3gp",
    ".ogg",
    ".ogv",
}
MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB
CHUNK_SIZE_BYTES = 1024 * 1024          # 1 MB chunk for streaming

MIME_TYPE_OVERRIDES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".m4v": "video/mp4",
    ".flv": "video/x-flv",
    ".wmv": "video/x-ms-wmv",
    ".ts": "video/mp2t",
    ".3gp": "video/3gpp",
    ".ogg": "video/ogg",
    ".ogv": "video/ogg",
}


def resolve_video_content_type(filename_or_path: Union[str, Path], fallback: Optional[str] = None) -> str:
    """Accurately maps video extension to IANA media type, falling back to mimetypes or provided type."""
    ext = Path(filename_or_path).suffix.lower()
    if ext in MIME_TYPE_OVERRIDES:
        return MIME_TYPE_OVERRIDES[ext]
    guessed, _ = mimetypes.guess_type(str(filename_or_path))
    if guessed:
        return guessed
    if fallback and fallback not in ("application/octet-stream", ""):
        return fallback
    return "video/mp4"


SAFE_ID_REGEX = re.compile(r"^[a-zA-Z0-9_\-]+$")
SAFE_FRAME_REGEX = re.compile(r"^[a-zA-Z0-9_\-\.]+\.(jpg|jpeg|png)$", re.IGNORECASE)


def is_valid_uuid(val: Any) -> bool:
    try:
        uuid.UUID(str(val))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


class DiagnoseRequest(BaseModel):
    issue_description: str


@app.get("/health")
@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "FixProof API"}


@app.get("/api/vault/status")
def get_vault_status():
    """Returns the current size, embedding dimensions, and indexed assets of the FAISS reference vault."""
    status = default_vault.get_status()
    all_assets = list_registered_assets(default_vault)
    status["total_registered_assets"] = len(all_assets)
    status["total_protected_assets"] = sum(1 for a in all_assets if a.get("indexed"))
    status["db_mode"] = get_db_config().mode.value
    status["is_cloud"] = is_cloud_mode()
    return status


@app.post("/api/vault/sync")
def sync_vault():
    """
    Synchronizes the in-memory FAISS vault and cloud snapshot with registered reference assets in PostgreSQL.
    Prunes any vectors belonging to assets that have been deleted from the database.
    """
    pruned = default_vault.sync_with_registered_assets()
    status = get_vault_status()
    return {
        "status": "synchronized",
        "pruned_vectors": pruned,
        "vault": status,
    }


@app.get("/api/vault/assets")
def list_assets():
    """Lists all registered official reference assets and their real status."""
    return list_registered_assets(default_vault)


@app.get("/api/vault/assets/{asset_id}")
def get_single_asset(asset_id: str):
    """Returns full details and frames for a single registered asset."""
    if not SAFE_ID_REGEX.match(asset_id):
        raise HTTPException(status_code=400, detail="Invalid asset ID format.")
    asset = get_asset_detail(asset_id, default_vault)
    if not asset:
        raise HTTPException(status_code=404, detail=f"Asset '{asset_id}' not found.")
    return asset


@app.get("/api/vault/assets/{asset_id}/frames/{frame_filename}")
@app.get("/api/incidents/{asset_id}/frames/{frame_filename}")
@app.get("/api/threats/{asset_id}/frames/{frame_filename}")
def stream_asset_frame(asset_id: str, frame_filename: str):
    """
    Safely streams an extracted video frame to the client.
    Supports both reference asset IDs and incident IDs / suspect asset IDs.
    Strictly checks path containment and character safety.
    Prioritizes local file storage roots, then cloud buckets if in cloud mode.
    """
    if not SAFE_ID_REGEX.match(asset_id):
        raise HTTPException(status_code=400, detail="Invalid asset ID format.")
    if not SAFE_FRAME_REGEX.match(frame_filename):
        raise HTTPException(status_code=400, detail="Invalid frame filename.")

    # 1. Check local storage via resolve_frame_path across all approved roots
    from app.temporal_selector import resolve_frame_path
    resolved_path, _ = resolve_frame_path(None, asset_id=asset_id, filename=frame_filename)
    if resolved_path and resolved_path.is_file():
        return FileResponse(
            str(resolved_path),
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    # Check if asset_id is an incident_id to resolve submitted_asset_id
    from app.registry import get_incident_by_id
    incident = get_incident_by_id(asset_id)
    resolved_id = asset_id
    if incident:
        resolved_id = incident.get("submitted_asset_id") or asset_id
        if resolved_id != asset_id:
            resolved_path, _ = resolve_frame_path(None, asset_id=resolved_id, filename=frame_filename)
            if resolved_path and resolved_path.is_file():
                return FileResponse(
                    str(resolved_path),
                    media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=3600"},
                )

    # 2. Check local suspect frames and reference frames directories directly
    for aid in ([resolved_id, asset_id] if resolved_id != asset_id else [resolved_id]):
        suspect_frame_path = (SUSPECTS_FRAMES_DIR / aid / frame_filename).resolve()
        if suspect_frame_path.is_relative_to(SUSPECTS_FRAMES_DIR.resolve()) and suspect_frame_path.is_file():
            return FileResponse(
                str(suspect_frame_path),
                media_type="image/jpeg",
                headers={"Cache-Control": "public, max-age=3600"},
            )
        ref_frame_path = (FRAMES_DIR / aid / frame_filename).resolve()
        if ref_frame_path.is_relative_to(FRAMES_DIR.resolve()) and ref_frame_path.is_file():
            return FileResponse(
                str(ref_frame_path),
                media_type="image/jpeg",
                headers={"Cache-Control": "public, max-age=3600"},
            )

    # 3. In cloud mode, check local cache or download from Supabase Storage
    if is_cloud_mode():
        cloud_cache_file = (
            Path(__file__).resolve().parent.parent
            / "storage"
            / "cloud_cache"
            / "frames"
            / resolved_id
            / frame_filename
        ).resolve()
        if cloud_cache_file.is_file():
            return FileResponse(
                str(cloud_cache_file),
                media_type="image/jpeg",
                headers={"Cache-Control": "public, max-age=3600"},
            )

        storage_client = SupabaseStorageClient()
        buckets_to_try = ["suspect-frames", "reference-frames"] if incident else ["reference-frames", "suspect-frames"]
        for bkt in buckets_to_try:
            try:
                frame_bytes = storage_client.download_file(bkt, f"{resolved_id}/{frame_filename}")
                cloud_cache_file.parent.mkdir(parents=True, exist_ok=True)
                cloud_cache_file.write_bytes(frame_bytes)
                return Response(
                    content=frame_bytes,
                    media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=3600"},
                )
            except StorageNotFoundError:
                continue
            except Exception as e:
                logger.warning(f"[StreamFrame] Error checking bucket {bkt}: {e}")

    # 4. Suspect thumbnail fallback if frame not found
    for aid in ([resolved_id, asset_id] if resolved_id != asset_id else [resolved_id]):
        thumb_path = (SUSPECTS_THUMBNAILS_DIR / f"{aid}.jpg").resolve()
        if thumb_path.is_relative_to(SUSPECTS_THUMBNAILS_DIR.resolve()) and thumb_path.is_file():
            return FileResponse(
                str(thumb_path),
                media_type="image/jpeg",
                headers={"Cache-Control": "public, max-age=3600"},
            )

    raise HTTPException(status_code=404, detail="Frame not found.")


@app.get("/api/vault/assets/{asset_id}/video")
def stream_asset_video(asset_id: str):
    """
    Safely streams the original uploaded video for an asset.
    Supports both reference asset IDs and incident IDs / suspect asset IDs.
    In cloud mode, generates a short-lived authenticated signed URL.
    """
    if not SAFE_ID_REGEX.match(asset_id):
        raise HTTPException(status_code=400, detail="Invalid asset ID format.")

    # 1. Check if asset_id is an incident_id
    from app.registry import get_incident_by_id
    incident = get_incident_by_id(asset_id)
    resolved_id = asset_id
    suspect_path_from_meta = None
    if incident:
        if incident.get("investigation_type") == "URL_SCREENING":
            raise HTTPException(
                status_code=404,
                detail="No video stream available for URL-screened threats. Preliminary screening evaluated public preview thumbnail only per platform restrictions.",
            )
        resolved_id = incident.get("submitted_asset_id") or asset_id
        suspect_path_from_meta = incident.get("suspect_storage_path")

    # 2. Check local suspect videos first
    suspect_matches = list(SUSPECTS_VIDEOS_DIR.glob(f"{resolved_id}.*"))
    if not suspect_matches and resolved_id != asset_id:
        suspect_matches = list(SUSPECTS_VIDEOS_DIR.glob(f"{asset_id}.*"))
    if suspect_matches:
        target_video = suspect_matches[0].resolve()
        suspect_base = SUSPECTS_VIDEOS_DIR.resolve()
        if target_video.is_relative_to(suspect_base) and target_video.is_file():
            media_type = resolve_video_content_type(target_video)
            return FileResponse(str(target_video), media_type=media_type)

    if is_cloud_mode():
        storage_client = SupabaseStorageClient()

        # Check suspect video first if it's an incident or suspect asset
        if not incident and not suspect_path_from_meta and is_valid_uuid(resolved_id):
            try:
                inc_row = default_db_manager.fetch_one(
                    "SELECT suspect_storage_path FROM incidents WHERE (cv_evidence_dossier->>'submitted_asset_id') = %s OR suspect_storage_path LIKE %s LIMIT 1",
                    (str(resolved_id), f"%{resolved_id}%"),
                )
                if inc_row and inc_row.get("suspect_storage_path"):
                    suspect_path_from_meta = inc_row["suspect_storage_path"]
                    incident = inc_row
            except Exception as e:
                logger.warning(f"[StreamVideo] Error checking suspect video catalog: {e}")

        if incident or suspect_path_from_meta:
            target_path = suspect_path_from_meta
            if not target_path and is_valid_uuid(resolved_id):
                inc_row = default_db_manager.fetch_one(
                    "SELECT suspect_storage_path FROM incidents WHERE incident_id = %s OR (cv_evidence_dossier->>'submitted_asset_id') = %s LIMIT 1",
                    (resolved_id, resolved_id),
                )
                if inc_row and inc_row.get("suspect_storage_path"):
                    target_path = inc_row["suspect_storage_path"]
            if not target_path:
                target_path = f"{resolved_id}.mp4"

            bucket = "suspect-videos"
            if target_path.startswith(f"{bucket}/"):
                target_path = target_path[len(f"{bucket}/"):]

            try:
                signed_url = storage_client.create_signed_url(bucket, target_path, expires_in=1800)
                return RedirectResponse(url=signed_url, status_code=307)
            except Exception as e:
                logger.warning(f"[StreamVideo] Failed suspect signed URL: {e}")

        # Check reference_assets table
        row = None
        if is_valid_uuid(resolved_id):
            row = default_db_manager.fetch_one(
                "SELECT filename, storage_path FROM reference_assets WHERE asset_id = %s",
                (resolved_id,),
            )
        if row:
            storage_path = row["storage_path"]
            bucket = "reference-assets"
            if storage_path.startswith(f"{bucket}/"):
                storage_path = storage_path[len(f"{bucket}/"):]
            try:
                signed_url = storage_client.create_signed_url(bucket, storage_path, expires_in=1800)
                return RedirectResponse(url=signed_url, status_code=307)
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"Failed to generate streaming URL: {e}")


    # 3. Local mode fallback
    matches = list(STORAGE_DIR.glob(f"{resolved_id}.*"))
    if not matches and resolved_id != asset_id:
        matches = list(STORAGE_DIR.glob(f"{asset_id}.*"))
    base_dir = STORAGE_DIR.resolve()
    if not matches:
        raise HTTPException(status_code=404, detail=f"Video for asset '{resolved_id}' not found.")

    target_video = matches[0].resolve()
    if not target_video.is_relative_to(base_dir):
        raise HTTPException(status_code=403, detail="Access denied.")
    if not target_video.is_file():
        raise HTTPException(status_code=404, detail="Video file not found.")

    media_type = resolve_video_content_type(target_video)
    return FileResponse(str(target_video), media_type=media_type)



@app.delete("/api/vault/assets/{asset_id}")
def delete_asset(asset_id: str):
    """Safely removes an asset, its video, extracted frames, and vault vectors."""
    if not SAFE_ID_REGEX.match(asset_id):
        raise HTTPException(status_code=400, detail="Invalid asset ID format.")
    asset = get_asset_detail(asset_id, default_vault)
    if not asset:
        raise HTTPException(status_code=404, detail=f"Asset '{asset_id}' not found.")
    delete_asset_record(asset_id, default_vault)
    return {"status": "deleted", "asset_id": asset_id}



@app.post("/api/vault/index/{asset_id}")
def index_existing_asset(asset_id: str):
    """
    Indexes extracted frames for an existing asset into the FAISS vault
    without needing to re-upload the video.
    """
    asset_frames_dir = FRAMES_DIR / asset_id
    if not asset_frames_dir.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Asset '{asset_id}' not found. No extracted frames exist in storage.",
        )
    try:
        indexed_records = default_vault.index_asset_frames(
            asset_id=asset_id,
            frames_dir=asset_frames_dir,
        )
        return {
            "status": "indexed",
            "asset_id": asset_id,
            "frames_indexed": len(indexed_records),
            "vault_size": default_vault.vector_db.ntotal,
            "indexed_records": indexed_records,
        }
    except ValueError as ve:
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to index asset: {e}")


from app.matcher import analyze_asset_matches

@app.post("/api/matches/{asset_id}")
def match_uploaded_asset(asset_id: str, k: int = 3):
    """
    Analyzes an already-uploaded video (asset_id) against the FAISS reference vault.
    Performs visual embedding similarity search and pHash cross-check.
    Never indexes the asset during detection and prevents self-matching.
    """
    asset_frames_dir = FRAMES_DIR / asset_id
    if not asset_frames_dir.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Asset '{asset_id}' not found. No extracted frames available for matching.",
        )
    try:
        results = analyze_asset_matches(
            submitted_asset_id=asset_id,
            frames_dir=asset_frames_dir,
            vault=default_vault,
            k_candidates=k,
        )
        incident_id = str(uuid.uuid4())
        results["incident_id"] = incident_id
        results["scanned_at"] = datetime.now(timezone.utc).isoformat()
        detail = get_asset_detail(asset_id, default_vault)
        results["suspect_filename"] = detail["filename"] if detail else f"asset_{asset_id[:8]}"
        save_incident(results)
        return results
    except ValueError as ve:
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Matching analysis failed: {e}")



@app.post("/api/vault/ingest")
async def ingest_reference_video(
    file: UploadFile = File(...),
    auto_index: bool = False,
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file was provided.")
    # 1. Validate file extension
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type '{file_ext}'. "
                f"Allowed video formats: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            ),
        )
    # 2. Generate unique asset ID (storage path never uses original filename)
    asset_id = str(uuid.uuid4())
    stored_filename = f"{asset_id}{file_ext}"
    target_path = STORAGE_DIR / stored_filename
    asset_frames_dir = FRAMES_DIR / asset_id
    total_bytes = 0

    try:
        # 3. Stream chunks to disk and enforce size limit
        with open(target_path, "wb") as buffer:
            while chunk := await file.read(CHUNK_SIZE_BYTES):
                total_bytes += len(chunk)
                if total_bytes > MAX_FILE_SIZE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"File exceeds maximum allowed size of "
                            f"{MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB."
                        ),
                    )
                buffer.write(chunk)
        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        # Lightweight video preflight check before frame directory creation
        probe_info = preflight_video_file(target_path)

        # 4. Extract video frames using MediaGuard sampling logic (1 frame every 5s)
        duration_sec, extracted_frames = extract_video_frames(
            video_path=target_path,
            output_dir=asset_frames_dir,
            sample_interval_sec=5,
            preflight_info=probe_info,
        )

        # 5. Handle Ingestion according to Storage Mode
        resolved_content_type = resolve_video_content_type(file.filename, fallback=file.content_type)
        if is_cloud_mode():
            from app.cloud_ingest import ingest_reference_asset_cloud
            return ingest_reference_asset_cloud(
                asset_id=asset_id,
                video_path=target_path,
                original_filename=file.filename,
                content_type=resolved_content_type,
                duration_seconds=duration_sec,
                extracted_frames=extracted_frames,
                frames_dir=asset_frames_dir,
                vault=default_vault,
                auto_index=auto_index,
            )

        # Local Mode: Index into the FAISS vault immediately
        indexed = False
        indexed_records = []
        if auto_index:
            indexed_records = default_vault.index_asset_frames(
                asset_id=asset_id,
                frames=extracted_frames,
                frames_dir=asset_frames_dir,
            )
            indexed = True

        # 6. Register into persistent reference asset registry
        register_asset(
            asset_id=asset_id,
            filename=file.filename,
            stored_filename=stored_filename,
            file_size=total_bytes,
            content_type=resolved_content_type,
            duration_seconds=duration_sec,
            frame_count=len(extracted_frames),
            frames=extracted_frames,
            auto_indexed=indexed,
        )

        response_data = {
            "status": "indexed" if indexed else "uploaded",
            "asset_id": asset_id,
            "filename": file.filename,
            "file_size": total_bytes,
            "content_type": resolved_content_type,
            "duration_seconds": duration_sec,
            "frame_count": len(extracted_frames),
            "sample_interval_seconds": 5,
            "frames": extracted_frames,
            "indexed": indexed,
            "indexed_vectors": len(indexed_records),
        }

        if indexed:
            response_data["vault_size"] = default_vault.vector_db.ntotal
            response_data["indexed_records"] = indexed_records

        return response_data

    except HTTPException:
        # Clean up any partially written video and frame directory on HTTP exceptions
        if target_path.exists():
            target_path.unlink(missing_ok=True)
        if asset_frames_dir.exists():
            shutil.rmtree(asset_frames_dir, ignore_errors=True)
        raise
    except ValueError as ve:
        # Handle unreadable, corrupted, or 0-frame videos
        if target_path.exists():
            target_path.unlink(missing_ok=True)
        if asset_frames_dir.exists():
            shutil.rmtree(asset_frames_dir, ignore_errors=True)
        raise HTTPException(
            status_code=422,
            detail=f"Invalid or unreadable video: {ve}",
        )
    except Exception as err:
        if target_path.exists():
            target_path.unlink(missing_ok=True)
        if asset_frames_dir.exists():
            shutil.rmtree(asset_frames_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process video: {err}",
        )
    finally:
        await file.close()


@app.post("/api/threats/scan")
async def scan_suspect_video(
    file: UploadFile = File(...),
    x_client_session_id: Optional[str] = Header(None),
):
    """
    Ingests an untrusted suspect video, extracts frames, and executes Sentinel-style
    visual matching against the FAISS reference vault.
    NEVER indexes suspect video into the reference vault.
    In cloud mode, persists uploaded video and frames to Supabase Storage.
    Records the scan incident for forensic review with session isolation.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No suspect video provided.")
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video format '{file_ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    from time import perf_counter
    started = perf_counter()
    suspect_id = str(uuid.uuid4())
    stored_filename = f"{suspect_id}{file_ext}"
    target_path = SUSPECTS_VIDEOS_DIR / stored_filename
    suspect_frames_dir = SUSPECTS_FRAMES_DIR / suspect_id
    total_bytes = 0

    try:
        with open(target_path, "wb") as buffer:
            while chunk := await file.read(CHUNK_SIZE_BYTES):
                total_bytes += len(chunk)
                if total_bytes > MAX_FILE_SIZE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB.",
                    )
                buffer.write(chunk)
        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        # Lightweight video preflight check before frame directory creation
        probe_info = preflight_video_file(target_path)

        duration_sec, extracted_frames = extract_video_frames(
            video_path=target_path,
            output_dir=suspect_frames_dir,
            sample_interval_sec=5,
            preflight_info=probe_info,
        )

        extracted_at = perf_counter()
        match_results = analyze_asset_matches(
            submitted_asset_id=suspect_id,
            frames_dir=suspect_frames_dir,
            vault=default_vault,
            k_candidates=3,
        )

        matched_at = perf_counter()
        suspect_storage_path = None
        if is_cloud_mode():
            try:
                storage_client = SupabaseStorageClient()
                storage_client.upload_file(
                    bucket="suspect-videos",
                    storage_path=stored_filename,
                    data_or_file=target_path,
                    content_type=file.content_type or "video/mp4",
                    upsert=True,
                )
                suspect_storage_path = f"suspect-videos/{stored_filename}"

                for frame_file in suspect_frames_dir.glob("*.jpg"):
                    storage_client.upload_file(
                        bucket="suspect-frames",
                        storage_path=f"{suspect_id}/{frame_file.name}",
                        data_or_file=frame_file,
                        content_type="image/jpeg",
                        upsert=True,
                    )
            except Exception as up_err:
                logger.warning("[CloudStorage] Suspect media persistence failed; incident was not saved.")
                raise HTTPException(status_code=503, detail="Unable to persist suspect video and frames. Investigation was not completed.") from up_err

        match_results["suspect_filename"] = file.filename
        match_results["file_size"] = total_bytes
        match_results["duration_seconds"] = duration_sec
        match_results["frame_count"] = len(extracted_frames)
        match_results["scanned_at"] = datetime.now(timezone.utc).isoformat()
        match_results["incident_id"] = str(uuid.uuid4())
        match_results["suspect_storage_path"] = suspect_storage_path
        match_results["screening_mode"] = "FULL_VIDEO_SCAN"
        match_results["score_version"] = SCORE_VERSION
        match_results["session_id"] = x_client_session_id

        match_results["processing_timings"] = {
            "upload_validation_extraction_seconds": extracted_at - started,
            "cv_and_vision_seconds": matched_at - extracted_at,
            "media_persistence_seconds": perf_counter() - matched_at,
        }
        save_incident(match_results, session_id=x_client_session_id)
        return match_results
    except HTTPException:
        if target_path.exists():
            target_path.unlink(missing_ok=True)
        if suspect_frames_dir.exists():
            shutil.rmtree(suspect_frames_dir, ignore_errors=True)
        raise
    except ValueError as ve:
        if target_path.exists():
            target_path.unlink(missing_ok=True)
        if suspect_frames_dir.exists():
            shutil.rmtree(suspect_frames_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"Invalid suspect video: {ve}")
    except Exception as err:
        if target_path.exists():
            target_path.unlink(missing_ok=True)
        if suspect_frames_dir.exists():
            shutil.rmtree(suspect_frames_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Failed to scan suspect video: {err}")
    finally:
        await file.close()


@app.post("/api/threats/screen-url")
def screen_video_url_endpoint(
    payload: ScreenUrlRequest,
    x_client_session_id: Optional[str] = Header(None),
):
    """
    Screens a public video URL by extracting metadata and public thumbnail,
    evaluating storyboard sprite sheet frames, verifying SSRF protection,
    and matching candidate keyframes against the FAISS reference vault.
    NEVER downloads the underlying third-party video stream.
    """
    raw_url = (payload.url or "").strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="Video URL is required.")

    try:
        result = screen_video_url(raw_url, vault=default_vault, session_id=x_client_session_id)
        return result
    except SSRFValidationError as sve:
        raise HTTPException(status_code=400, detail=f"SSRF validation blocked: {sve}")
    except UnsupportedPlatformError as upe:
        raise HTTPException(status_code=422, detail=f"Unsupported platform: {upe}")
    except MetadataExtractionError as mee:
        raise HTTPException(status_code=422, detail=f"Metadata extraction failed: {mee}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to screen video URL: {e}")


@app.get("/api/threats/suspect-thumbnail/{incident_id}")
@app.get("/api/incidents/{incident_id}/thumbnail")
def get_suspect_thumbnail_endpoint(incident_id: str):
    """Serves the cached suspect thumbnail image for UI preview."""
    if not SAFE_ID_REGEX.match(incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")

    # 1. Direct thumbnail by incident ID
    thumb_path = (SUSPECTS_THUMBNAILS_DIR / f"{incident_id}.jpg").resolve()
    if thumb_path.is_relative_to(SUSPECTS_THUMBNAILS_DIR.resolve()) and thumb_path.is_file():
        return FileResponse(thumb_path, media_type="image/jpeg")

    # 2. Check submitted_asset_id if incident exists
    from app.registry import get_incident_by_id
    incident = get_incident_by_id(incident_id)
    sub_aid = incident.get("submitted_asset_id") if incident else None

    if sub_aid:
        sub_thumb = (SUSPECTS_THUMBNAILS_DIR / f"{sub_aid}.jpg").resolve()
        if sub_thumb.is_relative_to(SUSPECTS_THUMBNAILS_DIR.resolve()) and sub_thumb.is_file():
            return FileResponse(sub_thumb, media_type="image/jpeg")

    # 3. If incident has an explicit thumbnail_storage_path, resolve and serve
    if incident and incident.get("thumbnail_storage_path"):
        from app.temporal_selector import resolve_frame_path
        res_p, _ = resolve_frame_path(incident.get("thumbnail_storage_path"))
        if res_p and res_p.is_file():
            return FileResponse(str(res_p), media_type="image/jpeg")

    # 4. Uploaded video keyframe fallback: check first frame in suspects/frames/{sub_aid or incident_id}
    for check_id in ([sub_aid, incident_id] if sub_aid else [incident_id]):
        suspect_frames_subdir = SUSPECTS_FRAMES_DIR / check_id
        if suspect_frames_subdir.is_dir():
            frame0 = suspect_frames_subdir / "frame_0000s.jpg"
            if frame0.is_file():
                return FileResponse(str(frame0), media_type="image/jpeg")
            jpgs = sorted(suspect_frames_subdir.glob("*.jpg"))
            if jpgs and jpgs[0].is_file():
                return FileResponse(str(jpgs[0]), media_type="image/jpeg")

    # 5. Check reference frames if applicable
    for check_id in ([sub_aid, incident_id] if sub_aid else [incident_id]):
        ref_frames_subdir = FRAMES_DIR / check_id
        if ref_frames_subdir.is_dir():
            frame0 = ref_frames_subdir / "frame_0000s.jpg"
            if frame0.is_file():
                return FileResponse(str(frame0), media_type="image/jpeg")
            jpgs = sorted(ref_frames_subdir.glob("*.jpg"))
            if jpgs and jpgs[0].is_file():
                return FileResponse(str(jpgs[0]), media_type="image/jpeg")

    # 6. Cloud mode download fallback
    if is_cloud_mode():
        try:
            storage_client = SupabaseStorageClient()
            thumb_bytes = storage_client.download_file("suspect-frames", f"thumbnails/{incident_id}.jpg")
            thumb_path.parent.mkdir(parents=True, exist_ok=True)
            thumb_path.write_bytes(thumb_bytes)
            return Response(content=thumb_bytes, media_type="image/jpeg")
        except Exception:
            pass

    raise HTTPException(status_code=404, detail="Suspect thumbnail image not found.")


@app.get("/api/sessions")
def list_sessions_endpoint():
    """Returns available visitor sessions with incident counts and latest activity for dashboard switching."""
    return list_active_sessions()


@app.get("/api/incidents")
def get_incidents_list(x_client_session_id: Optional[str] = Header(None)):
    """Returns recorded threat scan incidents filtered by visitor session."""
    return load_incidents(session_id=x_client_session_id)


@app.get("/api/incidents/{incident_id}")
def get_single_incident(
    incident_id: str,
    x_client_session_id: Optional[str] = Header(None),
):
    """Returns details for a specific incident with session scoping."""
    if not SAFE_ID_REGEX.match(incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")
    inc = get_incident_by_id(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found.")
    inc_sess = inc.get("session_id")
    if not is_demo_mode():
        if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
            logger.warning(
                f"[Security] Access denied to incident {incident_id}: "
                "session mismatch"
            )
            raise HTTPException(status_code=403, detail="Access denied: incident belongs to a different session.")

    return inc


@app.post("/api/threats/{incident_id}/investigate")
def investigate_threat_incident(
    incident_id: str,
    payload: Optional[InvestigateIncidentRequest] = None,
    x_client_session_id: Optional[str] = Header(None),
):
    """
    Executes a bounded, evidence-grounded Nemotron investigation for an incident.
    Clusters CV frame matches into coherent timeline intervals and generates
    a structured investigation report with verified evidence references.
    """
    if not SAFE_ID_REGEX.match(incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")

    force_refresh = payload.force_refresh if payload else False
    raw_model = payload.model_override if payload else None

    # Normalize Swagger placeholder ('string') and empty strings
    normalized_model = normalize_model_override(raw_model)
    provider = provider_factory.get_reasoning_provider()
    is_muse = provider.provider_name == "muse"
    allowed_models = {provider.model_id} if is_muse else get_allowed_models()
    if normalized_model is not None and normalized_model not in allowed_models:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid model_override '{raw_model}'. "
                f"Allowed models: {sorted(allowed_models)}"
            ),
        )

    target_model = normalized_model or (provider.model_id if is_muse else os.getenv("NEBIUS_MODEL", DEFAULT_MODEL))

    incident = get_incident_by_id(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found.")

    inc_sess = incident.get("session_id")
    if not is_demo_mode():
        if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
            logger.warning(
                f"[Security] Access denied to incident {incident_id}: "
                "session mismatch"
            )
            raise HTTPException(status_code=403, detail="Access denied: incident belongs to a different session.")

    # Check for existing valid report if not forcing refresh
    if not force_refresh:
        existing_reports = get_nemotron_reports_for_incident(incident_id)
        valid_reports = [
            r
            for r in existing_reports
            if is_valid_completed_report(r) and (normalized_model is None or r.get("model_id") == target_model)
            and (not is_muse or r.get("model_id") == target_model)
        ]
        if valid_reports:
            return valid_reports[0]

    frames_ev = build_frame_evidence_from_matches(incident.get("frame_matches") or [])
    intervals = cluster_frame_matches(frames_ev)
    investigation_input = build_investigation_input_from_incident(incident, intervals)

    frame_images = None
    if is_muse:
        try:
            from app.temporal_selector import (
                select_investigation_keyframes,
                build_multimodal_frame_items,
            )
            selected_pairs = select_investigation_keyframes(incident, max_pairs=3)
            frame_images = build_multimodal_frame_items(selected_pairs, incident_id=incident_id, max_items=6)
        except Exception as sel_err:
            logger.warning(f"[Investigation] Temporal keyframe selection encountered non-fatal error: {sel_err}")

    inv_kwargs = {"model_override": normalized_model}
    if frame_images:
        inv_kwargs["frame_images"] = frame_images

    report = provider.generate_investigation_report(
        investigation_input,
        **inv_kwargs,
    )
    try:
        saved_record = save_nemotron_report(report)
        return saved_record
    except Exception as e:
        # Document persistence error in operational metadata and return
        rep_dict = report.model_dump(mode="json")
        rep_dict.setdefault("operational_metadata", {}).setdefault("errors", []).append(f"Persistence error: {e}")
        return rep_dict


@app.get("/api/threats/{incident_id}/report")
def get_incident_latest_report(
    incident_id: str,
    x_client_session_id: Optional[str] = Header(None),
):
    """Retrieves the latest generated Nemotron report for a threat incident."""
    if not SAFE_ID_REGEX.match(incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")
    incident = get_incident_by_id(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found.")
    inc_sess = incident.get("session_id")
    if not is_demo_mode():
        if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
            raise HTTPException(status_code=403, detail="Access denied: incident belongs to a different session.")
    reports = get_nemotron_reports_for_incident(incident_id)
    if not reports:
        raise HTTPException(status_code=404, detail="No investigation report found for this incident.")
    return reports[0]


@app.get("/api/threats/{incident_id}/reports", response_model=List[ReportHistoryItem])
def get_incident_reports_history(
    incident_id: str,
    x_client_session_id: Optional[str] = Header(None),
):
    """
    Retrieves all forensic investigation reports for an incident, ordered newest first.
    Returns compact report history records suitable for list selection.
    """
    if not SAFE_ID_REGEX.match(incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")

    incident = get_incident_by_id(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found.")

    inc_sess = incident.get("session_id")
    if not is_demo_mode():
        if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
            raise HTTPException(status_code=403, detail="Access denied: incident belongs to a different session.")

    try:
        return get_nemotron_report_history(incident_id)
    except Exception as e:
        logger.error(f"[API] Error loading report history for incident {incident_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load report history: {e}")


@app.get("/api/threats/reports/{report_id}")
def get_report_by_id_endpoint(report_id: str):
    """Retrieves a specific Nemotron investigation report by report_id."""
    if not SAFE_ID_REGEX.match(report_id):
        raise HTTPException(status_code=400, detail="Invalid report ID format.")
    report = get_nemotron_report_by_id(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    return report


@app.get("/api/threats/{incident_id}/reports/export")
def export_incident_evidence_package_endpoint(
    incident_id: str,
    x_client_session_id: Optional[str] = Header(None),
):
    """
    Exports a cryptographically signed forensic evidence package for an incident's report history.
    Includes canonical manifest, Ed25519 signature, public key, chain of custody, ReportLab summary PDF,
    and individual report JSON snapshots in a single downloadable ZIP.
    """
    if not SAFE_ID_REGEX.match(incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")

    incident = get_incident_by_id(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found.")

    inc_sess = incident.get("session_id")
    if not is_demo_mode():
        if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
            logger.warning(
                f"[Security] Access denied to incident {incident_id}: "
                "session mismatch"
            )
            raise HTTPException(status_code=403, detail="Access denied: incident belongs to a different session.")

    reports = get_nemotron_reports_for_incident(incident_id)

    try:
        zip_bytes, manifest = create_evidence_package(incident, reports)
    except SigningConfigurationError as e:
        logger.error(f"[EvidenceExport] Signing configuration error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"[EvidenceExport] Error building evidence package for incident {incident_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate evidence package: {e}")

    filename = f"fixproof_evidence_{incident_id[:8]}_{int(datetime.now(timezone.utc).timestamp())}.zip"

    # Cloud Persistence: upload package to evidence-packages bucket and insert to evidence_packages table
    if is_cloud_mode():
        try:
            pkg_id = manifest.get("package_id") or str(uuid.uuid4())
            pkg_storage_path = f"{incident_id}/{pkg_id}.zip"
            storage_client = SupabaseStorageClient()
            storage_client.upload_file(
                bucket="evidence-packages",
                storage_path=pkg_storage_path,
                data_or_file=zip_bytes,
                content_type="application/zip",
                upsert=True,
            )
            default_db_manager.execute(
                """
                INSERT INTO evidence_packages (
                    package_id, incident_id, storage_path, sha256_hash,
                    signing_key_id, signature_hex, manifest_json, file_size_bytes, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (package_id) DO NOTHING;
                """,
                (
                    pkg_id,
                    incident_id,
                    f"evidence-packages/{pkg_storage_path}",
                    manifest.get("evidence_package_sha256", ""),
                    manifest.get("signing_key_id", ""),
                    manifest.get("signature_hex", ""),
                    json.dumps(manifest),
                    len(zip_bytes),
                ),
            )
        except Exception as pkg_err:
            logger.warning(f"[EvidenceExport] Failed to persist evidence package to cloud: {pkg_err}")

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Package-ID": manifest.get("package_id", ""),
            "X-Signing-Key-ID": manifest.get("signing_key_id", ""),
        },
    )


@app.get("/api/threats/{incident_id}/packages")
def get_incident_packages_endpoint(incident_id: str):
    """Retrieves saved evidence packages for an incident."""
    if not SAFE_ID_REGEX.match(incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")
    if is_cloud_mode():
        try:
            rows = default_db_manager.fetch_all(
                """
                SELECT package_id, incident_id, storage_path, sha256_hash,
                       signing_key_id, signature_hex, manifest_json, file_size_bytes, created_at
                FROM evidence_packages
                WHERE incident_id = %s
                ORDER BY created_at DESC;
                """,
                (incident_id,),
            )
            return rows
        except Exception as e:
            logger.error(f"[EvidenceExport] Failed to fetch packages: {e}")
            raise HTTPException(status_code=500, detail="Failed to load evidence packages.")
    return []


@app.post("/api/threats/reports/verify-package")
async def verify_evidence_package_endpoint(file: UploadFile = File(...)):
    """
    Upload and cryptographically verify a previously exported FixProof evidence package.
    Verifies Ed25519 signature against manifest, SHA-256 digests of all payload files,
    and sequential hash integrity of the chain of custody.
    """
    filename = (file.filename or "").lower()
    if not filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Uploaded file must be a .zip evidence package.")

    try:
        from app.evidence_package import MAX_VERIFICATION_ZIP_BYTES
        content = await file.read(MAX_VERIFICATION_ZIP_BYTES + 1)
        if len(content) > MAX_VERIFICATION_ZIP_BYTES:
            raise HTTPException(status_code=413, detail="Evidence package exceeds 50 MiB limit.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail="Failed to read uploaded file.")
    finally:
        await file.close()

    try:
        result = verify_evidence_package(content)
        return result
    except PackageVerificationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[EvidenceVerify] Unexpected error verifying package: {e}")
        raise HTTPException(status_code=500, detail=f"Package verification error: {e}")




@app.post("/diagnose")
def diagnose(request: DiagnoseRequest):
    provider = provider_factory.get_reasoning_provider()
    is_muse = provider.provider_name == "muse"
    api_key = None if is_muse else os.getenv("NEBIUS_API_KEY")
    model = provider.model_id if is_muse else os.getenv(
        "NEBIUS_MODEL",
        provider.model_id,
    )

    if not provider_factory.reasoning_is_configured(provider):
        raise HTTPException(
            status_code=500,
            detail="Reasoning provider credential is not configured",
        )

    try:
        response = provider.create_text_completion(
            request=dict(model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are FixProof, a Python debugging assistant. "
                        "Explain the likely cause of a bug report, "
                        "identify what evidence would be needed, "
                        "and suggest a safe next debugging step. "
                        "Do not claim you inspected code or ran tests "
                        "unless you actually did."
                    ),
                },
                {
                    "role": "user",
                    "content": request.issue_description,
                },
            ],
            max_tokens=500,
            temperature=0.1),
            client_options=None if is_muse else {"base_url": "https://api.tokenfactory.nebius.com/v1/", "api_key": api_key},
        )

        return {
            "diagnosis": (
                response.choices[0].message.content or ""
            ),
            "model": model,
            "provider": "Meta Model API" if is_muse else "Nebius Token Factory",
        }

    except Exception:
        raise HTTPException(
            status_code=502,
            detail="The model request failed. Check the backend logs.",
        )


# ==============================================================================
# Phase 3.5: Nemotron Intelligence & Action Center Endpoints
# ==============================================================================

@app.get("/api/nemotron/status")
def get_nemotron_status_endpoint():
    """Returns selected-provider configuration status and email dispatch availability."""
    configured, _, from_email = get_email_config()
    vision_provider = provider_factory.get_vision_provider()
    vision_key_name = "MODEL_API_KEY" if vision_provider.provider_name == "muse" else "NEBIUS_API_KEY"
    vision_available = bool(os.getenv(vision_key_name, "").strip())
    provider = provider_factory.get_reasoning_provider()
    available = provider_factory.reasoning_is_configured(provider)
    is_muse = provider.provider_name == "muse"
    return {
        "status": "ready" if available else "degraded",
        "provider": provider.provider_name,
        "vision_provider": vision_provider.provider_name,
        "status_scope": "configuration",
        "db_mode": get_db_config().mode.value,
        "configured_model": provider.model_id if is_muse else DEFAULT_MODEL,
        "vision_model": vision_provider.model_id,
        "sam_model": provider_factory.get_segmentation_provider().model_id,
        "detailed_report_model": provider.model_id if is_muse else DEFAULT_DETAILED_MODEL,
        "text_reasoning_available": available,
        "vision_verification_available": vision_available,
        "segmentation_available": vision_available,
        "email_delivery_available": configured,
        "email_provider": "Resend",
        "email_from": from_email if configured else None,
        "supported_documents": ["COPYRIGHT_NOTICE", "REVENUE_SHARE_OFFER"],
        "supported_jurisdictions": ["US_DMCA", "EU_DSA", "UK_CDPA", "GENERAL"],
    }


@app.post("/api/nemotron/draft-document")
def draft_nemotron_document_endpoint(
    req: DraftDocumentRequest,
    x_client_session_id: Optional[str] = Header(None, alias="X-Client-Session-Id"),
):
    """
    Generates an evidence-grounded draft document (Copyright Notice or Rev-Share Offer)
    using verified incident facts, user-supplied declarations, and optional Nemotron AI polishing.
    """
    if not SAFE_ID_REGEX.match(req.incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")

    incident = get_incident_by_id(req.incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail=f"Incident {req.incident_id} not found.")

    inc_sess = incident.get("session_id")
    if not is_demo_mode():
        if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
            logger.warning(
                f"[Security] Access denied drafting for incident {req.incident_id}: session mismatch"
            )
            raise HTTPException(status_code=403, detail="Access denied: incident belongs to a different session.")

    doc_type = (req.document_type or "").upper()
    if doc_type not in ("COPYRIGHT_NOTICE", "REVENUE_SHARE_OFFER"):
        raise HTTPException(status_code=400, detail=f"Unsupported document type: {req.document_type}")

    try:
        user_inputs = {
            "rights_holder_name": req.rights_holder,
            "authorized_rep": req.authorized_rep,
            "representative_name": req.authorized_rep,
            "contact_email": req.contact_email,
            "work_title": req.work_title,
            "recipient_name": req.recipient_name,
            "recipient_email": req.recipient_email,
            "jurisdiction": req.jurisdiction or "US_DMCA",
            "additional_notes": req.custom_notes,
            "proposed_rev_share_pct": req.rev_share_pct,
            "commercial_terms": req.commercial_terms,
            "response_deadline_days": req.response_deadline_days,
        }
        if doc_type == "COPYRIGHT_NOTICE":
            draft = generate_copyright_notice_draft(
                incident=incident,
                user_inputs=user_inputs,
                use_ai_synthesis=bool(req.use_ai_synthesis),
            )
        else:
            draft = generate_rev_share_proposal_draft(
                incident=incident,
                user_inputs=user_inputs,
                use_ai_synthesis=bool(req.use_ai_synthesis),
            )
        return draft
    except Exception as e:
        logger.error(f"[NemotronAction] Error drafting document: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to draft document: {e}")


@app.post("/api/nemotron/send-email")
def send_nemotron_email_endpoint(
    req: SendDocumentEmailRequest,
    x_client_session_id: Optional[str] = Header(None, alias="X-Client-Session-Id"),
):
    """
    Dispatches a reviewed document email via Resend API.
    Enforces mandatory human review confirmation, statutory declaration confirmation,
    and minimal persistent audit logging.
    """
    if not SAFE_ID_REGEX.match(req.incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")

    incident = get_incident_by_id(req.incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail=f"Incident {req.incident_id} not found.")

    inc_sess = incident.get("session_id")
    if not is_demo_mode():
        if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
            logger.warning(
                f"[Security] Access denied sending email for incident {req.incident_id}: session mismatch"
            )
            raise HTTPException(status_code=403, detail="Access denied: incident belongs to a different session.")

    try:
        result = send_nemotron_document_email(
            incident_id=req.incident_id,
            document_type=req.document_type,
            recipient_email=req.recipient_email,
            subject=req.subject,
            body=req.body,
            cc_emails=req.cc_emails,
            user_confirmed=req.user_confirmed,
            rights_declaration_confirmed=req.rights_declaration_confirmed,
            client_session_id=x_client_session_id,
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"[NemotronAction] Exception sending email: {e}")
        raise HTTPException(status_code=500, detail=f"Email dispatch error: {e}")


@app.get("/api/nemotron/email-status")
def get_email_status_endpoint():
    """Returns server-side email dispatch configuration status."""
    configured, _, from_email = get_email_config()
    return {
        "configured": configured,
        "provider": "Resend",
        "from_email": from_email if configured else None,
    }


@app.get("/api/nemotron/email-audit-log")
def get_email_audit_log_endpoint(
    incident_id: Optional[str] = None,
    x_client_session_id: Optional[str] = Header(None, alias="X-Client-Session-Id"),
):
    """Retrieves email audit logs filtered by incident and session isolation."""
    logs = load_email_audit_log()
    if incident_id:
        logs = [entry for entry in logs if entry.get("incident_id") == incident_id]
    if x_client_session_id and x_client_session_id != "demo-showcase":
        logs = [entry for entry in logs if entry.get("session_id") in (x_client_session_id, None, "demo-showcase")]
    return logs


# ── Detailed Report, PDF Download & Email Delivery Endpoints ─────────────────

@app.post("/api/nemotron/detailed-report")
def generate_detailed_report_endpoint(
    req: DetailedReportRequest,
    x_client_session_id: Optional[str] = Header(None, alias="X-Client-Session-Id"),
):
    """
    Synthesizes a comprehensive forensic investigation report using Nebius Token Factory,
    incorporating verified Nemotron Vision findings, generates an executive-grade ReportLab PDF,
    and optionally emails the PDF attachment to the specified recipient.
    """
    if not SAFE_ID_REGEX.match(req.incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")

    incident = get_incident_by_id(req.incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail=f"Incident {req.incident_id} not found.")

    inc_sess = incident.get("session_id")
    if not is_demo_mode():
        if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
            logger.warning(
                f"[Security] Access denied generating detailed report for incident {req.incident_id}: session mismatch"
            )
            raise HTTPException(status_code=403, detail="Access denied: incident belongs to a different session.")

    recipient = req.recipient_email.strip() if req.recipient_email else None
    if recipient:
        from app.nemotron_action import EMAIL_REGEX
        if not EMAIL_REGEX.match(recipient):
            raise HTTPException(status_code=400, detail=f"Invalid recipient email address format: '{recipient}'.")

    try:
        bundle = build_evidence_bundle(req.incident_id, client_session_id=x_client_session_id)
        report_data = synthesize_detailed_report(bundle, model_override=req.model_override)
        pdf_bytes = generate_detailed_report_pdf(report_data, bundle)
        save_detailed_report(req.incident_id, report_data, pdf_bytes)

        email_status = None
        if recipient:
            email_status = send_detailed_report_email(
                incident_id=req.incident_id,
                report_id=report_data["report_id"],
                recipient_email=recipient,
                pdf_bytes=pdf_bytes,
                summary_text=report_data.get("sections", {}).get("executive_summary"),
                client_session_id=x_client_session_id,
            )

        return {
            "success": True,
            "report": report_data,
            "pdf_url": f"/api/nemotron/detailed-report/{report_data['report_id']}/pdf",
            "email_status": email_status,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"[DetailedReport] Generation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate detailed report: {e}")


@app.get("/api/reports/{report_id}")
@app.get("/api/nemotron/detailed-report/{report_id}")
def get_detailed_report_endpoint(
    report_id: str,
    x_client_session_id: Optional[str] = Header(None, alias="X-Client-Session-Id"),
):
    """Retrieves the full detailed forensic report JSON by report_id."""
    from app.detailed_report import normalize_report_identifier
    clean_id = normalize_report_identifier(report_id)
    if not clean_id or not SAFE_ID_REGEX.match(clean_id):
        raise HTTPException(status_code=400, detail="Invalid report ID format.")

    record = get_detailed_report_record(clean_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Detailed report {report_id} not found.")

    incident_id = record.get("incident_id")
    if incident_id:
        incident = get_incident_by_id(incident_id)
        if incident:
            inc_sess = incident.get("session_id")
            if not is_demo_mode():
                if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
                    raise HTTPException(status_code=403, detail="Access denied: report belongs to a different session.")

    return record


@app.get("/api/reports/{report_id}/pdf")
@app.get("/api/nemotron/detailed-report/{report_id}/pdf")
def get_detailed_report_pdf_endpoint(
    report_id: str,
    x_client_session_id: Optional[str] = Header(None, alias="X-Client-Session-Id"),
):
    """Downloads or streams the pre-generated binary PDF for a detailed forensic report."""
    from app.detailed_report import normalize_report_identifier, resolve_detailed_report_pdf

    clean_id = normalize_report_identifier(report_id)
    if not clean_id or not SAFE_ID_REGEX.match(clean_id):
        raise HTTPException(status_code=400, detail="Invalid report ID format.")

    resolved = resolve_detailed_report_pdf(clean_id)
    if not resolved:
        raise HTTPException(status_code=404, detail=f"Detailed report or associated incident {report_id} not found.")

    pdf_bytes, record, resolved_rep_id, incident_id = resolved

    # Session access verification
    if incident_id:
        incident = get_incident_by_id(incident_id)
        if incident:
            inc_sess = incident.get("session_id")
            if not is_demo_mode():
                if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
                    raise HTTPException(status_code=403, detail="Access denied: report belongs to a different session.")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="fixproof-forensic-report-{resolved_rep_id[:8]}.pdf"',
        },
    )


@app.get("/api/nemotron/detailed-reports/{incident_id}")
def list_detailed_reports_endpoint(
    incident_id: str,
    x_client_session_id: Optional[str] = Header(None, alias="X-Client-Session-Id"),
):
    """Lists compact metadata for all previously generated detailed reports for an incident."""
    if not SAFE_ID_REGEX.match(incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")

    incident = get_incident_by_id(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found.")

    inc_sess = incident.get("session_id")
    if not is_demo_mode():
        if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
            raise HTTPException(status_code=403, detail="Access denied.")

    return list_detailed_reports_for_incident(incident_id)


@app.post("/api/nemotron/email-detailed-report")
def email_detailed_report_endpoint(
    req: EmailDetailedReportRequest,
    x_client_session_id: Optional[str] = Header(None, alias="X-Client-Session-Id"),
):
    """
    Retries or dispatches email delivery for an existing detailed report and PDF,
    without re-synthesizing the expensive model report.
    """
    if req.user_confirmed is not True:
        raise HTTPException(status_code=400, detail="Explicit review confirmation is required before sending.")
    if not x_client_session_id or not re.fullmatch(r"[A-Za-z0-9_-]{3,64}", x_client_session_id):
        raise HTTPException(status_code=400, detail="A valid client session header is required.")
    if not SAFE_ID_REGEX.match(req.incident_id) or not SAFE_ID_REGEX.match(req.report_id):
        raise HTTPException(status_code=400, detail="Invalid ID format.")

    incident = get_incident_by_id(req.incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail=f"Incident {req.incident_id} not found.")

    inc_sess = incident.get("session_id")
    if not is_demo_mode():
        if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
            raise HTTPException(status_code=403, detail="Access denied.")

    record = get_detailed_report_record(req.report_id)
    if not record or record.get("incident_id") != req.incident_id:
        raise HTTPException(status_code=404, detail=f"Report {req.report_id} not found for incident {req.incident_id}.")

    pdf_bytes = get_detailed_report_pdf_bytes(req.report_id)
    if not pdf_bytes:
        raise HTTPException(status_code=404, detail="PDF binary file not found on disk.")

    from app.nemotron_action import EMAIL_REGEX
    if not req.recipient_email or not EMAIL_REGEX.match(req.recipient_email.strip()):
        raise HTTPException(status_code=400, detail=f"Invalid recipient email address format: '{req.recipient_email}'.")

    try:
        result = send_detailed_report_email(
            incident_id=req.incident_id,
            report_id=req.report_id,
            recipient_email=req.recipient_email.strip(),
            pdf_bytes=pdf_bytes,
            summary_text=record.get("sections", {}).get("executive_summary"),
            client_session_id=x_client_session_id,
            subject_override=req.subject,
            body_override=req.body,
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"[DetailedReport] Email dispatch failed: {e}")
        raise HTTPException(status_code=500, detail=f"Email dispatch error: {e}")


@app.get("/api/nemotron/summary-download/{incident_id}")
def download_summary_endpoint(
    incident_id: str,
    x_client_session_id: Optional[str] = Header(None, alias="X-Client-Session-Id"),
):
    """
    Exports and streams the existing short investigation summary report as plain text,
    requiring zero model invocation.
    """
    if not SAFE_ID_REGEX.match(incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")

    incident = get_incident_by_id(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found.")

    inc_sess = incident.get("session_id")
    if not is_demo_mode():
        if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
            raise HTTPException(status_code=403, detail="Access denied.")

    try:
        filename, content = generate_short_summary_download(incident_id)
        return Response(
            content=content,
            media_type="text/plain; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )
    except Exception as e:
        logger.error(f"[DetailedReport] Summary download error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate summary download: {e}")


class SAMSegmentRequest(BaseModel):
    prompt: str
    image_base64: Optional[str] = None
    incident_id: Optional[str] = None
    asset_id: Optional[str] = None
    evidence_id: Optional[str] = None
    frame_index: Optional[int] = None
    timestamp_sec: Optional[float] = None
    model_override: Optional[str] = None


@app.post("/api/sam/segment")
def sam_segment_endpoint(
    req: SAMSegmentRequest,
    x_client_session_id: Optional[str] = Header(None, alias="X-Client-Session-Id"),
):
    """
    Executes isolated specialist concept segmentation and visual localization using SAM 3.1.
    Accepts an explicit frame image (base64 or incident reference) and a target concept prompt.
    Returns normalized bounding box coordinates and segmentation mask representations.
    """
    clean_prompt = req.prompt.strip() if req.prompt else ""
    if not clean_prompt:
        raise HTTPException(status_code=400, detail="Prompt must be a non-empty string.")

    raw_bytes = None
    if req.image_base64:
        try:
            b64_str = req.image_base64
            if "," in b64_str:
                b64_str = b64_str.split(",", 1)[1]
            raw_bytes = base64.b64decode(b64_str)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid base64 image data: {e}")

    if not raw_bytes and req.incident_id:
        incident = get_incident_by_id(req.incident_id)
        if incident:
            inc_sess = incident.get("session_id")
            if not is_demo_mode():
                if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
                    raise HTTPException(status_code=403, detail="Access denied.")
            matches = incident.get("frame_matches") or []
            target_match = None
            if req.evidence_id:
                for m in matches:
                    if m.get("evidence_id") == req.evidence_id:
                        target_match = m
                        break
            if not target_match and matches:
                target_match = matches[0]

            if target_match and target_match.get("submitted_frame"):
                frame_p = target_match["submitted_frame"].get("frame_path")
                if frame_p and Path(frame_p).is_file():
                    raw_bytes = Path(frame_p).read_bytes()

    if not raw_bytes:
        raise HTTPException(
            status_code=400,
            detail="No valid image provided. Supply 'image_base64' or a valid 'incident_id' with frames."
        )

    provider = provider_factory.get_segmentation_provider()
    meta = {
        "incident_id": req.incident_id,
        "asset_id": req.asset_id,
        "evidence_id": req.evidence_id,
        "frame_index": req.frame_index,
        "timestamp_sec": req.timestamp_sec,
    }
    result = provider.segment_frame(
        image_bytes=raw_bytes,
        prompt=clean_prompt,
        metadata=meta,
        model_override=req.model_override,
    )
    return result.model_dump(mode="json")


class SAMInvestigationPayload(BaseModel):
    prompt: Optional[str] = "broadcast subject"
    force_refresh: Optional[bool] = False


@app.post("/api/incidents/{incident_id}/sam-investigation")
@app.post("/api/incidents/{incident_id}/sam-grounding")
def run_incident_sam_investigation_endpoint(
    incident_id: str,
    payload: Optional[SAMInvestigationPayload] = None,
    x_client_session_id: Optional[str] = Header(None, alias="X-Client-Session-Id"),
):
    """
    Manually triggers specialist SAM 3.1 visual grounding for an existing incident's
    top candidate frame pairs (up to 3 pairs / 6 frames).
    Updates and persists the incident with validated bounding boxes without corrupting existing CV/Muse evidence.
    """
    if not SAFE_ID_REGEX.match(incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")

    incident = get_incident_by_id(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found.")

    inc_sess = incident.get("session_id")
    if not is_demo_mode():
        if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
            raise HTTPException(status_code=403, detail="Access denied: incident belongs to a different session.")

    matches = incident.get("frame_matches") or []
    if not matches:
        raise HTTPException(status_code=400, detail="Incident has no candidate frame matches to investigate.")

    # Determine effective prompt
    raw_prompt = (payload.prompt.strip() if payload and payload.prompt else "")
    if raw_prompt and raw_prompt != "broadcast subject":
        prompt = raw_prompt
    else:
        prior_prompt = None
        for fm in matches:
            s_sam = fm.get("sam_segmentation") or (fm.get("best_match") or {}).get("sam_segmentation")
            if s_sam and isinstance(s_sam, dict) and s_sam.get("prompt"):
                prior_prompt = s_sam.get("prompt")
                break
        prompt = prior_prompt or "football"

    force = bool(payload.force_refresh) if payload else False

    from app.temporal_selector import run_incident_sam_investigation
    result = run_incident_sam_investigation(
        incident=incident,
        prompt=prompt,
        max_pairs=3,
        force=force,
    )

    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error") or "SAM investigation failed.")

    return result


@app.get("/api/incidents/{incident_id}/frames/{pair_index}/annotated")
@app.get("/api/forensics/{incident_id}/annotated-frame/{pair_index}")
def stream_annotated_incident_frame(
    incident_id: str,
    pair_index: int,
    target: str = Query("suspect", pattern="^(suspect|reference)$"),
    x_client_session_id: Optional[str] = Header(None, alias="X-Client-Session-Id"),
):
    """
    Streams a high-resolution annotated JPEG frame with SAM 3.1 bounding boxes
    and label pills baked in via Pillow. If SAM has not run or found no objects,
    serves the original unannotated frame image.
    """
    if not SAFE_ID_REGEX.match(incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")

    incident = get_incident_by_id(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found.")

    inc_sess = incident.get("session_id")
    if not is_demo_mode():
        if inc_sess and inc_sess != "demo-showcase" and inc_sess != x_client_session_id:
            raise HTTPException(status_code=403, detail="Access denied: incident belongs to a different session.")

    matches = incident.get("frame_matches") or []
    if pair_index < 0 or pair_index >= len(matches):
        raise HTTPException(status_code=404, detail=f"Pair index {pair_index} out of range (0..{len(matches)-1}).")

    match = matches[pair_index]
    best = match.get("best_match") or {}

    from app.temporal_selector import (
        load_frame_image_bytes,
        render_annotated_frame_bytes,
    )

    raw_bytes = None
    sam_data = None

    if target == "suspect":
        sub = match.get("submitted_frame") or {}
        sub_aid = sub.get("asset_id") or incident.get("submitted_asset_id") or incident_id
        sub_fn = sub.get("filename") or f"frame_{int(sub.get('timestamp_sec', 0)):04d}s.jpg"
        raw_bytes, _ = load_frame_image_bytes(
            sub.get("frame_path"),
            asset_id=sub_aid,
            filename=sub_fn,
        )
        if not raw_bytes:
            thumb_path_str = incident.get("thumbnail_storage_path") or incident.get("suspect_thumbnail_preview_url")
            if thumb_path_str:
                raw_bytes, _ = load_frame_image_bytes(thumb_path_str, filename=Path(thumb_path_str).name)

        sam_data = match.get("sam_segmentation") or best.get("sam_segmentation")
        if sam_data and sam_data.get("target") == "reference":
            sam_data = None
    else:
        # Reference frame
        ref_aid = best.get("source_asset_id")
        if ref_aid and ref_aid not in ("other_asset", "unregistered"):
            ref_fn = best.get("source_filename") or f"frame_{int(best.get('source_timestamp_sec', 0)):04d}s.jpg"
            raw_bytes, _ = load_frame_image_bytes(
                best.get("source_frame_path"),
                asset_id=ref_aid,
                filename=ref_fn,
            )
        if not raw_bytes:
            from app.matcher import load_reference_frame_image
            ref_pil = load_reference_frame_image(best)
            if ref_pil:
                try:
                    buf = io.BytesIO()
                    ref_pil.convert("RGB").save(buf, format="JPEG", quality=90)
                    raw_bytes = buf.getvalue()
                except Exception:
                    pass

        sam_data = match.get("ref_sam_segmentation") or best.get("ref_sam_segmentation")
        if not sam_data:
            s_sam = match.get("sam_segmentation") or best.get("sam_segmentation")
            if s_sam and s_sam.get("target") == "reference":
                sam_data = s_sam

    if not raw_bytes:
        raise HTTPException(status_code=404, detail="Underlying frame image bytes not found in storage.")

    annotated_bytes = render_annotated_frame_bytes(raw_bytes, sam_data)

    return Response(
        content=annotated_bytes,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


from app.temporal_evidence_api import router as temporal_evidence_router
app.include_router(temporal_evidence_router)
