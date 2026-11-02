"""Offline concept-discovery contracts; no configured credentials or live requests."""
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch,PropertyMock
from PIL import Image
from app.sam_scene import MuseSceneDiscovery


class SceneDiscoveryTest(unittest.TestCase):
    def image(self):
        buffer=io.BytesIO();Image.new('RGB',(32,16),'blue').save(buffer,format='JPEG');return buffer.getvalue()
    def test_image_request_and_actual_labels(self):
        with patch.object(MuseSceneDiscovery,'model_id',new_callable=PropertyMock,return_value='muse-test'),patch('app.sam_scene.MuseClient') as client:
            client.return_value.complete.return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'reference':['person','person','tree'],'suspect':['ball']})))])
            labels=MuseSceneDiscovery()(self.image(),self.image())
            request=client.return_value.complete.call_args.args[0]
        self.assertEqual(labels,{'reference':['person','tree'],'suspect':['ball']})
        self.assertEqual(request['model'],'muse-test')
        self.assertEqual([part['type'] for part in request['messages'][0]['content']],['text','image_url','image_url'])
    def test_invalid_response_not_substituted_with_default_objects(self):
        for response in ('not json',json.dumps({'reference':['x']*5,'suspect':[]}),json.dumps({'reference':[' '],'suspect':[]}),json.dumps({'reference':[1],'suspect':[]})):
            with patch.object(MuseSceneDiscovery,'model_id',new_callable=PropertyMock,return_value='muse-test'),patch('app.sam_scene.MuseClient') as client:
                client.return_value.complete.return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=response))])
                with self.assertRaises(Exception):MuseSceneDiscovery()(self.image(),self.image())
