"""Stage B production execution paths, using only the Stage A mocked HTTP transport."""
import json
import os
from unittest.mock import patch
from fastapi.testclient import TestClient
import httpx2

from tests import test_meta_provider
from app.providers import meta_client


class TestReasoningMigration(test_meta_provider.TestMetaProvider):
    # Inherit the Stage A transport fixture; its 13 contract tests also remain active.
    def setUp(self):
        super().setUp()
        self.selection = patch.dict(os.environ, {"FIXPROOF_AI_PROVIDER": "muse", "NEBIUS_API_KEY": ""})
        self.selection.start()
        from app.main import app
        self.api = TestClient(app)
        self.incident = {"incident_id": "stageb-incident", "investigation_type": "FULL_VIDEO_SCAN", "overall_status": "CLEAN", "candidate_matches_found": 0, "frame_matches": [], "suspect_filename": "clip.mp4", "session_id": None}

    def tearDown(self):
        self.selection.stop()
        super().tearDown()

    def bundle(self):
        from app.detailed_report import build_evidence_bundle
        with patch("app.detailed_report.get_incident_by_id", return_value=self.incident), patch("app.detailed_report.list_registered_assets", return_value=[]), patch("app.detailed_report.get_investigation_reports_for_incident", return_value=[]):
            return build_evidence_bundle("stageb-incident")

    def invoke(self, operation):
        from app import main, document_actions as action, detailed_report as detailed
        if operation == "diagnose":
            response = self.api.post("/diagnose", json={"issue_description": "Explain a loop"})
            return response.status_code, response.json()
        if operation == "investigate":
            with patch.object(main, "get_incident_by_id", return_value=self.incident), patch.object(main, "get_investigation_reports_for_incident", return_value=[]), patch.object(main, "save_investigation_report", side_effect=lambda report: report.model_dump(mode="json")):
                response = self.api.post("/api/threats/stageb-incident/investigate", json={"force_refresh": True})
                return response.status_code, response.json()
        if operation in ("copyright", "revshare"):
            function = action.generate_copyright_notice_draft if operation == "copyright" else action.generate_rev_share_proposal_draft
            with patch.object(action, "send_document_email") as email:
                result = function(self.incident, {"rights_holder_name": "Example", "work_title": "Test", "contact_email": "owner@example.com"})
                email.assert_not_called()
                return 200, result
        result = detailed.synthesize_detailed_report(self.bundle())
        return 200, result

    def success_content(self, operation):
        if operation == "investigate":
            return json.dumps(self.report_payload())
        if operation == "detailed":
            return json.dumps({"executive_summary": "Measured preview evidence only", "methodology_scope": "CV metrics", "temporal_continuity_analysis": "No intervals", "model_assessment_and_alternatives": "Review required", "risk_limitations": "Heuristic, uncalibrated scores", "recommended_actions": ["Human review"]})
        if operation in ("copyright", "revshare"):
            return "Safe polished introductory narrative for human review. " * 6
        return "Review the loop boundary."

    def test_each_production_operation_muse_success(self):
        from app.detailed_report import generate_detailed_report_pdf
        for operation in ("diagnose", "investigate", "copyright", "revshare", "detailed"):
            with self.subTest(operation=operation):
                self.content = self.success_content(operation)
                self.calls.clear()
                status, result = self.invoke(operation)
                self.assertEqual(status, 200)
                self.assertEqual(len(self.calls), 1)
                self.assertEqual(json.loads(self.calls[0].content)["model"], "muse-spark-1.3")
                if operation == "diagnose":
                    self.assertEqual(set(result), {"diagnosis", "model", "provider"})
                    self.assertEqual(result["provider"], "Meta Model API")
                elif operation == "investigate":
                    self.assertEqual(result["operational_metadata"]["validation_status"], "VALIDATED")
                    self.assertEqual(result["incident_id"], "stageb-incident")
                elif operation == "detailed":
                    self.assertTrue(result["ai_synthesized"])
                    self.assertTrue(generate_detailed_report_pdf(result, self.bundle()).startswith(b"%PDF"))
                    # This clean incident has no vision records; do not invent a model.
                    self.assertEqual(result["sections"]["provenance"]["vision_verifier_model"], "not-recorded")
                else:
                    self.assertTrue(result["ai_enhanced"])
                self.assertNotIn("dummy-meta-secret", json.dumps(result))

    def test_each_operation_failures_keep_safe_contract(self):
        for operation in ("diagnose", "investigate", "copyright", "revshare", "detailed"):
            for kind in ("malformed", "missing", "timeout", "connection", "api"):
                with self.subTest(operation=operation, failure=kind):
                    meta_client.get_meta_sdk_client.cache_clear()
                    self.calls.clear()
                    self.failure = {"timeout": httpx2.ReadTimeout, "connection": httpx2.ConnectError}.get(kind)
                    self.status = 500 if kind == "api" else 200
                    self.content = "" if operation == "diagnose" and kind == "malformed" else "invalid"
                    with patch.dict(os.environ, {"MODEL_API_KEY": "" if kind == "missing" else "dummy-meta-secret"}):
                        status, result = self.invoke(operation)
                    self.assertLessEqual(len(self.calls), 1)
                    self.assertNotIn("dummy-meta-secret", json.dumps(result))
                    if operation == "diagnose":
                        self.assertEqual(status, 500 if kind == "missing" else 502)
                    elif operation == "investigate":
                        self.assertEqual(result["operational_metadata"]["validation_status"], "FAILED_VALIDATION")
                    elif operation == "detailed":
                        self.assertFalse(result["ai_synthesized"])
                        self.assertEqual(result["model_id"], "deterministic-forensic-engine-v1.0")
                    else:
                        self.assertFalse(result["ai_enhanced"])
                        self.assertEqual(result["model_id"], "deterministic-template-v1.0")

    def test_status_reports_selected_muse_reasoning_and_vision(self):
        response = self.api.get("/api/nemotron/status")
        self.assertEqual(response.json()["configured_model"], "muse-spark-1.3")
        self.assertTrue(response.json()["text_reasoning_available"])
        self.assertTrue(response.json()["vision_verification_available"])
        self.assertEqual(response.json()["vision_model"], "muse-spark-1.3")

    def test_old_provider_cached_report_is_not_returned_for_muse(self):
        from app import main
        self.content = json.dumps(self.report_payload())
        old = {"model_id": "nvidia/Nemotron-3_5-Lightning", "operational_metadata": {"validation_status": "VALIDATED"}, "summary": "Legacy report"}
        with patch.object(main, "get_incident_by_id", return_value=self.incident), patch.object(main, "get_investigation_reports_for_incident", return_value=[old]), patch.object(main, "save_investigation_report", side_effect=lambda report: report.model_dump(mode="json")):
            result = self.api.post("/api/threats/stageb-incident/investigate", json={"force_refresh": False})
            self.assertEqual(result.json()["model_id"], "muse-spark-1.3")
            self.assertEqual(len(self.calls), 1)
