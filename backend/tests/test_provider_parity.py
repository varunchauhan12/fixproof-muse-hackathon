"""Contract regressions; all model and persistent-cache operations are mocked."""
import inspect
import json
import io
import os
import unittest
from unittest.mock import MagicMock, patch

from PIL import Image
from app.providers import factory
from app.providers.base import BaseVisionProvider, BaseReasoningProvider
from app.providers.nemotron import NemotronVisionProvider, NemotronReasoningProvider
from app import vision_verifier as verifier


def image_bytes(color):
    image = Image.new("RGB", (32, 32), color)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class TestProviderParity(unittest.TestCase):
    def setUp(self):
        self.suspect = image_bytes("red")
        self.reference = image_bytes("blue")
        self.metadata = {"timestamp_sec": 5, "candidate_pair_index": 2}
        self.ref_metadata = {"timestamp_sec": 8, "asset_id": "reference"}

    def call(self):
        return NemotronVisionProvider().verify_candidate_pair(
            self.suspect, self.reference, self.metadata, self.ref_metadata)

    def test_factory_and_signatures(self):
        with patch.dict(os.environ, {"FIXPROOF_AI_PROVIDER": "nemotron"}):
            self.assertIsInstance(factory.get_vision_provider(), NemotronVisionProvider)
            self.assertIsInstance(factory.get_reasoning_provider(), NemotronReasoningProvider)
        for base, implementation, method in (
            (BaseVisionProvider, NemotronVisionProvider, "verify_candidate_pair"),
            (BaseReasoningProvider, NemotronReasoningProvider, "generate_investigation_report"),
        ):
            self.assertEqual(inspect.signature(getattr(base, method)),
                             inspect.signature(getattr(implementation, method)))

    def test_original_vision_keyword_mismatch_regression(self):
        # autospec rejects the original wrapper's unexpected byte/metadata keywords.
        with patch.object(verifier, "verify_candidate_pair", autospec=True) as delegate:
            delegate.return_value = {"visual_correspondence": "HIGH_CORRESPONDENCE"}
            self.assertEqual(self.call(), delegate.return_value)
            args = delegate.call_args.kwargs
            self.assertIsInstance(args["suspect_img"], Image.Image)
            self.assertEqual(args["suspect_timestamp_sec"], 5)
            self.assertEqual(args["source_asset_id"], "reference")
            self.assertEqual(args["candidate_pair_index"], 2)
            self.assertNotIn("timeout_sec", args)  # retain engine's 15-second default

    def test_reasoning_keyword_mismatch_regression(self):
        with patch("app.nemotron_engine.generate_nemotron_report", autospec=True) as delegate:
            evidence = object()
            result = NemotronReasoningProvider().generate_investigation_report(evidence, "chosen-model")
            delegate.assert_called_once_with(input_data=evidence, model_override="chosen-model")
            self.assertIs(result, delegate.return_value)

    def test_cache_hit_preserves_evidence_context_without_api_call(self):
        with patch.object(verifier, "get_cached_verification", return_value={"visual_correspondence": "HIGH_CORRESPONDENCE"}), patch("openai.OpenAI") as client:
            result = self.call()
            self.assertTrue(result["cached"])
            self.assertEqual(result["source_asset_id"], "reference")
            self.assertEqual(result["reference_timestamp_sec"], 8)
            client.assert_not_called()

    def test_failure_timeout_and_missing_key_remain_unverified(self):
        with patch.object(verifier, "get_cached_verification", return_value=None), patch.dict(os.environ, {"NEBIUS_API_KEY": "test-key"}), patch("openai.OpenAI") as client:
            client.return_value.chat.completions.create.side_effect = RuntimeError("provider unavailable")
            result = self.call()
            self.assertEqual(result["visual_correspondence"], "UNVERIFIED")
            self.assertEqual(result["validation_status"], "VERIFICATION_UNAVAILABLE")
            self.assertEqual(client.call_args.kwargs["timeout"], verifier.VERIFICATION_TIMEOUT_SEC)
        with patch.object(verifier, "get_cached_verification", return_value=None), patch.dict(os.environ, {"NEBIUS_API_KEY": ""}):
            self.assertEqual(self.call()["visual_correspondence"], "UNVERIFIED")

    def test_invalid_image_never_becomes_successful_verification(self):
        result = NemotronVisionProvider().verify_candidate_pair(b"invalid", self.reference)
        self.assertEqual(result["visual_correspondence"], "UNVERIFIED")

    def test_successful_vision_preserves_cache_key_and_result_contract(self):
        payload = {"visual_correspondence": "HIGH_CORRESPONDENCE", "confidence_assessment": "HIGH", "reasoning": "Same overlay and players", "matching_features": ["overlay"], "contradictions": [], "uncertainty_factors": []}
        with patch.object(verifier, "get_cached_verification", return_value=None), patch.object(verifier, "store_cached_verification") as store, patch.dict(os.environ, {"NEBIUS_API_KEY": "test-key"}), patch("openai.OpenAI") as client:
            client.return_value.chat.completions.create.return_value.choices = [MagicMock(message=MagicMock(content=json.dumps(payload)))]
            result = self.call()
            self.assertEqual(result["validation_status"], "VERIFIED")
            self.assertEqual(result["visual_correspondence"], payload["visual_correspondence"])
            self.assertEqual(result["candidate_pair_index"], 2)
            with Image.open(io.BytesIO(self.suspect)) as s, Image.open(io.BytesIO(self.reference)) as r:
                _, sb = verifier.resize_image_for_verification(s)
                _, rb = verifier.resize_image_for_verification(r)
            key = verifier.compute_pair_cache_key(sb, rb, verifier.VISION_MODEL_ID, verifier.PROMPT_VERSION)
            store.assert_called_once_with(key, result)

    def test_text_completion_preserves_pooled_client_request(self):
        request = {"model": "existing-model", "messages": [{"role": "user", "content": "existing prompt"}], "temperature": 0.15, "max_tokens": 4000, "response_format": {"type": "json_object"}}
        with patch("app.nemotron_engine.get_openai_client") as client:
            result = factory.get_reasoning_provider("nemotron").create_text_completion(request)
            client.return_value.chat.completions.create.assert_called_once_with(**request)
            self.assertIs(result, client.return_value.chat.completions.create.return_value)

