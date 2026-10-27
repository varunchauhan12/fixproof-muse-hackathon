"""
Tests for FixProof Visual Matching, Calibrated Similarity, and Perceptual Hashing (Phase 2.2).
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

from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

from app.main import app, FRAMES_DIR
from app.vault import ReferenceVault
from app.matcher import (
    analyze_asset_matches,
    compute_image_entropy,
    compute_phash_evidence,
    l2_to_confidence,
    l2_to_visual_similarity,
    severity_from_confidence,
    MATCH_THRESHOLD,
    SUSPECT_THRESHOLD,
    MIN_IMAGE_ENTROPY,
    SCORE_VERSION,
    VISUAL_SIMILARITY_NOTICE,
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

    def test_l2_visual_similarity_and_severity(self):
        """Verify L2 distance to visual similarity percentage and severity mapping."""
        # Exact match
        self.assertEqual(l2_to_visual_similarity(0.0), 100.0)
        # Threshold boundary
        self.assertEqual(l2_to_visual_similarity(0.55), 80.0)
        self.assertEqual(l2_to_visual_similarity(0.75), 50.0)
        # Distance 1.0 (unrelated images) must be near noise floor, NEVER misleading ~50%
        sim_at_1 = l2_to_visual_similarity(1.0)
        self.assertLess(sim_at_1, 20.0)
        self.assertGreater(sim_at_1, 5.0)
        # Beyond orthogonal noise floor
        self.assertEqual(l2_to_visual_similarity(1.5), 0.0)
        self.assertEqual(l2_to_visual_similarity(2.0), 0.0)

        # Legacy alias produces identical result
        self.assertEqual(l2_to_confidence(0.55), 80.0)

        # Severity classifications
        self.assertEqual(severity_from_confidence(85.0), "CRITICAL")
        self.assertEqual(severity_from_confidence(55.0), "WARNING")
        self.assertEqual(severity_from_confidence(30.0), "INFO")

    def test_image_entropy_computation(self):
        """Verify Shannon entropy flags solid black/white images while keeping complex imagery."""
        black_img = Image.new("RGB", (100, 100), (0, 0, 0))
        white_img = Image.new("RGB", (100, 100), (255, 255, 255))
        self.assertEqual(compute_image_entropy(black_img), 0.0)
        self.assertEqual(compute_image_entropy(white_img), 0.0)
        self.assertLess(compute_image_entropy(black_img), MIN_IMAGE_ENTROPY)

        # Natural pattern image has high entropy
        pattern_img = Image.new("RGB", (100, 100), "white")
        draw = ImageDraw.Draw(pattern_img)
        for i in range(10):
            draw.rectangle([i * 10, 0, i * 10 + 5, 100], fill=(i * 25, 100, 200 - i * 15))
        entropy = compute_image_entropy(pattern_img)
        self.assertGreater(entropy, MIN_IMAGE_ENTROPY)

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
            run_vision_verification=False,
        )

        self.assertEqual(result["overall_status"], "NO_REFERENCE_DATA")
        self.assertEqual(result["candidate_matches_found"], 0)
        self.assertEqual(result["highest_confidence"], 0.0)
        self.assertIsNone(result["lowest_l2_distance"])
        self.assertIn("Candidate visual similarity", result["disclaimer"])
        self.assertEqual(result["score_version"], SCORE_VERSION)

    def test_exact_copied_frame_matching(self):
        """
        Verify exact copied frame produces a confirmed candidate match (L2 < 0.05,
        visual similarity > 95%, and pHash match confirmed).
        """
        ref_asset_id = "ref-broadcast-001"
        suspect_asset_id = "suspect-clip-002"

        # 1. Create reference asset and index into vault
        ref_frames_dir = self.frames_dir / ref_asset_id
        ref_frames_dir.mkdir(parents=True, exist_ok=True)
        img_pattern = Image.new("RGB", (224, 224), color=(30, 140, 210))
        draw = ImageDraw.Draw(img_pattern)
        draw.rectangle([20, 20, 200, 100], fill=(255, 100, 50))
        draw.ellipse([40, 40, 180, 180], fill=(50, 255, 120))
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
            run_vision_verification=False,
        )

        self.assertEqual(result["overall_status"], "CANDIDATE_MATCH")
        self.assertEqual(result["candidate_matches_found"], 1)
        self.assertGreater(result["highest_confidence"], 95.0)
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
        self.assertEqual(best["score_calibration_notice"], VISUAL_SIMILARITY_NOTICE)

    def test_different_frames_no_match(self):
        """Verify completely different imagery returns CLEAN with no confirmed candidate matches."""
        ref_asset_id = "ref-game-sports"
        suspect_asset_id = "suspect-nature-doc"

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
            run_vision_verification=False,
        )

        self.assertEqual(result["overall_status"], "CLEAN")
        self.assertEqual(result["candidate_matches_found"], 0)
        self.assertGreater(result["lowest_l2_distance"], SUSPECT_THRESHOLD)
        self.assertFalse(result["frame_matches"][0]["best_match"]["match_confirmed"])
        # Score must be low (near noise floor)
        self.assertLess(result["highest_confidence"], 35.0)

    def test_self_matching_prevention(self):
        """Verify that an asset already indexed in the vault is NEVER matched against itself."""
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
            run_vision_verification=False,
        )

        # Because the vault only contains this asset, it should report NO_REFERENCE_DATA
        self.assertEqual(result["overall_status"], "NO_REFERENCE_DATA")
        self.assertEqual(result["candidate_matches_found"], 0)
        self.assertEqual(result["matched_assets"], [])

    def test_low_entropy_solid_frames_flagged(self):
        """Verify that solid blank/black/white frames are flagged as low_entropy and not confirmed."""
        ref_asset_id = "ref-solid-asset"
        suspect_asset_id = "suspect-solid-asset"

        ref_dir = self.frames_dir / ref_asset_id
        ref_dir.mkdir(parents=True, exist_ok=True)
        # Solid black
        black = Image.new("RGB", (224, 224), (0, 0, 0))
        black.save(ref_dir / "frame_0000s.jpg")
        self.vault.index_asset_frames(asset_id=ref_asset_id, frames_dir=ref_dir)

        suspect_dir = self.frames_dir / suspect_asset_id
        suspect_dir.mkdir(parents=True, exist_ok=True)
        black.save(suspect_dir / "frame_0000s.jpg")

        result = analyze_asset_matches(
            submitted_asset_id=suspect_asset_id,
            frames_dir=suspect_dir,
            vault=self.vault,
            run_vision_verification=False,
        )

        # Even though distance is near 0, low-entropy frames must NOT be confirmed matches
        self.assertFalse(result["frame_matches"][0]["best_match"]["match_confirmed"])
        self.assertTrue(result["frame_matches"][0]["best_match"]["low_entropy_flag"])


if __name__ == "__main__":
    unittest.main()
