"""Conversation lifecycle and bounded read-only Muse message processing."""
from functools import lru_cache
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request, Response
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from app.muse_conversations import (
    Conversation, ConversationError, ConversationManager, CreateConversationRequest, MessageRequest, MessageResponse,
    validate_session,
)
from app.muse_tools import MuseToolResult


class ConversationRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def safe_handler(request: Request):
            try:
                return await handler(request)
            except ConversationError as exc:
                body = {"error": exc.code, "detail": exc.detail}
                if exc.revision is not None:
                    body["revision"] = exc.revision
                return JSONResponse(body, status_code=exc.status_code)
        return safe_handler


router = APIRouter(prefix="/api/muse/conversations", tags=["muse-conversations"], route_class=ConversationRoute)


@lru_cache(maxsize=1)
def get_conversation_manager() -> ConversationManager:
    return ConversationManager.from_environment()


def require_session(x_client_session_id: Annotated[str | None, Header()] = None) -> str:
    return validate_session(x_client_session_id)


Session = Annotated[str, Depends(require_session)]
Manager = Annotated[ConversationManager, Depends(get_conversation_manager)]


def get_muse_assistant(manager: Manager):
    from app.muse_orchestrator import MuseAssistant
    return MuseAssistant(manager)


incident_router = APIRouter(prefix="/api/muse", tags=["muse-conversations"], route_class=ConversationRoute)


@incident_router.get("/incidents", response_model=MuseToolResult)
def list_muse_incidents(session: Session, assistant=Depends(get_muse_assistant)):
    return assistant.tools.execute("list_recent_incidents", session_id=session, arguments={"limit": 25})


@router.post("", response_model=Conversation, status_code=201)
def create_conversation(payload: CreateConversationRequest, session: Session, manager: Manager):
    return manager.create(session, payload)


@router.get("/{conversation_id}", response_model=Conversation)
def get_conversation(conversation_id: UUID, session: Session, manager: Manager):
    return manager.get(conversation_id, session)


@router.delete("/{conversation_id}", status_code=204, response_class=Response)
def delete_conversation(conversation_id: UUID, session: Session, manager: Manager):
    manager.delete(conversation_id, session)
    return Response(status_code=204)


@router.post("/{conversation_id}/messages", response_model=MessageResponse)
def process_message(conversation_id: UUID, payload: MessageRequest, session: Session,
                    assistant=Depends(get_muse_assistant)):
    # Sync route uses FastAPI's worker pool; provider calls do not block its event loop.
    return assistant.respond(conversation_id, session, payload)
