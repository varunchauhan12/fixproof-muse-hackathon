#!/usr/bin/env python3
"""
FixProof — Reset Supabase State Script
Cleans out all reference videos, frames, embeddings, and snapshots in Supabase,
and initializes a clean empty vault snapshot so the user can test ingestion from scratch.
"""

import os
import sys
import json
import hashlib
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

import faiss
from app.db import DatabaseManager, DatabaseConfig, DBMode
from app.storage import SupabaseStorageClient
import urllib.request

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
    except Exception as e:
        print(f"Error listing {bucket} with prefix '{prefix}': {e}")
        return []

def delete_storage_files(base_url: str, key: str, bucket: str, file_paths: list):
    """Deletes files from a storage bucket."""
    if not file_paths:
        return
    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
    }
    url = f"{base_url}/storage/v1/object/{bucket}"
    # Delete in batches of 100
    for i in range(0, len(file_paths), 100):
        batch = file_paths[i:i+100]
        payload = json.dumps({"prefixes": batch}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers, method="DELETE")
        try:
            with urllib.request.urlopen(req) as resp:
                pass
        except Exception as e:
            print(f"Error deleting batch in {bucket}: {e}")

def main():
    db_url = os.getenv("SUPABASE_DB_URL")
    base_url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not db_url or not base_url or not key:
        print("ERROR: Supabase credentials missing in .env")
        return

    print("=" * 60)
    print("FixProof — Resetting Supabase Storage & Database")
    print("=" * 60)

    # 1. Purge all storage files
    for bucket in ["reference-assets", "reference-frames", "vault-snapshots"]:
        files = get_storage_objects(base_url, key, bucket)
        print(f"Purging {len(files)} objects from bucket '{bucket}'...")
        delete_storage_files(base_url, key, bucket, files)
        remaining = get_storage_objects(base_url, key, bucket)
        print(f"Bucket '{bucket}' now has {len(remaining)} objects.")

    # 2. Clear Database Tables
    db = DatabaseManager(DatabaseConfig(mode=DBMode.SUPABASE, connection_url=db_url))
    with db.transaction() as conn:
        with conn.cursor() as cur:
            print("Truncating reference_vectors...")
            cur.execute("DELETE FROM reference_vectors;")
            print("Truncating reference_frames...")
            cur.execute("DELETE FROM reference_frames;")
            print("Truncating reference_assets...")
            cur.execute("DELETE FROM reference_assets;")
            print("Truncating vault_snapshots...")
            cur.execute("DELETE FROM vault_snapshots;")

    # 3. Create initial clean Snapshot v1 (0 vectors, 0 assets)
    print("Initializing clean empty Vault Snapshot v1...")
    cache_dir = BACKEND_DIR / "storage" / "cloud_cache" / "vault"
    cache_dir.mkdir(parents=True, exist_ok=True)
    idx_path = cache_dir / "faiss_vault_v1.index"
    meta_path = cache_dir / "vault_metadata_v1.json"

    empty_index = faiss.IndexFlatL2(576)
    faiss.write_index(empty_index, str(idx_path))
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({}, f, indent=2)

    sha256 = hashlib.sha256(idx_path.read_bytes()).hexdigest()

    storage = SupabaseStorageClient()
    storage.upload_file("vault-snapshots", "v1/faiss_vault.index", idx_path, content_type="application/octet-stream", upsert=True)
    storage.upload_file("vault-snapshots", "v1/vault_metadata.json", meta_path, content_type="application/json", upsert=True)

    with db.transaction() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO vault_snapshots (
                    version_number, total_vectors, total_assets, storage_index_path,
                    storage_meta_path, sha256_checksum, status, created_at
                ) VALUES (1, 0, 0, 'vault-snapshots/v1/faiss_vault.index', 'vault-snapshots/v1/vault_metadata.json', %s, 'ACTIVE', NOW());
                """,
                (sha256,)
            )

    print("Snapshot v1 registered with 0 vectors and 0 assets.")
    print("=" * 60)
    print("Supabase has been completely reset and is ready for fresh ingestion!")
    print("=" * 60)

if __name__ == "__main__":
    main()
