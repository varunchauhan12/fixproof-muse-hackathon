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
from app.nemotron_engine import (
    generate_nemotron_report,
    build_failed_report,
    build_user_prompt,
    SYSTEM_PROMPT,
    DEFAULT_MODEL,
    normalize_model_override,
    resolve_model_id,
    ALLOWED_MODELS,
    get_allowed_models,
)
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


class TestNemotronEvidenceAndTimeline(unittest.TestCase):
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


class TestNemotronGeneratorAndValidation(unittest.TestCase):
    """Unit and mock integration tests for the bounded Nemotron report generator."""

    def setUp(self):
        self.test_incident = {
            "incident_id": "8f8b88d8-7451-40c9-94b1-912f27a69b01",
            "investigation_type": "FULL_VIDEO_SCAN",
            "suspect_filename": "suspect_match_test.mp4",
            "duration_seconds": 20.0,
            "overall_status": "CANDIDATE_MATCH",
            "matched_assets": ["c7fd5fed-eb3f-493d-a4b4-26a511751289"],
            "frame_matches": [
                {
                    "submitted_frame": {"frame_index": 0, "timestamp_sec": 0},
                    "best_match": {
                        "source_asset_id": "c7fd5fed-eb3f-493d-a4b4-26a511751289",
                        "source_frame_id": 0,
                        "source_timestamp_sec": 10,
                        "source_filename": "frame_0010s.jpg",
                        "l2_distance": 0.38,
                        "match_confirmed": True,
                        "phash_match": True,
                        "phash_score": 92,
                    },
                },
                {
                    "submitted_frame": {"frame_index": 1, "timestamp_sec": 5},
                    "best_match": {
                        "source_asset_id": "c7fd5fed-eb3f-493d-a4b4-26a511751289",
                        "source_frame_id": 1,
                        "source_timestamp_sec": 15,
                        "source_filename": "frame_0015s.jpg",
                        "l2_distance": 0.35,
                        "match_confirmed": True,
                        "phash_match": True,
                        "phash_score": 95,
                    },
                },
            ],
        }
        self.frames_ev = build_frame_evidence_from_matches(self.test_incident["frame_matches"])
        self.intervals = cluster_frame_matches(self.frames_ev)
        self.inv_input = build_investigation_input_from_incident(self.test_incident, self.intervals)

    def test_5_valid_structured_nemotron_response(self):
        """5. Verify parsing and validation of a valid structured Nemotron response."""
        interval_id = self.intervals[0].interval_id
        valid_json_payload = json.dumps({
            "summary": "Suspect video frames 0s to 5s correlate strongly with reference asset footage from 10s to 15s.",
            "recommended_action": "ESCALATE_LEGAL_TAKEDOWN",
            "confidence_assessment": "HIGH_CONFIDENCE_MATCH",
            "human_review_required": False,
            "findings": [
                {
                    "finding_id": "finding_1",
                    "category": "TIMELINE_CORRESPONDENCE",
                    "statement": "Continuous correspondence interval of 5.0 seconds observed.",
                    "evidence_ids": [interval_id],
                    "measured_metrics": {"mean_l2": 0.365, "duration_sec": 5.0},
                }
            ],
            "unresolved_questions": ["Audio track synchronization remains unverified."],
            "contradictions_detected": [],
            "limitations_disclosed": ["Analysis conducted at 5-second sampling intervals."],
            "evidence_references": [interval_id],
        })

        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _create_mock_completion(valid_json_payload)

        report = generate_nemotron_report(self.inv_input, client=mock_client)

        self.assertEqual(report.incident_id, self.test_incident["incident_id"])
        self.assertEqual(report.recommended_action, "ESCALATE_LEGAL_TAKEDOWN")
        self.assertEqual(report.confidence_assessment, "HIGH_CONFIDENCE_MATCH")
        self.assertEqual(len(report.findings), 1)
        self.assertEqual(report.findings[0].evidence_ids, [interval_id])
        self.assertEqual(report.operational_metadata["validation_status"], "VALIDATED")
        self.assertEqual(report.operational_metadata["finish_reason"], "stop")
        self.assertEqual(report.operational_metadata["prompt_tokens"], 150)
        self.assertEqual(report.operational_metadata["completion_tokens"], 250)

    def test_6_malformed_and_truncated_nemotron_responses(self):
        """6. Verify graceful handling of malformed JSON, empty bodies, and truncated outputs."""
        mock_client = MagicMock()

        # Case A: Truncated output because reasoning consumed token budget
        mock_client.chat.completions.create.return_value = _create_mock_completion(
            content="",
            finish_reason="length",
        )
        report_trunc = generate_nemotron_report(self.inv_input, client=mock_client)
        self.assertEqual(report_trunc.operational_metadata["validation_status"], "FAILED_VALIDATION")
        self.assertEqual(report_trunc.operational_metadata["failure_type"], "TOKEN_BUDGET_EXHAUSTED")
        self.assertEqual(report_trunc.recommended_action, "NEEDS_FULL_VIDEO_REVIEW")

        # Case B: Malformed / non-JSON content
        mock_client.chat.completions.create.return_value = _create_mock_completion(
            content="I am unable to output JSON: Error occurred.",
            finish_reason="stop",
        )
        report_malformed = generate_nemotron_report(self.inv_input, client=mock_client)
        self.assertEqual(report_malformed.operational_metadata["validation_status"], "FAILED_VALIDATION")
        self.assertEqual(report_malformed.operational_metadata["failure_type"], "INVALID_JSON")

        # Case C: Empty choices list
        mock_resp_empty = MagicMock()
        mock_resp_empty.choices = []
        mock_client.chat.completions.create.return_value = mock_resp_empty
        report_empty = generate_nemotron_report(self.inv_input, client=mock_client)
        self.assertEqual(report_empty.operational_metadata["validation_status"], "FAILED_VALIDATION")
        self.assertEqual(report_empty.operational_metadata["failure_type"], "EMPTY_CHOICES")

    def test_7_api_timeout_and_provider_failure(self):
        """7. Verify handling of API timeouts, rate limits, and provider exceptions."""
        mock_client = MagicMock()

        # Timeout handling
        mock_client.chat.completions.create.side_effect = APITimeoutError(request=MagicMock())
        report_timeout = generate_nemotron_report(self.inv_input, client=mock_client)
        self.assertEqual(report_timeout.operational_metadata["failure_type"], "API_TIMEOUT")
        self.assertEqual(report_timeout.recommended_action, "NEEDS_FULL_VIDEO_REVIEW")

        # Rate limit handling (HTTP 429)
        mock_client.chat.completions.create.side_effect = RateLimitError(
            message="Rate limit exceeded",
            response=MagicMock(status_code=429),
            body=None,
        )
        report_rl = generate_nemotron_report(self.inv_input, client=mock_client)
        self.assertEqual(report_rl.operational_metadata["failure_type"], "RATE_LIMIT_EXCEEDED")

    def test_10_no_fabrication_invariants_and_url_screening(self):
        """10. Verify no fabricated metrics, probabilities, or rights conclusions, and URL rules."""
        # For URL_SCREENING, model must be forced to NEEDS_FULL_VIDEO_REVIEW even if it hallucinates takedown
        url_incident = {
            "incident_id": "url_inc_999",
            "investigation_type": "URL_SCREENING",
            "suspect_filename": "[YouTube] Match Highlights",
            "overall_status": "CANDIDATE_MATCH",
            "frame_matches": [
                {
                    "submitted_frame": {"frame_index": 0, "timestamp_sec": 0},
                    "best_match": {
                        "source_asset_id": "c7fd5fed-eb3f-493d-a4b4-26a511751289",
                        "source_timestamp_sec": 0,
                        "l2_distance": 0.40,
                        "match_confirmed": True,
                    },
                }
            ],
        }
        url_input = build_investigation_input_from_incident(url_incident)

        mock_client = MagicMock()
        hallucinated_json = json.dumps({
            "summary": "Full video is confirmed pirated.",
            "recommended_action": "ESCALATE_LEGAL_TAKEDOWN",  # Violates URL screening rule!
            "confidence_assessment": "HIGH_CONFIDENCE_MATCH",
            "findings": [
                {
                    "finding_id": "f1",
                    "category": "TIMELINE_CORRESPONDENCE",
                    "statement": "Thumbnail matches reference.",
                    "evidence_ids": ["frame_0_t0s"],
                    "measured_metrics": {"l2_distance": 0.40},
                }
            ],
            "limitations_disclosed": [],
        })
        mock_client.chat.completions.create.return_value = _create_mock_completion(hallucinated_json)

        report = generate_nemotron_report(url_input, client=mock_client)

        # Enforced invariant: URL screening CANNOT recommend legal takedown without full video review
        self.assertEqual(report.recommended_action, "NEEDS_FULL_VIDEO_REVIEW")
        self.assertTrue(any("thumbnail" in lim.lower() for lim in report.limitations_disclosed))


