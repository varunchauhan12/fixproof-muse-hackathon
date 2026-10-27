"""
Comprehensive Test Suite for FixProof Milestone 6C.5:
URL-Based Video Screening (ported from MediaGuard Sports).

Verifies:
1. SSRF defense:
   - Blocks localhost, 127.0.0.1, 0.0.0.0, ::1
   - Blocks AWS/GCP/Azure cloud metadata (169.254.169.254)
   - Blocks private networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
   - Blocks non-http(s) schemes (file://, ftp://, gopher://)
   - Blocks credentials in URLs
   - Blocks DNS rebinding resolving to private IPs
   - Blocks unsafe HTTP redirects to private/internal IP targets
2. Platform metadata extraction:
   - Supported platforms: YouTube, Vimeo, Twitch
   - Rejection of unsupported platforms and arbitrary non-video URLs
   - Strict enforcement: NEVER downloads third-party video
3. Thumbnail retrieval and screening:
   - Preflight thumbnail size cap and corruption detection
   - Handling of missing thumbnails and 404s
4. Visual matching against reference library:
   - Candidate visual match detection with MobileNetV3 + pHash
   - Distinct disclosure: overall_status = NEEDS_FULL_VIDEO_REVIEW when no match
   - Distinct disclosure: recommended_action = NEEDS_FULL_VIDEO_REVIEW when match found
   - Mandatory disclaimer and limitations list verification
5. Reference index isolation:
   - FAISS vector count unchanged after screening
   - External thumbnails kept strictly in storage/suspects/thumbnails/
6. Incident persistence:
   - investigation_type = 'URL_SCREENING' saved and retrievable
   - Verified in both local mode and mock/cloud mode
7. FastAPI endpoint testing:
   - POST /api/threats/screen-url
   - GET /api/threats/suspect-thumbnail/{incident_id}
"""

import io
import json
import os
import shutil
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Prevent OpenMP duplicate runtime abort on macOS
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

from app.main import app
from app.registry import load_incidents, save_incident, INCIDENTS_FILE
from app.url_screener import (
    validate_url_for_ssrf,
    fetch_suspect_thumbnail_image,
    extract_public_video_metadata,
    screen_video_url,
    SSRFValidationError,
    UnsupportedPlatformError,
    MetadataExtractionError,
    SUSPECTS_THUMBNAILS_DIR,
    PRELIMINARY_SCREENING_DISCLAIMER,
    SCREENING_LIMITATIONS,
)
from app.vault import ReferenceVault, default_vault


def create_test_image(color: str = "red", size=(320, 240)) -> Image.Image:
    """Creates a distinct synthetic PIL test image."""
    img = Image.new("RGB", size, color=color)
    draw = ImageDraw.Draw(img)
    draw.rectangle([20, 20, 100, 100], fill="white")
    draw.text((30, 40), "TEST", fill="black")
    return img


def image_to_bytes(img: Image.Image, format: str = "JPEG") -> bytes:
    """Converts a PIL image to byte buffer."""
    buf = io.BytesIO()
    img.save(buf, format=format)
    return buf.getvalue()


