"""
Asset Registry and Incident Storage module for FixProof.
Maintains persistent records of official reference assets and threat scan incidents.
"""

from datetime import datetime, timezone
import json
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.db import get_db_config, default_db_manager

logger = logging.getLogger(__name__)

STORAGE_ROOT = Path(__file__).resolve().parent.parent / "storage"
VIDEOS_DIR = STORAGE_ROOT / "videos"
FRAMES_DIR = STORAGE_ROOT / "frames"
ASSETS_META_FILE = STORAGE_ROOT / "assets_metadata.json"
INCIDENTS_FILE = STORAGE_ROOT / "incidents.json"
NEMOTRON_REPORTS_FILE = STORAGE_ROOT / "nemotron_reports.json"

# Ensure directories exist
VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
FRAMES_DIR.mkdir(parents=True, exist_ok=True)


def is_cloud_mode() -> bool:
    """Checks whether the application is running in cloud database mode."""
    try:
        return get_db_config().is_cloud
    except Exception:
        return False


def load_assets_metadata() -> Dict[str, Dict[str, Any]]:
    """Loads asset metadata from storage/assets_metadata.json."""
    if not ASSETS_META_FILE.exists():
        return {}
    try:
        with open(ASSETS_META_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"[Registry] Failed to read {ASSETS_META_FILE}: {e}")
        return {}


def save_assets_metadata(metadata: Dict[str, Dict[str, Any]]) -> None:
    """Persists asset metadata to storage/assets_metadata.json safely."""
    try:
        with open(ASSETS_META_FILE, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)
    except Exception as e:
        logger.error(f"[Registry] Failed to write {ASSETS_META_FILE}: {e}")


def register_asset(
    asset_id: str,
    filename: str,
    stored_filename: str,
    file_size: int,
    content_type: str,
    duration_seconds: float,
    frame_count: int,
    frames: List[Dict[str, Any]],
    auto_indexed: bool = False,
) -> Dict[str, Any]:
    """Registers a newly uploaded official reference asset."""
    all_meta = load_assets_metadata()

    record = {
        "asset_id": asset_id,
        "filename": filename,
        "stored_filename": stored_filename,
        "file_size": file_size,
        "content_type": content_type,
        "duration_seconds": duration_seconds,
        "frame_count": frame_count,
        "sample_interval_seconds": 5,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "is_reference": True,
        "auto_indexed": auto_indexed,
    }

    all_meta[asset_id] = record
    save_assets_metadata(all_meta)
    return record


def get_asset_frames_list(asset_id: str) -> List[Dict[str, Any]]:
    """Discovers all extracted frames for an asset and builds client-friendly descriptors."""
    asset_dir = FRAMES_DIR / asset_id
    if not asset_dir.exists():
        return []

    frame_files = sorted(asset_dir.glob("frame_*.jpg"))
    frames = []
    for idx, fpath in enumerate(frame_files):
        ts = idx * 5
        try:
            parts = fpath.stem.split("_")
            if len(parts) > 1:
                ts = int(parts[1].replace("s", ""))
        except Exception:
            pass

        frames.append({
            "frame_index": idx,
            "timestamp_sec": ts,
            "filename": fpath.name,
            "url": f"/api/vault/assets/{asset_id}/frames/{fpath.name}",
        })
    return frames


