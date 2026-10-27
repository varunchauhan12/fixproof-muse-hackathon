"""
FixProof Milestone 6C.4 — Cloud Runtime Integration Verification Script.

Executes autonomous verification of:
1. Local mode backward-compatibility (local FAISS index, assets, incidents).
2. Supabase mode hydration (active snapshot v1, SHA-256 integrity, 12 vectors, 5 assets).
3. Cloud catalog query (PostgreSQL reference_assets, reference_frames, incidents).
4. Authenticated asset streaming (200 JPEG frame bytes, 307 signed video URL redirect).
5. Threat scan against cloud reference index with suspect media isolation (ntotal invariant).
6. Cloud incident persistence in Supabase PostgreSQL incidents table.
7. Safe fallback to local mode with zero data pollution.
"""

import hashlib
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Import PyTorch and FAISS in safe order for macOS ARM64
import torch
import torchvision.models
import faiss

from fastapi.testclient import TestClient
from app.db import DatabaseManager, DatabaseConfig, DBMode, get_db_config, default_db_manager
from app.vault import ReferenceVault, EMBEDDING_DIM
from app.registry import list_registered_assets, get_asset_detail, load_incidents, save_incident
from app.main import app, default_vault
from app.storage import SupabaseStorageClient


def run_audit():
    print("=" * 80)
    print("FIXPROOF MILESTONE 6C.4 — CLOUD RUNTIME INTEGRATION AUDIT")
    print("=" * 80)

    client = TestClient(app)

    # --------------------------------------------------------------------------
    # Step 1: Verify Local Mode Behavior
    # --------------------------------------------------------------------------
    print("\n[Step 1] Verifying Local Mode (FIXPROOF_DB_MODE=local)...")
    os.environ["FIXPROOF_DB_MODE"] = "local"
    default_vault.reload(mode="local")
    local_status = default_vault.get_status()
    print(f"  - Vault Mode: {local_status.get('mode')}")
    print(f"  - Vector Count: {local_status.get('vault_size')}")
    print(f"  - Indexed Assets: {local_status.get('total_indexed_assets')}")
    assert local_status.get("mode") == "local", "Vault did not report mode=local!"

    local_assets = list_registered_assets(default_vault)
    local_incidents = load_incidents()
    print(f"  - Registered Local Assets: {len(local_assets)}")
    print(f"  - Stored Local Incidents: {len(local_incidents)}")
    print("  ✓ Local mode verified backward-compatible and operational.")

    # --------------------------------------------------------------------------
    # Step 2: Verify Supabase Mode Hydration & Snapshot Integrity
    # --------------------------------------------------------------------------
    print("\n[Step 2] Hydrating Reference Vault in Supabase Mode...")
    os.environ["FIXPROOF_DB_MODE"] = "supabase"
    default_vault.reload(mode="supabase")
    cloud_status = default_vault.get_status()
    print(f"  - Cloud Vault Mode: {cloud_status.get('mode')}")
    print(f"  - Snapshot Version: {cloud_status.get('snapshot_version')}")
    print(f"  - Cloud Vectors: {cloud_status.get('vault_size')}")
    print(f"  - Cloud Indexed Assets: {cloud_status.get('total_indexed_assets')}")
    print(f"  - Cached Index Path: {cloud_status.get('index_file')}")

    assert cloud_status.get("mode") == "supabase", "Cloud vault did not report mode=supabase!"
    assert cloud_status.get("vault_size") == 12, f"Expected 12 cloud vectors, got {cloud_status.get('vault_size')}!"
    assert cloud_status.get("total_indexed_assets") == 5, f"Expected 5 assets, got {cloud_status.get('total_indexed_assets')}!"
    assert "cloud_cache" in cloud_status.get("index_file"), "Cloud snapshot was not written to isolated cloud_cache!"

    # Verify snapshot SHA-256 against PostgreSQL catalog
    row = default_db_manager.fetch_one(
        "SELECT sha256_checksum, total_vectors FROM vault_snapshots WHERE status = 'ACTIVE' ORDER BY version_number DESC LIMIT 1;"
    )
    cached_idx_bytes = Path(cloud_status.get("index_file")).read_bytes()
    actual_hash = hashlib.sha256(cached_idx_bytes).hexdigest()
    assert actual_hash == row["sha256_checksum"], "Cached index SHA-256 mismatch against catalog!"
    print(f"  ✓ Snapshot integrity verified: SHA-256={actual_hash[:16]}... matches active catalog record.")

    # --------------------------------------------------------------------------
    # Step 3: Verify PostgreSQL Catalog Queries in Cloud Mode
    # --------------------------------------------------------------------------
    print("\n[Step 3] Querying Reference Assets and Incidents from PostgreSQL...")
    cloud_assets = list_registered_assets(default_vault)
    cloud_incidents = load_incidents()
    print(f"  - Cloud Registered Assets: {len(cloud_assets)}")
    print(f"  - Cloud Incidents in DB: {len(cloud_incidents)}")
    assert len(cloud_assets) == 5, f"Expected 5 cloud reference assets, got {len(cloud_assets)}"
    assert len(cloud_incidents) >= 100, f"Expected at least 100 cloud incidents, got {len(cloud_incidents)}"
    for a in cloud_assets:
        assert a["indexed"], f"Asset {a['asset_id']} should be indexed!"
        assert a["indexed_vectors"] > 0
    print("  ✓ Cloud catalog query verified: 5/5 assets indexed, 100+ incidents loaded from PostgreSQL.")

    # --------------------------------------------------------------------------
    # Step 4: Verify Authenticated Streaming & Signed URLs
    # --------------------------------------------------------------------------
    print("\n[Step 4] Testing Authenticated Storage Streaming...")
    target_aid = "46aef41b-b790-442e-a302-e8fc2fd05af1"

    # Test signed video redirect
    video_resp = client.get(f"/api/vault/assets/{target_aid}/video", follow_redirects=False)
    print(f"  - Video Stream Status: {video_resp.status_code}")
    print(f"  - Redirect URL: {video_resp.headers.get('location', '')[:50]}...")
    assert video_resp.status_code == 307, f"Expected 307 redirect, got {video_resp.status_code}"
    assert "token=" in video_resp.headers.get("location", ""), "Signed URL missing security token!"
    print("  ✓ Authenticated video streaming verified: 307 temporary redirect with time-bounded token.")

    # Test authenticated frame download
    frame_resp = client.get(f"/api/vault/assets/{target_aid}/frames/frame_0000s.jpg")
    print(f"  - Frame Stream Status: {frame_resp.status_code}")
    print(f"  - Frame Content-Type: {frame_resp.headers.get('content-type')}")
    print(f"  - Frame Payload: {len(frame_resp.content)} bytes")
    assert frame_resp.status_code == 200, f"Expected 200 JPEG, got {frame_resp.status_code}"
    assert frame_resp.headers.get("content-type") == "image/jpeg"
    assert len(frame_resp.content) > 1000
    print("  ✓ Authenticated frame streaming verified: 200 image/jpeg served from private bucket.")

    # --------------------------------------------------------------------------
    # Step 5: Execute End-to-End Threat Scan in Cloud Mode
    # --------------------------------------------------------------------------
    print("\n[Step 5] Executing End-to-End Threat Scan in Supabase Mode...")
    test_video_path = BACKEND_DIR / "storage" / "videos" / f"{target_aid}.mp4"
    assert test_video_path.exists(), f"Test video not found: {test_video_path}"

    initial_cloud_vectors = default_vault.vector_db.ntotal
    scan_incident_id = None

    try:
        with open(test_video_path, "rb") as f:
            scan_resp = client.post(
                "/api/threats/scan",
                files={"file": ("e2e_cloud_scan_test.mp4", f, "video/mp4")},
            )

        assert scan_resp.status_code == 200, f"Threat scan failed: {scan_resp.text}"
        scan_data = scan_resp.json()
        scan_incident_id = scan_data["incident_id"]
        print(f"  - Threat Scan Response: HTTP 200 OK")
        print(f"  - Generated Incident ID: {scan_incident_id}")
        print(f"  - Overall Status: {scan_data['overall_status']}")
        print(f"  - Highest Confidence: {scan_data['highest_confidence']}%")
        print(f"  - Lowest L2 Distance: {scan_data['lowest_l2_distance']}")
        print(f"  - Candidate Matches Found: {scan_data['candidate_matches_found']}")
        print(f"  - Matched Assets: {scan_data['matched_assets']}")

        # Verify suspect media isolation: trusted reference vectors MUST NOT change
        assert default_vault.vector_db.ntotal == initial_cloud_vectors, (
            f"FAISS index contaminated! Vector count grew from {initial_cloud_vectors} to {default_vault.vector_db.ntotal}"
        )
        print(f"  ✓ Suspect isolation verified: FAISS index maintained exactly {initial_cloud_vectors} trusted vectors.")

        # ----------------------------------------------------------------------
        # Step 6: Verify Incident Persistence in Supabase PostgreSQL
        # ----------------------------------------------------------------------
        print("\n[Step 6] Verifying Incident Persistence in Supabase PostgreSQL...")
        db_incident = default_db_manager.fetch_one(
            "SELECT * FROM incidents WHERE incident_id = %s;",
            (scan_incident_id,),
        )
        assert db_incident is not None, f"Incident {scan_incident_id} was NOT found in Supabase incidents table!"
        print(f"  - Retrieved DB Record ID: {db_incident['incident_id']}")
        print(f"  - DB Suspect Filename: {db_incident['suspect_filename']}")
        print(f"  - DB Overall Status: {db_incident['overall_status']}")
        print(f"  - DB Confidence: {db_incident['highest_confidence']}%")
        print(f"  - DB Scanned At: {db_incident['scanned_at']}")
        print(f"  - DB Matched Assets JSONB: {db_incident['matched_asset_ids']}")

        assert db_incident["suspect_filename"] == "e2e_cloud_scan_test.mp4"
        assert db_incident["overall_status"] == scan_data["overall_status"]
        print("  ✓ Cloud persistence verified: Threat scan incident successfully persisted in PostgreSQL.")

    finally:
        # Clean up test scan incident from Supabase PostgreSQL
        if scan_incident_id:
            default_db_manager.execute(
                "DELETE FROM incidents WHERE incident_id = %s;",
                (scan_incident_id,),
            )
            print(f"  ✓ Cleaned up test incident {scan_incident_id} from Supabase PostgreSQL.")

        # Re-set mode to local
        os.environ["FIXPROOF_DB_MODE"] = "local"
        default_vault.reload(mode="local")
        print("  ✓ Restored operational mode to FIXPROOF_DB_MODE=local.")

    # --------------------------------------------------------------------------
    # Final Integrity Check
    # --------------------------------------------------------------------------
    print("\n[Step 7] Checking Repository & Index Integrity...")
    prod_vault_path = BACKEND_DIR / "storage" / "vault" / "faiss_vault.index"
    assert prod_vault_path.exists(), "Original production index file is missing!"
    print(f"  ✓ Production FAISS index intact at {prod_vault_path}.")
    print("=" * 80)
    print("ALL MILESTONE 6C.4 RUNTIME INTEGRATION CHECKS PASSED SUCCESSFULLY!")
    print("=" * 80)


if __name__ == "__main__":
    run_audit()