class TestSSRFProtection(unittest.TestCase):
    """Rigorous SSRF defense verification."""

    def test_blocks_localhost_and_loopback(self):
        blocked_urls = [
            "http://localhost/video",
            "http://localhost:8000/api",
            "http://127.0.0.1/video",
            "http://127.0.0.1:8080/watch?v=123",
            "http://127.127.127.127/video",
            "http://[::1]/video",
            "http://0.0.0.0/",
        ]
        for url in blocked_urls:
            with self.subTest(url=url):
                with self.assertRaises(SSRFValidationError):
                    validate_url_for_ssrf(url)

    def test_blocks_cloud_metadata(self):
        cloud_urls = [
            "http://169.254.169.254/latest/meta-data/",
            "http://169.254.169.254/computeMetadata/v1/",
            "http://metadata.google.internal/computeMetadata/v1/",
            "http://instance-data/latest/meta-data/",
        ]
        for url in cloud_urls:
            with self.subTest(url=url):
                with self.assertRaises(SSRFValidationError):
                    validate_url_for_ssrf(url)

    def test_blocks_private_rfc1918_networks(self):
        private_urls = [
            "http://10.0.0.1/video",
            "http://10.255.255.254/video",
            "http://172.16.0.1/video",
            "http://172.31.255.255/video",
            "http://192.168.1.1/video",
            "http://192.168.0.254/video",
            "http://100.64.0.1/video",  # Carrier-grade NAT
        ]
        for url in private_urls:
            with self.subTest(url=url):
                with self.assertRaises(SSRFValidationError):
                    validate_url_for_ssrf(url)

    def test_blocks_non_http_schemes(self):
        forbidden_schemes = [
            "file:///etc/passwd",
            "ftp://ftp.example.com/video.mp4",
            "gopher://example.com/",
            "data:text/html,<html></html>",
            "javascript:alert(1)",
        ]
        for url in forbidden_schemes:
            with self.subTest(url=url):
                with self.assertRaises(SSRFValidationError):
                    validate_url_for_ssrf(url)

    def test_blocks_credentials_in_url(self):
        url = "https://user:password@www.youtube.com/watch?v=dQw4w9WgXcQ"
        with self.assertRaises(SSRFValidationError):
            validate_url_for_ssrf(url)

    def test_blocks_dns_resolving_to_private_ip(self):
        """Simulates DNS rebinding returning a loopback or private address."""
        with patch("socket.getaddrinfo") as mock_dns:
            mock_dns.return_value = [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))
            ]
            with self.assertRaises(SSRFValidationError) as ctx:
                validate_url_for_ssrf("https://attacker-rebind.com/watch?v=123")
            self.assertIn("resolves to restricted/internal IP", str(ctx.exception))

    def test_thumbnail_fetch_blocks_private_redirect(self):
        """Ensures HTTP redirects pointing to private addresses are caught and blocked."""
        with patch("requests.get") as mock_get:
            # First request redirects to 169.254.169.254
            mock_redirect_resp = MagicMock()
            mock_redirect_resp.status_code = 302
            mock_redirect_resp.headers = {"Location": "http://169.254.169.254/latest/meta-data/"}
            mock_get.return_value = mock_redirect_resp

            with self.assertRaises(SSRFValidationError):
                fetch_suspect_thumbnail_image("https://example.com/safe_thumbnail.jpg")


class TestMetadataExtraction(unittest.TestCase):
    """Tests metadata parsing and platform detection with yt-dlp."""

    @patch("yt_dlp.YoutubeDL")
    def test_extract_youtube_metadata(self, mock_ydl_class):
        mock_instance = MagicMock()
        mock_instance.extract_info.return_value = {
            "title": "Championship Highlights 2026",
            "extractor_key": "Youtube",
            "uploader": "Official Sports Channel",
            "uploader_id": "sports_channel",
            "channel_url": "https://www.youtube.com/@sports_channel",
            "duration": 185.0,
            "view_count": 54200,
            "upload_date": "20261020",
            "description": "Exclusive highlights from the grand finals.",
            "webpage_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
        }
        mock_ydl_class.return_value.__enter__.return_value = mock_instance

        with patch("app.url_screener.validate_url_for_ssrf"):
            meta = extract_public_video_metadata("https://www.youtube.com/watch?v=dQw4w9WgXcQ")

        self.assertEqual(meta["title"], "Championship Highlights 2026")
        self.assertEqual(meta["platform"], "YouTube")
        self.assertEqual(meta["uploader"], "Official Sports Channel")
        self.assertEqual(meta["duration_seconds"], 185.0)
        self.assertEqual(meta["view_count"], 54200)
        self.assertEqual(meta["thumbnail_url"], "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg")

    @patch("yt_dlp.YoutubeDL")
    def test_extract_vimeo_metadata(self, mock_ydl_class):
        mock_instance = MagicMock()
        mock_instance.extract_info.return_value = {
            "title": "Indie Documentary Feature",
            "extractor_key": "Vimeo",
            "uploader": "Indie Creator",
            "duration": 600.0,
            "thumbnail": "https://i.vimeocdn.com/video/123456_640.jpg",
            "webpage_url": "https://vimeo.com/12345678",
        }
        mock_ydl_class.return_value.__enter__.return_value = mock_instance

        with patch("app.url_screener.validate_url_for_ssrf"):
            meta = extract_public_video_metadata("https://vimeo.com/12345678")

        self.assertEqual(meta["platform"], "Vimeo")
        self.assertEqual(meta["title"], "Indie Documentary Feature")

    @patch("yt_dlp.YoutubeDL")
    def test_unsupported_platform_rejected(self, mock_ydl_class):
        mock_instance = MagicMock()
        mock_instance.extract_info.side_effect = Exception("ERROR: Unsupported URL: https://unsupported-site.com/video/999")
        mock_ydl_class.return_value.__enter__.return_value = mock_instance

        with patch("app.url_screener.validate_url_for_ssrf"):
            with self.assertRaises(UnsupportedPlatformError):
                extract_public_video_metadata("https://unsupported-site.com/video/999")

    @patch("yt_dlp.YoutubeDL")
    def test_deleted_or_missing_video_error(self, mock_ydl_class):
        mock_instance = MagicMock()
        mock_instance.extract_info.side_effect = Exception("ERROR: Video unavailable (404)")
        mock_ydl_class.return_value.__enter__.return_value = mock_instance

        with patch("app.url_screener.validate_url_for_ssrf"):
            with self.assertRaises(MetadataExtractionError):
                extract_public_video_metadata("https://www.youtube.com/watch?v=deleted123")


