"""Offline tools/strict-reader tests: no app startup, registry import or live services."""
import ast
from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
import typing
import unittest
from unittest.mock import Mock, patch, mock_open

from app.muse_tools import MuseToolRegistry, RegistryReadStore, MAX_RESULT_BYTES


def incident(iid="incident-a", session="session-a", scanned="2026-11-01T10:00:00Z"):
    return {"incident_id": iid, "session_id": session, "scanned_at": scanned,
            "overall_status": "CANDIDATE_MATCH", "candidate_matches_found": 2,
            "highest_confidence": 91.2, "frame_matches": [], "limitations": ["Sampled frames only"]}


def frame(suspect, source, idx=0):
    return {"submitted_frame": {"timestamp_sec": suspect, "frame_index": idx, "frame_path": "/private/frame.jpg"},
            "best_match": {"source_asset_id": "asset-a", "source_timestamp_sec": source,
                           "l2_distance": 0.2, "match_confirmed": True,
                           "source_frame_path": "/private/reference.jpg", "vision_verification": {"reasoning": "PRIVATE_TRACE"}}}


class Store:
    def __init__(self):
        self.incidents = [incident()]
        self.reports = []
        self.calls = []

    def list_incidents(self, session):
        self.calls.append(("list", session))
        return self.incidents  # Deliberately unfiltered: defense in depth.

    def get_incident(self, iid):
        self.calls.append(("incident", iid))
        return next((r for r in self.incidents if r["incident_id"] == iid), None)

    def get_reports(self, iid):
        self.calls.append(("reports", iid))
        return self.reports  # Deliberately unfiltered: association must be checked.


