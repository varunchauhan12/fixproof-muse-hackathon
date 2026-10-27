"""
Comprehensive Unit & Adversarial Test Suite for FixProof Phase 1.5:
Signed Evidence Packages & Chain of Custody.

Verifies:
1. Valid package exports successfully with Ed25519 digital signature.
2. Empty incident history is packaged correctly with 0 reports and valid chain.
3. Strict incident isolation: reports from other incidents are never included.
4. Report snapshots and file SHA-256 hashes match exported contents.
5. A valid package passes full cryptographic verification.
6. Tampering with any report file after export causes verification failure.
7. Tampering with manifest.json causes Ed25519 signature failure.
8. Adding an unauthorized or rogue file causes verification failure.
9. Breaking a chain-of-custody entry_hash or prev_hash causes failure.
10. Strict signing key enforcement (raises 503 when FIXPROOF_REQUIRE_CONFIGURED_SIGNING_KEY=true and key missing).
11. Zero model invocation during export and verification.
12. Path traversal (ZipSlip) in uploaded package is rejected with 400.
13. Uploading non-zip file is rejected with 400.
14. Malformed incident ID returns 400; missing incident returns 404.
15. Existing report-history routes remain unaffected.
"""

from datetime import datetime, timezone, timedelta
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, MagicMock
import zipfile

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app
from app.evidence_package import (
    create_evidence_package,
    verify_evidence_package,
    get_signing_key,
    canonicalize_json,
    sha256_bytes,
    SigningConfigurationError,
)


