"""
Tests for FixProof Visual Embeddings and FAISS Reference Vault (Milestone 3).
"""

import io
import json
import os
import shutil
import tempfile
import sys
import unittest
from pathlib import Path

# Ensure backend root is on sys.path
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import cv2
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient

from app.main import app, default_vault, STORAGE_DIR, FRAMES_DIR
from app.vault import ReferenceVault, extract_image_embedding, EMBEDDING_DIM


class TestReferenceVault(unittest.TestCase):

    def setUp(self):
        self.temp_vault_dir = Path(tempfile.mkdtemp(prefix="fixproof_vault_test_"))
        self.vault = ReferenceVault(vault_dir=self.temp_vault_dir)
        self.client = TestClient(app)

    def tearDown(self):
        if self.temp_vault_dir.exists():
            shutil.rmtree(self.temp_vault_dir, ignore_errors=True)

    def test_empty_vault_behavior(self):
        """Verify an empty vault initializes safely, reports size 0, and search handles empty index."""
        status = self.vault.get_status()
        self.assertEqual(status["vault_size"], 0)
        self.assertEqual(status["status"], "empty")
        self.assertEqual(status["embedding_dim"], 576)
        self.assertEqual(status["total_indexed_assets"], 0)

        # Search on empty vault should return empty lists without crashing
        dummy_query = np.random.randn(1, EMBEDDING_DIM).astype("float32")
        dists, matches = self.vault.search_nearest(dummy_query, k=3)
        self.assertEqual(dists, [])
        self.assertEqual(matches, [])

    def test_embedding_dimensions_and_l2_normalization(self):
        """Verify MobileNetV3 feature extraction produces a 576-dim L2-normalized vector."""
        sample_img = Image.new("RGB", (320, 240), color=(180, 50, 75))
        embedding = extract_image_embedding(sample_img)

        self.assertEqual(embedding.shape, (1, 576))
        self.assertEqual(embedding.dtype, np.float32)

        # L2 norm of normalized vector must equal 1.0 (within float tolerance)
        norm = np.linalg.norm(embedding)
        self.assertAlmostEqual(norm, 1.0, places=5)

    def test_indexing_and_vector_metadata_alignment(self):
        """Verify multiple frames are added to FAISS and metadata remains synchronized with insertion order."""
        asset_id = "test-asset-align-123"
        frames_dir = self.temp_vault_dir / "test_frames"
        frames_dir.mkdir(parents=True, exist_ok=True)

        # Create 3 distinct test frames
        frame_paths = []
        for i in range(3):
            img_path = frames_dir / f"frame_{i * 5:04d}s.jpg"
            img = Image.new("RGB", (224, 224), color=(i * 60, 100, 200 - i * 50))
            img.save(img_path)
            frame_paths.append(img_path)

        indexed = self.vault.index_asset_frames(asset_id=asset_id, frames_dir=frames_dir)
        self.assertEqual(len(indexed), 3)
        self.assertEqual(self.vault.vector_db.ntotal, 3)

        # Verify strict 1:1 vector ID to metadata key mapping
        for i in range(3):
            meta = self.vault.metadata_store[str(i)]
            self.assertEqual(meta["vector_id"], i)
            self.assertEqual(meta["asset_id"], asset_id)
            self.assertEqual(meta["timestamp_sec"], i * 5)
            self.assertEqual(meta["filename"], f"frame_{i * 5:04d}s.jpg")
            self.assertEqual(meta["frame_path"], str(frame_paths[i]))

        # Verify nearest neighbor search returns the exact matched frame with ~0 distance
        with Image.open(frame_paths[1]) as target_img:
            target_emb = extract_image_embedding(target_img)
        dists, matches = self.vault.search_nearest(target_emb, k=1)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["vector_id"], 1)
        self.assertEqual(matches[0]["timestamp_sec"], 5)
        self.assertAlmostEqual(dists[0], 0.0, places=4)

    def test_vault_persistence_and_reload(self):
        """Verify the FAISS index and metadata persist to disk and reload accurately."""
        asset_id = "persist-asset-456"
        sample_img = Image.new("RGB", (224, 224), color=(40, 180, 90))

        # Index frame and save
        vec_id = self.vault.index_frame(
            image=sample_img,
            asset_id=asset_id,
            frame_id=0,
            timestamp_sec=0,
            frame_path="/tmp/fake_path.jpg",
            filename="fake_path.jpg",
        )
        self.vault.save_vault()

        # Reopen with a fresh ReferenceVault instance pointing to the same folder
        reloaded_vault = ReferenceVault(vault_dir=self.temp_vault_dir)
        self.assertEqual(reloaded_vault.vector_db.ntotal, 1)
        self.assertIn("0", reloaded_vault.metadata_store)
        self.assertEqual(reloaded_vault.metadata_store["0"]["asset_id"], asset_id)

    def test_missing_frame_and_unreadable_file_handling(self):
        """Verify missing or corrupt frame files are skipped without desynchronizing the index."""
        asset_id = "robust-asset-789"
        frames_dir = self.temp_vault_dir / "mixed_frames"
        frames_dir.mkdir(parents=True, exist_ok=True)

        # 1 valid frame
        valid_img_path = frames_dir / "frame_0000s.jpg"
        Image.new("RGB", (224, 224), color=(20, 20, 20)).save(valid_img_path)

        # 1 corrupt frame file (arbitrary bytes)
        corrupt_img_path = frames_dir / "frame_0005s.jpg"
        corrupt_img_path.write_bytes(b"CORRUPT_NOT_IMAGE")

        # Explicit frames list pointing to valid, corrupt, and non-existent files
        frames = [
            {"frame_index": 0, "frame_id": 0, "timestamp_sec": 0, "frame_path": str(valid_img_path), "filename": "frame_0000s.jpg"},
            {"frame_index": 1, "frame_id": 50, "timestamp_sec": 5, "frame_path": str(corrupt_img_path), "filename": "frame_0005s.jpg"},
            {"frame_index": 2, "frame_id": 100, "timestamp_sec": 10, "frame_path": str(frames_dir / "nonexistent.jpg"), "filename": "nonexistent.jpg"},
        ]

        indexed = self.vault.index_asset_frames(asset_id=asset_id, frames=frames, frames_dir=frames_dir)

        # Only the 1 valid frame should be added
        self.assertEqual(len(indexed), 1)
        self.assertEqual(self.vault.vector_db.ntotal, 1)
        self.assertEqual(self.vault.metadata_store["0"]["filename"], "frame_0000s.jpg")

    def test_corrupted_index_file_safe_initialization(self):
        """Verify that a corrupted FAISS index file does not crash and starts a fresh index."""
        corrupt_dir = Path(tempfile.mkdtemp(prefix="corrupt_vault_test_"))
        try:
            index_path = corrupt_dir / "faiss_vault.index"
            index_path.write_bytes(b"NOT_A_FAISS_INDEX_BINARY")

            bad_vault = ReferenceVault(vault_dir=corrupt_dir)
            self.assertEqual(bad_vault.vector_db.ntotal, 0)
            self.assertEqual(bad_vault.vector_db.d, 576)
        finally:
            shutil.rmtree(corrupt_dir, ignore_errors=True)

    def test_api_vault_status_endpoint(self):
        """Verify GET /api/vault/status returns current vault metadata."""
        response = self.client.get("/api/vault/status")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("vault_size", data)
        self.assertIn("status", data)
        self.assertEqual(data["embedding_dim"], 576)

    def test_api_index_existing_asset_endpoint(self):
        """Verify POST /api/vault/index/{asset_id} indexes existing frames and handles missing assets."""
        # Test 404 for non-existent asset
        bad_res = self.client.post("/api/vault/index/non-existent-asset-999")
        self.assertEqual(bad_res.status_code, 404)

        # Create temporary asset frames in global storage
        test_asset_id = "api-index-test-asset"
        asset_dir = FRAMES_DIR / test_asset_id
        asset_dir.mkdir(parents=True, exist_ok=True)
        try:
            img_path = asset_dir / "frame_0000s.jpg"
            Image.new("RGB", (224, 224), color=(120, 80, 40)).save(img_path)

            initial_size = default_vault.vector_db.ntotal
            res = self.client.post(f"/api/vault/index/{test_asset_id}")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["status"], "indexed")
            self.assertEqual(data["asset_id"], test_asset_id)
            self.assertGreaterEqual(data["frames_indexed"], 1)
            self.assertEqual(data["vault_size"], initial_size + 1)
        finally:
            if asset_dir.exists():
                shutil.rmtree(asset_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
