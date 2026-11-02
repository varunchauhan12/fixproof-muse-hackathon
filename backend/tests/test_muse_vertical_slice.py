"""Offline actual tool/router orchestration tests for positive and negative observations."""
import unittest
from unittest.mock import Mock, patch
from uuid import UUID
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.muse_conversation_api import router, incident_router, get_conversation_manager, get_muse_assistant
from app.muse_conversations import ConversationManager
from app.muse_orchestrator import MuseAssistant
from app.muse_tools import MuseToolRegistry
from tests.test_muse_tools import Store, frame, incident
from tests.test_muse_orchestrator import completion, tool, answer


class TestMuseVerticalSlice(unittest.TestCase):
    def setUp(self):
        self.store = Store()
        self.tools = MuseToolRegistry(self.store)
        self.provider = Mock(provider_name="muse", model_id="muse-wonder-1.0")
        self.manager = ConversationManager()
        self.assistant = MuseAssistant(self.manager, tools=self.tools, provider_factory=lambda: self.provider)
        app = FastAPI()
        app.include_router(router); app.include_router(incident_router)
        app.dependency_overrides[get_conversation_manager] = lambda: self.manager
        app.dependency_overrides[get_muse_assistant] = lambda: self.assistant
        self.client = TestClient(app)
        self.headers = {"X-Client-Session-ID": "session-a"}
        for target in ("builtins.open", "pathlib.Path.open", "pathlib.Path.mkdir", "socket.socket.connect"):
            guard = patch(target, side_effect=AssertionError("Unexpected I/O")); guard.start(); self.addCleanup(guard.stop)

    def bundle(self, iid="incident-a", session="session-a"):
        return self.tools.execute("get_evidence_bundle", session_id=session, arguments={"incident_id": iid})

    def test_clean_observations_retained_without_invented_matches(self):
        self.store.incidents[0]["overall_status"] = "CLEAN"
        frames = [frame(i * 5, i * 5 + 10, i) for i in range(3)]
        for item in frames:
            item["best_match"].update(l2_distance=1.2, match_confirmed=False)
        self.store.incidents[0]["frame_matches"] = frames
        result = self.bundle()
        self.assertEqual(result.status, "success")
        self.assertEqual(result.data["observation_counts"]["NO_MATCH"], 3)
        self.assertEqual(len(result.data["frame_observations"]), 3)
        self.assertEqual(result.data["matching_evidence"]["frames"], [])
        self.assertEqual(result.data["matching_evidence"]["timeline_intervals"], [])
        self.assertEqual(result.data["investigation_reports"], [])
        self.assertEqual([f["suspect_timestamp_sec"] for f in result.data["frame_observations"]], [0, 5, 10])

    def test_positive_classifications_distinct(self):
        confirmed, suspect, negative = frame(0, 10), frame(5, 15, 1), frame(10, 20, 2)
        suspect["best_match"].update(match_confirmed=False, l2_distance=.6)
        negative["best_match"].update(match_confirmed=False, l2_distance=1.2)
        self.store.incidents[0]["frame_matches"] = [confirmed, suspect, negative]
        result = self.bundle().data
        self.assertEqual([f["similarity_status"] for f in result["frame_observations"]], ["CONFIRMED_MATCH", "SUSPECT_MATCH", "NO_MATCH"])
        self.assertEqual(len(result["matching_evidence"]["frames"]), 2)
        self.assertTrue(all(result["observation_counts"][k] == 1 for k in ("NO_MATCH", "SUSPECT_MATCH", "CONFIRMED_MATCH")))

    def test_missing_and_malformed_evidence_still_unavailable(self):
        for frames in ([], [frame(None, 10)]):
            self.store.incidents[0]["frame_matches"] = frames
            self.assertEqual(self.bundle().error.code, "DATA_UNAVAILABLE")

    def test_session_and_orphaned_report_checks_preserved(self):
        self.store.incidents[0]["frame_matches"] = [frame(5, 10)]
        self.assertEqual(self.bundle(session="session-b").error.code, "ACCESS_DENIED")
        self.store.reports = [{"report_id": "orphan", "incident_id": "incident-b"}]
        self.assertEqual(self.bundle().error.code, "ACCESS_DENIED")

    def test_bounded_recorded_annotations_and_saved_report_summary(self):
        item = frame(5, 10)
        item["best_match"]["vision_verification"] = {"model_id": "muse-spark-1.3", "matching_features": ["Recorded feature"], "reasoning": "PRIVATE_TRACE", "image_path": "/private/file"}
        self.store.incidents[0]["frame_matches"] = [item]
        self.store.reports = [{"report_id": "report-a", "incident_id": "incident-a", "summary": "Recorded findings", "model_id": "muse-wonder-1.0"}]
        result = self.bundle().data
        self.assertEqual(result["frame_observations"][0]["vision_annotation"]["matching_features"], ["Recorded feature"])
        self.assertEqual(result["investigation_reports"][0]["summary"], "Recorded findings")
        self.assertNotIn("PRIVATE_TRACE", str(result)); self.assertNotIn("/private", str(result))

    def test_incident_selector_uses_exact_session_not_discovery(self):
        self.store.incidents.extend([incident("foreign", "session-b"), incident("legacy", None)])
        response = self.client.get("/api/muse/incidents", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([r["incident_id"] for r in response.json()["data"]["incidents"]], ["incident-a"])
        self.assertEqual(self.client.get("/api/muse/incidents").status_code, 400)
        self.provider.create_text_completion.assert_not_called()

    def test_zero_match_question_and_followup_through_real_routes(self):
        item = frame(5, 10); item["best_match"].update(match_confirmed=False, l2_distance=1.2)
        self.store.incidents[0]["frame_matches"] = [item]
        self.store.incidents[0]["overall_status"] = "CLEAN"
        self.provider.create_text_completion.side_effect = [completion(p) for p in (
            tool(), tool("get_evidence_bundle", incident_id="incident-a"),
            answer("The stored observation is NO_MATCH. The scan status is CLEAN; this does not establish infringement.", evidence_id="frame_0_t5s"),
            answer("That observation has no recorded matching correspondence. It is NO_MATCH.", evidence_id="frame_0_t5s"))]
        created = self.client.post("/api/muse/conversations", headers=self.headers, json={}).json()
        url = f"/api/muse/conversations/{created['conversation_id']}/messages"
        first = self.client.post(url, headers=self.headers, json={"client_message_id": "one", "text": "Explain the latest incident", "expected_revision": 0})
        self.assertEqual(first.status_code, 200, first.text); self.assertEqual(first.json()["status"], "completed")
        second = self.client.post(url, headers=self.headers, json={"client_message_id": "two", "text": "Explain the evidence in more detail", "expected_revision": 2})
        self.assertEqual(second.status_code, 200, second.text); self.assertEqual(second.json()["revision"], 4)
        saved = self.manager.get(UUID(created["conversation_id"]), "session-a")
        self.assertEqual(saved.selected_incident_id, "incident-a")
        self.assertEqual(len(saved.messages), 4)
        self.assertEqual(second.json()["tool_results"], [])

    def test_bundle_report_context_is_reauthorized_on_followup(self):
        self.store.incidents[0]["frame_matches"] = [frame(5, 10)]
        self.store.reports = [{"incident_id": "incident-a", "report_id": "report-a", "summary": "Stored findings"}]
        self.provider.create_text_completion.side_effect = [completion(p) for p in (
            tool("get_evidence_bundle", incident_id="incident-a"), answer(report_id="report-a"))]
        created = self.client.post("/api/muse/conversations", headers=self.headers, json={}).json()
        url = f"/api/muse/conversations/{created['conversation_id']}/messages"
        first = self.client.post(url, headers=self.headers, json={"client_message_id": "one", "text": "Explain the evidence", "expected_revision": 0})
        self.assertEqual(first.status_code, 200, first.text)
        self.store.reports = []
        second = self.client.post(url, headers=self.headers, json={"client_message_id": "two", "text": "Explain that report again", "expected_revision": 2})
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.json()["error"], "CONTEXT_UNAVAILABLE")
        self.assertEqual(self.provider.create_text_completion.call_count, 2)
