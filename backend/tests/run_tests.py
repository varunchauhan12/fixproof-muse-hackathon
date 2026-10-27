"""
FixProof Test Runner for Milestone 1, 2, and 3.
"""

import sys
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def main():
    loader = unittest.TestLoader()
    suite = loader.discover(str(BACKEND_ROOT / "tests"), pattern="test_*.py")

    runner = unittest.TextTestRunner(stream=sys.stdout, verbosity=2)
    result = runner.run(suite)

    print("\n" + "=" * 60)
    print(f"TOTAL TESTS RUN: {result.testsRun}")
    print(f"FAILURES: {len(result.failures)}")
    print(f"ERRORS: {len(result.errors)}")
    print(f"SUCCESS: {result.wasSuccessful()}")
    print("=" * 60)

    if not result.wasSuccessful():
        sys.exit(1)


if __name__ == "__main__":
    main()
