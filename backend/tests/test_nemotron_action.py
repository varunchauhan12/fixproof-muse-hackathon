"""
Unit tests for the Nemotron Intelligence & Action Center (Phase 3.5).
Tests evidence extraction, copyright notice drafting, rev-share offer drafting,
human review safeguards, email dispatch safety, and audit logging.
"""

import unittest
from unittest.mock import patch
import os
import uuid

from app.nemotron_action import (
    get_email_config,
    load_email_audit_log,
    save_email_audit_entry,
    extract_incident_evidence_facts,
    generate_copyright_notice_draft,
    generate_rev_share_proposal_draft,
    send_nemotron_document_email,
)


class TestNemotronActionCenter(unittest.TestCase):
    def setUp(self):
        self.sample_incident = {
            "incident_id": "test-inc-4891a",
            "investigation_type": "FULL_VIDEO_SCAN",
            "suspect_filename": "suspect_broadcast_stream.mp4",
            "suspect_url": "https://example.com/stream/live-123",
            "platform": "Web Stream",
            "scanned_at": "2026-10-28T02:00:00Z",
            "matched_assets": ["vault-asset-ref-001"],
            "candidate_matches_found": 3,
            "highest_confidence": 88.5,
            "lowest_l2_distance": 0.342,
            "overall_status": "HIGH_CONFIDENCE_MATCH",
            "frame_matches": [
                {
                    "timestamp_sec": 15.0,
                    "submitted_frame": {"timestamp_sec": 15.0},
                    "best_match": {
                        "match_confirmed": True,
                        "l2_distance": 0.342,
                        "phash_match": True,
                        "source_timestamp_sec": 15.0,
                        "source_asset_id": "vault-asset-ref-001",
                    },
                },
                {
                    "timestamp_sec": 20.0,
                    "submitted_frame": {"timestamp_sec": 20.0},
                    "best_match": {
                        "match_confirmed": True,
                        "l2_distance": 0.410,
                        "phash_match": False,
                        "source_timestamp_sec": 20.0,
                        "source_asset_id": "vault-asset-ref-001",
                    },
                },
            ],
        }

    def test_extract_incident_evidence_facts(self):
        facts = extract_incident_evidence_facts(self.sample_incident)
        self.assertEqual(facts["incident_id"], "test-inc-4891a")
        self.assertEqual(facts["highest_confidence"], 88.5)
        self.assertEqual(facts["overall_status"], "HIGH_CONFIDENCE_MATCH")
        self.assertEqual(len(facts["frame_correlations"]), 2)
        self.assertEqual(facts["frame_correlations"][0]["source_asset_id"], "vault-asset-ref-001")
        self.assertTrue(facts["frame_correlations"][0]["phash_match"])

    def test_generate_copyright_notice_us_dmca(self):
        user_inputs = {
            "rights_holder_name": "Major Sports League Ltd",
            "authorized_rep": "Jane Doe, Legal Counsel",
            "contact_email": "legal@league.example",
            "work_title": "Championship Final Live Broadcast",
            "recipient_name": "Hosting Platform DMCA Agent",
            "recipient_email": "dmca@host.example",
            "jurisdiction": "US_DMCA",
        }
        draft = generate_copyright_notice_draft(
            self.sample_incident,
            user_inputs,
            use_ai_synthesis=False,
        )
        self.assertEqual(draft["status"], "READY_FOR_REVIEW")
        self.assertEqual(draft["document_type"], "COPYRIGHT_NOTICE")
        self.assertEqual(len(draft["missing_fields"]), 0)
        self.assertIn("17 U.S.C. § 512(c)", draft["body"])
        self.assertIn("Championship Final Live Broadcast", draft["body"])
        self.assertIn("Major Sports League Ltd", draft["body"])
        self.assertIn("STATUTORY DECLARATIONS & STATEMENTS OF GOOD FAITH", draft["body"])
        self.assertIn("test-inc-4891a", draft["body"])

    def test_generate_copyright_notice_missing_fields(self):
        user_inputs = {
            "rights_holder_name": "",  # missing
            "contact_email": "",       # missing
            "work_title": "Broadcast",
            "recipient_email": "",     # missing
        }
        draft = generate_copyright_notice_draft(
            self.sample_incident,
            user_inputs,
            use_ai_synthesis=False,
        )
        self.assertEqual(draft["status"], "INCOMPLETE_EVIDENCE")
        self.assertIn("rights_holder_name", draft["missing_fields"])
        self.assertIn("contact_email", draft["missing_fields"])
        self.assertIn("recipient_email", draft["missing_fields"])

    def test_generate_copyright_notice_eu_dsa(self):
        user_inputs = {
            "rights_holder_name": "European Media Corp",
            "contact_email": "ip@media.example",
            "work_title": "European Derby",
            "recipient_email": "dsa-point@platform.eu",
            "jurisdiction": "EU_DSA",
        }
        draft = generate_copyright_notice_draft(
            self.sample_incident,
            user_inputs,
            use_ai_synthesis=False,
        )
        self.assertIn("REGULATION 2022/2065, ARTICLE 16", draft["body"])

    def test_generate_rev_share_proposal_draft(self):
        user_inputs = {
            "rights_holder_name": "Official Broadcaster Inc",
            "representative_name": "John Smith, Partnerships",
            "contact_email": "partnerships@broadcaster.example",
            "work_title": "Super Derby Highlights",
            "recipient_name": "HighlightClipCreator",
            "recipient_email": "creator@youtube.example",
            "proposed_rev_share_pct": 40.0,
            "response_deadline_days": 10,
        }
        draft = generate_rev_share_proposal_draft(
            self.sample_incident,
            user_inputs,
            use_ai_synthesis=False,
        )
        self.assertEqual(draft["status"], "READY_FOR_REVIEW")
        self.assertEqual(draft["document_type"], "REVENUE_SHARE_OFFER")
        self.assertIn("40.0% of net platform advertising", draft["body"])
        self.assertIn("60.0% retained directly by your channel", draft["body"])
        self.assertIn("COMMERCIAL LICENSING & REVENUE-SHARING PROPOSAL (NON-BINDING OFFER)", draft["body"])
        self.assertIn("does not constitute a formal licensing contract", draft["body"])

    def test_send_email_safeguards_unconfirmed(self):
        # Attempting to send without user_confirmed must raise ValueError
        with self.assertRaises(ValueError) as ctx:
            send_nemotron_document_email(
                incident_id="test-inc-4891a",
                document_type="COPYRIGHT_NOTICE",
                recipient_email="dmca@example.com",
                subject="Test Notice",
                body="Test Notice Body",
                user_confirmed=False,
                rights_declaration_confirmed=True,
            )
        self.assertIn("Explicit human review confirmation is required", str(ctx.exception))

    def test_send_copyright_notice_safeguards_undeclared(self):
        # Attempting to send copyright notice without rights declaration confirmation must raise ValueError
        with self.assertRaises(ValueError) as ctx:
            send_nemotron_document_email(
                incident_id="test-inc-4891a",
                document_type="COPYRIGHT_NOTICE",
                recipient_email="dmca@example.com",
                subject="Test Notice",
                body="Test Notice Body",
                user_confirmed=True,
                rights_declaration_confirmed=False,
            )
        self.assertIn("Mandatory rights-holder legal declarations must be confirmed", str(ctx.exception))

    def test_send_email_safely_unconfigured(self):
        # With confirmations but without RESEND_API_KEY, must return NOT_CONFIGURED without crashing or lying
        with patch.dict(os.environ, {"RESEND_API_KEY": ""}, clear=False):
            result = send_nemotron_document_email(
                incident_id="test-inc-4891a",
                document_type="REVENUE_SHARE_OFFER",
                recipient_email="partner@example.com",
                subject="Test Offer",
                body="Test Offer Body",
                user_confirmed=True,
                rights_declaration_confirmed=False,  # not required for rev-share
            )
            self.assertFalse(result["success"])
            self.assertEqual(result["status"], "NOT_CONFIGURED")
            self.assertIn("audit_id", result)

            # Audit log entry must exist
            logs = load_email_audit_log()
            matching = [entry for entry in logs if entry.get("audit_id") == result["audit_id"]]
            self.assertTrue(len(matching) > 0)
            self.assertEqual(matching[0]["status"], "NOT_CONFIGURED")


if __name__ == "__main__":
    unittest.main()
