"""
Unit and integration tests for FixProof Meta session discovery,
session isolation, and persistent session switcher backend endpoints.
"""

import json
import os
import unittest
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient

from app.main import app
from app.registry import list_active_sessions, load_incidents, get_incident_by_id


class TestSessionDiscoveryAndIsolation(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    # 1. Test session discovery endpoint GET /api/sessions
    def test_list_sessions_endpoint(self):
        response = self.client.get("/api/sessions")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, list)
        if len(data) > 0:
            item = data[0]
            self.assertIn("session_id", item)
            self.assertIn("incident_count", item)
            self.assertIn("latest_activity", item)
            self.assertIsInstance(item["incident_count"], int)

    # 2. Test list_active_sessions in local JSON mode
    def test_list_active_sessions_local_mode(self):
        sample_incidents = [
            {"incident_id": "inc-01", "session_id": "sess_alpha", "scanned_at": "2026-11-01T10:00:00Z"},
            {"incident_id": "inc-02", "session_id": "sess_alpha", "scanned_at": "2026-11-01T11:00:00Z"},
            {"incident_id": "inc-03", "session_id": "sess_beta", "scanned_at": "2026-11-01T09:00:00Z"},
            {"incident_id": "inc-04", "session_id": None, "scanned_at": "2026-11-01T08:00:00Z"},
        ]

        with patch("app.registry.is_cloud_mode", return_value=False):
            with patch("app.registry._load_all_local_incidents", return_value=sample_incidents):
                sessions = list_active_sessions()

        self.assertEqual(len(sessions), 2)
        # sess_alpha should be first because latest_activity is 11:00
        self.assertEqual(sessions[0]["session_id"], "sess_alpha")
        self.assertEqual(sessions[0]["incident_count"], 2)
        self.assertEqual(sessions[0]["latest_activity"], "2026-11-01T11:00:00Z")

        self.assertEqual(sessions[1]["session_id"], "sess_beta")
        self.assertEqual(sessions[1]["incident_count"], 1)

    # 3. Individual incident access in production mode strictly enforces session isolation
    def test_individual_incident_session_isolation_production_mode(self):
        mock_incident = {
            "incident_id": "test-inc-isolated-01",
            "session_id": "sess_private_owner",
            "overall_status": "CANDIDATE_MATCH",
            "suspect_filename": "leak.mp4",
        }

        with patch("app.main.is_demo_mode", return_value=False):
            with patch("app.main.get_incident_by_id", return_value=mock_incident):
                # A. Access with matching session succeeds
                res_match = self.client.get(
                    "/api/incidents/test-inc-isolated-01",
                    headers={"X-Client-Session-Id": "sess_private_owner"},
                )
                self.assertEqual(res_match.status_code, 200)
                self.assertEqual(res_match.json()["incident_id"], "test-inc-isolated-01")

                # B. Access with mismatched session fails with 403 Forbidden
                res_mismatch = self.client.get(
                    "/api/incidents/test-inc-isolated-01",
                    headers={"X-Client-Session-Id": "sess_unauthorized_visitor"},
                )
                self.assertEqual(res_mismatch.status_code, 403)
                self.assertIn("Access denied", res_mismatch.json()["detail"])

                # C. Access without session header fails with 403 Forbidden
                res_none = self.client.get("/api/incidents/test-inc-isolated-01")
                self.assertEqual(res_none.status_code, 403)

    # 4. Individual incident access in demo mode allows single-user inspection across sessions
    def test_individual_incident_access_demo_mode(self):
        mock_incident = {
            "incident_id": "test-inc-demo-01",
            "session_id": "sess_historical_owner",
            "overall_status": "CANDIDATE_MATCH",
            "suspect_filename": "leak.mp4",
        }

        with patch("app.main.is_demo_mode", return_value=True):
            with patch("app.main.get_incident_by_id", return_value=mock_incident):
                with patch("app.temporal_selector.ensure_incident_sam_grounded", return_value=False):
                    # Access without session header succeeds in demo mode
                    res_none = self.client.get("/api/incidents/test-inc-demo-01")
                    self.assertEqual(res_none.status_code, 200)
                    self.assertEqual(res_none.json()["incident_id"], "test-inc-demo-01")

                    # Access with different session header also succeeds in demo mode
                    res_other = self.client.get(
                        "/api/incidents/test-inc-demo-01",
                        headers={"X-Client-Session-Id": "sess_browser_active"},
                    )
                    self.assertEqual(res_other.status_code, 200)

    # 5. Incident listing in production mode is scoped to visitor session
    def test_incident_listing_is_session_scoped_production_mode(self):
        sample_incidents = [
            {"incident_id": "inc-01", "session_id": "sess_user_a", "scanned_at": "2026-11-01T10:00:00Z"},
            {"incident_id": "inc-02", "session_id": "sess_user_b", "scanned_at": "2026-11-01T11:00:00Z"},
            {"incident_id": "inc-demo", "session_id": "demo-showcase", "scanned_at": "2026-11-01T08:00:00Z"},
        ]

        with patch("app.registry.is_demo_mode", return_value=False):
            with patch("app.registry.is_cloud_mode", return_value=False):
                with patch("app.registry._load_all_local_incidents", return_value=sample_incidents):
                    # Query for user A
                    incidents_a = load_incidents(session_id="sess_user_a")
                    ids_a = [i["incident_id"] for i in incidents_a]
                    self.assertIn("inc-01", ids_a)
                    self.assertIn("inc-demo", ids_a)
                    self.assertNotIn("inc-02", ids_a)

                    # Query for user B
                    incidents_b = load_incidents(session_id="sess_user_b")
                    ids_b = [i["incident_id"] for i in incidents_b]
                    self.assertIn("inc-02", ids_b)
                    self.assertIn("inc-demo", ids_b)
                    self.assertNotIn("inc-01", ids_b)

    # 6. Incident listing in demo mode unifies all investigations
    def test_incident_listing_unified_demo_mode(self):
        sample_incidents = [
            {"incident_id": "inc-01", "session_id": "sess_user_a", "scanned_at": "2026-11-01T10:00:00Z"},
            {"incident_id": "inc-02", "session_id": "sess_user_b", "scanned_at": "2026-11-01T11:00:00Z"},
            {"incident_id": "inc-demo", "session_id": "demo-showcase", "scanned_at": "2026-11-01T08:00:00Z"},
        ]

        with patch("app.registry.is_demo_mode", return_value=True):
            with patch("app.registry.is_cloud_mode", return_value=False):
                with patch("app.registry._load_all_local_incidents", return_value=sample_incidents):
                    incidents_all = load_incidents()
                    ids_all = [i["incident_id"] for i in incidents_all]
                    self.assertIn("inc-01", ids_all)
                    self.assertIn("inc-02", ids_all)
                    self.assertIn("inc-demo", ids_all)
                    # Ordered newest first
                    self.assertEqual(incidents_all[0]["incident_id"], "inc-02")


if __name__ == "__main__":
    unittest.main()