def list_registered_assets(vault: Any) -> List[Dict[str, Any]]:
    """
    Lists all official reference assets with live indexing status from FAISS vault.
    Supports both local mode (JSON + filesystem) and Supabase cloud mode (PostgreSQL).
    """
    if is_cloud_mode():
        # Supabase Cloud Mode: Query PostgreSQL catalog
        asset_rows = default_db_manager.fetch_all(
            """
            SELECT asset_id, filename, storage_path, file_size_bytes, content_type,
                   duration_seconds, frame_count, sample_interval_sec, sha256_hash,
                   indexing_status, indexed_vectors_count, created_at, updated_at
            FROM reference_assets
            ORDER BY created_at DESC;
            """
        )
        frame_rows = default_db_manager.fetch_all(
            """
            SELECT frame_id, asset_id, frame_index, timestamp_sec, storage_path, phash, created_at
            FROM reference_frames
            ORDER BY asset_id, frame_index ASC;
            """
        )

        frames_by_asset: Dict[str, List[Dict[str, Any]]] = {}
        for f_row in frame_rows:
            aid = str(f_row["asset_id"])
            if aid not in frames_by_asset:
                frames_by_asset[aid] = []
            f_name = Path(f_row["storage_path"]).name
            frames_by_asset[aid].append({
                "frame_index": f_row["frame_index"],
                "timestamp_sec": f_row["timestamp_sec"],
                "filename": f_name,
                "url": f"/api/vault/assets/{aid}/frames/{f_name}",
            })

        vector_counts: Dict[str, int] = {}
        if vault and hasattr(vault, "metadata_store"):
            for meta in vault.metadata_store.values():
                aid = meta.get("asset_id")
                if aid:
                    vector_counts[str(aid)] = vector_counts.get(str(aid), 0) + 1

        asset_list = []
        for row in asset_rows:
            aid = str(row["asset_id"])
            frames = frames_by_asset.get(aid, [])
            vec_count = vector_counts.get(aid, int(row.get("indexed_vectors_count") or 0))
            is_indexed = vec_count > 0

            uploaded_at_val = row.get("created_at")
            if isinstance(uploaded_at_val, datetime):
                uploaded_at_str = uploaded_at_val.isoformat()
            elif uploaded_at_val:
                uploaded_at_str = str(uploaded_at_val)
            else:
                uploaded_at_str = ""

            asset_list.append({
                "asset_id": aid,
                "filename": row["filename"],
                "uploaded_at": uploaded_at_str,
                "duration_seconds": float(row["duration_seconds"]) if row.get("duration_seconds") is not None else 0.0,
                "frame_count": int(row.get("frame_count") or len(frames)),
                "file_size": int(row.get("file_size_bytes") or 0),
                "indexed": is_indexed,
                "indexed_vectors": vec_count,
                "sample_interval_seconds": int(row.get("sample_interval_sec") or 5),
                "video_url": f"/api/vault/assets/{aid}/video",
                "thumbnail_url": frames[0]["url"] if frames else None,
                "frames": frames,
            })
        existing_ids = {a["asset_id"] for a in asset_list}
        for d in FRAMES_DIR.iterdir():
            if d.is_dir() and not d.name.startswith(".") and not d.name.startswith("suspect_") and d.name not in existing_ids:
                local_frames = get_asset_frames_list(d.name)
                if local_frames:
                    v_count = vector_counts.get(d.name, 0)
                    asset_list.append({
                        "asset_id": d.name,
                        "filename": f"{d.name}.mp4",
                        "uploaded_at": datetime.now(timezone.utc).isoformat(),
                        "duration_seconds": 0.0,
                        "frame_count": len(local_frames),
                        "file_size": 0,
                        "indexed": v_count > 0,
                        "indexed_vectors": v_count,
                        "sample_interval_seconds": 5,
                        "video_url": f"/api/vault/assets/{d.name}/video",
                        "thumbnail_url": local_frames[0]["url"] if local_frames else None,
                        "frames": local_frames,
                    })
        return asset_list

    # Local Mode: Source of truth is persistent assets_metadata.json, indexed vault assets,
    # and valid local assets with extracted frames
    all_meta = load_assets_metadata()
    discovered_ids = set(all_meta.keys())

    # Include any assets explicitly indexed in the reference vault
    if vault and hasattr(vault, "metadata_store"):
        for meta in vault.metadata_store.values():
            aid = meta.get("asset_id")
            if aid:
                discovered_ids.add(aid)

    # Include local assets with verified extracted frames on disk
    for d in FRAMES_DIR.iterdir():
        if d.is_dir() and not d.name.startswith(".") and not d.name.startswith("suspect_"):
            if list(d.glob("frame_*.jpg")):
                discovered_ids.add(d.name)

    # Compute vector counts per asset from vault.metadata_store
    vector_counts = {}
    if vault and hasattr(vault, "metadata_store"):
        for meta in vault.metadata_store.values():
            aid = meta.get("asset_id")
            if aid:
                vector_counts[aid] = vector_counts.get(aid, 0) + 1

    asset_list = []
    for asset_id in discovered_ids:
        frames = get_asset_frames_list(asset_id)
        video_files = list(VIDEOS_DIR.glob(f"{asset_id}.*"))
        if not frames and not video_files:
            continue

        meta = all_meta.get(asset_id, {})
        stored_file = video_files[0] if video_files else None

        filename = meta.get("filename")
        if not filename and stored_file:
            filename = stored_file.name
        elif not filename:
            ext = stored_file.suffix if stored_file else ".mp4"
            filename = f"asset_{asset_id[:8]}{ext}"

        file_size = meta.get("file_size")
        if file_size is None and stored_file and stored_file.exists():
            file_size = stored_file.stat().st_size
        elif file_size is None:
            file_size = 0

        uploaded_at = meta.get("uploaded_at")
        if not uploaded_at and stored_file and stored_file.exists():
            uploaded_at = datetime.fromtimestamp(stored_file.stat().st_mtime, tz=timezone.utc).isoformat()
        elif not uploaded_at:
            uploaded_at = datetime.now(timezone.utc).isoformat()

        duration = meta.get("duration_seconds")
        if duration is None:
            duration = max(0.0, float((len(frames) - 1) * 5)) if frames else 0.0

        indexed_vec_count = vector_counts.get(asset_id, 0)
        is_indexed = indexed_vec_count > 0

        asset_list.append({
            "asset_id": asset_id,
            "filename": filename,
            "uploaded_at": uploaded_at,
            "duration_seconds": duration,
            "frame_count": len(frames),
            "file_size": file_size,
            "indexed": is_indexed,
            "indexed_vectors": indexed_vec_count,
            "sample_interval_seconds": 5,
            "video_url": f"/api/vault/assets/{asset_id}/video" if stored_file else None,
            "thumbnail_url": frames[0]["url"] if frames else None,
            "frames": frames,
        })

    # Sort most recently uploaded first
    asset_list.sort(key=lambda a: a.get("uploaded_at", ""), reverse=True)
    return asset_list


