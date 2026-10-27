"""
Unit and integration tests for FixProof Database Foundation and Migration Schema.
Milestone: 6C.2A (Safe Database Foundation)

Covers:
- Configuration resolution and local mode default behavior.
- Fail-fast validation when cloud mode lacks credentials.
- Strict isolation (zero silent fallback to local mode on cloud connection error).
- Parameterized SQL execution and transaction commit/rollback lifecycles.
- Migration SQL syntax, table definitions, constraints, indexes, and vector mappings.
- Physical separation of reference assets vs. suspect investigations.
"""

import os
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

from app.db import (
    DBMode,
    DatabaseConfig,
    DatabaseConfigurationError,
    DatabaseConnectionError,
    DatabaseManager,
    DatabaseOperationalError,
    check_db_connectivity,
    get_db_config,
    sanitize_db_url,
)


class TestDatabaseConfiguration(unittest.TestCase):
    """Verifies environment variable resolution and mode defaults."""

    def setUp(self):
        # Save original environment
        self._orig_env = os.environ.copy()
        # Clean test-specific vars
        for k in [
            "FIXPROOF_DB_MODE",
            "STORAGE_BACKEND",
            "SUPABASE_DB_URL",
            "DATABASE_URL",
            "POSTGRES_URL",
            "SUPABASE_DB_HOST",
            "SUPABASE_DB_USER",
            "SUPABASE_DB_PASSWORD",
            "SUPABASE_DB_NAME",
            "SUPABASE_DB_PORT",
        ]:
            os.environ.pop(k, None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._orig_env)

    def test_local_mode_is_default(self):
        """When no configuration is set, FixProof defaults safely to 'local' mode."""
        config = get_db_config()
        self.assertEqual(config.mode, DBMode.LOCAL)
        self.assertFalse(config.is_cloud)
        self.assertIsNone(config.connection_url)

    def test_explicit_local_mode_via_fixproof_db_mode(self):
        """Explicit FIXPROOF_DB_MODE='local' resolves to local mode."""
        os.environ["FIXPROOF_DB_MODE"] = "local"
        config = get_db_config()
        self.assertEqual(config.mode, DBMode.LOCAL)
        self.assertFalse(config.is_cloud)

    def test_explicit_local_mode_via_storage_backend(self):
        """Explicit STORAGE_BACKEND='local' resolves to local mode."""
        os.environ["STORAGE_BACKEND"] = "local"
        config = get_db_config()
        self.assertEqual(config.mode, DBMode.LOCAL)
        self.assertFalse(config.is_cloud)

    def test_invalid_mode_raises_configuration_error(self):
        """Invalid modes raise DatabaseConfigurationError."""
        os.environ["FIXPROOF_DB_MODE"] = "unsupported_storage_engine"
        with self.assertRaises(DatabaseConfigurationError) as ctx:
            get_db_config()
        self.assertIn("Invalid database mode", str(ctx.exception))

    def test_supabase_mode_missing_credentials_fails_clearly(self):
        """Selecting 'supabase' mode without credentials fails fast with an informative error."""
        os.environ["FIXPROOF_DB_MODE"] = "supabase"
        with self.assertRaises(DatabaseConfigurationError) as ctx:
            get_db_config()
        self.assertIn("no connection credentials were provided", str(ctx.exception))
        self.assertIn("SUPABASE_DB_URL", str(ctx.exception))

    def test_supabase_mode_with_supabase_db_url(self):
        """Valid SUPABASE_DB_URL configures cloud database properly."""
        os.environ["FIXPROOF_DB_MODE"] = "supabase"
        test_url = "postgresql://postgres:secretpass@db.example.supabase.co:5432/postgres"
        os.environ["SUPABASE_DB_URL"] = test_url

        config = get_db_config()
        self.assertEqual(config.mode, DBMode.SUPABASE)
        self.assertTrue(config.is_cloud)
        self.assertEqual(config.connection_url, test_url)

    def test_supabase_mode_with_database_url_fallback(self):
        """Standard DATABASE_URL is recognized for Supabase PostgreSQL poolers."""
        os.environ["STORAGE_BACKEND"] = "supabase"
        test_url = "postgresql://postgres:poolpass@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
        os.environ["DATABASE_URL"] = test_url

        config = get_db_config()
        self.assertEqual(config.mode, DBMode.SUPABASE)
        self.assertTrue(config.is_cloud)
        self.assertEqual(config.connection_url, test_url)

    def test_supabase_mode_with_discrete_credentials(self):
        """Discrete host, user, password parameters resolve into a connection URL."""
        os.environ["FIXPROOF_DB_MODE"] = "supabase"
        os.environ["SUPABASE_DB_HOST"] = "db.xyz.supabase.co"
        os.environ["SUPABASE_DB_USER"] = "postgres"
        os.environ["SUPABASE_DB_PASSWORD"] = "mypassword123"
        os.environ["SUPABASE_DB_PORT"] = "5432"
        os.environ["SUPABASE_DB_NAME"] = "postgres"

        config = get_db_config()
        self.assertEqual(config.mode, DBMode.SUPABASE)
        self.assertTrue(config.is_cloud)
        self.assertIn("postgresql://postgres:mypassword123@db.xyz.supabase.co:5432/postgres", config.connection_url)


