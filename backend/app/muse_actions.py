"""Small explicit chat actions. Never part of the six read-only model tools.

Only the current user message selects an action; stored/model text cannot dispatch it.
Existing conversation reservation provides per-turn duplicate protection. Email additionally
has process-local, bounded duplicate protection across conversations.
"""
from collections import OrderedDict
from datetime import datetime, timezone
import os
import re
import threading
import time
from uuid import uuid4
from pydantic import BaseModel, ConfigDict
from typing import Annotated, Literal
from pydantic import StringConstraints
Reference = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,128}$")]
class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")
from pydantic import Field


class MuseArtifact(Contract):
    artifact_id: Reference
    incident_id: Reference
    kind: str = Field(max_length=40)
    report_id: Reference | None = None
    summary_kind: Literal['sam', 'temporal'] | None = None
    title: str = Field(max_length=200)
    body: str = Field(max_length=20000)
    model_id: str | None = Field(default=None, max_length=128)
    status: str = Field(default='READY', max_length=40)
    truncated: bool = False


class ActionFailure(Exception):
    pass


def action_for_text(text):
    lower = text.lower().strip()
    if re.search(r'\b(how (?:do|can|to|would)|what would|explain how)\b', lower):
        return None
    instruction = re.sub(r'^(?:(?:please|can you|could you|would you|i want you to|i need you to)\s+)+', '', lower)
    if not re.match(r'^(generate|create|prepare|draft|write|make|download|give me|summarize|edit|send|email|mail)\b', instruction):
        return None
    send = bool(re.search(r'\b(send|email me|mail me)\b', lower))
    dont_send = bool(re.search(r"\b(don'?t|do not|never)\s+(?:actually\s+)?send\b", lower))
    if (send or 'email' in lower or 'e-mail' in lower) and re.search(r'\b(prepare|draft|write|send|email|mail)\b', lower):
        return 'prepare_email' if dont_send or not send else 'send_registered'
    if re.search(r"\b(don'?t|do not|never)\s+(generate|create|prepare|make|write)\b", lower):
        return None
    if re.search(r'\bedit\b', lower) and re.search(r'licen|copyright|notice|proposal|summary', lower):
        return 'edit_document'
    if not re.search(r'\b(generate|create|prepare|draft|write|make|download|give me|summarize)\b', lower):
        return None
    if re.search(r'copyright|takedown|notice', lower):return 'copyright'
    if re.search(r'licens|licenc|revenue.shar|proposal', lower):return 'licensing'
    if 'summary' in lower or 'summarize' in lower:return 'summary'
    if re.search(r'\b(pdf|report)\b', lower):return 'report'
    return None


def registered_email():
    value=os.getenv('MUSE_REGISTERED_EMAIL','').strip()
    if not value or len(value)>254 or not re.fullmatch(r'[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+',value):
        raise ActionFailure('MUSE_REGISTERED_EMAIL is missing or invalid on the server. Configure the fixed student recipient before sending.')
    return value


def existing_services():
    from app import detailed_report as reports, document_actions as documents
    return reports, documents


_send_lock=threading.Lock()
_sends=OrderedDict()
_generating=set()


