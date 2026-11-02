"""
Comprehensive Regression Test Suite for Forensic PDF Retrieval Stabilization (Task 1).

Tests:
1. Retrieval using normal existing report UUID.
2. Retrieval when filename with .pdf extension or prefix is passed.
3. Fallback resolution when requested via incident_id.
4. Fallback resolution when requested via Nemotron investigation report ID.
5. Deterministic resolution when multiple reports exist for an incident (newest selected).
6. Missing report or incident returns clean 404 (no synthesis on retrieval).
7. Path traversal prevention (.., slashes, null bytes).
8. Alias endpoint /api/reports/{id}/pdf compatibility.
9. Truncated 8-character prefix resolution.
10. Session isolation enforcement (403 for unauthorized session).
"""

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.detailed_report import (
    save_detailed_report,
    resolve_detailed_report_pdf,
    get_detailed_report_pdf_bytes,
    get_detailed_report_record,
    normalize_report_identifier,
    list_detailed_reports_for_incident,
)


class TestPdfRetrievalStabilization(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.tmp_dir = tempfile.mkdtemp()
        self.temp_reports_dir = Path(self.tmp_dir) / "detailed_reports"
        self.temp_reports_dir.mkdir(parents=True, exist_ok=True)

        self.incident_id = f"test-inc-{uuid.uuid4().hex[:8]}"
        self.report_id_1 = str(uuid.uuid4())
        self.report_id_2 = str(uuid.uuid4())

        self.dummy_pdf_1 = b"%PDF-1.4 Report 1 content " + b"X" * 100
        self.dummy_pdf_2 = b"%PDF-1.4 Report 2 content " + b"Y" * 100

        self.report_data_1 = {
            "report_id": self.report_id_1,
            "incident_id": self.incident_id,
            "generated_at": "2026-11-01T10:00:00Z",
            "model_id": "muse-wonder-1.0",
            "ai_synthesized": True,
            "sections": {"executive_summary": "Summary for report 1"},
        }

        self.report_data_2 = {
            "report_id": self.report_id_2,
            "incident_id": self.incident_id,
            "generated_at": "2026-11-01T14:30:00Z",  # newer
            "model_id": "muse-wonder-1.0",
            "ai_synthesized": True,
            "sections": {"executive_summary": "Summary for report 2"},
        }

        self.sample_incident = {
            "incident_id": self.incident_id,
            "session_id": "session-auth-123",
            "suspect_filename": "highlight_clip.mp4",
        }

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    @patch("app.detailed_report.DETAILED_REPORTS_DIR")
    def test_normalize_report_identifier(self, mock_dir):
        mock_dir.__truediv__ = lambda s, p: self.temp_reports_dir / p
        self.assertEqual(normalize_report_identifier("  report_12345.pdf  "), "12345")
        self.assertEqual(normalize_report_identifier("fixproof-forensic-report-abcdef12.pdf"), "abcdef12")
        self.assertEqual(normalize_report_identifier("fixproof-meta-forensic-report-abcdef12.pdf"), "abcdef12")
        self.assertEqual(normalize_report_identifier("report_509e20c5.json"), "509e20c5")
        self.assertEqual(normalize_report_identifier("509e20c5?download=true"), "509e20c5")
        self.assertEqual(normalize_report_identifier(""), "")

    def test_retrieval_using_normal_existing_identifier(self):
        with patch("app.detailed_report.DETAILED_REPORTS_DIR", self.temp_reports_dir):
            save_detailed_report(self.incident_id, self.report_data_1, self.dummy_pdf_1)

            # Python function check
            res = resolve_detailed_report_pdf(self.report_id_1)
            self.assertIsNotNone(res)
            pdf_bytes, record, resolved_id, inc_id = res
            self.assertEqual(pdf_bytes, self.dummy_pdf_1)
            self.assertEqual(resolved_id, self.report_id_1)
            self.assertEqual(inc_id, self.incident_id)

            # Direct bytes helper check
            bytes_out = get_detailed_report_pdf_bytes(self.report_id_1)
            self.assertEqual(bytes_out, self.dummy_pdf_1)

    def test_retrieval_when_cached_filename_or_extension_passed(self):
        with patch("app.detailed_report.DETAILED_REPORTS_DIR", self.temp_reports_dir):
            save_detailed_report(self.incident_id, self.report_data_1, self.dummy_pdf_1)

            # Try variants that frontend might pass
            for variant in (
                f"report_{self.report_id_1}.pdf",
                f"{self.report_id_1}.pdf",
                f"report_{self.report_id_1}",
                f"fixproof-forensic-report-{self.report_id_1[:8]}.pdf",
            ):
                res = resolve_detailed_report_pdf(variant)
                self.assertIsNotNone(res, f"Failed to resolve variant: {variant}")
                self.assertEqual(res[0], self.dummy_pdf_1)

    def test_fallback_resolution_through_incident_id(self):
        with patch("app.detailed_report.DETAILED_REPORTS_DIR", self.temp_reports_dir):
            save_detailed_report(self.incident_id, self.report_data_1, self.dummy_pdf_1)

            # Passing incident_id directly resolves the report PDF
            res = resolve_detailed_report_pdf(self.incident_id)
            self.assertIsNotNone(res)
            self.assertEqual(res[0], self.dummy_pdf_1)
            self.assertEqual(res[2], self.report_id_1)
            self.assertEqual(res[3], self.incident_id)

    def test_fallback_resolution_through_investigation_report_id(self):
        with patch("app.detailed_report.DETAILED_REPORTS_DIR", self.temp_reports_dir):
            save_detailed_report(self.incident_id, self.report_data_1, self.dummy_pdf_1)

            nem_report_id = f"rep_{uuid.uuid4().hex[:8]}"
            mock_nem_report = {
                "report_id": nem_report_id,
                "incident_id": self.incident_id,
                "created_at": "2026-11-01T09:00:00Z",
            }

            with patch("app.registry.get_nemotron_report_by_id", return_value=mock_nem_report):
                res = resolve_detailed_report_pdf(nem_report_id)
                self.assertIsNotNone(res)
                self.assertEqual(res[0], self.dummy_pdf_1)
                self.assertEqual(res[3], self.incident_id)

    def test_multiple_reports_associated_with_incident_resolved_deterministically(self):
        with patch("app.detailed_report.DETAILED_REPORTS_DIR", self.temp_reports_dir):
            # Save older report first, then newer report
            save_detailed_report(self.incident_id, self.report_data_1, self.dummy_pdf_1)
            save_detailed_report(self.incident_id, self.report_data_2, self.dummy_pdf_2)

            # Resolving by incident_id must deterministically return report_2 (the newer one)
            res = resolve_detailed_report_pdf(self.incident_id)
            self.assertIsNotNone(res)
            self.assertEqual(res[0], self.dummy_pdf_2)
            self.assertEqual(res[2], self.report_id_2)

    def test_missing_report_returns_none_and_404(self):
        with patch("app.detailed_report.DETAILED_REPORTS_DIR", self.temp_reports_dir):
            non_existent_id = str(uuid.uuid4())
            res = resolve_detailed_report_pdf(non_existent_id)
            self.assertIsNone(res)

            # API endpoint test
            api_res = self.client.get(f"/api/nemotron/detailed-report/{non_existent_id}/pdf")
            self.assertEqual(api_res.status_code, 404)
            self.assertIn("not found", api_res.json()["detail"].lower())

    def test_alias_endpoint_and_headers(self):
        with patch("app.detailed_report.DETAILED_REPORTS_DIR", self.temp_reports_dir), \
             patch("app.main.get_incident_by_id", return_value=self.sample_incident), \
             patch("app.main.is_demo_mode", return_value=True):
            save_detailed_report(self.incident_id, self.report_data_1, self.dummy_pdf_1)

            # Test canonical endpoint
            res1 = self.client.get(
                f"/api/nemotron/detailed-report/{self.report_id_1}/pdf",
                headers={"X-Client-Session-Id": "session-auth-123"},
            )
            self.assertEqual(res1.status_code, 200)
            self.assertEqual(res1.headers["content-type"], "application/pdf")
            self.assertIn(f"fixproof-forensic-report-{self.report_id_1[:8]}.pdf", res1.headers["content-disposition"])
            self.assertEqual(res1.content, self.dummy_pdf_1)

            # Test alias endpoint /api/reports/{id}/pdf
            res2 = self.client.get(
                f"/api/reports/{self.report_id_1}/pdf",
                headers={"X-Client-Session-Id": "session-auth-123"},
            )
            self.assertEqual(res2.status_code, 200)
            self.assertEqual(res2.headers["content-type"], "application/pdf")
            self.assertEqual(res2.content, self.dummy_pdf_1)

            # Test download using incident_id on alias endpoint
            res3 = self.client.get(
                f"/api/reports/{self.incident_id}/pdf",
                headers={"X-Client-Session-Id": "session-auth-123"},
            )
            self.assertEqual(res3.status_code, 200)
            self.assertEqual(res3.content, self.dummy_pdf_1)

    def test_path_traversal_prevention(self):
        with patch("app.detailed_report.DETAILED_REPORTS_DIR", self.temp_reports_dir):
            traversal_attempts = [
                "../../etc/passwd",
                "..%2f..%2fetc%2fpasswd",
                "../../storage/incidents.json",
                "/etc/shadow",
                "report_../passwd.pdf",
            ]
            for attempt in traversal_attempts:
                # Direct resolver rejects
                self.assertIsNone(resolve_detailed_report_pdf(attempt))
                # API endpoint rejects
                res = self.client.get(f"/api/nemotron/detailed-report/{attempt}/pdf")
                self.assertIn(res.status_code, (400, 404))

    def test_session_isolation_enforcement(self):
        with patch("app.detailed_report.DETAILED_REPORTS_DIR", self.temp_reports_dir), \
             patch("app.main.get_incident_by_id", return_value=self.sample_incident), \
             patch("app.main.is_demo_mode", return_value=False):
            save_detailed_report(self.incident_id, self.report_data_1, self.dummy_pdf_1)

            # Request with mismatched session
            res_denied = self.client.get(
                f"/api/nemotron/detailed-report/{self.report_id_1}/pdf",
                headers={"X-Client-Session-Id": "unauthorized-session-999"},
            )
            self.assertEqual(res_denied.status_code, 403)
            self.assertIn("access denied", res_denied.json()["detail"].lower())

            # Request with authorized session
            res_allowed = self.client.get(
                f"/api/nemotron/detailed-report/{self.report_id_1}/pdf",
                headers={"X-Client-Session-Id": "session-auth-123"},
            )
            self.assertEqual(res_allowed.status_code, 200)
            self.assertEqual(res_allowed.content, self.dummy_pdf_1)


if __name__ == "__main__":
    unittest.main()