class TestDatabaseManagerOperations(unittest.TestCase):
    """Tests connection lifecycles, parameterized execution, and transaction rollbacks."""

    def test_local_mode_manager_connect_raises_operational_error(self):
        """Direct connection calls in local mode raise a clear operational error."""
        local_cfg = DatabaseConfig(mode=DBMode.LOCAL)
        manager = DatabaseManager(local_cfg)
        self.assertFalse(manager.is_cloud)

        with self.assertRaises(DatabaseOperationalError) as ctx:
            manager.connect()
        self.assertIn("not applicable in 'local' mode", str(ctx.exception))

    @patch("psycopg.connect")
    def test_cloud_connection_failure_raises_connection_error_without_fallback(self, mock_connect):
        """
        Critical requirement: Database failures must raise DatabaseConnectionError
        and NEVER silently fall back to local mode.
        """
        mock_connect.side_effect = Exception("Connection refused by remote host")
        cloud_cfg = DatabaseConfig(
            mode=DBMode.SUPABASE,
            connection_url="postgresql://user:pass@host:5432/db"
        )
        manager = DatabaseManager(cloud_cfg)

        with self.assertRaises(DatabaseConnectionError) as ctx:
            manager.connect()
        self.assertIn("Failed to connect to Supabase PostgreSQL", str(ctx.exception))

    @patch("psycopg.connect")
    def test_parameterized_execute_commits_in_transaction(self, mock_connect):
        """Parameterized execute runs query and commits successfully."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.rowcount = 1
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_connect.return_value = mock_conn

        cloud_cfg = DatabaseConfig(
            mode=DBMode.SUPABASE,
            connection_url="postgresql://user:pass@host:5432/db"
        )
        manager = DatabaseManager(cloud_cfg)

        query = "UPDATE reference_assets SET indexing_status = %s WHERE asset_id = %s"
        params = ("INDEXED", "11111111-1111-1111-1111-111111111111")
        affected = manager.execute(query, params)

        self.assertEqual(affected, 1)
        mock_cursor.execute.assert_called_once_with(query, params)
        mock_conn.commit.assert_called_once()
        mock_conn.close.assert_called_once()

    @patch("psycopg.connect")
    def test_transaction_rolls_back_on_error(self, mock_connect):
        """Transaction rolls back and raises DatabaseOperationalError when statement fails."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.execute.side_effect = Exception("Foreign key violation")
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_connect.return_value = mock_conn

        cloud_cfg = DatabaseConfig(
            mode=DBMode.SUPABASE,
            connection_url="postgresql://user:pass@host:5432/db"
        )
        manager = DatabaseManager(cloud_cfg)

        with self.assertRaises(DatabaseOperationalError) as ctx:
            manager.execute("INSERT INTO reference_frames (asset_id) VALUES (%s)", ("bad-id",))

        self.assertIn("Transaction failed and was rolled back", str(ctx.exception))
        mock_conn.rollback.assert_called()
        mock_conn.close.assert_called()

    @patch("psycopg.connect")
    def test_fetch_one_returns_dict_or_none(self, mock_connect):
        """fetch_one returns dictionary row or None if empty."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchone.side_effect = [
            {"asset_id": "test-uuid", "filename": "clip.mp4"},
            None,
        ]
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_connect.return_value = mock_conn

        cloud_cfg = DatabaseConfig(
            mode=DBMode.SUPABASE,
            connection_url="postgresql://user:pass@host:5432/db"
        )
        manager = DatabaseManager(cloud_cfg)

        res1 = manager.fetch_one("SELECT * FROM reference_assets WHERE asset_id = %s", ("test-uuid",))
        self.assertEqual(res1, {"asset_id": "test-uuid", "filename": "clip.mp4"})

        res2 = manager.fetch_one("SELECT * FROM reference_assets WHERE asset_id = %s", ("missing",))
        self.assertIsNone(res2)


class TestMigrationSchemaStructure(unittest.TestCase):
    """Parses and validates the versioned 001_initial_schema.sql file."""

    @classmethod
    def setUpClass(cls):
        migration_file = Path(__file__).resolve().parent.parent / "migrations" / "001_initial_schema.sql"
        cls.assertTrue(cls, migration_file.exists(), f"Migration file missing: {migration_file}")
        with open(migration_file, "r", encoding="utf-8") as f:
            cls.schema_sql = f.read()

    def test_migration_creates_all_required_tables(self):
        """Verify all 7 required foundation tables are declared with IF NOT EXISTS."""
        expected_tables = [
            "reference_assets",
            "reference_frames",
            "reference_vectors",
            "investigation_jobs",
            "incidents",
            "nemotron_reports",
            "vault_snapshots",
        ]
        for tbl in expected_tables:
            pattern = f"CREATE TABLE IF NOT EXISTS {tbl}"
            self.assertIn(pattern, self.schema_sql, f"Table declaration missing: {pattern}")

    def test_reference_assets_constraints(self):
        """Verify reference_assets has file size check, status checks, and UUID primary key."""
        self.assertIn("asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid()", self.schema_sql)
        self.assertIn("52428800", self.schema_sql)  # 50 MB limit
        self.assertIn("'PENDING_UPLOAD', 'UPLOADED', 'INDEXING', 'INDEXED', 'FAILED', 'DELETED'", self.schema_sql)

    def test_reference_frames_cascades_on_asset_delete(self):
        """Verify reference_frames has ON DELETE CASCADE from reference_assets."""
        self.assertIn("REFERENCES reference_assets(asset_id) ON DELETE CASCADE", self.schema_sql)
        self.assertIn("CONSTRAINT uq_asset_frame_index UNIQUE (asset_id, frame_index)", self.schema_sql)

    def test_vector_table_stability_and_embedding_dim(self):
        """
        Verify vector table uses stable logical UUID primary key,
        explicit FAISS index position, and 576-dim byte vector.
        """
        self.assertIn("vector_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid()", self.schema_sql)
        self.assertIn("faiss_index_position INTEGER", self.schema_sql)
        self.assertIn("embedding_dim INTEGER NOT NULL DEFAULT 576 CHECK (embedding_dim = 576)", self.schema_sql)
        self.assertIn("embedding_vector BYTEA NOT NULL", self.schema_sql)
        self.assertIn("CONSTRAINT uq_reference_vector_frame UNIQUE (asset_id, frame_id)", self.schema_sql)

    def test_separation_of_reference_and_suspect_media(self):
        """
        Verify strict logical separation:
        Suspect tables (investigation_jobs, incidents) have NO foreign keys into reference_vectors.
        Reference vectors strictly reference reference_assets.
        """
        self.assertIn("CREATE TABLE IF NOT EXISTS investigation_jobs", self.schema_sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS incidents", self.schema_sql)

        # Confirm reference_vectors references reference_assets and reference_frames
        self.assertIn("REFERENCES reference_assets(asset_id) ON DELETE CASCADE", self.schema_sql)
        self.assertIn("REFERENCES reference_frames(frame_id) ON DELETE CASCADE", self.schema_sql)

        # Confirm incidents references investigation_jobs, not reference_assets
        self.assertIn("job_id UUID REFERENCES investigation_jobs(job_id) ON DELETE SET NULL", self.schema_sql)

    def test_nemotron_reports_foreign_key_and_actions(self):
        """Verify nemotron_reports references incidents with cascading delete and valid actions."""
        self.assertIn("incident_id UUID NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE", self.schema_sql)
        self.assertIn("'ESCALATE_LEGAL_TAKEDOWN'", self.schema_sql)
        self.assertIn("'NEEDS_FULL_VIDEO_REVIEW'", self.schema_sql)
        self.assertIn("'DISMISS_FAIR_USE'", self.schema_sql)

    def test_vault_snapshots_table_structure(self):
        """Verify vault_snapshots tracks versions, vector counts, and sha256 checksums."""
        self.assertIn("version_number INTEGER NOT NULL UNIQUE", self.schema_sql)
        self.assertIn("total_vectors INTEGER NOT NULL", self.schema_sql)
        self.assertIn("sha256_checksum VARCHAR(64) NOT NULL", self.schema_sql)


class TestConnectivityCheck(unittest.TestCase):
    """Verifies that connectivity checking is safe, opt-in, masks credentials, and detects schema."""

    def test_sanitize_db_url_masks_password(self):
        """Verify sanitize_db_url masks plain and special-character passwords."""
        raw_url = "postgresql://postgres.myproject:SuperSecretPassword123!@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
        sanitized = sanitize_db_url(raw_url)
        self.assertNotIn("SuperSecretPassword123!", sanitized)
        self.assertIn("postgres.myproject:****@aws-0-us-east-1.pooler.supabase.com:6543/postgres", sanitized)

    def test_sanitize_db_url_handles_edge_cases(self):
        """Verify sanitize_db_url handles None, empty, and password-less URLs gracefully."""
        self.assertEqual(sanitize_db_url(None), "<none>")
        self.assertEqual(sanitize_db_url(""), "<none>")
        no_pass = "postgresql://localhost:5432/postgres"
        self.assertEqual(sanitize_db_url(no_pass), no_pass)

    def test_check_connectivity_in_local_mode_without_url(self):
        """In local mode without a cloud URL, returns clean failure without throwing."""
        with patch.dict(os.environ, {"FIXPROOF_DB_MODE": "local"}, clear=True):
            result = check_db_connectivity()
            self.assertFalse(result["connected"])
            self.assertEqual(result["mode"], "local")
            self.assertIn("Database mode is 'local'", result["error"])

    @patch("psycopg.connect")
    def test_check_connectivity_successful_and_detects_tables(self, mock_connect):
        """When PostgreSQL responds, reports server version, user, and schema readiness."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()

        # 1st call: version, db, user
        # 2nd call: list of tables
        mock_cursor.fetchone.return_value = (
            "PostgreSQL 15.1 on aarch64-unknown-linux-gnu",
            "postgres",
            "postgres",
        )
        mock_cursor.fetchall.return_value = [
            ("incidents",),
            ("investigation_jobs",),
            ("nemotron_reports",),
            ("reference_assets",),
            ("reference_frames",),
            ("reference_vectors",),
            ("vault_snapshots",),
        ]
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_connect.return_value = mock_conn

        test_url = "postgresql://postgres:secretpass@db.example.supabase.co:5432/postgres"
        result = check_db_connectivity(connection_url=test_url)

        self.assertTrue(result["connected"])
        self.assertNotIn("secretpass", result["sanitized_url"])
        self.assertIn("postgres:****@db.example.supabase.co:5432/postgres", result["sanitized_url"])
        self.assertIn("PostgreSQL 15.1", result["server_version"])
        self.assertEqual(result["database_name"], "postgres")
        self.assertEqual(result["user"], "postgres")
        self.assertTrue(result["schema_ready"])
        self.assertEqual(len(result["schema_tables_found"]), 7)

    @patch("psycopg.connect")
    def test_check_connectivity_failure_masks_password_in_error(self, mock_connect):
        """When connection fails, passwords in exceptions or URLs are masked."""
        secret_url = "postgresql://postgres:MyVerySecretPass@db.fail.supabase.co:5432/postgres"
        mock_connect.side_effect = Exception(f"Failed to connect to {secret_url}: Timeout expired")

        result = check_db_connectivity(connection_url=secret_url)

        self.assertFalse(result["connected"])
        self.assertNotIn("MyVerySecretPass", result["error"])
        self.assertIn("****@", result["error"])


if __name__ == "__main__":
    unittest.main()
