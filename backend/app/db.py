"""
Database foundation and configuration module for FixProof.
Supports dual operational modes:
- 'local' (default): Ephemeral local filesystem and JSON registry (Milestones 1-6B).
- 'supabase': Cloud-persistent PostgreSQL on Supabase (Milestone 6C).

Guarantees:
- Local mode is the safe, un-configured default.
- Fail-fast validation: Selecting cloud mode without valid credentials raises a clear error.
- Strict isolation: Never silently falls back to local mode after cloud connection failure,
  preventing silent data divergence.
- Clean connection and transaction lifecycles with parameterized SQL execution.
"""

from contextlib import contextmanager
from dataclasses import dataclass
from enum import Enum
import logging
import os
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional, Tuple, Union
from urllib.parse import urlparse, urlunparse
from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)
else:
    load_dotenv()

logger = logging.getLogger(__name__)


class DBMode(str, Enum):
    LOCAL = "local"
    SUPABASE = "supabase"
    POSTGRES = "postgres"


class DatabaseError(Exception):
    """Base exception for all FixProof database errors."""
    pass


class DatabaseConfigurationError(DatabaseError):
    """Raised when cloud database mode is requested without required configuration."""
    pass


class DatabaseConnectionError(DatabaseError):
    """Raised when the database connection fails. Never silently falls back to local."""
    pass


class DatabaseOperationalError(DatabaseError):
    """Raised when an executed query or transaction encounters an operational error."""
    pass


@dataclass(frozen=True)
class DatabaseConfig:
    """Immutable database configuration resolved from environment variables."""
    mode: DBMode
    connection_url: Optional[str] = None
    ssl_mode: str = "require"
    connection_timeout_sec: int = 10
    max_connections: int = 10

    @property
    def is_cloud(self) -> bool:
        return self.mode in (DBMode.SUPABASE, DBMode.POSTGRES)


def get_db_config() -> DatabaseConfig:
    """
    Resolves the database configuration strictly from environment variables.
    Defaults safely to 'local' mode if unconfigured.
    """
    # Priority: FIXPROOF_DB_MODE > STORAGE_BACKEND > default ('local')
    raw_mode = os.getenv("FIXPROOF_DB_MODE") or os.getenv("STORAGE_BACKEND") or "local"
    raw_mode = raw_mode.strip().lower()

    if raw_mode in ("supabase", "cloud"):
        mode = DBMode.SUPABASE
    elif raw_mode in ("postgres", "postgresql"):
        mode = DBMode.POSTGRES
    elif raw_mode == "local":
        mode = DBMode.LOCAL
    else:
        raise DatabaseConfigurationError(
            f"Invalid database mode '{raw_mode}'. "
            f"Allowed modes: '{DBMode.LOCAL.value}', '{DBMode.SUPABASE.value}'."
        )

    if mode == DBMode.LOCAL:
        return DatabaseConfig(mode=DBMode.LOCAL)

    # Cloud mode requires connection credentials
    conn_url = (
        os.getenv("SUPABASE_DB_URL")
        or os.getenv("DATABASE_URL")
        or os.getenv("POSTGRES_URL")
    )

    if not conn_url:
        host = os.getenv("SUPABASE_DB_HOST")
        user = os.getenv("SUPABASE_DB_USER", "postgres")
        password = os.getenv("SUPABASE_DB_PASSWORD")
        db_name = os.getenv("SUPABASE_DB_NAME", "postgres")
        port = os.getenv("SUPABASE_DB_PORT", "5432")

        if host and password:
            conn_url = f"postgresql://{user}:{password}@{host}:{port}/{db_name}"

    if not conn_url:
        raise DatabaseConfigurationError(
            f"Database mode is set to '{mode.value}', but no connection credentials were provided. "
            f"Please set 'SUPABASE_DB_URL' (or 'DATABASE_URL') in your environment. "
            f"FixProof will not silently fall back to local mode to avoid divergent state."
        )

    ssl_mode = os.getenv("SUPABASE_DB_SSLMODE", "require")
    timeout = int(os.getenv("SUPABASE_DB_TIMEOUT_SEC", "10"))
    max_conn = int(os.getenv("SUPABASE_DB_MAX_CONNECTIONS", "10"))

    return DatabaseConfig(
        mode=mode,
        connection_url=conn_url,
        ssl_mode=ssl_mode,
        connection_timeout_sec=timeout,
        max_connections=max_conn,
    )


