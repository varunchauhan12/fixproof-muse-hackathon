"""Dedicated summary artifacts: GET never invokes a model; POST explicitly generates."""
import re
from functools import lru_cache
from typing import Literal
from fastapi import APIRouter, Depends, Header, HTTPException, Response, Query
from app.evidence_summaries import EvidenceSummaries, identity, summary_pdf
from app.temporal_evidence_api import incident_reader, demo_mode

router = APIRouter(prefix='/api/incidents', tags=['evidence-summaries'])

@lru_cache(maxsize=1)
def get_summaries():
    return EvidenceSummaries()


def authorized(incident_id, session, read, *, allow_demo=False):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', incident_id):
        raise HTTPException(400, 'Invalid incident ID.')
    incident = read(incident_id)
    identity(incident, session, allow_demo=allow_demo)
    if incident.get('incident_id') != incident_id:
        raise HTTPException(404, 'Incident unavailable.')
    return incident


@router.get('/{incident_id}/evidence-summaries/{kind}')
def read_summary(incident_id: str, kind: Literal['sam','temporal'], x_client_session_id: str | None = Header(None), read=Depends(incident_reader), service=Depends(get_summaries), demo=Depends(demo_mode)):
    incident = authorized(incident_id, x_client_session_id, read, allow_demo=demo)
    summary = service.read(incident, x_client_session_id, kind, allow_demo=demo)
    if not summary:
        raise HTTPException(404, 'No current saved summary. Open the evidence workspace to generate one.')
    return summary


@router.post('/{incident_id}/evidence-summaries/{kind}')
def generate_summary(incident_id: str, kind: Literal['sam','temporal'], x_client_session_id: str | None = Header(None), read=Depends(incident_reader), service=Depends(get_summaries), demo=Depends(demo_mode)):
    incident = authorized(incident_id, x_client_session_id, read, allow_demo=demo)
    if kind == 'sam':
        from app.sam_workspace_api import read_cached_context
        evidence = read_cached_context(incident, x_client_session_id)
    else:
        from app.temporal_evidence import build_temporal_evidence_for_incident
        evidence = build_temporal_evidence_for_incident(incident).model_dump(mode='json')
    try:
        return service.generate(incident, x_client_session_id, kind, evidence, allow_demo=demo)
    except HTTPException:
        raise
    except Exception as error:
        # Provider messages/headers and raw model text must not enter API errors/logs.
        from app.providers.meta_client import MetaAPIError
        category = error.category if isinstance(error, MetaAPIError) else 'SUMMARY_VALIDATION_OR_STORAGE_ERROR'
        raise HTTPException(502, f'Evidence summary unavailable ({category}). No automatic retry was made.') from None


@router.get('/{incident_id}/evidence-summaries/{kind}/pdf')
def download_summary(incident_id: str, kind: Literal['sam','temporal'], x_client_session_id: str | None = Header(None), summary_id: str | None = Query(None, pattern=r'^[a-f0-9]{64}$'), read=Depends(incident_reader), service=Depends(get_summaries), demo=Depends(demo_mode)):
    summary = read_summary(incident_id, kind, x_client_session_id, read, service, demo)
    if summary_id and summary['summary_id'] != summary_id:
        raise HTTPException(409, 'This saved summary has been replaced. Request the current summary before downloading.')
    return Response(summary_pdf(summary), media_type='application/pdf', headers={
        'Content-Disposition': f'attachment; filename="fixproof-{kind}-summary.pdf"', 'Cache-Control':'no-store'})
