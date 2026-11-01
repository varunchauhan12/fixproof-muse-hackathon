"""Stage A contract checks using an in-memory HTTP transport and dummy credentials."""
import inspect
import io
import json
import os
import unittest
from unittest.mock import patch

import httpx2
from openai import OpenAI
from PIL import Image

from app.providers import factory, meta_client
from app.providers.base import BaseVisionProvider, BaseReasoningProvider
from app.providers.meta import MetaVisionProvider, MetaReasoningProvider
from app.providers.nemotron import NemotronReasoningProvider
from app.evidence_models import InvestigationInput


class TestMetaProvider(unittest.TestCase):
    def setUp(self):
        meta_client.get_meta_sdk_client.cache_clear()
        self.env = patch.dict(os.environ, {"MODEL_API_KEY": "dummy-meta-secret", "MUSE_BASE_URL": "https://api.meta.ai/v1", "MUSE_VISION_MODEL": "muse-spark-1.3", "MUSE_REASONING_MODEL": "muse-spark-1.3"})
        self.env.start()
        self.calls = []
        self.status = 200
        self.failure = None
        self.content = "sample completion"
        self.finish = "stop"
        def transport(request):
            self.calls.append(request)
            if self.failure:
                raise self.failure("dummy-meta-secret", request=request)
            if self.status != 200:
                return httpx2.Response(self.status, json={"error": {"message": "dummy-meta-secret", "type": "provider_error"}})
            return httpx2.Response(200, json={"id": "mock-response", "object": "chat.completion", "created": 1,
                "model": "muse-spark-1.3", "choices": [{"index": 0, "message": {"role": "assistant", "content": self.content}, "finish_reason": self.finish}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}})
        self.transport = httpx2.Client(transport=httpx2.MockTransport(transport))
        def client(**kwargs):
            return OpenAI(**kwargs, http_client=self.transport)
        self.sdk = patch.object(meta_client, "OpenAI", side_effect=client)
        self.sdk.start()

    def tearDown(self):
        meta_client.get_meta_sdk_client.cache_clear()
        self.sdk.stop()
        self.transport.close()
        self.env.stop()

    def text(self):
        return MetaReasoningProvider().create_text_completion({"messages": [{"role": "user", "content": "test"}]})

    def image(self):
        buffer = io.BytesIO()
        Image.new("RGB", (640, 400), "red").save(buffer, format="PNG")
        return buffer.getvalue()

    def vision(self):
        with patch("app.vision_verifier.get_cached_verification", return_value=None), patch("app.vision_verifier.store_cached_verification"):
            return MetaVisionProvider().verify_candidate_pair(self.image(), self.image(), {"timestamp_sec": 3}, {"timestamp_sec": 5, "asset_id": "ref"})

    def investigation(self):
        return InvestigationInput(incident_id="test-incident", investigation_type="URL_SCREENING", overall_cv_status="CLEAN")

    def report_payload(self):
        return {"summary": "Only preview evidence available", "recommended_action": "DISMISS_FAIR_USE", "confidence_assessment": "INCONCLUSIVE_DATA", "findings": []}

    def test_auth_base_url_and_text_request(self):
        response = self.text()
        request = self.calls[0]
        self.assertEqual(str(request.url), "https://api.meta.ai/v1/chat/completions")
        self.assertEqual(request.headers["authorization"], "Bearer dummy-meta-secret")
        self.assertEqual(json.loads(request.content)["model"], "muse-spark-1.3")
        self.assertEqual(response.choices[0].message.content, "sample completion")
        self.assertEqual(meta_client.get_meta_sdk_client().max_retries, 0)

    def test_configured_model_and_timeout(self):
        with patch.dict(os.environ, {"MUSE_REASONING_MODEL": "configured-model", "MUSE_TIMEOUT_SEC": "12"}):
            self.text()
            self.assertEqual(json.loads(self.calls[0].content)["model"], "configured-model")
            self.assertEqual(meta_client.get_meta_sdk_client().timeout, 12)

    def test_missing_key_never_attempts_http(self):
        with patch.dict(os.environ, {"MODEL_API_KEY": ""}):
            with self.assertRaises(meta_client.MetaAPIError) as error:
                self.text()
            self.assertEqual(error.exception.category, "CLIENT_INITIALIZATION_ERROR")
        self.assertEqual(self.calls, [])

    def test_timeout_connection_and_api_errors_are_safe_without_retries(self):
        for failure, status, category in ((httpx2.ReadTimeout, 200, "API_TIMEOUT"), (httpx2.ConnectError, 200, "CONNECTION_ERROR"), (None, 429, "RATE_LIMIT_EXCEEDED"), (None, 500, "PROVIDER_API_ERROR"), (None, 401, "PROVIDER_API_ERROR")):
            self.calls.clear()
            self.failure, self.status = failure, status
            with self.assertRaises(meta_client.MetaAPIError) as error:
                self.text()
            self.assertEqual(error.exception.category, category)
            self.assertNotIn("dummy-meta-secret", str(error.exception))
            self.assertEqual(len(self.calls), 1)

    def test_truncated_output_is_not_success(self):
        self.finish = "length"
        with self.assertRaises(meta_client.MetaAPIError) as error:
            self.text()
        self.assertEqual(error.exception.category, "TOKEN_BUDGET_EXHAUSTED")

    def test_vision_images_structured_output_and_normalization(self):
        self.content = json.dumps({"visual_correspondence": "HIGH_CORRESPONDENCE", "confidence_assessment": "HIGH", "matching_features": ["overlay"], "contradictions": [], "reasoning": "Shared overlay", "uncertainty_factors": []})
        result = self.vision()
        request = json.loads(self.calls[0].content)
        images = request["messages"][0]["content"][1:]
        self.assertEqual(len(images), 2)
        self.assertTrue(all(i["image_url"]["url"].startswith("data:image/jpeg;base64,") for i in images))
        self.assertEqual(request["response_format"]["type"], "json_schema")
        self.assertEqual(result["validation_status"], "VERIFIED")
        self.assertEqual(result["source_asset_id"], "ref")
        self.assertEqual(result["suspect_timestamp_sec"], 3)
        self.assertEqual(result["model_id"], "muse-spark-1.3")

    def test_invalid_or_failed_vision_is_unverified(self):
        for content in ("not JSON", '{"visual_correspondence":"CERTAIN"}'):
            self.content = content
            self.assertEqual(self.vision()["visual_correspondence"], "UNVERIFIED")
        self.status = 500
        result = self.vision()
        self.assertEqual(result["validation_status"], "VERIFICATION_UNAVAILABLE")
        self.assertNotIn("dummy-meta-secret", json.dumps(result))

    def test_vision_cache_is_model_and_prompt_isolated(self):
        from app.vision_verifier import compute_pair_cache_key
        self.assertNotEqual(compute_pair_cache_key(b"s", b"r", "muse-spark-1.3", "meta-vision-v1"), compute_pair_cache_key(b"s", b"r", "nvidia/Nemotron-3.5-Super-VL", "v1.1-forensic"))
        with patch("app.vision_verifier.get_cached_verification", return_value={"visual_correspondence": "UNRELATED_SCENE", "model_id": "muse-spark-1.3"}):
            result = MetaVisionProvider().verify_candidate_pair(self.image(), self.image())
            self.assertTrue(result["cached"])
        self.assertEqual(self.calls, [])

    def test_reasoning_contract_and_url_caveat(self):
        self.content = json.dumps(self.report_payload())
        result = MetaReasoningProvider().generate_investigation_report(self.investigation())
        self.assertEqual(result.incident_id, "test-incident")
        self.assertEqual(result.recommended_action, "NEEDS_FULL_VIDEO_REVIEW")
        self.assertTrue(result.human_review_required)
        self.assertEqual(result.operational_metadata["validation_status"], "VALIDATED")
        self.assertEqual(result.operational_metadata["total_tokens"], 30)

    def test_invented_evidence_and_provider_failure_return_failed_report(self):
        payload = self.report_payload()
        payload["findings"] = [{"finding_id": "f1", "category": "LIMITATION", "statement": "invented", "evidence_ids": ["nonexistent"]}]
        self.content = json.dumps(payload)
        result = MetaReasoningProvider().generate_investigation_report(self.investigation())
        self.assertEqual(result.operational_metadata["failure_type"], "INVALID_EVIDENCE_REFERENCES")
        self.status = 500
        result = MetaReasoningProvider().generate_investigation_report(self.investigation())
        self.assertEqual(result.operational_metadata["validation_status"], "FAILED_VALIDATION")
        self.assertNotIn("dummy-meta-secret", result.model_dump_json())

    def test_legacy_client_options_and_model_overrides_are_not_forwarded(self):
        for request, options in (({"messages": []}, {"api_key": "legacy-key"}), ({"model": "nvidia/Nemotron-3_5-Lightning", "messages": []}, None)):
            with self.assertRaises(meta_client.MetaAPIError):
                MetaReasoningProvider().create_text_completion(request, options)
        self.assertEqual(self.calls, [])

    def test_factory_opt_in_and_rollback(self):
        with patch.dict(os.environ, {"FIXPROOF_AI_PROVIDER": "muse"}):
            self.assertIsInstance(factory.get_vision_provider(), MetaVisionProvider)
            self.assertIsInstance(factory.get_reasoning_provider(), MetaReasoningProvider)
        with patch.dict(os.environ, {"FIXPROOF_AI_PROVIDER": "nemotron"}):
            self.assertIsInstance(factory.get_reasoning_provider(), NemotronReasoningProvider)
        self.assertEqual(factory._DEFAULT_PROVIDER, "nemotron")

    def test_provider_signatures_preserved(self):
        for base, adapter, method in ((BaseVisionProvider, MetaVisionProvider, "verify_candidate_pair"), (BaseReasoningProvider, MetaReasoningProvider, "generate_investigation_report"), (BaseReasoningProvider, MetaReasoningProvider, "create_text_completion")):
            self.assertEqual(inspect.signature(getattr(base, method)), inspect.signature(getattr(adapter, method)))
