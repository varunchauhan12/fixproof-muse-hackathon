"""Explicitly initialize only an empty Supabase project's application schema.

No application imports: importing the vault can reconcile persistent cloud state.
Storage buckets are created separately through the Supabase console.
"""
import argparse
import os
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
import psycopg

BACKEND = Path(__file__).resolve().parents[1]
TABLES = (
    "reference_assets", "reference_frames", "reference_vectors",
    "investigation_jobs", "incidents", "nemotron_reports", "vault_snapshots",
    "vision_verifications", "evidence_packages",
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-new-project", required=True, metavar="PROJECT_REF")
    parser.add_argument("--apply", action="store_true", help="Apply after the read-only preflight")
    args = parser.parse_args()
    load_dotenv(BACKEND / ".env")
    url = os.environ.get("SUPABASE_URL", "")
    db_url = os.environ.get("SUPABASE_DB_URL", "")
    ref = args.confirm_new_project
    if urlparse(url).hostname != f"{ref}.supabase.co":
        raise SystemExit("Refused: SUPABASE_URL does not match the confirmed project.")
    db = urlparse(db_url)
    if not (db.hostname == f"db.{ref}.supabase.co" or db.username == f"postgres.{ref}"):
        raise SystemExit("Refused: database URL cannot be tied to the confirmed project.")
    try:
        with psycopg.connect(db_url, sslmode="require", connect_timeout=15) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
                if cur.fetchall():
                    raise SystemExit("Refused: public schema already contains tables. Use a reviewed migration process.")
                print("Confirmed project has an empty public schema.")
                if not args.apply:
                    print("Preflight only; no schema changes. Add --apply to initialize.")
                    return
                for name in ("001_initial_schema.sql", "002_cloud_persistence_expansion.sql"):
                    cur.execute((BACKEND / "migrations" / name).read_text())
                # The backend owns access; do not expose new project data through the Data API.
                for table in TABLES:
                    cur.execute(f'REVOKE ALL ON TABLE public."{table}" FROM anon, authenticated')
                cur.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
                if not set(TABLES).issubset({row[0] for row in cur.fetchall()}):
                    raise RuntimeError("Required table verification failed")
            print("Created and verified nine application tables; committing transaction.")
    except Exception:
        # Database exceptions can contain connection strings; keep credentials out of logs.
        raise SystemExit("Initialization failed; transaction rolled back. Check database connectivity and schema permissions.") from None


if __name__ == "__main__":
    main()
