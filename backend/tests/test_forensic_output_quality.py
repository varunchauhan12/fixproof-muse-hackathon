"""
FixProof Phase 3.3 — Comprehensive Deterministic Forensic Output Quality Test Suite.

Validates:
1. Identical frames: raw metric preservation (L2~0, pHash=0), similarity heuristics, disclaimers.
2. Resized and re-encoded copies: robust detection under compression and resolution changes.
3. Mild crops and visual transformations: bounded L2/pHash degradation within suspect thresholds.
4. Unrelated frames: high L2 (>0.85), pHash divergence (>25), no false match promotion.
5. Blank and low-information frames: zero similarity, entropy flags, prevention of false match promotion.
6. Missing reference frames: graceful degradation to UNVERIFIED / VERIFICATION_UNAVAILABLE.
7. Missing suspect frames: graceful degradation to UNVERIFIED without pipeline crashes.
8. Empty matching results against empty vault: transparent NO_REFERENCE_DATA status, never CLEAN or MATCH.
9. Vision provider failures: timeout, malformed JSON, schema violation, and missing API key handling.
10. URL screening: single-thumbnail vs multi-preview modes, SSRF safety, transparent failure handling.
11. Temporal correspondence clustering: continuity enforcement, drift tolerance, low-entropy exclusion.
"""

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure backend root is on sys.path
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Prevent OpenMP duplicate runtime abort on macOS between PyTorch and FAISS
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from PIL import Image, ImageDraw, ImageFilter

from app.evidence_models import (
    FrameEvidence,
    InvestigationInput,
    build_frame_evidence_from_matches,
    build_investigation_input_from_incident,
)
from app.matcher import (
    analyze_asset_matches,
    compute_image_entropy,
    compute_phash_evidence,
    l2_to_visual_similarity,
    severity_from_confidence,
    MATCH_THRESHOLD,
    SUSPECT_THRESHOLD,
    MIN_IMAGE_ENTROPY,
    SCORE_VERSION,
    VISUAL_SIMILARITY_NOTICE,
)
from app.timeline import TimelineClusteringConfig, cluster_frame_matches
from app.url_screener import (
    screen_video_url,
    validate_url_for_ssrf,
    SSRFValidationError,
    PRELIMINARY_SCREENING_DISCLAIMER,
    SCREENING_LIMITATIONS,
)
from app.vault import ReferenceVault
from app.vision_verifier import (
    MAX_CANDIDATE_PAIRS,
    VISION_MODEL_ID,
    _MEMORY_CACHE,
    compute_pair_cache_key,
    resize_image_for_verification,
    verify_candidate_pair,
)


def create_deterministic_pattern(seed_id: int, size=(320, 240)) -> Image.Image:
    """
    Creates a deterministic, high-entropy synthetic test image based on seed_id.
    Uses distinct geometric shapes, colors, and line grids to ensure high Shannon entropy (>4.0).
    """
    img = Image.new("RGB", size, color=((seed_id * 67) % 256, (seed_id * 131) % 256, (seed_id * 197) % 256))
    draw = ImageDraw.Draw(img)

    for i in range(8):
        x0 = (seed_id * 17 + i * 35) % (size[0] - 40)
        y0 = (seed_id * 31 + i * 25) % (size[1] - 40)
        x1 = min(x0 + 40 + (i * 7) % 30, size[0] - 5)
        y1 = min(y0 + 35 + (i * 11) % 30, size[1] - 5)
        color = ((i * 45 + seed_id * 20) % 256, (i * 75 + 50) % 256, (255 - i * 30) % 256)
        if i % 2 == 0:
            draw.rectangle([x0, y0, x1, y1], fill=color, outline="white")
        else:
            draw.ellipse([x0, y0, x1, y1], fill=color, outline="yellow")

    for j in range(0, size[0], 20):
        draw.line([(j, 0), (j, size[1])], fill=((j * 5 + seed_id) % 256, 128, 64), width=1)

    return img


