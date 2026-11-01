"""
Unit and integration tests for Stage 1A: Muse Wonder 1.0 Primary Reasoning Integration.
Tests model configuration, Spark rollback, multimodal & text request construction,
structured output validation, error taxonomy, failure handling, and provenance integrity.
"""

import io
import json
import os
import unittest
from unittest.mock import MagicMock, patch

from PIL import Image
from pydantic import BaseModel
import httpx2
from openai import OpenAI

from app.providers import meta_client, factory as provider_factory
from app.providers.meta import MetaReasoningProvider, MetaVisionProvider
from app.evidence_models import InvestigationInput, FrameEvidence, TimelineInterval


class TestWonderProvider(unittest.TestCase):
    def setUp(self):
        meta_client.get_meta_sdk_client.cache_clear()
        self.env = patch.dict(os.environ, {
            "FIXPROOF_AI_PROVIDER": "muse",
            "MODEL_API_KEY": "dummy-wonder-secret",
            "MUSE_BASE_URL": "https://api.meta.ai/v1",
            "MUSE_VISION_MODEL": "muse-spark-1.3",
            "MUSE_REASONING_MODEL": "muse-wonder-1.0",
        })
        self.env.start()
        self.calls = []
        self.status = 200
        self.failure = None
        self.content = "sample wonder completion"
        self.finish = "stop"

        def transport(request):
            self.calls.append(request)
            if self.failure:
                raise self.failure("dummy-wonder-secret", request=request)
            if self.status != 200:
                return httpx2.Response(
                    self.status,
                    json={"error": {"message": "dummy-wonder-secret", "type": "provider_error"}},
                )
            return httpx2.Response(
                200,
                json={
                    "id": "mock-wonder-resp",
                    "object": "chat.completion",
                    "created": 1,
                    "model": "muse-wonder-1.0",
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": self.content},
                            "finish_reason": self.finish,
                        }
                    ],
                    "usage": {"prompt_tokens": 15, "completion_tokens": 25, "total_tokens": 40},
                },
            )

        self.transport = httpx2.Client(transport=httpx2.MockTransport(transport))

        def client(**kwargs):
            return OpenAI(**kwargs, http_client=self.transport)

        self.sdk = patch.object(meta_client, "OpenAI", side_effect=client)
        self.sdk.start()

    def tearDown(self):
        self.sdk.stop()
        self.env.stop()
        meta_client.get_meta_sdk_client.cache_clear()

    # 1. Wonder model configuration
    def test_wonder_model_default_configuration(self):
        provider = MetaReasoningProvider()
        self.assertEqual(provider.provider_name, "muse")
        self.assertEqual(provider.model_id, "muse-wonder-1.0")

    # 2. Spark rollback configuration
    def test_spark_rollback_configuration(self):
        with patch.dict(os.environ, {"MUSE_REASONING_MODEL": "muse-spark-1.3"}):
            provider = MetaReasoningProvider()
            self.assertEqual(provider.model_id, "muse-spark-1.3")

    # 3. Correct request construction
    def test_correct_wonder_request_construction(self):
        provider = MetaReasoningProvider()
        response = provider.create_text_completion({
            "messages": [{"role": "user", "content": "Analyze evidence"}]
        })
        self.assertEqual(len(self.calls), 1)
        req = self.calls[0]
        self.assertEqual(str(req.url), "https://api.meta.ai/v1/chat/completions")
        self.assertEqual(req.headers["authorization"], "Bearer dummy-wonder-secret")
        req_body = json.loads(req.content)
        self.assertEqual(req_body["model"], "muse-wonder-1.0")
        self.assertEqual(response.choices[0].message.content, self.content)

    # 4. Multimodal message construction where supported
    def test_multimodal_message_construction(self):
        provider = MetaReasoningProvider()
        img = Image.new("RGB", (640, 480), color=(10, 20, 30))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        frame_items = [
            {"image_bytes": buf.getvalue(), "evidence_id": "ev-101", "timestamp_sec": 5.0, "frame_type": "suspect"},
            {"image_bytes": buf.getvalue(), "evidence_id": "ev-102", "timestamp_sec": 10.0, "frame_type": "reference", "asset_id": "asset-99"},
        ]
        msg = provider.build_multimodal_message("Observe suspect and reference frames", frame_items=frame_items)
        self.assertEqual(msg["role"], "user")
        content = msg["content"]
        self.assertIsInstance(content, list)
        self.assertEqual(content[0]["text"], "Observe suspect and reference frames")
        self.assertIn("ev-101", content[1]["text"])
        self.assertTrue(content[2]["image_url"]["url"].startswith("data:image/jpeg;base64,"))
        self.assertIn("asset-99", content[3]["text"])
        self.assertTrue(content[4]["image_url"]["url"].startswith("data:image/jpeg;base64,"))

    # 5. Text-only backward compatibility
    def test_text_only_backward_compatibility(self):
        provider = MetaReasoningProvider()
        msg_none = provider.build_multimodal_message("Plain text prompt", frame_items=None)
        self.assertEqual(msg_none, {"role": "user", "content": "Plain text prompt"})
        msg_empty = provider.build_multimodal_message("Plain text prompt", frame_items=[])
        self.assertEqual(msg_empty, {"role": "user", "content": "Plain text prompt"})

    # 6. Structured JSON response parsing
    def test_structured_json_response_parsing(self):
        provider = MetaReasoningProvider()
        valid_report = {
            "summary": "Verified visual overlap detected at 5.0s.",
            "recommended_action": "ESCALATE_LEGAL_TAKEDOWN",
            "confidence_assessment": "HIGH_CONFIDENCE_MATCH",
            "findings": [
                {
                    "finding_id": "F-01",
                    "category": "TIMELINE_CORRESPONDENCE",
                    "statement": "Matching player action at 5.0s",
                    "evidence_ids": ["ev-01"],
                }
            ],
        }
        self.content = json.dumps(valid_report)
        inv_input = InvestigationInput(
            incident_id="inc-wonder-test",
            investigation_type="FULL_VIDEO_SCAN",
            overall_cv_status="CANDIDATE_MATCH",
            frames_evidence=[
                FrameEvidence(
                    evidence_id="ev-01",
                    suspect_timestamp_sec=5.0,
                    suspect_frame_idx=1,
                    source_asset_id="ref-01",
                )
            ],
            timeline_intervals=[
                TimelineInterval(
                    interval_id="int-01",
                    source_asset_id="ref-01",
                    suspect_start_sec=5.0,
                    suspect_end_sec=5.0,
                    source_start_sec=5.0,
                    source_end_sec=5.0,
                    duration_sec=0.0,
                    frame_count=1,
                    mean_l2_distance=0.1,
                    min_l2_distance=0.1,
                    phash_match_ratio=1.0,
                    evidence_ids=["ev-01"],
                )
            ],
        )
        report = provider.generate_investigation_report(inv_input)
        self.assertEqual(report.summary, "Verified visual overlap detected at 5.0s.")
        self.assertEqual(report.model_id, "muse-wonder-1.0")
        self.assertEqual(report.operational_metadata["model_id"], "muse-wonder-1.0")
        self.assertFalse(report.operational_metadata["is_fallback"])
        self.assertEqual(report.operational_metadata["validation_status"], "VALIDATED")

    # 7. Invalid or malformed model responses
    def test_invalid_or_malformed_model_responses(self):
        provider = MetaReasoningProvider()
        self.content = "Malformed plain text non-json content"
        inv_input = InvestigationInput(
            incident_id="inc-err-test",
            investigation_type="FULL_VIDEO_SCAN",
            overall_cv_status="CLEAN",
        )
        report = provider.generate_investigation_report(inv_input)
        self.assertEqual(report.operational_metadata["validation_status"], "FAILED_VALIDATION")
        self.assertEqual(report.operational_metadata["failure_type"], "INVALID_REPORT_RESPONSE")
        self.assertIn("INVALID_REPORT_RESPONSE", report.operational_metadata["errors"][0])

    # 8. Timeout and provider failure handling
    def test_timeout_and_provider_failure_handling(self):
        provider = MetaReasoningProvider()
        inv_input = InvestigationInput(
            incident_id="inc-timeout-test",
            investigation_type="FULL_VIDEO_SCAN",
            overall_cv_status="CLEAN",
        )
        for failure_cls, category in (
            (httpx2.ReadTimeout, "API_TIMEOUT"),
            (httpx2.ConnectError, "CONNECTION_ERROR"),
        ):
            self.calls.clear()
            self.failure = failure_cls
            report = provider.generate_investigation_report(inv_input)
            self.assertEqual(report.operational_metadata["validation_status"], "FAILED_VALIDATION")
            self.assertEqual(report.operational_metadata["failure_type"], category)
            self.assertIn(category, report.operational_metadata["errors"][0])

    # 9. Correct actual-model provenance
    def test_correct_actual_model_provenance(self):
        provider = MetaReasoningProvider()
        self.assertEqual(provider.model_id, "muse-wonder-1.0")
        resp = provider.create_text_completion({"messages": [{"role": "user", "content": "ping"}]})
        req = json.loads(self.calls[0].content)
        self.assertEqual(req["model"], "muse-wonder-1.0")

    # 10. Evidence-ID validation in investigation reports
    def test_evidence_id_validation_in_investigation_reports(self):
        provider = MetaReasoningProvider()
        hallucinated_report = {
            "summary": "Hallucinated match citing non-existent evidence ID.",
            "recommended_action": "ESCALATE_LEGAL_TAKEDOWN",
            "confidence_assessment": "HIGH_CONFIDENCE_MATCH",
            "findings": [
                {
                    "finding_id": "F-01",
                    "category": "TIMELINE_CORRESPONDENCE",
                    "statement": "Fictitious frame match",
                    "evidence_ids": ["hallucinated-ev-999"],
                }
            ],
        }
        self.content = json.dumps(hallucinated_report)
        inv_input = InvestigationInput(
            incident_id="inc-hallucination-test",
            investigation_type="FULL_VIDEO_SCAN",
            overall_cv_status="CANDIDATE_MATCH",
            frames_evidence=[
                FrameEvidence(
                    evidence_id="ev-real-01",
                    suspect_timestamp_sec=5.0,
                    suspect_frame_idx=1,
                )
            ],
        )
        report = provider.generate_investigation_report(inv_input)
        self.assertEqual(report.operational_metadata["validation_status"], "FAILED_VALIDATION")
        self.assertEqual(report.operational_metadata["failure_type"], "INVALID_EVIDENCE_REFERENCES")
        self.assertIn("INVALID_EVIDENCE_REFERENCES", report.operational_metadata["errors"][0])

    # 11. No false Wonder provenance when another model produced the result
    def test_no_false_wonder_provenance_when_another_model_produced_result(self):
        provider = MetaReasoningProvider()
        valid_report = {
            "summary": "Spark rollback report.",
            "recommended_action": "DISMISS_FAIR_USE",
            "confidence_assessment": "INCONCLUSIVE_DATA",
            "findings": [],
        }
        self.content = json.dumps(valid_report)
        inv_input = InvestigationInput(
            incident_id="inc-spark-override",
            investigation_type="FULL_VIDEO_SCAN",
            overall_cv_status="CLEAN",
        )
        # Execute with model_override to muse-spark-1.3
        report = provider.generate_investigation_report(inv_input, model_override="muse-spark-1.3")
        req = json.loads(self.calls[0].content)
        self.assertEqual(req["model"], "muse-spark-1.3")
        self.assertEqual(report.model_id, "muse-spark-1.3")
        self.assertEqual(report.operational_metadata["model_id"], "muse-spark-1.3")
        self.assertTrue(report.operational_metadata["is_fallback"])
        # Confirm it NEVER claims muse-wonder-1.0
        self.assertNotEqual(report.model_id, "muse-wonder-1.0")

    # 12. Invalid model override rejection
    def test_invalid_model_override_rejection(self):
        provider = MetaReasoningProvider()
        inv_input = InvestigationInput(
            incident_id="inc-bad-override",
            investigation_type="FULL_VIDEO_SCAN",
            overall_cv_status="CLEAN",
        )
        report = provider.generate_investigation_report(inv_input, model_override="nvidia/Nemotron-3_5-Lightning")
        self.assertEqual(report.operational_metadata["validation_status"], "FAILED_VALIDATION")
        self.assertEqual(report.operational_metadata["failure_type"], "INVALID_MODEL_OVERRIDE")
        self.assertIn("INVALID_MODEL_OVERRIDE", report.operational_metadata["errors"][0])


if __name__ == "__main__":
    unittest.main()
