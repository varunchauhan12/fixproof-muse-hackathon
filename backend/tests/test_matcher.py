"""
Tests for FixProof Sentinel-Style Visual Matching and Perceptual Hashing (Milestone 4).
"""

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

# Ensure backend root is on sys.path
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Prevent OpenMP duplicate runtime abort on macOS between PyTorch and FAISS
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from PIL import Image
from fastapi.testclient import TestClient

from app.main import app, FRAMES_DIR
from app.vault import ReferenceVault
from app.matcher import (
    analyze_asset_matches,
    compute_phash_evidence,
    l2_to_confidence,
    severity_from_confidence,
    MATCH_THRESHOLD,
    SUSPECT_THRESHOLD,
)


class TestVisualMatcher(unittest.TestCase):

    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="fixproof_matcher_test_"))
        self.vault_dir = self.temp_dir / "vault"
        self.vault = ReferenceVault(vault_dir=self.vault_dir)
        self.frames_dir = self.temp_dir / "frames"
        self.frames_dir.mkdir(parents=True, exist_ok=True)
        self.client = TestClient(app)

    def tearDown(self):
        if self.temp_dir.exists():
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_l2_confidence_and_severity(self):
        """Verify L2 distance to confidence percentage and severity mapping."""
        self.assertEqual(l2_to_confidence(0.0), 100.0)
        self.assertEqual(l2_to_confidence(2.0), 0.0)
        self.assertEqual(l2_to_confidence(1.0), 50.0)

        self.assertEqual(severity_from_confidence(90.0), "CRITICAL")
        self.assertEqual(severity_from_confidence(70.0), "WARNING")
        self.assertEqual(severity_from_confidence(40.0), "INFO")

    def test_empty_vault_handling(self):
        """Verify analyzing an asset against an empty vault returns NO_REFERENCE_DATA safely."""
        asset_id = "suspect-empty-test"
        asset_frames = self.frames_dir / asset_id
        asset_frames.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (224, 224), color=(50, 100, 150)).save(asset_frames / "frame_0000s.jpg")

        result = analyze_asset_matches(
            submitted_asset_id=asset_id,
            frames_dir=asset_frames,
            vault=self.vault,
        )

        self.assertEqual(result["overall_status"], "NO_REFERENCE_DATA")
        self.assertEqual(result["candidate_matches_found"], 0)
        self.assertEqual(result["highest_confidence"], 0.0)
        self.assertIsNone(result["lowest_l2_distance"])
        self.assertIn("Candidate visual similarity", result["disclaimer"])

    def test_exact_copied_frame_matching(self):
        """
        Verify exact copied frame produces a confirmed candidate match (L2 < 0.05,
        confidence > 97%, and pHash match confirmed).
        """
        ref_asset_id = "ref-broadcast-001"
        suspect_asset_id = "suspect-clip-002"

        # 1. Create reference asset and index into vault
        ref_frames_dir = self.frames_dir / ref_asset_id
        ref_frames_dir.mkdir(parents=True, exist_ok=True)
        img_pattern = Image.new("RGB", (224, 224), color=(30, 140, 210))
        img_pattern.save(ref_frames_dir / "frame_0005s.jpg")

        self.vault.index_asset_frames(asset_id=ref_asset_id, frames_dir=ref_frames_dir)
        self.assertEqual(self.vault.vector_db.ntotal, 1)

        # 2. Create suspect asset with the identical frame (e.g. at timestamp 10s)
        suspect_frames_dir = self.frames_dir / suspect_asset_id
        suspect_frames_dir.mkdir(parents=True, exist_ok=True)
        img_pattern.save(suspect_frames_dir / "frame_0010s.jpg")

        # 3. Match suspect against reference vault
        result = analyze_asset_matches(
            submitted_asset_id=suspect_asset_id,
            frames_dir=suspect_frames_dir,
            vault=self.vault,
        )

        self.assertEqual(result["overall_status"], "CANDIDATE_MATCH")
        self.assertEqual(result["candidate_matches_found"], 1)
        self.assertGreater(result["highest_confidence"], 97.0)
        self.assertLess(result["lowest_l2_distance"], 0.05)
        self.assertIn(ref_asset_id, result["matched_assets"])

        # Verify frame level details
        frame_match = result["frame_matches"][0]
        self.assertEqual(frame_match["submitted_frame"]["timestamp_sec"], 10)
        best = frame_match["best_match"]
        self.assertEqual(best["source_asset_id"], ref_asset_id)
        self.assertEqual(best["source_timestamp_sec"], 5)
        self.assertTrue(best["match_confirmed"])
        self.assertTrue(best["phash_match"])
        self.assertEqual(best["phash_score"], 100)

    def test_different_frames_no_match(self):
        """Verify completely different imagery returns CLEAN with no confirmed candidate matches."""
        ref_asset_id = "ref-game-sports"
        suspect_asset_id = "suspect-nature-doc"

        from PIL import ImageDraw

        # Reference: High-contrast horizontal stripes
        ref_frames_dir = self.frames_dir / ref_asset_id
        ref_frames_dir.mkdir(parents=True, exist_ok=True)
        img_stripes = Image.new("RGB", (224, 224), "white")
        drawA = ImageDraw.Draw(img_stripes)
        for y in range(0, 224, 20):
            drawA.rectangle([0, y, 224, y + 10], fill="black")
        img_stripes.save(ref_frames_dir / "frame_0000s.jpg")
        self.vault.index_asset_frames(asset_id=ref_asset_id, frames_dir=ref_frames_dir)

        # Suspect: Central circle pattern
        suspect_frames_dir = self.frames_dir / suspect_asset_id
        suspect_frames_dir.mkdir(parents=True, exist_ok=True)
        img_circle = Image.new("RGB", (224, 224), "white")
        drawC = ImageDraw.Draw(img_circle)
        drawC.ellipse([20, 20, 200, 200], fill="black")
        img_circle.save(suspect_frames_dir / "frame_0000s.jpg")

        result = analyze_asset_matches(
            submitted_asset_id=suspect_asset_id,
            frames_dir=suspect_frames_dir,
            vault=self.vault,
        )

        self.assertEqual(result["overall_status"], "CLEAN")
        self.assertEqual(result["candidate_matches_found"], 0)
        self.assertGreater(result["lowest_l2_distance"], SUSPECT_THRESHOLD)
        self.assertFalse(result["frame_matches"][0]["best_match"]["match_confirmed"])


    def test_self_matching_prevention(self):
        """
        Verify that an asset already indexed in the vault is NEVER matched against itself.
        """
        asset_id = "self-match-test-asset"
        asset_frames = self.frames_dir / asset_id
        asset_frames.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (224, 224), color=(100, 100, 100)).save(asset_frames / "frame_0000s.jpg")

        # Index the asset into the vault
        self.vault.index_asset_frames(asset_id=asset_id, frames_dir=asset_frames)
        self.assertEqual(self.vault.vector_db.ntotal, 1)

        # Attempt to match this asset against the vault
        result = analyze_asset_matches(
            submitted_asset_id=asset_id,
            frames_dir=asset_frames,
            vault=self.vault,
        )

        # Because the vault only contains this asset, it should report NO_REFERENCE_DATA
        self.assertEqual(result["overall_status"], "NO_REFERENCE_DATA")
        self.assertEqual(result["candidate_matches_found"], 0)
        self.assertEqual(result["matched_assets"], [])

    def test_api_matches_endpoint_integration(self):
        """Verify POST /api/matches/{asset_id} handles 404 for missing assets and 200 for valid assets."""
        # 404 for missing asset
        r404 = self.client.post("/api/matches/non-existent-asset-999")
        self.assertEqual(r404.status_code, 404)

        # Create asset in global storage
        test_id = "api-matcher-test-asset"
        test_dir = FRAMES_DIR / test_id
        test_dir.mkdir(parents=True, exist_ok=True)
        try:
            Image.new("RGB", (224, 224), color=(60, 120, 180)).save(test_dir / "frame_0000s.jpg")

            res = self.client.post(f"/api/matches/{test_id}")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["submitted_asset_id"], test_id)
            self.assertIn("overall_status", data)
            self.assertIn("frame_matches", data)
            self.assertIn("disclaimer", data)
        finally:
            if test_dir.exists():
                shutil.rmtree(test_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