class TestMuseTools(unittest.TestCase):
    def setUp(self):
        self.store = Store()
        self.tools = MuseToolRegistry(self.store)
        for target in ("builtins.open", "pathlib.Path.open", "pathlib.Path.mkdir", "socket.socket.connect"):
            guard = patch(target, side_effect=AssertionError("Unexpected external side effect"))
            guard.start()
            self.addCleanup(guard.stop)

    def call(self, tool, arguments=None, session="session-a"):
        return self.tools.execute(tool, session_id=session, arguments=arguments).model_dump(mode="json")

    def by_incident(self, tool, iid="incident-a", session="session-a"):
        return self.call(tool, {"incident_id": iid}, session)

    def assert_error(self, result, code):
        self.assertEqual(result["status"], "error")
        self.assertIsNone(result["data"])
        self.assertEqual(result["error"]["code"], code)

    def test_session_listing_excludes_null_demo_and_other(self):
        self.store.incidents += [incident("foreign", "session-b"), incident("legacy", None), incident("demo", "demo-showcase")]
        result = self.call("list_recent_incidents")
        self.assertEqual([i["incident_id"] for i in result["data"]["incidents"]], ["incident-a"])
        self.assertFalse(result["data"]["incidents"][0]["has_investigation_reports"])
        self.assertEqual(self.store.calls[0], ("list", "session-a"))

    def test_empty_list_and_latest(self):
        self.store.incidents = []
        self.assertEqual(self.call("list_recent_incidents")["data"]["incidents"], [])
        self.assert_error(self.call("get_latest_incident"), "NOT_FOUND")

    def test_latest_stable_timestamp_offsets_and_id_tie(self):
        self.store.incidents = [incident("incident-a"), incident("incident-b", scanned="2026-11-01T12:00:00+02:00"),
                                incident("old", scanned="2026-10-31T23:00:00Z")]
        for _ in range(2):
            self.assertEqual(self.call("get_latest_incident")["data"]["incident_id"], "incident-b")
            self.store.incidents.reverse()

    def test_latest_missing_timestamp_not_invented(self):
        self.store.incidents[0]["scanned_at"] = "invalid"
        self.assert_error(self.call("get_latest_incident"), "DATA_UNAVAILABLE")
        self.assertIsNone(self.by_incident("get_incident_details")["data"]["scanned_at"])

    def test_missing_session_all_tools_before_reads(self):
        for tool in self.tools.tools:
            args = {} if tool in ("list_recent_incidents", "get_latest_incident") else {"incident_id": "incident-a"}
            for session in (None, "", "bad session", "a", "a" * 65):
                self.assert_error(self.call(tool, args, session), "INVALID_ARGUMENT")
        self.assertEqual(self.store.calls, [])

    def test_invalid_arguments_and_unknown_tools(self):
        for tool in self.tools.tools:
            if tool in ("list_recent_incidents", "get_latest_incident"):
                continue
            for iid in ("../file", "", "x" * 129, 123):
                self.assert_error(self.by_incident(tool, iid), "INVALID_ARGUMENT")
        self.assert_error(self.call("/private/unknown"), "INVALID_ARGUMENT")
        self.assertEqual(self.call("/private/unknown")["tool"], "unknown")
        self.assert_error(self.call("get_latest_incident", {"session_id": "session-b"}), "INVALID_ARGUMENT")
        for limit in (True, 26, 0):
            self.assert_error(self.call("list_recent_incidents", {"limit": limit}), "INVALID_ARGUMENT")
        self.assertEqual(self.store.calls, [])

    def test_cross_session_and_demo_mode_never_bypass(self):
        for session in ("session-b", None, "demo-showcase"):
            self.store.incidents[0]["session_id"] = session
            with patch.dict("os.environ", {"FIXPROOF_DEMO_MODE": "true"}):
                for tool in ("get_incident_details", "get_matching_timestamps", "get_evidence_bundle", "get_investigation_reports"):
                    self.assert_error(self.by_incident(tool), "ACCESS_DENIED")
            self.assertFalse(any(call[0] == "reports" for call in self.store.calls))

    def test_details_actual_metrics_and_sanitized_metadata(self):
        self.store.incidents[0].update(metadata={"API_KEY": "SECRET"}, suspect_storage_path="/private/video", suspect_filename="clip.mov")
        result = self.by_incident("get_incident_details")
        self.assertEqual(result["data"]["metrics"]["highest_confidence"], 91.2)
        self.assertEqual(result["data"]["suspect_filename"], "clip.mov")
        for hidden in ("SECRET", "/private"):
            self.assertNotIn(hidden, json.dumps(result))

    def test_matching_exact_timestamps_and_intervals(self):
        self.store.incidents[0]["frame_matches"] = [frame(0.0, 25.25, 0), frame(5.0, 30.25, 1)]
        result = self.by_incident("get_matching_timestamps")["data"]
        self.assertEqual([f["suspect_timestamp_sec"] for f in result["frames"]], [0.0, 5.0])
        self.assertEqual([f["source_timestamp_sec"] for f in result["frames"]], [25.25, 30.25])
        interval = result["timeline_intervals"][0]
        self.assertEqual((interval["suspect_start_sec"], interval["suspect_end_sec"], interval["duration_sec"]), (0, 5, 5))
        self.assertEqual(interval["source_start_sec"], 25.25)
        self.assertEqual(interval["evidence_ids"], ["frame_0_t0s", "frame_1_t5s"])

    def test_singleton_no_invented_duration(self):
        self.store.incidents[0]["frame_matches"] = [frame(8.5, 20.5)]
        result = self.by_incident("get_matching_timestamps")["data"]
        self.assertEqual(result["timeline_intervals"][0]["duration_sec"], 0)
        self.assertEqual(result["timeline_intervals"][0]["continuity_status"], "SINGLETON")

    def test_filtering_preserves_original_normalized_evidence_identity(self):
        valid = frame(5, 10)
        del valid["submitted_frame"]["frame_index"]
        self.store.incidents[0]["frame_matches"] = [frame(None, 0), valid]
        result = self.by_incident("get_matching_timestamps")["data"]
        self.assertEqual(result["frames"][0]["evidence_id"], "frame_1_t5s")
        self.assertNotIn("frame_index", valid["submitted_frame"])

    def test_missing_evidence_and_empty_bundle(self):
        for tool in ("get_matching_timestamps", "get_evidence_bundle"):
            self.assert_error(self.by_incident(tool), "DATA_UNAVAILABLE")

    def test_missing_invalid_timestamps_not_synthesized(self):
        for value in (None, -1, float("nan"), "2"):
            self.store.incidents[0]["frame_matches"] = [frame(value, 10)]
            self.assert_error(self.by_incident("get_matching_timestamps"), "DATA_UNAVAILABLE")
        self.store.incidents[0]["frame_matches"] = [frame(5, None)]
        self.assert_error(self.by_incident("get_matching_timestamps"), "DATA_UNAVAILABLE")

    def test_low_entropy_nonmatches_excluded(self):
        value = frame(5, 10)
        value["best_match"]["low_entropy_flag"] = True
        self.store.incidents[0]["frame_matches"] = [value]
        self.assert_error(self.by_incident("get_matching_timestamps"), "DATA_UNAVAILABLE")

    def test_bundle_allowlist_excludes_paths_and_reasoning(self):
        self.store.incidents[0]["frame_matches"] = [frame(5, 10)]
        result = self.by_incident("get_evidence_bundle")
        self.assertEqual(result["status"], "success")
        for forbidden in ("/private", "PRIVATE_TRACE", "vision_verification", "source_frame_path"):
            self.assertNotIn(forbidden, json.dumps(result))
        self.assertEqual(result["data"]["recorded_limitations"], ["Sampled frames only"])

    def test_report_provenance_validation_persistence(self):
        self.store.reports = [{"report_id": "report-a", "incident_id": "incident-a", "model_id": "muse-wonder-1.0",
                               "summary": "Evidence-backed summary", "created_at": "2026-11-01T10:00:00Z",
                               "operational_metadata": {"provider": "muse", "validation_status": "VALIDATED", "private_reasoning": "PRIVATE"}}]
        item = self.by_incident("get_investigation_reports")["data"]["reports"][0]
        self.assertEqual((item["provider"], item["model_id"], item["validation_status"]), ("muse", "muse-wonder-1.0", "VALIDATED"))
        self.assertEqual(item["persistence_status"], "retrieved_from_store")
        self.assertNotIn("PRIVATE", json.dumps(item))

    def test_missing_provenance_not_filled_from_current_provider(self):
        self.store.reports = [{"report_id": "old", "incident_id": "incident-a"}]
        item = self.by_incident("get_investigation_reports")["data"]["reports"][0]
        for key in ("model_id", "provider", "validation_status"):
            self.assertIsNone(item[key])

    def test_report_association_mismatch(self):
        for iid in ("incident-b", None):
            self.store.reports = [{"report_id": "bad", "incident_id": iid}]
            self.assert_error(self.by_incident("get_investigation_reports"), "ACCESS_DENIED")

    def test_orphan_denied_before_report_read(self):
        self.store.incidents = []
        self.store.reports = [{"report_id": "orphan", "incident_id": "incident-a"}]
        self.assert_error(self.by_incident("get_investigation_reports"), "NOT_FOUND")
        self.assertEqual(self.store.calls, [("incident", "incident-a")])

    def test_missing_reports_not_generated(self):
        self.assert_error(self.by_incident("get_investigation_reports"), "NOT_FOUND")
        self.assertEqual(self.store.calls, [("incident", "incident-a"), ("reports", "incident-a")])

    def test_output_bounds(self):
        self.store.incidents = [incident(f"incident-{i}") for i in range(30)]
        result = self.call("list_recent_incidents", {"limit": 25})
        self.assertEqual(len(result["data"]["incidents"]), 25)
        self.assertTrue(result["data"]["truncated"])
        self.store.incidents = [incident()]
        self.store.incidents[0]["frame_matches"] = [frame(i, i + 10, i) for i in range(100)]
        result = self.by_incident("get_matching_timestamps")
        self.assertEqual(len(result["data"]["frames"]), 50)
        self.assertTrue(result["data"]["bounds"]["truncated"])
        self.store.reports = [{"report_id": f"report-{i}", "incident_id": "incident-a", "summary": "x" * 10000} for i in range(30)]
        result = self.by_incident("get_investigation_reports")
        self.assertEqual(len(result["data"]["reports"]), 20)
        self.assertEqual(len(result["data"]["reports"][0]["summary"]), 1000)
        self.assertTrue(result["data"]["truncated"])
        self.assertLess(len(json.dumps(result).encode()), MAX_RESULT_BYTES)

    def test_sanitized_errors_and_text(self):
        for error, code in ((RuntimeError("SECRET /private/file"), "INTERNAL_ERROR"), (OSError("SECRET /private/file"), "DATA_UNAVAILABLE")):
            self.store.get_incident = Mock(side_effect=error)
            result = self.by_incident("get_incident_details")
            self.assert_error(result, code)
            for hidden in ("SECRET", "/private"):
                self.assertNotIn(hidden, json.dumps(result))
        self.store.get_incident = lambda iid: self.store.incidents[0]
        self.store.incidents[0]["status_message"] = "Read /private/file token=hidden https://user:password@example.test/path"
        rendered = json.dumps(self.by_incident("get_incident_details"))
        for hidden in ("/private/file", "hidden", "password@example"):
            self.assertNotIn(hidden, rendered)

    def test_hard_output_byte_cap(self):
        with patch("app.muse_tools.MAX_RESULT_BYTES", 1):
            self.assert_error(self.call("list_recent_incidents"), "DATA_UNAVAILABLE")

    def test_no_mutation_or_write_transport_calls(self):
        self.store.incidents[0]["frame_matches"] = [frame(5, 10)]
        before = deepcopy((self.store.incidents, self.store.reports))
        for name in self.tools.tools:
            args = {} if name in ("get_latest_incident", "list_recent_incidents") else {"incident_id": "incident-a"}
            result = self.call(name, args)
            self.assertTrue(result["status"] == "success" or result["error"]["code"] == "NOT_FOUND")
        self.assertEqual((self.store.incidents, self.store.reports), before)
        self.assertTrue(all(call[0] in ("list", "incident", "reports") for call in self.store.calls))