def get_asset_detail(asset_id: str, vault: Any) -> Optional[Dict[str, Any]]:
    """Gets complete metadata and frames for a specific asset."""
    assets = list_registered_assets(vault)
    for a in assets:
        if a["asset_id"] == asset_id:
            return a
    return None


def delete_asset_record(asset_id: str, vault: Any) -> bool:
    """Removes an asset from storage, frame cache, and FAISS vault in local or cloud mode."""
    import uuid as _uuid
    is_uuid = False
    try:
        _uuid.UUID(str(asset_id))
        is_uuid = True
    except (ValueError, TypeError, AttributeError):
        is_uuid = False

    if is_cloud_mode() and is_uuid:
        # Query storage path before deletion
        row = default_db_manager.fetch_one(
            "SELECT storage_path FROM reference_assets WHERE asset_id = %s;",
            (asset_id,),
        )
        target_path = None
        if row and row.get("storage_path"):
            sp = row["storage_path"]
            target_path = sp[len("reference-assets/"):] if sp.startswith("reference-assets/") else sp
        if not target_path:
            target_path = f"{asset_id}/{asset_id}.mp4"

        # 1. Delete asset from PostgreSQL (foreign keys cascade to reference_frames & reference_vectors)
        default_db_manager.execute("DELETE FROM reference_assets WHERE asset_id = %s;", (asset_id,))

        # 2. Delete storage objects if accessible
        try:
            from app.storage import SupabaseStorageClient
            storage_client = SupabaseStorageClient()
            storage_client.delete_object("reference-assets", target_path)
        except Exception as e:
            logger.warning(f"[Registry] Could not delete cloud storage object for asset {asset_id}: {e}")

        # 3. Update vault vectors and create new snapshot checkpoint
        if vault and hasattr(vault, "remove_asset_vectors"):
            removed = vault.remove_asset_vectors(asset_id)
            if removed > 0 and hasattr(vault, "cloud_cache_dir"):
                try:
                    import faiss
                    from app.cloud_ingest import sha256_of_file
                    from app.storage import SupabaseStorageClient
                    storage_client = SupabaseStorageClient()
                    active_snapshot = default_db_manager.fetch_one(
                        "SELECT version_number FROM vault_snapshots WHERE status = 'ACTIVE' ORDER BY version_number DESC LIMIT 1;"
                    )
                    curr_version = active_snapshot["version_number"] if active_snapshot else 0
                    new_version = curr_version + 1
                    cache_dir = vault.cloud_cache_dir
                    new_idx_path = cache_dir / f"faiss_vault_v{new_version}.index"
                    new_meta_path = cache_dir / f"vault_metadata_v{new_version}.json"
                    faiss.write_index(vault.vector_db, str(new_idx_path))
                    with open(new_meta_path, "w", encoding="utf-8") as f:
                        json.dump(vault.metadata_store, f, indent=2)
                    new_sha256 = sha256_of_file(new_idx_path)
                    storage_client.upload_file("vault-snapshots", f"v{new_version}/faiss_vault.index", new_idx_path, content_type="application/octet-stream", upsert=True)
                    storage_client.upload_file("vault-snapshots", f"v{new_version}/vault_metadata.json", new_meta_path, content_type="application/json", upsert=True)
                    unique_assets_count = len({m["asset_id"] for m in vault.metadata_store.values() if "asset_id" in m})
                    with default_db_manager.transaction() as conn:
                        with conn.cursor() as cur:
                            cur.execute("UPDATE vault_snapshots SET status = 'SUPERSEDED' WHERE status = 'ACTIVE';")
                            cur.execute(
                                """
                                INSERT INTO vault_snapshots (
                                    version_number, total_vectors, total_assets, storage_index_path,
                                    storage_meta_path, sha256_checksum, status, created_at
                                ) VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVE', NOW());
                                """,
                                (
                                    new_version,
                                    vault.vector_db.ntotal,
                                    unique_assets_count,
                                    f"vault-snapshots/v{new_version}/faiss_vault.index",
                                    f"vault-snapshots/v{new_version}/vault_metadata.json",
                                    new_sha256,
                                ),
                            )
                    vault.snapshot_version = new_version
                except Exception as snap_err:
                    logger.error(f"[Registry] Failed to checkpoint snapshot after asset deletion: {snap_err}")
        return True

    # Local mode deletion
    all_meta = load_assets_metadata()
    if asset_id in all_meta:
        del all_meta[asset_id]
        save_assets_metadata(all_meta)

    # Delete video files
    for f in VIDEOS_DIR.glob(f"{asset_id}.*"):
        f.unlink(missing_ok=True)

    # Delete frames directory
    asset_frames_dir = FRAMES_DIR / asset_id
    if asset_frames_dir.exists():
        import shutil
        shutil.rmtree(asset_frames_dir, ignore_errors=True)

    # Remove vectors from vault if present
    if vault and hasattr(vault, "remove_asset_vectors"):
        vault.remove_asset_vectors(asset_id)
    return True


