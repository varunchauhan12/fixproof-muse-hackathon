"""Isolated ASGI lifecycle tests; never import app.main or initialize its services."""
import unittest
from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.muse_conversation_api import get_conversation_manager, router
from app.muse_conversations import ConversationManager


class TestConversationAPI(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.manager = ConversationManager(ttl_seconds=10, clock=lambda: self.now)
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_conversation_manager] = lambda: self.manager
        self.client = TestClient(app)
        self.headers = {"X-Client-Session-ID": "demo-session"}
        self.path = "/api/muse/conversations"

    def create(self):
        response = self.client.post(self.path, json={}, headers=self.headers)
        self.assertEqual(response.status_code, 201)
        return response.json()

    def test_lifecycle(self):
        created = self.create()
        path = f"{self.path}/{created['conversation_id']}"
        self.assertEqual(created["revision"], 0)
        self.assertEqual(created["messages"], [])
        response = self.client.get(path, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["conversation_id"], created["conversation_id"])
        response = self.client.delete(path, headers=self.headers)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.content, b"")
        self.assertEqual(self.client.get(path, headers=self.headers).status_code, 404)

    def test_session_required_on_every_endpoint(self):
        path = f"{self.path}/{self.create()['conversation_id']}"
        for headers in ({}, {"X-Client-Session-ID": ""}, {"X-Client-Session-ID": "ab"},
                        {"X-Client-Session-ID": "bad session"}, {"X-Client-Session-ID": "x" * 65}):
            for method, url in (("POST", self.path), ("GET", path), ("DELETE", path)):
                with self.subTest(method=method, headers=headers):
                    response = self.client.request(method, url, headers=headers, **({"json": {}} if method == "POST" else {}))
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(response.json()["error"], "INVALID_SESSION")

    def test_session_mismatch(self):
        path = f"{self.path}/{self.create()['conversation_id']}"
        for method in ("GET", "DELETE"):
            response = self.client.request(method, path, headers={"X-Client-Session-ID": "other-session"})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()["error"], "SESSION_MISMATCH")
        self.assertEqual(self.client.get(path, headers=self.headers).status_code, 200)

    def test_unknown_and_expired(self):
        path = f"{self.path}/{self.create()['conversation_id']}"
        self.now = 10
        for suffix in (path, f"{self.path}/{uuid4()}"):
            for method in ("GET", "DELETE"):
                response = self.client.request(method, suffix, headers=self.headers)
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.json(), {"error": "CONVERSATION_NOT_FOUND", "detail": "Conversation not found or expired."})

    def test_invalid_payloads(self):
        for payload in (None, [], {"selected_incident_id": "../path"}, {"selected_incident_id": 123},
                        {"session_id": "other-session"}, {"conversation_id": str(uuid4())}, {"revision": 10}):
            with self.subTest(payload=payload):
                response = self.client.post(self.path, json=payload, headers=self.headers)
                self.assertEqual(response.status_code, 422)
        self.assertEqual(len(self.manager._items), 0)
        self.assertEqual(self.client.get(f"{self.path}/invalid-id", headers=self.headers).status_code, 422)

    def test_selected_incident_is_only_a_hint(self):
        response = self.client.post(self.path, json={"selected_incident_id": "case-demo"}, headers=self.headers)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["selected_incident_id"], "case-demo")

    def test_history_retrieval_and_message_payload_validation(self):
        created = self.create()
        from uuid import UUID
        self.manager.append(UUID(created["conversation_id"]), "demo-session", "user", "Hello", expected_revision=0)
        path = f"{self.path}/{created['conversation_id']}"
        response = self.client.get(path, headers=self.headers).json()
        self.assertEqual(response["revision"], 1)
        self.assertEqual(response["messages"][0]["text"], "Hello")
        self.assertEqual(self.client.post(path + "/messages", headers=self.headers, json={}).status_code, 422)

    def test_capacity_error(self):
        self.manager.max_conversations = 1
        self.create()
        response = self.client.post(self.path, json={}, headers=self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"], "CONVERSATION_CAPACITY")
