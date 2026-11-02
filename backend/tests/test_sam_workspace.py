"""Offline service/router tests: no main, vault, database or live provider."""
import io
import threading
import unittest
from copy import deepcopy
from unittest.mock import Mock, patch
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from app.sam_workspace import SAMWorkspace, candidate_queue, normalized_box
from app.sam_workspace_api import router, get_workspace
from app.providers.sam_models import SegmentationResult


def image_bytes(color='white'):
    data=io.BytesIO();Image.new('RGB',(64,32),color).save(data,format='JPEG');return data.getvalue()


def fixture():
    best={'source_asset_id':'ref-asset','source_frame_id':4,'source_filename':'ref.jpg','source_timestamp_sec':3.25,'l2_distance':.2,'match_confirmed':True}
    alt={**best,'source_frame_id':5,'source_filename':'alt.jpg','source_timestamp_sec':4.25,'l2_distance':.4,'match_confirmed':True}
    return {'incident_id':'incident-1','session_id':'session-1','submitted_asset_id':'suspect-asset','frame_matches':[{'evidence_id':'evidence-1','submitted_frame':{'frame_index':17,'filename':'suspect.jpg','timestamp_sec':8.5},'best_match':best,'top_candidates':[best,alt]}]}


class WorkspaceTest(unittest.TestCase):
    def setUp(self):
        self.incident=fixture();self.clock=[0];self.frame_data=image_bytes();self.calls=[]
        def segment(data,prompt,metadata):
            self.calls.append((data,prompt,metadata))
            return SegmentationResult(prompt=prompt,model_id='sam-3.1',objects=[{'object_id':0,'label':prompt,'box':{'x1':8,'y1':4,'x2':32,'y2':16,'w':64,'h':32},'tracking_id':0,'mask':{'width':24,'height':12,'raw_payload':'retained-mask','encoding':'lossless_base85'}}],operational_metadata={'prepared_dimensions':{'width':64,'height':32}})
        self.provider=Mock(model_id='sam-3.1',provider_name='muse',segment_frame=Mock(side_effect=segment))
        self.loader=Mock(side_effect=lambda *a,**kw:(self.frame_data,None))
        self.workspace=SAMWorkspace(lambda _:deepcopy(self.incident),self.loader,lambda:self.provider,lambda:.75,clock=lambda:self.clock[0])
        self.id=self.workspace.queue('incident-1','session-1')[0]['candidate_id']
    def tearDown(self):
        self.workspace.concept_pool.shutdown(wait=True,cancel_futures=True)
    def run_pair(self,candidate=None,prompt='explicit object'):
        return self.workspace.inspect('incident-1',candidate or self.id,'session-1',prompt,run=True)
    def test_queue_and_frame_identity(self):
        q=self.workspace.queue('incident-1','session-1');self.assertEqual(len(q),2);self.assertEqual(q[0]['frame_match_index'],0);self.assertEqual(q[0]['suspect']['frame_id'],17);self.assertEqual(q[1]['rank'],2);self.assertNotEqual(q[0]['candidate_id'],q[1]['candidate_id'])
    def test_gate(self):
        for change in ({'l2_distance':.75},{'l2_distance':float('nan')},{'low_entropy_flag':True},{'source_timestamp_sec':None},{'match_confirmed':False},{'similarity_status':'NO_MATCH'}):
            inc=fixture()
            for c in [inc['frame_matches'][0]['best_match'],*inc['frame_matches'][0]['top_candidates']]:c.update(change)
            self.assertEqual(candidate_queue(inc,.75),[])
    def test_empty_queue(self):
        self.incident['frame_matches']=[];self.assertEqual(self.workspace.queue('incident-1','session-1'),[])
    def test_sessions(self):
        for session,code in [(None,400),('bad!',400),('other-session',403)]:
            with self.assertRaises(HTTPException) as context:self.workspace.queue('incident-1',session)
            self.assertEqual(context.exception.status_code,code)
    def test_demo_convention(self):
        self.workspace.demo_mode=lambda:True;self.assertEqual(len(self.workspace.queue('incident-1','other-session')),2)
        with self.assertRaises(HTTPException):self.workspace.queue('incident-1',None)
    def test_unknown_candidate(self):
        with self.assertRaises(HTTPException):self.run_pair('invented')
        self.assertEqual(self.calls,[])
    def test_targets_provenance_no_tracking(self):
        result=self.run_pair();self.assertEqual(len(self.calls),2)
        for target in ('reference','suspect'):
            obs=result['targets'][target];self.assertEqual(obs['association']['target'],target);self.assertEqual(obs['association']['candidate_id'],self.id);self.assertEqual(obs['original_dimensions'],{'width':64,'height':32});self.assertNotIn('tracking_id',obs['objects'][0]);self.assertEqual(obs['objects'][0]['mask']['raw_payload'],'retained-mask');self.assertEqual(obs['mask_decoding'],'UNAVAILABLE_RAW_PRESERVED')
        self.assertEqual(result['targets']['reference']['association']['timestamp_sec'],3.25)
        self.assertEqual(result['targets']['suspect']['association']['frame_id'],17)
    def test_alternative_does_not_inherit_best(self):
        self.incident['frame_matches'][0]['sam_segmentation']={'validation_status':'VALIDATED','objects':[{'label':'wrong'}]}
        alt=self.workspace.queue('incident-1','session-1')[1];result=self.run_pair(alt['candidate_id'])
        self.assertEqual(self.loader.call_args_list[0].kwargs['filename'],'alt.jpg');self.assertEqual(result['targets']['reference']['association']['frame_id'],5);self.assertEqual(len(self.calls),2)
    def test_cache_and_no_get_inference(self):
        self.workspace.inspect('incident-1',self.id,'session-1','explicit object');self.assertEqual(self.calls,[])
        self.run_pair();cached=self.run_pair();self.assertEqual(len(self.calls),2);self.assertTrue(cached['targets']['reference']['reused'])
    def test_cache_invalidation(self):
        self.run_pair();self.run_pair(prompt='another');self.assertEqual(len(self.calls),4)
        self.frame_data=image_bytes('black');self.run_pair();self.assertEqual(len(self.calls),6)
        self.provider.model_id='another-sam';self.run_pair();self.assertEqual(len(self.calls),8)
        self.clock[0]=1801;self.run_pair();self.assertEqual(len(self.calls),10)
    def test_explicit_retry_preserves_success(self):
        original=self.provider.segment_frame.side_effect;count=[0]
        def fail(*args,**kwargs):
            count[0]+=1
            if count[0]==2:raise RuntimeError('secret must not escape')
            return original(*args,**kwargs)
        self.provider.segment_frame.side_effect=fail
        result=self.run_pair();self.assertEqual(result['targets']['suspect']['status'],'FAILED_VALIDATION');self.assertNotIn('secret',str(result));self.run_pair();self.assertEqual(count[0],3)
    def test_missing_frame_no_inference(self):
        self.loader.side_effect=None;self.loader.return_value=(None,'private path');result=self.run_pair();self.assertEqual(self.calls,[]);self.assertEqual(result['targets']['reference']['status'],'UNAVAILABLE');self.assertNotIn('private path',str(result))
    def test_inflight_guard(self):
        entered=threading.Event();release=threading.Event();original=self.provider.segment_frame.side_effect
        def block(*a,**kw):entered.set();release.wait(3);return original(*a,**kw)
        self.provider.segment_frame.side_effect=block;thread=threading.Thread(target=self.run_pair);thread.start();self.assertTrue(entered.wait(2))
        try:
            with self.assertRaises(HTTPException) as context:self.run_pair()
            self.assertEqual(context.exception.status_code,409)
        finally:release.set();thread.join(3)
    def test_coordinates(self):
        valid={'x1':8,'y1':4,'x2':32,'y2':16,'w':64,'h':32};self.assertEqual(normalized_box(valid),[.125,.125,.5,.5])
        for change in ({'x1':float('nan')},{'x1':-1},{'x2':65},{'x2':1},{'w':0},{'normalized_coords':[0,0,1,1]}):self.assertIsNone(normalized_box({**valid,**change}))
    def test_failed_outcome_is_inspectable_without_inference(self):
        self.provider.segment_frame.side_effect=RuntimeError('sensitive detail')
        self.run_pair()
        inspected=self.workspace.inspect('incident-1',self.id,'session-1','explicit object')
        self.assertEqual(inspected['targets']['reference']['status'],'FAILED_VALIDATION')
        self.assertNotIn('sensitive detail',str(inspected))
        self.assertEqual(self.provider.segment_frame.call_count,2)
    def test_reject_wrong_coordinate_canvas_and_model(self):
        original=self.provider.segment_frame.side_effect
        def wrong(*a,**kw):
            result=original(*a,**kw)
            result.operational_metadata['prepared_dimensions']={'width':128,'height':64}
            return result
        self.provider.segment_frame.side_effect=wrong
        self.assertEqual(self.run_pair()['targets']['reference']['status'],'FAILED_VALIDATION')
    def test_cache_bound(self):
        self.workspace.limit=2
        self.run_pair();self.run_pair(prompt='different')
        self.assertLessEqual(len(self.workspace.cache),2)
    def test_provider_records_actual_prepared_dimensions(self):
        from app.providers.sam import MetaSAMProvider
        data=io.BytesIO();Image.new('RGB',(2560,1440),'blue').save(data,format='JPEG')
        with patch('app.providers.sam.MuseClient') as client:
            client.return_value.post_responses.return_value={'output_text':'<0f>0<|box;x1=0;y1=0;x2=512;y2=288;w=1024;h=576|>'}
            result=MetaSAMProvider().segment_frame(data.getvalue(),'explicit object')
        self.assertEqual(result.operational_metadata['original_dimensions'],{'width':2560,'height':1440})
        self.assertEqual(result.operational_metadata['prepared_dimensions'],{'width':1024,'height':576})
    def test_automatic_labels_are_discovered_and_localized_per_target(self):
        discovery=Mock(model_id='muse-spark-test',return_value={'reference':['person','ball'],'suspect':['person']})
        result=self.workspace.automatic('incident-1',self.id,'session-1',discovery)
        self.assertEqual(discovery.call_count,1)
        self.assertCountEqual([call[1] for call in self.calls],['person','ball','person'])
        self.assertEqual([obj['label'] for obj in result['targets']['reference']['objects']],['person','ball'])
        self.assertEqual([obj['label'] for obj in result['targets']['suspect']['objects']],['person'])
        self.assertEqual(result['targets']['suspect']['discovery_model'],'muse-spark-test')
        self.workspace.automatic('incident-1',self.id,'session-1',discovery)
        self.assertEqual(discovery.call_count,1);self.assertEqual(len(self.calls),3)
    def test_automatic_empty_discovery_never_invents_objects(self):
        discovery=Mock(model_id='muse-spark-test',return_value={'reference':[],'suspect':[]})
        result=self.workspace.automatic('incident-1',self.id,'session-1',discovery)
        self.assertEqual(self.calls,[]);self.assertEqual(result['targets']['reference']['status'],'NO_OBJECT_CONCEPTS')
    def test_automatic_discovery_failure_requires_explicit_retry(self):
        discovery=Mock(model_id='muse-spark-test',side_effect=ValueError('private response'))
        for retry in (False,False,True):
            with self.assertRaises(HTTPException) as context:self.workspace.automatic('incident-1',self.id,'session-1',discovery,retry)
            self.assertNotIn('private response',str(context.exception.detail))
        self.assertEqual(discovery.call_count,2);self.assertEqual(self.calls,[])
    def test_automatic_bounded_concepts(self):
        discovery=Mock(model_id='muse-spark-test',return_value={'reference':['one']*5,'suspect':[]})
        with self.assertRaises(HTTPException):self.workspace.automatic('incident-1',self.id,'session-1',discovery)
        self.assertEqual(self.calls,[])
    def test_automatic_unknown_candidate_cannot_infer(self):
        discovery=Mock(model_id='muse-spark-test')
        with self.assertRaises(HTTPException):self.workspace.automatic('incident-1','unknown','session-1',discovery)
        discovery.assert_not_called()
    def test_exact_shared_frame_reused_across_confirmed_candidates(self):
        discovery=Mock(model_id='muse-spark-test',return_value={'reference':['person'],'suspect':['person']})
        first,second=self.workspace.queue('incident-1','session-1')
        a=self.workspace.automatic('incident-1',first['candidate_id'],'session-1',discovery)
        b=self.workspace.automatic('incident-1',second['candidate_id'],'session-1',discovery)
        self.assertEqual(len(self.calls),3) # two distinct references and one shared suspect
        self.assertEqual(b['targets']['suspect']['association']['candidate_id'],second['candidate_id'])
        self.assertNotEqual(a['targets']['reference']['association']['frame_id'],b['targets']['reference']['association']['frame_id'])
    def test_localizations_run_in_parallel_with_global_four_call_bound(self):
        entered=threading.Event();release=threading.Event();guard=threading.Lock();counts={'active':0,'peak':0};result=[]
        original=self.provider.segment_frame.side_effect
        def blocked(*args,**kwargs):
            with guard:
                counts['active']+=1;counts['peak']=max(counts['peak'],counts['active'])
                if counts['active']==4:entered.set()
            release.wait(3)
            try:return original(*args,**kwargs)
            finally:
                with guard:counts['active']-=1
        self.provider.segment_frame.side_effect=blocked
        discovery=Mock(model_id='muse-spark-test',return_value={'reference':['one','two','three','four'],'suspect':['one','two','three','four']})
        thread=threading.Thread(target=lambda:result.append(self.workspace.automatic('incident-1',self.id,'session-1',discovery)))
        thread.start()
        try:self.assertTrue(entered.wait(2));self.assertEqual(counts['peak'],4)
        finally:release.set();thread.join(4)
        self.assertEqual(len(self.calls),8);self.assertEqual(len(result),1)
    def test_api(self):
        app=FastAPI();app.include_router(router);app.dependency_overrides[get_workspace]=lambda:self.workspace
        with TestClient(app) as client:
            base='/api/sam/incidents/incident-1/candidates';headers={'X-Client-Session-ID':'session-1'}
            self.assertEqual(client.get(base).status_code,400);self.assertEqual(client.get(base,headers=headers).status_code,200)
            self.assertEqual(client.post(f'{base}/{self.id}',headers=headers,json={'prompt':' '}).status_code,422)
            self.assertEqual(client.post(f'{base}/{self.id}',headers=headers,json={'prompt':'concept','extra':1}).status_code,422)
            self.assertEqual(client.get(f'{base}/{self.id}?prompt=concept',headers=headers).status_code,200);self.assertEqual(self.calls,[])
            self.assertEqual(client.get(f'{base}/{self.id}/frames/reference',headers=headers).content,self.frame_data)
            self.assertEqual(client.post(f'{base}/{self.id}',headers=headers,json={'prompt':'concept'}).status_code,200);self.assertEqual(len(self.calls),2)

if __name__=='__main__':unittest.main()
