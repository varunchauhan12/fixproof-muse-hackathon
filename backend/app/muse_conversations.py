"""Single-process demo conversations. No providers, persistence, or application actions."""
from datetime import datetime, timezone
from copy import deepcopy
import os
import re
import threading
import time
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Text = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=8000)]
Reference = Annotated[str, StringConstraints(strict=True, pattern=r"^[a-zA-Z0-9_-]{1,128}$")]
SessionID = Annotated[str, StringConstraints(strict=True, pattern=r"^[a-zA-Z0-9_-]{3,64}$")]
Label = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=128)]
Revision = Annotated[int, Field(strict=True, ge=0)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateConversationRequest(Contract):
    # Context hint only: no incident lookup or authorization is performed in Step 3B.
    selected_incident_id: Reference | None = None


class Citation(Contract):
    incident_id: Reference
    evidence_id: Reference | None = None
    report_id: Reference | None = None
    timestamp_sec: Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)] | None = None


class ToolResult(Contract):
    tool: Label
    status: Literal["completed", "failed", "unavailable"]
    result_ref: Reference | None = None
    summary: Text | None = None
    data: dict | None = None
    error_code: Label | None = None


from app.muse_actions import MuseArtifact


class PendingAction(Contract):
    action_id: Reference
    action: Label
    summary: Text
    expires_at: datetime
    incident_id: Reference
    report_id: Reference | None = None
    recipient_email: str | None = Field(default=None, max_length=254)
    subject: str | None = Field(default=None, max_length=200)
    body_preview: str | None = Field(default=None, max_length=20000)
    attachment_name: str | None = Field(default=None, max_length=200)


class MessageMetadata(Contract):
    pending_action: PendingAction | None = None
    artifacts: list[MuseArtifact] = Field(default_factory=list, max_length=4)
    client_message_id: Reference | None = None
    provider: Label | None = None
    model_id: Label | None = None
    status: Literal["completed", "needs_clarification", "awaiting_confirmation", "failed"] | None = None
    citations: list[Citation] = Field(default_factory=list, max_length=20)
    tool_results: list[ToolResult] = Field(default_factory=list, max_length=3)


class ConversationMessage(Contract):
    message_id: UUID = Field(default_factory=uuid4)
    role: Literal["user", "assistant"]
    text: Text
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: MessageMetadata = Field(default_factory=MessageMetadata)


class Conversation(Contract):
    conversation_id: UUID = Field(default_factory=uuid4)
    session_id: SessionID
    revision: Revision = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_activity_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    messages: list[ConversationMessage] = Field(default_factory=list, max_length=100)
    selected_incident_id: Reference | None = None


class EmailDraft(Contract):
    report_id: Reference
    subject: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200, pattern=r"^[^\r\n]+$")]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]


class ActionDecision(Contract):
    expected_revision: Revision
    selected_incident_id: Reference


class MessageRequest(Contract):
    email_draft: EmailDraft | None = None
    """Natural-language message input with optimistic revision checking."""
    client_message_id: Reference
    text: Text
    expected_revision: Revision
    selected_incident_id: Reference | None = None




class MessageResponse(Contract):
    artifacts: list[MuseArtifact] = Field(default_factory=list, max_length=4)
    """Turn result; provenance is null when no model request was attempted."""
    conversation_id: UUID
    revision: Revision
    message_id: UUID
    status: Literal["completed", "needs_clarification", "awaiting_confirmation", "failed"]
    text: Text
    citations: list[Citation] = Field(default_factory=list, max_length=20)
    tool_results: list[ToolResult] = Field(default_factory=list, max_length=10)
    pending_action: PendingAction | None = None
    provider: Label | None = None
    model_id: Label | None = None


class ConversationError(Exception):
    def __init__(self, status_code: int, code: str, detail: str, revision: int | None = None):
        self.status_code, self.code, self.detail = status_code, code, detail
        self.revision = revision
        super().__init__(detail)


