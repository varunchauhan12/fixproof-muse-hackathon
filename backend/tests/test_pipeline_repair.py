"""Real local media and persistence; run only through the offline runner."""
import importlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from app import registry, main
from app.extractor import extract_video_frames
from app.vault import ReferenceVault


class TestPipelineRepair(unittest.TestCase):
    def test_local_sessions_survive_save_reload_and_lookup(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "incidents.json"
            original = [{"incident_id": str(i), "session_id": "other"} for i in range(105)]
            path.write_text(json.dumps(original))
            with patch.object(registry, "INCIDENTS_FILE", path):
                registry.save_incident({"incident_id": "new", "session_id": "owner"})
                self.assertEqual(len(json.loads(path.read_text())), 106)
                self.assertEqual(registry.get_incident_by_id("new")["session_id"], "owner")
                self.assertEqual(len(registry.load_incidents("other")), 105)
                self.assertEqual(len(registry.load_incidents("owner")), 1)
                path.write_text("broken JSON")
                with self.assertRaises(ValueError):
                    registry.save_incident({"incident_id": "refuse"})
                self.assertEqual(path.read_text(), "broken JSON")

    def test_real_video_scan_frames_persistence_and_summary(self):
        media = Path("acceptance_ref_broadcast.mp4")
        self.assertTrue(media.is_file())
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            duration, frames = extract_video_frames(media, root / "reference")
            self.assertGreater(duration, 0)
            self.assertGreater(len(frames), 0)
            vault = ReferenceVault(vault_dir=root / "vault", mode="local")
            vault.index_asset_frames(asset_id="reference", frames_dir=root / "reference")
            verification = {"visual_correspondence": "UNVERIFIED", "confidence_assessment": "INCONCLUSIVE",
                            "validation_status": "VERIFICATION_UNAVAILABLE", "model_id": "muse-spark-1.3"}
            with patch.object(main, "default_vault", vault), patch("app.matcher.get_valid_asset_ids", return_value={"reference"}), patch("app.providers.factory.MetaVisionProvider.verify_candidate_pair", return_value=verification) as vision, patch.dict("os.environ", {"FIXPROOF_AI_PROVIDER": "muse"}):
                client = TestClient(main.app)
                headers = {"X-Client-Session-ID": "repair-test-session"}
                result = client.post("/api/threats/scan", files={"file": ("real.mp4", media.read_bytes(), "video/mp4")}, headers=headers)
                self.assertEqual(result.status_code, 200, result.text)
                data = result.json()
                self.assertGreater(data["total_frames_analyzed"], 0)
                self.assertGreater(data["candidate_matches_found"], 0)
                self.assertTrue(all(seconds >= 0 for seconds in data["processing_timings"].values()))
                self.assertGreater(vision.call_count, 0)
                self.assertLessEqual(vision.call_count, 3)
                iid = data["incident_id"]
                frame = data["frame_matches"][0]["submitted_frame"]
                image = client.get(f"/api/vault/assets/{iid}/frames/{frame['filename']}")
                self.assertEqual(image.status_code, 200)
                self.assertTrue(image.content.startswith(b"\xff\xd8"))
                self.assertIn("image/jpeg", image.headers["content-type"])
                importlib.reload(registry)
                self.assertEqual(client.get(f"/api/incidents/{iid}", headers=headers).status_code, 200)
                self.assertEqual(client.get(f"/api/incidents/{iid}").status_code, 403)
                self.assertIn(iid, [r["incident_id"] for r in client.get("/api/incidents", headers=headers).json()])
                summary = client.get(f"/api/nemotron/summary-download/{iid}", headers=headers)
                self.assertEqual(summary.status_code, 200)
                self.assertIn(iid, summary.text)
                from app import detailed_report as detailed
                sections = {key: "Measured test evidence; human review required." for key in (
                    "executive_summary", "methodology_scope", "temporal_continuity_analysis",
                    "model_assessment_and_alternatives", "risk_limitations")}
                sections["recommended_actions"] = ["Review recorded evidence"]
                completion = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(sections)))])
                with patch.dict("os.environ", {"MODEL_API_KEY": "dummy-offline-key"}), patch("app.providers.meta.MetaReasoningProvider.create_text_completion", return_value=completion):
                    report = client.post("/api/nemotron/detailed-report", json={"incident_id": iid}, headers=headers)
                self.assertEqual(report.status_code, 200, report.text)
                self.assertTrue(report.json()["report"]["ai_synthesized"])
                pdf = client.get(report.json()["pdf_url"], headers=headers)
                self.assertEqual(pdf.status_code, 200)
                self.assertTrue(pdf.content.startswith(b"%PDF"))
                self.assertEqual(report.json()["report"]["model_id"], "muse-spark-1.3")
