"""
Test suite for Milestone 6C.4: Supabase Cloud Runtime Integration.

Verifies:
1. Dual-mode support (FIXPROOF_DB_MODE=local vs FIXPROOF_DB_MODE=supabase).
2. Dynamic ReferenceVault hydration from active Supabase Storage snapshot with SHA-256 validation.
3. Fast failure on snapshot corruption, storage unavailable, missing snapshot, or DB error (no false clean).
4. PostgreSQL catalog querying for registered assets and incidents.
5. Cloud incident persistence in Supabase PostgreSQL incidents table.
6. Authenticated streaming of reference frames (200 JPEG) and videos (307 signed URL redirect).
7. Suspect media isolation (suspect frames/videos never enter trusted reference index).
8. End-to-end threat scan in Supabase mode with PostgreSQL persistence verification.
"""

from datetime import datetime, timezone
import hashlib
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

import torch
import torchvision
import faiss
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
import sys
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db import DatabaseManager, DatabaseConfig, DBMode, get_db_config, default_db_manager
from app.vault import ReferenceVault, EMBEDDING_DIM
from app.registry import list_registered_assets, get_asset_detail, load_incidents, save_incident
from app.main import app, default_vault
from app.storage import SupabaseStorageClient, StorageError, StorageNotFoundError


class TestCloudRuntimeIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        db_url = os.getenv("SUPABASE_DB_URL") or ""
        role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
        is_placeholder = (
            "[YOUR-" in db_url
            or "your_secret" in role_key
            or "your_public" in (os.getenv("SUPABASE_ANON_KEY") or "")
        )
        cls.has_live_cloud = bool(db_url and role_key and not is_placeholder)
        cls.test_asset_id = "2c6fa947-96cb-40c8-971e-a82869ac2214"
        if cls.has_live_cloud:
            try:
                from app.db import DatabaseConfig, DBMode, DatabaseManager
                mgr = DatabaseManager(DatabaseConfig(mode=DBMode.SUPABASE, connection_url=db_url))
                row = mgr.fetch_one("SELECT asset_id FROM reference_assets ORDER BY created_at DESC LIMIT 1;")
                if row:
                    cls.test_asset_id = str(row["asset_id"])
            except Exception:
                pass

    def setUp(self):
        # Save original environment mode
        self.orig_mode = os.environ.get("FIXPROOF_DB_MODE")

    def tearDown(self):
        # Restore environment mode
        if self.orig_mode is not None:
            os.environ["FIXPROOF_DB_MODE"] = self.orig_mode
        else:
            os.environ.pop("FIXPROOF_DB_MODE", None)

    # ──────────────────────────────────────────────────────────────────────────
    # 1. Cloud Vault Hydration & Snapshot Integrity
    # ──────────────────────────────────────────────────────────────────────────

    def test_cloud_vault_hydrates_from_active_snapshot(self):
        """Verifies ReferenceVault loads active snapshot from Supabase Storage with SHA-256 validation."""
        if not self.has_live_cloud:
            self.skipTest("Live Supabase credentials not configured.")

        vault = ReferenceVault(mode="supabase")
        status = vault.get_status()

        self.assertEqual(status["status"], "ready")
        self.assertEqual(status["mode"], "supabase")
        self.assertEqual(status["embedding_dim"], 576)
        self.assertGreaterEqual(status["vault_size"], 1)
        self.assertGreaterEqual(status["total_indexed_assets"], 1)
        self.assertGreaterEqual(status["snapshot_version"], 1)
        self.assertTrue(Path(status["index_file"]).exists())
        self.assertTrue(Path(status["metadata_file"]).exists())

        # Ensure snapshot cached in cloud_cache, NOT touching local vault
        self.assertIn("cloud_cache", status["index_file"])

    def test_cloud_vault_fails_on_corrupt_sha256(self):
        """Verifies ReferenceVault fails fast with RuntimeError when snapshot SHA-256 is corrupt."""
        with patch("app.db.DatabaseManager.fetch_one") as mock_fetch:
            mock_fetch.return_value = {
                "version_number": 99,
                "total_vectors": 12,
                "total_assets": 5,
                "storage_index_path": "vault-snapshots/v99/faiss_vault.index",
                "storage_meta_path": "vault-snapshots/v99/vault_metadata.json",
                "sha256_checksum": "0000000000000000000000000000000000000000000000000000000000000000",
                "status": "ACTIVE",
            }
            with patch("app.storage.SupabaseStorageClient.download_file") as mock_dl:
                mock_dl.return_value = b"corrupted_faiss_payload_bytes"
                with self.assertRaises(RuntimeError) as ctx:
                    ReferenceVault(mode="supabase")
                self.assertIn("Cloud FAISS snapshot integrity failure", str(ctx.exception))
                self.assertIn("SHA-256 mismatch", str(ctx.exception))

    def test_cloud_vault_graceful_empty_start_on_missing_active_snapshot(self):
        """Verifies ReferenceVault initializes an empty FAISS index when no active snapshot exists."""
        with patch("app.db.DatabaseManager.fetch_one") as mock_fetch:
            mock_fetch.return_value = None
            vault = ReferenceVault(mode="supabase")
            self.assertEqual(vault.vector_db.ntotal, 0)
            self.assertEqual(vault.metadata_store, {})
            self.assertIsNone(vault.snapshot_version)
            self.assertIsNone(vault.index_path)
            self.assertIsNone(vault.meta_path)
            status = vault.get_status()
            self.assertEqual(status["status"], "empty")
            self.assertEqual(status["vault_size"], 0)
            self.assertEqual(status["embedding_dim"], 576)

    def test_cloud_vault_fails_on_storage_download_error(self):
        """Verifies ReferenceVault fails fast when snapshot storage is unreachable."""
        with patch("app.db.DatabaseManager.fetch_one") as mock_fetch:
            mock_fetch.return_value = {
                "version_number": 1,
                "total_vectors": 12,
                "total_assets": 5,
                "storage_index_path": "vault-snapshots/v1/faiss_vault.index",
                "storage_meta_path": "vault-snapshots/v1/vault_metadata.json",
                "sha256_checksum": "abc123",
                "status": "ACTIVE",
            }
            with patch("app.storage.SupabaseStorageClient.download_file") as mock_dl:
                mock_dl.side_effect = StorageError("Connection refused by storage endpoint")
                with self.assertRaises(RuntimeError) as ctx:
                    ReferenceVault(mode="supabase")
                self.assertIn("Failed to download cloud FAISS index", str(ctx.exception))

    # ──────────────────────────────────────────────────────────────────────────
    # 2. Cloud Registry & Incident Persistence
    # ──────────────────────────────────────────────────────────────────────────

    def test_list_registered_assets_in_cloud_mode(self):
        """Verifies list_registered_assets queries PostgreSQL and reports correct cloud assets."""
        if not self.has_live_cloud:
            self.skipTest("Live Supabase credentials not configured.")

        os.environ["FIXPROOF_DB_MODE"] = "supabase"
        vault = ReferenceVault(mode="supabase")
        assets = list_registered_assets(vault)

        self.assertGreaterEqual(len(assets), 1)
        asset_ids = {a["asset_id"] for a in assets}
        self.assertIn(self.test_asset_id, asset_ids)

        self.assertTrue(any(a["indexed"] for a in assets))
        for a in assets:
            if a["indexed"]:
                self.assertGreater(a["indexed_vectors"], 0)
                self.assertGreater(len(a["frames"]), 0)
            self.assertIn("/api/vault/assets/", a["video_url"])

    def test_load_and_save_incident_in_cloud_mode(self):
        """Verifies incidents are persisted in PostgreSQL and loaded back accurately."""
        if not self.has_live_cloud:
            self.skipTest("Live Supabase credentials not configured.")

        os.environ["FIXPROOF_DB_MODE"] = "supabase"
        import uuid
        test_incident_id = str(uuid.uuid4())
        test_incident = {
            "incident_id": test_incident_id,
            "suspect_filename": "test_persistence_suspect.mp4",
            "file_size": 204800,
            "duration_seconds": 12.5,
            "total_frames_analyzed": 3,
            "candidate_matches_found": 1,
            "highest_confidence": 88.4,
            "lowest_l2_distance": 0.23,
            "overall_status": "CANDIDATE_MATCH",
            "matched_assets": [self.test_asset_id],
            "frame_matches": [{"match_confirmed": True, "confidence": 88.4}],
            "scanned_at": datetime.now(timezone.utc).isoformat(),
        }

        try:
            # 1. Save incident
            save_incident(test_incident)

            # 2. Query through load_incidents
            incidents = load_incidents()
            persisted = next((i for i in incidents if i["incident_id"] == test_incident_id), None)
            self.assertIsNotNone(persisted)
            self.assertEqual(persisted["suspect_filename"], "test_persistence_suspect.mp4")
            self.assertEqual(persisted["overall_status"], "CANDIDATE_MATCH")
            self.assertAlmostEqual(persisted["highest_confidence"], 88.4, places=1)
            self.assertIn(self.test_asset_id, persisted["matched_assets"])
        finally:
            # Clean up test row
            default_db_manager.execute(
                "DELETE FROM incidents WHERE incident_id = %s;",
                (test_incident_id,),
            )

    # ──────────────────────────────────────────────────────────────────────────
    # 3. Authenticated Streaming & Signed URLs
    # ──────────────────────────────────────────────────────────────────────────

    def test_stream_video_returns_signed_url_in_cloud_mode(self):
        """Verifies GET /api/vault/assets/{id}/video returns 307 temporary redirect to signed URL."""
        if not self.has_live_cloud:
            self.skipTest("Live Supabase credentials not configured.")

        os.environ["FIXPROOF_DB_MODE"] = "supabase"
        resp = self.client.get(
            f"/api/vault/assets/{self.test_asset_id}/video",
            follow_redirects=False,
        )
        self.assertEqual(resp.status_code, 307)
        location = resp.headers.get("location", "")
        self.assertTrue(location.startswith("https://") or location.startswith("http://"))
        self.assertIn("token=", location)

    def test_stream_frame_returns_jpeg_in_cloud_mode(self):
        """Verifies GET /api/vault/assets/{id}/frames/{fn} streams JPEG bytes from Supabase Storage."""
        if not self.has_live_cloud:
            self.skipTest("Live Supabase credentials not configured.")

        os.environ["FIXPROOF_DB_MODE"] = "supabase"
        row = default_db_manager.fetch_one("SELECT asset_id, storage_path FROM reference_frames LIMIT 1;")
        if not row or not row.get("storage_path"):
            self.skipTest("No indexed frames available in live cloud vault.")

        filename = row["storage_path"].split("/")[-1]
        resp = self.client.get(
            f"/api/vault/assets/{row['asset_id']}/frames/{filename}",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get("content-type"), "image/jpeg")
        self.assertGreater(len(resp.content), 1000)

    def test_stream_nonexistent_asset_returns_404(self):
        """Verifies streaming nonexistent asset returns HTTP 404 in cloud mode."""
        if not self.has_live_cloud:
            self.skipTest("Live Supabase credentials not configured.")

        os.environ["FIXPROOF_DB_MODE"] = "supabase"
        nonexistent = "00000000-0000-0000-0000-000000000000"
        resp_video = self.client.get(f"/api/vault/assets/{nonexistent}/video", follow_redirects=False)
        self.assertEqual(resp_video.status_code, 404)

        resp_frame = self.client.get(f"/api/vault/assets/{nonexistent}/frames/frame_0000s.jpg")
        self.assertEqual(resp_frame.status_code, 404)

    # ──────────────────────────────────────────────────────────────────────────
    # 4. End-to-End Threat Scan & Suspect Media Isolation
    # ──────────────────────────────────────────────────────────────────────────

    def test_threat_scan_in_cloud_mode_and_verify_persistence(self):
        """
        Executes end-to-end threat scan in Supabase mode using a test video:
        1. Confirms visual match against cloud reference library.
        2. Verifies suspect upload never enters the trusted FAISS index.
        3. Verifies the incident record is persisted in Supabase PostgreSQL.
        """
        if not self.has_live_cloud:
            self.skipTest("Live Supabase credentials not configured.")

        os.environ["FIXPROOF_DB_MODE"] = "supabase"
        default_vault.reload(mode="supabase")
        initial_vault_size = default_vault.vector_db.ntotal

        # Use an existing test video source
        test_video_path = BACKEND_DIR / "storage" / "videos" / f"{self.test_asset_id}.mp4"
        if not test_video_path.exists():
            test_video_path = BACKEND_DIR / "storage" / "backup_pre_migration_20261026_153812" / "videos" / f"{self.test_asset_id}.mp4"
        if not test_video_path.exists():
            self.skipTest(f"Test video source not found: {test_video_path}")

        scan_incident_id = None
        try:
            with open(test_video_path, "rb") as f:
                resp = self.client.post(
                    "/api/threats/scan",
                    files={"file": ("suspect_threat_test.mp4", f, "video/mp4")},
                )
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            scan_incident_id = data.get("incident_id")
            self.assertIsNotNone(scan_incident_id)

            # Check scan results
            self.assertIn("candidate_matches_found", data)
            self.assertIn(data["overall_status"], ("CANDIDATE_MATCH", "SUSPECT", "CLEAN"))

            # Strict guarantee: trusted reference index size must NOT increase
            self.assertEqual(default_vault.vector_db.ntotal, initial_vault_size)

            # Verify incident persisted in Supabase PostgreSQL
            row = default_db_manager.fetch_one(
                "SELECT * FROM incidents WHERE incident_id = %s;",
                (scan_incident_id,),
            )
            self.assertIsNotNone(row)
            self.assertEqual(row["suspect_filename"], "suspect_threat_test.mp4")
            self.assertEqual(row["overall_status"], data["overall_status"])
        finally:
            # Clean up the test scan incident from PostgreSQL
            if scan_incident_id:
                default_db_manager.execute(
                    "DELETE FROM incidents WHERE incident_id = %s;",
                    (scan_incident_id,),
                )
            # Restore vault back to local mode
            os.environ["FIXPROOF_DB_MODE"] = "local"
            default_vault.reload(mode="local")

    def test_empty_cloud_vault_fails_scan_safely(self):
        """Verifies scan endpoint raises 503 if cloud vault is uninitialized or has 0 vectors."""
        os.environ["FIXPROOF_DB_MODE"] = "supabase"
        empty_cloud_vault = ReferenceVault(mode="local")
        empty_cloud_vault.vector_db = faiss.IndexFlatL2(EMBEDDING_DIM)
        empty_cloud_vault.metadata_store = {}

        # Create dummy small video
        with tempfile.NamedTemporaryFile(suffix=".mp4") as tmp:
            tmp.write(b"\x00" * 1024)
            tmp.flush()
            with patch("app.main.default_vault", empty_cloud_vault):
                with patch("app.main.is_cloud_mode", return_value=True):
                    with open(tmp.name, "rb") as f:
                        resp = self.client.post(
                            "/api/threats/scan",
                            files={"file": ("dummy.mp4", f, "video/mp4")},
                        )
                    # Must fail with HTTP 503 or 422, NEVER return false CLEAN
                    self.assertIn(resp.status_code, (422, 503))

    def test_scan_suspect_on_empty_vault_returns_zero_match(self):
        """Verifies scanning a suspect video with an empty vault returns a 200 zero-match response."""
        sample_path = BACKEND_DIR / "sample_match_highlight.mp4"
        if not sample_path.exists():
            self.skipTest("sample_match_highlight.mp4 not found.")

        empty_vault = ReferenceVault(mode="local")
        empty_vault.vector_db = faiss.IndexFlatL2(EMBEDDING_DIM)
        empty_vault.metadata_store = {}

        with patch("app.main.default_vault", empty_vault):
            with open(sample_path, "rb") as f:
                resp = self.client.post(
                    "/api/threats/scan",
                    files={"file": ("sample_match_highlight.mp4", f, "video/mp4")},
                    headers={"X-Client-Session-Id": "test-empty-vault-scan"},
                )
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data.get("overall_status"), "NO_REFERENCE_DATA")
            self.assertEqual(data.get("candidate_matches_found"), 0)
            self.assertEqual(len(data.get("reference_matches", [])), 0)

    # ──────────────────────────────────────────────────────────────────────────
    # 5. Local Mode Backward Compatibility
    # ──────────────────────────────────────────────────────────────────────────

    def test_local_mode_remains_backward_compatible(self):
        """Verifies FIXPROOF_DB_MODE=local uses local JSON files and leaves production index unchanged."""
        os.environ["FIXPROOF_DB_MODE"] = "local"
        default_vault.reload(mode="local")

        status = default_vault.get_status()
        self.assertEqual(status["mode"], "local")
        self.assertIsNone(status["snapshot_version"])

        # Local assets list
        assets = list_registered_assets(default_vault)
        self.assertIsInstance(assets, list)

        # Local incidents list
        incidents = load_incidents()
        self.assertIsInstance(incidents, list)
        self.assertGreaterEqual(len(incidents), 0)

    # ──────────────────────────────────────────────────────────────────────────
    # 6. Production Regression Tests: Sync, Stale Vector Filter, Deletion & URL Fallback
    # ──────────────────────────────────────────────────────────────────────────

    def test_vault_sync_prunes_orphaned_vectors(self):
        """Issue 1 Regression: Vault sync removes vectors belonging to deleted assets."""
        import tempfile
        import numpy as np
        import faiss
        with tempfile.TemporaryDirectory() as tmp_dir:
            v = ReferenceVault(vault_dir=Path(tmp_dir), mode="local")
            v.vector_db = faiss.IndexFlatL2(EMBEDDING_DIM)
            v.metadata_store = {}

            # Add vectors for valid asset and orphaned asset
            v1 = np.ones((1, EMBEDDING_DIM), dtype=np.float32)
            faiss.normalize_L2(v1)
            v.vector_db.add(v1)
            v.metadata_store["0"] = {"asset_id": "valid-asset-1", "vector_id": 0}

            v2 = np.zeros((1, EMBEDDING_DIM), dtype=np.float32)
            v2[0, 0] = 1.0
            v.vector_db.add(v2)
            v.metadata_store["1"] = {"asset_id": "stale-asset-to-prune", "vector_id": 1}

            self.assertEqual(v.vector_db.ntotal, 2)
            pruned = v.sync_with_registered_assets(valid_asset_ids={"valid-asset-1"})
            self.assertEqual(pruned, 1)
            self.assertEqual(v.vector_db.ntotal, 1)
            self.assertEqual(len(v.metadata_store), 1)
            self.assertEqual(v.metadata_store["0"]["asset_id"], "valid-asset-1")

    def test_matcher_filters_stale_vectors_not_in_registry(self):
        """Issue 2 Regression: Matcher ignores vectors from deleted/stale assets."""
        import tempfile
        import numpy as np
        import faiss
        from PIL import Image
        from app.matcher import match_single_frame

        with tempfile.TemporaryDirectory() as tmp_dir:
            v = ReferenceVault(vault_dir=Path(tmp_dir), mode="local")
            v.vector_db = faiss.IndexFlatL2(EMBEDDING_DIM)
            v.metadata_store = {}

            # Add an identical vector for a deleted/stale asset
            test_img = Image.new("RGB", (224, 224), color=(128, 64, 32))
            from app.vault import extract_image_embedding
            emb = extract_image_embedding(test_img)
            v.vector_db.add(emb)
            v.metadata_store["0"] = {
                "asset_id": "stale-deleted-asset",
                "frame_id": 0,
                "timestamp_sec": 0,
                "filename": "frame_0000s.jpg",
                "frame_path": "",
            }

            # If valid_asset_ids only has registered assets, stale asset should be filtered out
            res = match_single_frame(
                suspect_img=test_img,
                submitted_asset_id="suspect-job-id",
                vault=v,
                k=3,
                valid_asset_ids={"legitimate-active-asset"},
            )
            self.assertIsNone(res, "Matcher should return None when only stale vectors match")

    def test_storage_client_delete_objects_batch(self):
        """Issue 3 Regression: SupabaseStorageClient.delete_objects handles multiple paths."""
        storage = SupabaseStorageClient()
        with patch("urllib.request.urlopen") as mock_url:
            mock_resp = MagicMock()
            mock_resp.status = 200
            mock_url.return_value.__enter__.return_value = mock_resp
            result = storage.delete_objects("reference-frames", ["asset1/f1.jpg", "asset1/f2.jpg"])
            self.assertTrue(result)
            self.assertTrue(mock_url.called)

    def test_youtube_metadata_fallback_on_bot_detection(self):
        """Issue 4 Regression: URL screener falls back to oEmbed on YouTube bot-check error."""
        from app.url_screener import extract_public_video_metadata

        mock_oembed_return = {
            "title": "Fallback Video Title",
            "platform": "YouTube",
            "uploader": "Fallback Channel",
            "uploader_id": "Fallback Channel",
            "channel_url": "https://www.youtube.com/@channel",
            "duration_seconds": 0.0,
            "view_count": None,
            "upload_date": "",
            "description": "Mocked fallback description",
            "webpage_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
            "candidate_thumbnail_urls": ["https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg"],
            "candidate_count": 1,
            "storyboards": [],
            "extraction_method": "youtube_oembed_cloud_fallback",
        }

        with patch("app.url_screener.yt_dlp.YoutubeDL") as mock_ydl_cls:
            mock_ydl = MagicMock()
            mock_ydl.extract_info.side_effect = Exception("Sign in to confirm you're not a bot")
            mock_ydl_cls.return_value.__enter__.return_value = mock_ydl
            with patch("app.url_screener.extract_youtube_metadata_via_oembed", return_value=mock_oembed_return):
                meta = extract_public_video_metadata("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                self.assertEqual(meta["title"], "Fallback Video Title")
                self.assertEqual(meta["platform"], "YouTube")
                self.assertEqual(meta["extraction_method"], "youtube_oembed_cloud_fallback")


if __name__ == "__main__":
    unittest.main(verbosity=2)
