"""Offline request-security regressions; no real credentials or external services."""
import os
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.security import RequestProtectionMiddleware, cors_origins, safe_diagnostic


class TestRequestProtection(unittest.TestCase):
    def app(self, size=16, limit=2):
        app = FastAPI()
        app.add_middleware(RequestProtectionMiddleware, max_body_bytes=size, requests_per_minute=limit)
        @app.post("/api/test")
        async def endpoint():
            return {"ok": True}
        return app

    def test_content_length_and_streamed_size_limit(self):
        client = TestClient(self.app(limit=10))
        self.assertEqual(client.post("/api/test", content=b"x" * 17).status_code, 413)
        # No Content-Length: do not trust the caller to declare the real size.
        self.assertEqual(client.post("/api/test", content=iter([b"x" * 10, b"x" * 10])).status_code, 413)
        self.assertEqual(client.post("/api/test", content=b"small").status_code, 200)

    def test_rate_limit_does_not_trust_spoofed_forwarding_headers(self):
        client = TestClient(self.app())
        self.assertEqual(client.post("/api/test").status_code, 200)
        self.assertEqual(client.post("/api/test").status_code, 200)
        result = client.post("/api/test", headers={"X-Forwarded-For": "8.8.8.8"})
        self.assertEqual(result.status_code, 429)
        self.assertEqual(result.headers["retry-after"], "60")

    def test_cors_configuration_rejects_wildcards_and_accepts_hosted_origins(self):
        with patch.dict(os.environ, {"FIXPROOF_CORS_ORIGINS": "https://frontend.example.com,http://localhost:3000"}):
            self.assertIn("https://frontend.example.com", cors_origins())
        for invalid in ("*", "https://user:password@site.example", "https://site.example/path"):
            with patch.dict(os.environ, {"FIXPROOF_CORS_ORIGINS": invalid}):
                with self.assertRaises(ValueError):
                    cors_origins()

    def test_diagnostic_redacts_configured_keys_and_database_uris(self):
        with patch.dict(os.environ, {"NEBIUS_API_KEY": "test-secret-key"}):
            text = safe_diagnostic("failed test-secret-key postgresql://user:pass@host/db")
            self.assertNotIn("test-secret-key", text)
            self.assertNotIn("user:pass", text)


class TestSecurityRoutes(unittest.TestCase):
    def setUp(self):
        from app.main import app
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_cors_allows_local_frontend_and_rejects_unlisted_origin(self):
        for origin, expected in (("http://localhost:3000", True), ("https://unlisted.example", False)):
            r = self.client.options("/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
            self.assertEqual(r.status_code, 200 if expected else 400)
            self.assertEqual(r.headers.get("access-control-allow-origin"), origin if expected else None)
            self.assertNotIn("access-control-allow-credentials", r.headers)

    def test_cors_allows_production_frontend_preflight_across_core_routes(self):
        prod_origin = "https://fixproof-frontend-1097663016023.europe-west1.run.app"
        headers = {
            "Origin": prod_origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type,x-client-session-id",
        }
        for path in ("/health", "/api/muse/status", "/api/muse/incidents", "/api/vault/status"):
            r = self.client.options(path, headers=headers)
            self.assertEqual(r.status_code, 200, f"Preflight failed for {path}: {r.text}")
            self.assertEqual(r.headers.get("access-control-allow-origin"), prod_origin)
            allow_methods = r.headers.get("access-control-allow-methods", "")
            self.assertIn("GET", allow_methods)
            self.assertIn("OPTIONS", allow_methods)
            allow_headers = r.headers.get("access-control-allow-headers", "").lower()
            self.assertIn("authorization", allow_headers)
            self.assertIn("content-type", allow_headers)
            self.assertNotIn("access-control-allow-credentials", r.headers)

    def test_cors_trailing_slash_normalization(self):
        prod_origin_with_slash = "https://fixproof-frontend-1097663016023.europe-west1.run.app/"
        headers = {
            "Origin": prod_origin_with_slash,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
        }
        r = self.client.options("/api/muse/status", headers=headers)
        self.assertEqual(r.status_code, 200)

    def test_session_owned_incident_requires_matching_header(self):
        from app import main
        with patch.object(main, "get_incident_by_id", return_value={"incident_id": "private-incident", "session_id": "owner-session"}):
            for headers in ({}, {"X-Client-Session-Id": "other-session"}):
                self.assertEqual(self.client.get("/api/incidents/private-incident", headers=headers).status_code, 403)
                self.assertEqual(self.client.post("/api/threats/private-incident/investigate", json={}, headers=headers).status_code, 403)
            self.assertEqual(self.client.get("/api/incidents/private-incident", headers={"X-Client-Session-Id": "owner-session"}).status_code, 200)

    def test_internal_exception_detail_does_not_reach_client(self):
        from app import main
        with patch.object(main, "screen_video_url", side_effect=RuntimeError("private-key /internal/path trace")):
            response = self.client.post("/api/threats/screen-url", json={"url": "https://example.com/video"})
            self.assertEqual(response.status_code, 500)
            self.assertNotIn("private-key", response.text)
            self.assertNotIn("/internal/path", response.text)

    def test_invalid_extension_and_malformed_video_are_rejected(self):
        for endpoint in ("/api/vault/ingest", "/api/threats/scan"):
            response = self.client.post(endpoint, files={"file": ("../../invalid.txt", b"invalid", "text/plain")})
            self.assertEqual(response.status_code, 400)
            response = self.client.post(endpoint, files={"file": ("../../corrupt.mov", b"invalid video", "video/quicktime")})
            self.assertEqual(response.status_code, 422)

    def test_video_oversize_rejected_before_processing(self):
        from app import main
        with patch.object(main, "MAX_FILE_SIZE_BYTES", 8), patch.object(main, "preflight_video_file") as preflight:
            for endpoint in ("/api/vault/ingest", "/api/threats/scan"):
                response = self.client.post(endpoint, files={"file": ("large.mp4", b"x" * 9, "video/mp4")})
                self.assertEqual(response.status_code, 413)
            preflight.assert_not_called()

    def test_package_read_bounded_before_zip_verification(self):
        from app import main
        with patch("app.evidence_package.MAX_VERIFICATION_ZIP_BYTES", 8), patch.object(main, "verify_evidence_package") as verify:
            response = self.client.post("/api/threats/reports/verify-package", files={"file": ("large.zip", b"x" * 9, "application/zip")})
            self.assertEqual(response.status_code, 413)
            verify.assert_not_called()
