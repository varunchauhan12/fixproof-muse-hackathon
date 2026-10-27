"""
Tests for FixProof Milestone 5: Real Asset Vault, API Endpoints, and Media Serving.
"""

import io
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from PIL import Image
from fastapi.testclient import TestClient

from app.main import app, STORAGE_DIR, FRAMES_DIR, default_vault
from app.registry import list_registered_assets, get_asset_detail


class TestAssetVaultEndpoints(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)
        self.test_asset_id = "test-vault-asset-999"
        self.test_frames_dir = FRAMES_DIR / self.test_asset_id
        self.test_frames_dir.mkdir(parents=True, exist_ok=True)

        # Create two sample extracted frames
        img0 = Image.new("RGB", (224, 224), color=(100, 150, 200))
        img0.save(self.test_frames_dir / "frame_0000s.jpg")

        img5 = Image.new("RGB", (224, 224), color=(120, 160, 210))
        img5.save(self.test_frames_dir / "frame_0005s.jpg")

        # Create sample video file
        self.test_video_path = STORAGE_DIR / f"{self.test_asset_id}.mp4"
        self.test_video_path.write_bytes(b"FAKE_MP4_CONTENT_FOR_STREAM_TEST")

    def tearDown(self):
        if self.test_frames_dir.exists():
            shutil.rmtree(self.test_frames_dir, ignore_errors=True)
        if self.test_video_path.exists():
            self.test_video_path.unlink(missing_ok=True)
        # Clean up any vectors inserted for test asset
        default_vault.remove_asset_vectors(self.test_asset_id)

    def test_list_registered_assets(self):
        """Verify GET /api/vault/assets returns all registered assets with live status."""
        res = self.client.get("/api/vault/assets")
        self.assertEqual(res.status_code, 200)
        assets = res.json()
        self.assertIsInstance(assets, list)

        # Find our test asset
        found = next((a for a in assets if a["asset_id"] == self.test_asset_id), None)
        self.assertIsNotNone(found)
        self.assertEqual(found["frame_count"], 2)
        self.assertFalse(found["indexed"])
        self.assertEqual(found["indexed_vectors"], 0)
        self.assertIn("video_url", found)
        self.assertIn("thumbnail_url", found)

    def test_get_single_asset_detail(self):
        """Verify GET /api/vault/assets/{asset_id} returns asset details and handles 404/400."""
        # Valid asset
        res = self.client.get(f"/api/vault/assets/{self.test_asset_id}")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["asset_id"], self.test_asset_id)
        self.assertEqual(len(data["frames"]), 2)

        # Non-existent asset
        res404 = self.client.get("/api/vault/assets/non-existent-asset-000")
        self.assertEqual(res404.status_code, 404)

        # Path traversal / invalid ID format
        res400 = self.client.get("/api/vault/assets/../../etc/passwd")
        self.assertIn(res400.status_code, (400, 404))

    def test_safe_frame_streaming_and_path_traversal_protection(self):
        """Verify safe frame streaming and strict containment checks."""
        # 1. Valid frame
        res = self.client.get(f"/api/vault/assets/{self.test_asset_id}/frames/frame_0000s.jpg")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get("content-type"), "image/jpeg")
        self.assertGreater(len(res.content), 0)

        # 2. Non-existent frame
        res404 = self.client.get(f"/api/vault/assets/{self.test_asset_id}/frames/frame_9999s.jpg")
        self.assertEqual(res404.status_code, 404)

        # 3. Path traversal in frame filename
        res_trav = self.client.get(f"/api/vault/assets/{self.test_asset_id}/frames/..%2F..%2Fmain.py")
        self.assertIn(res_trav.status_code, (400, 404))

        # 4. Invalid extension (e.g. .exe, .sh)
        res_bad_ext = self.client.get(f"/api/vault/assets/{self.test_asset_id}/frames/secret.sh")
        self.assertEqual(res_bad_ext.status_code, 400)

    def test_safe_video_streaming(self):
        """Verify safe video streaming from storage."""
        res = self.client.get(f"/api/vault/assets/{self.test_asset_id}/video")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.content, b"FAKE_MP4_CONTENT_FOR_STREAM_TEST")
        self.assertIn("video", res.headers.get("content-type", ""))

        # Non-existent video
        res404 = self.client.get("/api/vault/assets/non-existent-video-asset/video")
        self.assertEqual(res404.status_code, 404)

    def test_index_and_unindex_lifecycle(self):
        """Verify asset status flips to indexed=True after POST /api/vault/index/{asset_id}."""
        # Initially unindexed
        detail = get_asset_detail(self.test_asset_id, default_vault)
        self.assertFalse(detail["indexed"])
        self.assertEqual(detail["indexed_vectors"], 0)

        # Index asset
        index_res = self.client.post(f"/api/vault/index/{self.test_asset_id}")
        self.assertEqual(index_res.status_code, 200)
        self.assertEqual(index_res.json()["status"], "indexed")
        self.assertEqual(index_res.json()["frames_indexed"], 2)

        # Confirm status reflected in asset list
        detail_after = get_asset_detail(self.test_asset_id, default_vault)
        self.assertTrue(detail_after["indexed"])
        self.assertEqual(detail_after["indexed_vectors"], 2)

        # Check /api/vault/status includes updated totals
        status_res = self.client.get("/api/vault/status")
        self.assertGreaterEqual(status_res.json()["total_protected_assets"], 1)

    def test_delete_asset_endpoint(self):
        """Verify DELETE /api/vault/assets/{asset_id} deletes asset and un-indexes vectors."""
        # Index first
        self.client.post(f"/api/vault/index/{self.test_asset_id}")

        # Delete
        del_res = self.client.delete(f"/api/vault/assets/{self.test_asset_id}")
        self.assertEqual(del_res.status_code, 200)
        self.assertEqual(del_res.json()["status"], "deleted")

        # Confirm 404 on subsequent get
        get_res = self.client.get(f"/api/vault/assets/{self.test_asset_id}")
        self.assertEqual(get_res.status_code, 404)


if __name__ == "__main__":
    unittest.main()