class MuseActions:
    def __init__(self, services=existing_services, clock=time.monotonic):
        self.services,self.clock=services,clock

    def prepare(self, action, *, incident, session, text, conversation, email_draft=None):
        """Read preparation only. Generation and email sending require a claimed approval."""
        allowed = {'report','copyright','licensing','summary','prepare_email','send_registered','edit_document'}
        if action not in allowed:raise ActionFailure('This action is not supported.')
        if action=='send_registered' and re.search(r"(?:don'?t|do not|never|without)\s+send|draft.only",text,re.I):
            action='prepare_email'
        iid=incident['incident_id']
        payload={'action':action,'incident_id':iid,'text':text}
        card={'action':action,'incident_id':iid,'summary':f"Prepare {action.replace('_',' ')} for the selected investigation. Nothing has been generated or sent yet."}
        if action not in ('send_registered','prepare_email'):return card,payload
        if '@' in text or re.search(r'copyright|licens|licenc|notice|third.party|arbitrary',text,re.I):
            raise ActionFailure('Chat email approval supports only the investigation PDF to the configured registered recipient. No third-party destination or rights document was selected.')
        destination=registered_email() if action=='send_registered' else None
        reports,documents=self.services()
        if action=='send_registered' and not documents.get_email_config()[0]:
            raise ActionFailure('Resend is not configured on this server. Nothing was sent. You can still prepare or download the report.')
        items=reports.list_detailed_reports_for_incident(iid)
        report=None
        for item in items:
            value=reports.get_detailed_report_record(item['report_id'])
            if value and value.get('incident_id')==iid:
                pdf=reports.get_detailed_report_pdf_bytes(value['report_id'])
                if pdf and pdf.startswith(b'%PDF-'):
                    report=value;break
        if not report:
            payload['action']='generate_for_email'
            payload['followup']=action
            card.update(action='generate_for_email',summary='No saved PDF is available. Approve generating the report/PDF first; a separate exact email approval will follow. No email will be sent by this step.')
            return card,payload
        rid=report['report_id']
        subject=f'FixProof investigation report — {iid[:8]}'
        body=f"Please review the attached investigation report.\n\nIncident: {iid}\nReport: {rid}\n\n{(report.get('sections') or {}).get('executive_summary') or 'See the attached measured evidence.'}\n\nSampled evidence requires human review; no legal conclusion is established."
        if email_draft:
            if email_draft.report_id != rid:raise ActionFailure('The edited email refers to a different report. Prepare a new email approval.')
            subject,body=email_draft.subject,email_draft.body
        if len(body)>20000:raise ActionFailure('The cover note is too long. Prepare a shorter email draft.')
        import hashlib
        payload.update(report_id=rid,recipient=destination,subject=subject,body=body,pdf_sha256=hashlib.sha256(pdf).hexdigest())
        card.update(report_id=rid,recipient_email=destination,subject=subject,body_preview=body,
                    attachment_name=f'fixproof-detailed-report-{iid[:8]}.pdf',
                    summary='Approving will send this exact cover note and PDF to your registered email. Provider acceptance does not prove delivery.' if action=='send_registered' else 'Approve preparing this editable email draft. No email will be sent.')
        return card,payload

    def execute_prepared(self, payload, *, incident, session, conversation):
        action=payload['action']
        if action not in ('send_registered','generate_for_email','prepare_email'):
            return (*self.execute(action,incident=incident,session=session,text=payload['text'],conversation=conversation),None)
        if action=='generate_for_email':
            status,text,artifacts=self.execute('report',incident=incident,session=session,text='Generate a report.',conversation=conversation)
            if payload.get('followup')=='prepare_email':
                status,text,drafts=self.execute('prepare_email',incident=incident,session=session,text=payload['text'],conversation=conversation)
                return status,'The report and editable email draft are ready. Nothing was sent.',drafts,None
            card,prepared=self.prepare('send_registered',incident=incident,session=session,text=payload['text'],conversation=conversation)
            return status,'The PDF is ready. Review and approve the exact email below; nothing has been sent.',artifacts,(card,prepared)
        reports,documents=self.services()
        if action=='send_registered' and registered_email()!=payload['recipient']:raise ActionFailure('The registered recipient changed. Prepare a new approval.')
        record=reports.get_detailed_report_record(payload['report_id'])
        pdf=reports.get_detailed_report_pdf_bytes(payload['report_id'])
        import hashlib
        if not record or record.get('incident_id')!=incident['incident_id'] or not pdf or hashlib.sha256(pdf).hexdigest()!=payload['pdf_sha256']:
            raise ActionFailure('The approved report/PDF changed or is unavailable. Prepare a new approval.')
        saved_artifact=MuseArtifact(artifact_id=str(uuid4()),incident_id=incident['incident_id'],kind='report',report_id=payload['report_id'],title='Approved investigation PDF',body='The approved saved PDF remains available for download.',model_id=record.get('model_id'))
        if action=='prepare_email':
            draft=MuseArtifact(artifact_id=str(uuid4()),incident_id=incident['incident_id'],kind='email',report_id=payload['report_id'],title=payload['subject'],body=payload['body'],status='DRAFT')
            return 'completed','Editable email draft prepared. Nothing was sent.',[draft],None
        configured,_,_=documents.get_email_config()
        if not configured:raise ActionFailure('Resend is not configured. Nothing was sent. The saved PDF remains available.')
        key=(session,incident['incident_id'],payload['report_id'],payload['recipient'])
        with _send_lock:
            previous=_sends.get(key)
            if previous and (self.clock()-previous[0]<=600 or previous[1]=='PENDING'):
                raise ActionFailure('A send attempt for this report already exists. No duplicate or uncertain send was retried; inspect the audit before another attempt.')
            for old in list(_sends):
                if self.clock()-_sends[old][0]>600 and _sends[old][1]!='PENDING':del _sends[old]
            if len(_sends)>=128:raise ActionFailure('Email attempt capacity reached. No email was sent.')
            _sends[key]=(self.clock(),'PENDING')
        try:
            result=reports.send_detailed_report_email(incident['incident_id'],payload['report_id'],payload['recipient'],pdf,
                client_session_id=session,subject_override=payload['subject'],body_override=payload['body'])
        except Exception:
            with _send_lock:_sends[key]=(self.clock(),'UNCERTAIN')
            return 'failed','Email outcome is uncertain. No retry was made; inspect the audit. The saved PDF remains available.',[saved_artifact],None
        accepted=result.get('success') is True and result.get('status')=='ACCEPTED'
        with _send_lock:_sends[key]=(self.clock(),'ACCEPTED' if accepted else 'FAILED')
        return ('completed' if accepted else 'failed',
                'Resend accepted the approved email. Recipient delivery is not verified.' if accepted else 'Resend did not accept the email. No retry was made. Check account restrictions and the existing audit log; the saved PDF remains available.',[saved_artifact],None)

    def execute(self, action, *, incident, session, text, conversation, email_draft=None):
        if action=='send_registered':raise ActionFailure('Email sending requires a claimed, exact approval proposal.')
        reports,documents=self.services()
        iid=incident['incident_id']
        artifact=None
        def make(kind,title,body,**kw):
            return MuseArtifact(artifact_id=str(uuid4()),incident_id=iid,kind=kind,title=title[:200],
                body=body[:20000],truncated=len(body)>20000,**kw)
        def saved_report():
            if not re.search(r'\b(fresh|regenerate|new report)\b',text,re.I):
                for message in reversed(conversation.messages):
                    for old in reversed(message.metadata.artifacts):
                        if old.incident_id==iid and old.report_id:
                            value=reports.get_detailed_report_record(old.report_id)
                            if value and value.get('incident_id')==iid and reports.get_detailed_report_pdf_bytes(old.report_id):
                                return value,False
            items=reports.list_detailed_reports_for_incident(iid)
            if items and not re.search(r'\b(fresh|regenerate|new report)\b',text,re.I):
                value=reports.get_detailed_report_record(items[0]['report_id'])
                if value and value.get('incident_id')==iid and reports.get_detailed_report_pdf_bytes(value['report_id']):
                    return value,False
            generation_key=(session,iid)
            with _send_lock:
                if generation_key in _generating:
                    raise ActionFailure('A report is already being generated for this incident. Wait for that result; no duplicate generation was started.')
                if len(_generating)>=32:
                    raise ActionFailure('Report generation is busy. No additional generation was started.')
                _generating.add(generation_key)
            try:
                bundle=reports.build_evidence_bundle(iid,client_session_id=session)
                value=reports.synthesize_detailed_report(bundle)
                if value.get('incident_id')!=iid:raise ActionFailure('Report association validation failed.')
                pdf=reports.generate_detailed_report_pdf(value,bundle)
                if not pdf or not pdf.startswith(b'%PDF-'):raise ActionFailure('The PDF renderer did not return a usable PDF.')
                reports.save_detailed_report(iid,value,pdf)
                return value,True
            finally:
                with _send_lock:_generating.discard(generation_key)
        def report_body(value):
            sections=value.get('sections') or {}
            parts=[f"Incident: {iid}",f"Report: {value['report_id']}",
                   f"Provenance: {value.get('model_id','Not recorded')}; AI synthesis: {bool(value.get('ai_synthesized'))}"]
            for key,title in [('executive_summary','EXECUTIVE SUMMARY'),('methodology_scope','METHODOLOGY'),
                ('temporal_continuity','TEMPORAL INTERPRETATION'),('model_assessment','AI / ENGINE INTERPRETATION'),('risk_and_limitations','LIMITATIONS')]:
                parts.extend([title,str(sections.get(key) or 'Not recorded')])
            temporal=sections.get('temporal_evidence') or {}
            if temporal:
                off=temporal.get('global_offset') or {}
                parts.extend(['MEASURED TEMPORAL EVIDENCE',f"Eligible valid pairs: {off.get('valid_pair_count')}; missing timestamp pairs: {off.get('missing_timestamp_count')}; median offset: {off.get('median_offset_sec') if off.get('median_offset_sec') is not None else 'Not recorded'}; MAD: {off.get('mad_sec') if off.get('mad_sec') is not None else 'Not recorded'}. {off.get('dispersion_note','')}"])
            parts.extend(['SAM CONTEXT',str((sections.get('sam_context') or {}).get('limitation') or 'No current SAM snapshot available; this does not establish that SAM never ran.'),
                          'Evidence provenance and complete measured results are in the saved PDF. Unsampled footage cannot be evaluated. No legal conclusion is established.'])
            return '\n\n'.join(parts)
        if action=='edit_document':
            wanted='licensing' if re.search(r'licen|proposal',text,re.I) else 'copyright' if re.search(r'copyright|notice',text,re.I) else 'summary'
            for message in reversed(conversation.messages):
                for old in reversed(message.metadata.artifacts):
                    if old.incident_id==iid and old.kind==wanted:
                        return 'completed','The existing draft is ready to edit below. Edits are local until you export them.',[old.model_copy(deep=True)]
            raise ActionFailure('No matching draft is present in this conversation. Ask me to create it first.')
        if action in ('copyright','licensing'):
            function=documents.generate_copyright_notice_draft if action=='copyright' else documents.generate_rev_share_proposal_draft
            value=function(incident,{},use_ai_synthesis=False)
            artifact=make(action,value['subject'],value['body'],model_id=value['model_id'])
            return 'completed','Your evidence-based draft is ready to review and edit. Unknown parties and terms remain placeholders; nothing was sent.',[artifact]
        report,created=saved_report()
        rid=report['report_id']
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',rid):raise ActionFailure('The report identifier is invalid.')
        preview=report_body(report)
        if report.get('synthesis_failure_category'):
            preview += '\nSynthesis diagnostic category: ' + report['synthesis_failure_category']
        artifact=make('summary' if action=='summary' else 'report','Investigation report',preview,report_id=rid,model_id=report.get('model_id'))
        if action=='prepare_email':
            subject=f'FixProof investigation report — {iid[:8]}'
            body=f"Please review the attached investigation report.\n\nIncident: {iid}\nReport: {rid}\n\n{(report.get('sections') or {}).get('executive_summary') or 'See the attached measured evidence.'}\n\nSampled evidence requires human review; no legal conclusion is established."
            mail=make('email',subject,body,report_id=rid,status='DRAFT')
            return 'completed','Your editable email draft and saved PDF are ready. Nothing was sent.',[mail,artifact]
        return 'completed',('Your investigation report and actual PDF were generated.' if created else 'Your existing investigation report and saved PDF are ready.') + (' The report is explicitly labelled as deterministic; no live-model synthesis is claimed.' if not report.get('ai_synthesized') else ''),[artifact]
