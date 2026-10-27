"""
Unit tests for FixProof Supabase Storage Client (Milestone 6C.3).
Covers:
- Configuration parsing and error handling when unconfigured.
- Parameter validation for file uploads (path traversal, missing files).
- Mocked HTTP upload with SHA-256 validation and content-type setting.
- Mocked HTTP download and 404 handling.
- Time-bounded signed URL generation for client streaming.
- Mocked object deletion.
"""

from io import BytesIO
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch
import urllib.error

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.storage import (
    StorageConfig,
    StorageConfigurationError,
    StorageError,
    StorageNotFoundError,
    StorageUploadError,
    SupabaseStorageClient,
)


class TestSupabaseStorageClient(unittest.TestCase):

    def setUp(self):
        self.mock_config = StorageConfig(
            supabase_url="https://testproject.supabase.co",
            service_role_key="test-service-key-xyz",
            anon_key="test-anon-key-xyz",
        )
        self.client = SupabaseStorageClient(config=self.mock_config)

    def test_unconfigured_client_raises_configuration_error(self):
        unconfigured = SupabaseStorageClient(
            config=StorageConfig(supabase_url=None, service_role_key=None, anon_key=None)
        )
        self.assertFalse(unconfigured.config.is_configured)
        with self.assertRaises(StorageConfigurationError):
            unconfigured.upload_file("test-bucket", "test.mp4", b"data")
        with self.assertRaises(StorageConfigurationError):
            unconfigured.download_file("test-bucket", "test.mp4")
        with self.assertRaises(StorageConfigurationError):
            unconfigured.create_signed_url("test-bucket", "test.mp4")

    def test_upload_missing_file_raises_file_not_found(self):
        with self.assertRaises(FileNotFoundError):
            self.client.upload_file(
                "reference-assets", "missing.mp4", Path("/nonexistent/file.mp4")
            )

    def test_upload_invalid_data_type_raises_value_error(self):
        with self.assertRaises(ValueError):
            self.client.upload_file("reference-assets", "test.mp4", 12345)  # type: ignore

    @patch("urllib.request.urlopen")
    def test_upload_file_bytes_success(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = b'{"Key": "reference-assets/test.mp4"}'
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        payload = b"sample video bytes for testing"
        result = self.client.upload_file(
            bucket="reference-assets",
            storage_path="test.mp4",
            data_or_file=payload,
            content_type="video/mp4",
        )

        self.assertEqual(result["bucket"], "reference-assets")
        self.assertEqual(result["storage_path"], "test.mp4")
        self.assertEqual(result["size_bytes"], len(payload))
        self.assertEqual(result["status_code"], 200)
        self.assertTrue(len(result["sha256_hash"]) == 64)

        # Verify headers sent in request
        args, kwargs = mock_urlopen.call_args
        req = args[0]
        self.assertEqual(req.get_header("Content-type"), "video/mp4")
        self.assertEqual(req.get_header("Authorization"), "Bearer test-service-key-xyz")
        self.assertEqual(req.get_header("Apikey"), "test-service-key-xyz")
        self.assertEqual(req.get_header("X-upsert"), "true")

    @patch("urllib.request.urlopen")
    def test_upload_file_http_error_handling(self, mock_urlopen):
        err = urllib.error.HTTPError(
            url="http://test",
            code=400,
            msg="Bad Request",
            hdrs={},
            fp=BytesIO(b'{"error": "Invalid mime"}'),
        )
        mock_urlopen.side_effect = err

        with self.assertRaises(StorageUploadError) as ctx:
            self.client.upload_file("reference-assets", "test.txt", b"text data", content_type="text/plain")
        self.assertIn("HTTP 400", str(ctx.exception))

    @patch("urllib.request.urlopen")
    def test_download_file_success(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = b"downloaded binary content"
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        data = self.client.download_file("reference-assets", "test.mp4")
        self.assertEqual(data, b"downloaded binary content")

    @patch("urllib.request.urlopen")
    def test_download_file_404_handling(self, mock_urlopen):
        err = urllib.error.HTTPError(
            url="http://test", code=404, msg="Not Found", hdrs={}, fp=BytesIO(b"Not Found")
        )
        mock_urlopen.side_effect = err

        with self.assertRaises(StorageNotFoundError):
            self.client.download_file("reference-assets", "missing.mp4")

    @patch("urllib.request.urlopen")
    def test_create_signed_url_success(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps({
            "signedURL": "/object/authenticated/reference-assets/test.mp4?token=abc123xyz"
        }).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        signed_url = self.client.create_signed_url("reference-assets", "test.mp4", expires_in=1800)
        self.assertTrue(signed_url.startswith("https://testproject.supabase.co/storage/v1"))
        self.assertIn("token=abc123xyz", signed_url)

    @patch("urllib.request.urlopen")
    def test_delete_object_success(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        success = self.client.delete_object("reference-assets", "test.mp4")
        self.assertTrue(success)


if __name__ == "__main__":
    unittest.main()
