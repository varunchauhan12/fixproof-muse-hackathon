"""
Comprehensive test suite for Phase 3.5 Step 3:
Evidence-Backed Detailed Report, PDF Download & Email Delivery.
"""

import json
import os
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.detailed_report import (
    build_evidence_bundle,
    synthesize_detailed_report,
    generate_detailed_report_pdf,
    generate_short_summary_download,
    save_detailed_report,
    get_detailed_report_record,
    get_detailed_report_pdf_bytes,
    list_detailed_reports_for_incident,
    send_detailed_report_email,
    DEFAULT_DETAILED_MODEL,
    VISION_MODEL_ID,
)


class TestDetailedReportWorkflow(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.sample_incident_id = f"test-inc-{uuid.uuid4().hex[:8]}"
        self.sample_incident = {
            "incident_id": self.sample_incident_id,
            "investigation_type": "FULL_VIDEO_SCAN",
            "suspect_filename": "championship_final_highlights.mp4",
            "suspect_url": "https://video.example.com/stream/98214",
            "platform": "Web Stream",
            "scanned_at": "2026-10-28T04:15:00Z",
            "matched_assets": ["vault-asset-ref-abc1"],
            "candidate_matches_found": 2,
            "highest_confidence": 91.4,
            "lowest_l2_distance": 0.285,
            "overall_status": "HIGH_CONFIDENCE_MATCH",
            "session_id": "demo-showcase",
            "frame_matches": [
                {
                    "timestamp_sec": 12.0,
                    "submitted_frame": {"timestamp_sec": 12.0},
                    "best_match": {
                        "match_confirmed": True,
                        "l2_distance": 0.285,
                        "phash_match": True,
                        "phash_distance": 2,
                        "visual_similarity_score": 91.4,
                        "source_timestamp_sec": 12.0,
                        "source_asset_id": "vault-asset-ref-abc1",
                        "vision_verification": {
                            "visual_correspondence": "CONFIRMED",
                            "matching_features": ["Identical logo placement", "Synchronized field angles"],
                            "contradictions": [],
                            "reasoning": "Nemotron Vision confirms visual alignment between keyframes.",
                        },
                    },
                },
                {
                    "timestamp_sec": 17.0,
                    "submitted_frame": {"timestamp_sec": 17.0},
                    "best_match": {
                        "match_confirmed": True,
                        "l2_distance": 0.380,
                        "phash_match": True,
                        "phash_distance": 4,
                        "visual_similarity_score": 84.2,
                        "source_timestamp_sec": 17.0,
                        "source_asset_id": "vault-asset-ref-abc1",
                        "vision_verification": {
                            "visual_correspondence": "UNVERIFIED",
                            "matching_features": ["Partial stadium outline"],
                            "contradictions": ["Different scoreboard color"],
                            "reasoning": "Visual correspondence inconclusive due to lighting variation.",
                        },
                    },
                },
            ],
        }

        self.sample_assets = [
            {
                "asset_id": "vault-asset-ref-abc1",
                "filename": "Official_Broadcast_2026_Master.mp4",
                "duration_sec": 120.0,
                "file_size": 45000000,
                "fps": 30.0,
                "created_at": "2026-10-27T10:00:00Z",
            }
        ]

    @patch("app.detailed_report.get_incident_by_id")
    @patch("app.detailed_report.list_registered_assets")
    def test_build_evidence_bundle(self, mock_assets, mock_get_inc):
        mock_get_inc.return_value = self.sample_incident
        mock_assets.return_value = self.sample_assets

        bundle = build_evidence_bundle(self.sample_incident_id)
        self.assertEqual(bundle["incident_id"], self.sample_incident_id)
        self.assertEqual(bundle["highest_confidence"], 91.4)
        self.assertEqual(bundle["lowest_l2_distance"], 0.285)
        self.assertEqual(len(bundle["matched_assets"]), 1)
        self.assertEqual(bundle["matched_assets"][0]["title"], "Official_Broadcast_2026_Master.mp4")
        self.assertEqual(len(bundle["frame_correlations"]), 2)

        fc0 = bundle["frame_correlations"][0]
        self.assertEqual(fc0["suspect_timestamp_sec"], 12.0)
        self.assertEqual(fc0["source_timestamp_sec"], 12.0)
        self.assertEqual(fc0["vision_verification"]["visual_correspondence"], "CONFIRMED")
        self.assertIn("Identical logo placement", fc0["vision_verification"]["matching_features"])

        fc1 = bundle["frame_correlations"][1]
        self.assertEqual(fc1["vision_verification"]["visual_correspondence"], "UNVERIFIED")
        self.assertIn("Different scoreboard color", fc1["vision_verification"]["contradictions"])

    @patch("app.detailed_report.get_incident_by_id")
    @patch("app.detailed_report.list_registered_assets")
    def test_synthesize_detailed_report_structure_and_invariants(self, mock_assets, mock_get_inc):
        mock_get_inc.return_value = self.sample_incident
        mock_assets.return_value = self.sample_assets

        bundle = build_evidence_bundle(self.sample_incident_id)
        # Synthesize with deterministic fallback
        report = synthesize_detailed_report(bundle, model_override="fallback-test")

        self.assertIn("report_id", report)
        self.assertEqual(report["incident_id"], self.sample_incident_id)
        self.assertIn("generated_at", report)
        self.assertIn("sections", report)

        sections = report["sections"]
        expected_keys = [
            "executive_summary",
            "methodology_scope",
            "suspect_and_reference_details",
            "frame_correlations",
            "temporal_continuity",
            "model_assessment",
            "risk_and_limitations",
            "recommended_actions",
            "provenance",
        ]
        for key in expected_keys:
            self.assertIn(key, sections, f"Missing required section: {key}")

        # Non-adjudication and heuristic disclaimer invariants
        exec_sum = sections["executive_summary"].lower()
        self.assertNotIn("guilty", exec_sum)
        self.assertNotIn("guaranteed infringement", exec_sum)

        risk_lim = sections["risk_and_limitations"]
        self.assertIn("calibrated probabilities", risk_lim.lower())

        provenance = sections["provenance"]
        self.assertEqual(provenance["vision_verifier_model"], VISION_MODEL_ID)

    @patch("app.detailed_report.get_incident_by_id")
    @patch("app.detailed_report.list_registered_assets")
    def test_generate_detailed_report_pdf(self, mock_assets, mock_get_inc):
        mock_get_inc.return_value = self.sample_incident
        mock_assets.return_value = self.sample_assets

        bundle = build_evidence_bundle(self.sample_incident_id)
        report = synthesize_detailed_report(bundle)
        pdf_bytes = generate_detailed_report_pdf(report, bundle)

        self.assertIsInstance(pdf_bytes, bytes)
        self.assertTrue(len(pdf_bytes) > 2000)
        self.assertTrue(pdf_bytes.startswith(b"%PDF-"), "Generated file must be a valid PDF document")

    @patch("app.detailed_report.get_incident_by_id")
    @patch("app.detailed_report.list_registered_assets")
    def test_generate_short_summary_download(self, mock_assets, mock_get_inc):
        mock_get_inc.return_value = self.sample_incident
        mock_assets.return_value = self.sample_assets

        filename, content = generate_short_summary_download(self.sample_incident_id)
        self.assertTrue(filename.startswith(f"fixproof-summary-{self.sample_incident_id[:8]}"))
        self.assertTrue(filename.endswith(".txt"))
        text = content.decode("utf-8")
        self.assertIn("FIXPROOF FORENSIC INVESTIGATION SUMMARY", text)
        self.assertIn(self.sample_incident_id, text)
        self.assertIn("HIGH_CONFIDENCE_MATCH", text)
        self.assertIn("STATUTORY & HEURISTIC DISCLAIMER", text)

    @patch("app.detailed_report.get_incident_by_id")
    @patch("app.detailed_report.list_registered_assets")
    def test_save_and_retrieve_detailed_report(self, mock_assets, mock_get_inc):
        mock_get_inc.return_value = self.sample_incident
        mock_assets.return_value = self.sample_assets

        bundle = build_evidence_bundle(self.sample_incident_id)
        report = synthesize_detailed_report(bundle)
        pdf_bytes = generate_detailed_report_pdf(report, bundle)

        save_detailed_report(self.sample_incident_id, report, pdf_bytes)

        # Retrieve record
        rep_id = report["report_id"]
        record = get_detailed_report_record(rep_id)
        self.assertIsNotNone(record)
        self.assertEqual(record["report_id"], rep_id)
        self.assertEqual(record["incident_id"], self.sample_incident_id)

        # Retrieve PDF bytes
        retrieved_pdf = get_detailed_report_pdf_bytes(rep_id)
        self.assertIsNotNone(retrieved_pdf)
        self.assertEqual(retrieved_pdf, pdf_bytes)

        # List reports
        listing = list_detailed_reports_for_incident(self.sample_incident_id)
        self.assertTrue(any(item["report_id"] == rep_id for item in listing))

    @patch("app.detailed_report.get_email_config")
    def test_send_detailed_report_email_not_configured(self, mock_email_cfg):
        mock_email_cfg.return_value = (False, None, None)

        res = send_detailed_report_email(
            incident_id=self.sample_incident_id,
            report_id="rep-dummy-123",
            recipient_email="legal@example.com",
            pdf_bytes=b"%PDF-1.4 dummy",
        )
        self.assertFalse(res["success"])
        self.assertEqual(res["status"], "NOT_CONFIGURED")
        self.assertIn("not configured", res["message"].lower())

    def test_send_detailed_report_email_invalid_recipient(self):
        with self.assertRaises(ValueError):
            send_detailed_report_email(
                incident_id=self.sample_incident_id,
                report_id="rep-dummy-123",
                recipient_email="invalid-not-an-email",
                pdf_bytes=b"%PDF-1.4 dummy",
            )

    @patch("requests.post")
    @patch("app.detailed_report.get_email_config")
    def test_send_detailed_report_email_mocked_success(self, mock_email_cfg, mock_post):
        mock_email_cfg.return_value = (True, "re_dummy_test_key_12345", "onboarding@resend.dev")

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id": "res_delivery_999"}
        mock_post.return_value = mock_resp

        res = send_detailed_report_email(
            incident_id=self.sample_incident_id,
            report_id="rep-dummy-789",
            recipient_email="investigator@example.com",
            pdf_bytes=b"%PDF-1.4 dummy content",
            summary_text="Test forensic summary.",
        )
        self.assertTrue(res["success"])
        self.assertEqual(res["status"], "DELIVERED")
        self.assertEqual(res["delivery_id"], "res_delivery_999")

        # Verify Resend payload structure
        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        payload = kwargs.get("json", {})
        self.assertEqual(payload["to"], ["investigator@example.com"])
        self.assertEqual(len(payload["attachments"]), 1)
        self.assertEqual(payload["attachments"][0]["filename"], f"fixproof-detailed-report-{self.sample_incident_id[:8]}.pdf")

    @patch("app.main.get_incident_by_id")
    @patch("app.detailed_report.get_incident_by_id")
    @patch("app.detailed_report.list_registered_assets")
    def test_api_detailed_report_endpoints(self, mock_assets, mock_det_inc, mock_main_inc):
        mock_main_inc.return_value = self.sample_incident
        mock_det_inc.return_value = self.sample_incident
        mock_assets.return_value = self.sample_assets

        # 1. Status endpoint includes detailed_report_model
        status_res = self.client.get("/api/nemotron/status")
        self.assertEqual(status_res.status_code, 200)
        data = status_res.json()
        self.assertIn("detailed_report_model", data)

        # 2. Download short summary endpoint
        sum_res = self.client.get(f"/api/nemotron/summary-download/{self.sample_incident_id}")
        self.assertEqual(sum_res.status_code, 200)
        self.assertIn("text/plain", sum_res.headers.get("content-type", ""))
        self.assertIn("FIXPROOF FORENSIC INVESTIGATION SUMMARY", sum_res.text)

        # 3. Generate detailed report endpoint
        gen_res = self.client.post(
            "/api/nemotron/detailed-report",
            json={"incident_id": self.sample_incident_id},
        )
        self.assertEqual(gen_res.status_code, 200)
        gen_data = gen_res.json()
        self.assertTrue(gen_data["success"])
        self.assertIn("report", gen_data)
        rep_id = gen_data["report"]["report_id"]
        pdf_url = gen_data["pdf_url"]
        self.assertTrue(pdf_url.endswith(f"/api/nemotron/detailed-report/{rep_id}/pdf"))

        # 4. Stream PDF endpoint
        pdf_res = self.client.get(f"/api/nemotron/detailed-report/{rep_id}/pdf")
        self.assertEqual(pdf_res.status_code, 200)
        self.assertEqual(pdf_res.headers.get("content-type"), "application/pdf")
        self.assertTrue(pdf_res.content.startswith(b"%PDF-"))

        # 5. List detailed reports endpoint
        list_res = self.client.get(f"/api/nemotron/detailed-reports/{self.sample_incident_id}")
        self.assertEqual(list_res.status_code, 200)
        list_data = list_res.json()
        self.assertTrue(isinstance(list_data, list))
        self.assertTrue(any(r["report_id"] == rep_id for r in list_data))

        # 6. Email detailed report retry endpoint (with invalid email)
        retry_err = self.client.post(
            "/api/nemotron/email-detailed-report",
            json={
                "incident_id": self.sample_incident_id,
                "report_id": rep_id,
                "recipient_email": "not-valid-address",
            },
        )
        self.assertEqual(retry_err.status_code, 400)


if __name__ == "__main__":
    unittest.main()