class TestRegistryStrictReads(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Execute actual retrieval definitions without legacy module-level mkdir/dotenv.
        source = Path(__file__).resolve().parents[1] / "app" / "registry.py"
        tree = ast.parse(source.read_text())
        names = {"load_incidents", "get_incident_by_id", "load_nemotron_reports", "get_nemotron_reports_for_incident"}
        cls.functions = ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names], type_ignores=[])

    def setUp(self):
        self.db = Mock()
        self.ns = {**vars(typing), "datetime": datetime, "json": json, "logger": Mock(),
                   "is_cloud_mode": lambda: False, "is_demo_mode": lambda: True,
                   "default_db_manager": self.db, "_load_all_local_incidents": Mock(return_value=[incident(), incident("other", "session-b"), incident("shared", None)])}
        exec(compile(self.functions, "registry_read_functions", "exec"), self.ns)

    def test_strict_list_ignores_demo_bypass_locally(self):
        result = self.ns["load_incidents"]("session-a", exact_session=True)
        self.assertEqual([row["incident_id"] for row in result], ["incident-a"])
        self.assertEqual(len(self.ns["load_incidents"]("session-a")), 3)

    def test_strict_list_missing_session_before_db(self):
        with self.assertRaises(ValueError):
            self.ns["load_incidents"](exact_session=True)
        self.db.fetch_all.assert_not_called()

    def test_strict_cloud_filters_before_limit_and_stable_order(self):
        self.ns["is_cloud_mode"] = lambda: True
        self.db.fetch_all.return_value = []
        self.ns["load_incidents"]("session-a", exact_session=True)
        sql, params = self.db.fetch_all.call_args.args
        self.assertIn("WHERE session_id = %s", sql)
        self.assertNotIn("OR session_id", sql)
        self.assertIn("scanned_at DESC NULLS LAST, incident_id DESC", sql)
        self.assertEqual(params, ("session-a",))
        self.db.execute.assert_not_called()

    def test_strict_detail_no_global_fallback(self):
        self.ns["is_cloud_mode"] = lambda: True
        self.db.fetch_all.return_value = []
        self.ns["load_incidents"] = Mock(side_effect=AssertionError("Global fallback"))
        for iid in ("11111111-1111-4111-8111-111111111111", "local-id"):
            self.assertIsNone(self.ns["get_incident_by_id"](iid, strict_read=True))
        self.ns["load_incidents"].assert_not_called()

    def test_strict_read_failures_not_fake_empty(self):
        self.ns["_load_all_local_incidents"].side_effect = OSError("unavailable")
        with self.assertRaises(OSError):
            self.ns["load_incidents"]("session-a", exact_session=True)
        self.ns["is_cloud_mode"] = lambda: True
        self.db.fetch_all.side_effect = RuntimeError("unavailable")
        with self.assertRaises(RuntimeError):
            self.ns["get_incident_by_id"]("11111111-1111-4111-8111-111111111111", strict_read=True)

    def test_adapter_uses_only_strict_read_calls(self):
        module = Mock()
        adapter = RegistryReadStore(module)
        adapter.list_incidents("session-a")
        adapter.get_incident("incident-a")
        adapter.get_reports("incident-a")
        module.load_incidents.assert_called_once_with(session_id="session-a", exact_session=True)
        module.get_incident_by_id.assert_called_once_with("incident-a", strict_read=True)
        module.get_nemotron_reports_for_incident.assert_called_once_with("incident-a", strict_read=True)
        self.assertEqual(len(module.mock_calls), 3)

    def test_strict_report_file_errors_and_legacy_behavior(self):
        self.ns["NEMOTRON_REPORTS_FILE"] = Mock()
        self.ns["NEMOTRON_REPORTS_FILE"].exists.return_value = True
        with patch("builtins.open", mock_open(read_data="invalid json")):
            with self.assertRaises(ValueError):
                self.ns["load_nemotron_reports"](strict_read=True)
            self.assertEqual(self.ns["load_nemotron_reports"](), [])

    def test_actual_report_retrieval_filters_association_and_propagates_strict(self):
        loader = Mock(return_value=[{"incident_id": "incident-a", "report_id": "report-a"},
                                    {"incident_id": "incident-b", "report_id": "report-b"}])
        self.ns["load_nemotron_reports"] = loader
        reports = self.ns["get_nemotron_reports_for_incident"]("incident-a", strict_read=True)
        self.assertEqual([r["report_id"] for r in reports], ["report-a"])
        loader.assert_called_once_with(strict_read=True)
