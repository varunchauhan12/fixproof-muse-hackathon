"""
Comprehensive Test Suite for FixProof Phase 1.4:
Report History & Investigation Versioning.

Verifies:
1. get_nemotron_report_history function:
   - Returns compact metadata records.
   - Strictly enforces incident isolation.
   - Orders history newest-first based on timestamps.
2. GET /api/threats/{incident_id}/reports API endpoint:
   - Returns 200 with ordered history list for existing incident.
   - Returns 200 with empty list [] when incident has no reports.
   - Returns 404 when incident does not exist.
   - Returns 400 for malformed incident ID.
3. Zero-model-invocation guarantee:
   - Neither history retrieval nor fetching by report_id invokes the LLM provider.
"""

from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app
from app.registry import (
    save_nemotron_report,
    get_nemotron_report_by_id,
    get_nemotron_reports_for_incident,
    get_nemotron_report_history,
)


class TestReportHistory(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.incident_a = "11111111-1111-1111-1111-111111111111"
        self.incident_b = "22222222-2222-2222-2222-222222222222"
        self.missing_incident = "99999999-9999-9999-9999-999999999999"

        now = datetime.now(timezone.utc)
        self.t_old = (now - timedelta(hours=2)).isoformat()
        self.t_mid = (now - timedelta(hours=1)).isoformat()
        self.t_new = now.isoformat()

        # Mock reports: 2 for incident_a, 1 for incident_b
        self.report_a1 = {
            "report_id": "rep-a1-old",
            "incident_id": self.incident_a,
            "created_at": self.t_old,
            "model_id": "nvidia/Nemotron-3_5-Lightning",
            "prompt_version": "v1.0",
            "summary": "First preliminary investigation",
            "recommended_action": "NEEDS_FULL_VIDEO_REVIEW",
            "confidence_assessment": "INCONCLUSIVE_DATA",
            "human_review_required": True,
            "timeline_intervals": [],
            "findings": [],
            "unresolved_questions": [],
            "contradictions_detected": [],
            "limitations_disclosed": [],
            "evidence_references": [],
            "operational_metadata": {
                "validation_status": "VALIDATED",
                "created_at": self.t_old,
            },
        }

        self.report_a2 = {
            "report_id": "rep-a2-new",
            "incident_id": self.incident_a,
            "created_at": self.t_new,
            "model_id": "nvidia/Nemotron-3_5-Lightning",
            "prompt_version": "v1.0",
            "summary": "Second confirmed investigation with new frames",
            "recommended_action": "ESCALATE_LEGAL_TAKEDOWN",
            "confidence_assessment": "HIGH_CONFIDENCE_MATCH",
            "human_review_required": False,
            "timeline_intervals": [],
            "findings": [],
            "unresolved_questions": [],
            "contradictions_detected": [],
            "limitations_disclosed": [],
            "evidence_references": [],
            "operational_metadata": {
                "validation_status": "VALIDATED",
                "created_at": self.t_new,
            },
        }

        self.report_b1 = {
            "report_id": "rep-b1-mid",
            "incident_id": self.incident_b,
            "created_at": self.t_mid,
            "model_id": "nvidia/Nemotron-3_5-Lightning",
            "prompt_version": "v1.0",
            "summary": "Incident B investigation",
            "recommended_action": "DISMISS_FAIR_USE",
            "confidence_assessment": "CONFIRMED_DISTINCT",
            "human_review_required": False,
            "timeline_intervals": [],
            "findings": [],
            "unresolved_questions": [],
            "contradictions_detected": [],
            "limitations_disclosed": [],
            "evidence_references": [],
            "operational_metadata": {
                "validation_status": "VALIDATED",
                "created_at": self.t_mid,
            },
        }

    @patch("app.registry.load_nemotron_reports")
    def test_get_nemotron_report_history_isolation_and_ordering(self, mock_load):
        """Verifies report history is strictly isolated to incident and ordered newest first."""
        # Provide reports in arbitrary order
        mock_load.return_value = [self.report_a1, self.report_b1, self.report_a2]

        history_a = get_nemotron_report_history(self.incident_a)
        self.assertEqual(len(history_a), 2)

        # Newest first ordering: rep-a2-new (t_new) must come before rep-a1-old (t_old)
        self.assertEqual(history_a[0]["report_id"], "rep-a2-new")
        self.assertEqual(history_a[0]["recommended_action"], "ESCALATE_LEGAL_TAKEDOWN")
        self.assertEqual(history_a[1]["report_id"], "rep-a1-old")
        self.assertEqual(history_a[1]["recommended_action"], "NEEDS_FULL_VIDEO_REVIEW")

        # Incident isolation: Incident B report must not appear
        report_ids_a = [h["report_id"] for h in history_a]
        self.assertNotIn("rep-b1-mid", report_ids_a)

        # Query Incident B
        history_b = get_nemotron_report_history(self.incident_b)
        self.assertEqual(len(history_b), 1)
        self.assertEqual(history_b[0]["report_id"], "rep-b1-mid")

    @patch("app.registry.load_nemotron_reports")
    def test_compact_history_fields(self, mock_load):
        """Verifies all required compact metadata fields are present."""
        mock_load.return_value = [self.report_a2]

        history = get_nemotron_report_history(self.incident_a)
        item = history[0]

        expected_fields = {
            "report_id",
            "incident_id",
            "created_at",
            "model_id",
            "recommended_action",
            "confidence_assessment",
            "validation_status",
            "human_review_required",
            "summary",
        }
        self.assertTrue(expected_fields.issubset(set(item.keys())))
        self.assertEqual(item["validation_status"], "VALIDATED")
        self.assertFalse(item["human_review_required"])

    @patch("app.main.get_incident_by_id")
    @patch("app.main.get_nemotron_report_history")
    def test_api_get_reports_history_success(self, mock_history, mock_get_inc):
        """Verifies GET /api/threats/{incident_id}/reports returns 200 with history list."""
        mock_get_inc.return_value = {"incident_id": self.incident_a}
        mock_history.return_value = [
            {
                "report_id": "rep-a2-new",
                "incident_id": self.incident_a,
                "created_at": self.t_new,
                "model_id": "nvidia/Nemotron-3_5-Lightning",
                "recommended_action": "ESCALATE_LEGAL_TAKEDOWN",
                "confidence_assessment": "HIGH_CONFIDENCE_MATCH",
                "validation_status": "VALIDATED",
                "human_review_required": False,
                "summary": "Second confirmed investigation",
            },
            {
                "report_id": "rep-a1-old",
                "incident_id": self.incident_a,
                "created_at": self.t_old,
                "model_id": "nvidia/Nemotron-3_5-Lightning",
                "recommended_action": "NEEDS_FULL_VIDEO_REVIEW",
                "confidence_assessment": "INCONCLUSIVE_DATA",
                "validation_status": "VALIDATED",
                "human_review_required": True,
                "summary": "First preliminary investigation",
            },
        ]

        resp = self.client.get(f"/api/threats/{self.incident_a}/reports")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 2)
        self.assertEqual(data[0]["report_id"], "rep-a2-new")
        self.assertEqual(data[1]["report_id"], "rep-a1-old")

    @patch("app.main.get_incident_by_id")
    @patch("app.main.get_nemotron_report_history")
    def test_api_get_reports_history_empty(self, mock_history, mock_get_inc):
        """Verifies GET /api/threats/{incident_id}/reports returns 200 [] when no reports exist."""
        mock_get_inc.return_value = {"incident_id": self.incident_a}
        mock_history.return_value = []

        resp = self.client.get(f"/api/threats/{self.incident_a}/reports")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    @patch("app.main.get_incident_by_id")
    def test_api_get_reports_history_missing_incident(self, mock_get_inc):
        """Verifies GET /api/threats/{incident_id}/reports returns 404 when incident does not exist."""
        mock_get_inc.return_value = None

        resp = self.client.get(f"/api/threats/{self.missing_incident}/reports")
        self.assertEqual(resp.status_code, 404)
        self.assertIn("Incident not found", resp.json()["detail"])

    def test_api_get_reports_history_invalid_id_format(self):
        """Verifies GET /api/threats/{incident_id}/reports returns 400 for unsafe IDs."""
        resp = self.client.get("/api/threats/invalid@id/reports")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Invalid incident ID format", resp.json()["detail"])

    @patch("app.nemotron_engine.generate_nemotron_report")
    @patch("app.main.get_incident_by_id")
    @patch("app.main.get_nemotron_report_history")
    @patch("app.main.get_nemotron_report_by_id")
    def test_zero_model_invocation_on_history_or_selection(
        self, mock_get_by_id, mock_history, mock_get_inc, mock_generate
    ):
        """Verifies that retrieving history or fetching a report by ID NEVER calls LLM."""
        mock_get_inc.return_value = {"incident_id": self.incident_a}
        mock_history.return_value = [self.report_a1]
        mock_get_by_id.return_value = self.report_a1

        # 1. Fetch history
        resp1 = self.client.get(f"/api/threats/{self.incident_a}/reports")
        self.assertEqual(resp1.status_code, 200)

        # 2. Select specific report by ID
        resp2 = self.client.get("/api/threats/reports/rep-a1-old")
        self.assertEqual(resp2.status_code, 200)

        # Crucial invariant: LLM was never invoked
        mock_generate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
