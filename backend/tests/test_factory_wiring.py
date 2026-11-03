"""Check the actual production dispatch boundaries without cloud requests."""
import ast
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock


class TestFactoryWiring(unittest.TestCase):
    def test_url_screening_dispatches_through_vision_factory(self):
        from PIL import Image
        from app import url_screener as screener
        image = Image.new("RGB", (32, 32), "red")
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG")
        match = {"source_asset_id": "ref", "source_timestamp_sec": 10, "match_confirmed": True, "low_entropy_flag": False, "confidence_score": 100, "l2_distance": 0.0, "phash_score": 100}
        with patch.object(screener, "extract_public_video_metadata", return_value={"thumbnail_url": "https://example.com/preview.jpg", "title": "preview", "platform": "YouTube"}), patch.object(screener, "fetch_suspect_thumbnail_image", return_value=(image, buffer.getvalue())), patch.object(screener, "get_valid_asset_ids", return_value={"ref"}), patch.object(screener, "match_single_frame", return_value={"best_match": match, "top_candidates": []}), patch.object(screener, "load_reference_frame_image", return_value=image), patch.object(screener, "save_incident"), patch("app.registry.is_cloud_mode", return_value=False), patch.object(screener.provider_factory, "get_vision_provider") as getter:
            getter.return_value.verify_candidate_pair.return_value = {"visual_correspondence": "UNVERIFIED"}
            vault = MagicMock()
            vault.vector_db.ntotal = 1
            result = screener.screen_video_url("https://example.com/video", vault=vault, session_id="session")
            getter.assert_called_once_with()
            getter.return_value.verify_candidate_pair.assert_called_once()
            self.assertEqual(result["session_id"], "session")
            self.assertEqual(result["frame_matches"][0]["best_match"]["vision_verification"], {"visual_correspondence": "UNVERIFIED"})

    def test_matcher_dispatches_through_vision_factory(self):
        from PIL import Image, ImageDraw
        from app.vault import ReferenceVault
        from app.matcher import analyze_asset_matches
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            reference, suspect = root / "reference", root / "suspect"
            reference.mkdir(); suspect.mkdir()
            image = Image.new("RGB", (224, 224), "blue")
            ImageDraw.Draw(image).rectangle((20, 20, 180, 180), fill="red")
            image.save(reference / "frame_0000s.jpg")
            image.save(suspect / "frame_0000s.jpg")
            vault = ReferenceVault(vault_dir=root / "vault", mode="local")
            vault.index_asset_frames(asset_id="ref", frames_dir=reference)
            with patch("app.providers.factory.get_vision_provider") as getter:
                getter.return_value.verify_candidate_pair.return_value = {"visual_correspondence": "UNVERIFIED"}
                result = analyze_asset_matches("suspect", suspect, vault=vault, valid_asset_ids={"ref"})
                getter.assert_called_once_with()
                getter.return_value.verify_candidate_pair.assert_called_once()
                self.assertEqual(result["frame_matches"][0]["best_match"]["vision_verification"], {"visual_correspondence": "UNVERIFIED"})

    def test_production_dispatch_uses_factory(self):
        root = Path(__file__).resolve().parents[1] / "app"
        for name, getter, method in (
            ("matcher.py", "get_vision_provider", "verify_candidate_pair"),
            ("url_screener.py", "get_vision_provider", "verify_candidate_pair"),
            ("main.py", "get_reasoning_provider", "generate_investigation_report"),
            ("detailed_report.py", "get_reasoning_provider", "create_text_completion"),
            ("document_actions.py", "get_reasoning_provider", "create_text_completion"),
        ):
            tree = ast.parse((root / name).read_text())
            calls = [n.func.attr for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
            self.assertIn(getter, calls, name)
            self.assertIn(method, calls, name)
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    self.assertFalse(any(alias.name in ("verify_candidate_pair", "generate_nemotron_report") for alias in node.names), name)

    def test_investigation_route_dispatch_and_response(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app import main
        incident = {"incident_id": "test-provider-incident", "frame_matches": []}
        saved = {"report_id": "test-report", "validation_status": "FAILED_VALIDATION"}
        with patch.object(main, "get_incident_by_id", return_value=incident), patch.object(main, "get_investigation_reports_for_incident", return_value=[]), patch.object(main, "build_investigation_input_from_incident", return_value="input"), patch.object(main, "save_investigation_report", return_value=saved), patch.object(main.provider_factory, "get_reasoning_provider") as getter:
            response = TestClient(app).post("/api/threats/test-provider-incident/investigate", json={"force_refresh": True})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), saved)
            getter.return_value.generate_investigation_report.assert_called_once_with("input", model_override=None)
