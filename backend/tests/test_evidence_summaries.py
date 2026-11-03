"""Offline summary service, PDF, router and chat regression tests."""
import copy,json,unittest
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock,patch
from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
from app.evidence_summaries import EvidenceSummaries,facts_for,summary_pdf
from app.evidence_summary_api import router,get_summaries,incident_reader,demo_mode
from app.providers.meta_client import DEFAULT_VISION_MODEL,MetaAPIError
RECORD={'incident_id':'incident-one','session_id':'session-one'}
SAM={'observations':[{'candidate_id':'candidate-one','target':'suspect','timestamp_sec':2.5,'status':'VALIDATED','labels':['player','ball'],'model_id':'sam-3.1','discovery_model':DEFAULT_VISION_MODEL}]}
def completion(ids=None,model=DEFAULT_VISION_MODEL):
    return SimpleNamespace(model=model,choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'fact_ids':ids or ['f1','f2','f3']})))])
class SummaryTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.client=Mock();self.client.complete.return_value=completion()
        self.service=EvidenceSummaries(self.temp.name,self.client,model_check=lambda:None)
        guard=patch('socket.socket.connect',side_effect=AssertionError('No live requests'));guard.start();self.addCleanup(guard.stop)
        app=FastAPI();app.include_router(router)
        self.app=app
        app.dependency_overrides[demo_mode]=lambda:False
        app.dependency_overrides[get_summaries]=lambda:self.service
        app.dependency_overrides[incident_reader]=lambda:lambda iid:RECORD if iid=='incident-one' else None
        self.http=TestClient(app);self.headers={'X-Client-Session-ID':'session-one'};self.url='/api/incidents/incident-one/evidence-summaries/sam'
    def generate(self):return self.service.generate(RECORD,'session-one','sam',SAM)
    def test_failed_sam_frames_are_omitted_from_prompt_brief_and_pdf_facts(self):
        mixed=copy.deepcopy(SAM)
        for status in ('FAILED_VALIDATION','UNAVAILABLE','ERROR'):
            mixed['observations'].append({'candidate_id':'failed-frame-'+status,'status':status,'labels':['untrusted failed label']})
        result=self.service.generate(RECORD,'session-one','sam',mixed)
        prompt=self.client.complete.call_args.args[0]['messages'][1]['content']
        for text in (prompt,result['body'],json.dumps(result['facts'])):
            self.assertNotIn('failed-frame-',text);self.assertNotIn('untrusted failed label',text)
        self.assertIn('1 usable frame',result['body'])
        self.assertTrue(summary_pdf(result).startswith(b'%PDF-'))
    def test_all_failed_frames_skip_inference(self):
        with self.assertRaises(HTTPException) as raised:
            self.service.generate(RECORD,'session-one','sam',{'observations':[{'status':'FAILED_VALIDATION'}]})
        self.assertEqual(raised.exception.status_code,409);self.assertIn('No successful SAM',raised.exception.detail)
        self.client.complete.assert_not_called()
    def test_partial_frame_keeps_its_validated_labels(self):
        partial=copy.deepcopy(SAM);partial['observations'][0]['status']='PARTIAL'
        result=self.service.generate(RECORD,'session-one','sam',partial)
        self.assertIn('ball',result['body'])
    def test_partial_frame_without_valid_objects_is_not_evidence(self):
        with self.assertRaises(HTTPException):
            self.service.generate(RECORD,'session-one','sam',{'observations':[{'status':'PARTIAL','labels':[]}]})
        self.client.complete.assert_not_called()
    def test_negative_observation_is_retained_without_claiming_objects(self):
        negative=copy.deepcopy(SAM);negative['observations'][0].update(status='NO_OBJECTS_DETECTED',labels=[])
        result=self.service.generate(RECORD,'session-one','sam',negative)
        self.assertIn('NO_OBJECTS_DETECTED',result['body']);self.assertNotIn('ball',result['body'])
    def test_temporal_generation_time_does_not_invalidate_cache(self):
        evidence={'generated_at':'first retrieval','candidates':[{}],'by_source':{'asset-one':{'all_eligible':{'valid_pairs':1,'missing_timestamps':0}}}}
        first=self.service.generate(RECORD,'session-one','temporal',evidence)
        second=self.service.generate(RECORD,'session-one','temporal',{**evidence,'generated_at':'later retrieval'})
        self.assertEqual(first,second);self.client.complete.assert_called_once()
    def test_demo_viewer_can_generate_read_and_download_like_workspace(self):
        self.app.dependency_overrides[demo_mode]=lambda:True
        viewer={'X-Client-Session-ID':'existing-demo-viewer'}
        with patch('app.sam_workspace_api.read_cached_context',return_value=SAM):
            self.assertEqual(self.http.post(self.url,headers=viewer).status_code,200)
        self.assertEqual(self.http.get(self.url,headers=viewer).status_code,200)
        self.assertEqual(self.http.get(self.url+'/pdf',headers=viewer).status_code,200)
        self.assertEqual(self.http.get(self.url).status_code,400)
        self.app.dependency_overrides[demo_mode]=lambda:False
        self.assertEqual(self.http.get(self.url,headers=viewer).status_code,404)
    def test_showcase_record_uses_existing_workspace_access_convention(self):
        showcase={**RECORD,'session_id':'demo-showcase'}
        result=self.service.generate(showcase,'session-one','sam',SAM)
        self.assertEqual(self.service.read(showcase,'session-one','sam'),result)
    def test_spark_contract(self):
        result=self.generate();request=self.client.complete.call_args.args[0]
        self.assertEqual(request['model'],DEFAULT_VISION_MODEL);self.assertIn('response_format',request);self.assertIn('ball',result['body'])
    def test_no_duplicate_inference(self):
        self.generate();self.generate();self.assertEqual(self.client.complete.call_count,1)
    def test_restart_retrieval_no_inference(self):
        saved=self.generate();self.assertEqual(EvidenceSummaries(self.temp.name).read(RECORD,'session-one','sam'),saved)
    def test_changed_incident_invalidates(self):
        self.generate();self.assertIsNone(self.service.read({**RECORD,'status':'changed'},'session-one','sam'))
    def test_changed_evidence_regenerates(self):
        self.generate();other=copy.deepcopy(SAM);other['observations'][0]['labels']=['goal'];self.service.generate(RECORD,'session-one','sam',other);self.assertEqual(self.client.complete.call_count,2)
    def test_session_mismatch(self):
        with self.assertRaises(HTTPException):self.service.generate(RECORD,'other-session','sam',SAM)
        self.client.complete.assert_not_called()
    def test_missing_session(self):
        self.assertEqual(self.http.get(self.url).status_code,400)
    def test_empty_no_inference(self):
        with self.assertRaises(HTTPException):self.service.generate(RECORD,'session-one','sam',{})
        self.client.complete.assert_not_called()
    def test_unknown_fact_rejected(self):
        self.client.complete.return_value=completion(['invented'])
        with self.assertRaises(ValueError):self.generate()
        self.assertIsNone(self.service.read(RECORD,'session-one','sam'))
    def test_duplicate_fact_rejected(self):
        self.client.complete.return_value=completion(['f1','f1'])
        with self.assertRaises(ValueError):self.generate()
    def test_wrong_model_rejected(self):
        self.client.complete.return_value=completion(model='wrong-model')
        with self.assertRaises(ValueError):self.generate()
    def test_provider_error_not_retried(self):
        self.client.complete.side_effect=MetaAPIError('API_TIMEOUT')
        with self.assertRaises(MetaAPIError):self.generate()
        self.assertEqual(self.client.complete.call_count,1)
    def test_real_pdf(self):self.assertTrue(summary_pdf(self.generate()).startswith(b'%PDF-'))
    def test_temporal_missing_is_not_zero(self):
        facts=facts_for('temporal',{'candidates':[{}],'by_source':{'asset-one':{'all_eligible':{'valid_pairs':3,'missing_timestamps':1,'offset_stats':{'median_offset_sec':0,'mad_sec':None},'chronological_consistency':{'inversions_count':1,'lis_length':2,'sample_count':3}}}}})
        self.assertIn('0 seconds',facts[1]['text']);self.assertIn('None seconds',facts[1]['text']);self.assertIn('asset-one',facts[1]['text'])
    def test_empty_temporal(self):self.assertEqual(facts_for('temporal',{}),[])
    def test_get_missing_never_infers(self):
        self.assertEqual(self.http.get(self.url,headers=self.headers).status_code,404);self.client.complete.assert_not_called()
    def test_get_pdf_no_inference(self):
        self.generate();self.assertEqual(self.http.get(self.url,headers=self.headers).status_code,200)
        result=self.http.get(self.url+'/pdf',headers=self.headers);self.assertTrue(result.content.startswith(b'%PDF-'));self.assertEqual(self.client.complete.call_count,1)
    def test_other_session_cannot_download(self):
        self.generate();self.assertEqual(self.http.get(self.url+'/pdf',headers={'X-Client-Session-ID':'other-session'}).status_code,404)
    def test_pdf_rejects_replaced_summary(self):
        self.generate();self.assertEqual(self.http.get(self.url+'/pdf?summary_id='+('0'*64),headers=self.headers).status_code,409)
    def test_post_uses_cached_sam(self):
        with patch('app.sam_workspace_api.read_cached_context',return_value=SAM):self.assertEqual(self.http.post(self.url,headers=self.headers).status_code,200)
    def test_sanitized_failure(self):
        self.client.complete.side_effect=RuntimeError('SECRET-DO-NOT-EXPOSE')
        with patch('app.sam_workspace_api.read_cached_context',return_value=SAM):response=self.http.post(self.url,headers=self.headers)
        self.assertEqual(response.status_code,502);self.assertNotIn('SECRET',response.text)
    def test_unknown_kind_and_incident(self):
        self.assertEqual(self.http.get(self.url.replace('/sam','/bad'),headers=self.headers).status_code,422)
        self.assertEqual(self.http.get(self.url.replace('incident-one','unknown'),headers=self.headers).status_code,404)
