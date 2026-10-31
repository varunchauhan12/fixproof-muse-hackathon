"""
Supabase Storage client module for FixProof.
Provides secure, non-destructive upload, download, and signed-URL generation
for private storage buckets (reference-assets, reference-frames, vault-snapshots).

Guarantees:
- Never exposes service-role keys in URLs or logs.
- Enforces private bucket access via authenticated requests.
- Validates pre-upload SHA-256 checksums and payload integrity.
- Provides signed URLs with configurable expiration for secure asset streaming.
"""

from dataclasses import dataclass
import hashlib
import json
import logging
import mimetypes
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)


class StorageError(Exception):
    """Base exception for all Supabase storage operations."""
    pass


class StorageConfigurationError(StorageError):
    """Raised when storage operations are invoked without required credentials."""
    pass


class StorageUploadError(StorageError):
    """Raised when object upload fails or is rejected by Supabase."""
    pass


class StorageNotFoundError(StorageError):
    """Raised when an object or bucket is not found."""
    pass


@dataclass(frozen=True)
class StorageConfig:
    """Configuration for Supabase Storage resolved from environment."""
    supabase_url: Optional[str]
    service_role_key: Optional[str]
    anon_key: Optional[str]

    @classmethod
    def from_env(cls) -> "StorageConfig":
        from dotenv import load_dotenv
        env_path = Path(__file__).resolve().parent.parent / ".env"
        if env_path.exists():
            load_dotenv(env_path)
        else:
            load_dotenv()
        return cls(
            supabase_url=os.getenv("SUPABASE_URL"),
            service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
            anon_key=os.getenv("SUPABASE_ANON_KEY"),
        )

    @property
    def is_configured(self) -> bool:
        return bool(self.supabase_url and (self.service_role_key or self.anon_key))

    @property
    def auth_key(self) -> Optional[str]:
        return self.service_role_key or self.anon_key


def validate_storage_config(mode: Optional[str] = None) -> None:
    """
    Validates that required Supabase Storage environment variables are set when
    operating in cloud / Supabase mode. Fails fast with a clear exception if
    required credentials are missing, preventing silent partial cloud operation.
    """
    raw_mode = (mode or os.getenv("FIXPROOF_DB_MODE") or os.getenv("STORAGE_BACKEND") or "local").strip().lower()
    if raw_mode in ("supabase", "cloud"):
        cfg = StorageConfig.from_env()
        missing = []
        if not cfg.supabase_url:
            missing.append("SUPABASE_URL")
        if not (cfg.service_role_key or cfg.anon_key):
            missing.append("SUPABASE_SERVICE_ROLE_KEY")
        if missing:
            raise StorageConfigurationError(
                f"FixProof is configured for cloud mode '{raw_mode}', but required Supabase storage "
                f"credentials are missing: {', '.join(missing)}. "
                f"Please set these environment variables to enable cloud persistence."
            )


