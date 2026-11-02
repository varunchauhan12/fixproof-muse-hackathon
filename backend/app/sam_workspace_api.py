"""Session-scoped SAM workspace routes; no inference on GET."""
from functools import lru_cache
import io
from PIL import Image
from typing import Literal
from fastapi import APIRouter, Depends, Header, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from app.sam_workspace import SAMWorkspace

router = APIRouter(prefix='/api/sam/incidents', tags=['sam-workspace'])


@lru_cache(maxsize=1)
def get_workspace():
    from app.registry import get_incident_by_id
    from app.security import is_demo_mode
    from app.providers.factory import get_segmentation_provider
    # Existing shared storage resolver and CV gate. Kept lazy for isolated tests.
    def load_frame(*args, **kwargs):
        from app.temporal_selector import load_frame_image_bytes
        return load_frame_image_bytes(*args, **kwargs)
    def threshold():
        from app.matcher import SUSPECT_THRESHOLD
        return SUSPECT_THRESHOLD
    return SAMWorkspace(lambda iid: get_incident_by_id(iid, strict_read=True), load_frame, get_segmentation_provider, threshold, is_demo_mode)


class InvestigationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    prompt: str = Field(min_length=1, max_length=200)


@router.get('/{incident_id}/candidates')
def candidates(incident_id: str, x_client_session_id: str | None = Header(None), workspace=Depends(get_workspace)):
    return {'candidates': workspace.queue(incident_id, x_client_session_id)}


@router.get('/{incident_id}/candidates/{candidate_id}')
def inspect(incident_id: str, candidate_id: str, prompt: str = Query(min_length=1, max_length=200), x_client_session_id: str | None = Header(None), workspace=Depends(get_workspace)):
    return workspace.inspect(incident_id, candidate_id, x_client_session_id, prompt.strip())


@router.post('/{incident_id}/candidates/{candidate_id}')
def investigate(incident_id: str, candidate_id: str, payload: InvestigationRequest, x_client_session_id: str | None = Header(None), workspace=Depends(get_workspace)):
    return workspace.inspect(incident_id, candidate_id, x_client_session_id, payload.prompt, run=True)


@router.get('/{incident_id}/candidates/{candidate_id}/frames/{target}')
def frame(incident_id: str, candidate_id: str, target: Literal['reference', 'suspect'], x_client_session_id: str | None = Header(None), workspace=Depends(get_workspace)):
    pair, item, candidate = workspace.resolve(incident_id, candidate_id, x_client_session_id)
    data, _ = workspace.frame_bytes(pair, item, candidate, target)
    with Image.open(io.BytesIO(data)) as image:
        media_type = Image.MIME.get(image.format, 'application/octet-stream')
    return Response(data, media_type=media_type, headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


class AutomaticRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    retry: bool = False


@router.post('/{incident_id}/candidates/{candidate_id}/automatic')
def automatic(incident_id: str, candidate_id: str, payload: AutomaticRequest, x_client_session_id: str | None = Header(None), workspace=Depends(get_workspace)):
    from app.sam_scene import MuseSceneDiscovery
    return workspace.automatic(incident_id, candidate_id, x_client_session_id, MuseSceneDiscovery(), payload.retry)


def read_cached_context(incident, session):
    """Read only an already-existing workspace; never initialize providers/load frames."""
    if not get_workspace.cache_info().currsize:
        return {'availability': 'UNAVAILABLE_OR_EXPIRED', 'observations': [],
                'limitation': 'No current in-process snapshot. This does not establish that SAM never ran.'}
    return get_workspace().read_cached_context(incident, session)