def validate_session(session_id: str | None) -> str:
    if not isinstance(session_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{3,64}", session_id):
        raise ConversationError(400, "INVALID_SESSION", "A valid X-Client-Session-ID header is required.")
    return session_id


class ConversationManager:
    """Locked, bounded memory; copies prevent callers from mutating stored state.

    Successful reads/appends refresh idle TTL. Revisions count appended messages,
    including messages pruned from history. Turn message IDs are deduplicated within
    retained history; one reserved turn at a time prevents interleaved writers.
    """
    def __init__(self, ttl_seconds=1800, max_messages=40, max_conversations=256, clock=time.monotonic):
        if not 1 <= ttl_seconds <= 86400 or not 1 <= max_messages <= 100 or max_conversations < 1:
            raise ValueError("Invalid conversation storage limits.")
        self.ttl_seconds = ttl_seconds
        self.max_messages = max_messages
        self.max_conversations = max_conversations
        self._clock = clock
        self._items: dict[UUID, tuple[Conversation, float]] = {}
        self._active_turns: dict[UUID, UUID] = {}
        self._grounding: dict[UUID, list[dict]] = {}
        self._pending: dict[UUID, dict] = {}
        self._lock = threading.Lock()

    @classmethod
    def from_environment(cls):
        return cls(ttl_seconds=int(os.getenv("MUSE_CONVERSATION_TTL_SECONDS", "1800")))

    def _expire(self, now):
        for key in [key for key, (_, touched) in self._items.items() if now - touched >= self.ttl_seconds]:
            del self._items[key]
            self._active_turns.pop(key, None)
            self._grounding.pop(key, None)
            self._pending.pop(key, None)

    def _find(self, conversation_id, session_id, now):
        validate_session(session_id)
        self._expire(now)
        item = self._items.get(conversation_id)
        if item is None:
            raise ConversationError(404, "CONVERSATION_NOT_FOUND", "Conversation not found or expired.")
        if item[0].session_id != session_id:
            raise ConversationError(403, "SESSION_MISMATCH", "Conversation belongs to a different session.")
        return item[0]

    def create(self, session_id: str, request: CreateConversationRequest) -> Conversation:
        validate_session(session_id)
        with self._lock:
            now = self._clock()
            self._expire(now)
            if len(self._items) >= self.max_conversations:
                raise ConversationError(503, "CONVERSATION_CAPACITY", "Conversation capacity reached. Delete a conversation or try later.")
            conversation = Conversation(session_id=session_id, selected_incident_id=request.selected_incident_id)
            self._items[conversation.conversation_id] = (conversation, now)
            return conversation.model_copy(deep=True)

    def get(self, conversation_id: UUID, session_id: str) -> Conversation:
        with self._lock:
            now = self._clock()
            conversation = self._find(conversation_id, session_id, now)
            conversation.last_activity_at = datetime.now(timezone.utc)
            self._items[conversation_id] = (conversation, now)
            return conversation.model_copy(deep=True)

    def append(self, conversation_id: UUID, session_id: str, role: Literal["user", "assistant"],
               text: str, *, expected_revision: int, metadata: MessageMetadata | None = None) -> Conversation:
        # Validate before mutation; bool/string revisions must not silently coerce.
        request = MessageRequest(client_message_id="internal", text=text, expected_revision=expected_revision)
        message = ConversationMessage(
            role=role, text=request.text, metadata=metadata or MessageMetadata()
        ).model_copy(deep=True)
        with self._lock:
            now = self._clock()
            conversation = self._find(conversation_id, session_id, now)
            if conversation_id in self._active_turns:
                raise ConversationError(409, "TURN_IN_PROGRESS", "A message is already being processed.")
            if conversation.revision != request.expected_revision:
                raise ConversationError(409, "REVISION_CONFLICT", "Conversation changed. Retrieve it before retrying.")
            conversation.messages = (conversation.messages + [message])[-self.max_messages:]
            conversation.revision += 1
            conversation.last_activity_at = message.created_at
            self._items[conversation_id] = (conversation, now)
            return conversation.model_copy(deep=True)

    def delete(self, conversation_id: UUID, session_id: str) -> None:
        with self._lock:
            self._find(conversation_id, session_id, self._clock())
            if conversation_id in self._active_turns:
                raise ConversationError(409, "TURN_IN_PROGRESS", "A message is already being processed.")
            del self._items[conversation_id]
            self._grounding.pop(conversation_id, None)
            self._pending.pop(conversation_id, None)

    def begin_turn(self, conversation_id: UUID, session_id: str, request: MessageRequest):
        """Atomically reserve one turn and append its user message before any inference."""
        message = ConversationMessage(role="user", text=request.text,
                                      metadata=MessageMetadata(client_message_id=request.client_message_id))
        with self._lock:
            now = self._clock()
            conversation = self._find(conversation_id, session_id, now)
            if conversation_id in self._active_turns:
                raise ConversationError(409, "TURN_IN_PROGRESS", "A message is already being processed.")
            if conversation.revision != request.expected_revision:
                raise ConversationError(409, "REVISION_CONFLICT", "Conversation changed. Retrieve it before retrying.")
            if any(m.metadata.client_message_id == request.client_message_id for m in conversation.messages):
                raise ConversationError(409, "DUPLICATE_MESSAGE", "This client message ID was already used.")
            self._pending.pop(conversation_id, None)
            token = uuid4()
            self._active_turns[conversation_id] = token
            conversation.messages = (conversation.messages + [message])[-self.max_messages:]
            conversation.revision += 1
            conversation.last_activity_at = message.created_at
            self._items[conversation_id] = (conversation, now)
            return token, conversation.model_copy(deep=True), deepcopy(self._grounding.get(conversation_id, []))

    def finish_turn(self, conversation_id: UUID, session_id: str, token: UUID, *, expected_revision: int,
                    text: str, metadata: MessageMetadata, grounding: list[dict], selected_incident_id: str | None):
        """Only the reserved turn may append its assistant result and update context."""
        message = ConversationMessage(role="assistant", text=text, metadata=metadata).model_copy(deep=True)
        with self._lock:
            now = self._clock()
            conversation = self._find(conversation_id, session_id, now)
            if self._active_turns.get(conversation_id) != token or conversation.revision != expected_revision:
                raise ConversationError(409, "REVISION_CONFLICT", "Conversation changed. Retrieve it before retrying.")
            conversation.messages = (conversation.messages + [message])[-self.max_messages:]
            conversation.revision += 1
            conversation.last_activity_at = message.created_at
            conversation.selected_incident_id = selected_incident_id
            self._grounding[conversation_id] = deepcopy(grounding)
            self._items[conversation_id] = (conversation, now)
            del self._active_turns[conversation_id]
            return conversation.model_copy(deep=True)

    def propose_action(self, conversation_id, session, token, card, payload):
        with self._lock:
            self._find(conversation_id, session, self._clock())
            if self._active_turns.get(conversation_id) != token:
                raise ConversationError(409, "REVISION_CONFLICT", "The conversation changed.")
            self._pending[conversation_id] = {"card": card.model_copy(deep=True),
                "payload": deepcopy(payload), "created": self._clock(), "consumed": False}

    def claim_action(self, conversation_id, session, action_id, expected_revision, incident_id, *, cancel=False):
        with self._lock:
            now = self._clock()
            conversation = self._find(conversation_id, session, now)
            pending = self._pending.get(conversation_id)
            if not pending or pending["card"].action_id != str(action_id) or pending["consumed"]:
                raise ConversationError(409, "ACTION_UNAVAILABLE", "This proposal is no longer available or has already been handled.")
            if now - pending["created"] >= 600:
                raise ConversationError(410, "ACTION_EXPIRED", "This proposal expired. Ask for a new proposal.")
            if conversation_id in self._active_turns or conversation.revision != expected_revision:
                raise ConversationError(409, "REVISION_CONFLICT", "Retrieve the conversation before acting on this proposal.")
            if conversation.selected_incident_id != pending["card"].incident_id or incident_id != pending["card"].incident_id:
                raise ConversationError(409, "ACTION_CONTEXT_CHANGED", "The selected incident changed. Ask for a new proposal.")
            pending["consumed"] = True # Claim before external I/O; no repeated/uncertain sends.
            token = uuid4()
            self._active_turns[conversation_id] = token
            message = ConversationMessage(role="user", text="Cancelled proposed action." if cancel else "Approved proposed action.")
            conversation.messages = (conversation.messages + [message])[-self.max_messages:]
            conversation.revision += 1
            self._items[conversation_id] = (conversation, now)
            return token, conversation.model_copy(deep=True), deepcopy(pending["payload"]), deepcopy(self._grounding.get(conversation_id, []))

    def release_turn(self, conversation_id: UUID, token: UUID):
        """Cleanup on unexpected failure; never release another turn's reservation."""
        with self._lock:
            if self._active_turns.get(conversation_id) == token:
                del self._active_turns[conversation_id]
