"""
Focused Acceptance & Regression Tests for Task 3:
Synchronizing Muse Copilot with the Active Incident.

Tests:
1. Muse receives the currently selected incident ID in conversation create & message requests.
2. Changing the selected incident updates context and prunes prior grounding sources (no evidence mixing).
3. Incident-specific tools prioritize and retrieve evidence from the selected active incident.
4. Clean / zero-match incidents are handled correctly with valid negative classification grounding.
5. Missing or invalid incident IDs (including foreign sessions) do not cause cross-incident leakage.
6. A conversation without an active incident retains its supported general / latest behavior.
7. Existing Muse citations and grounding rules remain strictly intact.
"""

import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.muse_conversation_api import router, get_conversation_manager, get_muse_assistant
from app.muse_conversations import (
    ConversationError,
    ConversationManager,
    CreateConversationRequest,
    MessageRequest,
)
from app.muse_orchestrator import MuseAssistant
from app.muse_tools import MuseToolRegistry
from tests.test_muse_tools import Store, incident, frame


def completion(plan, model="muse-wonder-1.0"):
    return SimpleNamespace(
        model=model,
        choices=[
            SimpleNamespace(
                finish_reason="stop",
                message=SimpleNamespace(
                    content=json.dumps(plan) if isinstance(plan, (dict, list)) else plan
                ),
            )
        ],
    )


def tool(name="get_latest_incident", **arguments):
    return {"action": "tool_call", "tool": name, "arguments": arguments}


def answer(text="Candidate visual correspondence observed across keyframes; not legal proof.", iid="incident-a", **citation):
    return {"action": "answer", "text": text, "citations": [{"incident_id": iid, **citation}]}


def clarify(text="Which incident or video would you like me to inspect?"):
    return {"action": "clarify", "text": text}


