"""Offline demo-entry policy tests: actual source definitions, mocked DB connections."""
import ast
from pathlib import Path
import unittest
from unittest.mock import Mock, MagicMock
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from app.muse_conversation_api import router, incident_router, get_conversation_manager, get_muse_assistant
from app.muse_conversations import ConversationManager
from app.muse_orchestrator import MuseAssistant
from app.muse_tools import MuseToolRegistry, RegistryReadStore
from app.security import RequestProtectionMiddleware
from app.voice_api import router as voice_router
from tests.test_muse_tools import incident


class TestMuseDemo(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((Path(__file__).resolve().parents[1] / "app/muse_demo.py").read_text())
        definitions = ast.Module(body=[n for n in tree.body if isinstance(n, (ast.ClassDef, ast.FunctionDef))], type_ignores=[])
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value.__enter__.return_value
        self.cursor.fetchone.return_value = ("on",)
        connection = self.connection
        class Database:
            def __init__(self, config): pass
            def connect(self): return connection
        self.registry = Mock()
        self.inc_rec = incident()
        self.registry.load_incidents.return_value = [self.inc_rec]
        self.registry.get_incident_by_id.return_value = self.inc_rec
        self.registry.get_nemotron_reports_for_incident.return_value = []
        self.ns = {"DatabaseManager": Database, "registry": self.registry, "get_db_config": lambda: object(),
            "ConversationManager": ConversationManager, "MuseAssistant": MuseAssistant, "MuseToolRegistry": MuseToolRegistry,
            "RegistryReadStore": RegistryReadStore, "FastAPI": FastAPI, "router": router, "incident_router": incident_router,
            "voice_router": voice_router, "get_conversation_manager": get_conversation_manager, "get_muse_assistant": get_muse_assistant,
            "CORSMiddleware": CORSMiddleware, "RequestProtectionMiddleware": RequestProtectionMiddleware,
            "cors_origins": lambda: ["http://localhost:3000"], "validate_session": lambda s: s,
            "datetime": __import__("datetime").datetime, "timezone": __import__("datetime").timezone}
        exec(compile(definitions, "muse_demo_definitions", "exec"), self.ns)

    def test_every_connection_enforces_and_verifies_readonly(self):
        db = self.ns["ReadOnlyDatabaseManager"](None)
        self.assertIs(db.connect(), self.connection)
        self.assertTrue(self.connection.read_only)
        self.cursor.execute.assert_called_once_with("SHOW transaction_read_only")
        self.connection.commit.assert_not_called()

    def test_non_readonly_connection_is_closed_and_rejected(self):
        self.cursor.fetchone.return_value = ("off",)
        with self.assertRaises(RuntimeError): self.ns["ReadOnlyDatabaseManager"](None).connect()
        self.connection.close.assert_called_once()

    def test_factory_has_no_vault_write_or_report_lifecycle(self):
        app = self.ns["create_app"]()
        paths = set(app.openapi()["paths"])
        self.assertIn("/api/voice/transcribe", paths)
        self.assertIn("/api/muse/incidents", paths)
        self.assertIn("/api/demo/incidents", paths)
        self.assertIn("/api/demo/incidents/{incident_id}/evidence", paths)
        self.assertNotIn("/api/threats/scan", paths)
        self.assertFalse(any("pdf" in p or "email" in p or "vault" in p for p in paths))
        self.assertEqual(app.router.on_startup, [])
        self.assertEqual(app.router.on_shutdown, [])
        client = TestClient(app)
        self.assertEqual(client.get("/health").status_code, 200)
        result = client.get("/api/muse/incidents", headers={"X-Client-Session-ID": "session-a"})
        self.assertEqual(result.status_code, 200)
        self.registry.load_incidents.assert_called_once_with(session_id="session-a", exact_session=True)
        self.connection.cursor.assert_not_called()

    def test_list_demo_incidents_never_exposes_session_and_orders_newest(self):
        list_demo = self.ns["list_demo_incidents"]
        self.inc_rec["scanned_at"] = "2026-11-01T15:00:00Z"
        older = {**self.inc_rec, "incident_id": "older-id", "scanned_at": "2026-11-01T14:00:00Z"}
        self.registry.load_incidents.return_value = [older, self.inc_rec]
        res = list_demo(limit=10, reg=self.registry)
        self.assertEqual(res["total_count"], 2)
        self.assertEqual(res["returned_count"], 2)
        self.assertFalse(res["truncated"])
        self.assertEqual(res["incidents"][0]["incident_id"], "incident-a")
        for inc in res["incidents"]:
            self.assertNotIn("session_id", inc)

    def test_select_demo_incident_resolves_session_and_fetches_bundle(self):
        select_demo = self.ns["select_demo_incident"]
        self.inc_rec["frame_matches"] = [{"best_match": {"source_timestamp_sec": 5.0, "l2_distance": 0.5, "match_confirmed": True}, "submitted_frame": {"timestamp_sec": 1.0, "frame_index": 0}}]
        res = select_demo("incident-a", reg=self.registry)
        self.assertEqual(res["session_id"], "session-a")
        self.assertEqual(res["incident"]["incident_id"], "incident-a")
        self.assertIn("observation_counts", res["evidence_bundle"])
