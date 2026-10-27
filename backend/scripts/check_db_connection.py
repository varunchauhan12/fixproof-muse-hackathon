#!/usr/bin/env python3
"""
FixProof Database Connectivity Verification Script
Milestone: 6C.2B

Verifies non-destructive read-only connectivity to Supabase PostgreSQL.
- Reads connection details from backend/.env (SUPABASE_DB_URL or DATABASE_URL).
- Masks all passwords in output and logs.
- Reports server version, database name, connected user, and presence of FixProof tables.
- Does NOT execute any destructive SQL or alter local data.
"""

import argparse
import sys
from pathlib import Path

# Add backend directory to sys.path
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

from app.db import check_db_connectivity, sanitize_db_url


def main():
    parser = argparse.ArgumentParser(
        description="Verify Supabase PostgreSQL database connectivity for FixProof (safe, read-only)."
    )
    parser.add_argument(
        "--url",
        type=str,
        default=None,
        help="Optional database connection URI to test directly (passwords will be masked).",
    )
    args = parser.parse_args()

    print("=" * 70)
    print("FixProof Cloud Database Connectivity Check")
    print("=" * 70)

    result = check_db_connectivity(connection_url=args.url)

    print(f"Operational Mode  : {result['mode'].upper()}")
    print(f"Target Connection : {result['sanitized_url']}")
    print("-" * 70)

    if result["connected"]:
        print("STATUS: [CONNECTED] Successfully connected to PostgreSQL!")
        print(f"Connected User    : {result['user']}")
        print(f"Database Name     : {result['database_name']}")
        print(f"PostgreSQL Version: {result['server_version']}")
        print("-" * 70)

        found = result["schema_tables_found"]
        expected_count = 7
        if result["schema_ready"]:
            print(f"FixProof Schema   : [READY] All {expected_count} foundation tables detected:")
            for tbl in found:
                print(f"  ✓ {tbl}")
        elif found:
            print(f"FixProof Schema   : [PARTIAL] Found {len(found)} of {expected_count} tables:")
            for tbl in found:
                print(f"  ✓ {tbl}")
            print("\nAction Required:")
            print("  Apply 'backend/migrations/001_initial_schema.sql' in the Supabase SQL Editor.")
        else:
            print("FixProof Schema   : [EMPTY / NOT DETECTED] No FixProof tables found in public schema.")
            print("\nAction Required:")
            print("  Apply 'backend/migrations/001_initial_schema.sql' in the Supabase SQL Editor.")

        print("=" * 70)
        sys.exit(0)
    else:
        print("STATUS: [FAILED] Could not connect to PostgreSQL database.")
        print(f"Error Details     : {result['error']}")
        print("-" * 70)
        print("Troubleshooting Guidance:")
        print("1. Check that 'SUPABASE_DB_URL' is set in 'backend/.env'.")
        print("2. Ensure you used the Connection Pooler URI (port 6543) for IPv4 compatibility:")
        print("   postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres")
        print("3. Verify that your database password does not contain unencoded special characters.")
        print("4. Ensure your project is not paused in the Supabase Dashboard.")
        print("=" * 70)
        sys.exit(1)


if __name__ == "__main__":
    main()
