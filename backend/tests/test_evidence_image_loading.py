"""
Comprehensive Regression Test Suite for Evidence Image Loading Stabilization (Task 2).

Tests:
1. Reference frame resolution across approved storage roots.
2. Suspect frame resolution with exact filename and timestamp variants (frame_0005s.jpg, frame_5s.jpg).
3. Frame resolution via incident_id falling back to submitted_asset_id.
4. Closest timestamp keyframe fallback when requested frame has minor time delta.
5. Suspect thumbnail resolution and uploaded video keyframe fallback (frame_0000s.jpg).
6. Path traversal rejection in resolver and API endpoints.
7. Route aliases for streaming frames (/api/vault/assets/..., /api/incidents/..., /api/threats/...).
8. Route aliases for thumbnails (/api/threats/suspect-thumbnail/..., /api/incidents/.../thumbnail).
9. Annotated frame endpoint (/api/incidents/.../frames/.../annotated and /api/forensics/.../annotated-frame/...).
10. Clean 404 handling for nonexistent frames.
"""

from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import uuid

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app, SUSPECTS_FRAMES_DIR, SUSPECTS_THUMBNAILS_DIR, FRAMES_DIR
from app.temporal_selector import (
    resolve_frame_path,
    load_frame_image_bytes,
    get_storage_roots,
    is_safe_storage_path,
)


def create_dummy_jpeg(color: tuple = (120, 150, 180), size: tuple = (100, 100)) -> bytes:
    img = Image.new("RGB", size, color=color)
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