class ChatTests(unittest.TestCase):
    def test_demo_chat_reads_saved_brief_using_workspace_policy_only(self):
        from app.muse_conversations import ConversationManager,CreateConversationRequest,MessageRequest
        from app.muse_orchestrator import MuseAssistant
        from app.muse_tools import ToolFailure
        manager=ConversationManager();conv=manager.create('demo-viewer',CreateConversationRequest(selected_incident_id='incident-one'))
        tools=Mock();tools._incident.side_effect=ToolFailure('ACCESS_DENIED');tools.store.get_incident.return_value=RECORD
        store=Mock();store.read.return_value={'summary_id':'a'*64,'body':'Recorded SAM evidence.','model_id':DEFAULT_VISION_MODEL}
        factory=Mock(side_effect=AssertionError('No inference'))
        with patch('app.evidence_summary_api.get_summaries',return_value=store),patch('app.security.is_demo_mode',return_value=True):
            result=MuseAssistant(manager,tools=tools,provider_factory=factory).respond(conv.conversation_id,'demo-viewer',MessageRequest(client_message_id='demo-summary-read',text='Give me the SAM summary',expected_revision=0))
        self.assertEqual(result.status,'completed');store.read.assert_called_once_with(RECORD,'demo-viewer','sam',allow_demo=True)
        factory.assert_not_called();self.assertIsNone(result.pending_action)

    def test_foreign_incident_hint_cannot_read_saved_brief(self):
        from app.muse_conversations import ConversationManager,CreateConversationRequest,MessageRequest
        from app.muse_orchestrator import MuseAssistant
        from app.muse_tools import ToolFailure
        manager=ConversationManager();conv=manager.create('session-one',CreateConversationRequest(selected_incident_id='foreign-incident'))
        tools=Mock();tools._incident.side_effect=ToolFailure('ACCESS_DENIED')
        store=Mock()
        with patch('app.evidence_summary_api.get_summaries',return_value=store):
            result=MuseAssistant(manager,tools=tools).respond(conv.conversation_id,'session-one',MessageRequest(client_message_id='test-message',text='Give me the SAM investigation',expected_revision=0))
        self.assertEqual(result.status,'needs_clarification');store.read.assert_not_called()

    def test_saved_summary_without_planner_or_report_action(self):
        from app.muse_conversations import ConversationManager,CreateConversationRequest,MessageRequest
        from app.muse_orchestrator import MuseAssistant
        manager=ConversationManager();conv=manager.create('session-one',CreateConversationRequest(selected_incident_id='incident-one'))
        tools=Mock();tools._incident.return_value=RECORD;factory=Mock(side_effect=AssertionError('No inference'))
        store=Mock();store.read.return_value={'summary_id':'a'*64,'body':'Recorded SAM evidence.','model_id':DEFAULT_VISION_MODEL}
        with patch('app.evidence_summary_api.get_summaries',return_value=store):response=MuseAssistant(manager,tools=tools,provider_factory=factory).respond(conv.conversation_id,'session-one',MessageRequest(client_message_id='test-message',text='Give me the SAM investigation summary',expected_revision=0))
        self.assertEqual(response.status,'completed');self.assertEqual(response.artifacts[0].summary_kind,'sam');self.assertIsNone(response.pending_action);factory.assert_not_called()
    def test_missing_summary_honest(self):
        from app.muse_conversations import ConversationManager,CreateConversationRequest,MessageRequest
        from app.muse_orchestrator import MuseAssistant
        manager=ConversationManager();conv=manager.create('session-one',CreateConversationRequest())
        response=MuseAssistant(manager,tools=Mock(),provider_factory=Mock(side_effect=AssertionError('No inference'))).respond(conv.conversation_id,'session-one',MessageRequest(client_message_id='test-message',text='Show temporal evidence',expected_revision=0))
        self.assertEqual(response.status,'needs_clarification');self.assertEqual(response.artifacts,[])
