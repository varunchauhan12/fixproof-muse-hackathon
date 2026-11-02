"""Offline consumer contract checks. No app/main, registry, report module or vault import."""
import ast
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
import logging
import unittest
from unittest.mock import patch
from typing import Any, Dict, List, Optional

from app.temporal_evidence import build_temporal_evidence_for_incident
from tests.test_muse_tools import Store, frame, incident
from app.muse_tools import MuseToolRegistry


class TemporalConsumers(unittest.TestCase):
    def test_muse_measurements_equal_canonical_builder(self):
        store = Store()
        store.incidents = [incident()]
        store.incidents[0]['frame_matches'] = [frame(5, 0, 0), frame(10, 5, 1), frame(15, 10, 2)]
        result = MuseToolRegistry(store).execute('get_matching_timestamps', session_id='session-a',
                                               arguments={'incident_id':'incident-a'}).model_dump(mode='json')
        self.assertEqual(result['status'], 'success')
        expected = build_temporal_evidence_for_incident(store.incidents[0]).model_dump(mode='json')
        for field in ('global_offset', 'chronological_consistency', 'populations', 'clusters', 'trend'):
            self.assertEqual(result['data']['temporal_evidence'][field], expected[field])

    def test_report_bundle_recomputes_raw_metrics_not_prior_intervals(self):
        # Execute only the existing bundle function with read dependencies injected.
        # Importing the report module itself would initialize provider clients/dirs.
        path = Path(__file__).parents[1] / 'app/detailed_report.py'
        tree = ast.parse(path.read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'build_evidence_bundle')
        record = incident()
        record['frame_matches'] = [frame(5, 0, 0), frame(10, 5, 1)]
        record['frame_matches'][0]['best_match']['source_filename'] = 'reference.jpg'
        vault = ModuleType('app.vault')
        vault.default_vault = object()
        selector = ModuleType('app.temporal_selector')
        selector.resolve_frame_path = lambda *a, **kw: (None, None)
        namespace = {'__file__':str(path), 'Dict':Dict, 'List':List, 'Any':Any, 'Path':Path,
                     'Optional':Optional,'datetime':datetime,'timezone':timezone,'logger':logging.getLogger(__name__),
                     'get_incident_by_id':lambda _:record,'list_registered_assets':lambda *a:[],
                     'get_nemotron_reports_for_incident':lambda _:[{'timeline_intervals':[{'median_offset_sec':999}]}]}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), 'exec'), namespace)
        with patch.dict('sys.modules', {'app.vault':vault, 'app.temporal_selector':selector}), \
             patch('socket.socket.connect', side_effect=AssertionError('Network forbidden')):
            bundle = namespace['build_evidence_bundle']('incident-a')
        self.assertEqual(bundle['temporal_evidence']['global_offset']['median_offset_sec'], 5)
        expected = build_temporal_evidence_for_incident(record).model_dump(mode='json')
        self.assertEqual(bundle['temporal_evidence']['clusters'], expected['clusters'])

    def test_pdf_temporal_section_renders_methodology_without_creating_pdf(self):
        source = (Path(__file__).parents[1] / 'app/detailed_report.py').read_text()
        start = source.index('    temp_ev = secs.get("temporal_evidence")')
        end = source.index('\n    elements.append(Paragraph(secs.get("temporal_continuity"', start)
        from textwrap import dedent
        record = incident()
        record['frame_matches'] = [frame(5, 0, 0), frame(10, 5, 1)]
        captured = []
        namespace = {'secs':{'temporal_evidence':build_temporal_evidence_for_incident(record).model_dump(mode='json')},
                     'elements':captured, 'Paragraph':lambda text, style:text, 'body_style':None,
                     'Spacer':lambda *args:''}
        exec(compile(dedent(source[start:end]), '<isolated temporal PDF section>', 'exec'), namespace)
        text = '\n'.join(captured)
        self.assertIn('median', text.lower())
        self.assertIn('all eligible', text)
        self.assertIn('sample', text)
        self.assertIn('MAD', text)
        self.assertIn('cluster_frame_matches', text)
        self.assertIn('Unsampled', text)
