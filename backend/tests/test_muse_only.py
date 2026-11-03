"""Offline release checks. Run only inside the disposable-copy harness."""
import ast
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from app.providers import factory
from app.providers.meta_client import MetaAPIError


class TestMuseOnly(unittest.TestCase):
    def test_default_and_explicit_selection_without_legacy_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            for getter in (factory.get_reasoning_provider, factory.get_vision_provider,
                           factory.get_voice_provider, factory.get_segmentation_provider):
                self.assertEqual(getter().provider_name, 'muse')
                self.assertEqual(getter('muse').provider_name, 'muse')
                for name in ('nemotron', 'nebius', 'unknown', ''):
                    with self.assertRaises(ValueError): getter(name)
                    with patch.dict(os.environ, {'FIXPROOF_AI_PROVIDER':name}):
                        with self.assertRaises(ValueError): getter()

    def test_removed_clients_cannot_be_imported(self):
        for name in ('app.providers.nemotron', 'app.providers.muse', 'app.nemotron_engine', 'app.vision_verifier', 'app.nemotron_action'):
            self.assertIsNone(importlib.util.find_spec(name))

    def test_no_legacy_environment_reads_or_transport_in_runtime(self):
        root=Path(__file__).parents[1]/'app'
        for path in root.rglob('*.py'):
            tree=ast.parse(path.read_text())
            for node in ast.walk(tree):
                if isinstance(node,ast.Constant) and isinstance(node.value,str):
                    self.assertNotIn('tokenfactory.nebius',node.value,path.name)
                    self.assertFalse(node.value.startswith('NEBIUS_'),path.name)

    def test_startup_health_and_compatibility_aliases_without_legacy_environment(self):
        from app.main import app
        from fastapi.testclient import TestClient
        with TestClient(app) as client:
            self.assertEqual(client.get('/health').status_code,200)
            status=client.get('/api/muse/status')
            self.assertEqual(status.status_code,200)
            self.assertEqual(status.json()['provider'],'muse')
            self.assertEqual(status.json()['vision_provider'],'muse')
            self.assertEqual(status.json()['status'],'degraded')
            self.assertEqual(client.get('/api/nemotron/status').json(),status.json())
        routes={r.path:r for r in app.routes if hasattr(r,'endpoint')}
        for path,route in routes.items():
            if path.startswith('/api/nemotron/'):
                self.assertIs(route.endpoint,routes[path.replace('/api/nemotron/','/api/muse/')].endpoint)
                self.assertFalse(route.include_in_schema)

    def test_missing_credentials_fail_without_other_transport(self):
        with patch.dict(os.environ,{},clear=True), patch('app.providers.meta_client.get_meta_sdk_client') as client:
            client.side_effect=MetaAPIError('CLIENT_INITIALIZATION_ERROR')
            with self.assertRaises(MetaAPIError):
                factory.get_reasoning_provider().create_text_completion({'messages':[]})

    def test_investigation_preserves_selected_model_override_contract(self):
        from app.main import app
        from fastapi.testclient import TestClient
        with patch.dict(os.environ, {'MUSE_REASONING_MODEL':'muse-wonder-1.0'}), \
             patch('app.main.get_incident_by_id') as incident, \
             patch('app.providers.meta.MuseClient.complete') as completion:
            response=TestClient(app).post('/api/threats/test-incident/investigate',
                json={'model_override':'muse-spark-1.3'})
            self.assertEqual(response.status_code,400)
            incident.assert_not_called()
            completion.assert_not_called()
