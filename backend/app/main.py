import mimetypes
import os
import re
from datetime import datetime, timezone
from typing import Optional, Union

# Prevent OpenMP duplicate runtime abort on macOS between PyTorch and FAISS
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import uuid
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, RedirectResponse
from openai import OpenAI
from pydantic import BaseModel, Field

load_dotenv()

app = FastAPI(title="FixProof API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
from app.matcher import analyze_asset_matches
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
    is_cloud_mode,
)
from app.evidence_models import (
    build_frame_evidence_from_matches,
    build_investigation_input_from_incident,
)
from app.timeline import cluster_frame_matches
from app.nemotron_engine import (
    generate_nemotron_report,
    get_allowed_models,
    normalize_model_override,
    DEFAULT_MODEL,
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
        description="Optional model ID override. Leave empty or null to use 'nvidia/Nemotron-3_5-Lightning'. Allowed: nvidia/Nemotron-3_5-Lightning, nvidia/Nemotron-3.5-Super-VL.",
        json_schema_extra={"example": None},
    )


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
    """Hydrates reference vault if cloud mode is enabled."""
    db_cfg = get_db_config()
    if db_cfg.is_cloud:
        default_vault.reload(mode=db_cfg.mode.value)

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


class DiagnoseRequest(BaseModel):
    issue_description: str