# ─── Incidents & Scans Storage ───────────────────────────────────────────────

def load_incidents(session_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Loads recorded threat scan incidents from local JSON or Supabase PostgreSQL."""
    if is_cloud_mode():
        if session_id:
            rows = default_db_manager.fetch_all(
                """
                SELECT incident_id, investigation_type, suspect_filename, suspect_url, file_size_bytes,
                       duration_seconds, total_frames_analyzed, candidate_matches_found,
                       highest_confidence, lowest_l2_distance, overall_status,
                       matched_asset_ids, cv_evidence_dossier, scanned_at,
                       score_version, screening_mode, session_id, suspect_storage_path, thumbnail_storage_path
                FROM incidents
                WHERE (session_id = %s OR session_id = 'demo-showcase')
                ORDER BY scanned_at DESC
                LIMIT 100;
                """,
                (session_id,),
            )
        else:
            rows = default_db_manager.fetch_all(
                """
                SELECT incident_id, investigation_type, suspect_filename, suspect_url, file_size_bytes,
                       duration_seconds, total_frames_analyzed, candidate_matches_found,
                       highest_confidence, lowest_l2_distance, overall_status,
                       matched_asset_ids, cv_evidence_dossier, scanned_at,
                       score_version, screening_mode, session_id, suspect_storage_path, thumbnail_storage_path
                FROM incidents
                WHERE (session_id IS NULL OR session_id = 'demo-showcase')
                ORDER BY scanned_at DESC
                LIMIT 100;
                """
            )
        incidents = []
        for row in rows:
            iid = str(row["incident_id"])
            dossier = row.get("cv_evidence_dossier") or {}
            if isinstance(dossier, str):
                try:
                    dossier = json.loads(dossier)
                except Exception:
                    dossier = {}

            matched = row.get("matched_asset_ids") or []
            if isinstance(matched, str):
                try:
                    matched = json.loads(matched)
                except Exception:
                    matched = []

            scanned_at_val = row.get("scanned_at")
            if isinstance(scanned_at_val, datetime):
                scanned_at_str = scanned_at_val.isoformat()
            elif scanned_at_val:
                scanned_at_str = str(scanned_at_val)
            else:
                scanned_at_str = ""

            s_url = row.get("suspect_url") or dossier.get("source_url") or ""
            inv_type = row.get("investigation_type") or "FULL_VIDEO_SCAN"

            incidents.append({
                "incident_id": iid,
                "investigation_type": inv_type,
                "submitted_asset_id": dossier.get("submitted_asset_id") or iid,
                "suspect_filename": row.get("suspect_filename") or "",
                "suspect_url": s_url,
                "source_url": s_url,
                "platform": dossier.get("platform") or "",
                "metadata": dossier.get("metadata") or {},
                "thumbnail_url": dossier.get("thumbnail_url") or "",
                "suspect_thumbnail_preview_url": dossier.get("suspect_thumbnail_preview_url") or "",
                "recommended_action": dossier.get("recommended_action") or ("NEEDS_FULL_VIDEO_REVIEW" if row.get("overall_status") in ("CANDIDATE_MATCH", "SUSPECT", "NEEDS_FULL_VIDEO_REVIEW") else "MONITOR"),
                "status_message": dossier.get("status_message") or "",
                "limitations": dossier.get("limitations") or [],
                "disclaimer": dossier.get("disclaimer", "Candidate visual similarity only; not a definitive copyright-infringement finding."),
                "total_frames_analyzed": int(row.get("total_frames_analyzed") or 0),
                "candidate_matches_found": int(row.get("candidate_matches_found") or 0),
                "highest_confidence": float(row.get("highest_confidence") or 0.0),
                "lowest_l2_distance": float(row["lowest_l2_distance"]) if row.get("lowest_l2_distance") is not None else None,
                "overall_status": row.get("overall_status") or "CLEAN",
                "matched_assets": [str(m) for m in matched],
                "frame_matches": dossier.get("frame_matches") or [],
                "scanned_at": scanned_at_str,
                "file_size": int(row.get("file_size_bytes") or 0),
                "duration_seconds": float(row.get("duration_seconds") or 0.0),
                "frame_count": int(row.get("total_frames_analyzed") or 0),
                "score_version": row.get("score_version") or "v1.1-uncalibrated-heuristic",
                "screening_mode": row.get("screening_mode") or inv_type,
                "session_id": row.get("session_id"),
                "suspect_storage_path": row.get("suspect_storage_path"),
                "thumbnail_storage_path": row.get("thumbnail_storage_path"),
            })
        return incidents

    # Local mode: load from incidents.json
    if not INCIDENTS_FILE.exists():
        return []
    try:
        with open(INCIDENTS_FILE, "r", encoding="utf-8") as f:
            all_local = json.load(f)
            if session_id:
                return [
                    inc for inc in all_local
                    if inc.get("session_id") == session_id or inc.get("session_id") == "demo-showcase"
                ]
            return [
                inc for inc in all_local
                if not inc.get("session_id") or inc.get("session_id") == "demo-showcase"
            ]
    except Exception as e:
        logger.error(f"[Registry] Failed to read {INCIDENTS_FILE}: {e}")
        return []


def save_incident(incident_data: Dict[str, Any], session_id: Optional[str] = None) -> None:
    """Appends an incident to the persistent incidents log (local JSON or Supabase PostgreSQL)."""
    target_session = session_id or incident_data.get("session_id")
    if target_session:
        incident_data["session_id"] = target_session

    if is_cloud_mode():
        iid = str(incident_data.get("incident_id") or uuid.uuid4())
        inv_type = incident_data.get("investigation_type", "FULL_VIDEO_SCAN")
        raw_matched = incident_data.get("matched_assets", [])
        matched_ids = []
        for ma in raw_matched:
            if isinstance(ma, dict):
                aid = ma.get("asset_id")
                if aid:
                    matched_ids.append(str(aid))
            elif ma:
                matched_ids.append(str(ma))

        suspect_url = incident_data.get("suspect_url") or incident_data.get("source_url")

        dossier = {
            "frame_matches": incident_data.get("frame_matches", []),
            "submitted_asset_id": incident_data.get("submitted_asset_id") or iid,
            "disclaimer": incident_data.get("disclaimer", "Candidate visual similarity only; not a definitive copyright-infringement finding."),
            "source_url": suspect_url,
            "platform": incident_data.get("platform"),
            "metadata": incident_data.get("metadata"),
            "thumbnail_url": incident_data.get("thumbnail_url"),
            "suspect_thumbnail_preview_url": incident_data.get("suspect_thumbnail_preview_url"),
            "recommended_action": incident_data.get("recommended_action"),
            "limitations": incident_data.get("limitations"),
            "status_message": incident_data.get("status_message"),
        }

        conf = min(100.0, max(0.0, float(incident_data.get("highest_confidence") or 0.0)))
        l2_dist = incident_data.get("lowest_l2_distance")
        if l2_dist is not None:
            l2_dist = float(l2_dist)

        dur = incident_data.get("duration_seconds")
        dur_val = float(dur) if dur is not None else 0.0

        frames_count = incident_data.get("total_frames_analyzed") or incident_data.get("frame_count") or 0
        candidate_count = incident_data.get("candidate_matches_found") or 0
        status = incident_data.get("overall_status") or "CLEAN"
        suspect_name = incident_data.get("suspect_filename") or "suspect_video.mp4"
        file_size = incident_data.get("file_size") or 0
        scanned_at = incident_data.get("scanned_at") or datetime.now(timezone.utc).isoformat()
        score_ver = incident_data.get("score_version") or "v1.1-uncalibrated-heuristic"
        screening_mode = incident_data.get("screening_mode") or inv_type
        suspect_path = incident_data.get("suspect_storage_path")
        thumb_path = incident_data.get("thumbnail_storage_path")

        default_db_manager.execute(
            """
            INSERT INTO incidents (
                incident_id, investigation_type, suspect_filename, suspect_url, file_size_bytes,
                duration_seconds, total_frames_analyzed, candidate_matches_found,
                highest_confidence, lowest_l2_distance, overall_status,
                matched_asset_ids, cv_evidence_dossier, scanned_at,
                score_version, screening_mode, session_id, suspect_storage_path, thumbnail_storage_path
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (incident_id) DO UPDATE SET
                investigation_type = EXCLUDED.investigation_type,
                suspect_filename = EXCLUDED.suspect_filename,
                suspect_url = EXCLUDED.suspect_url,
                file_size_bytes = EXCLUDED.file_size_bytes,
                duration_seconds = EXCLUDED.duration_seconds,
                total_frames_analyzed = EXCLUDED.total_frames_analyzed,
                candidate_matches_found = EXCLUDED.candidate_matches_found,
                highest_confidence = EXCLUDED.highest_confidence,
                lowest_l2_distance = EXCLUDED.lowest_l2_distance,
                overall_status = EXCLUDED.overall_status,
                matched_asset_ids = EXCLUDED.matched_asset_ids,
                cv_evidence_dossier = EXCLUDED.cv_evidence_dossier,
                scanned_at = EXCLUDED.scanned_at,
                score_version = EXCLUDED.score_version,
                screening_mode = EXCLUDED.screening_mode,
                session_id = EXCLUDED.session_id,
                suspect_storage_path = EXCLUDED.suspect_storage_path,
                thumbnail_storage_path = EXCLUDED.thumbnail_storage_path;
            """,
            (
                iid,
                inv_type,
                suspect_name,
                suspect_url,
                file_size,
                dur_val,
                frames_count,
                candidate_count,
                conf,
                l2_dist,
                status,
                json.dumps(matched_ids),
                json.dumps(dossier),
                scanned_at,
                score_ver,
                screening_mode,
                target_session,
                suspect_path,
                thumb_path,
            ),
        )
        logger.info(f"[Registry] Saved incident {iid} ({inv_type}) to Supabase PostgreSQL.")
        return

    # Local mode: append to incidents.json
    incidents = load_incidents()
    incidents.insert(0, incident_data)
    incidents = incidents[:100]
    try:
        with open(INCIDENTS_FILE, "w", encoding="utf-8") as f:
            json.dump(incidents, f, indent=2)
    except Exception as e:
        logger.error(f"[Registry] Failed to write {INCIDENTS_FILE}: {e}")
        raise


def get_incident_by_id(incident_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves an incident record by its incident_id."""
    if is_cloud_mode():
        import uuid as _uuid
        is_uuid = False
        try:
            _uuid.UUID(str(incident_id))
            is_uuid = True
        except (ValueError, TypeError, AttributeError):
            is_uuid = False

        if is_uuid:
            try:
                rows = default_db_manager.fetch_all(
                    """
                    SELECT incident_id, investigation_type, suspect_filename, suspect_url, file_size_bytes,
                           duration_seconds, total_frames_analyzed, candidate_matches_found,
                           highest_confidence, lowest_l2_distance, overall_status,
                           matched_asset_ids, cv_evidence_dossier, scanned_at,
                           score_version, screening_mode, session_id, suspect_storage_path, thumbnail_storage_path
                    FROM incidents
                    WHERE incident_id = %s
                    LIMIT 1;
                    """,
                    (incident_id,),
                )
                if rows:
                    row = rows[0]
                    iid = str(row["incident_id"])
                    dossier = row.get("cv_evidence_dossier") or {}
                    if isinstance(dossier, str):
                        try:
                            dossier = json.loads(dossier)
                        except Exception:
                            dossier = {}

                    matched = row.get("matched_asset_ids") or []
                    if isinstance(matched, str):
                        try:
                            matched = json.loads(matched)
                        except Exception:
                            matched = []

                    scanned_at_val = row.get("scanned_at")
                    if isinstance(scanned_at_val, datetime):
                        scanned_at_str = scanned_at_val.isoformat()
                    elif scanned_at_val:
                        scanned_at_str = str(scanned_at_val)
                    else:
                        scanned_at_str = ""

                    s_url = row.get("suspect_url") or dossier.get("source_url") or ""
                    inv_type = row.get("investigation_type") or "FULL_VIDEO_SCAN"

                    return {
                        "incident_id": iid,
                        "investigation_type": inv_type,
                        "submitted_asset_id": dossier.get("submitted_asset_id") or iid,
                        "suspect_filename": row.get("suspect_filename") or "",
                        "suspect_url": s_url,
                        "source_url": s_url,
                        "platform": dossier.get("platform") or "",
                        "metadata": dossier.get("metadata") or {},
                        "thumbnail_url": dossier.get("thumbnail_url") or "",
                        "suspect_thumbnail_preview_url": dossier.get("suspect_thumbnail_preview_url") or "",
                        "recommended_action": dossier.get("recommended_action") or ("NEEDS_FULL_VIDEO_REVIEW" if row.get("overall_status") in ("CANDIDATE_MATCH", "SUSPECT", "NEEDS_FULL_VIDEO_REVIEW") else "MONITOR"),
                        "status_message": dossier.get("status_message") or "",
                        "limitations": dossier.get("limitations") or [],
                        "disclaimer": dossier.get("disclaimer", "Candidate visual similarity only; not a definitive copyright-infringement finding."),
                        "total_frames_analyzed": int(row.get("total_frames_analyzed") or 0),
                        "candidate_matches_found": int(row.get("candidate_matches_found") or 0),
                        "highest_confidence": float(row.get("highest_confidence") or 0.0),
                        "lowest_l2_distance": float(row["lowest_l2_distance"]) if row.get("lowest_l2_distance") is not None else None,
                        "overall_status": row.get("overall_status") or "CLEAN",
                        "matched_assets": [str(m) for m in matched],
                        "frame_matches": dossier.get("frame_matches") or [],
                        "scanned_at": scanned_at_str,
                        "file_size": int(row.get("file_size_bytes") or 0),
                        "duration_seconds": float(row.get("duration_seconds") or 0.0),
                        "frame_count": int(row.get("total_frames_analyzed") or 0),
                        "score_version": row.get("score_version") or "v1.1-uncalibrated-heuristic",
                        "screening_mode": row.get("screening_mode") or inv_type,
                        "session_id": row.get("session_id"),
                        "suspect_storage_path": row.get("suspect_storage_path"),
                        "thumbnail_storage_path": row.get("thumbnail_storage_path"),
                    }
            except Exception as e:
                logger.warning(f"[Registry] Error querying incident {incident_id} directly: {e}")

    for inc in load_incidents():
        if str(inc.get("incident_id")) == str(incident_id):
            return inc
    return None


def load_nemotron_reports() -> List[Dict[str, Any]]:
    """Loads all persisted Nemotron reports from local JSON or Supabase PostgreSQL."""
    if is_cloud_mode():
        try:
            rows = default_db_manager.fetch_all(
                """
                SELECT report_id, incident_id, model_id, prompt_version, summary,
                       recommended_action, confidence_assessment, human_review_required,
                       contradictions_detected, limitations_disclosed, full_report_json,
                       raw_model_response, prompt_tokens, completion_tokens, latency_ms, created_at
                FROM nemotron_reports
                ORDER BY created_at DESC;
                """
            )
            reports = []
            for row in rows:
                full_json = row.get("full_report_json")
                if isinstance(full_json, str):
                    try:
                        full_json = json.loads(full_json)
                    except Exception:
                        pass
                if isinstance(full_json, dict):
                    full_json["report_id"] = str(row["report_id"])
                    full_json["incident_id"] = str(row["incident_id"])
                    full_json["created_at"] = str(row.get("created_at") or "")
                    reports.append(full_json)
                else:
                    reports.append({
                        "report_id": str(row["report_id"]),
                        "incident_id": str(row["incident_id"]),
                        "model_id": row["model_id"],
                        "prompt_version": row["prompt_version"],
                        "summary": row["summary"],
                        "recommended_action": row["recommended_action"],
                        "confidence_assessment": row["confidence_assessment"],
                        "human_review_required": row["human_review_required"],
                        "contradictions_detected": row.get("contradictions_detected") or [],
                        "limitations_disclosed": row.get("limitations_disclosed") or [],
                        "created_at": str(row.get("created_at") or ""),
                    })
            return reports
        except Exception as e:
            logger.error(f"[Registry] Failed to load nemotron reports from cloud DB: {e}")
            raise

    # Local mode: read from nemotron_reports.json
    if not NEMOTRON_REPORTS_FILE.exists():
        return []
    try:
        with open(NEMOTRON_REPORTS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"[Registry] Failed to read {NEMOTRON_REPORTS_FILE}: {e}")
        return []


def save_nemotron_report(report_data: Any) -> Dict[str, Any]:
    """
    Persists a validated Nemotron investigation report in local JSON or Supabase PostgreSQL.
    
    Guarantees:
    - Never masks database errors; explicitly raises on persistence failure.
    - Preserves exact report structure in full_report_json.
    - Rejects or strips private internal reasoning traces.
    """
    if hasattr(report_data, "model_dump"):
        record = report_data.model_dump(mode="json")
    elif isinstance(report_data, dict):
        record = dict(report_data)
    else:
        raise ValueError("report_data must be an InvestigationReport instance or dictionary.")

    rid = str(record.get("report_id") or uuid.uuid4())
    iid = str(record.get("incident_id"))
    record["report_id"] = rid

    if not record.get("created_at"):
        op_meta = record.get("operational_metadata") or {}
        record["created_at"] = op_meta.get("created_at") or datetime.now(timezone.utc).isoformat()
        if "operational_metadata" in record and isinstance(record["operational_metadata"], dict):
            record["operational_metadata"].setdefault("created_at", record["created_at"])

    if is_cloud_mode():
        model_id = str(record.get("model_id") or "nvidia/Nemotron-3_5-Lightning")
        prompt_ver = str(record.get("prompt_version") or "v1.0")
        summary = str(record.get("summary") or "")
        rec_action = str(record.get("recommended_action") or "NEEDS_FULL_VIDEO_REVIEW")
        conf_assess = str(record.get("confidence_assessment") or "INCONCLUSIVE_DATA")
        human_req = bool(record.get("human_review_required", False))
        contradictions = record.get("contradictions_detected") or []
        limitations = record.get("limitations_disclosed") or []

        op_meta = record.get("operational_metadata") or {}
        p_tokens = op_meta.get("prompt_tokens")
        c_tokens = op_meta.get("completion_tokens")
        lat_ms = op_meta.get("latency_ms")
        created_at = op_meta.get("created_at") or datetime.now(timezone.utc).isoformat()

        try:
            default_db_manager.execute(
                """
                INSERT INTO nemotron_reports (
                    report_id, incident_id, model_id, prompt_version, summary,
                    recommended_action, confidence_assessment, human_review_required,
                    contradictions_detected, limitations_disclosed, full_report_json,
                    raw_model_response, prompt_tokens, completion_tokens, latency_ms, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (report_id) DO UPDATE SET
                    summary = EXCLUDED.summary,
                    recommended_action = EXCLUDED.recommended_action,
                    confidence_assessment = EXCLUDED.confidence_assessment,
                    human_review_required = EXCLUDED.human_review_required,
                    contradictions_detected = EXCLUDED.contradictions_detected,
                    limitations_disclosed = EXCLUDED.limitations_disclosed,
                    full_report_json = EXCLUDED.full_report_json,
                    raw_model_response = EXCLUDED.raw_model_response,
                    prompt_tokens = EXCLUDED.prompt_tokens,
                    completion_tokens = EXCLUDED.completion_tokens,
                    latency_ms = EXCLUDED.latency_ms;
                """,
                (
                    rid,
                    iid,
                    model_id,
                    prompt_ver,
                    summary,
                    rec_action,
                    conf_assess,
                    human_req,
                    json.dumps(contradictions),
                    json.dumps(limitations),
                    json.dumps(record),
                    summary,  # safe concise text representation (no private reasoning)
                    int(p_tokens) if p_tokens is not None else None,
                    int(c_tokens) if c_tokens is not None else None,
                    int(lat_ms) if lat_ms is not None else None,
                    created_at,
                ),
            )
            logger.info(f"[Registry] Saved Nemotron report {rid} for incident {iid} in Supabase DB.")
            return record
        except Exception as e:
            logger.error(f"[Registry] Failed to save Nemotron report {rid} in cloud DB: {e}")
            raise

    # Local mode: persist to storage/nemotron_reports.json
    reports = load_nemotron_reports()
    # Replace existing report if same report_id, or prepend
    replaced = False
    for idx, rep in enumerate(reports):
        if rep.get("report_id") == rid:
            reports[idx] = record
            replaced = True
            break
    if not replaced:
        reports.insert(0, record)

    try:
        with open(NEMOTRON_REPORTS_FILE, "w", encoding="utf-8") as f:
            json.dump(reports, f, indent=2)
        logger.info(f"[Registry] Persisted Nemotron report {rid} to {NEMOTRON_REPORTS_FILE}.")
        return record
    except Exception as e:
        logger.error(f"[Registry] Failed to write {NEMOTRON_REPORTS_FILE}: {e}")
        raise


def get_nemotron_report_by_id(report_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves a single Nemotron report by its report_id."""
    for rep in load_nemotron_reports():
        if rep.get("report_id") == str(report_id):
            return rep
    return None


def get_nemotron_reports_for_incident(incident_id: str) -> List[Dict[str, Any]]:
    """Retrieves all Nemotron reports generated for a specific incident, ordered newest first."""
    matching = []
    for rep in load_nemotron_reports():
        if rep.get("incident_id") == str(incident_id):
            matching.append(rep)

    def _get_ts(r: Dict[str, Any]) -> str:
        return str(r.get("created_at") or (r.get("operational_metadata") or {}).get("created_at") or "")

    matching.sort(key=_get_ts, reverse=True)
    return matching


def get_nemotron_report_history(incident_id: str) -> List[Dict[str, Any]]:
    """
    Returns compact report history records for an incident, ordered newest first.
    Guarantees strict incident isolation.
    """
    reports = get_nemotron_reports_for_incident(incident_id)
    history = []
    for rep in reports:
        # Guarantee incident isolation
        if str(rep.get("incident_id")) != str(incident_id):
            continue

        op_meta = rep.get("operational_metadata") or {}
        val_status = op_meta.get("validation_status") or rep.get("validation_status") or "VALIDATED"
        ts = str(rep.get("created_at") or op_meta.get("created_at") or "")

        history.append({
            "report_id": str(rep.get("report_id")),
            "incident_id": str(incident_id),
            "created_at": ts,
            "model_id": str(rep.get("model_id") or "nvidia/Nemotron-3_5-Lightning"),
            "recommended_action": str(rep.get("recommended_action") or "NEEDS_FULL_VIDEO_REVIEW"),
            "confidence_assessment": str(rep.get("confidence_assessment") or "INCONCLUSIVE_DATA"),
            "validation_status": str(val_status),
            "human_review_required": bool(rep.get("human_review_required", False)),
            "summary": str(rep.get("summary") or ""),
        })
    return history

