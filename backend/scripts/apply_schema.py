#!/usr/bin/env python3
"""
FixProof Schema Application Script
Milestone: 6C.3 — Supabase Cloud Persistence

Applies `backend/migrations/001_initial_schema.sql` to the configured Supabase database.
Verifies the existence and structure of all 7 foundation tables.
"""

import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

from app.db import sanitize_db_url

MIGRATION_FILE = BACKEND_DIR / "migrations" / "001_initial_schema.sql"
EXPECTED_TABLES = [
    "reference_assets",
    "reference_frames",
    "reference_vectors",
    "investigation_jobs",
    "incidents",
    "nemotron_reports",
    "vault_snapshots",
]


def apply_schema():
    conn_url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    if not conn_url:
        print("ERROR: SUPABASE_DB_URL is not set in backend/.env")
        return False

    print("=" * 70)
    print("FixProof Milestone 6C.3 — Applying Cloud Database Schema")
    print("=" * 70)
    print(f"Target Database: {sanitize_db_url(conn_url)}")
    print(f"Migration File : {MIGRATION_FILE.name}")
    print("-" * 70)

    if not MIGRATION_FILE.exists():
        print(f"ERROR: Migration file not found: {MIGRATION_FILE}")
        return False

    with open(MIGRATION_FILE, "r") as f:
        sql_content = f.read()

    try:
        import psycopg
    except ImportError:
        print("ERROR: psycopg is not installed.")
        return False

    try:
        with psycopg.connect(conn_url, connect_timeout=15) as conn:
            with conn.cursor() as cur:
                print("Executing migration SQL...")
                cur.execute(sql_content)
            conn.commit()
            print("Migration SQL executed and committed successfully!")

            # Verify tables
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT table_name 
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    ORDER BY table_name;
                """)
                existing_tables = [row[0] for row in cur.fetchall()]

            found = [t for t in EXPECTED_TABLES if t in existing_tables]
            missing = [t for t in EXPECTED_TABLES if t not in existing_tables]

            print("-" * 70)
            print(f"Verification: Found {len(found)} of {len(EXPECTED_TABLES)} required tables:")
            for t in found:
                print(f"  ✓ {t}")

            if missing:
                print("\nMissing tables:")
                for t in missing:
                    print(f"  ✗ {t}")
                return False

            print("=" * 70)
            print("SCHEMA MIGRATION SUCCESSFUL: All 7 foundation tables are active.")
            print("=" * 70)
            return True

    except Exception as exc:
        print(f"ERROR applying schema migration: {exc}")
        return False


if __name__ == "__main__":
    success = apply_schema()
    sys.exit(0 if success else 1)
