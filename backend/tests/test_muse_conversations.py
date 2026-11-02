"""Offline service/contract tests. No application startup or external services."""
import unittest
from unittest.mock import patch
from uuid import uuid4
from pydantic import ValidationError
from app.muse_conversations import (
    ConversationError, ConversationManager, ConversationMessage, CreateConversationRequest,
    MessageMetadata, MessageRequest, MessageResponse,
)


class TestConversationManager(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.manager = ConversationManager(ttl_seconds=10, max_messages=2, clock=lambda: self.now)
        self.conversation = self.manager.create("demo-session", CreateConversationRequest())
        self.id = self.conversation.conversation_id

    def assert_error(self, status, code, operation):
        with self.assertRaises(ConversationError) as caught:
            operation()
        self.assertEqual((caught.exception.status_code, caught.exception.code), (status, code))

    def test_creation_retrieval_and_server_identity(self):
        other = self.manager.create("demo-session", CreateConversationRequest(selected_incident_id="incident-demo"))
        self.assertNotEqual(self.id, other.conversation_id)
        self.assertEqual(other.selected_incident_id, "incident-demo")
        self.assertEqual(self.conversation.revision, 0)
        self.assertEqual(self.manager.get(self.id, "demo-session").messages, [])
        self.assertIsNotNone(self.conversation.created_at.tzinfo)
        self.assertEqual(self.conversation.session_id, "demo-session")

    def test_delete_and_unknown(self):
        self.manager.delete(self.id, "demo-session")
        for key in (self.id, uuid4()):
            self.assert_error(404, "CONVERSATION_NOT_FOUND", lambda: self.manager.get(key, "demo-session"))
            self.assert_error(404, "CONVERSATION_NOT_FOUND", lambda: self.manager.delete(key, "demo-session"))

    def test_session_checks_on_all_operations(self):
        for session, code, status in (("other-session", "SESSION_MISMATCH", 403), (None, "INVALID_SESSION", 400)):
            for operation in (
                lambda: self.manager.get(self.id, session),
                lambda: self.manager.delete(self.id, session),
                lambda: self.manager.append(self.id, session, "user", "Hello", expected_revision=0),
            ):
                self.assert_error(status, code, operation)
        self.assertEqual(self.manager.get(self.id, "demo-session").revision, 0)

    def test_append_revision_history_limit_and_roles(self):
        for index, role in enumerate(("user", "assistant", "user")):
            result = self.manager.append(self.id, "demo-session", role, f"Message {index}", expected_revision=index)
            self.assertEqual(result.revision, index + 1)
        self.assertEqual([m.text for m in result.messages], ["Message 1", "Message 2"])
        self.assertEqual([m.role for m in result.messages], ["assistant", "user"])
        self.assertNotEqual(result.messages[0].message_id, result.messages[1].message_id)
        self.assertGreaterEqual(result.last_activity_at, result.created_at)

    def test_revision_conflict_does_not_mutate(self):
        self.assert_error(409, "REVISION_CONFLICT", lambda: self.manager.append(self.id, "demo-session", "user", "Hello", expected_revision=1))
        self.assertEqual(self.manager.get(self.id, "demo-session").revision, 0)

    def test_defensive_copies(self):
        self.conversation.session_id = "other-session"
        metadata = MessageMetadata(client_message_id="original-id")
        self.manager.append(self.id, "demo-session", "user", "Original", expected_revision=0, metadata=metadata)
        metadata.client_message_id = "modified-id"
        result = self.manager.get(self.id, "demo-session")
        result.messages[0].text = "Modified"
        result.messages.clear()
        self.assertEqual(self.manager.get(self.id, "demo-session").messages[0].text, "Original")
        self.assertEqual(self.manager.get(self.id, "demo-session").messages[0].metadata.client_message_id, "original-id")

    def test_restart_has_no_history(self):
        restarted = ConversationManager()
        self.assert_error(404, "CONVERSATION_NOT_FOUND", lambda: restarted.get(self.id, "demo-session"))

    def test_configured_ttl_and_invalid_limits(self):
        with patch.dict("os.environ", {"MUSE_CONVERSATION_TTL_SECONDS": "60"}):
            self.assertEqual(ConversationManager.from_environment().ttl_seconds, 60)
        for limits in ({"ttl_seconds": 0}, {"ttl_seconds": 86401}, {"max_messages": 0},
                       {"max_messages": 101}, {"max_conversations": 0}):
            with self.subTest(limits=limits), self.assertRaises(ValueError):
                ConversationManager(**limits)

    def test_ttl_boundary_and_read_refresh(self):
        self.now = 9
        self.manager.get(self.id, "demo-session")
        self.now = 18
        self.manager.append(self.id, "demo-session", "user", "Hello", expected_revision=0)
        self.now = 28
        self.assert_error(404, "CONVERSATION_NOT_FOUND", lambda: self.manager.get(self.id, "demo-session"))

    def test_wrong_session_does_not_refresh_ttl(self):
        self.now = 9
        self.assert_error(403, "SESSION_MISMATCH", lambda: self.manager.get(self.id, "other-session"))
        self.now = 10
        self.assert_error(404, "CONVERSATION_NOT_FOUND", lambda: self.manager.get(self.id, "demo-session"))

    def test_capacity_and_expiration_cleanup(self):
        manager = ConversationManager(ttl_seconds=10, max_conversations=1, clock=lambda: self.now)
        manager.create("demo-session", CreateConversationRequest())
        self.assert_error(503, "CONVERSATION_CAPACITY", lambda: manager.create("demo-session", CreateConversationRequest()))
        self.now = 10
        manager.create("demo-session", CreateConversationRequest())
        self.assertEqual(len(manager._items), 1)

    def test_invalid_messages_no_mutation(self):
        for text in ("", "   ", "x" * 8001, 123):
            with self.subTest(text_type=type(text).__name__), self.assertRaises(ValidationError):
                self.manager.append(self.id, "demo-session", "user", text, expected_revision=0)
        with self.assertRaises(ValidationError):
            self.manager.append(self.id, "demo-session", "system", "Hello", expected_revision=0)
        self.assertEqual(self.manager.get(self.id, "demo-session").revision, 0)


class TestMessageContracts(unittest.TestCase):
    def test_request_bounds_and_unknown_fields(self):
        base = {"client_message_id": "client-1", "text": "Hello", "expected_revision": 0}
        self.assertEqual(MessageRequest(**base).text, "Hello")
        for changes in ({"client_message_id": ""}, {"client_message_id": "x" * 129}, {"text": " "},
                        {"text": "x" * 8001}, {"expected_revision": -1}, {"expected_revision": True},
                        {"expected_revision": "1"}, {"extra": "ignored?"}):
            with self.subTest(changes=list(changes)), self.assertRaises(ValidationError):
                MessageRequest(**(base | changes))

    def test_metadata_and_roles_bounded(self):
        for payload in ({"provider": "x" * 129}, {"extra": "value"}):
            with self.assertRaises(ValidationError):
                MessageMetadata(**payload)
        with self.assertRaises(ValidationError):
            ConversationMessage(role="tool", text="Hello")

    def test_future_response_schema(self):
        base = dict(conversation_id=uuid4(), revision=1, message_id=uuid4(), status="completed", text="Hello")
        response = MessageResponse(**base)
        self.assertIsNone(response.provider)
        self.assertIsNone(response.model_id)
        self.assertEqual(response.citations, [])
        for changes in ({"status": "invented"}, {"citations": [{"incident_id": "case", "timestamp_sec": -1}]},
                        {"tool_results": [{"tool": "example", "status": "completed"}] * 11},
                        {"pending_action": {"action": "send"}}):
            with self.subTest(changes=list(changes)), self.assertRaises(ValidationError):
                MessageResponse(**(base | changes))
