"""Read-only temporal analysis routes, safely importable without application startup."""
import re
from fastapi import APIRouter, Depends, Header, HTTPException
from app.temporal_evidence import TemporalEvidenceResult, build_temporal_evidence_for_incident

router = APIRouter(tags=['temporal-evidence'])


def incident_reader():
    from app.registry import get_incident_by_id
    return lambda iid: get_incident_by_id(iid, strict_read=True)


def demo_mode():
    from app.security import is_demo_mode
    return is_demo_mode()


@router.get('/api/incidents/{incident_id}/temporal-evidence', response_model=TemporalEvidenceResult)
def temporal_evidence(incident_id: str, x_client_session_id: str | None = Header(None),
                      read=Depends(incident_reader), demo=Depends(demo_mode)):
    if not x_client_session_id or not re.fullmatch(r'[A-Za-z0-9_-]{3,64}', x_client_session_id):
        raise HTTPException(400, 'A valid client session header is required.')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', incident_id):
        raise HTTPException(400, 'Invalid incident ID format.')
    incident = read(incident_id)
    if not incident:
        raise HTTPException(404, 'Incident not found.')
    if not demo and incident.get('session_id') not in (x_client_session_id, 'demo-showcase'):
        raise HTTPException(403, 'Access denied: incident belongs to a different session.')
    return build_temporal_evidence_for_incident(incident)