class TestEvidenceImageLoading(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.tmp_dir = tempfile.mkdtemp()
        self.test_asset_id = f"test-asset-{uuid.uuid4().hex[:8]}"
        self.test_incident_id = f"test-inc-{uuid.uuid4().hex[:8]}"

        self.jpeg_bytes = create_dummy_jpeg()

    def test_storage_roots_and_safety_containment(self):
        roots = get_storage_roots()
        self.assertTrue(len(roots) >= 4)
        for r in roots:
            self.assertTrue(is_safe_storage_path(r, roots))

        # Path traversal checks
        unsafe_paths = [
            Path("/etc/passwd"),
            Path("/var/log/system.log"),
            Path(tempfile.gettempdir()) / ".." / ".." / "etc" / "shadow",
        ]
        for p in unsafe_paths:
            self.assertFalse(is_safe_storage_path(p, roots))

    def test_resolve_frame_path_traversal_rejection(self):
        resolved, err = resolve_frame_path("../../../etc/passwd")
        self.assertIsNone(resolved)
        self.assertIn("Path traversal", err)

        resolved, err = resolve_frame_path("/storage/../../etc/passwd")
        self.assertIsNone(resolved)
        self.assertIn("Path traversal", err)

    def test_resolve_frame_path_reference_frame(self):
        # Create a mock reference frame in FRAMES_DIR
        asset_frames_dir = FRAMES_DIR / self.test_asset_id
        asset_frames_dir.mkdir(parents=True, exist_ok=True)
        frame_file = asset_frames_dir / "frame_0005s.jpg"
        frame_file.write_bytes(self.jpeg_bytes)

        try:
            resolved, err = resolve_frame_path(
                None, asset_id=self.test_asset_id, filename="frame_0005s.jpg"
            )
            self.assertIsNotNone(resolved)
            self.assertIsNone(err)
            self.assertEqual(resolved.resolve(), frame_file.resolve())

            # Load bytes
            data, b_err = load_frame_image_bytes(
                None, asset_id=self.test_asset_id, filename="frame_0005s.jpg"
            )
            self.assertIsNotNone(data)
            self.assertEqual(data, self.jpeg_bytes)
        finally:
            if frame_file.exists():
                frame_file.unlink()
            if asset_frames_dir.exists():
                asset_frames_dir.rmdir()

    def test_resolve_frame_path_timestamp_variants(self):
        # Create a frame named frame_0010s.jpg
        suspect_dir = SUSPECTS_FRAMES_DIR / self.test_asset_id
        suspect_dir.mkdir(parents=True, exist_ok=True)
        frame_file = suspect_dir / "frame_0010s.jpg"
        frame_file.write_bytes(self.jpeg_bytes)

        try:
            # Query with unpadded variant: frame_10s.jpg
            resolved, err = resolve_frame_path(
                None, asset_id=self.test_asset_id, filename="frame_10s.jpg"
            )
            self.assertIsNotNone(resolved)
            self.assertIsNone(err)
            self.assertEqual(resolved.resolve(), frame_file.resolve())

            # Query with no 's' variant: frame_0010.jpg
            resolved, err = resolve_frame_path(
                None, asset_id=self.test_asset_id, filename="frame_0010.jpg"
            )
            self.assertIsNotNone(resolved)
            self.assertIsNone(err)
            self.assertEqual(resolved.resolve(), frame_file.resolve())
        finally:
            if frame_file.exists():
                frame_file.unlink()
            if suspect_dir.exists():
                suspect_dir.rmdir()

    def test_resolve_frame_path_closest_keyframe_fallback(self):
        suspect_dir = SUSPECTS_FRAMES_DIR / self.test_asset_id
        suspect_dir.mkdir(parents=True, exist_ok=True)
        frame_0000 = suspect_dir / "frame_0000s.jpg"
        frame_0005 = suspect_dir / "frame_0005s.jpg"
        frame_0000.write_bytes(self.jpeg_bytes)
        frame_0005.write_bytes(self.jpeg_bytes)

        try:
            # Request frame_0001s.jpg (which doesn't exist on disk, closest is frame_0000s.jpg)
            resolved, err = resolve_frame_path(
                None, asset_id=self.test_asset_id, filename="frame_0001s.jpg"
            )
            self.assertIsNotNone(resolved)
            self.assertIsNone(err)
            self.assertEqual(resolved.name, "frame_0000s.jpg")
        finally:
            if frame_0000.exists():
                frame_0000.unlink()
            if frame_0005.exists():
                frame_0005.unlink()
            if suspect_dir.exists():
                suspect_dir.rmdir()

    def test_stream_asset_frame_endpoints_and_aliases(self):
        # Place test frame in SUSPECTS_FRAMES_DIR
        suspect_dir = SUSPECTS_FRAMES_DIR / self.test_asset_id
        suspect_dir.mkdir(parents=True, exist_ok=True)
        frame_file = suspect_dir / "frame_0000s.jpg"
        frame_file.write_bytes(self.jpeg_bytes)

        try:
            # 1. Primary endpoint
            resp1 = self.client.get(f"/api/vault/assets/{self.test_asset_id}/frames/frame_0000s.jpg")
            self.assertEqual(resp1.status_code, 200)
            self.assertEqual(resp1.headers["content-type"], "image/jpeg")
            self.assertEqual(resp1.content, self.jpeg_bytes)

            # 2. Incident frames alias
            resp2 = self.client.get(f"/api/incidents/{self.test_asset_id}/frames/frame_0000s.jpg")
            self.assertEqual(resp2.status_code, 200)
            self.assertEqual(resp2.headers["content-type"], "image/jpeg")

            # 3. Threat frames alias
            resp3 = self.client.get(f"/api/threats/{self.test_asset_id}/frames/frame_0000s.jpg")
            self.assertEqual(resp3.status_code, 200)
            self.assertEqual(resp3.headers["content-type"], "image/jpeg")

            # 4. Closest frame resolution through HTTP endpoint
            resp4 = self.client.get(f"/api/vault/assets/{self.test_asset_id}/frames/frame_0002s.jpg")
            self.assertEqual(resp4.status_code, 200)
            self.assertEqual(resp4.headers["content-type"], "image/jpeg")
        finally:
            if frame_file.exists():
                frame_file.unlink()
            if suspect_dir.exists():
                suspect_dir.rmdir()

    def test_suspect_thumbnail_endpoint_and_uploaded_video_fallback(self):
        # Scenario A: Direct thumbnail file exists
        thumb_file = SUSPECTS_THUMBNAILS_DIR / f"{self.test_incident_id}.jpg"
        thumb_file.parent.mkdir(parents=True, exist_ok=True)
        thumb_file.write_bytes(self.jpeg_bytes)

        try:
            resp_a = self.client.get(f"/api/threats/suspect-thumbnail/{self.test_incident_id}")
            self.assertEqual(resp_a.status_code, 200)
            self.assertEqual(resp_a.headers["content-type"], "image/jpeg")

            # Test alias endpoint /api/incidents/{id}/thumbnail
            resp_alias = self.client.get(f"/api/incidents/{self.test_incident_id}/thumbnail")
            self.assertEqual(resp_alias.status_code, 200)
            self.assertEqual(resp_alias.headers["content-type"], "image/jpeg")
        finally:
            if thumb_file.exists():
                thumb_file.unlink()

        # Scenario B: No separate thumbnail file, but suspect frames exist (uploaded video)
        suspect_dir = SUSPECTS_FRAMES_DIR / self.test_incident_id
        suspect_dir.mkdir(parents=True, exist_ok=True)
        frame_0 = suspect_dir / "frame_0000s.jpg"
        frame_0.write_bytes(self.jpeg_bytes)

        try:
            resp_b = self.client.get(f"/api/threats/suspect-thumbnail/{self.test_incident_id}")
            self.assertEqual(resp_b.status_code, 200)
            self.assertEqual(resp_b.headers["content-type"], "image/jpeg")

            resp_b_alias = self.client.get(f"/api/incidents/{self.test_incident_id}/thumbnail")
            self.assertEqual(resp_b_alias.status_code, 200)
            self.assertEqual(resp_b_alias.headers["content-type"], "image/jpeg")
        finally:
            if frame_0.exists():
                frame_0.unlink()
            if suspect_dir.exists():
                suspect_dir.rmdir()

    def test_stream_annotated_frame_suspect_and_reference(self):
        # Mock incident in registry
        mock_incident = {
            "incident_id": self.test_incident_id,
            "session_id": "demo-showcase",
            "submitted_asset_id": self.test_asset_id,
            "frame_matches": [
                {
                    "submitted_frame": {
                        "asset_id": self.test_asset_id,
                        "filename": "frame_0000s.jpg",
                        "timestamp_sec": 0.0,
                    },
                    "best_match": {
                        "source_asset_id": "other_asset",  # negative match
                        "source_filename": "",
                        "source_timestamp_sec": 0.0,
                        "match_confirmed": False,
                    },
                }
            ],
        }

        # Put suspect frame on disk
        suspect_dir = SUSPECTS_FRAMES_DIR / self.test_asset_id
        suspect_dir.mkdir(parents=True, exist_ok=True)
        frame_file = suspect_dir / "frame_0000s.jpg"
        frame_file.write_bytes(self.jpeg_bytes)

        try:
            with patch("app.main.get_incident_by_id", return_value=mock_incident):
                # Suspect annotated frame
                resp_s = self.client.get(
                    f"/api/incidents/{self.test_incident_id}/frames/0/annotated?target=suspect"
                )
                self.assertEqual(resp_s.status_code, 200)
                self.assertEqual(resp_s.headers["content-type"], "image/jpeg")

                # Alias route: /api/forensics/.../annotated-frame/0
                resp_s_alias = self.client.get(
                    f"/api/forensics/{self.test_incident_id}/annotated-frame/0?target=suspect"
                )
                self.assertEqual(resp_s_alias.status_code, 200)
                self.assertEqual(resp_s_alias.headers["content-type"], "image/jpeg")

                # Reference annotated frame when source_asset_id is 'other_asset' (negative match)
                # Should safely 404 because no reference frame exists
                resp_r = self.client.get(
                    f"/api/incidents/{self.test_incident_id}/frames/0/annotated?target=reference"
                )
                self.assertEqual(resp_r.status_code, 404)
        finally:
            if frame_file.exists():
                frame_file.unlink()
            if suspect_dir.exists():
                suspect_dir.rmdir()

    def test_invalid_parameters_and_missing_frame_404(self):
        # Malformed asset ID (path traversal characters)
        resp_bad = self.client.get("/api/vault/assets/../../frames/frame_0000s.jpg")
        self.assertIn(resp_bad.status_code, [400, 404])

        # Nonexistent asset ID
        resp_404 = self.client.get("/api/vault/assets/nonexistent-uuid-1234/frames/frame_9999s.jpg")
        self.assertEqual(resp_404.status_code, 404)


if __name__ == "__main__":
    unittest.main()