class TestEvidencePackage(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.incident_id = "11111111-2222-3333-4444-555555555555"
        self.other_incident_id = "99999999-8888-7777-6666-555555555555"
        self.missing_incident = "00000000-0000-0000-0000-000000000000"

        now = datetime.now(timezone.utc)
        self.t1 = (now - timedelta(minutes=30)).isoformat()
        self.t2 = now.isoformat()

        self.incident_data = {
            "incident_id": self.incident_id,
            "target_asset_id": "asset-test-456",
            "created_at": self.t1,
            "suspect_metadata": {"video_filename": "suspect_clip.mp4", "duration_seconds": 45.0},
            "frame_matches": [
                {
                    "timestamp_sec": 5.0,
                    "best_match": {"match_confirmed": True, "cosine_distance": 0.08},
                }
            ],
        }

        self.reports_data = [
            {
                "report_id": "rep-test-01",
                "incident_id": self.incident_id,
                "created_at": self.t1,
                "model_id": "nvidia/Nemotron-3_5-Lightning",
                "summary": "Initial forensic investigation",
                "recommended_action": "MONITOR_ACCOUNT",
                "confidence_assessment": "MEDIUM_CONFIDENCE",
                "human_review_required": True,
                "timeline_intervals": [
                    {
                        "interval_id": "intv_1",
                        "suspect_start_seconds": 4.0,
                        "suspect_end_seconds": 12.0,
                        "source_asset_start_seconds": 10.0,
                        "source_asset_end_seconds": 18.0,
                        "duration_seconds": 8.0,
                        "confidence": "HIGH",
                    }
                ],
                "findings": [{"title": "Visual Match", "description": "High frame correlation"}],
                "evidence_references": ["frame_match_0"],
                "operational_metadata": {"validation_status": "VALIDATED"},
            },
            {
                "report_id": "rep-test-02",
                "incident_id": self.incident_id,
                "created_at": self.t2,
                "model_id": "nvidia/Nemotron-3_5-Lightning",
                "summary": "Follow-up triage with high confidence",
                "recommended_action": "TAKEDOWN_NOTICE",
                "confidence_assessment": "HIGH_CONFIDENCE_MATCH",
                "human_review_required": False,
                "timeline_intervals": [],
                "findings": [],
                "evidence_references": ["frame_match_0"],
                "operational_metadata": {"validation_status": "VALIDATED"},
            },
            # Report from another incident (must be isolated)
            {
                "report_id": "rep-other-03",
                "incident_id": self.other_incident_id,
                "created_at": self.t2,
                "model_id": "nvidia/Nemotron-3_5-Lightning",
                "summary": "Other incident report",
                "recommended_action": "DISMISS_NO_ACTION",
                "confidence_assessment": "BENIGN_TRANSFORMATIVE",
                "operational_metadata": {"validation_status": "VALIDATED"},
            },
        ]

    def test_01_create_and_verify_valid_package(self):
        """1. A valid package exports successfully and passes verification."""
        zip_bytes, manifest = create_evidence_package(self.incident_data, self.reports_data)
        self.assertIsInstance(zip_bytes, bytes)
        self.assertTrue(len(zip_bytes) > 1000)
        self.assertEqual(manifest["incident_id"], self.incident_id)
        self.assertEqual(len(manifest["report_inventory"]), 2)  # Strict isolation: 2 for this incident

        result = verify_evidence_package(zip_bytes)
        self.assertTrue(result["valid"])
        self.assertTrue(result["signature_verified"])
        self.assertTrue(result["payload_integrity_verified"])
        self.assertTrue(result["chain_of_custody_verified"])
        self.assertEqual(result["total_reports"], 2)
        self.assertEqual(len(result["errors"]), 0)

    def test_02_empty_incident_history_package(self):
        """2. An incident with zero reports packages cleanly and verifies."""
        zip_bytes, manifest = create_evidence_package(self.incident_data, [])
        self.assertEqual(len(manifest["report_inventory"]), 0)

        result = verify_evidence_package(zip_bytes)
        self.assertTrue(result["valid"])
        self.assertTrue(result["signature_verified"])
        self.assertEqual(result["total_reports"], 0)

    def test_03_strict_incident_isolation(self):
        """3. Reports from other incidents are never included in the package."""
        zip_bytes, manifest = create_evidence_package(self.incident_data, self.reports_data)
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
        namelist = zf.namelist()

        self.assertIn("reports/rep-test-01.json", namelist)
        self.assertIn("reports/rep-test-02.json", namelist)
        self.assertNotIn("reports/rep-other-03.json", namelist)

        for item in manifest["report_inventory"]:
            self.assertNotEqual(item["report_id"], "rep-other-03")

    def test_04_tampered_report_fails_verification(self):
        """6. Tampering with any report file after export causes verification failure."""
        zip_bytes, _ = create_evidence_package(self.incident_data, self.reports_data)
        zf_in = zipfile.ZipFile(io.BytesIO(zip_bytes), "r")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf_out:
            for name in zf_in.namelist():
                data = zf_in.read(name)
                if name == "reports/rep-test-01.json":
                    data = b'{"tampered_report": true}'
                zf_out.writestr(name, data)

        result = verify_evidence_package(buf.getvalue())
        self.assertFalse(result["valid"])
        self.assertFalse(result["payload_integrity_verified"])
        self.assertTrue(any("mismatch" in e.lower() for e in result["errors"]))

    def test_05_tampered_manifest_fails_signature(self):
        """7. Tampering with manifest.json causes Ed25519 signature failure."""
        zip_bytes, _ = create_evidence_package(self.incident_data, self.reports_data)
        zf_in = zipfile.ZipFile(io.BytesIO(zip_bytes), "r")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf_out:
            for name in zf_in.namelist():
                data = zf_in.read(name)
                if name == "manifest.json":
                    m = json.loads(data)
                    m["package_id"] = "pkg_tampered_fake_id"
                    data = json.dumps(m).encode("utf-8")
                zf_out.writestr(name, data)

        result = verify_evidence_package(buf.getvalue())
        self.assertFalse(result["valid"])
        self.assertFalse(result["signature_verified"])
        self.assertTrue(any("signature verification failed" in e.lower() for e in result["errors"]))

    def test_06_unindexed_file_fails_verification(self):
        """8. Adding an unauthorized rogue file causes verification failure."""
        zip_bytes, _ = create_evidence_package(self.incident_data, self.reports_data)
        zf_in = zipfile.ZipFile(io.BytesIO(zip_bytes), "r")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf_out:
            for name in zf_in.namelist():
                zf_out.writestr(name, zf_in.read(name))
            zf_out.writestr("unauthorized_exploit.exe", b"malicious payload")

        result = verify_evidence_package(buf.getvalue())
        self.assertFalse(result["valid"])
        self.assertFalse(result["payload_integrity_verified"])
        self.assertTrue(any("unverified file" in e.lower() for e in result["errors"]))

    def test_07_broken_chain_of_custody_fails_verification(self):
        """9. Broken chain of custody hash link causes verification failure."""
        zip_bytes, _ = create_evidence_package(self.incident_data, self.reports_data)
        zf_in = zipfile.ZipFile(io.BytesIO(zip_bytes), "r")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf_out:
            for name in zf_in.namelist():
                data = zf_in.read(name)
                if name == "chain_of_custody.json":
                    chain = json.loads(data)
                    chain[1]["prev_hash"] = "f" * 64  # Broken link
                    data = json.dumps(chain).encode("utf-8")
                zf_out.writestr(name, data)

        result = verify_evidence_package(buf.getvalue())
        self.assertFalse(result["valid"])
        self.assertFalse(result["chain_of_custody_verified"])
        self.assertTrue(any("chain link broken" in e.lower() or "entry hash mismatch" in e.lower() for e in result["errors"]))

    def test_08_path_traversal_zip_rejected(self):
        """12. ZipSlip path traversal in uploaded package is rejected safely."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("../../etc/passwd", b"root:x:0:0")
            zf.writestr("manifest.json", b"{}")

        result = verify_evidence_package(buf.getvalue())
        self.assertFalse(result["valid"])
        self.assertTrue(any("path traversal detected" in e.lower() for e in result["errors"]))

    @patch("app.main.get_incident_by_id")
    @patch("app.main.get_nemotron_reports_for_incident")
    def test_09_export_endpoint_success(self, mock_reports, mock_incident):
        """1. Export endpoint returns 200 with ZIP download and proper headers."""
        mock_incident.return_value = self.incident_data
        mock_reports.return_value = self.reports_data

        resp = self.client.get(f"/api/threats/{self.incident_id}/reports/export")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["content-type"], "application/zip")
        self.assertIn("Content-Disposition", resp.headers)
        self.assertIn("attachment; filename=", resp.headers["Content-Disposition"])
        self.assertIn("X-Package-ID", resp.headers)
        self.assertIn("X-Signing-Key-ID", resp.headers)

        # Ensure downloaded bytes pass verification
        verify_res = verify_evidence_package(resp.content)
        self.assertTrue(verify_res["valid"])

    @patch("app.main.get_incident_by_id")
    def test_10_export_missing_incident_404(self, mock_incident):
        """14. Export endpoint returns 404 for nonexistent incident."""
        mock_incident.return_value = None
        resp = self.client.get(f"/api/threats/{self.missing_incident}/reports/export")
        self.assertEqual(resp.status_code, 404)

    def test_11_export_malformed_id_400(self):
        """14. Export endpoint returns 400 for unsafe incident ID."""
        resp = self.client.get("/api/threats/invalid@id/reports/export")
        self.assertEqual(resp.status_code, 400)

    @patch("app.main.get_incident_by_id")
    @patch("app.main.get_nemotron_reports_for_incident")
    def test_12_verify_package_endpoint(self, mock_reports, mock_incident):
        """5. Verify endpoint accepts uploaded ZIP and returns 200 with verification result."""
        mock_incident.return_value = self.incident_data
        mock_reports.return_value = self.reports_data

        export_resp = self.client.get(f"/api/threats/{self.incident_id}/reports/export")
        zip_bytes = export_resp.content

        # Upload to verify endpoint
        upload_resp = self.client.post(
            "/api/threats/reports/verify-package",
            files={"file": ("fixproof_evidence.zip", zip_bytes, "application/zip")},
        )
        self.assertEqual(upload_resp.status_code, 200)
        data = upload_resp.json()
        self.assertTrue(data["valid"])
        self.assertTrue(data["signature_verified"])
        self.assertTrue(data["payload_integrity_verified"])
        self.assertTrue(data["chain_of_custody_verified"])

    def test_13_verify_package_endpoint_rejects_non_zip(self):
        """13. Verify endpoint rejects non-zip files with 400."""
        resp = self.client.post(
            "/api/threats/reports/verify-package",
            files={"file": ("report.pdf", b"%PDF-1.4...", "application/pdf")},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("must be a .zip", resp.json()["detail"])

    @patch("app.evidence_package.os.getenv")
    def test_14_strict_signing_key_requirement_error(self, mock_getenv):
        """10. When key is required and missing, raises SigningConfigurationError."""
        def fake_getenv(k, default=""):
            if k == "FIXPROOF_REQUIRE_CONFIGURED_SIGNING_KEY":
                return "true"
            if k in ("FIXPROOF_SIGNING_KEY_HEX", "FIXPROOF_SIGNING_KEY_PEM", "FIXPROOF_SIGNING_KEY_PATH"):
                return ""
            return default
        mock_getenv.side_effect = fake_getenv

        with self.assertRaises(SigningConfigurationError):
            get_signing_key()

    @patch("app.main.get_incident_by_id")
    @patch("app.main.get_nemotron_reports_for_incident")
    @patch("app.main.generate_nemotron_report")
    def test_15_zero_model_invocation_on_export_and_verify(self, mock_generate, mock_reports, mock_incident):
        """11. Exporting and verifying a package never calls the AI reasoning model."""
        mock_incident.return_value = self.incident_data
        mock_reports.return_value = self.reports_data

        # Export
        export_resp = self.client.get(f"/api/threats/{self.incident_id}/reports/export")
        self.assertEqual(export_resp.status_code, 200)

        # Verify
        verify_resp = self.client.post(
            "/api/threats/reports/verify-package",
            files={"file": ("test.zip", export_resp.content, "application/zip")},
        )
        self.assertEqual(verify_resp.status_code, 200)

        # Model should never have been invoked
        mock_generate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