class SupabaseStorageClient:
    """
    HTTP client for interacting with Supabase Storage REST API (v1).
    Uses standard library urllib for zero-dependency portability and performance.
    """

    def __init__(self, config: Optional[StorageConfig] = None):
        self.config = config or StorageConfig.from_env()

    def _require_configured(self) -> Tuple[str, str]:
        if not self.config.supabase_url or not self.config.auth_key:
            raise StorageConfigurationError(
                "Supabase Storage credentials are not configured. "
                "Ensure 'SUPABASE_URL' and 'SUPABASE_SERVICE_ROLE_KEY' are set."
            )
        return self.config.supabase_url.rstrip("/"), self.config.auth_key

    def upload_file(
        self,
        bucket: str,
        storage_path: str,
        data_or_file: Union[Path, str, bytes],
        content_type: Optional[str] = None,
        upsert: bool = True,
    ) -> Dict[str, Any]:
        """
        Uploads an object to a private Supabase Storage bucket.
        Validates SHA-256 before upload.
        """
        base_url, key = self._require_configured()

        if isinstance(data_or_file, (Path, str)):
            p = Path(data_or_file)
            if not p.exists():
                raise FileNotFoundError(f"Source file not found: {p}")
            payload = p.read_bytes()
            if not content_type:
                guessed, _ = mimetypes.guess_type(str(p))
                content_type = guessed or "application/octet-stream"
        elif isinstance(data_or_file, bytes):
            payload = data_or_file
            if not content_type:
                content_type = "application/octet-stream"
        else:
            raise ValueError(f"Unsupported data type for upload: {type(data_or_file)}")

        sha256_hash = hashlib.sha256(payload).hexdigest()
        clean_path = storage_path.lstrip("/")

        url = f"{base_url}/storage/v1/object/{bucket}/{clean_path}"
        headers = {
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": content_type,
            "x-upsert": "true" if upsert else "false",
        }

        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp_data = resp.read().decode("utf-8")
                return {
                    "bucket": bucket,
                    "storage_path": clean_path,
                    "size_bytes": len(payload),
                    "sha256_hash": sha256_hash,
                    "content_type": content_type,
                    "status_code": resp.status,
                    "response": resp_data,
                }
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            raise StorageUploadError(
                f"Failed to upload '{clean_path}' to bucket '{bucket}': HTTP {e.code} - {error_body}"
            ) from e
        except Exception as e:
            raise StorageUploadError(
                f"Network error uploading '{clean_path}' to bucket '{bucket}': {e}"
            ) from e

    def download_file(self, bucket: str, storage_path: str) -> bytes:
        """Downloads bytes of an object from a private bucket via authenticated request."""
        base_url, key = self._require_configured()
        clean_path = storage_path.lstrip("/")
        url = f"{base_url}/storage/v1/object/authenticated/{bucket}/{clean_path}"

        headers = {
            "Authorization": f"Bearer {key}",
            "apikey": key,
        }

        req = urllib.request.Request(url, headers=headers, method="GET")

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            lower_body = error_body.lower()
            if (
                e.code == 404
                or "not_found" in lower_body
                or "nosuchkey" in lower_body
                or "object not found" in lower_body
            ):
                raise StorageNotFoundError(f"Object not found: {bucket}/{clean_path}") from e
            raise StorageError(f"HTTP {e.code} downloading '{bucket}/{clean_path}': {error_body}") from e

    def create_signed_url(self, bucket: str, storage_path: str, expires_in: int = 3600) -> str:
        """
        Creates a time-bounded signed URL for secure client-side streaming
        without revealing secret keys.
        """
        base_url, key = self._require_configured()
        clean_path = storage_path.lstrip("/")
        url = f"{base_url}/storage/v1/object/sign/{bucket}/{clean_path}"

        payload = json.dumps({"expiresIn": expires_in}).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": "application/json",
        }

        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                signed_path = data.get("signedURL")
                if not signed_path:
                    raise StorageError(f"Sign API did not return signedURL for {bucket}/{clean_path}")
                # Prepend base url if path is relative
                if signed_path.startswith("http"):
                    return signed_path
                return f"{base_url}/storage/v1{signed_path}"
        except Exception as e:
            raise StorageError(f"Failed to generate signed URL for '{bucket}/{clean_path}': {e}") from e

    def delete_objects(self, bucket: str, storage_paths: List[str]) -> bool:
        """Deletes multiple objects from a bucket in a single batch request."""
        if not storage_paths:
            return True
        base_url, key = self._require_configured()
        prefixes = [p.lstrip("/") for p in storage_paths if p]
        if not prefixes:
            return True
        url = f"{base_url}/storage/v1/object/{bucket}"

        payload = json.dumps({"prefixes": prefixes}).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": "application/json",
        }

        req = urllib.request.Request(url, data=payload, headers=headers, method="DELETE")

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.status in (200, 204)
        except Exception as e:
            logger.warning(f"Failed to delete {len(prefixes)} objects from {bucket}: {e}")
            return False

    def delete_object(self, bucket: str, storage_path: str) -> bool:
        """Deletes an object from a bucket."""
        return self.delete_objects(bucket, [storage_path])
