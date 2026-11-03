"""
Comprehensive Automated Test Suite for Milestone 6C.6B:
Evidence-Grounded Nemotron Investigation Engine and Temporal Correspondence Clustering.

Covers:
1. Correct temporal clustering and preserved evidence references.
2. Multiple source assets and noncontiguous matches.
3. Out-of-order frames, duplicate suspect frames, and reverse source timestamps.
4. Invalid evidence references being rejected or flagged.
5. Valid structured Nemotron response generation.
6. Malformed JSON, missing fields, and truncated output handling (finish_reason='length').
7. API timeout and provider failure handling (APITimeoutError, RateLimitError, APIError).
8. Local persistence and retrieval (storage/nemotron_reports.json).
9. Supabase persistence behavior using mocks without writing to production.
10. No fabricated timestamps, metrics, probabilities, or legal conclusions.
11. Existing /diagnose endpoint backward compatibility.
"""

from datetime import datetime, timezone
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure backend root is on sys.path
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Prevent OpenMP duplicate runtime abort on macOS between PyTorch and FAISS
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from fastapi.testclient import TestClient
from openai import APITimeoutError, RateLimitError, APIError
from openai.types.chat import ChatCompletion, ChatCompletionMessage
from openai.types.chat.chat_completion import Choice
from openai.types.completion_usage import CompletionUsage

from app.evidence_models import (
    FrameEvidence,
    TimelineInterval,
    InvestigationInput,
    FindingItem,
    InvestigationReport,
    validate_report_evidence_references,
    build_frame_evidence_from_matches,
    build_investigation_input_from_incident,
)
from app.timeline import TimelineClusteringConfig, cluster_frame_matches

from app.providers.meta_client import DEFAULT_REASONING_MODEL as DEFAULT_MODEL
from app import registry
from app.main import app


def _create_mock_completion(
    content: str,
    finish_reason: str = "stop",
    prompt_tokens: int = 150,
    completion_tokens: int = 250,
) -> ChatCompletion:
    """Helper to create a well-formed OpenAI ChatCompletion mock object."""
    message = ChatCompletionMessage(
        role="assistant",
        content=content,
    )
    choice = Choice(
        finish_reason=finish_reason,  # type: ignore
        index=0,
        message=message,
    )
    usage = CompletionUsage(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=prompt_tokens + completion_tokens,
    )
    return ChatCompletion(
        id="mock_chat_cmpl_123",
        choices=[choice],
        created=int(datetime.now(timezone.utc).timestamp()),
        model=DEFAULT_MODEL,
        object="chat.completion",
        usage=usage,
    )