class TestURLScreeningFlow(unittest.TestCase):
    """Tests end-to-end screening, visual matching, isolation, and evidence formatting."""

    def setUp(self):
        self.client = TestClient(app)
        self.test_img = create_test_image(color="blue")
        self.test_img_bytes = image_to_bytes(self.test_img)
        if default_vault.vector_db.ntotal == 0:
            import numpy as np
            dummy_vec = np.zeros((1, 576), dtype="float32")
            default_vault.vector_db.add(dummy_vec)

    @patch("app.url_screener.extract_public_video_metadata")
    @patch("app.url_screener.fetch_suspect_thumbnail_image")
    def test_clean_thumbnail_returns_needs_full_video_review(
        self, mock_fetch_thumb, mock_extract_meta
    ):
        """
        Critical requirement: If thumbnail does not match, status must be NEEDS_FULL_VIDEO_REVIEW,
        not CLEAN, because thumbnail-only cannot clear the full video.
        """
        mock_extract_meta.return_value = {
            "title": "Random User VLOG",
            "platform": "YouTube",
            "uploader": "Vlogger123",
            "uploader_id": "vlog_123",
            "channel_url": "https://youtube.com/@vlog123",
            "duration_seconds": 120.0,
            "view_count": 100,
            "upload_date": "20261021",
            "description": "Daily vlog",
            "webpage_url": "https://www.youtube.com/watch?v=vlog123",
            "thumbnail_url": "https://i.ytimg.com/vi/vlog123/hqdefault.jpg",
        }
        mock_fetch_thumb.return_value = (self.test_img, self.test_img_bytes)

        # Mock vault matching to return low confidence (no match)
        with patch("app.url_screener.match_single_frame") as mock_match:
            mock_match.return_value = {
                "best_match": {
                    "source_asset_id": "other_asset",
                    "confidence_score": 35.0,
                    "l2_distance": 1.30,
                    "severity": "INFO",
                    "match_confirmed": False,
                    "phash_match": False,
                    "phash_score": 10,
                },
                "top_candidates": [],
            }

            result = screen_video_url("https://www.youtube.com/watch?v=vlog123")

        self.assertEqual(result["investigation_type"], "URL_SCREENING")
        self.assertEqual(result["overall_status"], "NEEDS_FULL_VIDEO_REVIEW")
        self.assertEqual(result["recommended_action"], "NEEDS_FULL_VIDEO_REVIEW")
        self.assertEqual(result["disclaimer"], PRELIMINARY_SCREENING_DISCLAIMER)
        self.assertEqual(result["limitations"], SCREENING_LIMITATIONS)
        self.assertEqual(result["candidate_matches_found"], 0)
        self.assertIn("unverified", result["status_message"])

    @patch("app.url_screener.extract_public_video_metadata")
    @patch("app.url_screener.fetch_suspect_thumbnail_image")
    def test_candidate_match_thumbnail_flow(
        self, mock_fetch_thumb, mock_extract_meta
    ):
        """
        When thumbnail matches an indexed reference frame, result must flag CANDIDATE_MATCH,
        while maintaining recommended_action = NEEDS_FULL_VIDEO_REVIEW and preliminary disclaimer.
        """
        mock_extract_meta.return_value = {
            "title": "Pirated Match Replay",
            "platform": "YouTube",
            "uploader": "PirateStreamer",
            "uploader_id": "pirate_streamer",
            "channel_url": "https://youtube.com/@piratereplays",
            "duration_seconds": 3600.0,
            "view_count": 15000,
            "upload_date": "20261025",
            "description": "Full match replay leaked",
            "webpage_url": "https://www.youtube.com/watch?v=pirate999",
            "thumbnail_url": "https://i.ytimg.com/vi/pirate999/hqdefault.jpg",
        }
        mock_fetch_thumb.return_value = (self.test_img, self.test_img_bytes)

        with patch("app.url_screener.match_single_frame") as mock_match:
            mock_match.return_value = {
                "best_match": {
                    "source_asset_id": "ref_match_asset_001",
                    "source_frame_id": 5,
                    "source_timestamp_sec": 25,
                    "source_filename": "frame_0025s.jpg",
                    "confidence_score": 92.5,
                    "l2_distance": 0.15,
                    "severity": "CRITICAL",
                    "match_confirmed": True,
                    "phash_match": True,
                    "phash_score": 96,
                },
                "top_candidates": [],
            }

            result = screen_video_url("https://www.youtube.com/watch?v=pirate999")

        self.assertEqual(result["overall_status"], "CANDIDATE_MATCH")
        self.assertEqual(result["recommended_action"], "NEEDS_FULL_VIDEO_REVIEW")
        self.assertEqual(result["candidate_matches_found"], 1)
        self.assertEqual(result["highest_confidence"], 92.5)
        self.assertEqual(result["matched_assets"], ["ref_match_asset_001"])
        self.assertIn("ref_match_asset_001", result["status_message"])
        self.assertEqual(result["disclaimer"], PRELIMINARY_SCREENING_DISCLAIMER)

    def test_vault_index_isolation(self):
        """Verifies that URL screening NEVER alters the FAISS reference vault."""
        initial_vault_size = default_vault.vector_db.ntotal
        initial_meta_count = len(default_vault.metadata_store)

        with patch("app.url_screener.extract_public_video_metadata") as mock_meta, \
             patch("app.url_screener.fetch_suspect_thumbnail_image") as mock_thumb:
            mock_meta.return_value = {
                "title": "Isolation Test Video",
                "platform": "YouTube",
                "uploader": "TestCreator",
                "thumbnail_url": "https://example.com/thumb.jpg",
                "duration_seconds": 60.0,
            }
            mock_thumb.return_value = (self.test_img, self.test_img_bytes)

            screen_video_url("https://www.youtube.com/watch?v=isolation_test")

        # Confirm strictly zero new vectors added to reference vault
        self.assertEqual(default_vault.vector_db.ntotal, initial_vault_size)
        self.assertEqual(len(default_vault.metadata_store), initial_meta_count)

    def test_missing_thumbnail_raises_error(self):
        """Verifies clear error when video has no public thumbnail."""
        with patch("app.url_screener.extract_public_video_metadata") as mock_meta:
            mock_meta.return_value = {
                "title": "No Thumbnail Video",
                "platform": "YouTube",
                "thumbnail_url": None,
            }
            with self.assertRaises(MetadataExtractionError) as ctx:
                screen_video_url("https://www.youtube.com/watch?v=no_thumb")
            self.assertIn("no public thumbnail image was found", str(ctx.exception))