@app.get("/health")
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
def stream_asset_frame(asset_id: str, frame_filename: str):
    """
    Safely streams an extracted video frame to the client.
    Strictly checks path containment and character safety.
    In cloud mode, streams from Supabase Storage reference-frames bucket.
    """
    if not SAFE_ID_REGEX.match(asset_id):
        raise HTTPException(status_code=400, detail="Invalid asset ID format.")
    if not SAFE_FRAME_REGEX.match(frame_filename):
        raise HTTPException(status_code=400, detail="Invalid frame filename.")

    # Check suspect frames directory first
    suspect_frame_path = (SUSPECTS_FRAMES_DIR / asset_id / frame_filename).resolve()
    suspect_base = SUSPECTS_FRAMES_DIR.resolve()

    if suspect_frame_path.is_relative_to(suspect_base) and suspect_frame_path.is_file():
        return FileResponse(
            str(suspect_frame_path),
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    if is_cloud_mode():
        cloud_cache_file = (
            Path(__file__).resolve().parent.parent
            / "storage"
            / "cloud_cache"
            / "frames"
            / asset_id
            / frame_filename
        ).resolve()
        if cloud_cache_file.is_file():
            return FileResponse(
                str(cloud_cache_file),
                media_type="image/jpeg",
                headers={"Cache-Control": "public, max-age=3600"},
            )

        try:
            storage_client = SupabaseStorageClient()
            frame_bytes = storage_client.download_file("reference-frames", f"{asset_id}/{frame_filename}")
            cloud_cache_file.parent.mkdir(parents=True, exist_ok=True)
            cloud_cache_file.write_bytes(frame_bytes)
            return Response(
                content=frame_bytes,
                media_type="image/jpeg",
                headers={"Cache-Control": "public, max-age=3600"},
            )
        except StorageNotFoundError:
            raise HTTPException(status_code=404, detail="Frame not found in cloud storage.")
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to retrieve frame from storage: {e}")

    # Local mode fallback
    frame_path = (FRAMES_DIR / asset_id / frame_filename).resolve()
    base_dir = FRAMES_DIR.resolve()

    if frame_path.is_relative_to(base_dir) and frame_path.is_file():
        return FileResponse(
            str(frame_path),
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    raise HTTPException(status_code=404, detail="Frame not found.")


@app.get("/api/vault/assets/{asset_id}/video")
def stream_asset_video(asset_id: str):
    """
    Safely streams the original uploaded video for an asset.
    In cloud mode, generates a short-lived authenticated signed URL.
    """
    if not SAFE_ID_REGEX.match(asset_id):
        raise HTTPException(status_code=400, detail="Invalid asset ID format.")

    # Check suspect videos first
    suspect_matches = list(SUSPECTS_VIDEOS_DIR.glob(f"{asset_id}.*"))
    if suspect_matches:
        target_video = suspect_matches[0].resolve()
        suspect_base = SUSPECTS_VIDEOS_DIR.resolve()
        if target_video.is_relative_to(suspect_base) and target_video.is_file():
            media_type = resolve_video_content_type(target_video)
            return FileResponse(str(target_video), media_type=media_type)

    if is_cloud_mode():
        row = default_db_manager.fetch_one(
            "SELECT filename, storage_path FROM reference_assets WHERE asset_id = %s",
            (asset_id,),
        )
        if not row:
            raise HTTPException(status_code=404, detail=f"Video for asset '{asset_id}' not found.")
        storage_path = row["storage_path"]
        bucket = "reference-assets"
        if storage_path.startswith(f"{bucket}/"):
            storage_path = storage_path[len(f"{bucket}/"):]
        try:
            storage_client = SupabaseStorageClient()
            signed_url = storage_client.create_signed_url(bucket, storage_path, expires_in=1800)
            return RedirectResponse(url=signed_url, status_code=307)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to generate streaming URL: {e}")

    # Local mode fallback
    matches = list(STORAGE_DIR.glob(f"{asset_id}.*"))
    base_dir = STORAGE_DIR.resolve()
    if not matches:
        raise HTTPException(status_code=404, detail=f"Video for asset '{asset_id}' not found.")

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
):
    """
    Ingests an untrusted suspect video, extracts frames, and executes Sentinel-style
    visual matching against the FAISS reference vault.
    NEVER indexes suspect video into the reference vault.
    Records the scan incident for forensic review.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No suspect video provided.")
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video format '{file_ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

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

        if is_cloud_mode() and default_vault.vector_db.ntotal == 0:
            raise HTTPException(
                status_code=503,
                detail="Cloud reference vault is uninitialized or empty. Scanning aborted.",
            )

        match_results = analyze_asset_matches(
            submitted_asset_id=suspect_id,
            frames_dir=suspect_frames_dir,
            vault=default_vault,
            k_candidates=3,
        )

        if is_cloud_mode() and match_results.get("overall_status") == "NO_REFERENCE_DATA":
            raise HTTPException(
                status_code=503,
                detail="Cloud reference vault has no reference data. Scanning cannot produce valid verdict.",
            )

        match_results["suspect_filename"] = file.filename
        match_results["file_size"] = total_bytes
        match_results["duration_seconds"] = duration_sec
        match_results["frame_count"] = len(extracted_frames)
        match_results["scanned_at"] = datetime.now(timezone.utc).isoformat()
        match_results["incident_id"] = str(uuid.uuid4())

        save_incident(match_results)
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
def screen_video_url_endpoint(payload: ScreenUrlRequest):
    """
    Screens a public video URL by extracting metadata and public thumbnail,
    verifying SSRF protection, and matching the thumbnail against the FAISS reference vault.
    NEVER downloads the underlying third-party video stream.
    """
    raw_url = (payload.url or "").strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="Video URL is required.")

    try:
        result = screen_video_url(raw_url, vault=default_vault)
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
def get_suspect_thumbnail_endpoint(incident_id: str):
    """Serves the cached suspect thumbnail image for UI preview."""
    if not SAFE_ID_REGEX.match(incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")
    thumb_path = SUSPECTS_THUMBNAILS_DIR / f"{incident_id}.jpg"
    if not thumb_path.exists():
        raise HTTPException(status_code=404, detail="Suspect thumbnail image not found.")
    return FileResponse(thumb_path, media_type="image/jpeg")


@app.get("/api/incidents")
def get_incidents_list():
    """Returns recorded threat scan incidents."""
    return load_incidents()


@app.get("/api/incidents/{incident_id}")
def get_single_incident(incident_id: str):
    """Returns details for a specific incident."""
    for inc in load_incidents():
        if inc.get("incident_id") == incident_id:
            return inc
    raise HTTPException(status_code=404, detail="Incident not found.")


@app.post("/api/threats/{incident_id}/investigate")
def investigate_threat_incident(
    incident_id: str,
    payload: Optional[InvestigateIncidentRequest] = None,
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
    allowed_models = get_allowed_models()
    if normalized_model is not None and normalized_model not in allowed_models:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid model_override '{raw_model}'. "
                f"Allowed models: {sorted(allowed_models)}"
            ),
        )

    target_model = normalized_model or os.getenv("NEBIUS_MODEL", DEFAULT_MODEL)

    # Check for existing valid report if not forcing refresh
    if not force_refresh:
        existing_reports = get_nemotron_reports_for_incident(incident_id)
        valid_reports = [
            r
            for r in existing_reports
            if is_valid_completed_report(r) and (normalized_model is None or r.get("model_id") == target_model)
        ]
        if valid_reports:
            return valid_reports[0]

    incident = get_incident_by_id(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found.")

    frames_ev = build_frame_evidence_from_matches(incident.get("frame_matches") or [])
    intervals = cluster_frame_matches(frames_ev)
    investigation_input = build_investigation_input_from_incident(incident, intervals)

    report = generate_nemotron_report(investigation_input, model_override=normalized_model)
    try:
        saved_record = save_nemotron_report(report)
        return saved_record
    except Exception as e:
        # Document persistence error in operational metadata and return
        rep_dict = report.model_dump(mode="json")
        rep_dict.setdefault("operational_metadata", {}).setdefault("errors", []).append(f"Persistence error: {e}")
        return rep_dict


@app.get("/api/threats/{incident_id}/report")
def get_incident_latest_report(incident_id: str):
    """Retrieves the latest generated Nemotron report for a threat incident."""
    if not SAFE_ID_REGEX.match(incident_id):
        raise HTTPException(status_code=400, detail="Invalid incident ID format.")
    reports = get_nemotron_reports_for_incident(incident_id)
    if not reports:
        raise HTTPException(status_code=404, detail="No investigation report found for this incident.")
    return reports[0]


@app.get("/api/threats/reports/{report_id}")
def get_report_by_id_endpoint(report_id: str):
    """Retrieves a specific Nemotron investigation report by report_id."""
    if not SAFE_ID_REGEX.match(report_id):
        raise HTTPException(status_code=400, detail="Invalid report ID format.")
    report = get_nemotron_report_by_id(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    return report




@app.post("/diagnose")
def diagnose(request: DiagnoseRequest):
    api_key = os.getenv("NEBIUS_API_KEY")
    model = os.getenv(
        "NEBIUS_MODEL",
        "nvidia/Nemotron-3_5-Lightning",
    )

    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="NEBIUS_API_KEY is not configured",
        )

    client = OpenAI(
        base_url="https://api.tokenfactory.nebius.com/v1/",
        api_key=api_key,
    )

    try:
        response = client.chat.completions.create(
            model=model,
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
            temperature=0.1,
        )

        return {
            "diagnosis": (
                response.choices[0].message.content or ""
            ),
            "model": model,
            "provider": "Nebius Token Factory",
        }

    except Exception:
        raise HTTPException(
            status_code=502,
            detail="The model request failed. Check the backend logs.",
        )
