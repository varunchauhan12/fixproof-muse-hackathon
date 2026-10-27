"""
Tests for FixProof Video Ingestion and Frame Extraction (Milestone 2).
"""

import io
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

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.main import app, STORAGE_DIR, FRAMES_DIR


def create_synthetic_video(duration_sec: int = 11, fps: int = 10) -> str:
    """Creates a temporary valid playable MP4 video using OpenCV VideoWriter."""
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp_path = tmp.name
    tmp.close()

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(tmp_path, fourcc, float(fps), (320, 240))
    total_frames = duration_sec * fps
    for i in range(total_frames):
        img = np.zeros((240, 320, 3), dtype=np.uint8)
        img[:] = (i * 2 % 255, 100, 180)
        out.write(img)
    out.release()
    return tmp_path


def create_zero_frame_video() -> str:
    """Creates a video container with 0 encoded video frames."""
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp_path = tmp.name
    tmp.close()

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(tmp_path, fourcc, 10.0, (320, 240))
    out.release()  # closed without writing frames
    return tmp_path


class TestIngestAndExtraction(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)
        self.created_asset_ids = []

    def tearDown(self):
        # Clean up any test assets created during tests
        for asset_id in self.created_asset_ids:
            for video_file in STORAGE_DIR.glob(f"{asset_id}.*"):
                video_file.unlink(missing_ok=True)
            asset_frames = FRAMES_DIR / asset_id
            if asset_frames.exists():
                shutil.rmtree(asset_frames, ignore_errors=True)

    def test_health_endpoint(self):
        """Verify GET /health remains functional."""
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "service": "FixProof API"})

    def test_diagnose_endpoint_validation(self):
        """Verify POST /diagnose input validation remains unchanged."""
        response = self.client.post("/diagnose", json={})
        self.assertEqual(response.status_code, 422)

    def test_reject_unsupported_file_extension(self):
        """Verify upload endpoint rejects unsupported extensions like .txt or .png."""
        response = self.client.post(
            "/api/vault/ingest",
            files={"file": ("notes.txt", io.BytesIO(b"Hello world"), "text/plain")},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Unsupported file type", response.json()["detail"])

    def test_reject_empty_file(self):
        """Verify upload endpoint rejects zero-byte uploads."""
        response = self.client.post(
            "/api/vault/ingest",
            files={"file": ("empty.mp4", io.BytesIO(b""), "video/mp4")},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("empty", response.json()["detail"])

    def test_reject_corrupted_or_unreadable_video(self):
        """Verify that arbitrary corrupt bytes with .mp4 extension are rejected safely."""
        corrupt_bytes = b"NOT_A_VALID_VIDEO_STREAM" * 50
        response = self.client.post(
            "/api/vault/ingest",
            files={"file": ("corrupt.mp4", io.BytesIO(corrupt_bytes), "video/mp4")},
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("Invalid or unreadable video", response.json()["detail"])

    def test_reject_zero_usable_frames_video(self):
        """Verify that a video header yielding 0 frames is rejected safely and cleaned up."""
        zero_video_path = create_zero_frame_video()
        try:
            with open(zero_video_path, "rb") as f:
                response = self.client.post(
                    "/api/vault/ingest",
                    files={"file": ("zero_frames.mp4", f, "video/mp4")},
                )
            self.assertEqual(response.status_code, 422)
            self.assertIn("Invalid or unreadable video", response.json()["detail"])
        finally:
            if os.path.exists(zero_video_path):
                os.remove(zero_video_path)

    def test_valid_playable_video_ingestion_and_frame_extraction(self):
        """
        Verify an 11-second synthetic video is ingested and frames extracted at 5s intervals.
        Expected sample timestamps: 0s, 5s, 10s (3 frames).
        """
        synth_video_path = create_synthetic_video(duration_sec=11, fps=10)
        try:
            with open(synth_video_path, "rb") as f:
                response = self.client.post(
                    "/api/vault/ingest",
                    files={"file": ("synthetic_match.mp4", f, "video/mp4")},
                )

            self.assertEqual(response.status_code, 200)
            data = response.json()

            # 1. Verify preserved existing fields
            self.assertEqual(data["status"], "uploaded")
            self.assertEqual(data["filename"], "synthetic_match.mp4")
            self.assertEqual(data["content_type"], "video/mp4")
            self.assertGreater(data["file_size"], 0)
            asset_id = data["asset_id"]
            self.assertTrue(asset_id)
            self.created_asset_ids.append(asset_id)

            # 2. Verify new extraction fields
            self.assertAlmostEqual(data["duration_seconds"], 11.0, delta=1.0)
            self.assertEqual(data["sample_interval_seconds"], 5)
            self.assertEqual(data["frame_count"], 3)

            frames = data["frames"]
            self.assertEqual(len(frames), 3)

            # Verify timestamps: 0s, 5s, 10s
            expected_timestamps = [0, 5, 10]
            for idx, frame_meta in enumerate(frames):
                self.assertEqual(frame_meta["frame_index"], idx)
                self.assertEqual(frame_meta["timestamp_sec"], expected_timestamps[idx])
                self.assertTrue(frame_meta["filename"].endswith(".jpg"))

                # 3. Verify actual frame file existence on disk
                frame_file = Path(frame_meta["frame_path"])
                self.assertTrue(frame_file.exists(), f"Frame file missing: {frame_file}")

                # Verify image is a valid, readable JPEG
                img = cv2.imread(str(frame_file))
                self.assertIsNotNone(img, f"Extracted image cannot be decoded: {frame_file}")
                self.assertEqual(img.shape, (240, 320, 3))

            # 4. Verify video file is stored under asset_id
            stored_video = STORAGE_DIR / f"{asset_id}.mp4"
            self.assertTrue(stored_video.exists(), f"Stored video missing: {stored_video}")

        finally:
            if os.path.exists(synth_video_path):
                os.remove(synth_video_path)

    def test_ingest_non_mp4_video_formats(self):
        """
        Verify that non-MP4 formats (such as .avi and .webm) are successfully ingested,
        extracted at 5s intervals, correctly content-typed, and stored with their original extensions.
        """
        # Create an 11s AVI video using MJPG or XVID codec
        tmp = tempfile.NamedTemporaryFile(suffix=".avi", delete=False)
        avi_path = tmp.name
        tmp.close()

        fourcc = cv2.VideoWriter_fourcc(*"MJPG")
        out = cv2.VideoWriter(avi_path, fourcc, 10.0, (320, 240))
        for i in range(110):
            img = np.zeros((240, 320, 3), dtype=np.uint8)
            img[:] = (50, i * 2 % 255, 120)
            out.write(img)
        out.release()

        try:
            with open(avi_path, "rb") as f:
                response = self.client.post(
                    "/api/vault/ingest",
                    files={"file": ("reference_clip.avi", f, "video/x-msvideo")},
                )

            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["status"], "uploaded")
            self.assertEqual(data["filename"], "reference_clip.avi")
            self.assertEqual(data["content_type"], "video/x-msvideo")
            self.assertEqual(data["frame_count"], 3)
            asset_id = data["asset_id"]
            self.created_asset_ids.append(asset_id)

            # Verify stored video preserves extension
            stored_video = STORAGE_DIR / f"{asset_id}.avi"
            self.assertTrue(stored_video.exists(), f"Stored AVI missing: {stored_video}")

            # Verify asset is listed properly in registered assets
            list_res = self.client.get("/api/vault/assets")
            self.assertEqual(list_res.status_code, 200)
            assets = list_res.json()
            matching = [a for a in assets if a["asset_id"] == asset_id]
            self.assertEqual(len(matching), 1)
            self.assertEqual(matching[0]["filename"], "reference_clip.avi")
        finally:
            if os.path.exists(avi_path):
                os.remove(avi_path)


if __name__ == "__main__":
    unittest.main()
