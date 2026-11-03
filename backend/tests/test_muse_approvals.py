"""Offline approval/intent API tests. No app startup, real inference or email."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.muse_conversations import ActionDecision, ConversationError
from app.muse_conversation_api import router, get_muse_assistant, get_conversation_manager
from tests import test_muse_actions as fixtures


class ApprovalTests(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.ActionsTest();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.f.reports.list_detailed_reports_for_incident.return_value=[{'report_id':'report-a'}]
        self.planner=Mock(return_value=self.plan())
        self.f.factory.return_value.create_text_completion=self.planner
    def plan(self,intent='send_registered',confidence=.96,incident='incident-a'):
        return SimpleNamespace(model='muse-test',choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content=json.dumps({'action':'propose_action','intent':intent,'confidence':confidence,'incident_id':incident})))])
    def propose(self,text='I need a copy of this investigation in my inbox.'):
        return self.f.send(text,approve=False)
    def decide(self,reply,cancel=False,incident='incident-a'):
        return self.f.assistant.decide_action(reply.conversation_id,'session-a',reply.pending_action.action_id,
            ActionDecision(expected_revision=reply.revision,selected_incident_id=incident),cancel=cancel)
    def test_equivalent_phrasings_use_one_validated_plan_and_never_send(self):
        for text in ['Can you send me the report?','I need a copy of this investigation in my inbox.',
                     'Email me the findings.','Could you share the PDF with me?',
                     'I want this report sent to my student email.','Generate a report and send it over.',
                     'Can you look at this investigation, prepare the report, and email me a copy?']:
            before=self.planner.call_count
            result=self.propose(text)
            self.assertEqual(result.status,'awaiting_confirmation',text)
            self.assertEqual(result.pending_action.action,'send_registered')
            self.assertEqual(self.planner.call_count-before,1)
        self.f.reports.send_detailed_report_email.assert_not_called()
        self.f.reports.synthesize_detailed_report.assert_not_called()
    def test_exact_approval_sends_once_and_cancel_never_sends(self):
        result=self.propose()
        card=result.pending_action
        self.assertEqual(card.recipient_email,'student@example.test')
        self.assertEqual(card.report_id,'report-a')
        accepted=self.decide(result)
        self.assertEqual(accepted.status,'completed')
        call=self.f.reports.send_detailed_report_email.call_args
        self.assertEqual(call.args[2],card.recipient_email)
        self.assertEqual(call.kwargs['subject_override'],card.subject)
        self.assertEqual(call.kwargs['body_override'],card.body_preview)
        with self.assertRaises(ConversationError):self.decide(result)
        self.f.reports.send_detailed_report_email.assert_called_once()
        self.f.reports.send_detailed_report_email.reset_mock()
        cancelled=self.decide(self.propose(),cancel=True)
        self.assertIn('cancelled',cancelled.text)
        self.f.reports.send_detailed_report_email.assert_not_called()
    def test_stale_context_pdf_and_recipient_fail_closed(self):
        pending=self.propose()
        with self.assertRaises(ConversationError):self.decide(pending,incident='other-incident')
        self.f.reports.get_detailed_report_pdf_bytes.return_value=b'%PDF-changed'
        self.assertEqual(self.decide(pending).status,'failed')
        self.f.reports.send_detailed_report_email.assert_not_called()
        pending=self.propose()
        with patch.dict('os.environ',{'MUSE_REGISTERED_EMAIL':'changed@example.test'}):
            self.assertEqual(self.decide(pending).status,'failed')
        self.f.reports.send_detailed_report_email.assert_not_called()
    def test_missing_pdf_requires_generation_approval_then_separate_send(self):
        self.f.reports.list_detailed_reports_for_incident.return_value=[]
        pending=self.propose()
        self.assertEqual(pending.pending_action.action,'generate_for_email')
        self.f.reports.synthesize_detailed_report.assert_not_called()
        ready=self.decide(pending)
        self.assertEqual(ready.pending_action.action,'send_registered')
        self.f.reports.synthesize_detailed_report.assert_called_once()
        self.f.reports.send_detailed_report_email.assert_not_called()
        self.decide(ready)
        self.f.reports.send_detailed_report_email.assert_called_once()
    def test_ambiguous_email_low_confidence_and_invalid_context_clarify(self):
        result=self.propose('email')
        self.assertEqual(result.status,'needs_clarification');self.planner.assert_not_called()
        for confidence,incident in [(.4,'incident-a'),(.99,'not-authorized')]:
            self.planner.return_value=self.plan(confidence=confidence,incident=incident)
            result=self.propose()
            self.assertEqual(result.status,'needs_clarification')
        self.f.reports.send_detailed_report_email.assert_not_called()
    def test_draft_only_model_intent_cannot_send(self):
        self.planner.return_value=self.plan(intent='prepare_email')
        draft=self.decide(self.propose("Please prepare an email but don't send it."))
        self.assertEqual(draft.artifacts[0].kind,'email')
        self.f.reports.send_detailed_report_email.assert_not_called()
    def test_expiry_new_turn_and_session_mismatch_reject(self):
        pending=self.propose();now=self.f.manager._clock()
        with patch.object(self.f.manager,'_clock',return_value=now+601):
            with self.assertRaises(ConversationError) as error:self.decide(pending)
            self.assertEqual(error.exception.status_code,410)
        pending=self.propose();self.propose('Generate a report.')
        with self.assertRaises(ConversationError):self.decide(pending)
        self.f.reports.send_detailed_report_email.assert_not_called()
    def test_actual_router_rejects_tampering_and_missing_session(self):
        app=FastAPI();app.include_router(router)
        app.dependency_overrides[get_muse_assistant]=lambda:self.f.assistant
        app.dependency_overrides[get_conversation_manager]=lambda:self.f.manager
        pending=self.propose();card=pending.pending_action
        path=f'/api/muse/conversations/{pending.conversation_id}/actions/{card.action_id}/approve'
        client=TestClient(app)
        value={'expected_revision':pending.revision,'selected_incident_id':'incident-a'}
        self.assertEqual(client.post(path,json=value).status_code,400)
        self.assertEqual(client.post(path,json={**value,'recipient_email':'third@example.test'},headers={'X-Client-Session-Id':'session-a'}).status_code,422)
        self.assertEqual(client.post(path,json=value,headers={'X-Client-Session-Id':'wrong-session'}).status_code,403)
        self.f.reports.send_detailed_report_email.assert_not_called()
