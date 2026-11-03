"""Stage C: real dispatch and SDK serialization, dummy keys and in-memory HTTP only."""
import base64
import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import httpx2
from PIL import Image, ImageDraw

from tests import test_meta_provider as fixtures
from app.providers import factory, meta_client
from app.providers.meta import MetaVisionProvider, VISION_PROMPT_VERSION
from app import vision_support as verifier


class TestVisionMigration(unittest.TestCase):
    image = fixtures.TestMetaProvider.image

    def setUp(self):
        fixtures.TestMetaProvider.setUp(self)
        self.addCleanup(fixtures.TestMetaProvider.tearDown, self)
        for target, kwargs in (
            ("app.vision_support.get_cached_verification", {"return_value": None}),
            ("app.vision_support.store_cached_verification", {}),
        ):
            patcher = patch(target, **kwargs)
            mock = patcher.start()
            self.addCleanup(patcher.stop)
            if "get_cached" in target:
                self.cache = mock
            elif "store_cached" in target:
                self.store = mock
            else:
                self.addCleanup(mock.assert_not_called)
        patcher = patch.dict(os.environ, {"FIXPROOF_AI_PROVIDER": "muse", "NEBIUS_API_KEY": ""})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.payload = {"visual_correspondence": "HIGH_CORRESPONDENCE", "confidence_assessment": "HIGH",
                        "matching_features": ["scoreboard"], "contradictions": [],
                        "reasoning": "Shared scoreboard geometry", "uncertainty_factors": ["Single image pair"]}
        self.content = json.dumps(self.payload)

    def verify(self, suspect=None, reference=None):
        return factory.get_vision_provider().verify_candidate_pair(
            suspect if suspect is not None else self.image(),
            reference if reference is not None else self.image(),
            {"timestamp_sec": 3.5, "candidate_pair_index": 2}, {"timestamp_sec": 9, "asset_id": "ref"})

    def assert_unverified(self, result, status):
        self.assertEqual(result["visual_correspondence"], "UNVERIFIED")
        self.assertEqual(result["confidence_assessment"], "INCONCLUSIVE")
        self.assertEqual(result["validation_status"], status)
        self.assertEqual(result["model_id"], "muse-spark-1.3")
        self.assertEqual(result["source_asset_id"], "ref")
        self.assertNotIn("dummy-meta-secret", json.dumps(result))
        self.store.assert_not_called()

    def test_pair_success_image_order_encoding_and_resource_bounds(self):
        reference = io.BytesIO()
        Image.new("RGBA", (300, 900), "blue").save(reference, format="PNG")
        with patch.dict(os.environ, {"MUSE_TIMEOUT_SEC": "90"}):
            result = self.verify(reference=reference.getvalue())
        self.assertEqual(result["validation_status"], "VERIFIED")
        self.assertEqual(result["candidate_pair_index"], 2)
        self.assertEqual(result["suspect_timestamp_sec"], 3.5)
        self.assertEqual(result["reference_timestamp_sec"], 9)
        self.assertFalse(result["cached"])
        self.assertIn("verified_at", result)
        request = json.loads(self.calls[0].content)
        self.assertEqual(request["model"], "muse-spark-1.3")
        self.assertEqual(request["max_tokens"], 2048)
        self.assertEqual(request["response_format"]["type"], "json_schema")
        self.assertEqual(self.calls[0].extensions["timeout"]["read"], 15)
        blocks = request["messages"][0]["content"]
        self.assertEqual(blocks[0]["text"], verifier.VERIFICATION_SYSTEM_PROMPT)
        for block, raw, channel in zip(blocks[1:], (self.image(), reference.getvalue()), (0, 2)):
            self.assertEqual(block["type"], "image_url")
            encoded = block["image_url"]["url"]
            self.assertTrue(encoded.startswith("data:image/jpeg;base64,"))
            data = base64.b64decode(encoded.split(",", 1)[1])
            with Image.open(io.BytesIO(raw)) as original:
                _, expected = verifier.resize_image_for_verification(original)
            self.assertEqual(data, expected)  # Includes unchanged JPEG quality/optimization.
            with Image.open(io.BytesIO(data)) as image:
                self.assertEqual(image.format, "JPEG")
                self.assertEqual(image.mode, "RGB")
                self.assertLessEqual(max(image.size), 512)
                self.assertGreater(image.getpixel((0, 0))[channel], 240)
        self.store.assert_called_once()

    def test_all_correspondence_enums_preserved_without_inventing_matches(self):
        for correspondence in ("HIGH_CORRESPONDENCE", "POSSIBLE_REUSE", "UNRELATED_SCENE", "UNVERIFIED"):
            with self.subTest(correspondence=correspondence):
                self.content = json.dumps({**self.payload, "visual_correspondence": correspondence})
                result = self.verify()
                self.assertEqual(result["visual_correspondence"], correspondence)
                self.assertEqual(result["validation_status"], "VERIFIED")
                self.assertEqual(result["matching_features"], ["scoreboard"])
                self.assertEqual(result["uncertainty_factors"], ["Single image pair"])

    def test_malformed_json_is_failed(self):
        self.content = "not JSON"
        self.assert_unverified(self.verify(), "FAILED")

    def test_schema_fields_enums_types_and_provenance_injection_are_rejected(self):
        invalid = [{k: v for k, v in self.payload.items() if k != field} for field in self.payload]
        invalid += [{**self.payload, **update} for update in (
            {"visual_correspondence": "CONFIRMED"}, {"confidence_assessment": "CERTAIN"},
            {"reasoning": " "}, {"matching_features": "scoreboard"}, {"contradictions": [2]},
            {"model_id": "invented"}, {"verified_at": "invented"}, {"validation_status": "VERIFIED"})]
        for data in invalid:
            with self.subTest(data=data):
                self.content = json.dumps(data)
                self.assert_unverified(self.verify(), "SCHEMA_VIOLATION")

    def test_invalid_images_fail_before_http(self):
        self.assert_unverified(self.verify(suspect=b"not an image"), "FAILED")
        self.assertEqual(self.calls, [])

    def test_missing_meta_key_does_not_use_available_nebius_key(self):
        with patch.dict(os.environ, {"MODEL_API_KEY": "", "NEBIUS_API_KEY": "dummy-nebius"}):
            self.assert_unverified(self.verify(), "VERIFICATION_UNAVAILABLE")
        self.assertEqual(self.calls, [])

    def test_timeout_connection_api_and_truncation_fail_without_retry(self):
        for failure, status, finish in ((httpx2.ReadTimeout, 200, "stop"), (httpx2.ConnectError, 200, "stop"),
                                       (None, 401, "stop"), (None, 429, "stop"), (None, 500, "stop"),
                                       (None, 200, "length")):
            with self.subTest(failure=failure, status=status, finish=finish):
                self.calls.clear()
                self.failure, self.status, self.finish = failure, status, finish
                self.assert_unverified(self.verify(), "VERIFICATION_UNAVAILABLE")
                self.assertEqual(len(self.calls), 1)

    def test_cache_isolated_by_model_prompt_and_order_preserves_timestamp(self):
        self.verify()
        key, result = self.store.call_args.args
        with Image.open(io.BytesIO(self.image())) as image:
            _, data = verifier.resize_image_for_verification(image)
        self.assertEqual(key, verifier.compute_pair_cache_key(data, data, "muse-spark-1.3", VISION_PROMPT_VERSION))
        self.assertNotEqual(key, verifier.compute_pair_cache_key(data, data))
        self.assertNotEqual(key, verifier.compute_pair_cache_key(data, data, "another-model", VISION_PROMPT_VERSION))
        self.assertNotEqual(key, verifier.compute_pair_cache_key(data, data, "muse-spark-1.3", "another-prompt"))
        self.assertNotEqual(verifier.compute_pair_cache_key(b"s", b"r"), verifier.compute_pair_cache_key(b"r", b"s"))
        self.cache.return_value = {**result, "verified_at": "2026-10-01T00:00:00+00:00", "source_asset_id": "old-context"}
        cached = self.verify()
        self.assertTrue(cached["cached"])
        self.assertEqual(cached["verified_at"], "2026-10-01T00:00:00+00:00")
        self.assertEqual(cached["source_asset_id"], "ref")
        self.assertEqual(len(self.calls), 1)
        self.store.assert_called_once()


    def test_matcher_selected_meta_max_three_and_unchanged_cv_on_failure(self):
        from app.vault import ReferenceVault
        from app.matcher import analyze_asset_matches
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            reference, suspect = root / "reference", root / "suspect"
            reference.mkdir()
            suspect.mkdir()
            image = Image.new("RGB", (224, 224), "blue")
            ImageDraw.Draw(image).rectangle((20, 20, 180, 180), fill="red")
            image.save(reference / "frame_0000s.jpg")
            for i in range(6):
                image.save(suspect / f"frame_{i:04d}s.jpg")
            vault = ReferenceVault(vault_dir=root / "vault", mode="local")
            vault.index_asset_frames(asset_id="ref", frames_dir=reference)
            baseline = analyze_asset_matches("suspect", suspect, vault=vault, valid_asset_ids={"ref"}, run_vision_verification=False)
            success = analyze_asset_matches("suspect", suspect, vault=vault, valid_asset_ids={"ref"})
            self.assertEqual(len(self.calls), 3)
            success_verifications = [fm["best_match"].pop("vision_verification") for fm in success["frame_matches"] if "vision_verification" in fm.get("best_match", {})]
            self.assertEqual(len(success_verifications), 3)
            self.assertTrue(all(v["model_id"] == "muse-spark-1.3" and v["validation_status"] == "VERIFIED" for v in success_verifications))
            self.assertEqual(success["frame_matches"], baseline["frame_matches"])
            self.calls.clear()
            self.store.reset_mock()
            self.status = 500
            result = analyze_asset_matches("suspect", suspect, vault=vault, valid_asset_ids={"ref"})
            self.assertEqual(len(self.calls), 3)
            verifications = [fm["best_match"].pop("vision_verification") for fm in result["frame_matches"] if "vision_verification" in fm.get("best_match", {})]
            self.assertEqual(len(verifications), 3)
            for v in verifications:
                self.assert_unverified(v, "VERIFICATION_UNAVAILABLE")
            self.assertEqual(result["frame_matches"], baseline["frame_matches"])
            self.assertEqual(result["candidate_matches_found"], baseline["candidate_matches_found"])
            self.calls.clear()
            with patch("app.matcher.load_reference_frame_image", return_value=None):
                missing = analyze_asset_matches("suspect", suspect, vault=vault, valid_asset_ids={"ref"})
            fallback = [fm["best_match"]["vision_verification"] for fm in missing["frame_matches"] if "vision_verification" in fm.get("best_match", {})]
            self.assertEqual(len(fallback), 3)
            for v in fallback:
                self.assert_unverified(v, "VERIFICATION_UNAVAILABLE")
            self.assertEqual(self.calls, [])

    def test_url_screening_actual_meta_dispatch_and_missing_frame_fallback(self):
        from app import url_screener as screener
        image = Image.new("RGB", (32, 32), "red")
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG")
        match = {"source_asset_id": "ref", "source_timestamp_sec": 10, "match_confirmed": True,
                 "low_entropy_flag": False, "confidence_score": 100, "l2_distance": 0.0, "phash_score": 100}
        with patch.object(screener, "extract_public_video_metadata", return_value={"thumbnail_url": "https://example.com/preview.jpg", "title": "preview", "platform": "YouTube"}), patch.object(screener, "fetch_suspect_thumbnail_image", return_value=(image, buffer.getvalue())), patch.object(screener, "get_valid_asset_ids", return_value={"ref"}), patch.object(screener, "match_single_frame", side_effect=lambda *a, **kw: {"best_match": copy.deepcopy(match), "top_candidates": []}), patch.object(screener, "load_reference_frame_image", return_value=image) as load, patch.object(screener, "save_incident"), patch("app.registry.is_cloud_mode", return_value=False):
            vault = MagicMock()
            vault.vector_db.ntotal = 1
            result = screener.screen_video_url("https://example.com/video", vault=vault, session_id="session")
            v = result["frame_matches"][0]["best_match"]["vision_verification"]
            self.assertEqual(v["validation_status"], "VERIFIED")
            self.assertEqual(v["model_id"], "muse-spark-1.3")
            self.assertEqual(len(self.calls), 1)
            self.status = 500
            result = screener.screen_video_url("https://example.com/video", vault=vault, session_id="session")
            v = result["frame_matches"][0]["best_match"]["vision_verification"]
            self.assertEqual(v["visual_correspondence"], "UNVERIFIED")
            self.assertEqual(v["confidence_assessment"], "INCONCLUSIVE")
            self.assertEqual(v["validation_status"], "VERIFICATION_UNAVAILABLE")
            self.assertEqual(len(self.calls), 2)
            load.return_value = None
            result = screener.screen_video_url("https://example.com/video", vault=vault, session_id="session")
            v = result["frame_matches"][0]["best_match"]["vision_verification"]
            self.assertEqual(v["visual_correspondence"], "UNVERIFIED")
            self.assertEqual(v["validation_status"], "VERIFICATION_UNAVAILABLE")
            self.assertEqual(v["model_id"], "muse-spark-1.3")
            self.assertEqual(len(self.calls), 2)


    def test_report_uses_recorded_models_not_current_provider(self):
        from app import detailed_report as reports
        incident = {"incident_id": "test", "frame_matches": [{"best_match": {
            "match_confirmed": True, "vision_verification": {**self.payload, "model_id": "historical-vision-model"}}}]}
        with patch.object(reports, "get_incident_by_id", return_value=incident), patch.object(reports, "list_registered_assets", return_value=[]), patch.object(reports, "get_investigation_reports_for_incident", return_value=[]):
            bundle = reports.build_evidence_bundle("test")
            self.assertEqual(bundle["frame_correlations"][0]["vision_verification"]["model_id"], "historical-vision-model")
            bundle = reports.build_evidence_bundle("test")
            with patch.dict(os.environ, {"MODEL_API_KEY": ""}):
                report = reports.synthesize_detailed_report(bundle)
            self.assertEqual(report["sections"]["provenance"]["vision_verifier_model"], "historical-vision-model")
            del incident["frame_matches"][0]["best_match"]["vision_verification"]["model_id"]
            bundle = reports.build_evidence_bundle("test")
            self.assertEqual(bundle["frame_correlations"][0]["vision_verification"]["model_id"], "not-recorded")
        self.assertEqual(self.calls, [])
