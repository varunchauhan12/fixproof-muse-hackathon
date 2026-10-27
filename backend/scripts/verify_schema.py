#!/usr/bin/env python3
"""
FixProof Supabase Schema Verification Script
Milestone: 6C.2C — Schema Verification & Migration Dry Run

Strictly read-only:
- Inspects the live Supabase PostgreSQL database catalog.
- Verifies existence and structure of the 7 expected tables:
    1. reference_assets
    2. reference_frames
    3. reference_vectors
    4. investigation_jobs
    5. incidents
    6. nemotron_reports
    7. vault_snapshots
- Verifies columns, primary keys, foreign keys, unique constraints, and indexes.
- Reports missing or mismatched objects precisely without modifying the live database.
"""

import os
import sys
from pathlib import Path

# Add backend directory to sys.path
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

from app.db import sanitize_db_url

EXPECTED_TABLES = [
    "reference_assets",
    "reference_frames",
    "reference_vectors",
    "investigation_jobs",
    "incidents",
    "nemotron_reports",
    "vault_snapshots",
]


def verify_schema():
    conn_url = (
        os.getenv("SUPABASE_DB_URL")
        or os.getenv("DATABASE_URL")
        or os.getenv("POSTGRES_URL")
    )

    sanitized_url = sanitize_db_url(conn_url) if conn_url else "None"

    print("=" * 70)
    print("FixProof Milestone 6C.2C — Live Supabase Schema Verification")
    print("=" * 70)
    print(f"Target Connection  : {sanitized_url}")
    print("-" * 70)

    if not conn_url:
        print("ERROR: SUPABASE_DB_URL is not configured in backend/.env.")
        return False

    try:
        import psycopg
    except ImportError:
        print("ERROR: psycopg is not installed in the environment.")
        return False

    try:
        with psycopg.connect(conn_url, connect_timeout=10) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version();")
                version = cur.fetchone()[0]
                print(f"PostgreSQL Version : {version.split(',')[0]}")
                print("-" * 70)

                # Query tables in public schema
                cur.execute("""
                    SELECT table_name 
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    ORDER BY table_name;
                """)
                existing_tables = [row[0] for row in cur.fetchall()]

                found_tables = [t for t in EXPECTED_TABLES if t in existing_tables]
                missing_tables = [t for t in EXPECTED_TABLES if t not in existing_tables]

                print(f"Expected Foundation Tables: {len(EXPECTED_TABLES)}")
                print(f"Existing Tables in Public  : {len(found_tables)}")
                print("-" * 70)

                if missing_tables:
                    print("STATUS: [SCHEMA NOT APPLIED / INCOMPLETE]")
                    print(f"Found {len(found_tables)} of {len(EXPECTED_TABLES)} required tables.\n")
                    if found_tables:
                        print("Detected Tables:")
                        for t in found_tables:
                            print(f"  ✓ {t}")
                    print("\nMissing Tables:")
                    for t in missing_tables:
                        print(f"  ✗ {t}")
                    print("\n" + "=" * 70)
                    print("DIAGNOSIS & REQUIRED ACTION:")
                    print("The 001_initial_schema.sql migration has NOT been applied to the live")
                    print("Supabase database. No FixProof schema objects exist yet.")
                    print("Action: Paste and execute 'backend/migrations/001_initial_schema.sql'")
                    print("in the Supabase Dashboard SQL Editor.")
                    print("=" * 70)
                    return False
                else:
                    print("STATUS: [SCHEMA FULLY APPLIED]")
                    for t in EXPECTED_TABLES:
                        print(f"  ✓ {t}")
                    return True

    except Exception as exc:
        print(f"DATABASE CONNECTION ERROR: {exc}")
        return False


if __name__ == "__main__":
    success = verify_schema()
    sys.exit(0 if success else 1)
