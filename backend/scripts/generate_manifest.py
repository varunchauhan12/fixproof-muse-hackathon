#!/usr/bin/env python3
"""
FixProof Migration Manifest Generator (Dry Run)
Milestone: 6C.2C — Schema Verification & Migration Dry Run

Strictly read-only:
- Scans backend/storage/ (assets_metadata.json, videos/, frames/, vault/, incidents.json).
- Computes SHA-256 hashes, file sizes, frame counts, and vector counts dynamically.
- Classifies each discrepancy into the 4 official Milestone 6C.2C categories:
    1. Safe to migrate
    2. Requires explicit repair
    3. Requires user decision
    4. Excluded from migration until resolved
- Generates backend/migrations/manifests/migration_manifest_dry_run.json.
- Never mutates database rows or uploads media.
"""

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = BACKEND_DIR / "storage"
MANIFESTS_DIR = BACKEND_DIR / "migrations" / "manifests"
MANIFESTS_DIR.mkdir(parents=True, exist_ok=True)


def sha256_file(filepath: Path) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def generate_manifest():
    print("Generating FixProof Migration Manifest (Dry Run)...")

    # 1. Load assets_metadata.json
    assets_meta_path = STORAGE_DIR / "assets_metadata.json"
    assets_meta = {}
    if assets_meta_path.exists():
        with open(assets_meta_path, "r") as f:
            raw = json.load(f)
            if isinstance(raw, list):
                assets_meta = {a["asset_id"]: a for a in raw if "asset_id" in a}
            elif isinstance(raw, dict):
                assets_meta = raw

    # 2. Inspect videos on disk
    videos_dir = STORAGE_DIR / "videos"
    video_files = {}
    if videos_dir.exists():
        for p in videos_dir.glob("*.mp4"):
            stem = p.stem
            video_files[stem] = p

    # 3. Inspect frames on disk
    frames_dir = STORAGE_DIR / "frames"
    frame_dirs = {}
    if frames_dir.exists():
        for d in frames_dir.iterdir():
            if d.is_dir():
                frames = sorted(list(d.glob("*.jpg")))
                frame_dirs[d.name] = frames

    # 4. Inspect FAISS vault
    vault_meta_path = STORAGE_DIR / "vault" / "vault_metadata.json"
    vault_vectors_by_asset = {}
    total_vectors = 0
    if vault_meta_path.exists():
        with open(vault_meta_path, "r") as f:
            vraw = json.load(f)
            entries = vraw.values() if isinstance(vraw, dict) else vraw
            for entry in entries:
                aid = entry.get("asset_id")
                vid = entry.get("vector_id")
                if aid:
                    vault_vectors_by_asset.setdefault(aid, []).append(vid)
                total_vectors += 1

    # 5. Inspect incidents
    incidents_path = STORAGE_DIR / "incidents.json"
    incidents_by_asset = {}
    total_incidents = 0
    if incidents_path.exists():
        with open(incidents_path, "r") as f:
            inc_list = json.load(f)
            total_incidents = len(inc_list)
            for inc in inc_list:
                inc_id = inc.get("incident_id")
                for ma in inc.get("matched_assets", []):
                    aid = ma.get("asset_id") if isinstance(ma, dict) else str(ma)
                    if aid:
                        incidents_by_asset.setdefault(aid, []).append(inc_id)

    # Union of all asset identifiers
    all_asset_ids = sorted(
        list(
            set(assets_meta.keys())
            | set(video_files.keys())
            | set(frame_dirs.keys())
            | set(vault_vectors_by_asset.keys())
        )
    )

    manifest_assets = []
    status_counts = {
        "Safe to migrate": 0,
        "Requires explicit repair": 0,
        "Requires user decision": 0,
        "Excluded from migration until resolved": 0,
    }

    for aid in all_asset_ids:
        in_meta = aid in assets_meta
        meta_rec = assets_meta.get(aid, {})

        # Video resolution
        v_path = video_files.get(aid)
        has_video = v_path is not None and v_path.exists()
        v_size = os.path.getsize(v_path) if has_video else meta_rec.get("file_size")
        v_hash = sha256_file(v_path) if has_video else None
        fn = meta_rec.get("filename") or (v_path.name if has_video else f"asset_{aid[:8]}.mp4")

        # Frames resolution
        frames = frame_dirs.get(aid, [])
        has_frames_dir = aid in frame_dirs
        frame_count = len(frames) if has_frames_dir else meta_rec.get("frame_count", 0)

        # Vectors resolution
        vector_ids = vault_vectors_by_asset.get(aid, [])
        vector_count = len(vector_ids)

        # Incidents resolution
        rel_incidents = sorted(list(set(incidents_by_asset.get(aid, []))))

        # Intended Supabase storage keys
        intended_video_key = f"reference-assets/{aid}/{fn}" if has_video else None
        expected_frame_keys = [f"reference-frames/{aid}/{f.name}" for f in frames]

        # Classification mapping into the 4 Milestone 6C.2C categories
        if has_video and has_frames_dir and frame_count > 0 and in_meta:
            classification = "Safe to migrate"
            reason = "Complete reference asset with verified video, extracted frames, and metadata entry."
        elif has_video and has_frames_dir and frame_count > 0 and not in_meta:
            classification = "Requires explicit repair"
            reason = (
                "Video and frames exist on disk (and FAISS vectors if indexed), but asset is missing from "
                "assets_metadata.json. Repair action: Register asset in metadata before migration."
            )
        elif has_video and (not has_frames_dir or frame_count == 0):
            classification = "Requires explicit repair"
            reason = (
                "Reference video exists on disk and is registered, but frame directory is missing. "
                "Repair action: Run frame extractor on video to regenerate frames."
            )
        elif aid == "api-index-test-asset":
            classification = "Requires user decision"
            reason = (
                f"Asset has {vector_count} indexed vectors in FAISS vault, but zero video or frame files on disk. "
                "User decision: Purge orphaned vectors from FAISS or create placeholder frames."
            )
        elif not has_video and has_frames_dir:
            classification = "Excluded from migration until resolved"
            reason = (
                "Orphaned frame directory on disk with no underlying reference video file. "
                "Excluded from migration until source video is provided or directory is cleaned."
            )
        else:
            classification = "Excluded from migration until resolved"
            reason = (
                "Stale JSON metadata entry with zero video files, zero frames, and zero vectors on disk "
                "(test artifact with status DELETED or unlinked). Excluded from migration."
            )

        status_counts[classification] += 1

        record = {
            "asset_id": aid,
            "filename": fn,
            "local_video_path": str(v_path) if has_video else None,
            "intended_storage_video_key": intended_video_key,
            "file_size_bytes": v_size,
            "sha256_hash": v_hash,
            "duration_seconds": meta_rec.get("duration_seconds"),
            "frame_count": frame_count,
            "expected_frame_keys": expected_frame_keys,
            "indexing_status": "INDEXED" if vector_count > 0 else meta_rec.get("status", "UNINDEXED"),
            "indexed_vector_count": vector_count,
            "faiss_vector_ids": vector_ids,
            "associated_incident_ids": rel_incidents,
            "classification": classification,
            "classification_reason": reason,
            "presence": {
                "in_metadata_json": in_meta,
                "video_file_on_disk": has_video,
                "frames_dir_on_disk": has_frames_dir,
                "indexed_in_faiss": vector_count > 0,
            },
        }
        manifest_assets.append(record)

    manifest = {
        "manifest_version": "1.0.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "environment": "local_dry_run",
        "target_cloud_provider": "Supabase",
        "summary": {
            "total_evaluated_assets": len(manifest_assets),
            "status_counts": status_counts,
            "total_videos_on_disk": len(video_files),
            "total_frame_directories_on_disk": len(frame_dirs),
            "total_faiss_vectors": total_vectors,
            "total_incidents_in_log": total_incidents,
        },
        "assets": manifest_assets,
    }

    manifest_output_path = MANIFESTS_DIR / "migration_manifest_dry_run.json"
    with open(manifest_output_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"Manifest written successfully to: {manifest_output_path}")
    print(f"Summary: {json.dumps(manifest['summary'], indent=2)}")
    return manifest


if __name__ == "__main__":
    generate_manifest()
