"""
Unit and contract tests for Stage 1B: SAM 3.1 Specialist Perception Integration.
Tests SAM configuration, Responses API request construction, token grammar parsing,
bounding box normalization, mask extraction, tracking IDs, error taxonomy,
and pipeline isolation (ensuring Wonder, Spark, and CV remain unchanged).
"""

import io
import json
import os
import unittest
from unittest.mock import patch, MagicMock

import httpx2
from openai import OpenAI
from PIL import Image

from app.providers import meta_client, factory as provider_factory
from app.providers.base import BaseSegmentationProvider
from app.providers.sam import MetaSAMProvider, parse_sam_grammar, segment_candidate_frame
from app.providers.sam_models import (
    BoundingBox,
    SegmentationMask,
    SegmentedObject,
    SegmentationResult,
)


def create_test_image_bytes(width=64, height=64, color="white"):
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


class TestSAMProvider(unittest.TestCase):
    def setUp(self):
        meta_client.get_meta_sdk_client.cache_clear()
        self.env = patch.dict(os.environ, {
            "FIXPROOF_AI_PROVIDER": "muse",
            "MODEL_API_KEY": "dummy-sam-secret",
            "MUSE_BASE_URL": "https://api.meta.ai/v1",
            "MUSE_SAM_MODEL": "sam-3.1",
            "MUSE_VISION_MODEL": "muse-spark-1.3",
            "MUSE_REASONING_MODEL": "muse-wonder-1.0",
        })
        self.env.start()
        self.calls = []
        self.status = 200
        self.failure = None
        self.output_text = "<0f>0<|box;x1=16;y1=16;x2=47;y2=47;w=64;h=64|><|mask;x=0;y=0;data=32,32,~payload_data|>"

        def transport(request):
            self.calls.append(request)
            if self.failure:
                raise self.failure("dummy-sam-secret", request=request)
            if self.status != 200:
                return httpx2.Response(
                    self.status,
                    json={"error": {"message": "dummy-sam-error", "type": "provider_error"}},
                )
            return httpx2.Response(
                200,
                json={
                    "id": "resp_mock_sam_123",
                    "object": "response",
                    "model": "sam-3.1",
                    "status": "completed",
                    "output": [
                        {
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": self.output_text,
                                }
                            ],
                        }
                    ],
                    "output_text": self.output_text,
                    "usage": {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150},
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

    # 1. SAM Model Configuration
    def test_sam_model_configuration(self):
        provider = MetaSAMProvider()
        self.assertEqual(provider.provider_name, "muse")
        self.assertEqual(provider.model_id, "sam-3.1")
        self.assertIsInstance(provider, BaseSegmentationProvider)

    # 2. Factory Resolution
    def test_factory_resolves_sam_provider(self):
        provider = provider_factory.get_segmentation_provider()
        self.assertIsInstance(provider, MetaSAMProvider)
        self.assertEqual(provider.model_id, "sam-3.1")

    # 3. Request Construction and Meta API Responses Payload
    def test_sam_request_construction(self):
        provider = MetaSAMProvider()
        img_bytes = create_test_image_bytes(64, 64)
        result = provider.segment_frame(
            img_bytes,
            prompt="white square",
            metadata={"evidence_id": "ev-01", "timestamp_sec": 5.0, "frame_index": 2},
        )
        self.assertEqual(len(self.calls), 1)
        req = self.calls[0]
        self.assertEqual(str(req.url), "https://api.meta.ai/v1/responses")
        self.assertEqual(req.headers["authorization"], "Bearer dummy-sam-secret")
        
        body = json.loads(req.content)
        self.assertEqual(body["model"], "sam-3.1")
        self.assertFalse(body["stream"])
        self.assertEqual(len(body["input"]), 1)
        user_content = body["input"][0]["content"]
        self.assertEqual(user_content[0]["type"], "input_text")
        self.assertEqual(user_content[0]["text"], "white square")
        self.assertEqual(user_content[1]["type"], "input_image")
        self.assertTrue(user_content[1]["image_url"].startswith("data:image/jpeg;base64,"))

        self.assertEqual(result.validation_status, "VALIDATED")
        self.assertEqual(result.evidence_id, "ev-01")
        self.assertEqual(result.timestamp_sec, 5.0)
        self.assertEqual(result.frame_index, 2)
        self.assertEqual(result.model_id, "sam-3.1")
        self.assertEqual(len(result.objects), 1)

    # 4. Grammar Parsing - Box & Coordinates
    def test_grammar_parsing_box_and_normalization(self):
        raw = "<0f>0<|box;x1=16;y1=16;x2=48;y2=48;w=64;h=64|><|mask;x=0;y=0;data=32,32,~mask_bytes|>"
        objs = parse_sam_grammar(raw, default_label="test_concept")
        self.assertEqual(len(objs), 1)
        obj = objs[0]
        self.assertEqual(obj.object_id, 0)
        self.assertEqual(obj.tracking_id, 0)
        self.assertEqual(obj.label, "test_concept")
        self.assertEqual(obj.box.x1, 16.0)
        self.assertEqual(obj.box.y1, 16.0)
        self.assertEqual(obj.box.x2, 48.0)
        self.assertEqual(obj.box.y2, 48.0)
        self.assertEqual(obj.box.w, 64)
        self.assertEqual(obj.box.h, 64)
        self.assertEqual(obj.box.normalized_coords, [0.25, 0.25, 0.75, 0.75])

    # 5. Grammar Parsing - Mask
    def test_grammar_parsing_mask_attributes(self):
        raw = "<0f>1<|box;x1=10;y1=20;x2=30;y2=40;w=100;h=100|><|mask;x=5;y=10;data=20,20,~lossless_payload|>"
        objs = parse_sam_grammar(raw)
        self.assertEqual(len(objs), 1)
        mask = objs[0].mask
        self.assertIsNotNone(mask)
        self.assertEqual(mask.x, 5)
        self.assertEqual(mask.y, 10)
        self.assertEqual(mask.height, 20)
        self.assertEqual(mask.width, 20)
        self.assertEqual(mask.encoding, "lossless_base85")
        self.assertEqual(mask.raw_payload, "lossless_payload")

    # 6. Multi-Object Detection & Tracking IDs
    def test_multi_object_parsing(self):
        raw = "<0f>0<|box;x1=5;y1=5;x2=20;y2=20;w=100;h=100|><|mask;data=15,15,~mask0|>,1<|box;x1=50;y1=50;x2=80;y2=80;w=100;h=100|><|mask;data=30,30,!mask1|>"
        objs = parse_sam_grammar(raw, default_label="logo")
        self.assertEqual(len(objs), 2)
        self.assertEqual(objs[0].object_id, 0)
        self.assertEqual(objs[0].tracking_id, 0)
        self.assertEqual(objs[0].mask.encoding, "lossless_base85")
        self.assertEqual(objs[1].object_id, 1)
        self.assertEqual(objs[1].tracking_id, 1)
        self.assertEqual(objs[1].mask.encoding, "1bit_base85")

    # 7. No Objects Detected Handling
    def test_no_objects_detected_handling(self):
        provider = MetaSAMProvider()
        self.output_text = ""
        img_bytes = create_test_image_bytes(64, 64)
        result = provider.segment_frame(img_bytes, prompt="nonexistent item")
        self.assertEqual(result.validation_status, "NO_OBJECTS_DETECTED")
        self.assertEqual(len(result.objects), 0)
        self.assertEqual(result.model_id, "sam-3.1")

    # 8. Empty Prompt Validation
    def test_empty_prompt_rejected(self):
        provider = MetaSAMProvider()
        img_bytes = create_test_image_bytes(64, 64)
        result = provider.segment_frame(img_bytes, prompt="   ")
        self.assertEqual(result.validation_status, "FAILED_VALIDATION")
        self.assertEqual(result.operational_metadata["failure_type"], "EMPTY_PROMPT")
        self.assertEqual(len(self.calls), 0)

    # 9. Invalid Image Validation
    def test_invalid_image_rejected(self):
        provider = MetaSAMProvider()
        result = provider.segment_frame(b"corrupt non-image bytes", prompt="detect")
        self.assertEqual(result.validation_status, "FAILED_VALIDATION")
        self.assertEqual(result.operational_metadata["failure_type"], "INVALID_IMAGE")
        self.assertEqual(len(self.calls), 0)

    # 10. Timeout and Rate Limit Handling
    def test_timeout_and_rate_limit_handling(self):
        provider = MetaSAMProvider()
        img_bytes = create_test_image_bytes(64, 64)
        for failure_cls, category in (
            (httpx2.ReadTimeout, "API_TIMEOUT"),
            (httpx2.ConnectError, "CONNECTION_ERROR"),
        ):
            self.calls.clear()
            self.failure = failure_cls
            result = provider.segment_frame(img_bytes, prompt="test")
            self.assertEqual(result.validation_status, "FAILED_VALIDATION")
            self.assertEqual(result.operational_metadata["failure_type"], category)

        self.failure = None
        self.status = 429
        result = provider.segment_frame(img_bytes, prompt="test")
        self.assertEqual(result.validation_status, "FAILED_VALIDATION")
        self.assertEqual(result.operational_metadata["failure_type"], "RATE_LIMIT_EXCEEDED")

    # 11. Model Override Isolation & Rejection
    def test_invalid_model_override_rejection(self):
        provider = MetaSAMProvider()
        img_bytes = create_test_image_bytes(64, 64)
        result = provider.segment_frame(
            img_bytes,
            prompt="test",
            model_override="nvidia/Nemotron-3.5-Super-VL",
        )
        self.assertEqual(result.validation_status, "FAILED_VALIDATION")
        self.assertEqual(result.operational_metadata["failure_type"], "INVALID_MODEL_OVERRIDE")
        self.assertEqual(len(self.calls), 0)

    # 12. Candidate Frame Helper
    def test_segment_candidate_frame_helper(self):
        img_bytes = create_test_image_bytes(64, 64)
        result = segment_candidate_frame(
            img_bytes,
            prompt="patch",
            metadata={"incident_id": "inc-01", "frame_index": 5},
        )
        self.assertEqual(result.validation_status, "VALIDATED")
        self.assertEqual(result.incident_id, "inc-01")
        self.assertEqual(result.frame_index, 5)

    # 13. Pipeline Isolation: Wonder and Spark Configurations Unchanged
    def test_wonder_and_spark_configurations_intact(self):
        reasoning_prov = provider_factory.get_reasoning_provider()
        vision_prov = provider_factory.get_vision_provider()
        sam_prov = provider_factory.get_segmentation_provider()

        self.assertEqual(reasoning_prov.model_id, "muse-wonder-1.0")
        self.assertEqual(vision_prov.model_id, "muse-spark-1.3")
        self.assertEqual(sam_prov.model_id, "sam-3.1")


if __name__ == "__main__":
    unittest.main()