class TestMuseActiveIncidentSync(unittest.TestCase):
    def setUp(self):
        self.manager = ConversationManager()
        self.store = Store()

        # Set up two test incidents in session-a
        self.store.incidents = [
            incident("incident-alpha", "session-a", scanned="2026-11-01T10:00:00Z"),
            incident("incident-beta", "session-a", scanned="2026-11-01T08:00:00Z"),
        ]
        self.store.incidents[0]["frame_matches"] = [frame(5, 10, 1)]
        self.store.incidents[1]["frame_matches"] = [frame(12, 20, 2)]

        self.tools = MuseToolRegistry(self.store)
        self.provider = Mock(provider_name="muse", model_id="muse-wonder-1.0")
        self.factory = Mock(return_value=self.provider)
        self.service = MuseAssistant(self.manager, tools=self.tools, provider_factory=self.factory)

        self.conversation = self.manager.create("session-a", CreateConversationRequest())
        self.id = self.conversation.conversation_id
        self.counter = 0

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_conversation_manager] = lambda: self.manager
        app.dependency_overrides[get_muse_assistant] = lambda: self.service

        self.client = TestClient(app)
        self.headers = {"X-Client-Session-ID": "session-a"}
        self.url = f"/api/muse/conversations/{self.id}/messages"

        for target in ("builtins.open", "pathlib.Path.open", "pathlib.Path.mkdir", "socket.socket.connect"):
            guard = patch(target, side_effect=AssertionError("Unexpected live I/O"))
            guard.start()
            self.addCleanup(guard.stop)

    def plans(self, *plans):
        self.provider.create_text_completion.side_effect = [completion(plan) for plan in plans]

    def send(self, text="Explain what happened in this incident.", selected_incident_id=None, revision=None):
        self.counter += 1
        if revision is None:
            revision = self.manager.get(self.id, "session-a").revision
        payload = {
            "client_message_id": f"client-{self.counter}",
            "text": text,
            "expected_revision": revision,
        }
        if selected_incident_id is not None:
            payload["selected_incident_id"] = selected_incident_id
        return self.client.post(self.url, headers=self.headers, json=payload)

    def test_muse_receives_currently_selected_incident_id(self):
        """1. Muse receives the active incident ID on message send and provides it in hint context."""
        self.plans(
            tool("get_incident_details", incident_id="incident-alpha"),
            answer(iid="incident-alpha")
        )

        resp = self.send("What is the status of this incident?", selected_incident_id="incident-alpha")
        self.assertEqual(resp.status_code, 200, resp.text)
        result = resp.json()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["citations"][0]["incident_id"], "incident-alpha")

        # Verify conversation state updated
        conv = self.manager.get(self.id, "session-a")
        self.assertEqual(conv.selected_incident_id, "incident-alpha")

        # Verify provider request included selected_incident_hint
        call_prompt = self.provider.create_text_completion.call_args_list[0].args[0]["messages"][1]["content"]
        payload = json.loads(call_prompt.split("\n", 1)[1])
        self.assertEqual(payload.get("selected_incident_hint"), "incident-alpha")

    def test_changing_selected_incident_updates_context_and_prunes_old_sources(self):
        """2. Switching active incident updates context and prevents evidence mixing from previous incident."""
        # Turn 1: user views incident-alpha
        self.plans(
            tool("get_incident_details", incident_id="incident-alpha"),
            answer("Alpha observed visual matches.", iid="incident-alpha")
        )
        resp1 = self.send("Review this video", selected_incident_id="incident-alpha")
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(self.manager.get(self.id, "session-a").selected_incident_id, "incident-alpha")

        # Turn 2: user switches dashboard selection to incident-beta
        self.plans(
            tool("get_incident_details", incident_id="incident-beta"),
            answer("Beta observed separate matches.", iid="incident-beta")
        )
        resp2 = self.send("Now review this other video", selected_incident_id="incident-beta")
        self.assertEqual(resp2.status_code, 200, resp2.text)

        # Context updated
        conv2 = self.manager.get(self.id, "session-a")
        self.assertEqual(conv2.selected_incident_id, "incident-beta")

        # Verify turn 2 prompt had selected_incident_hint for beta
        turn2_prompt = self.provider.create_text_completion.call_args_list[2].args[0]["messages"][1]["content"]
        payload2 = json.loads(turn2_prompt.split("\n", 1)[1])
        self.assertEqual(payload2.get("selected_incident_hint"), "incident-beta")

        # Stored grounding for conversation now only contains beta evidence
        grounding = self.manager._grounding.get(self.id, [])
        for src in grounding:
            src_iids = [src["data"].get("incident_id")]
            self.assertNotIn("incident-alpha", src_iids)

    def test_incident_specific_tools_prioritize_selected_incident(self):
        """3. Incident-specific tools (bundle, timestamps, reports) retrieve from selected incident."""
        self.plans(
            tool("get_evidence_bundle", incident_id="incident-beta"),
            answer("The evidence bundle shows keyframe correspondence.", iid="incident-beta", evidence_id="frame_2_t12s", timestamp_sec=12)
        )
        resp = self.send("What evidence was captured?", selected_incident_id="incident-beta")
        self.assertEqual(resp.status_code, 200, resp.text)
        tool_res = resp.json()["tool_results"][0]
        self.assertEqual(tool_res["tool"], "get_evidence_bundle")
        self.assertEqual(tool_res["status"], "completed")
        self.assertEqual(tool_res["data"]["incident_id"], "incident-beta")

    def test_clean_no_match_incident_handled_correctly(self):
        """4. Clean/no-match incidents retrieve valid zero-match bundle and ground truthful response."""
        clean_inc = incident("incident-clean", "session-a", scanned="2026-11-01T09:00:00Z")
        clean_inc["overall_status"] = "CLEAN"
        clean_inc["frame_matches"] = [
            {
                "submitted_frame": {"filename": "f0.jpg", "timestamp_sec": 0},
                "best_match": {"similarity_status": "NO_MATCH", "match_confirmed": False, "l2_distance": 1.2},
            }
        ]
        self.store.incidents.append(clean_inc)

        self.plans(
            tool("get_evidence_bundle", incident_id="incident-clean"),
            answer("The scan found NO_MATCH across analyzed frames; media is verified clean.", iid="incident-clean")
        )
        resp = self.send("Was anything detected?", selected_incident_id="incident-clean")
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json()["status"], "completed")
        self.assertEqual(resp.json()["citations"][0]["incident_id"], "incident-clean")

    def test_missing_or_invalid_incident_ids_do_not_cause_cross_incident_leakage(self):
        """5. Foreign or nonexistent incident IDs do not leak data or cause cross-session contamination."""
        # Foreign incident belonging to session-b
        self.store.incidents.append(incident("foreign-inc", "session-b"))

        # User attempts to pass foreign incident as active context
        self.plans(clarify())
        resp = self.send("Explain this video", selected_incident_id="foreign-inc")

        # Must succeed safely with clarify or clear foreign ID (no cross-session data leak)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "needs_clarification")

        # Stored conversation must NOT store foreign incident
        conv = self.manager.get(self.id, "session-a")
        self.assertNotEqual(conv.selected_incident_id, "foreign-inc")

        # Nonexistent incident ID
        self.plans(clarify())
        resp2 = self.send("Tell me about this", selected_incident_id="nonexistent-id-999")
        self.assertEqual(resp2.status_code, 200)
        conv2 = self.manager.get(self.id, "session-a")
        self.assertIsNone(conv2.selected_incident_id)

    def test_conversation_without_active_incident_retains_supported_behavior(self):
        """6. Conversations without an active incident retain list/latest and clarify behavior."""
        # Ambiguous request without active incident triggers clarify
        self.plans(clarify("Please specify which incident you would like to investigate."))
        resp = self.send("What happened in this video?", selected_incident_id=None)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "needs_clarification")

        # Explicit request for latest incident works as expected
        self.plans(
            tool("get_latest_incident"),
            answer(iid="incident-alpha")
        )
        resp2 = self.send("Show me the latest incident", selected_incident_id=None)
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.json()["tool_results"][0]["tool"], "get_latest_incident")

    def test_existing_muse_citations_and_grounding_remain_intact(self):
        """7. Citations and timestamps remain strictly bounded against active incident evidence."""
        # Attempting to cite an evidence timestamp not in the bundle fails grounding
        self.plans(
            tool("get_matching_timestamps", incident_id="incident-alpha"),
            answer("Matched at timestamp 999s", iid="incident-alpha", evidence_id="frame_1_t5s", timestamp_sec=999)
        )
        resp = self.send("When did it match?", selected_incident_id="incident-alpha")
        self.assertEqual(resp.status_code, 502)
        self.assertEqual(resp.json()["error"], "UNGROUNDED_RESPONSE")


if __name__ == "__main__":
    unittest.main()