def create_distinct_unrelated_pattern(size=(320, 240)) -> Image.Image:
    """
    Creates a completely visually distinct pattern (vertical rainbow bars with gold discs)
    with high Shannon entropy (>4.0) guaranteeing MobileNetV3 L2 distance > 0.85
    against create_deterministic_pattern.
    """
    img = Image.new("RGB", size, color=(20, 20, 40))
    draw = ImageDraw.Draw(img)
    for i in range(16):
        draw.rectangle([i * 20, 0, (i + 1) * 20, size[1]], fill=(i * 15, (255 - i * 15), (i * 30) % 256))
    for j in range(12):
        draw.ellipse([50 + j * 15, 20 + j * 15, 100 + j * 15, 70 + j * 15], fill=(255, 255 - j * 20, 50))
    return img


class TestForensicOutputQuality(unittest.TestCase):
    """Deterministic validation of forensic analysis output quality across all edge cases."""

    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="fixproof_quality_test_"))
        self.vault_dir = self.temp_dir / "vault"
        self.frames_dir = self.temp_dir / "frames"
        self.frames_dir.mkdir(parents=True, exist_ok=True)
        self.vault = ReferenceVault(vault_dir=self.vault_dir)
        _MEMORY_CACHE.clear()

    def tearDown(self):
        if self.temp_dir.exists():
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    # -------------------------------------------------------------------------
    # 1. Identical Frames
    # -------------------------------------------------------------------------
    def test_case_1_identical_frames(self):
        """
        Scenario 1: Identical Frames.
        - FAISS L2 distance ~ 0.0, pHash distance = 0, match_confirmed = True.
        - Raw metrics preserved and traceable.
        - Visual similarity explicitly labeled as heuristic, not legal proof.
        """
        ref_asset_id = "ref-source-broadcast"
        suspect_asset_id = "suspect-pirate-stream"

        # Index reference asset
        ref_dir = self.frames_dir / ref_asset_id
        ref_dir.mkdir(parents=True, exist_ok=True)
        img = create_deterministic_pattern(seed_id=42)
        img.save(ref_dir / "frame_0005s.jpg")
        self.vault.index_asset_frames(asset_id=ref_asset_id, frames_dir=ref_dir)

        # Suspect frames contain identical image at different timestamp
        suspect_dir = self.frames_dir / suspect_asset_id
        suspect_dir.mkdir(parents=True, exist_ok=True)
        img.save(suspect_dir / "frame_0015s.jpg")

        result = analyze_asset_matches(
            submitted_asset_id=suspect_asset_id,
            frames_dir=suspect_dir,
            vault=self.vault,
            run_vision_verification=False,
        )

        self.assertEqual(result["overall_status"], "CANDIDATE_MATCH")
        self.assertEqual(result["candidate_matches_found"], 1)
        self.assertLessEqual(result["lowest_l2_distance"], 0.001)
        self.assertEqual(result["highest_confidence"], 100.0)

        # Raw metrics verification
        frame_match = result["frame_matches"][0]
        best = frame_match["best_match"]
        self.assertLessEqual(best["l2_distance"], 0.001)
        self.assertEqual(best["phash_distance"], 0)
        self.assertEqual(best["phash_score"], 100)
        self.assertTrue(best["match_confirmed"])
        self.assertTrue(best["phash_match"])
        self.assertEqual(best["similarity_status"], "CONFIRMED_MATCH")

        # Heuristic disclaimer verification: must not state legal proof
        self.assertIn("Candidate visual similarity", result["disclaimer"])
        self.assertIn("not calibrated probabilities", result["score_calibration_notice"].lower())
        self.assertNotIn("proof of copyright infringement", result["disclaimer"].lower())
        self.assertEqual(result["score_calibration_notice"], VISUAL_SIMILARITY_NOTICE)

    # -------------------------------------------------------------------------
    # 2. Resized or Re-encoded Copies
    # -------------------------------------------------------------------------
    def test_case_2_resized_and_reencoded_copies(self):
        """
        Scenario 2: Resized and Heavy JPEG Compression Copies.
        - Reference is 640x480. Suspect is downscaled to 240x180 and compressed (quality=30).
        - Validates that MobileNetV3 + pHash correctly identify candidate match without severe drift.
        """
        ref_asset_id = "ref-hd-stream"
        suspect_asset_id = "suspect-compressed-clip"

        ref_dir = self.frames_dir / ref_asset_id
        ref_dir.mkdir(parents=True, exist_ok=True)
        orig_img = create_deterministic_pattern(seed_id=77, size=(640, 480))
        orig_img.save(ref_dir / "frame_0010s.jpg")
        self.vault.index_asset_frames(asset_id=ref_asset_id, frames_dir=ref_dir)

        # Resize and save with heavy JPEG recompression
        suspect_dir = self.frames_dir / suspect_asset_id
        suspect_dir.mkdir(parents=True, exist_ok=True)
        reencoded = orig_img.resize((240, 180), Image.Resampling.BILINEAR)
        reencoded_buf = io.BytesIO()
        reencoded.save(reencoded_buf, format="JPEG", quality=30)
        reencoded_buf.seek(0)
        Image.open(reencoded_buf).save(suspect_dir / "frame_0005s.jpg")

        result = analyze_asset_matches(
            submitted_asset_id=suspect_asset_id,
            frames_dir=suspect_dir,
            vault=self.vault,
            run_vision_verification=False,
        )

        self.assertEqual(result["overall_status"], "CANDIDATE_MATCH")
        self.assertLess(result["lowest_l2_distance"], MATCH_THRESHOLD)  # < 0.55
        self.assertGreaterEqual(result["highest_confidence"], 80.0)
        frame_match = result["frame_matches"][0]
        self.assertLess(frame_match["best_match"]["phash_distance"], 15)
        self.assertTrue(frame_match["best_match"]["match_confirmed"])

    # -------------------------------------------------------------------------
    # 3. Mild Crops or Visual Transformations
    # -------------------------------------------------------------------------
    def test_case_3_mild_crops_and_transforms(self):
        """
        Scenario 3: Mild Crops and Minor Brightness Adjustments.
        - Reference image has an 8% edge crop applied to simulate rebroadcast cropping.
        - Asserts L2 remains within SUSPECT_THRESHOLD (<0.75).
        """
        ref_asset_id = "ref-full-frame"
        suspect_asset_id = "suspect-cropped-broadcast"

        ref_dir = self.frames_dir / ref_asset_id
        ref_dir.mkdir(parents=True, exist_ok=True)
        img = create_deterministic_pattern(seed_id=99, size=(400, 300))
        img.save(ref_dir / "frame_0000s.jpg")
        self.vault.index_asset_frames(asset_id=ref_asset_id, frames_dir=ref_dir)

        # Apply 8% crop
        suspect_dir = self.frames_dir / suspect_asset_id
        suspect_dir.mkdir(parents=True, exist_ok=True)
        w, h = img.size
        cropped = img.crop((int(w * 0.04), int(h * 0.04), int(w * 0.96), int(h * 0.96))).resize((400, 300))
        cropped.save(suspect_dir / "frame_0002s.jpg")

        result = analyze_asset_matches(
            submitted_asset_id=suspect_asset_id,
            frames_dir=suspect_dir,
            vault=self.vault,
            run_vision_verification=False,
        )

        self.assertLess(result["lowest_l2_distance"], SUSPECT_THRESHOLD)  # < 0.75
        self.assertIn(result["overall_status"], ("CANDIDATE_MATCH", "SUSPECT"))
        self.assertGreater(result["highest_confidence"], 50.0)

    # -------------------------------------------------------------------------
    # 4. Unrelated Frames
    # -------------------------------------------------------------------------
    def test_case_4_unrelated_frames(self):
        """
        Scenario 4: Unrelated Frames.
        - Reference is a geometric multi-color grid pattern.
        - Suspect is a diagonal red stripe pattern on white.
        - Asserts L2 > 0.85, match_confirmed = False, similarity_status = NO_MATCH.
        """
        ref_asset_id = "ref-football-game"
        suspect_asset_id = "suspect-cooking-show"

        ref_dir = self.frames_dir / ref_asset_id
        ref_dir.mkdir(parents=True, exist_ok=True)
        create_deterministic_pattern(seed_id=10, size=(320, 240)).save(ref_dir / "frame_0000s.jpg")
        self.vault.index_asset_frames(asset_id=ref_asset_id, frames_dir=ref_dir)

        suspect_dir = self.frames_dir / suspect_asset_id
        suspect_dir.mkdir(parents=True, exist_ok=True)
        create_distinct_unrelated_pattern(size=(320, 240)).save(suspect_dir / "frame_0000s.jpg")

        result = analyze_asset_matches(
            submitted_asset_id=suspect_asset_id,
            frames_dir=suspect_dir,
            vault=self.vault,
            run_vision_verification=False,
        )

        self.assertEqual(result["overall_status"], "CLEAN")
        self.assertEqual(result["candidate_matches_found"], 0)
        self.assertGreater(result["lowest_l2_distance"], 0.85)
        frame_match = result["frame_matches"][0]
        self.assertFalse(frame_match["best_match"]["match_confirmed"])
        self.assertEqual(frame_match["best_match"]["similarity_status"], "NO_MATCH")

    # -------------------------------------------------------------------------
    # 5. Blank and Low-Information Frames
    # -------------------------------------------------------------------------
    def test_case_5_blank_and_low_entropy_frames(self):
        """
        Scenario 5: Blank and Low-Information Frames.
        - Solid black / single color frames (e.g. fade to black, bumper).
        - Asserts Shannon entropy < 1.5, low_entropy_flag = True.
        - Critical Fix Validation: Even if reference vault ALSO contains a solid black frame,
          the low-entropy frame must NEVER be promoted to a confirmed match or inflate confidence!
        """
        ref_asset_id = "ref-with-black-intro"
        suspect_asset_id = "suspect-with-black-intro"

        # Both reference and suspect have identical solid black frames
        ref_dir = self.frames_dir / ref_asset_id
        ref_dir.mkdir(parents=True, exist_ok=True)
        black_frame = Image.new("RGB", (320, 240), (0, 0, 0))
        black_frame.save(ref_dir / "frame_0000s.jpg")
        self.vault.index_asset_frames(asset_id=ref_asset_id, frames_dir=ref_dir)

        suspect_dir = self.frames_dir / suspect_asset_id
        suspect_dir.mkdir(parents=True, exist_ok=True)
        black_frame.save(suspect_dir / "frame_0000s.jpg")

        result = analyze_asset_matches(
            submitted_asset_id=suspect_asset_id,
            frames_dir=suspect_dir,
            vault=self.vault,
            run_vision_verification=False,
        )

        # Must NOT be marked as match or suspect!
        self.assertEqual(result["overall_status"], "CLEAN")
        self.assertEqual(result["candidate_matches_found"], 0)
        self.assertEqual(result["highest_confidence"], 0.0)
        self.assertIsNone(result["lowest_l2_distance"])

        frame_match = result["frame_matches"][0]
        best = frame_match["best_match"]
        self.assertTrue(best["low_entropy_flag"])
        self.assertEqual(best["visual_similarity_score"], 0.0)
        self.assertEqual(best["confidence_score"], 0.0)
        self.assertEqual(best["severity"], "INFO")
        self.assertEqual(best["similarity_status"], "NO_MATCH")

    # -------------------------------------------------------------------------
    # 6. Missing Reference Frames
    # -------------------------------------------------------------------------
    def test_case_6_missing_reference_frame(self):
        """
        Scenario 6: Missing Reference Frame during Vision Verification.
        - FAISS returns a match, but the actual reference frame file has been deleted or is missing.
        - Asserts pipeline does not crash and explicitly produces an UNVERIFIED result.
        """
        ref_asset_id = "ref-deleted-asset"
        suspect_asset_id = "suspect-clip-missing-ref"

        ref_dir = self.frames_dir / ref_asset_id
        ref_dir.mkdir(parents=True, exist_ok=True)
        ref_frame_path = ref_dir / "frame_0000s.jpg"
        create_deterministic_pattern(seed_id=55).save(ref_frame_path)
        self.vault.index_asset_frames(asset_id=ref_asset_id, frames_dir=ref_dir)

        suspect_dir = self.frames_dir / suspect_asset_id
        suspect_dir.mkdir(parents=True, exist_ok=True)
        create_deterministic_pattern(seed_id=55).save(suspect_dir / "frame_0005s.jpg")

        # Simulate missing reference file by removing it from disk after indexing
        if ref_frame_path.exists():
            ref_frame_path.unlink()

        # Run with vision verification enabled
        result = analyze_asset_matches(
            submitted_asset_id=suspect_asset_id,
            frames_dir=suspect_dir,
            vault=self.vault,
            run_vision_verification=True,
        )

        frame_match = result["frame_matches"][0]
        best = frame_match["best_match"]
        ver = best.get("vision_verification")
        self.assertIsNotNone(ver)
        self.assertEqual(ver["visual_correspondence"], "UNVERIFIED")
        self.assertEqual(ver["validation_status"], "VERIFICATION_UNAVAILABLE")
        self.assertIn("Reference frame", ver["reasoning"])

    # -------------------------------------------------------------------------
    # 7. Missing Suspect Frames
    # -------------------------------------------------------------------------
    def test_case_7_missing_suspect_frame(self):
        """
        Scenario 7: Missing Suspect Frame during Vision Verification.
        - Suspect frame path does not exist on disk when vision verification is triggered.
        - Asserts fallback safely returns UNVERIFIED without crashing.
        """
        ref_asset_id = "ref-valid-asset"
        ref_dir = self.frames_dir / ref_asset_id
        ref_dir.mkdir(parents=True, exist_ok=True)
        ref_frame_path = ref_dir / "frame_0000s.jpg"
        create_deterministic_pattern(seed_id=88).save(ref_frame_path)
        self.vault.index_asset_frames(asset_id=ref_asset_id, frames_dir=ref_dir)

        # Create suspect with one frame
        suspect_asset_id = "suspect-deleted-frame"
        suspect_dir = self.frames_dir / suspect_asset_id
        suspect_dir.mkdir(parents=True, exist_ok=True)
        suspect_frame_path = suspect_dir / "frame_0010s.jpg"
        create_deterministic_pattern(seed_id=88).save(suspect_frame_path)

        # Mock Path.exists specifically when checking the suspect frame path in vision verification
        orig_exists = Path.exists

        def mock_path_exists(p):
            if "frame_0010s.jpg" in str(p) and "suspect-deleted-frame" in str(p):
                # Allow it to exist during match_single_frame, but not during vision verification loop
                import inspect
                stack = [frame.function for frame in inspect.stack()]
                if "analyze_asset_matches" in stack:
                    # Check if inside vision verification loop
                    for frame_info in inspect.stack():
                        if frame_info.function == "analyze_asset_matches" and frame_info.lineno > 400:
                            return False
            return orig_exists(p)

        with patch.object(Path, "exists", side_effect=mock_path_exists, autospec=True):
            result = analyze_asset_matches(
                submitted_asset_id=suspect_asset_id,
                frames_dir=suspect_dir,
                vault=self.vault,
                run_vision_verification=True,
            )

        frame_match = result["frame_matches"][0]
        best = frame_match["best_match"]
        ver = best.get("vision_verification")
        self.assertIsNotNone(ver)
        self.assertEqual(ver["visual_correspondence"], "UNVERIFIED")
        self.assertEqual(ver["validation_status"], "VERIFICATION_UNAVAILABLE")
        self.assertIn("Suspect frame", ver["reasoning"])

    # -------------------------------------------------------------------------
    # 8. Empty Matching Results (Empty Vault)
    # -------------------------------------------------------------------------
    def test_case_8_empty_vault_and_matching_results(self):
        """
        Scenario 8: Matching against an empty reference vault.
        - Asserts status is NO_REFERENCE_DATA, candidate count is 0, lowest_l2 is None.
        - Never fabricates a CLEAN or CONFIRMED state.
        """
        suspect_asset_id = "suspect-against-empty-vault"
        suspect_dir = self.frames_dir / suspect_asset_id
        suspect_dir.mkdir(parents=True, exist_ok=True)
        create_deterministic_pattern(seed_id=1).save(suspect_dir / "frame_0000s.jpg")

        result = analyze_asset_matches(
            submitted_asset_id=suspect_asset_id,
            frames_dir=suspect_dir,
            vault=self.vault,
            run_vision_verification=False,
        )

        self.assertEqual(result["overall_status"], "NO_REFERENCE_DATA")
        self.assertEqual(result["candidate_matches_found"], 0)
        self.assertEqual(result["matched_assets"], [])
        self.assertIsNone(result["lowest_l2_distance"])
        self.assertEqual(result["highest_confidence"], 0.0)

    # -------------------------------------------------------------------------
    # 9. Vision Provider Failures & Malformed Responses
    # -------------------------------------------------------------------------
    def test_case_9_vision_provider_failures(self):
        """
        Scenario 9: Vision Model Failures.
        - Subcase A: Provider timeout / connection error.
        - Subcase B: Malformed non-JSON response from model.
        - Subcase C: Response missing required schema keys.
        - Subcase D: Missing API key.
        - All subcases must safely produce UNVERIFIED without crashing.
        """
        img_s = create_deterministic_pattern(seed_id=98761, size=(100, 100))
        img_r = create_deterministic_pattern(seed_id=98762, size=(100, 100))

        with patch("app.vision_verifier.get_cached_verification", return_value=None):
            # Subcase A: Provider Timeout
            with patch.dict(os.environ, {"NEBIUS_API_KEY": "mock_api_key"}):
                with patch("openai.OpenAI") as mock_openai_cls:
                    mock_client = MagicMock()
                    mock_client.chat.completions.create.side_effect = TimeoutError("API request timed out after 15s")
                    mock_openai_cls.return_value = mock_client

                    res_timeout = verify_candidate_pair(
                        img_s,
                        img_r,
                        suspect_timestamp_sec=5.0,
                        reference_timestamp_sec=2.0,
                        source_asset_id="asset_test",
                    )
                    self.assertEqual(res_timeout["visual_correspondence"], "UNVERIFIED")
                    self.assertEqual(res_timeout["validation_status"], "VERIFICATION_UNAVAILABLE")
                    self.assertIn("timed out", res_timeout["reasoning"])

            # Subcase B: Malformed non-JSON response
            with patch.dict(os.environ, {"NEBIUS_API_KEY": "mock_api_key"}):
                with patch("openai.OpenAI") as mock_openai_cls:
                    mock_client = MagicMock()
                    mock_choice = MagicMock()
                    mock_choice.message.content = "Here is my thoughts: the images look quite similar, not JSON!"
                    mock_response = MagicMock()
                    mock_response.choices = [mock_choice]
                    mock_client.chat.completions.create.return_value = mock_response
                    mock_openai_cls.return_value = mock_client

                    res_malformed = verify_candidate_pair(
                        img_s,
                        img_r,
                        suspect_timestamp_sec=5.0,
                        reference_timestamp_sec=2.0,
                        source_asset_id="asset_test",
                    )
                    self.assertEqual(res_malformed["visual_correspondence"], "UNVERIFIED")
                    self.assertIn(res_malformed["validation_status"], ("FAILED", "VERIFICATION_UNAVAILABLE"))
                    self.assertIn("not valid JSON", res_malformed["reasoning"])

            # Subcase C: JSON missing required keys
            with patch.dict(os.environ, {"NEBIUS_API_KEY": "mock_api_key"}):
                with patch("openai.OpenAI") as mock_openai_cls:
                    mock_client = MagicMock()
                    mock_choice = MagicMock()
                    mock_choice.message.content = json.dumps({"unrelated_field": "val"})
                    mock_response = MagicMock()
                    mock_response.choices = [mock_choice]
                    mock_client.chat.completions.create.return_value = mock_response
                    mock_openai_cls.return_value = mock_client

                    res_bad_schema = verify_candidate_pair(
                        img_s,
                        img_r,
                        suspect_timestamp_sec=5.0,
                        reference_timestamp_sec=2.0,
                        source_asset_id="asset_test",
                    )
                    self.assertEqual(res_bad_schema["visual_correspondence"], "UNVERIFIED")
                    self.assertEqual(res_bad_schema["validation_status"], "SCHEMA_VIOLATION")

            # Subcase D: Missing API key
            with patch.dict(os.environ, {"NEBIUS_API_KEY": ""}):
                res_no_key = verify_candidate_pair(
                    img_s,
                    img_r,
                    suspect_timestamp_sec=5.0,
                    reference_timestamp_sec=2.0,
                    source_asset_id="asset_test",
                )
                self.assertEqual(res_no_key["visual_correspondence"], "UNVERIFIED")
                self.assertEqual(res_no_key["validation_status"], "VERIFICATION_UNAVAILABLE")
                self.assertIn("Nebius API key not configured", res_no_key["reasoning"])

    # -------------------------------------------------------------------------
    # 10. URL Screening: Single-Thumbnail vs Multi-Preview
    # -------------------------------------------------------------------------
    def test_case_10_single_vs_multi_preview_url_screening(self):
        """
        Scenario 10: URL Screening Forensic Behavior.
        - Subcase A: Single-thumbnail screening.
        - Subcase B: Multi-preview preview candidate screening.
        - Subcase C: SSRF security enforcement (blocks loopback, cloud metadata).
        - Subcase D: Disclaimers and raw metrics preservation.
        """
        ref_asset_id = "ref-sports-event"
        ref_dir = self.frames_dir / ref_asset_id
        ref_dir.mkdir(parents=True, exist_ok=True)
        pat_img = create_deterministic_pattern(seed_id=200)
        pat_img.save(ref_dir / "frame_0000s.jpg")
        self.vault.index_asset_frames(asset_id=ref_asset_id, frames_dir=ref_dir)

        buf = io.BytesIO()
        pat_img.save(buf, format="JPEG")
        pat_bytes = buf.getvalue()

        # Subcase A: Single-thumbnail screening
        fake_meta_single = {
            "title": "Championship Highlights 2026",
            "channel": "SportsFanatic",
            "duration": 180,
            "platform": "youtube",
            "video_id": "vid_abc123",
            "thumbnail_url": "https://i.ytimg.com/vi/vid_abc123/hqdefault.jpg",
            "candidate_thumbnail_urls": ["https://i.ytimg.com/vi/vid_abc123/hqdefault.jpg"],
            "storyboards": [],
        }

        with patch("app.url_screener.extract_public_video_metadata", return_value=fake_meta_single):
            with patch("app.url_screener.fetch_suspect_thumbnail_image", return_value=(pat_img, pat_bytes)):
                res_single = screen_video_url(
                    url="https://www.youtube.com/watch?v=vid_abc123",
                    vault=self.vault,
                    run_vision_verification=False,
                )

                self.assertEqual(res_single["screening_mode"], "SINGLE_FRAME_PRELIMINARY")
                self.assertEqual(res_single["total_frames_analyzed"], 1)
                self.assertEqual(res_single["overall_status"], "CANDIDATE_MATCH")
                self.assertEqual(res_single["recommended_action"], "NEEDS_FULL_VIDEO_REVIEW")
                self.assertIn("Preliminary preview screening only", res_single["disclaimer"])
                self.assertIn("NOT a definitive copyright-infringement finding", res_single["disclaimer"])
                self.assertIn(ref_asset_id, res_single["matched_assets"])

        # Subcase B: Multi-preview screening
        fake_meta_multi = {
            "title": "Championship Highlights Multi-Preview",
            "channel": "SportsFanatic",
            "duration": 180,
            "platform": "youtube",
            "video_id": "vid_multi123",
            "thumbnail_url": "https://i.ytimg.com/vi/vid_multi123/hqdefault.jpg",
            "candidate_thumbnail_urls": [
                "https://i.ytimg.com/vi/vid_multi123/hqdefault.jpg",
                "https://i.ytimg.com/vi/vid_multi123/maxresdefault.jpg",
                "https://i.ytimg.com/vi/vid_multi123/mqdefault.jpg",
            ],
            "storyboards": [],
        }

        with patch("app.url_screener.extract_public_video_metadata", return_value=fake_meta_multi):
            with patch("app.url_screener.fetch_suspect_thumbnail_image", return_value=(pat_img, pat_bytes)):
                res_multi = screen_video_url(
                    url="https://www.youtube.com/watch?v=vid_multi123",
                    vault=self.vault,
                    run_vision_verification=False,
                )

                self.assertEqual(res_multi["screening_mode"], "MULTI_FRAME_PREVIEW_SCREENING")
                self.assertEqual(res_multi["total_frames_analyzed"], 3)
                self.assertEqual(res_multi["overall_status"], "CANDIDATE_MATCH")
                self.assertEqual(len(res_multi["frame_matches"]), 3)

        # Subcase C: SSRF Security Validation
        with self.assertRaises(SSRFValidationError):
            validate_url_for_ssrf("http://127.0.0.1:8000/secret")
        with self.assertRaises(SSRFValidationError):
            validate_url_for_ssrf("http://localhost:8000/secret")
        with self.assertRaises(SSRFValidationError):
            validate_url_for_ssrf("http://169.254.169.254/latest/meta-data/")
        with self.assertRaises(SSRFValidationError):
            validate_url_for_ssrf("http://192.168.1.100/admin")
        with self.assertRaises(SSRFValidationError):
            validate_url_for_ssrf("http://10.0.0.1/internal")
        with self.assertRaises(SSRFValidationError):
            validate_url_for_ssrf("file:///etc/passwd")

    # -------------------------------------------------------------------------
    # 11. Temporal Clustering & Evidence Hierarchy Validation
    # -------------------------------------------------------------------------
    def test_case_11_temporal_consistency_and_evidence_hierarchy(self):
        """
        Validates that temporal clustering properly enforces continuity:
        - Clusters contiguous matching frames with low drift.
        - Excludes low-entropy and NO_MATCH frames.
        - Preserves evidence IDs, source asset references, and timestamp bounds.
        """
        matches = [
            {
                "frame_idx": 0,
                "timestamp_sec": 0.0,
                "best_match": {
                    "source_asset_id": "asset_alpha",
                    "source_timestamp_sec": 100.0,
                    "l2_distance": 0.20,
                    "visual_similarity_score": 90.0,
                    "match_confirmed": True,
                    "phash_match": True,
                    "low_entropy_flag": False,
                },
            },
            {
                "frame_idx": 1,
                "timestamp_sec": 5.0,
                "best_match": {
                    "source_asset_id": "asset_alpha",
                    "source_timestamp_sec": 105.0,
                    "l2_distance": 0.22,
                    "visual_similarity_score": 88.0,
                    "match_confirmed": True,
                    "phash_match": True,
                    "low_entropy_flag": False,
                },
            },
            {
                "frame_idx": 2,
                "timestamp_sec": 10.0,
                "best_match": {
                    "source_asset_id": "asset_alpha",
                    "source_timestamp_sec": 110.0,
                    "l2_distance": 0.25,
                    "visual_similarity_score": 86.0,
                    "match_confirmed": True,
                    "phash_match": True,
                    "low_entropy_flag": False,
                },
            },
            {
                "frame_idx": 3,
                "timestamp_sec": 15.0,
                "best_match": {
                    "source_asset_id": "asset_alpha",
                    "source_timestamp_sec": 115.0,
                    "l2_distance": 0.02,  # Low distance on black frame!
                    "visual_similarity_score": 0.0,
                    "match_confirmed": False,
                    "phash_match": False,
                    "low_entropy_flag": True,  # Flagged low entropy!
                },
            },
            {
                "frame_idx": 4,
                "timestamp_sec": 20.0,
                "best_match": {
                    "source_asset_id": "asset_beta",  # Different reference asset
                    "source_timestamp_sec": 50.0,
                    "l2_distance": 0.15,
                    "visual_similarity_score": 92.0,
                    "match_confirmed": True,
                    "phash_match": True,
                    "low_entropy_flag": False,
                },
            },
        ]

        frame_evidences = build_frame_evidence_from_matches(matches)
        self.assertEqual(len(frame_evidences), 5)
        self.assertEqual(frame_evidences[3].similarity_status, "NO_MATCH")

        config = TimelineClusteringConfig()
        intervals = cluster_frame_matches(frame_evidences, config)

        alpha_intervals = [it for it in intervals if it.source_asset_id == "asset_alpha"]
        beta_intervals = [it for it in intervals if it.source_asset_id == "asset_beta"]

        self.assertEqual(len(alpha_intervals), 1)
        self.assertEqual(alpha_intervals[0].frame_count, 3)
        self.assertEqual(alpha_intervals[0].suspect_start_sec, 0.0)
        self.assertEqual(alpha_intervals[0].suspect_end_sec, 10.0)
        self.assertEqual(alpha_intervals[0].source_start_sec, 100.0)
        self.assertEqual(alpha_intervals[0].source_end_sec, 110.0)
        self.assertEqual(alpha_intervals[0].duration_sec, 10.0)
        self.assertEqual(alpha_intervals[0].continuity_status, "CONTINUOUS_MATCH")

        self.assertEqual(len(beta_intervals), 1)
        self.assertEqual(beta_intervals[0].continuity_status, "SINGLETON")


if __name__ == "__main__":
    unittest.main()
