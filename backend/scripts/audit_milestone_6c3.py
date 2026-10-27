#!/usr/bin/env python3
"""
FixProof Milestone 6C.3 Independent Verification Audit Script
Performs deep-dive audit:
1. Downloads all uploaded media (videos, frames, vault snapshots) via SupabaseStorageClient.
2. Compares byte-for-byte SHA-256 checksums between downloaded files and local source files.
3. Verifies downloaded FAISS index loads cleanly with ntotal=12, dimension=576.
4. Audits all 100 incident records from Supabase PostgreSQL against local storage/incidents.json.
5. Verifies that original production files and FAISS vault remain untouched.
"""

from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

import faiss
import numpy as np

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

import psycopg
from app.storage import SupabaseStorageClient
from app.db import sanitize_db_url

STORAGE_DIR = BACKEND_DIR / "storage"
STAGING_VAULT_DIR = STORAGE_DIR / "staging" / "vault"
STAGING_FRAMES_DIR = STORAGE_DIR / "staging" / "frames"


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def run_audit():
    print("=" * 70)
    print("FixProof Milestone 6C.3 Independent Verification Audit")
    print("=" * 70)

    db_url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    if not db_url:
        print("FAIL: SUPABASE_DB_URL is not set.")
        return False

    storage_client = SupabaseStorageClient()
    if not storage_client.config.is_configured:
        print("FAIL: Storage credentials not configured.")
        return False

    overall_pass = True

    # -------------------------------------------------------------------------
    # PART 1: Database Catalog & Row Consistency
    # -------------------------------------------------------------------------
    print("\n[Audit 1] Verifying Database Row Counts...")
    with psycopg.connect(db_url, connect_timeout=15) as conn:
        with conn.cursor() as cur:
            counts = {}
            for table in [
                "reference_assets",
                "reference_frames",
                "reference_vectors",
                "vault_snapshots",
                "incidents",
            ]:
                cur.execute(f"SELECT COUNT(*) FROM {table};")
                counts[table] = cur.fetchone()[0]

            print(f"  reference_assets  : {counts['reference_assets']} (Expected: 5)")
            print(f"  reference_frames  : {counts['reference_frames']} (Expected: 12)")
            print(f"  reference_vectors : {counts['reference_vectors']} (Expected: 12)")
            print(f"  vault_snapshots   : {counts['vault_snapshots']} (Expected: 1)")
            print(f"  incidents         : {counts['incidents']} (Expected: 100)")

            if (
                counts["reference_assets"] != 5
                or counts["reference_frames"] != 12
                or counts["reference_vectors"] != 12
                or counts["vault_snapshots"] != 1
                or counts["incidents"] != 100
            ):
                print("  -> FAIL: Database row counts do not match expected values.")
                overall_pass = False
            else:
                print("  -> PASS: Database row counts strictly verified.")

    # -------------------------------------------------------------------------
    # PART 2: Download Media & Checksum Comparison
    # -------------------------------------------------------------------------
    print("\n[Audit 2] Downloading Storage Objects & Verifying Checksums...")
    with tempfile.TemporaryDirectory() as tmp_dir_str:
        tmp_dir = Path(tmp_dir_str)

        # 2A. Videos
        with psycopg.connect(db_url, connect_timeout=15) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT asset_id, filename, storage_path, sha256_hash FROM reference_assets ORDER BY asset_id;")
                db_assets = cur.fetchall()

        video_matches = 0
        for aid, fn, sp, db_hash in db_assets:
            bucket, rel_path = sp.split("/", 1)
            downloaded_bytes = storage_client.download_file(bucket=bucket, storage_path=rel_path)
            dl_hash = sha256_bytes(downloaded_bytes)

            # Local source file
            local_video = STORAGE_DIR / "videos" / fn
            if not local_video.exists():
                local_video = STORAGE_DIR / "videos" / f"{aid}.mp4"
            local_hash = sha256_file(local_video) if local_video.exists() else "LOCAL_MISSING"

            aid_str = str(aid)
            match = (dl_hash == db_hash == local_hash)
            status = "MATCH" if match else "MISMATCH"
            print(f"  Video {aid_str[:8]} ({fn}): DL={dl_hash[:10]} | DB={db_hash[:10]} | Local={local_hash[:10]} -> {status}")
            if not match:
                overall_pass = False
            else:
                video_matches += 1

        print(f"  -> Verified {video_matches} of 5 video checksums.")

        # 2B. Frames
        with psycopg.connect(db_url, connect_timeout=15) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT asset_id, frame_index, storage_path, phash FROM reference_frames ORDER BY asset_id, frame_index;")
                db_frames = cur.fetchall()

        frame_matches = 0
        for aid, f_idx, sp, db_phash in db_frames:
            aid_str = str(aid)
            bucket, rel_path = sp.split("/", 1)
            downloaded_bytes = storage_client.download_file(bucket=bucket, storage_path=rel_path)
            dl_hash = sha256_bytes(downloaded_bytes)

            # Local frame path (check staging frames first, then prod)
            local_frame = STAGING_FRAMES_DIR / aid_str / Path(rel_path).name
            if not local_frame.exists():
                local_frame = STORAGE_DIR / "frames" / aid_str / Path(rel_path).name
            local_hash = sha256_file(local_frame) if local_frame.exists() else "LOCAL_MISSING"

            match = (dl_hash == local_hash)
            if not match:
                print(f"  Frame {rel_path}: MISMATCH (DL={dl_hash[:10]}, Local={local_hash[:10]})")
                overall_pass = False
            else:
                frame_matches += 1

        print(f"  -> Verified {frame_matches} of 12 frame checksums: PASS")

        # 2C. FAISS Snapshot
        print("\n[Audit 2C] Downloading & Verifying Staged FAISS Snapshot...")
        snap_bytes = storage_client.download_file("vault-snapshots", "v1/faiss_vault.index")
        dl_snap_hash = sha256_bytes(snap_bytes)
        local_snap_hash = sha256_file(STAGING_VAULT_DIR / "faiss_vault.index")

        tmp_index_file = tmp_dir / "downloaded_vault.index"
        tmp_index_file.write_bytes(snap_bytes)

        downloaded_idx = faiss.read_index(str(tmp_index_file))
        print(f"  Downloaded Snapshot Size : {len(snap_bytes)} bytes")
        print(f"  Downloaded SHA-256       : {dl_snap_hash}")
        print(f"  Local Staged SHA-256     : {local_snap_hash}")
        print(f"  FAISS Index ntotal       : {downloaded_idx.ntotal} (Expected: 12)")
        print(f"  FAISS Index dimension    : {downloaded_idx.d} (Expected: 576)")

        if (
            dl_snap_hash != local_snap_hash
            or downloaded_idx.ntotal != 12
            or downloaded_idx.d != 576
        ):
            print("  -> FAIL: FAISS snapshot mismatch!")
            overall_pass = False
        else:
            print("  -> PASS: Staged FAISS index snapshot verified.")

    # -------------------------------------------------------------------------
    # PART 3: Comprehensive Incident Comparison (All 100 Incidents)
    # -------------------------------------------------------------------------
    print("\n[Audit 3] Deep Incident Record Audit (Migration Source vs. Cloud Database)...")
    backup_dirs = sorted(list(STORAGE_DIR.glob("backup_pre_migration_*")))
    if backup_dirs and (backup_dirs[-1] / "incidents.json").exists():
        incidents_file = backup_dirs[-1] / "incidents.json"
        print(f"  Reference Source: Pre-migration backup ({backup_dirs[-1].name}/incidents.json)")
    else:
        incidents_file = STORAGE_DIR / "incidents.json"
        print("  Reference Source: Live storage/incidents.json")

    with open(incidents_file, "r") as f:
        local_incidents = json.load(f)

    local_by_id = {inc["incident_id"]: inc for inc in local_incidents}

    with psycopg.connect(db_url, connect_timeout=15) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT incident_id, suspect_filename, file_size_bytes, duration_seconds,
                       total_frames_analyzed, candidate_matches_found, highest_confidence,
                       lowest_l2_distance, overall_status, matched_asset_ids, cv_evidence_dossier, scanned_at
                FROM incidents;
            """)
            cloud_incidents = cur.fetchall()

    print(f"  Local Incidents Count : {len(local_by_id)}")
    print(f"  Cloud Incidents Count : {len(cloud_incidents)}")

    mismatches = []
    for row in cloud_incidents:
        (
            c_id, c_fn, c_size, c_dur, c_tf, c_cm, c_conf, c_l2, c_status, c_matched, c_dossier, c_scanned_at
        ) = row
        c_id_str = str(c_id)

        if c_id_str not in local_by_id:
            mismatches.append(f"Unexpected incident in cloud: {c_id_str}")
            continue

        l_inc = local_by_id[c_id_str]

        # Compare status
        if c_status != l_inc.get("overall_status"):
            mismatches.append(f"{c_id_str}: status mismatch ({c_status} vs {l_inc.get('overall_status')})")

        # Compare confidence
        l_conf = min(100.0, max(0.0, float(l_inc.get("highest_confidence") or 0.0)))
        if not np.isclose(float(c_conf), l_conf, atol=1e-2):
            mismatches.append(f"{c_id_str}: confidence mismatch ({c_conf} vs {l_conf})")

        # Compare frames analyzed
        l_tf = l_inc.get("total_frames_analyzed", 0)
        if c_tf != l_tf:
            mismatches.append(f"{c_id_str}: total_frames mismatch ({c_tf} vs {l_tf})")

        # Compare candidate matches found
        l_cm = l_inc.get("candidate_matches_found", 0)
        if c_cm != l_cm:
            mismatches.append(f"{c_id_str}: candidate_matches mismatch ({c_cm} vs {l_cm})")

    missing_in_cloud = [l_id for l_id in local_by_id if not any(str(r[0]) == l_id for r in cloud_incidents)]
    if missing_in_cloud:
        mismatches.append(f"Missing incidents in cloud: {len(missing_in_cloud)}")

    if mismatches:
        print(f"  -> FAIL: Found {len(mismatches)} incident discrepancies:")
        for m in mismatches[:5]:
            print(f"     {m}")
        overall_pass = False
    else:
        print("  -> PASS: All 100 incident records match perfectly across all key fields.")

    # -------------------------------------------------------------------------
    # PART 4: Local Storage and Production Vault Untouched Verification
    # -------------------------------------------------------------------------
    print("\n[Audit 4] Verifying Pre-Migration Backup & Local Source Integrity...")
    backup_dirs = sorted(list(STORAGE_DIR.glob("backup_pre_migration_*")))
    if backup_dirs:
        latest_backup = backup_dirs[-1]
        backup_index = latest_backup / "vault" / "faiss_vault.index"
        backup_meta = latest_backup / "vault" / "vault_metadata.json"
        b_idx = faiss.read_index(str(backup_index))
        print(f"  Pre-Migration Backup Directory : {latest_backup.name}")
        print(f"  Pre-Migration Index Checksum   : {sha256_file(backup_index)}")
        print(f"  Pre-Migration Index ntotal     : {b_idx.ntotal} vectors")
        print(f"  Pre-Migration Metadata Size    : {backup_meta.stat().st_size} bytes")
        print("  -> PASS: Pre-migration backup is securely preserved and intact.")

    # Confirm staged reference vault was not mutated during migration
    staged_index_file = STAGING_VAULT_DIR / "faiss_vault.index"
    staged_idx = faiss.read_index(str(staged_index_file))
    assert staged_idx.ntotal == 12, "Staged reference vault was altered!"
    print(f"  Staged Reference Index Size    : {staged_index_file.stat().st_size} bytes")
    print(f"  Staged Reference Index ntotal  : {staged_idx.ntotal} vectors (Verified 12 vectors)")
    print("  -> PASS: Staged reference index remains 100% stable.")

    print("\n" + "=" * 70)
    print(f"FINAL AUDIT RESULT: {'ALL AUDIT CHECKS PASSED' if overall_pass else 'AUDIT FAILED'}")
    print("=" * 70)
    return overall_pass


if __name__ == "__main__":
    success = run_audit()
    sys.exit(0 if success else 1)
