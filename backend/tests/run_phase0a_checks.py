"""Run provider checks in a disposable backend copy without .env or live services.

Examples (from repository root):
  backend/.venv/bin/python backend/tests/run_phase0a_checks.py
  backend/.venv/bin/python backend/tests/run_phase0a_checks.py --full
  backend/.venv/bin/python backend/tests/run_phase0a_checks.py --full --baseline
"""
import argparse
import io
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--security", action="store_true", help="Run Phase 0B security regressions")
    parser.add_argument("--meta", action="store_true", help="Run mocked Stage A Meta provider checks")
    parser.add_argument("--reasoning", action="store_true", help="Run Stage B reasoning migration checks")
    parser.add_argument("--vision", action="store_true", help="Run mocked Stage C vision migration checks")
    parser.add_argument("--repair", action="store_true", help="Run isolated real-video and persistence repair checks")
    parser.add_argument("--baseline", action="store_true", help="Test committed HEAD instead of working code")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="fixproof-offline-") as tmp:
        for name in ("app", "tests", "migrations"):
            shutil.copytree(root / name, Path(tmp) / name, ignore=shutil.ignore_patterns("__pycache__"))
        for video in root.glob("*.mp4"):
            shutil.copy2(video, tmp)
        if args.baseline:
            tracked = subprocess.check_output(["git", "ls-files", "backend/app", "backend/tests", "backend/migrations"], cwd=root.parent).decode().splitlines()
            # Do not include newly added tests when testing the committed baseline.
            shutil.rmtree(Path(tmp) / "tests")
            for name in tracked:
                target = Path(tmp) / Path(name).relative_to("backend")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(subprocess.check_output(["git", "show", "HEAD:" + name], cwd=root.parent))
        os.chdir(tmp)
        sys.path.insert(0, tmp)
        for key in list(os.environ):
            if key.startswith(("SUPABASE", "NEBIUS", "RESEND", "FIXPROOF", "MUSE_")) or key in ("MODEL_API_KEY", "DATABASE_URL", "POSTGRES_URL", "STORAGE_BACKEND"):
                os.environ.pop(key)
        os.environ["FIXPROOF_DB_MODE"] = "local"
        # Dedicated security tests exercise low quotas; other tests are not load tests.
        os.environ["FIXPROOF_RATE_LIMIT_PER_MINUTE"] = "10000"
        logging.disable(logging.CRITICAL)
        def deny_network(*_args, **_kwargs):
            raise RuntimeError("External networking disabled for offline tests")
        with patch("dotenv.load_dotenv", return_value=False), patch("socket.socket.connect", side_effect=deny_network):
            if args.repair:
                suite = unittest.defaultTestLoader.loadTestsFromName("tests.test_pipeline_repair")
            elif args.vision:
                suite = unittest.defaultTestLoader.loadTestsFromName("tests.test_meta_vision_migration")
            elif args.reasoning:
                suite = unittest.defaultTestLoader.loadTestsFromName("tests.test_meta_reasoning_migration")
            elif args.meta:
                suite = unittest.defaultTestLoader.loadTestsFromName("tests.test_meta_provider")
            elif args.security:
                suite = unittest.defaultTestLoader.loadTestsFromName("tests.test_security_foundations")
            elif args.full:
                suite = unittest.defaultTestLoader.discover("tests", pattern="test_*.py")
            else:
                suite = unittest.defaultTestLoader.loadTestsFromNames([
                    "tests.test_provider_parity", "tests.test_factory_wiring",
                    "tests.test_vision_verifier", "tests.test_nemotron_engine",
                    "tests.test_nemotron_action", "tests.test_detailed_report",
                    "tests.test_evidence_package", "tests.test_url_screener",
                ])
            output = io.StringIO()
            result = unittest.TextTestRunner(stream=output, verbosity=0).run(suite)
            print("Baseline:" if args.baseline else "Working tree:", "tests", result.testsRun,
                  "failures", len(result.failures), "errors", len(result.errors), "skips", len(result.skipped))
            for test, traceback in result.failures + result.errors:
                print(test.id(), "=>", traceback.strip().splitlines()[-1])
            return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
