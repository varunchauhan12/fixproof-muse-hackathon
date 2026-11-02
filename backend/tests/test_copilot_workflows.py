"""Actual report/action routes under run_copilot_offline's injected infrastructure."""
import sys
import unittest
if 'app.main' not in sys.modules:
    raise unittest.SkipTest('Run with python -m tests.run_copilot_offline to block infrastructure and network.')
from unittest.mock import patch, Mock
from fastapi.testclient import TestClient
from app.main import app, DraftDocumentRequest
from app.nemotron_action import generate_rev_share_proposal_draft
from app.detailed_report import send_detailed_report_email, build_evidence_bundle


class CopilotWorkflows(unittest.TestCase):
    def test_no_assumed_commercial_terms_and_zero_share_preserved(self):
        incident={'incident_id':'demo-incident','frame_matches':[]}
        value=generate_rev_share_proposal_draft(incident,{},use_ai_synthesis=False)
        self.assertIn('[To be proposed]',value['body'])
        self.assertNotIn('70.0%',value['body'])
        value=generate_rev_share_proposal_draft(incident,{'proposed_rev_share_pct':0},use_ai_synthesis=False)
        self.assertIn('0% of net',value['body'])
        self.assertIsNone(DraftDocumentRequest(incident_id='demo',document_type='REVENUE_SHARE_OFFER').rev_share_pct)

    def test_confirmation_and_session_required_before_email_reads(self):
        with patch('app.main.get_incident_by_id') as reader:
            c=TestClient(app)
            for extra,headers in [({},{}),({'user_confirmed':True},{})]:
                r=c.post('/api/nemotron/email-detailed-report',json={'incident_id':'demo','report_id':'report-a','recipient_email':'recipient@example.test',**extra},headers=headers)
                self.assertEqual(r.status_code,400)
            reader.assert_not_called()

    def test_custom_mail_content_and_pdf_attachment_are_exact(self):
        with patch('app.detailed_report.get_email_config',return_value=(True,'offline-only','sender@example.test')), \
             patch('requests.post',return_value=Mock(status_code=200,json=lambda:{'id':'accepted-id'})) as send, \
             patch('app.detailed_report.save_email_audit_entry'):
            result=send_detailed_report_email('demo','report-a','recipient@example.test',b'%PDF-test',subject_override='Reviewed subject',body_override='Reviewed email body')
        self.assertEqual(result['status'],'ACCEPTED')
        self.assertIn('not verified',result['message'])
        payload=send.call_args.kwargs['json']
        self.assertEqual(payload['subject'],'Reviewed subject')
        self.assertEqual(payload['text'],'Reviewed email body')
        self.assertEqual(len(payload['attachments']),1)

    def test_email_header_injection_rejected(self):
        with self.assertRaises(ValueError):
            send_detailed_report_email('demo','report','recipient@example.test',b'pdf',subject_override='Hello\r\nBcc:other@example.test')

    def test_email_cannot_attach_another_incidents_report(self):
        with patch('app.main.get_incident_by_id',return_value={'session_id':'session-a'}), \
             patch('app.main.get_detailed_report_record',return_value={'incident_id':'other-incident'}), \
             patch('app.main.send_detailed_report_email') as send:
            result=TestClient(app).post('/api/nemotron/email-detailed-report',headers={'X-Client-Session-Id':'session-a'},json={'incident_id':'demo','report_id':'report-a','recipient_email':'recipient@example.test','user_confirmed':True})
            self.assertEqual(result.status_code,404)
            send.assert_not_called()

    def test_missing_report_timestamps_stay_missing(self):
        record={'incident_id':'demo','frame_matches':[{'submitted_frame':{'frame_index':17},'best_match':{'source_asset_id':'asset-a','l2_distance':.2,'match_confirmed':True}}]}
        with patch('app.detailed_report.get_incident_by_id',return_value=record), \
             patch('app.detailed_report.list_registered_assets',return_value=[]), \
             patch('app.detailed_report.get_nemotron_reports_for_incident',return_value=[]):
            result=build_evidence_bundle('demo')
        self.assertIsNone(result['frame_correlations'][0]['suspect_timestamp_sec'])
        self.assertIsNone(result['frame_correlations'][0]['source_timestamp_sec'])