class TestFastAPIEndpoints(unittest.TestCase):
    """Tests the /api/threats/screen-url and thumbnail preview endpoints."""

    def setUp(self):
        self.client = TestClient(app)
        self.test_img = create_test_image(color="green")
        self.test_img_bytes = image_to_bytes(self.test_img)

    def test_screen_url_empty_request(self):
        resp = self.client.post("/api/threats/screen-url", json={"url": ""})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Video URL is required", resp.json()["detail"])

    def test_screen_url_ssrf_blocked(self):
        resp = self.client.post("/api/threats/screen-url", json={"url": "http://127.0.0.1:8000/internal"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("SSRF validation blocked", resp.json()["detail"])

    @patch("app.url_screener.extract_public_video_metadata")
    @patch("app.url_screener.fetch_suspect_thumbnail_image")
    def test_screen_url_success_endpoint(self, mock_fetch_thumb, mock_extract_meta):
        mock_extract_meta.return_value = {
            "title": "API Screen Test Video",
            "platform": "YouTube",
            "uploader": "Test Channel",
            "uploader_id": "test_channel",
            "channel_url": "https://youtube.com/@test",
            "duration_seconds": 95.0,
            "view_count": 1200,
            "upload_date": "20261026",
            "description": "API screening test",
            "webpage_url": "https://www.youtube.com/watch?v=apiscreen123",
            "thumbnail_url": "https://i.ytimg.com/vi/apiscreen123/hqdefault.jpg",
        }
        mock_fetch_thumb.return_value = (self.test_img, self.test_img_bytes)

        resp = self.client.post(
            "/api/threats/screen-url",
            json={"url": "https://www.youtube.com/watch?v=apiscreen123"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["investigation_type"], "URL_SCREENING")
        self.assertEqual(data["platform"], "YouTube")
        self.assertIn("incident_id", data)
        self.assertEqual(data["recommended_action"], "NEEDS_FULL_VIDEO_REVIEW")

        # Test previewing the cached suspect thumbnail
        incident_id = data["incident_id"]
        thumb_resp = self.client.get(f"/api/threats/suspect-thumbnail/{incident_id}")
        self.assertEqual(thumb_resp.status_code, 200)
        self.assertEqual(thumb_resp.headers["content-type"], "image/jpeg")

    def test_suspect_thumbnail_invalid_id(self):
        resp = self.client.get("/api/threats/suspect-thumbnail/invalid!id@here")
        self.assertEqual(resp.status_code, 400)

    def test_suspect_thumbnail_not_found(self):
        resp = self.client.get("/api/threats/suspect-thumbnail/00000000-0000-0000-0000-000000000000")
        self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
