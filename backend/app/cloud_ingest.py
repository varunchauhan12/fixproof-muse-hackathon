"""
Cloud Ingestion and Vault Snapshot Checkpointing for FixProof.
Milestone: 6C.4 — Cloud Runtime Integration

Handles end-to-end ingestion of official reference videos in Supabase mode:
1. Video validation and SHA-256 calculation.
2. Upload video to private Supabase Storage ('reference-assets' bucket).
3. Insert metadata record into PostgreSQL 'reference_assets' table.
4. Extract 5s keyframes, compute perceptual hashes, upload to 'reference-frames' bucket.
5. Insert frame records into PostgreSQL 'reference_frames' table.
6. Generate MobileNetV3 576-dim L2-normalized embeddings, store in 'reference_vectors' table.
7. Update reference FAISS index in memory and create/upload/activate a new snapshot in 'vault-snapshots'.
8. Fail-safe rollback: cleans up partial storage objects and DB records if any step fails.
"""

from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import uuid

import faiss
import imagehash
import numpy as np
from PIL import Image

from app.db import DatabaseManager, DatabaseConfig, DBMode, get_db_config, default_db_manager
from app.storage import SupabaseStorageClient, StorageError, StorageUploadError
from app.vault import ReferenceVault, EMBEDDING_DIM, extract_image_embedding

logger = logging.getLogger(__name__)


