#!/usr/bin/env python3
"""
FixProof — Complete Supabase & Local State Reset Script
Completely deletes all reference assets, suspect videos, frames, vector embeddings,
snapshots, incidents, Nemotron reports, vision verifications, and evidence packages
from Supabase (PostgreSQL tables and Object Storage buckets) and local disk caches.

Reinitializes a clean empty Vault Snapshot v1 (0 vectors, 0 assets) so the application
can be tested cleanly from the very beginning.
"""

import os
import sys
import json
import shutil
import hashlib
from pathlib import Path
import urllib.request
import urllib.error

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

import faiss
from app.db import default_db_manager
from app.storage import SupabaseStorageClient


def get_storage_objects(base_url: str, key: str, bucket: str, prefix: str = "") -> list:
    """Recursively lists all files in a storage bucket."""
    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
    }
    url = f"{base_url}/storage/v1/object/list/{bucket}"
    payload = json.dumps({"prefix": prefix, "limit": 1000}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            items = json.loads(resp.read().decode("utf-8"))
            all_files = []
            for item in items:
                name = item.get("name")
                if not name:
                    continue
                path = f"{prefix}/{name}".lstrip("/") if prefix else name
                if item.get("id") is None:
                    # It's a folder, recurse
                    all_files.extend(get_storage_objects(base_url, key, bucket, path))
                else:
                    all_files.append(path)
            return all_files
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return []
        print(f"HTTPError listing {bucket} (prefix='{prefix}'): {e}")
        return []
    except Exception as e:
        print(f"Error listing {bucket} with prefix '{prefix}': {e}")
        return []


def delete_storage_files(base_url: str, key: str, bucket: str, file_paths: list):
    """Deletes files from a storage bucket in batches."""
    if not file_paths:
        return
    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
    }
    url = f"{base_url}/storage/v1/object/{bucket}"
    for i in range(0, len(file_paths), 100):
        batch = file_paths[i:i + 100]
        payload = json.dumps({"prefixes": batch}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers, method="DELETE")
        try:
            with urllib.request.urlopen(req) as resp:
                pass
        except Exception as e:
            print(f"Error deleting batch from {bucket}: {e}")


