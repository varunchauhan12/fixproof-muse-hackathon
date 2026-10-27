"""
Unit and integration tests for Synchronized Playback and Streaming Identifier Resolution (Phase 2.2).
Validates incident ID resolution to submitted_asset_id, URL screening streaming safeguards,
and path safety validation.
"""

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app


class TestPlaybackSyncAndStreaming(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_invalid_asset_id_format_rejected(self):
        """Validates that unsafe or malformed asset IDs are rejected with HTTP 400."""
        # Path traversal
        res1 = self.client.get("/api/vault/assets/../secret/video")
        self.assertIn(res1.status_code, (400, 404))

        # Special characters not matching safe ID regex
        res2 = self.client.get("/api/vault/assets/bad*id$/video")
        self.assertEqual(res2.status_code, 400)

    def test_invalid_frame_filename_rejected(self):
        """Validates that unsafe frame filenames are rejected with HTTP 400."""
        res = self.client.get("/api/vault/assets/valid-asset-123/frames/../../etc/passwd")
        self.assertIn(res.status_code, (400, 404))

    def test_url_screening_video_streaming_returns_404_with_preliminary_notice(self):
        """
        Validates that attempting to stream video for a URL-screened incident returns
        HTTP 404 explaining that video was not downloaded per platform policies.
        """
        mock_incident = {
            "incident_id": "url-threat-abc-123",
            "investigation_type": "URL_SCREENING",
            "platform": "YouTube",
            "submitted_asset_id": "url-threat-abc-123",
        }

        with patch("app.registry.get_incident_by_id", return_value=mock_incident):
            res = self.client.get("/api/vault/assets/url-threat-abc-123/video")
            self.assertEqual(res.status_code, 404)
            data = res.json()
            self.assertIn("No video stream available for URL-screened threats", data.get("detail", ""))
            self.assertIn("Preliminary screening evaluated public preview thumbnail only", data.get("detail", ""))

    def test_uploaded_suspect_incident_id_resolved_to_submitted_asset_id(self):
        """
        Validates that streaming endpoints resolve an incident_id to its actual
        stored submitted_asset_id when they differ.
        """
        incident_id = "inc-uuid-999"
        submitted_asset_id = "suspect-uuid-888"

        mock_incident = {
            "incident_id": incident_id,
            "investigation_type": "FULL_VIDEO_SCAN",
            "submitted_asset_id": submitted_asset_id,
        }

        # Create temporary suspect video file
        from app.main import SUSPECTS_VIDEOS_DIR
        SUSPECTS_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
        temp_video = SUSPECTS_VIDEOS_DIR / f"{submitted_asset_id}.mp4"
        temp_video.write_bytes(b"dummy mp4 video stream bytes for testing")

        try:
            with patch("app.registry.get_incident_by_id", return_value=mock_incident):
                # Request video by incident_id (frontend pattern)
                res = self.client.get(f"/api/vault/assets/{incident_id}/video")
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.content, b"dummy mp4 video stream bytes for testing")
        finally:
            if temp_video.exists():
                temp_video.unlink()

    def test_frame_streaming_resolves_incident_id(self):
        """
        Validates that stream_asset_frame resolves an incident_id to submitted_asset_id
        to retrieve suspect keyframe images.
        """
        incident_id = "inc-frame-test"
        submitted_asset_id = "suspect-asset-test"

        mock_incident = {
            "incident_id": incident_id,
            "investigation_type": "FULL_VIDEO_SCAN",
            "submitted_asset_id": submitted_asset_id,
        }

        from app.main import SUSPECTS_FRAMES_DIR
        frame_dir = SUSPECTS_FRAMES_DIR / submitted_asset_id
        frame_dir.mkdir(parents=True, exist_ok=True)
        frame_file = frame_dir / "frame_0005.jpg"
        frame_file.write_bytes(b"\xff\xd8\xff\xe0dummy_jpeg_header_bytes")

        try:
            with patch("app.registry.get_incident_by_id", return_value=mock_incident):
                res = self.client.get(f"/api/vault/assets/{incident_id}/frames/frame_0005.jpg")
                self.assertEqual(res.status_code, 200)
                self.assertEqual(res.headers.get("content-type"), "image/jpeg")
        finally:
            if frame_file.exists():
                frame_file.unlink()
            if frame_dir.exists():
                frame_dir.rmdir()


if __name__ == "__main__":
    unittest.main()