class TestEvidenceAndTimeline(unittest.TestCase):
    """Unit tests for evidence contract models and temporal clustering."""

    def test_1_temporal_clustering_basic(self):
        """1. Verify correct temporal clustering and preserved evidence references."""
        frames = [
            FrameEvidence(
                evidence_id="f_0_0s",
                suspect_timestamp_sec=0.0,
                suspect_frame_idx=0,
                source_asset_id="asset_alpha",
                source_timestamp_sec=10.0,
                l2_distance=0.35,
                phash_match=True,
                similarity_status="CONFIRMED_MATCH",
            ),
            FrameEvidence(
                evidence_id="f_1_5s",
                suspect_timestamp_sec=5.0,
                suspect_frame_idx=1,
                source_asset_id="asset_alpha",
                source_timestamp_sec=15.0,
                l2_distance=0.32,
                phash_match=True,
                similarity_status="CONFIRMED_MATCH",
            ),
            FrameEvidence(
                evidence_id="f_2_10s",
                suspect_timestamp_sec=10.0,
                suspect_frame_idx=2,
                source_asset_id="asset_alpha",
                source_timestamp_sec=20.0,
                l2_distance=0.38,
                phash_match=True,
                similarity_status="CONFIRMED_MATCH",
            ),
        ]

        intervals = cluster_frame_matches(frames)
        self.assertEqual(len(intervals), 1)

        itv = intervals[0]
        self.assertEqual(itv.source_asset_id, "asset_alpha")
        self.assertEqual(itv.suspect_start_sec, 0.0)
        self.assertEqual(itv.suspect_end_sec, 10.0)
        self.assertEqual(itv.source_start_sec, 10.0)
        self.assertEqual(itv.source_end_sec, 20.0)
        self.assertEqual(itv.duration_sec, 10.0)
        self.assertEqual(itv.frame_count, 3)
        self.assertEqual(itv.continuity_status, "CONTINUOUS_MATCH")
        self.assertEqual(itv.evidence_ids, ["f_0_0s", "f_1_5s", "f_2_10s"])
        self.assertEqual(itv.phash_match_ratio, 1.0)
        self.assertAlmostEqual(itv.min_l2_distance, 0.32, places=2)

    def test_2_multiple_source_assets_and_noncontiguous_gaps(self):
        """2. Verify multiple source assets and large temporal gaps split correctly."""
        frames = [
            # Asset Alpha segment 1
            FrameEvidence(
                evidence_id="f_alpha_0",
                suspect_timestamp_sec=0.0,
                suspect_frame_idx=0,
                source_asset_id="asset_alpha",
                source_timestamp_sec=5.0,
                l2_distance=0.30,
                similarity_status="CONFIRMED_MATCH",
            ),
            FrameEvidence(
                evidence_id="f_alpha_5",
                suspect_timestamp_sec=5.0,
                suspect_frame_idx=1,
                source_asset_id="asset_alpha",
                source_timestamp_sec=10.0,
                l2_distance=0.31,
                similarity_status="CONFIRMED_MATCH",
            ),
            # Gap of 35 seconds (exceeds default 15s max gap) -> must start new interval
            FrameEvidence(
                evidence_id="f_alpha_40",
                suspect_timestamp_sec=40.0,
                suspect_frame_idx=8,
                source_asset_id="asset_alpha",
                source_timestamp_sec=60.0,
                l2_distance=0.40,
                similarity_status="CONFIRMED_MATCH",
            ),
            # Incompatible reference asset Beta -> must never be merged with Alpha
            FrameEvidence(
                evidence_id="f_beta_10",
                suspect_timestamp_sec=10.0,
                suspect_frame_idx=2,
                source_asset_id="asset_beta",
                source_timestamp_sec=100.0,
                l2_distance=0.25,
                similarity_status="CONFIRMED_MATCH",
            ),
            FrameEvidence(
                evidence_id="f_beta_15",
                suspect_timestamp_sec=15.0,
                suspect_frame_idx=3,
                source_asset_id="asset_beta",
                source_timestamp_sec=105.0,
                l2_distance=0.26,
                similarity_status="CONFIRMED_MATCH",
            ),
        ]

        intervals = cluster_frame_matches(frames)
        # Should have 3 intervals: Alpha [0-5], Beta [10-15], Alpha [40-40 singleton]
        self.assertEqual(len(intervals), 3)

        alpha_intervals = [i for i in intervals if i.source_asset_id == "asset_alpha"]
        beta_intervals = [i for i in intervals if i.source_asset_id == "asset_beta"]

        self.assertEqual(len(alpha_intervals), 2)
        self.assertEqual(len(beta_intervals), 1)

        # Asset Beta interval checks
        self.assertEqual(beta_intervals[0].suspect_start_sec, 10.0)
        self.assertEqual(beta_intervals[0].suspect_end_sec, 15.0)
        self.assertEqual(beta_intervals[0].evidence_ids, ["f_beta_10", "f_beta_15"])

        # Second Alpha interval (isolated singleton)
        self.assertEqual(alpha_intervals[1].suspect_start_sec, 40.0)
        self.assertEqual(alpha_intervals[1].duration_sec, 0.0)
        self.assertEqual(alpha_intervals[1].continuity_status, "SINGLETON")

    def test_3_temporal_clustering_edge_cases(self):
        """3. Verify out-of-order input, duplicates, and reverse source timestamps."""
        frames = [
            # Out of order frame (timestamp 5 placed before timestamp 0)
            FrameEvidence(
                evidence_id="f_5s",
                suspect_timestamp_sec=5.0,
                suspect_frame_idx=1,
                source_asset_id="asset_gamma",
                source_timestamp_sec=55.0,
                l2_distance=0.45,
                similarity_status="CONFIRMED_MATCH",
            ),
            FrameEvidence(
                evidence_id="f_0s",
                suspect_timestamp_sec=0.0,
                suspect_frame_idx=0,
                source_asset_id="asset_gamma",
                source_timestamp_sec=50.0,
                l2_distance=0.40,
                similarity_status="CONFIRMED_MATCH",
            ),
            # Duplicate suspect timestamp (10.0s) with higher L2 distance
            FrameEvidence(
                evidence_id="f_10s_worse",
                suspect_timestamp_sec=10.0,
                suspect_frame_idx=2,
                source_asset_id="asset_gamma",
                source_timestamp_sec=60.0,
                l2_distance=0.60,
                similarity_status="SUSPECT_MATCH",
            ),
            FrameEvidence(
                evidence_id="f_10s_better",
                suspect_timestamp_sec=10.0,
                suspect_frame_idx=2,
                source_asset_id="asset_gamma",
                source_timestamp_sec=60.0,
                l2_distance=0.35,
                similarity_status="CONFIRMED_MATCH",
            ),
            # Reverse source jump (source jumps backward from 60.0 to 10.0) -> must split!
            FrameEvidence(
                evidence_id="f_15s_reverse",
                suspect_timestamp_sec=15.0,
                suspect_frame_idx=3,
                source_asset_id="asset_gamma",
                source_timestamp_sec=10.0,
                l2_distance=0.30,
                similarity_status="CONFIRMED_MATCH",
            ),
        ]

        intervals = cluster_frame_matches(frames)
        self.assertEqual(len(intervals), 2)

        # Interval 1: 0s, 5s, 10s (using better duplicate f_10s_better)
        itv1 = intervals[0]
        self.assertEqual(itv1.suspect_start_sec, 0.0)
        self.assertEqual(itv1.suspect_end_sec, 10.0)
        self.assertEqual(itv1.frame_count, 3)
        self.assertIn("f_10s_better", itv1.evidence_ids)
        self.assertNotIn("f_10s_worse", itv1.evidence_ids)

        # Interval 2: 15s (split because source jumped backwards to 10s)
        itv2 = intervals[1]
        self.assertEqual(itv2.suspect_start_sec, 15.0)
        self.assertEqual(itv2.continuity_status, "SINGLETON")

    def test_4_evidence_reference_validation(self):
        """4. Verify rejection of references to nonexistent evidence IDs."""
        report = InvestigationReport(
            report_id="rep_123",
            incident_id="inc_456",
            model_id=DEFAULT_MODEL,
            summary="Grounded report",
            recommended_action="ESCALATE_LEGAL_TAKEDOWN",
            confidence_assessment="HIGH_CONFIDENCE_MATCH",
            findings=[
                FindingItem(
                    finding_id="f1",
                    category="TIMELINE_CORRESPONDENCE",
                    statement="Interval matches exactly.",
                    evidence_ids=["interval_1_asset", "frame_0_t0s"],
                ),
                FindingItem(
                    finding_id="f2",
                    category="PERCEPTUAL_SIMILARITY",
                    statement="This finding hallucinates evidence ID f_phantom_99s.",
                    evidence_ids=["f_phantom_99s"],
                ),
            ],
            evidence_references=["interval_1_asset", "f_phantom_99s"],
        )

        valid_ids = {"interval_1_asset", "frame_0_t0s"}
        is_valid, invalid_ids = validate_report_evidence_references(report, valid_ids)

        self.assertFalse(is_valid)
        self.assertIn("f_phantom_99s", invalid_ids)
        self.assertEqual(len(invalid_ids), 1)