def main():
    print("=" * 70)
    print("FixProof — COMPLETE Reset of Supabase Data & Storage")
    print("=" * 70)

    base_url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    db_url = os.getenv("SUPABASE_DB_URL")

    if not base_url or not key or not db_url:
        print("ERROR: Supabase credentials missing in .env")
        sys.exit(1)

    # --------------------------------------------------------------------------
    # 1. PURGE ALL SUPABASE OBJECT STORAGE BUCKETS
    # --------------------------------------------------------------------------
    buckets = [
        "reference-assets",
        "reference-frames",
        "vault-snapshots",
        "suspect-videos",
        "suspect-frames",
        "evidence-packages",
    ]

    print("\n[Phase 1] Purging all Supabase Storage Buckets...")
    for bucket in buckets:
        files = get_storage_objects(base_url, key, bucket)
        if files:
            print(f"  • Deleting {len(files)} object(s) from bucket '{bucket}'...")
            delete_storage_files(base_url, key, bucket, files)
        else:
            print(f"  • Bucket '{bucket}' is already empty.")

        remaining = get_storage_objects(base_url, key, bucket)
        print(f"    Bucket '{bucket}' remaining count: {len(remaining)}")

    # --------------------------------------------------------------------------
    # 2. PURGE ALL DATABASE TABLES IN SUPABASE
    # --------------------------------------------------------------------------
    print("\n[Phase 2] Purging all records from Supabase PostgreSQL tables...")
    tables_to_delete = [
        "evidence_packages",
        "vision_verifications",
        "nemotron_reports",
        "incidents",
        "investigation_jobs",
        "reference_vectors",
        "reference_frames",
        "reference_assets",
        "vault_snapshots",
    ]

    with default_db_manager.transaction() as conn:
        with conn.cursor() as cur:
            for tbl in tables_to_delete:
                cur.execute(f"DELETE FROM {tbl};")
                print(f"  • Truncated table: {tbl}")

    # --------------------------------------------------------------------------
    # 3. REINITIALIZE CLEAN VAULT SNAPSHOT v1
    # --------------------------------------------------------------------------
    print("\n[Phase 3] Initializing clean empty Vault Snapshot v1...")
    cache_dir = BACKEND_DIR / "storage" / "cloud_cache" / "vault"
    cache_dir.mkdir(parents=True, exist_ok=True)
    idx_path = cache_dir / "faiss_vault_v1.index"
    meta_path = cache_dir / "vault_metadata_v1.json"

    # Write clean 576-dim empty FAISS index
    empty_index = faiss.IndexFlatL2(576)
    faiss.write_index(empty_index, str(idx_path))

    # Write empty metadata JSON
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({}, f, indent=2)

    sha256 = hashlib.sha256(idx_path.read_bytes()).hexdigest()

    # Upload clean snapshot to 'vault-snapshots' bucket
    storage_client = SupabaseStorageClient()
    storage_client.upload_file(
        "vault-snapshots",
        "v1/faiss_vault.index",
        idx_path,
        content_type="application/octet-stream",
        upsert=True,
    )
    storage_client.upload_file(
        "vault-snapshots",
        "v1/vault_metadata.json",
        meta_path,
        content_type="application/json",
        upsert=True,
    )

    # Register snapshot v1 in database
    with default_db_manager.transaction() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO vault_snapshots (
                    version_number, total_vectors, total_assets, storage_index_path,
                    storage_meta_path, sha256_checksum, status, created_at
                ) VALUES (
                    1, 0, 0, 'vault-snapshots/v1/faiss_vault.index', 'vault-snapshots/v1/vault_metadata.json',
                    %s, 'ACTIVE', NOW()
                );
                """,
                (sha256,),
            )
    print("  • Clean Vault Snapshot v1 registered (0 vectors, 0 assets).")

    # --------------------------------------------------------------------------
    # 4. PURGE LOCAL STORAGE AND LOCAL CACHES
    # --------------------------------------------------------------------------
    print("\n[Phase 4] Purging local disk caches and temp artifacts...")
    local_dirs_to_clean = [
        BACKEND_DIR / "storage" / "videos",
        BACKEND_DIR / "storage" / "frames",
        BACKEND_DIR / "storage" / "suspects" / "videos",
        BACKEND_DIR / "storage" / "suspects" / "frames",
        BACKEND_DIR / "storage" / "suspects" / "thumbnails",
        BACKEND_DIR / "storage" / "index",
        BACKEND_DIR / "storage" / "cloud_cache" / "assets",
        BACKEND_DIR / "storage" / "cloud_cache" / "frames",
    ]

    for d in local_dirs_to_clean:
        if d.exists():
            for item in d.glob("*"):
                try:
                    if item.is_file():
                        item.unlink()
                    elif item.is_dir():
                        shutil.rmtree(item)
                except Exception as e:
                    print(f"    Failed to remove {item}: {e}")
            print(f"  • Cleaned local directory: {d.relative_to(BACKEND_DIR)}")
        else:
            d.mkdir(parents=True, exist_ok=True)

    # Clean local JSON persistence files if any
    incidents_json = BACKEND_DIR / "storage" / "incidents.json"
    if incidents_json.exists():
        with open(incidents_json, "w", encoding="utf-8") as f:
            json.dump([], f)
        print("  • Reset storage/incidents.json to []")

    email_audit_json = BACKEND_DIR / "storage" / "email_audit_log.json"
    if email_audit_json.exists():
        with open(email_audit_json, "w", encoding="utf-8") as f:
            json.dump([], f)
        print("  • Reset storage/email_audit_log.json to []")

    # --------------------------------------------------------------------------
    # 5. VERIFICATION OF CLEAN STATE
    # --------------------------------------------------------------------------
    print("\n[Phase 5] Verifying post-reset state in Supabase...")
    for tbl in tables_to_delete:
        row = default_db_manager.fetch_one(f"SELECT COUNT(*) as count FROM {tbl};")
        cnt = row["count"] if row else 0
        expected = 1 if tbl == "vault_snapshots" else 0
        status_flag = "✓ OK" if cnt == expected else "✗ UNEXPECTED"
        print(f"  {status_flag} Table '{tbl}': {cnt} row(s) (expected: {expected})")

    print("\n" + "=" * 70)
    print("SUCCESS: Supabase and local state have been completely reset!")
    print("FixProof is now at 0 reference assets, 0 suspect incidents, and ready")
    print("for you to try everything from the beginning.")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    main()