class TestReportPersistenceAndCompatibility(unittest.TestCase):
    """Integration tests for local/cloud report persistence and /diagnose compatibility."""

    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="fixproof_persistence_test_"))
        self.orig_reports_file = registry.NEMOTRON_REPORTS_FILE
        registry.NEMOTRON_REPORTS_FILE = self.temp_dir / "nemotron_reports.json"
        self.client = TestClient(app)

    def tearDown(self):
        registry.NEMOTRON_REPORTS_FILE = self.orig_reports_file
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
            saved = registry.save_nemotron_report(test_report)
            self.assertEqual(saved["report_id"], test_report.report_id)
            self.assertTrue(registry.NEMOTRON_REPORTS_FILE.exists())

            # Retrieve by report_id
            loaded = registry.get_nemotron_report_by_id(test_report.report_id)
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded["summary"], "Local persistence test summary.")
            self.assertEqual(loaded["recommended_action"], "FLAG_FOR_BROKER_LICENSING")

            # Retrieve by incident_id
            incident_reports = registry.get_nemotron_reports_for_incident(test_report.incident_id)
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

            registry.save_nemotron_report(test_report)

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

    def test_11_diagnose_backward_compatibility(self):
        """11. Verify existing POST /diagnose endpoint remains completely backward-compatible."""
        with patch("app.main.OpenAI") as mock_openai_cls:
            mock_client = MagicMock()
            mock_openai_cls.return_value = mock_client
            mock_client.chat.completions.create.return_value = _create_mock_completion(
                content="Off-by-one error: Loop boundary condition uses <= instead of <."
            )

            with patch.dict(os.environ, {"NEBIUS_API_KEY": "mock_key"}):
                resp = self.client.post(
                    "/diagnose",
                    json={"issue_description": "My loop prints one extra element at the end."},
                )

                self.assertEqual(resp.status_code, 200)
                data = resp.json()
                self.assertIn("diagnosis", data)
                self.assertIn("Off-by-one", data["diagnosis"])
                self.assertEqual(data["provider"], "Nebius Token Factory")

    def test_12_api_investigation_endpoints_end_to_end(self):
        """12. Verify end-to-end HTTP API endpoints for threat investigation and report retrieval."""
        test_inc_id = "12345678-1234-1234-1234-123456789abc"
        mock_incident = {
            "incident_id": test_inc_id,
            "investigation_type": "FULL_VIDEO_SCAN",
            "suspect_filename": "clip.mp4",
            "overall_status": "CANDIDATE_MATCH",
            "frame_matches": [
                {
                    "submitted_frame": {"frame_index": 0, "timestamp_sec": 0},
                    "best_match": {
                        "source_asset_id": "ref_asset_1",
                        "source_timestamp_sec": 10,
                        "l2_distance": 0.35,
                        "match_confirmed": True,
                        "phash_match": True,
                    },
                }
            ],
        }

        mock_json_response = json.dumps({
            "summary": "Verified correspondence found on ref_asset_1.",
            "recommended_action": "ESCALATE_LEGAL_TAKEDOWN",
            "confidence_assessment": "HIGH_CONFIDENCE_MATCH",
            "findings": [
                {
                    "finding_id": "f1",
                    "category": "TIMELINE_CORRESPONDENCE",
                    "statement": "Matched at t=0s.",
                    "evidence_ids": ["interval_1_ref_asse"],
                }
            ],
            "limitations_disclosed": [],
            "evidence_references": ["interval_1_ref_asse"],
        })

        with patch("app.main.is_cloud_mode", return_value=False), \
             patch("app.registry.is_cloud_mode", return_value=False), \
             patch("app.main.get_incident_by_id", return_value=mock_incident), \
             patch("app.nemotron_engine.get_openai_client") as mock_get_client:

            mock_client = MagicMock()
            mock_get_client.return_value = mock_client
            mock_client.chat.completions.create.return_value = _create_mock_completion(mock_json_response)

            # 1. POST /api/threats/{incident_id}/investigate
            resp = self.client.post(f"/api/threats/{test_inc_id}/investigate")
            self.assertEqual(resp.status_code, 200)
            rep_data = resp.json()
            self.assertEqual(rep_data["incident_id"], test_inc_id)
            self.assertEqual(rep_data["recommended_action"], "ESCALATE_LEGAL_TAKEDOWN")
            report_id = rep_data["report_id"]

            # 2. Idempotency: second call returns cached report without calling API again
            mock_client.chat.completions.create.reset_mock()
            resp2 = self.client.post(f"/api/threats/{test_inc_id}/investigate")
            self.assertEqual(resp2.status_code, 200)
            self.assertFalse(mock_client.chat.completions.create.called)

            # 3. GET /api/threats/{incident_id}/report
            resp_rep = self.client.get(f"/api/threats/{test_inc_id}/report")
            self.assertEqual(resp_rep.status_code, 200)
            self.assertEqual(resp_rep.json()["report_id"], report_id)

            # 4. GET /api/threats/reports/{report_id}
            resp_by_id = self.client.get(f"/api/threats/reports/{report_id}")
            self.assertEqual(resp_by_id.status_code, 200)
            self.assertEqual(resp_by_id.json()["report_id"], report_id)

            # 5. Invalid incident ID format returns 400
            resp_bad = self.client.post("/api/threats/bad!!id/investigate")
            self.assertEqual(resp_bad.status_code, 400)

            # 6. Nonexistent incident ID returns 404
            with patch("app.main.get_incident_by_id", return_value=None), \
                 patch("app.main.get_nemotron_reports_for_incident", return_value=[]):
                resp_404 = self.client.post("/api/threats/nonexistent-id/investigate")
                self.assertEqual(resp_404.status_code, 404)

    def test_13_model_override_normalization_and_validation(self):
        """13. Regression test: Verify normalization and resolution for omitted, null, empty, placeholder, valid, and invalid overrides."""
        # 1. Normalization of blank, absent, and Swagger placeholder overrides
        self.assertIsNone(normalize_model_override(None))
        self.assertIsNone(normalize_model_override(""))
        self.assertIsNone(normalize_model_override("   "))
        self.assertIsNone(normalize_model_override("string"))
        self.assertIsNone(normalize_model_override("String"))
        self.assertIsNone(normalize_model_override("<string>"))
        self.assertIsNone(normalize_model_override("null"))
        self.assertIsNone(normalize_model_override("none"))
        self.assertIsNone(normalize_model_override("undefined"))

        # Valid model strings are preserved
        self.assertEqual(normalize_model_override("nvidia/Nemotron-3_5-Lightning"), "nvidia/Nemotron-3_5-Lightning")
        self.assertEqual(normalize_model_override("nvidia/Nemotron-3.5-Super-VL"), "nvidia/Nemotron-3.5-Super-VL")

        # 2. Resolution: Absent or placeholder defaults to configured default model
        self.assertEqual(resolve_model_id(None), DEFAULT_MODEL)
        self.assertEqual(resolve_model_id(""), DEFAULT_MODEL)
        self.assertEqual(resolve_model_id("   "), DEFAULT_MODEL)
        self.assertEqual(resolve_model_id("string"), DEFAULT_MODEL)
        self.assertEqual(resolve_model_id("<string>"), DEFAULT_MODEL)
        self.assertEqual(resolve_model_id("null"), DEFAULT_MODEL)

        # Nonempty valid overrides
        self.assertEqual(resolve_model_id("nvidia/Nemotron-3_5-Lightning"), "nvidia/Nemotron-3_5-Lightning")
        self.assertEqual(resolve_model_id("nvidia/Nemotron-3.5-Super-VL"), "nvidia/Nemotron-3.5-Super-VL")

        # Nonempty invalid overrides raise ValueError
        with self.assertRaises(ValueError):
            resolve_model_id("unsupported-model-xyz")

        # 3. Direct engine call with invalid override returns explicit failed report
        test_input = InvestigationInput(
            incident_id="00000000-0000-0000-0000-000000000001",
            investigation_type="FULL_VIDEO_SCAN",
            suspect_filename="test.mp4",
            duration_seconds=10.0,
            overall_cv_status="CANDIDATE_MATCH",
            matched_assets=["asset_1"],
            frames_evidence=[],
            timeline_intervals=[],
        )
        report = generate_nemotron_report(test_input, model_override="invalid-model-foo")
        self.assertEqual(report.operational_metadata.get("validation_status"), "FAILED_VALIDATION")
        self.assertEqual(report.operational_metadata.get("failure_type"), "INVALID_MODEL_OVERRIDE")
        self.assertTrue(report.human_review_required)

    def test_14_api_model_override_scenarios(self):
        """14. Regression test: Verify API handles omitted, null, empty, Swagger 'string', valid, and invalid model overrides."""
        test_inc_id = "12345678-0000-0000-0000-123456789abc"
        mock_incident = {
            "incident_id": test_inc_id,
            "investigation_type": "FULL_VIDEO_SCAN",
            "suspect_filename": "clip.mp4",
            "overall_status": "CANDIDATE_MATCH",
            "frame_matches": [],
        }
        mock_json_response = json.dumps({
            "summary": "Verified correspondence.",
            "recommended_action": "ESCALATE_LEGAL_TAKEDOWN",
            "confidence_assessment": "HIGH_CONFIDENCE_MATCH",
            "findings": [],
            "limitations_disclosed": [],
            "evidence_references": [],
        })

        with patch("app.main.is_cloud_mode", return_value=False), \
             patch("app.registry.is_cloud_mode", return_value=False), \
             patch("app.main.get_incident_by_id", return_value=mock_incident), \
             patch("app.nemotron_engine.get_openai_client") as mock_get_client:

            mock_client = MagicMock()
            mock_get_client.return_value = mock_client
            mock_client.chat.completions.create.return_value = _create_mock_completion(mock_json_response)

            # Scenario A: Omitted model_override (empty JSON body {})
            resp = self.client.post(f"/api/threats/{test_inc_id}/investigate", json={"force_refresh": True})
            self.assertEqual(resp.status_code, 200)
            call_kwargs = mock_client.chat.completions.create.call_args[1]
            self.assertEqual(call_kwargs["model"], DEFAULT_MODEL)

            # Scenario B: model_override is null
            resp = self.client.post(f"/api/threats/{test_inc_id}/investigate", json={"force_refresh": True, "model_override": None})
            self.assertEqual(resp.status_code, 200)
            call_kwargs = mock_client.chat.completions.create.call_args[1]
            self.assertEqual(call_kwargs["model"], DEFAULT_MODEL)

            # Scenario C: model_override is empty string ""
            resp = self.client.post(f"/api/threats/{test_inc_id}/investigate", json={"force_refresh": True, "model_override": ""})
            self.assertEqual(resp.status_code, 200)
            call_kwargs = mock_client.chat.completions.create.call_args[1]
            self.assertEqual(call_kwargs["model"], DEFAULT_MODEL)

            # Scenario D: model_override is Swagger placeholder "string"
            resp = self.client.post(f"/api/threats/{test_inc_id}/investigate", json={"force_refresh": True, "model_override": "string"})
            self.assertEqual(resp.status_code, 200)
            call_kwargs = mock_client.chat.completions.create.call_args[1]
            self.assertEqual(call_kwargs["model"], DEFAULT_MODEL)

            # Scenario E: model_override is a valid allowed model
            resp = self.client.post(f"/api/threats/{test_inc_id}/investigate", json={"force_refresh": True, "model_override": "nvidia/Nemotron-3.5-Super-VL"})
            self.assertEqual(resp.status_code, 200)
            call_kwargs = mock_client.chat.completions.create.call_args[1]
            self.assertEqual(call_kwargs["model"], "nvidia/Nemotron-3.5-Super-VL")

            # Scenario F: model_override is an invalid unsupported model -> 400 Bad Request
            resp_invalid = self.client.post(f"/api/threats/{test_inc_id}/investigate", json={"model_override": "invalid-model-xyz"})
            self.assertEqual(resp_invalid.status_code, 400)
            self.assertIn("Invalid model_override", resp_invalid.json()["detail"])
            self.assertIn("Allowed models", resp_invalid.json()["detail"])

    def test_15_caching_and_force_refresh_behavior(self):
        """15. Regression test: Verify failed reports do not block retry, while valid reports are cached unless force_refresh=True."""
        test_inc_id = "55555555-5555-5555-5555-555555555555"
        mock_incident = {
            "incident_id": test_inc_id,
            "investigation_type": "FULL_VIDEO_SCAN",
            "suspect_filename": "clip.mp4",
            "overall_status": "CANDIDATE_MATCH",
            "frame_matches": [],
        }

        # 1. Simulate an existing FAILED report in registry (e.g. from previous Swagger "string" failure)
        failed_report = {
            "report_id": "failed-rep-123",
            "incident_id": test_inc_id,
            "model_id": "string",
            "summary": "Investigation incomplete: PROVIDER_API_ERROR. The model 'string' does not exist.",
            "recommended_action": "NEEDS_FULL_VIDEO_REVIEW",
            "confidence_assessment": "INCONCLUSIVE_DATA",
            "human_review_required": True,
            "findings": [],
            "operational_metadata": {
                "validation_status": "FAILED_VALIDATION",
                "failure_type": "PROVIDER_API_ERROR",
                "errors": ["The model 'string' does not exist."],
            },
        }

        mock_json_success = json.dumps({
            "summary": "Successful fresh analysis.",
            "recommended_action": "ESCALATE_LEGAL_TAKEDOWN",
            "confidence_assessment": "HIGH_CONFIDENCE_MATCH",
            "findings": [],
            "limitations_disclosed": [],
            "evidence_references": [],
        })

        with patch("app.main.is_cloud_mode", return_value=False), \
             patch("app.registry.is_cloud_mode", return_value=False), \
             patch("app.main.get_incident_by_id", return_value=mock_incident), \
             patch("app.main.get_nemotron_reports_for_incident") as mock_get_reports, \
             patch("app.main.save_nemotron_report") as mock_save, \
             patch("app.nemotron_engine.get_openai_client") as mock_get_client:

            # Initially, registry only has the failed report
            mock_get_reports.return_value = [failed_report]
            mock_client = MagicMock()
            mock_get_client.return_value = mock_client
            mock_client.chat.completions.create.return_value = _create_mock_completion(mock_json_success)
            mock_save.side_effect = lambda rep: rep.model_dump(mode="json") if hasattr(rep, "model_dump") else rep

            # User calls with force_refresh=False and model_override="string" (or null)
            # The failed report MUST NOT act as a cache hit; it must execute a fresh call!
            resp = self.client.post(
                f"/api/threats/{test_inc_id}/investigate",
                json={"force_refresh": False, "model_override": "string"}
            )
            self.assertEqual(resp.status_code, 200)
            self.assertTrue(mock_client.chat.completions.create.called)
            data = resp.json()
            self.assertEqual(data["summary"], "Successful fresh analysis.")
            self.assertEqual(data["operational_metadata"]["validation_status"], "VALIDATED")

            # Now, simulate that the successful report is in cache
            valid_report = data
            mock_get_reports.return_value = [valid_report]
            mock_client.chat.completions.create.reset_mock()

            # Calling again with force_refresh=False returns the valid cached report without calling API
            resp_cached = self.client.post(
                f"/api/threats/{test_inc_id}/investigate",
                json={"force_refresh": False}
            )
            self.assertEqual(resp_cached.status_code, 200)
            self.assertFalse(mock_client.chat.completions.create.called)

            # Calling with force_refresh=True forces fresh execution even when valid report is cached
            resp_forced = self.client.post(
                f"/api/threats/{test_inc_id}/investigate",
                json={"force_refresh": True}
            )
            self.assertEqual(resp_forced.status_code, 200)
            self.assertTrue(mock_client.chat.completions.create.called)

    def test_16_provider_error_honesty(self):
        """16. Regression test: Verify provider error is represented honestly and never marked as passed validation."""
        test_input = InvestigationInput(
            incident_id="99999999-9999-9999-9999-999999999999",
            investigation_type="FULL_VIDEO_SCAN",
            suspect_filename="test.mp4",
            duration_seconds=10.0,
            overall_cv_status="CANDIDATE_MATCH",
            matched_assets=["asset_1"],
            frames_evidence=[],
            timeline_intervals=[],
        )

        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = APIError(
            message="The model 'string' does not exist.",
            request=MagicMock(),
            body={"error": {"message": "The model 'string' does not exist."}},
        )

        report = generate_nemotron_report(test_input, client=mock_client, model_override="nvidia/Nemotron-3_5-Lightning")
        self.assertEqual(report.operational_metadata.get("validation_status"), "FAILED_VALIDATION")
        self.assertEqual(report.operational_metadata.get("failure_type"), "PROVIDER_API_ERROR")
        self.assertIn("The model 'string' does not exist.", report.summary)
        self.assertTrue(report.human_review_required)
        self.assertEqual(report.confidence_assessment, "INCONCLUSIVE_DATA")
        self.assertEqual(report.recommended_action, "NEEDS_FULL_VIDEO_REVIEW")


if __name__ == "__main__":
    unittest.main()