class DatabaseManager:
    """
    Manages database connection lifecycles, transactions, and parameterized SQL.
    Does not replace local registry storage when mode is 'local'.
    """

    def __init__(self, config: Optional[DatabaseConfig] = None):
        self._explicit_config = config
        self._pool: Optional[Any] = None

    @property
    def config(self) -> DatabaseConfig:
        if self._explicit_config is not None:
            return self._explicit_config
        return get_db_config()

    @property
    def is_cloud(self) -> bool:
        return self.config.is_cloud

    def connect(self) -> Any:
        """
        Creates a raw database connection.
        Only valid in cloud mode ('supabase' / 'postgres').
        """
        cfg = self.config
        if not cfg.is_cloud:
            raise DatabaseOperationalError(
                "Direct database connection is not applicable in 'local' mode. "
                "Local mode utilizes the local JSON registry and filesystem storage."
            )

        try:
            import psycopg
            conn = psycopg.connect(
                cfg.connection_url,
                connect_timeout=cfg.connection_timeout_sec,
                autocommit=False,
            )
            return conn
        except ImportError:
            raise DatabaseOperationalError(
                "PostgreSQL driver 'psycopg' is not installed. "
                "Please install 'psycopg[binary]' to connect to Supabase PostgreSQL."
            )
        except Exception as e:
            logger.error(f"[Database] Failed to connect to cloud database: {e}")
            # Strict guarantee: never silently fall back to local mode
            raise DatabaseConnectionError(
                f"Failed to connect to Supabase PostgreSQL ({cfg.mode.value}): {e}"
            ) from e

    @contextmanager
    def get_connection(self) -> Generator[Any, None, None]:
        """
        Context manager providing a database connection.
        Closes connection safely on exit and rolls back uncommitted changes on error.
        """
        conn = self.connect()
        try:
            yield conn
        except Exception:
            try:
                conn.rollback()
            except Exception as rb_err:
                logger.warning(f"[Database] Rollback failed: {rb_err}")
            raise
        finally:
            try:
                conn.close()
            except Exception as close_err:
                logger.warning(f"[Database] Connection close error: {close_err}")

    @contextmanager
    def transaction(self) -> Generator[Any, None, None]:
        """
        Context manager for an atomic database transaction.
        Commits automatically on success, rolls back automatically on any exception.
        """
        with self.get_connection() as conn:
            try:
                yield conn
                conn.commit()
            except Exception as err:
                conn.rollback()
                raise DatabaseOperationalError(f"Transaction failed and was rolled back: {err}") from err

    def execute(self, query: str, params: Union[Tuple[Any, ...], Dict[str, Any]] = ()) -> int:
        """
        Executes a parameterized statement within an atomic transaction.
        Returns the number of affected rows.
        """
        with self.transaction() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                return cur.rowcount

    def fetch_one(
        self, query: str, params: Union[Tuple[Any, ...], Dict[str, Any]] = ()
    ) -> Optional[Dict[str, Any]]:
        """
        Executes a query and returns a single row as a dictionary, or None if no rows match.
        """
        with self.get_connection() as conn:
            from psycopg.rows import dict_row
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(query, params)
                row = cur.fetchone()
                return dict(row) if row else None

    def fetch_all(
        self, query: str, params: Union[Tuple[Any, ...], Dict[str, Any]] = ()
    ) -> List[Dict[str, Any]]:
        """
        Executes a query and returns all matching rows as a list of dictionaries.
        """
        with self.get_connection() as conn:
            from psycopg.rows import dict_row
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(query, params)
                return [dict(row) for row in cur.fetchall()]