def sha256_of_file(file_path: Path) -> str:
    """Computes SHA-256 checksum of a file."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def ingest_reference_asset_cloud(
    asset_id: str,
    video_path: Path,
    original_filename: str,
    content_type: str,
    duration_seconds: float,
    extracted_frames: List[Dict[str, Any]],
    frames_dir: Path,
    vault: ReferenceVault,
    auto_index: bool = True,
) -> Dict[str, Any]:
    """
    Ingests an official reference video end-to-end into Supabase:
    - Uploads video to 'reference-assets/{asset_id}/{filename}'
    - Upserts PostgreSQL 'reference_assets'
    - Uploads frames to 'reference-frames/{asset_id}/{frame_filename}'
    - Upserts PostgreSQL 'reference_frames'
    - Computes embeddings and upserts PostgreSQL 'reference_vectors'
    - Creates and activates new vault snapshot checkpoint in 'vault-snapshots'
    """
    db_mgr = default_db_manager
    if not db_mgr.is_cloud:
        conn_url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
        if not conn_url:
            raise RuntimeError("Cloud ingestion invoked without valid SUPABASE_DB_URL configured.")
        db_mgr = DatabaseManager(DatabaseConfig(mode=DBMode.SUPABASE, connection_url=conn_url))

    storage_client = SupabaseStorageClient()
    file_size_bytes = video_path.stat().st_size
    video_sha256 = sha256_of_file(video_path)
    stored_filename = video_path.name
    video_storage_path = f"{asset_id}/{stored_filename}"

    uploaded_storage_paths: List[Tuple[str, str]] = []  # (bucket, path) for rollback

    try:
        # ── 1. Upload Video to Supabase Storage (reference-assets) ──
        logger.info(f"[Cloud Ingest] Uploading video to reference-assets/{video_storage_path}...")
        try:
            storage_client.upload_file(
                bucket="reference-assets",
                storage_path=video_storage_path,
                data_or_file=video_path,
                content_type=content_type,
                upsert=True,
            )
        except StorageUploadError as e:
            err_str = str(e).lower()
            if "invalid_mime_type" in err_str or "invalidmimetype" in err_str or "415" in err_str:
                logger.warning(
                    f"[Cloud Ingest] Bucket rejected content_type '{content_type}', retrying with 'video/mp4' fallback: {e}"
                )
                storage_client.upload_file(
                    bucket="reference-assets",
                    storage_path=video_storage_path,
                    data_or_file=video_path,
                    content_type="video/mp4",
                    upsert=True,
                )
            else:
                raise
        uploaded_storage_paths.append(("reference-assets", video_storage_path))

        # ── 2. Upload Extracted Frames & Calculate pHash ──
        logger.info(f"[Cloud Ingest] Uploading {len(extracted_frames)} frames to reference-frames...")
        frame_records = []
        for f_idx, finfo in enumerate(extracted_frames):
            frame_fn = finfo["filename"]
            fpath = Path(finfo.get("frame_path", frames_dir / frame_fn))
            if not fpath.exists():
                logger.warning(f"[Cloud Ingest] Frame file not found: {fpath}, skipping.")
                continue

            frame_storage_path = f"{asset_id}/{frame_fn}"

            # Calculate pHash
            with Image.open(fpath) as pil_img:
                phash_val = str(imagehash.phash(pil_img))

            # Upload frame image to storage
            storage_client.upload_file(
                bucket="reference-frames",
                storage_path=frame_storage_path,
                data_or_file=fpath,
                content_type="image/jpeg",
                upsert=True,
            )
            uploaded_storage_paths.append(("reference-frames", frame_storage_path))

            frame_records.append({
                "frame_index": finfo.get("frame_index", f_idx),
                "timestamp_sec": finfo.get("timestamp_sec", f_idx * 5),
                "filename": frame_fn,
                "frame_path": str(fpath),
                "storage_path": frame_storage_path,
                "phash": phash_val,
            })

        # ── 3. Generate Visual Embeddings & Prepare FAISS Vault & Snapshots ──
        indexed_count = 0
        embeddings_to_save: List[Tuple[int, bytes, int]] = []  # (frame_idx, embedding_bytes, vector_id)

        if auto_index and frame_records:
            logger.info(f"[Cloud Ingest] Generating visual embeddings for {len(frame_records)} frames...")

            for fr_idx, fr in enumerate(frame_records):
                fpath = Path(fr["frame_path"])
                with Image.open(fpath) as pil_img:
                    embedding = extract_image_embedding(pil_img)  # (1, 576)

                vector_id = vault.vector_db.ntotal
                vault.vector_db.add(embedding)

                # Persist metadata mapping in vault
                vault.metadata_store[str(vector_id)] = {
                    "vector_id": vector_id,
                    "asset_id": asset_id,
                    "frame_id": fr["timestamp_sec"],
                    "timestamp_sec": fr["timestamp_sec"],
                    "frame_path": fr["frame_path"],
                    "filename": fr["filename"],
                    "indexed_at": datetime.now(timezone.utc).isoformat(),
                }
                embeddings_to_save.append((fr_idx, embedding.tobytes(), vector_id))
                indexed_count += 1

            # ── 4. Create, Upload, and Verify New Vault Snapshot Checkpoint ──
            active_snapshot = db_mgr.fetch_one(
                "SELECT version_number FROM vault_snapshots WHERE status = 'ACTIVE' ORDER BY version_number DESC LIMIT 1;"
            )
            curr_version = active_snapshot["version_number"] if active_snapshot else 0
            new_version = curr_version + 1

            logger.info(f"[Cloud Ingest] Preparing new cloud vault snapshot v{new_version}...")
            cache_dir = vault.cloud_cache_dir
            new_idx_path = cache_dir / f"faiss_vault_v{new_version}.index"
            new_meta_path = cache_dir / f"vault_metadata_v{new_version}.json"

            # Persist to local cloud cache
            faiss.write_index(vault.vector_db, str(new_idx_path))
            with open(new_meta_path, "w", encoding="utf-8") as f:
                json.dump(vault.metadata_store, f, indent=2)

            new_sha256 = sha256_of_file(new_idx_path)

            snapshot_idx_storage = f"v{new_version}/faiss_vault.index"
            snapshot_meta_storage = f"v{new_version}/vault_metadata.json"

            logger.info(f"[Cloud Ingest] Uploading snapshot v{new_version} to vault-snapshots...")
            storage_client.upload_file(
                bucket="vault-snapshots",
                storage_path=snapshot_idx_storage,
                data_or_file=new_idx_path,
                content_type="application/octet-stream",
                upsert=True,
            )
            uploaded_storage_paths.append(("vault-snapshots", snapshot_idx_storage))

            storage_client.upload_file(
                bucket="vault-snapshots",
                storage_path=snapshot_meta_storage,
                data_or_file=new_meta_path,
                content_type="application/json",
                upsert=True,
            )
            uploaded_storage_paths.append(("vault-snapshots", snapshot_meta_storage))

            # Integrity check: Download uploaded snapshot index and verify checksum before activating
            logger.info(f"[Cloud Ingest] Verifying uploaded snapshot v{new_version} integrity...")
            verify_bytes = storage_client.download_file("vault-snapshots", snapshot_idx_storage)
            uploaded_sha256 = hashlib.sha256(verify_bytes).hexdigest()
            if uploaded_sha256.lower() != new_sha256.lower():
                raise RuntimeError(
                    f"Uploaded snapshot v{new_version} checksum verification failed! "
                    f"Expected {new_sha256}, got {uploaded_sha256}"
                )

            unique_assets_count = len({m["asset_id"] for m in vault.metadata_store.values() if "asset_id" in m})

        # ── 5. Single Atomic Database Transaction ──
        logger.info(f"[Cloud Ingest] Committing atomic PostgreSQL transaction for {asset_id}...")
        with db_mgr.transaction() as conn:
            with conn.cursor() as cur:
                # 5a. Upsert reference_assets
                cur.execute(
                    """
                    INSERT INTO reference_assets (
                        asset_id, filename, storage_path, file_size_bytes, content_type,
                        duration_seconds, frame_count, sample_interval_sec, sha256_hash,
                        indexing_status, indexed_vectors_count, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                    ON CONFLICT (asset_id) DO UPDATE SET
                        filename = EXCLUDED.filename,
                        storage_path = EXCLUDED.storage_path,
                        file_size_bytes = EXCLUDED.file_size_bytes,
                        duration_seconds = EXCLUDED.duration_seconds,
                        frame_count = EXCLUDED.frame_count,
                        sha256_hash = EXCLUDED.sha256_hash,
                        indexing_status = EXCLUDED.indexing_status,
                        indexed_vectors_count = EXCLUDED.indexed_vectors_count,
                        updated_at = NOW();
                    """,
                    (
                        asset_id,
                        original_filename,
                        f"reference-assets/{video_storage_path}",
                        file_size_bytes,
                        content_type,
                        duration_seconds,
                        len(extracted_frames),
                        5,
                        video_sha256,
                        "INDEXED" if (auto_index and indexed_count > 0) else "UPLOADED",
                        indexed_count,
                    ),
                )

                # 5b. Upsert reference_frames
                frame_id_by_idx: Dict[int, str] = {}
                for fr_idx, fr in enumerate(frame_records):
                    cur.execute(
                        """
                        INSERT INTO reference_frames (
                            frame_id, asset_id, frame_index, timestamp_sec, storage_path, phash, created_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, NOW())
                        ON CONFLICT (asset_id, frame_index) DO UPDATE SET
                            timestamp_sec = EXCLUDED.timestamp_sec,
                            storage_path = EXCLUDED.storage_path,
                            phash = EXCLUDED.phash
                        RETURNING frame_id;
                        """,
                        (
                            str(uuid.uuid4()),
                            asset_id,
                            fr["frame_index"],
                            fr["timestamp_sec"],
                            f"reference-frames/{fr['storage_path']}",
                            fr["phash"],
                        ),
                    )
                    assigned_frame_id = str(cur.fetchone()[0])
                    frame_id_by_idx[fr_idx] = assigned_frame_id
                    fr["frame_id"] = assigned_frame_id

                # 5c. Upsert reference_vectors
                for fr_idx, raw_bytes, vec_id in embeddings_to_save:
                    fid = frame_id_by_idx[fr_idx]
                    cur.execute(
                        """
                        INSERT INTO reference_vectors (
                            vector_uuid, asset_id, frame_id, faiss_index_position,
                            embedding_dim, embedding_vector, created_at
                        ) VALUES (%s, %s, %s, %s, 576, %s, NOW())
                        ON CONFLICT (asset_id, frame_id) DO UPDATE SET
                            faiss_index_position = EXCLUDED.faiss_index_position,
                            embedding_vector = EXCLUDED.embedding_vector;
                        """,
                        (
                            str(uuid.uuid4()),
                            asset_id,
                            fid,
                            vec_id,
                            raw_bytes,
                        ),
                    )

                # 5d. Activate new snapshot
                if auto_index and indexed_count > 0:
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
                            f"vault-snapshots/{snapshot_idx_storage}",
                            f"vault-snapshots/{snapshot_meta_storage}",
                            new_sha256,
                        ),
                    )

        if auto_index and indexed_count > 0:
            vault.index_path = new_idx_path
            vault.meta_path = new_meta_path
            vault.snapshot_version = new_version
            logger.info(
                f"[Cloud Ingest] Snapshot v{new_version} successfully activated in Supabase with "
                f"{vault.vector_db.ntotal} vectors across {unique_assets_count} assets."
            )

        return {
            "status": "indexed" if auto_index else "uploaded",
            "asset_id": asset_id,
            "filename": original_filename,
            "file_size": file_size_bytes,
            "content_type": content_type,
            "duration_seconds": duration_seconds,
            "frame_count": len(frame_records),
            "sample_interval_seconds": 5,
            "frames": frame_records,
            "indexed": bool(auto_index and indexed_count > 0),
            "indexed_vectors": indexed_count,
            "vault_size": vault.vector_db.ntotal,
        }

    except Exception as e:
        logger.error(f"[Cloud Ingest] Error ingesting asset {asset_id} to Supabase: {e}. Executing rollback...")
        # Rollback uploaded storage objects
        for b, p in uploaded_storage_paths:
            try:
                storage_client.delete_object(b, p)
            except Exception as del_err:
                logger.warning(f"[Cloud Ingest] Failed to rollback storage object {b}/{p}: {del_err}")

        # Delete partially inserted asset row (foreign keys cascade)
        try:
            db_mgr.execute("DELETE FROM reference_assets WHERE asset_id = %s;", (asset_id,))
        except Exception as db_err:
            logger.warning(f"[Cloud Ingest] Failed to rollback reference_assets row {asset_id}: {db_err}")

        raise RuntimeError(f"Cloud reference ingestion failed for asset '{original_filename}': {e}") from e
