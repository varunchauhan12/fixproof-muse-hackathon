"""
Unit and integration tests for Stage 1C: Temporal Multimodal Video Investigation.
Tests candidate-pair keyframe selection, deterministic bounding, role and timestamp preservation,
SAM 3.1 grounding and fault tolerance, Wonder multimodal request construction,
mask structure validation, and pipeline isolation.
"""

from io import BytesIO
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import httpx2
from openai import OpenAI
from PIL import Image

from app.evidence_models import (
    InvestigationInput,
    FrameEvidence,
    TimelineInterval,
    InvestigationReport,
)
from app.providers import meta_client, factory as provider_factory
from app.providers.meta import MetaReasoningProvider, MetaVisionProvider
from app.providers.sam import MetaSAMProvider, validate_mask_payload
from app.providers.sam_models import (
    BoundingBox,
    SegmentationMask,
    SegmentedObject,
    SegmentationResult,
)
from app.temporal_selector import (
    select_investigation_keyframes,
    ground_candidate_frames_with_sam,
    build_multimodal_frame_items,
)


def create_sample_jpeg_bytes(w=64, h=64, color="blue") -> bytes:
    img = Image.new("RGB", (w, h), color=color)
    buf = BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


class TestTemporalMultimodal(unittest.TestCase):
    def setUp(self):
        meta_client.get_meta_sdk_client.cache_clear()
        self.env = patch.dict(os.environ, {
            "FIXPROOF_AI_PROVIDER": "muse",
            "MODEL_API_KEY": "dummy-stage1c-secret",
            "MUSE_BASE_URL": "https://api.meta.ai/v1",
            "MUSE_REASONING_MODEL": "muse-wonder-1.0",
            "MUSE_VISION_MODEL": "muse-spark-1.3",
            "MUSE_SAM_MODEL": "sam-3.1",
        })
        self.env.start()
        self.calls = []
        self.status = 200
        self.failure = None
        self.content = json.dumps({
            "summary": "Multi-frame visual correspondence detected between suspect and reference broadcasts.",
            "recommended_action": "ESCALATE_LEGAL_TAKEDOWN",
            "confidence_assessment": "HIGH_CONFIDENCE_MATCH",
            "findings": [
                {
                    "finding_id": "F-01",
                    "category": "TIMELINE_CORRESPONDENCE",
                    "statement": "Identical player movement and overlay graphics match between suspect frame at 5.0s and reference broadcast.",
                    "evidence_ids": ["frame_1_t5s"],
                }
            ],
            "unresolved_questions": [],
            "contradictions_detected": [],
            "limitations_disclosed": ["Analysis based on sampled video keyframes."],
            "evidence_references": ["frame_1_t5s"],
        })

        def transport(request):
            self.calls.append(request)
            if self.failure:
                raise self.failure("dummy-stage1c-secret", request=request)
            if self.status != 200:
                return httpx2.Response(
                    self.status,
                    json={"error": {"message": "provider_error", "type": "provider_error"}},
                )
            # Differentiate between responses endpoint (SAM) and chat/completions (Wonder)
            url_str = str(request.url)
            if "responses" in url_str:
                return httpx2.Response(
                    200,
                    json={
                        "id": "resp_sam_1c",
                        "status": "completed",
                        "model": "sam-3.1",
                        "output_text": "<0f>0<|box;x1=10;y1=10;x2=50;y2=50;w=64;h=64|><|mask;x=0;y=0;data=40,40,~payload_data|>",
                    },
                )
            return httpx2.Response(
                200,
                json={
                    "id": "resp_wonder_1c",
                    "object": "chat.completion",
                    "model": "muse-wonder-1.0",
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": self.content},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {"prompt_tokens": 120, "completion_tokens": 80, "total_tokens": 200},
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

    # 1. Candidate-Pair Frame Selection
    def test_candidate_pair_selection_ranks_and_filters(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            p1 = Path(tmp_dir) / "frame_0005s.jpg"
            p2 = Path(tmp_dir) / "frame_0010s.jpg"
            p1.write_bytes(create_sample_jpeg_bytes(64, 64, "red"))
            p2.write_bytes(create_sample_jpeg_bytes(64, 64, "green"))

            incident = {
                "incident_id": "inc-test-1c",
                "frame_matches": [
                    {
                        "submitted_frame": {"frame_index": 1, "timestamp_sec": 5.0, "frame_path": str(p1)},
                        "best_match": {
                            "source_asset_id": "asset-broadcast",
                            "source_frame_id": 101,
                            "source_timestamp_sec": 5.0,
                            "l2_distance": 0.15,
                            "phash_score": 92.0,
                            "source_frame_path": str(p1),
                        },
                    },
                    {
                        "submitted_frame": {"frame_index": 2, "timestamp_sec": 10.0, "frame_path": str(p2)},
                        "best_match": {
                            "source_asset_id": "asset-broadcast",
                            "source_frame_id": 102,
                            "source_timestamp_sec": 10.0,
                            "l2_distance": 0.35,
                            "phash_score": 80.0,
                            "source_frame_path": str(p2),
                        },
                    },
                    {
                        # Low-entropy match should be filtered out
                        "submitted_frame": {"frame_index": 3, "timestamp_sec": 15.0, "frame_path": str(p1)},
                        "best_match": {
                            "source_asset_id": "asset-broadcast",
                            "l2_distance": 0.10,
                            "low_entropy_flag": True,
                        },
                    },
                ],
            }

            pairs = select_investigation_keyframes(incident, max_pairs=3)
            self.assertEqual(len(pairs), 2)
            # Verify top rank was picked first
            self.assertEqual(pairs[0]["evidence_id"], "frame_1_t5s")
            self.assertIsNotNone(pairs[0]["suspect_image_bytes"])
            self.assertIsNotNone(pairs[0]["reference_image_bytes"])

    # 2. Reference & Suspect Role and Timestamp Preservation
    def test_role_and_timestamp_preservation(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            p = Path(tmp_dir) / "frame_0007s.jpg"
            p.write_bytes(create_sample_jpeg_bytes(64, 64))

            incident = {
                "incident_id": "inc-role-test",
                "frame_matches": [
                    {
                        "submitted_frame": {"frame_index": 5, "timestamp_sec": 7.5, "frame_path": str(p)},
                        "best_match": {
                            "source_asset_id": "ref-asset-42",
                            "source_frame_id": 88,
                            "source_timestamp_sec": 12.0,
                            "l2_distance": 0.2,
                            "source_frame_path": str(p),
                        },
                    }
                ],
            }
            pairs = select_investigation_keyframes(incident, max_pairs=1)
            items = build_multimodal_frame_items(pairs, incident_id="inc-role-test", max_items=6)

            self.assertEqual(len(items), 2)
            self.assertEqual(items[0]["frame_type"], "suspect")
            self.assertEqual(items[0]["timestamp_sec"], 7.5)
            self.assertEqual(items[0]["asset_id"], "inc-role-test")

            self.assertIn("reference", items[1]["frame_type"])
            self.assertEqual(items[1]["timestamp_sec"], 12.0)
            self.assertEqual(items[1]["asset_id"], "ref-asset-42")

    # 3. Bounded Frame Ceilings (<=3 pairs, <=6 frames)
    def test_bounded_frame_ceilings(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            p = Path(tmp_dir) / "f.jpg"
            p.write_bytes(create_sample_jpeg_bytes(64, 64))

            # Create 10 candidate pairs
            matches = [
                {
                    "submitted_frame": {"frame_index": i, "timestamp_sec": float(i * 5), "frame_path": str(p)},
                    "best_match": {
                        "source_asset_id": "asset-1",
                        "source_frame_id": i,
                        "source_timestamp_sec": float(i * 5),
                        "l2_distance": 0.2 + (i * 0.01),
                        "source_frame_path": str(p),
                    },
                }
                for i in range(10)
            ]
            incident = {"incident_id": "inc-bound-test", "frame_matches": matches}
            pairs = select_investigation_keyframes(incident, max_pairs=3)
            self.assertLessEqual(len(pairs), 3)

            items = build_multimodal_frame_items(pairs, max_items=6)
            self.assertLessEqual(len(items), 6)

    # 4. SAM 3.1 Grounding on Selected Frames
    def test_sam_grounding_integration(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            p = Path(tmp_dir) / "f.jpg"
            p.write_bytes(create_sample_jpeg_bytes(64, 64))

            incident = {
                "incident_id": "inc-sam-ground",
                "frame_matches": [
                    {
                        "submitted_frame": {"frame_index": 1, "timestamp_sec": 5.0, "frame_path": str(p)},
                        "best_match": {
                            "source_asset_id": "asset-1",
                            "source_frame_id": 1,
                            "source_timestamp_sec": 5.0,
                            "l2_distance": 0.2,
                            "source_frame_path": str(p),
                        },
                    }
                ],
            }
            pairs = select_investigation_keyframes(incident, max_pairs=1)
            grounded = ground_candidate_frames_with_sam(pairs, prompt="player jersey", max_sam_calls=1)
            self.assertEqual(len(grounded), 1)
            self.assertIn("sam_segmentation", grounded[0])
            sam_res = grounded[0]["sam_segmentation"]
            self.assertEqual(sam_res["validation_status"], "VALIDATED")
            self.assertEqual(sam_res["model_id"], "sam-3.1")
            self.assertEqual(len(sam_res["objects"]), 1)

    # 5. Optional SAM Failure Does Not Abort Investigation
    def test_optional_sam_failure_gracefully_degrades(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            p = Path(tmp_dir) / "f.jpg"
            p.write_bytes(create_sample_jpeg_bytes(64, 64))

            incident = {
                "incident_id": "inc-sam-fail",
                "frame_matches": [
                    {
                        "submitted_frame": {"frame_index": 1, "timestamp_sec": 5.0, "frame_path": str(p)},
                        "best_match": {
                            "source_asset_id": "asset-1",
                            "source_frame_id": 1,
                            "source_timestamp_sec": 5.0,
                            "l2_distance": 0.2,
                            "source_frame_path": str(p),
                        },
                    }
                ],
            }
            pairs = select_investigation_keyframes(incident, max_pairs=1)

            # Simulate SAM provider failure
            with patch("app.providers.sam.MetaSAMProvider.segment_frame", side_effect=RuntimeError("SAM timeout")):
                grounded = ground_candidate_frames_with_sam(pairs, max_sam_calls=1)
                self.assertEqual(len(grounded), 1)
                self.assertEqual(grounded[0]["sam_segmentation"]["validation_status"], "FAILED_VALIDATION")

    # 6. Multimodal Wonder Request Construction with Real Images
    def test_multimodal_wonder_request_construction(self):
        provider = MetaReasoningProvider()
        inv_input = InvestigationInput(
            incident_id="inc-wonder-multi",
            investigation_type="FULL_VIDEO_SCAN",
            overall_cv_status="CANDIDATE_MATCH",
            frames_evidence=[
                FrameEvidence(evidence_id="frame_1_t5s", suspect_timestamp_sec=5.0, suspect_frame_idx=1)
            ],
            timeline_intervals=[
                TimelineInterval(
                    interval_id="int-01",
                    source_asset_id="asset-1",
                    suspect_start_sec=5.0,
                    suspect_end_sec=5.0,
                    source_start_sec=5.0,
                    source_end_sec=5.0,
                    duration_sec=0.0,
                    frame_count=1,
                    mean_l2_distance=0.2,
                    min_l2_distance=0.2,
                    phash_match_ratio=1.0,
                    evidence_ids=["frame_1_t5s"],
                )
            ],
        )

        frame_items = [
            {
                "image_bytes": create_sample_jpeg_bytes(64, 64, "red"),
                "evidence_id": "frame_1_t5s",
                "timestamp_sec": 5.0,
                "frame_type": "suspect",
                "asset_id": "inc-wonder-multi",
            },
            {
                "image_bytes": create_sample_jpeg_bytes(64, 64, "blue"),
                "evidence_id": "ref_1_t5s",
                "timestamp_sec": 5.0,
                "frame_type": "reference",
                "asset_id": "asset-1",
            },
        ]

        report = provider.generate_investigation_report(inv_input, frame_images=frame_items)
        self.assertEqual(report.summary, "Multi-frame visual correspondence detected between suspect and reference broadcasts.")
        self.assertEqual(report.model_id, "muse-wonder-1.0")
        self.assertTrue(report.operational_metadata["is_multimodal"])
        self.assertEqual(report.operational_metadata["multimodal_frames_count"], 2)

        # Inspect raw request content passed to Meta client
        req = json.loads(self.calls[0].content)
        self.assertEqual(req["model"], "muse-wonder-1.0")
        user_parts = req["messages"][1]["content"]
        self.assertIsInstance(user_parts, list)
        # Verify text prompt followed by image objects
        self.assertEqual(user_parts[0]["type"], "text")
        self.assertEqual(user_parts[1]["type"], "text")
        self.assertIn("frame_1_t5s", user_parts[1]["text"])
        self.assertEqual(user_parts[2]["type"], "image_url")
        self.assertTrue(user_parts[2]["image_url"]["url"].startswith("data:image/jpeg;base64,"))

    # 7. Mask Payload Structure Validation
    def test_mask_structure_validation(self):
        valid_mask = SegmentationMask(
            x=0, y=0, height=32, width=32, encoding="lossless_base85", raw_payload="~abc123payload"
        )
        res = validate_mask_payload(valid_mask)
        self.assertTrue(res["is_valid"])
        self.assertEqual(res["decoding_status"], "RAW_PRESERVED_VERIFIED")

        invalid_mask = SegmentationMask(
            x=0, y=0, height=0, width=0, encoding="unknown", raw_payload=""
        )
        res_inv = validate_mask_payload(invalid_mask)
        self.assertFalse(res_inv["is_valid"])
        self.assertIn("Invalid mask dimensions: 0x0", res_inv["errors"])

    # 8. Wonder Failure Handling
    def test_wonder_failure_produces_failed_report(self):
        provider = MetaReasoningProvider()
        self.status = 500
        inv_input = InvestigationInput(
            incident_id="inc-wonder-fail",
            investigation_type="FULL_VIDEO_SCAN",
            overall_cv_status="CLEAN",
        )
        report = provider.generate_investigation_report(inv_input)
        self.assertEqual(report.operational_metadata["validation_status"], "FAILED_VALIDATION")
        self.assertEqual(report.operational_metadata["failure_type"], "PROVIDER_API_ERROR")

    # 9. Model Separation & Pipeline Isolation
    def test_model_separation_and_provenance(self):
        reasoning_provider = provider_factory.get_reasoning_provider()
        vision_provider = provider_factory.get_vision_provider()
        sam_provider = provider_factory.get_segmentation_provider()

        self.assertEqual(reasoning_provider.model_id, "muse-wonder-1.0")
        self.assertEqual(vision_provider.model_id, "muse-spark-1.3")
        self.assertEqual(sam_provider.model_id, "sam-3.1")


if __name__ == "__main__":
    unittest.main()

