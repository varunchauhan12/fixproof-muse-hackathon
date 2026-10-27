"""
Automated Tests for Milestone 6B.2: Video Preflight and Upload Pipeline Hardening.

Covers:
- Video preflight check (valid, corrupt, zero-frame, missing, empty, NaN FPS).
- Video upload validation (unsupported extensions, empty files).
- Corrupt/zero-frame scan rejection and cleanup (zero dangling directories).
- Empty vault scanning behavior (NO_REFERENCE_DATA, never false CLEAN).
- Successful visual matching vs. unrelated-video scans.
- Strict suspect/reference isolation (no vectors added, no registry leakage).
- Regression of reference ingestion, indexing, and deletion.
"""

import io
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# Ensure backend root is on sys.path
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Prevent OpenMP duplicate runtime abort on macOS between PyTorch and FAISS
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import cv2
import numpy as np
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

from app.main import (
    app,
    STORAGE_DIR,
    FRAMES_DIR,
    SUSPECTS_VIDEOS_DIR,
    SUSPECTS_FRAMES_DIR,
)
from app.extractor import (
    preflight_video_file,
    _sanitize_fps,
    _sanitize_total_frames,
    extract_video_frames,
)
from app.vault import ReferenceVault, default_vault


def make_pattern_video(
    filepath: Path,
    pattern: str = "stripes",
    duration_sec: int = 5,
    fps: int = 10,
    width: int = 240,
    height: int = 240,
) -> Path:
    """Creates a deterministic synthetic video with distinct visual features (stripes or circle)."""
    pil_img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(pil_img)

    if pattern == "stripes":
        for y in range(0, height, 20):
            draw.rectangle([0, y, width, y + 10], fill="black")
    elif pattern == "circle":
        draw.ellipse([30, 30, width - 30, height - 30], fill="black")
    else:
        # Default gradient
        for y in range(height):
            draw.line([(0, y), (width, y)], fill=(y % 255, 100, 180))

    frame_bgr = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(filepath), fourcc, float(fps), (width, height))
    total_frames = duration_sec * fps
    for _ in range(total_frames):
        out.write(frame_bgr)
    out.release()
    return filepath


def make_zero_frame_container(filepath: Path) -> Path:
    """Creates an MP4 container file with zero encoded video frames."""
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(filepath), fourcc, 10.0, (240, 240))
    out.release()
    return filepath


