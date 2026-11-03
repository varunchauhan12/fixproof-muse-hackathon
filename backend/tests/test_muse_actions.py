"""Offline action execution, artifact and fixed-recipient safety regression tests."""
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4
from app.muse_actions import MuseActions, ActionFailure, action_for_text, _sends
from app.muse_conversations import ConversationManager, CreateConversationRequest, MessageRequest, ActionDecision
from app.muse_orchestrator import MuseAssistant
from app.muse_tools import MuseToolRegistry
from tests.test_muse_tools import Store


class ActionsTest(unittest.TestCase):
    def setUp(self):
        _sends.clear()
        self.reports=Mock()
        self.documents=Mock()
        self.reports.list_detailed_reports_for_incident.return_value=[]
        self.value={'incident_id':'incident-a','report_id':'report-a','model_id':'offline-engine',
                    'ai_synthesized':False,'sections':{'executive_summary':'Recorded sample evidence','risk_and_limitations':'Human review required'}}
        self.reports.synthesize_detailed_report.return_value=self.value
        self.reports.generate_detailed_report_pdf.return_value=b'%PDF-offline'
        self.reports.get_detailed_report_pdf_bytes.return_value=b'%PDF-offline'
        self.reports.get_detailed_report_record.return_value=self.value
        self.documents.get_email_config.return_value=(True,'offline-only','sender@example.test')
        self.reports.send_detailed_report_email.return_value={'success':True,'status':'ACCEPTED'}
        self.documents.generate_rev_share_proposal_draft.return_value={'subject':'Licensing proposal','body':'[To be proposed]','model_id':'deterministic-template-v1.0'}
        self.documents.generate_copyright_notice_draft.return_value={'subject':'Draft notice','body':'[Rights holder required]','model_id':'deterministic-template-v1.0'}
        self.actions=MuseActions(lambda:(self.reports,self.documents))
        self.manager=ConversationManager()
        self.conversation=self.manager.create('session-a',CreateConversationRequest(selected_incident_id='incident-a'))
        from types import SimpleNamespace
        import json
        def classify(payload):
            context=json.loads(payload['messages'][-1]['content'].split('\n',1)[1])
            intent=action_for_text(context['current_user_message']) or 'prepare_email'
            return SimpleNamespace(model='muse-test',choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content=json.dumps({'action':'propose_action','intent':intent,'confidence':.95,'incident_id':'incident-a'})))])
        provider=SimpleNamespace(provider_name='muse',model_id='muse-test',create_text_completion=classify)
        self.factory=Mock(return_value=provider)
        self.reports.save_detailed_report.side_effect=lambda *args: setattr(self.reports.list_detailed_reports_for_incident,'return_value',[{'report_id':'report-a'}])
        self.assistant=MuseAssistant(self.manager,tools=MuseToolRegistry(Store()),actions=self.actions,provider_factory=self.factory)
        self.env=patch.dict('os.environ',{'MUSE_REGISTERED_EMAIL':'student@example.test'})
        self.env.start();self.addCleanup(self.env.stop)

    def send(self,text,approve=True,**kwargs):
        current=self.manager.get(self.conversation.conversation_id,'session-a')
        reply=self.assistant.respond(current.conversation_id,'session-a',MessageRequest(client_message_id=str(uuid4()),text=text,expected_revision=current.revision,**kwargs))
        for _ in range(3):
            if not approve or not reply.pending_action:break
            reply=self.assistant.decide_action(current.conversation_id,'session-a',reply.pending_action.action_id,
                ActionDecision(expected_revision=reply.revision,selected_incident_id='incident-a'))
        return reply

    def test_all_requested_intents_and_negative_instruction(self):
        examples={'Generate a report for this investigation.':'report','Create a detailed PDF report.':'report',
            'Download the report for this incident.':'report','Create a copyright notice for this footage.':'copyright',
            'Prepare a revenue-sharing proposal for this footage.':'licensing','Summarize this investigation in a professional document.':'summary',
            'Prepare an email but do not send it.':'prepare_email','Email me the PDF.':'send_registered',
            'Edit the licensing proposal.':'edit_document','Explain how to send an email.':None,'Do not generate a report.':None}
        for text,expected in examples.items():self.assertEqual(action_for_text(text),expected,text)

    def test_actual_orchestration_returns_pdf_artifact_and_reuses_saved_report(self):
        reply=self.send('Generate a PDF report for this investigation.')
        self.assertEqual(reply.status,'completed')
        self.assertEqual(reply.artifacts[0].report_id,'report-a')
        self.assertIn('deterministic',reply.text)
        self.reports.generate_detailed_report_pdf.assert_called_once()
        reply=self.send('Download the report for this incident.')
        self.assertEqual(reply.artifacts[0].report_id,'report-a')
        self.reports.generate_detailed_report_pdf.assert_called_once()
        self.assertTrue(self.manager.get(reply.conversation_id,'session-a').messages[-1].metadata.artifacts)
        self.factory.assert_not_called()

    def test_fresh_report_explicitly_regenerates(self):
        self.send('Generate a report.')
        self.send('Generate a fresh report.')
        self.assertEqual(self.reports.generate_detailed_report_pdf.call_count,2)

    def test_templates_and_edit_reuse_original_artifact(self):
        first=self.send('Create a licensing proposal.')
        second=self.send('Edit the licensing proposal.')
        self.assertEqual(first.artifacts[0].artifact_id,second.artifacts[0].artifact_id)
        self.documents.generate_rev_share_proposal_draft.assert_called_once()
        self.send('Create a copyright notice.')
        self.documents.generate_copyright_notice_draft.assert_called_once()
        self.documents.generate_copyright_notice_draft.assert_called_with(unittest.mock.ANY,{},use_ai_synthesis=False)

    def test_prepare_never_sends_and_registered_send_has_exact_attachment(self):
        prepared=self.send("Prepare an email but don't send it.")
        self.reports.send_detailed_report_email.assert_not_called()
        self.assertEqual(prepared.artifacts[0].kind,'email')
        reply=self.send('Send the PDF report to my email.',email_draft={'report_id':'report-a','subject':'Reviewed title','body':'Edited cover note'})
        self.assertEqual(reply.status,'completed')
        args=self.reports.send_detailed_report_email.call_args
        self.assertEqual(args.args[2],'student@example.test')
        self.assertEqual(args.args[3],b'%PDF-offline')
        self.assertEqual(args.kwargs['body_override'],'Edited cover note')
        self.assertNotIn('student@example.test',reply.model_dump_json())
        self.assertIn('not verified',reply.text)
        self.send('Email me the PDF.')
        self.reports.send_detailed_report_email.assert_called_once()

    def test_arbitrary_recipient_and_unrelated_document_rejected(self):
        for text in ('Send the PDF to third@example.test.','Send this to an arbitrary third-party address.','Send this copyright notice to my email.'):
            self.assertEqual(self.send(text).status,'failed')
        self.reports.send_detailed_report_email.assert_not_called()
        self.reports.generate_detailed_report_pdf.assert_not_called()

    def test_missing_registered_email_blocks_before_generation(self):
        with patch.dict('os.environ',{'MUSE_REGISTERED_EMAIL':''}):
            reply=self.send('Send the PDF report to my email.')
        self.assertEqual(reply.status,'failed')
        self.assertIn('MUSE_REGISTERED_EMAIL',reply.text)
        self.reports.generate_detailed_report_pdf.assert_not_called()

    def test_failed_send_preserves_pdf_and_is_not_retried(self):
        self.reports.send_detailed_report_email.return_value={'success':False,'status':'FAILED'}
        reply=self.send('Send the PDF report to my email.')
        self.assertEqual(reply.status,'failed')
        self.assertEqual(reply.artifacts[-1].report_id,'report-a')
        self.send('Send the PDF report to my email.')
        self.reports.send_detailed_report_email.assert_called_once()

    def test_ownership_and_pdf_failure_never_claim_success(self):
        self.conversation=self.manager.create('session-a',CreateConversationRequest(selected_incident_id='not-owned'))
        self.assertEqual(self.send('Generate a PDF.').status,'failed')
        self.reports.generate_detailed_report_pdf.assert_not_called()
        self.conversation=self.manager.create('session-a',CreateConversationRequest(selected_incident_id='incident-a'))
        self.reports.generate_detailed_report_pdf.return_value=b'invalid'
        reply=self.send('Generate a PDF.')
        self.assertEqual(reply.status,'failed')
        self.assertFalse(reply.artifacts)
        self.reports.save_detailed_report.assert_not_called()

    def test_concurrent_generation_does_not_start_duplicate(self):
        from app.muse_actions import _generating
        _generating.add(('session-a','incident-a'))
        try:
            result=self.send('Generate a fresh PDF report.')
            self.assertEqual(result.status,'failed')
            self.assertIn('already being generated',result.text)
            self.reports.synthesize_detailed_report.assert_not_called()
        finally:_generating.clear()

    def test_unknown_send_outcome_is_not_retried(self):
        self.reports.send_detailed_report_email.side_effect=TimeoutError('Do not expose private provider details')
        result=self.send('Send the report to my email.')
        self.assertEqual(result.status,'failed')
        self.assertNotIn('private provider',result.text)
        self.assertTrue(result.artifacts)
        self.send('Send the report to my email.')
        self.reports.send_detailed_report_email.assert_called_once()


