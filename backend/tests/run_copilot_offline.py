"""Explicit report/action regression harness: temp storage, blocked network, no app startup.
Run: .venv/bin/python -B -m tests.run_copilot_offline
Existing tests retain their actual rendering/endpoint logic. Only infrastructure is injected.
"""
import ast
import logging
import os
from pathlib import Path
import re
import sys
import tempfile
from types import ModuleType, SimpleNamespace
from typing import Any, Dict, List, Optional
import unittest
from unittest.mock import Mock, patch
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field


def main():
    with tempfile.TemporaryDirectory(prefix='fixproof-copilot-tests-') as temp, \
         patch('socket.socket.connect', side_effect=AssertionError('Live network forbidden')), \
         patch('requests.post', side_effect=AssertionError('Live email forbidden')):
        registry = ModuleType('app.registry')
        for name, default in [('get_incident_by_id',None),('list_registered_assets',[]),('get_nemotron_reports_for_incident',[])]:
            setattr(registry,name,Mock(return_value=default))
        registry.is_cloud_mode=lambda:False
        vault = ModuleType('app.vault');vault.default_vault=object()
        matcher = ModuleType('app.matcher');matcher.load_reference_frame_image=Mock(return_value=None)
        matcher.SUSPECT_THRESHOLD=.75;matcher.MATCH_THRESHOLD=.55
        sys.modules.update({'app.registry':registry,'app.vault':vault,'app.matcher':matcher})
        from app.providers import factory
        provider=Mock(provider_name='muse',model_id='muse-spark-1.3')
        with patch.object(factory,'get_reasoning_provider',return_value=provider), \
             patch.object(factory,'get_vision_provider',return_value=provider), \
             patch.object(factory,'reasoning_is_configured',return_value=False), \
             patch('pathlib.Path.mkdir'):
            from app import detailed_report, nemotron_action
        detailed_report.__file__=str(Path(temp)/'backend/app/detailed_report.py')
        detailed_report.DETAILED_REPORTS_DIR=Path(temp)/'detailed_reports'
        detailed_report.LEGACY_REPORTS_DIR=Path(temp)/'legacy_reports'
        nemotron_action.AUDIT_LOG_FILE=Path(temp)/'email_audit_log.json'
        # Route functions and models are the actual source, with no startup/import chain.
        main_module=ModuleType('app.main')
        main_module.__dict__.update({'app':FastAPI(),'BaseModel':BaseModel,'Field':Field,'Optional':Optional,
            'List':List,'Dict':Dict,'Any':Any,'Header':Header,'HTTPException':HTTPException,'Response':Response,
            'logger':logging.getLogger('offline-report-tests'),'os':os,'re':re,
            'SAFE_ID_REGEX':re.compile(r'^[a-zA-Z0-9_-]+$'),'is_demo_mode':lambda:False,
            'get_incident_by_id':registry.get_incident_by_id,'provider_factory':factory,
            'get_db_config':lambda:SimpleNamespace(mode=SimpleNamespace(value='offline')),
            'DEFAULT_MODEL':'offline','DEFAULT_DETAILED_MODEL':'offline'})
        for module in (detailed_report,nemotron_action):
            for name,value in vars(module).items():
                if callable(value):main_module.__dict__.setdefault(name,value)
        sys.modules['app.main']=main_module
        import app
        app.main=main_module
        tree=ast.parse((Path(__file__).parents[1]/'app/main.py').read_text())
        names={'DetailedReportRequest','EmailDetailedReportRequest','DraftDocumentRequest',
               'get_nemotron_status_endpoint','generate_detailed_report_endpoint','get_detailed_report_endpoint',
               'get_detailed_report_pdf_endpoint','list_detailed_reports_endpoint','email_detailed_report_endpoint',
               'download_summary_endpoint','draft_nemotron_document_endpoint'}
        nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in names]
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'<isolated actual report routes>','exec'), main_module.__dict__)
        with patch.object(factory,'get_reasoning_provider',return_value=provider), \
             patch.object(factory,'get_vision_provider',return_value=provider), \
             patch.object(factory,'get_segmentation_provider',return_value=provider), \
             patch.object(factory,'reasoning_is_configured',return_value=False):
            suite=unittest.defaultTestLoader.loadTestsFromNames([
                'tests.test_detailed_report','tests.test_nemotron_action','tests.test_forensic_report_pdf',
                'tests.test_copilot_workflows'])
            result=unittest.TextTestRunner(verbosity=1).run(suite)
        return 0 if result.wasSuccessful() else 1


if __name__=='__main__':
    raise SystemExit(main())