class TestVideoPreflightAndScan(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)
        self.temp_dir = Path(tempfile.mkdtemp(prefix="fixproof_preflight_test_"))
        self.cleanup_asset_ids = []
        self.cleanup_suspect_ids = []

    def tearDown(self):
        # Remove local test directory
        if self.temp_dir.exists():
            shutil.rmtree(self.temp_dir, ignore_errors=True)

        # Clean up any reference assets created in global storage
        for aid in self.cleanup_asset_ids:
            for f in STORAGE_DIR.glob(f"{aid}.*"):
                f.unlink(missing_ok=True)
            rf = FRAMES_DIR / aid
            if rf.exists():
                shutil.rmtree(rf, ignore_errors=True)
            default_vault.remove_asset_vectors(aid)

        # Clean up any suspect files created in global storage
        for sid in self.cleanup_suspect_ids:
            for f in SUSPECTS_VIDEOS_DIR.glob(f"{sid}.*"):
                f.unlink(missing_ok=True)
            sf = SUSPECTS_FRAMES_DIR / sid
            if sf.exists():
                shutil.rmtree(sf, ignore_errors=True)

    # ─── 1. Unit Tests for Preflight & Sanitization ──────────────────────────────

    def test_sanitize_fps_and_total_frames(self):
        """Verify FPS and frame count sanitizers handle corrupt/NaN/Inf values safely."""
        self.assertEqual(_sanitize_fps(None), 1.0)
        self.assertEqual(_sanitize_fps(float("nan")), 1.0)
        self.assertEqual(_sanitize_fps(float("inf")), 1.0)
        self.assertEqual(_sanitize_fps(float("-inf")), 1.0)
        self.assertEqual(_sanitize_fps(-10.0), 1.0)
        self.assertEqual(_sanitize_fps(0.0), 1.0)
        self.assertEqual(_sanitize_fps(29.97), 29.97)
        self.assertEqual(_sanitize_fps(1000.0), 240.0)  # clamped

        self.assertEqual(_sanitize_total_frames(None), 0)
        self.assertEqual(_sanitize_total_frames(float("nan")), 0)
        self.assertEqual(_sanitize_total_frames(float("inf")), 0)
        self.assertEqual(_sanitize_total_frames(-5), 0)
        self.assertEqual(_sanitize_total_frames(120), 120)

    def test_preflight_valid_video(self):
        """Verify preflight correctly extracts metadata from a valid video."""
        vid_path = self.temp_dir / "valid_sample.mp4"
        make_pattern_video(vid_path, pattern="stripes", duration_sec=5, fps=10, width=240, height=240)

        info = preflight_video_file(vid_path)
        self.assertTrue(info["is_valid"])
        self.assertEqual(info["width"], 240)
        self.assertEqual(info["height"], 240)
        self.assertEqual(info["frame_rate"], 10)
        self.assertEqual(info["total_frames"], 50)
        self.assertAlmostEqual(info["estimated_duration_sec"], 5.0, delta=0.5)
        self.assertGreater(info["file_size"], 0)

    def test_preflight_corrupt_file(self):
        """Verify preflight rejects arbitrary corrupt bytes with a clear ValueError."""
        corrupt_path = self.temp_dir / "corrupt.mp4"
        corrupt_path.write_bytes(b"INVALID_HEADER_STREAM_DATA" * 50)

        with self.assertRaises(ValueError) as ctx:
            preflight_video_file(corrupt_path)
        self.assertTrue(
            "Could not open video file" in str(ctx.exception)
            or "no readable frames" in str(ctx.exception)
        )

    def test_preflight_zero_frame_file(self):
        """Verify preflight rejects video container containing zero frames."""
        zero_path = self.temp_dir / "zero.mp4"
        make_zero_frame_container(zero_path)

        with self.assertRaises(ValueError) as ctx:
            preflight_video_file(zero_path)
        self.assertTrue(
            "no readable frames" in str(ctx.exception)
            or "Could not open" in str(ctx.exception)
        )

    def test_preflight_nonexistent_and_empty_file(self):
        """Verify preflight rejects missing and 0-byte files."""
        missing_path = self.temp_dir / "nonexistent.mp4"
        with self.assertRaises(ValueError) as ctx:
            preflight_video_file(missing_path)
        self.assertIn("does not exist", str(ctx.exception))

        empty_path = self.temp_dir / "empty.mp4"
        empty_path.write_bytes(b"")
        with self.assertRaises(ValueError) as ctx:
            preflight_video_file(empty_path)
        self.assertIn("empty (0 bytes)", str(ctx.exception))

    # ─── 2. Threat Scan Upload Route Validation & Cleanup ───────────────────────

    def test_threat_scan_rejects_unsupported_extension(self):
        """Verify POST /api/threats/scan rejects unsupported extensions with HTTP 400."""
        res = self.client.post(
            "/api/threats/scan",
            files={"file": ("suspect.txt", io.BytesIO(b"not a video"), "text/plain")},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Unsupported video format", res.json()["detail"])

    def test_threat_scan_rejects_empty_file(self):
        """Verify POST /api/threats/scan rejects 0-byte uploads with HTTP 400."""
        res = self.client.post(
            "/api/threats/scan",
            files={"file": ("empty_suspect.mp4", io.BytesIO(b""), "video/mp4")},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("empty", res.json()["detail"])

    def test_threat_scan_rejects_corrupted_file_and_leaves_no_dangling_files(self):
        """
        Verify POST /api/threats/scan rejects corrupt bytes with HTTP 422
        and leaves ZERO dangling suspect files or frame directories.
        """
        initial_suspect_videos = set(SUSPECTS_VIDEOS_DIR.iterdir())
        initial_suspect_frames = set(SUSPECTS_FRAMES_DIR.iterdir())

        corrupt_bytes = b"CORRUPTED_MP4_BITSTREAM_CONTENT" * 100
        res = self.client.post(
            "/api/threats/scan",
            files={"file": ("corrupt_suspect.mp4", io.BytesIO(corrupt_bytes), "video/mp4")},
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("Invalid suspect video", res.json()["detail"])

        current_suspect_videos = set(SUSPECTS_VIDEOS_DIR.iterdir())
        current_suspect_frames = set(SUSPECTS_FRAMES_DIR.iterdir())

        # No dangling files left behind
        self.assertEqual(current_suspect_videos, initial_suspect_videos)
        self.assertEqual(current_suspect_frames, initial_suspect_frames)

    def test_threat_scan_rejects_zero_frames_container_and_cleans_up(self):
        """Verify zero-frame container is rejected with HTTP 422 and cleaned up completely."""
        zero_path = self.temp_dir / "zero_upload.mp4"
        make_zero_frame_container(zero_path)

        initial_suspect_videos = set(SUSPECTS_VIDEOS_DIR.iterdir())
        initial_suspect_frames = set(SUSPECTS_FRAMES_DIR.iterdir())

        with open(zero_path, "rb") as f:
            res = self.client.post(
                "/api/threats/scan",
                files={"file": ("zero_suspect.mp4", f, "video/mp4")},
            )

        self.assertEqual(res.status_code, 422)
        self.assertIn("Invalid suspect video", res.json()["detail"])

        current_suspect_videos = set(SUSPECTS_VIDEOS_DIR.iterdir())
        current_suspect_frames = set(SUSPECTS_FRAMES_DIR.iterdir())

        self.assertEqual(current_suspect_videos, initial_suspect_videos)
        self.assertEqual(current_suspect_frames, initial_suspect_frames)

    # ─── 3. Forensic Detection Pipeline: Matching vs. Unrelated vs. Empty Vault ─

    def test_threat_scan_empty_vault_behavior(self):
        """
        Verify scanning against an empty vault returns NO_REFERENCE_DATA,
        never defaults to CLEAN, and includes total analyzed frames.
        """
        vid_path = self.temp_dir / "suspect_empty_check.mp4"
        make_pattern_video(vid_path, pattern="stripes", duration_sec=5, fps=10)

        # Isolated empty vault to prevent side effects on default vault
        empty_vault = ReferenceVault(vault_dir=self.temp_dir / "isolated_empty_vault")
        empty_vault.clear()

        with patch("app.main.default_vault", empty_vault):
            with open(vid_path, "rb") as f:
                res = self.client.post(
                    "/api/threats/scan",
                    files={"file": ("suspect_check.mp4", f, "video/mp4")},
                )

            self.assertEqual(res.status_code, 200)
            data = res.json()

            self.assertEqual(data["overall_status"], "NO_REFERENCE_DATA")
            self.assertEqual(data["candidate_matches_found"], 0)
            self.assertEqual(data["highest_confidence"], 0.0)
            self.assertIsNone(data["lowest_l2_distance"])
            self.assertIn("Reference vault is empty", data["message"])
            self.assertGreater(data["total_frames_analyzed"], 0)
            self.cleanup_suspect_ids.append(data["submitted_asset_id"])

    def test_threat_scan_successful_matching_and_unrelated(self):
        """
        Verify end-to-end:
        1. Ingest official reference asset with horizontal stripes and index into vault.
        2. Scan identical/matching suspect clip -> confirmed CANDIDATE_MATCH, confidence > 95%.
        3. Scan unrelated suspect clip (central circle pattern) -> CLEAN outcome (L2 > 0.75).
        4. Suspect videos and frames are strictly isolated from reference vault.
        """
        isolated_vault = ReferenceVault(vault_dir=self.temp_dir / "isolated_test_vault")
        isolated_vault.clear()

        # Step 1: Create reference video (Stripes pattern)
        ref_path = self.temp_dir / "official_match_ref.mp4"
        make_pattern_video(ref_path, pattern="stripes", duration_sec=6, fps=10)

        with patch("app.main.default_vault", isolated_vault):
            with open(ref_path, "rb") as f:
                ref_res = self.client.post(
                    "/api/vault/ingest?auto_index=true",
                    files={"file": ("official_match_ref.mp4", f, "video/mp4")},
                )
            self.assertEqual(ref_res.status_code, 200)
            ref_data = ref_res.json()
            ref_asset_id = ref_data["asset_id"]
            self.cleanup_asset_ids.append(ref_asset_id)
            self.assertTrue(ref_data["indexed"])

            initial_vault_size = isolated_vault.vector_db.ntotal
            self.assertGreater(initial_vault_size, 0)

            # Step 2: Scan matching suspect video (Identical stripes pattern)
            suspect_matching_path = self.temp_dir / "suspect_pirated_clip.mp4"
            make_pattern_video(suspect_matching_path, pattern="stripes", duration_sec=6, fps=10)

            with open(suspect_matching_path, "rb") as f:
                scan_res = self.client.post(
                    "/api/threats/scan",
                    files={"file": ("suspect_pirated_clip.mp4", f, "video/mp4")},
                )
            self.assertEqual(scan_res.status_code, 200)
            match_data = scan_res.json()
            suspect_match_id = match_data["submitted_asset_id"]
            self.cleanup_suspect_ids.append(suspect_match_id)

            self.assertEqual(match_data["overall_status"], "CANDIDATE_MATCH")
            self.assertGreaterEqual(match_data["candidate_matches_found"], 1)
            self.assertGreater(match_data["highest_confidence"], 95.0)
            self.assertLess(match_data["lowest_l2_distance"], 0.15)
            self.assertIn(ref_asset_id, match_data["matched_assets"])
            self.assertTrue(match_data["incident_id"])

            # Verify frame level pHash match
            confirmed_frame = next(
                fm for fm in match_data["frame_matches"]
                if fm["best_match"] and fm["best_match"]["match_confirmed"]
            )
            self.assertTrue(confirmed_frame["best_match"]["phash_match"])
            self.assertGreaterEqual(confirmed_frame["best_match"]["phash_score"], 90)

            # Step 3: Scan unrelated video (Circle pattern)
            suspect_unrelated_path = self.temp_dir / "suspect_nature_doc.mp4"
            make_pattern_video(suspect_unrelated_path, pattern="circle", duration_sec=6, fps=10)

            with open(suspect_unrelated_path, "rb") as f:
                unrelated_res = self.client.post(
                    "/api/threats/scan",
                    files={"file": ("suspect_nature_doc.mp4", f, "video/mp4")},
                )
            self.assertEqual(unrelated_res.status_code, 200)
            unrelated_data = unrelated_res.json()
            suspect_unrelated_id = unrelated_data["submitted_asset_id"]
            self.cleanup_suspect_ids.append(suspect_unrelated_id)

            self.assertEqual(unrelated_data["overall_status"], "CLEAN")
            self.assertEqual(unrelated_data["candidate_matches_found"], 0)
            self.assertGreater(unrelated_data["lowest_l2_distance"], 0.75)

            # Step 4: Verify Suspect Isolation
            # Neither suspect should be in registered reference assets
            assets_res = self.client.get("/api/vault/assets")
            self.assertEqual(assets_res.status_code, 200)
            reg_ids = [a["asset_id"] for a in assets_res.json()]
            self.assertIn(ref_asset_id, reg_ids)
            self.assertNotIn(suspect_match_id, reg_ids)
            self.assertNotIn(suspect_unrelated_id, reg_ids)

            # Vault size must NOT have increased after suspect scans
            self.assertEqual(isolated_vault.vector_db.ntotal, initial_vault_size)

            # Incident log must contain the recorded incident
            incidents_res = self.client.get("/api/incidents")
            self.assertEqual(incidents_res.status_code, 200)
            inc_ids = [inc.get("incident_id") for inc in incidents_res.json()]
            self.assertIn(match_data["incident_id"], inc_ids)


if __name__ == "__main__":
    unittest.main()