# Global default database manager
default_db_manager = DatabaseManager()


def sanitize_db_url(url: Optional[str]) -> str:
    """
    Returns the database connection URL with the password safely masked.
    e.g. postgresql://user:secret@host:5432/db -> postgresql://user:****@host:5432/db
    """
    if not url:
        return "<none>"
    try:
        parsed = urlparse(url)
        if not parsed.netloc:
            return "<invalid-url>"
        if parsed.password:
            user = parsed.username or "postgres"
            host = parsed.hostname or "unknown"
            port_str = f":{parsed.port}" if parsed.port else ""
            netloc = f"{user}:****@{host}{port_str}"
            return urlunparse((
                parsed.scheme,
                netloc,
                parsed.path,
                parsed.params,
                parsed.query,
                parsed.fragment,
            ))
        return url
    except Exception:
        return "<masked-url>"


def check_db_connectivity(
    connection_url: Optional[str] = None,
    db_manager: Optional[DatabaseManager] = None,
) -> Dict[str, Any]:
    """
    Performs a non-destructive, read-only connectivity check against PostgreSQL.
    Reports connection status, server version, database name, and detected FixProof tables.
    Never exposes passwords or sensitive credentials in reports or logs.
    """
    if connection_url:
        target_cfg = DatabaseConfig(mode=DBMode.SUPABASE, connection_url=connection_url)
        manager = DatabaseManager(target_cfg)
    elif db_manager:
        manager = db_manager
    else:
        cfg = get_db_config()
        cloud_url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
        if not cfg.is_cloud and cloud_url:
            target_cfg = DatabaseConfig(mode=DBMode.SUPABASE, connection_url=cloud_url)
            manager = DatabaseManager(target_cfg)
        else:
            manager = default_db_manager

    cfg = manager.config
    sanitized = sanitize_db_url(cfg.connection_url)

    if not cfg.is_cloud:
        return {
            "connected": False,
            "mode": cfg.mode.value,
            "sanitized_url": "<none>",
            "server_version": None,
            "database_name": None,
            "user": None,
            "schema_tables_found": [],
            "schema_ready": False,
            "error": (
                "Database mode is 'local' and no SUPABASE_DB_URL or DATABASE_URL "
                "is set in backend/.env. To test your Supabase connection, set SUPABASE_DB_URL."
            ),
        }

    try:
        with manager.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version(), current_database(), current_user;")
                row = cur.fetchone()
                version = row[0] if row else "unknown"
                db_name = row[1] if row else "unknown"
                user = row[2] if row else "unknown"

                cur.execute("""
                    SELECT table_name 
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name IN (
                        'reference_assets', 'reference_frames', 'reference_vectors',
                        'investigation_jobs', 'incidents', 'nemotron_reports', 'vault_snapshots'
                    )
                    ORDER BY table_name;
                """)
                tables = [r[0] for r in cur.fetchall()]
                expected_tables = {
                    'reference_assets', 'reference_frames', 'reference_vectors',
                    'investigation_jobs', 'incidents', 'nemotron_reports', 'vault_snapshots'
                }
                schema_ready = expected_tables.issubset(set(tables))

                return {
                    "connected": True,
                    "mode": cfg.mode.value,
                    "sanitized_url": sanitized,
                    "server_version": version,
                    "database_name": db_name,
                    "user": user,
                    "schema_tables_found": tables,
                    "schema_ready": schema_ready,
                    "error": None,
                }
    except Exception as e:
        err_msg = str(e)
        if cfg.connection_url and cfg.connection_url in err_msg:
            err_msg = err_msg.replace(cfg.connection_url, sanitized)
        return {
            "connected": False,
            "mode": cfg.mode.value,
            "sanitized_url": sanitized,
            "server_version": None,
            "database_name": None,
            "user": None,
            "schema_tables_found": [],
            "schema_ready": False,
            "error": err_msg,
        }