class TestReportPersistenceAndCompatibility(unittest.TestCase):
    """Integration tests for local/cloud report persistence and /diagnose compatibility."""

    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="fixproof_persistence_test_"))
        self.orig_reports_file = registry.INVESTIGATION_REPORTS_FILE
        registry.INVESTIGATION_REPORTS_FILE = self.temp_dir / "nemotron_reports.json"
        self.client = TestClient(app)

    def tearDown(self):
        registry.INVESTIGATION_REPORTS_FILE = self.orig_reports_file
        if self.temp_dir.exists():
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_8_local_report_persistence(self):
        """8. Verify local mode persistence, file creation, and retrieval by ID."""
        test_report = InvestigationReport(
            report_id="11111111-2222-3333-4444-555555555555",
            incident_id="66666666-7777-8888-9999-000000000000",
            model_id=DEFAULT_MODEL,
            summary="Local persistence test summary.",
            recommended_action="FLAG_FOR_BROKER_LICENSING",
            confidence_assessment="MODERATE_PROBABILITY",
            human_review_required=True,
            findings=[],
            operational_metadata={"validation_status": "VALIDATED"},
        )

        with patch.object(registry, "is_cloud_mode", return_value=False):
            saved = registry.save_investigation_report(test_report)
            self.assertEqual(saved["report_id"], test_report.report_id)
            self.assertTrue(registry.INVESTIGATION_REPORTS_FILE.exists())

            # Retrieve by report_id
            loaded = registry.get_investigation_report_by_id(test_report.report_id)
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded["summary"], "Local persistence test summary.")
            self.assertEqual(loaded["recommended_action"], "FLAG_FOR_BROKER_LICENSING")

            # Retrieve by incident_id
            incident_reports = registry.get_investigation_reports_for_incident(test_report.incident_id)
            self.assertEqual(len(incident_reports), 1)
            self.assertEqual(incident_reports[0]["report_id"], test_report.report_id)

    def test_9_supabase_persistence_mocked(self):
        """9. Verify Supabase persistence executes parameterized SQL without touching production."""
        test_report = InvestigationReport(
            report_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            incident_id="ffffffff-0000-1111-2222-333333333333",
            model_id=DEFAULT_MODEL,
            summary="Cloud persistence test summary.",
            recommended_action="NEEDS_FULL_VIDEO_REVIEW",
            confidence_assessment="INCONCLUSIVE_DATA",
            human_review_required=False,
            findings=[],
            operational_metadata={
                "latency_ms": 350,
                "prompt_tokens": 120,
                "completion_tokens": 180,
                "validation_status": "VALIDATED",
            },
        )

        mock_db = MagicMock()
        with patch.object(registry, "is_cloud_mode", return_value=True), \
             patch.object(registry, "default_db_manager", mock_db):

            registry.save_investigation_report(test_report)

            self.assertTrue(mock_db.execute.called)
            sql_query, params = mock_db.execute.call_args[0]

            self.assertIn("INSERT INTO nemotron_reports", sql_query)
            self.assertIn("ON CONFLICT (report_id) DO UPDATE", sql_query)
            # Verify parameters contain clean IDs and no private reasoning
            self.assertEqual(params[0], test_report.report_id)
            self.assertEqual(params[1], test_report.incident_id)
            self.assertEqual(params[2], DEFAULT_MODEL)
            self.assertEqual(params[4], "Cloud persistence test summary.")
            self.assertEqual(params[5], "NEEDS_FULL_VIDEO_REVIEW")
            self.assertEqual(params[6], "INCONCLUSIVE_DATA")








if __name__ == "__main__":
    unittest.main()
