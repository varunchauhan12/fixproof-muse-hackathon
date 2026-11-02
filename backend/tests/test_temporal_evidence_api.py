"""
API endpoint integration tests for Canonical Temporal Evidence Intelligence (FixProof P3).
Tests:
- GET /api/incidents/{incident_id}/temporal-evidence
- Authorization & session isolation
- 404 on missing incident
- 400 on malformed incident ID format
- Handling of report-fallback-only incidents
- Handling of missing and malformed timestamps
"""

import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

from fastapi import FastAPI
from app.temporal_evidence_api import router, incident_reader, demo_mode
app = FastAPI()
app.include_router(router)

def read_incident(iid):
    raise AssertionError("No real registry access in offline tests")

def demo_enabled():
    return False


class TestTemporalEvidenceAPI(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[demo_mode] = lambda: demo_enabled()
        app.dependency_overrides[incident_reader] = lambda: read_incident
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    @patch("tests.test_temporal_evidence_api.read_incident")
    def test_get_temporal_evidence_success(self, mock_get_inc):
        mock_get_inc.return_value = {
            "incident_id": "inc-valid-123",
            "session_id": "sess-user-1",
            "frame_matches": [
                {
                    "frame_idx": 0,
                    "evidence_id": "ev-0",
                    "submitted_frame": {"frame_index": 0, "timestamp_sec": 10.0, "filename": "s0.jpg"},
                    "best_match": {
                        "source_asset_id": "asset-1",
                        "source_frame_id": 10,
                        "source_timestamp_sec": 5.0,
                        "source_filename": "r0.jpg",
                        "l2_distance": 0.25,
                        "match_confirmed": True,
                    },
                },
                {
                    "frame_idx": 1,
                    "evidence_id": "ev-1",
                    "submitted_frame": {"frame_index": 1, "timestamp_sec": 15.0, "filename": "s1.jpg"},
                    "best_match": {
                        "source_asset_id": "asset-1",
                        "source_frame_id": 11,
                        "source_timestamp_sec": 10.0,
                        "source_filename": "r1.jpg",
                        "l2_distance": 0.30,
                        "match_confirmed": True,
                    },
                },
            ],
        }

        resp = self.client.get(
            "/api/incidents/inc-valid-123/temporal-evidence",
            headers={"X-Client-Session-Id": "sess-user-1"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertEqual(data["incident_id"], "inc-valid-123")
        self.assertEqual(data["valid_pair_count"], 2)
        self.assertEqual(data["missing_timestamp_count"], 0)
        self.assertEqual(data["global_offset"]["median_offset_sec"], 5.0)
        self.assertEqual(data["global_offset"]["mad_sec"], 0.0)
        self.assertEqual(data["chronological_consistency"]["inversions_count"], 0)
        self.assertIn("confirmed", data["populations"])
        self.assertIn("all_eligible", data["populations"])
        self.assertFalse(data["is_report_fallback_only"])
        self.assertTrue(data["has_raw_evidence"])
        self.assertEqual(len(data["candidates"]), 2)

    @patch("tests.test_temporal_evidence_api.read_incident")
    def test_get_temporal_evidence_not_found(self, mock_get_inc):
        mock_get_inc.return_value = None
        resp = self.client.get(
            "/api/incidents/inc-missing-999/temporal-evidence",
            headers={"X-Client-Session-Id": "sess-user-1"},
        )
        self.assertEqual(resp.status_code, 404)
        self.assertIn("not found", resp.json()["detail"].lower())

    def test_get_temporal_evidence_invalid_id_format(self):
        resp = self.client.get(
            "/api/incidents/invalid..id!!/temporal-evidence",
            headers={"X-Client-Session-Id": "sess-user-1"},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Invalid incident ID", resp.json()["detail"])

    @patch("tests.test_temporal_evidence_api.demo_enabled", return_value=False)
    @patch("tests.test_temporal_evidence_api.read_incident")
    def test_get_temporal_evidence_session_forbidden(self, mock_get_inc, mock_demo):
        mock_get_inc.return_value = {
            "incident_id": "inc-secret-456",
            "session_id": "sess-owner-1",
            "frame_matches": [],
        }

        # Request from different session
        resp = self.client.get(
            "/api/incidents/inc-secret-456/temporal-evidence",
            headers={"X-Client-Session-Id": "sess-attacker-2"},
        )
        self.assertEqual(resp.status_code, 403)
        self.assertIn("belongs to a different session", resp.json()["detail"])

    @patch("tests.test_temporal_evidence_api.demo_enabled", return_value=True)
    @patch("tests.test_temporal_evidence_api.read_incident")
    def test_get_temporal_evidence_demo_mode_allowed(self, mock_get_inc, mock_demo):
        mock_get_inc.return_value = {
            "incident_id": "inc-demo-789",
            "session_id": "sess-other-session",
            "frame_matches": [],
        }

        resp = self.client.get(
            "/api/incidents/inc-demo-789/temporal-evidence",
            headers={"X-Client-Session-Id": "sess-visitor-99"},
        )
        self.assertEqual(resp.status_code, 200)

    @patch("tests.test_temporal_evidence_api.read_incident")
    def test_get_temporal_evidence_report_fallback_only(self, mock_get_inc):
        mock_get_inc.return_value = {
            "incident_id": "inc-fallback-only",
            "session_id": "sess-1",
            "frame_matches": [],
            "sections": {
                "frame_correlations": [
                    {"suspect_frame_idx": 0, "suspect_time_offset": "0:05", "source_time_offset": "0:00"}
                ]
            },
        }

        resp = self.client.get(
            "/api/incidents/inc-fallback-only/temporal-evidence",
            headers={"X-Client-Session-Id": "sess-1"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["is_report_fallback_only"])
        self.assertFalse(data["has_raw_evidence"])
        self.assertEqual(data["valid_pair_count"], 0)
        self.assertIsNone(data["global_offset"]["median_offset_sec"])

    @patch("tests.test_temporal_evidence_api.read_incident")
    def test_get_temporal_evidence_malformed_timestamps(self, mock_get_inc):
        mock_get_inc.return_value = {
            "incident_id": "inc-malformed",
            "session_id": "sess-1",
            "frame_matches": [
                {
                    "frame_idx": 0,
                    "submitted_frame": {"frame_index": 0, "timestamp_sec": "not-a-number"},
                    "best_match": {
                        "source_asset_id": "asset-1",
                        "source_timestamp_sec": None,
                    },
                }
            ],
        }

        resp = self.client.get(
            "/api/incidents/inc-malformed/temporal-evidence",
            headers={"X-Client-Session-Id": "sess-1"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["valid_pair_count"], 0)
        self.assertEqual(data["missing_timestamp_count"], 1)
        self.assertIsNone(data["candidates"][0]["suspect_timestamp_sec"])
        self.assertIsNone(data["candidates"][0]["source_timestamp_sec"])

    def test_missing_and_invalid_session_rejected_before_read(self):
        with patch(__name__ + '.read_incident') as read:
            for headers in ({}, {'X-Client-Session-Id':'a!'}):
                response = self.client.get('/api/incidents/inc-valid/temporal-evidence', headers=headers)
                self.assertEqual(response.status_code, 400)
            read.assert_not_called()

    def test_ownerless_incident_not_public(self):
        with patch(__name__ + '.read_incident', return_value={'incident_id':'ownerless','frame_matches':[]}):
            response = self.client.get('/api/incidents/ownerless/temporal-evidence', headers={'X-Client-Session-Id':'session-a'})
            self.assertEqual(response.status_code, 403)

if __name__ == "__main__":
    unittest.main()