class SAMContextTest(unittest.TestCase):
    def test_snapshot_read_never_infers_and_expires_without_claiming_never_ran(self):
        from copy import deepcopy
        from app.sam_workspace import SAMWorkspace, candidate_queue
        from tests.test_sam_workspace import fixture
        record=fixture();time=[0]
        io=Mock(side_effect=AssertionError('No provider or frame I/O allowed'))
        workspace=SAMWorkspace(io,io,io,lambda:.75,clock=lambda:time[0])
        self.addCleanup(lambda:workspace.concept_pool.shutdown(wait=True,cancel_futures=True))
        pair=candidate_queue(record,.75)[0][0]
        observation={'association':{**pair['reference'],'incident_id':record['incident_id'],
            'candidate_id':pair['candidate_id'],'frame_match_index':pair['frame_match_index'],
            'target':'reference','evidence_id':pair['evidence_id']},'status':'VALIDATED',
            'objects':[{'label':'football'}],'model_id':'sam-3.1'}
        workspace.auto_cache[('session-1',pair['candidate_id'])]=(0,{'candidate':pair,'targets':{'reference':observation}})
        result=workspace.read_cached_context(record,'session-1')
        self.assertEqual(result['availability'],'CACHED_SNAPSHOT')
        self.assertEqual(result['observations'][0]['labels'],['football'])
        self.assertFalse(workspace.read_cached_context(record,'wrong-session')['observations'])
        time[0]=1801
        self.assertFalse(workspace.read_cached_context(record,'session-1')['observations'])
        self.assertEqual(len(workspace.auto_cache),1) # Read does not prune/write.
        io.assert_not_called()
