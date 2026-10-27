"""
Reference Vault and Visual Embedding module for FixProof.
Ported from MediaGuard Sports Archivist (agents/archivist.py).

Features:
- MobileNetV3-Small backbone producing 576-dimensional L2-normalized embeddings.
- FAISS IndexFlatL2(576) vector database with persistent storage.
- Synchronized JSON metadata mapping each vector to asset ID, frame ID, timestamp, and path.
- Robust initialization, reload, and error handling for empty/corrupted vaults.
"""

from datetime import datetime, timezone
import hashlib
import json
import logging
import os

# Prevent OpenMP duplicate runtime abort on macOS between PyTorch and FAISS
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image
import torch
import torchvision.models as models
import torchvision.transforms as T
import faiss

from app.db import get_db_config, default_db_manager
from app.storage import SupabaseStorageClient, StorageError

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 576

# Image preprocessing transform matching MediaGuard archivist
_TRANSFORM = T.Compose([
    T.Resize((224, 224)),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

_MODEL: Optional[torch.nn.Module] = None


def get_embedding_model() -> torch.nn.Module:
    """Lazy-loads and caches the MobileNetV3-Small embedding backbone."""
    global _MODEL
    if _MODEL is None:
        logger.info("[Vault] Loading MobileNetV3-Small feature extractor...")
        model = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT)
        model.classifier = torch.nn.Identity()  # Strip classifier -> raw 576-dim feature vector
        model.eval()
        _MODEL = model
    return _MODEL



def extract_image_embedding(image: Image.Image) -> np.ndarray:
    """
    Extracts a 576-dimensional L2-normalized float32 embedding vector for a PIL Image.
    Returns array of shape (1, 576).
    """
    model = get_embedding_model()
    rgb_image = image.convert("RGB")
    tensor = _TRANSFORM(rgb_image).unsqueeze(0)
    with torch.no_grad():
        features = model(tensor)
    embedding = features.cpu().numpy().astype("float32").reshape(1, -1)
    faiss.normalize_L2(embedding)
    return embedding


class ReferenceVault:
    """
    Manages the FAISS IndexFlatL2 vector database and synchronized metadata store.
    Supports both local filesystem and Supabase cloud snapshot hydration.
    """

    def __init__(self, vault_dir: Optional[Path] = None, mode: Optional[str] = None):
        if vault_dir is None:
            vault_dir = Path(__file__).resolve().parent.parent / "storage" / "vault"
        self.vault_dir = Path(vault_dir)
        self.vault_dir.mkdir(parents=True, exist_ok=True)

        self.cloud_cache_dir = Path(__file__).resolve().parent.parent / "storage" / "cloud_cache" / "vault"
        self.cloud_cache_dir.mkdir(parents=True, exist_ok=True)

        if mode is not None:
            self.mode = mode.lower()
        elif vault_dir is not None:
            self.mode = "local"
        else:
            try:
                self.mode = get_db_config().mode.value
            except Exception:
                self.mode = "local"

        self.index_path = self.vault_dir / "faiss_vault.index"
        self.meta_path = self.vault_dir / "vault_metadata.json"
        self.snapshot_version: Optional[int] = None

        self.vector_db: faiss.IndexFlatL2 = faiss.IndexFlatL2(EMBEDDING_DIM)
        self.metadata_store: Dict[str, Dict[str, Any]] = {}

        self.load_vault()

    @property
    def is_cloud(self) -> bool:
        return self.mode in ("supabase", "postgres")

    def reload(self, mode: Optional[str] = None) -> None:
        """Reloads the vault, optionally switching between local and cloud modes."""
        if mode is not None:
            self.mode = mode.lower()
        else:
            try:
                self.mode = get_db_config().mode.value
            except Exception:
                self.mode = "local"
        logger.info(f"[Vault] Reloading reference vault in mode '{self.mode}'...")
        self.load_vault()

    def _load_cloud_vault(self) -> None:
        """
        Hydrates the reference vault from the active Supabase snapshot:
        1. Queries PostgreSQL vault_snapshots table for the active checkpoint.
        2. Retrieves the FAISS index and metadata store from private Supabase Storage.
        3. Strictly validates SHA-256 checksum and vector count.
        4. Fails fast with clear exceptions on corruption or unavailable storage.
        """
        logger.info("[Vault] Fetching active vault snapshot from Supabase PostgreSQL...")
        db_mgr = default_db_manager
        if not db_mgr.is_cloud:
            from app.db import DatabaseConfig, DBMode, DatabaseManager
            conn_url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
            if conn_url:
                db_mgr = DatabaseManager(DatabaseConfig(mode=DBMode.SUPABASE, connection_url=conn_url))
        row = db_mgr.fetch_one(
            """
            SELECT version_number, total_vectors, total_assets, storage_index_path,
                   storage_meta_path, sha256_checksum, status
            FROM vault_snapshots
            WHERE status = 'ACTIVE'
            ORDER BY version_number DESC
            LIMIT 1;
            """
        )
        if not row:
            raise RuntimeError(
                "No active FAISS vault snapshot found in PostgreSQL table 'vault_snapshots'. "
                "Cannot initialize cloud reference vault. Run migration or staging sync first."
            )

        storage_client = SupabaseStorageClient()
        bucket = "vault-snapshots"

        idx_storage_path = row["storage_index_path"]
        if idx_storage_path.startswith(f"{bucket}/"):
            idx_storage_path = idx_storage_path[len(f"{bucket}/"):]

        meta_storage_path = row["storage_meta_path"]
        if meta_storage_path.startswith(f"{bucket}/"):
            meta_storage_path = meta_storage_path[len(f"{bucket}/"):]

        logger.info(f"[Vault] Downloading cloud FAISS snapshot v{row['version_number']} ({idx_storage_path})...")
        try:
            index_bytes = storage_client.download_file(bucket, idx_storage_path)
        except Exception as e:
            raise RuntimeError(f"Failed to download cloud FAISS index from '{bucket}/{idx_storage_path}': {e}") from e

        # SHA-256 integrity check against catalog
        actual_sha256 = hashlib.sha256(index_bytes).hexdigest()
        expected_sha256 = row["sha256_checksum"]
        if actual_sha256.lower() != expected_sha256.lower():
            raise RuntimeError(
                f"Cloud FAISS snapshot integrity failure! SHA-256 mismatch: "
                f"expected {expected_sha256}, got {actual_sha256}."
            )

        logger.info(f"[Vault] Downloading cloud metadata ({meta_storage_path})...")
        try:
            meta_bytes = storage_client.download_file(bucket, meta_storage_path)
        except Exception as e:
            raise RuntimeError(f"Failed to download cloud vault metadata from '{bucket}/{meta_storage_path}': {e}") from e

        # Cache verified snapshot locally in cloud cache
        cached_idx_path = self.cloud_cache_dir / f"faiss_vault_v{row['version_number']}.index"
        cached_meta_path = self.cloud_cache_dir / f"vault_metadata_v{row['version_number']}.json"

        cached_idx_path.write_bytes(index_bytes)
        cached_meta_path.write_bytes(meta_bytes)

        # Load into memory
        loaded_index = faiss.read_index(str(cached_idx_path))
        if loaded_index.d != EMBEDDING_DIM:
            raise RuntimeError(
                f"Cloud FAISS index dimension mismatch ({loaded_index.d} vs {EMBEDDING_DIM})."
            )
        if loaded_index.ntotal != row["total_vectors"]:
            raise RuntimeError(
                f"Cloud FAISS index vector count mismatch: expected {row['total_vectors']}, got {loaded_index.ntotal}."
            )

        loaded_metadata = json.loads(meta_bytes.decode("utf-8"))
        if loaded_index.ntotal != len(loaded_metadata):
            logger.warning(
                f"[Vault] Cloud snapshot vector count mismatch with metadata: "
                f"Index={loaded_index.ntotal}, Meta={len(loaded_metadata)}"
            )

        self.vector_db = loaded_index
        self.metadata_store = loaded_metadata
        self.index_path = cached_idx_path
        self.meta_path = cached_meta_path
        self.snapshot_version = row["version_number"]

        logger.info(
            f"[Vault] Successfully hydrated cloud reference vault (snapshot v{self.snapshot_version}) "
            f"with {self.vector_db.ntotal} vectors."
        )

    def load_vault(self) -> None:
        """Loads FAISS index and metadata store according to active mode."""
        self.vector_db = faiss.IndexFlatL2(EMBEDDING_DIM)
        self.metadata_store = {}

        if self.is_cloud:
            self._load_cloud_vault()
            return

        # Local mode loading
        self.index_path = self.vault_dir / "faiss_vault.index"
        self.meta_path = self.vault_dir / "vault_metadata.json"
        self.snapshot_version = None

        # 1. Load FAISS Index
        if self.index_path.exists():
            try:
                loaded = faiss.read_index(str(self.index_path))
                if loaded.d == EMBEDDING_DIM:
                    self.vector_db = loaded
                    logger.info(f"[Vault] Loaded local index with {self.vector_db.ntotal} vectors.")
                else:
                    logger.warning(
                        f"[Vault] Index dim mismatch ({loaded.d} vs {EMBEDDING_DIM}). Initializing fresh index."
                    )
            except Exception as e:
                logger.error(f"[Vault] Error loading index from {self.index_path}: {e}. Starting fresh.")
                self.vector_db = faiss.IndexFlatL2(EMBEDDING_DIM)

        # 2. Load Metadata
        if self.meta_path.exists():
            try:
                with open(self.meta_path, "r", encoding="utf-8") as f:
                    self.metadata_store = json.load(f)
                logger.info(f"[Vault] Loaded local metadata with {len(self.metadata_store)} records.")
            except Exception as e:
                logger.error(f"[Vault] Error loading metadata from {self.meta_path}: {e}. Starting fresh.")
                self.metadata_store = {}

        # 3. Verify vector count and metadata synchronization
        if self.vector_db.ntotal != len(self.metadata_store):
            logger.warning(
                f"[Vault] Sync warning: Index has {self.vector_db.ntotal} vectors, "
                f"metadata has {len(self.metadata_store)} records."
            )

    def save_vault(self) -> None:
        """Persists the FAISS index and metadata store to disk."""
        faiss.write_index(self.vector_db, str(self.index_path))
        with open(self.meta_path, "w", encoding="utf-8") as f:
            json.dump(self.metadata_store, f, indent=2)

    def clear(self) -> None:
        """Clears all vectors and metadata in memory and on disk."""
        self.vector_db = faiss.IndexFlatL2(EMBEDDING_DIM)
        self.metadata_store = {}
        if self.index_path.exists():
            self.index_path.unlink(missing_ok=True)
        if self.meta_path.exists():
            self.meta_path.unlink(missing_ok=True)

    def index_frame(
        self,
        image: Image.Image,
        asset_id: str,
        frame_id: int,
        timestamp_sec: int,
        frame_path: str,
        filename: str,
    ) -> int:
        """
        Computes 576-dim embedding for a single frame, inserts into FAISS,
        and records synchronized metadata.
        Returns the inserted vector_id.
        """
        embedding = extract_image_embedding(image)
        vector_id = self.vector_db.ntotal

        # Add to FAISS index
        self.vector_db.add(embedding)

        # Record synchronized metadata mapping
        self.metadata_store[str(vector_id)] = {
            "vector_id": vector_id,
            "asset_id": asset_id,
            "frame_id": frame_id,
            "timestamp_sec": timestamp_sec,
            "frame_path": frame_path,
            "filename": filename,
            "indexed_at": datetime.now(timezone.utc).isoformat(),
        }

        return vector_id

    def index_asset_frames(
        self,
        asset_id: str,
        frames: Optional[List[Dict[str, Any]]] = None,
        frames_dir: Optional[Path] = None,
    ) -> List[Dict[str, Any]]:
        """
        Indexes all extracted frames for an asset.
        Either accepts explicit frame metadata list or discovers them in frames_dir.
        Returns the list of indexed frame records.
        """
        if frames_dir is None:
            frames_dir = Path(__file__).resolve().parent.parent / "storage" / "frames" / asset_id

        if not frames_dir.exists():
            raise FileNotFoundError(f"Frames directory not found for asset '{asset_id}': {frames_dir}")

        # If frames metadata was not supplied, build list from files in frames_dir
        if not frames:
            frame_files = sorted(frames_dir.glob("frame_*.jpg"))
            if not frame_files:
                raise ValueError(f"No JPEG frames found in {frames_dir} for asset '{asset_id}'.")
            frames = []
            for idx, p in enumerate(frame_files):
                # parse timestamp from filename: frame_0005s.jpg -> 5
                ts = 0
                name = p.stem  # frame_0005s
                try:
                    parts = name.split("_")
                    if len(parts) > 1:
                        ts_str = parts[1].replace("s", "")
                        ts = int(ts_str)
                except Exception:
                    ts = idx * 5

                frames.append({
                    "frame_index": idx,
                    "frame_id": idx * 5,
                    "timestamp_sec": ts,
                    "filename": p.name,
                    "frame_path": str(p),
                })

        indexed_records = []
        for frame_info in frames:
            fpath = Path(frame_info.get("frame_path", frames_dir / frame_info["filename"]))
            if not fpath.exists():
                logger.warning(f"[Vault] Frame file does not exist, skipping: {fpath}")
                continue

            try:
                with Image.open(fpath) as pil_img:
                    vector_id = self.index_frame(
                        image=pil_img,
                        asset_id=asset_id,
                        frame_id=frame_info.get("frame_id", 0),
                        timestamp_sec=frame_info.get("timestamp_sec", 0),
                        frame_path=str(fpath),
                        filename=fpath.name,
                    )
                    indexed_records.append({
                        "vector_id": vector_id,
                        "asset_id": asset_id,
                        "timestamp_sec": frame_info.get("timestamp_sec", 0),
                        "filename": fpath.name,
                    })
            except Exception as e:
                logger.error(f"[Vault] Failed to embed frame {fpath}: {e}")
                continue

        if not indexed_records:
            raise ValueError(f"No frames could be successfully read or embedded for asset '{asset_id}'.")

        self.save_vault()
        return indexed_records

    def get_status(self) -> Dict[str, Any]:
        """Returns the current status of the reference vault."""
        unique_assets = list({meta["asset_id"] for meta in self.metadata_store.values() if "asset_id" in meta})
        return {
            "status": "ready" if self.vector_db.ntotal > 0 else "empty",
            "vault_size": self.vector_db.ntotal,
            "embedding_dim": EMBEDDING_DIM,
            "total_indexed_assets": len(unique_assets),
            "indexed_assets": unique_assets,
            "index_file": str(self.index_path),
            "metadata_file": str(self.meta_path),
            "mode": self.mode,
            "snapshot_version": self.snapshot_version,
        }

    def search_nearest(self, embedding: np.ndarray, k: int = 3) -> Tuple[List[float], List[Dict[str, Any]]]:
        """
        Searches the vault for the k nearest neighbors to an embedding.
        Returns (distances, matches_metadata).
        """
        if self.vector_db.ntotal == 0:
            return [], []

        k = min(k, self.vector_db.ntotal)
        faiss.normalize_L2(embedding)
        distances, indices = self.vector_db.search(embedding, k)

        matches = []
        dists = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx == -1:
                continue
            meta = self.metadata_store.get(str(idx), {})
            dists.append(float(dist))
            matches.append(meta)

        return dists, matches

    def remove_asset_vectors(self, asset_id: str) -> int:
        """
        Removes all vectors belonging to asset_id from FAISS and metadata_store.
        Rebuilds the FAISS index with remaining vectors and preserves synchronization.
        Returns the number of removed vectors.
        """
        target_vids = {
            vid for vid, meta in self.metadata_store.items()
            if meta.get("asset_id") == asset_id
        }
        if not target_vids:
            return 0

        removed_count = len(target_vids)
        remaining_items = [
            (int(vid), meta)
            for vid, meta in self.metadata_store.items()
            if vid not in target_vids
        ]
        remaining_items.sort(key=lambda x: x[0])

        if not remaining_items:
            self.clear()
            return removed_count

        new_index = faiss.IndexFlatL2(EMBEDDING_DIM)
        new_meta: Dict[str, Dict[str, Any]] = {}

        for new_vid, (old_vid, meta) in enumerate(remaining_items):
            if old_vid >= self.vector_db.ntotal:
                logger.warning(
                    f"[Vault] Cannot reconstruct vector {old_vid}: index only has {self.vector_db.ntotal} vectors. Skipping."
                )
                continue
            vec = self.vector_db.reconstruct(old_vid).reshape(1, -1)
            new_index.add(vec)
            updated_meta = dict(meta)
            updated_meta["vector_id"] = new_vid
            new_meta[str(new_vid)] = updated_meta

        self.vector_db = new_index
        self.metadata_store = new_meta
        self.save_vault()
        logger.info(f"[Vault] Removed {removed_count} vectors for asset '{asset_id}'. Vault size now {self.vector_db.ntotal}.")
        return removed_count



default_vault = ReferenceVault()
