"""
Milestone 6B.3: End-to-End Acceptance and Regression Test Suite.

Covers all 15 acceptance scenarios:
1. Suspect video identical to protected reference.
2. Re-encoded / resized copy of reference.
3. Unrelated video.
4. Corrupt video renamed to .mp4.
5. Unsupported file extension.
6. Empty upload.
7. Oversized upload.
8. Valid video against empty reference vault.
9. Video failure during extraction / cleanup.
10. Consecutive back-to-back scans.
11. Incident creation and retrieval.
12. Reference ingestion, indexing, and deletion.
13. Suspect isolation (vectors and registry).
14. Missing or invalid frame evidence (path traversal, 404).
15. Error handling and client rejection.
"""

import io
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# Ensure backend root is on sys.path
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Prevent OpenMP duplicate runtime abort on macOS between PyTorch and FAISS
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import cv2
import numpy as np
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

from app.main import (
    app,
    STORAGE_DIR,
    FRAMES_DIR,
    SUSPECTS_VIDEOS_DIR,
    SUSPECTS_FRAMES_DIR,
    MAX_FILE_SIZE_BYTES,
)
from app.extractor import (
    preflight_video_file,
    extract_video_frames,
)
from app.vault import ReferenceVault, default_vault


def make_pattern_mp4(
    filepath: Path,
    pattern: str = "stripes",
    duration_sec: int = 5,
    fps: int = 10,
    width: int = 240,
    height: int = 240,
) -> Path:
    """Creates a deterministic synthetic video with distinct visual features."""
    pil_img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(pil_img)

    if pattern == "stripes":
        for y in range(0, height, 20):
            draw.rectangle([0, y, width, y + 10], fill="black")
    elif pattern == "circle":
        draw.ellipse([30, 30, width - 30, height - 30], fill="black")
    elif pattern == "cross":
        draw.rectangle([width // 2 - 15, 0, width // 2 + 15, height], fill="black")
        draw.rectangle([0, height // 2 - 15, width, height // 2 + 15], fill="black")

    frame_bgr = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(filepath), fourcc, float(fps), (width, height))
    for _ in range(duration_sec * fps):
        out.write(frame_bgr)
    out.release()
    return filepath


def make_resized_reencoded_mp4(
    src_filepath: Path,
    dst_filepath: Path,
    target_width: int = 160,
    target_height: int = 120,
) -> Path:
    """Re-encodes and downscales an existing video with compression noise."""
    cap = cv2.VideoCapture(str(src_filepath))
    fps = cap.get(cv2.CAP_PROP_FPS) or 10.0
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(dst_filepath), fourcc, float(fps), (target_width, target_height))

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        resized = cv2.resize(frame, (target_width, target_height), interpolation=cv2.INTER_AREA)
        # Add slight compression artifact / brightness shift
        noisy = np.clip(resized.astype(np.int16) + 5, 0, 255).astype(np.uint8)
        out.write(noisy)

    cap.release()
    out.release()
    return dst_filepath


class TestMilestone6B3Acceptance(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)
        self.temp_dir = Path(tempfile.mkdtemp(prefix="fixproof_m6b3_acceptance_"))
        self.cleanup_asset_ids = []
        self.cleanup_suspect_ids = []

    def tearDown(self):
        # Remove local temporary directory
        if self.temp_dir.exists():
            shutil.rmtree(self.temp_dir, ignore_errors=True)

        # Clean up any reference assets created in global storage during tests
        for aid in self.cleanup_asset_ids:
            for f in STORAGE_DIR.glob(f"{aid}.*"):
                f.unlink(missing_ok=True)
            rf = FRAMES_DIR / aid
            if rf.exists():
                shutil.rmtree(rf, ignore_errors=True)
            default_vault.remove_asset_vectors(aid)

        # Clean up any suspect files created in global storage during tests
        for sid in self.cleanup_suspect_ids:
            for f in SUSPECTS_VIDEOS_DIR.glob(f"{sid}.*"):
                f.unlink(missing_ok=True)
            sf = SUSPECTS_FRAMES_DIR / sid
            if sf.exists():
                shutil.rmtree(sf, ignore_errors=True)

    # ─── Scenario 1 & 2: Identical and Re-encoded Reference Matching ────────────

    def test_scenario_01_and_02_identical_and_reencoded_matching(self):
        """
        Scenario 1: Suspect identical to protected reference (CANDIDATE_MATCH, conf > 95%, pHash confirmed).
        Scenario 2: Re-encoded / downscaled copy of reference (CANDIDATE_MATCH, conf > 85%, pHash confirmed).
        """
        isolated_vault = ReferenceVault(vault_dir=self.temp_dir / "isolated_vault")
        isolated_vault.clear()

        # Step 1: Create and ingest official reference video (Stripes)
        ref_path = self.temp_dir / "ref_official.mp4"
        make_pattern_mp4(ref_path, pattern="stripes", duration_sec=5, fps=10, width=240, height=240)

        with patch("app.main.default_vault", isolated_vault):
            with open(ref_path, "rb") as f:
                res_ingest = self.client.post(
                    "/api/vault/ingest?auto_index=true",
                    files={"file": ("ref_official.mp4", f, "video/mp4")},
                )
            self.assertEqual(res_ingest.status_code, 200)
            ref_asset_id = res_ingest.json()["asset_id"]
            self.cleanup_asset_ids.append(ref_asset_id)

            # Scenario 1: Scan identical copy
            with open(ref_path, "rb") as f:
                res_scan1 = self.client.post(
                    "/api/threats/scan",
                    files={"file": ("suspect_identical.mp4", f, "video/mp4")},
                )
            self.assertEqual(res_scan1.status_code, 200)
            data1 = res_scan1.json()
            self.cleanup_suspect_ids.append(data1["submitted_asset_id"])

            self.assertEqual(data1["overall_status"], "CANDIDATE_MATCH")
            self.assertGreater(data1["highest_confidence"], 95.0)
            self.assertLess(data1["lowest_l2_distance"], 0.15)
            self.assertIn(ref_asset_id, data1["matched_assets"])
            self.assertTrue(data1["frame_matches"][0]["best_match"]["phash_match"])
            self.assertEqual(data1["frame_matches"][0]["best_match"]["phash_score"], 100)

            # Scenario 2: Scan re-encoded and downscaled copy (160x120 + noise)
            reencoded_path = self.temp_dir / "suspect_reencoded.mp4"
            make_resized_reencoded_mp4(ref_path, reencoded_path, target_width=160, target_height=120)

            with open(reencoded_path, "rb") as f:
                res_scan2 = self.client.post(
                    "/api/threats/scan",
                    files={"file": ("suspect_reencoded.mp4", f, "video/mp4")},
                )
            self.assertEqual(res_scan2.status_code, 200)
            data2 = res_scan2.json()
            self.cleanup_suspect_ids.append(data2["submitted_asset_id"])

            self.assertIn(data2["overall_status"], ["CANDIDATE_MATCH", "SUSPECT"])
            self.assertGreater(data2["highest_confidence"], 85.0)
            self.assertIn(ref_asset_id, data2["matched_assets"])
            self.assertTrue(data2["frame_matches"][0]["best_match"]["phash_match"])

    # ─── Scenario 3: Unrelated Video ───────────────────────────────────────────

    def test_scenario_03_unrelated_video(self):
        """Scenario 3: Suspect video with distinct visual features returns CLEAN (0 matches)."""
        isolated_vault = ReferenceVault(vault_dir=self.temp_dir / "isolated_vault")
        isolated_vault.clear()

        ref_path = self.temp_dir / "ref_stripes.mp4"
        make_pattern_mp4(ref_path, pattern="stripes", duration_sec=5, fps=10)

        unrelated_path = self.temp_dir / "suspect_circle.mp4"
        make_pattern_mp4(unrelated_path, pattern="circle", duration_sec=5, fps=10)

        with patch("app.main.default_vault", isolated_vault):
            with open(ref_path, "rb") as f:
                r_ingest = self.client.post("/api/vault/ingest?auto_index=true", files={"file": ("ref_stripes.mp4", f, "video/mp4")})
            self.cleanup_asset_ids.append(r_ingest.json()["asset_id"])

            with open(unrelated_path, "rb") as f:
                r_scan = self.client.post("/api/threats/scan", files={"file": ("suspect_circle.mp4", f, "video/mp4")})

            self.assertEqual(r_scan.status_code, 200)
            data = r_scan.json()
            self.cleanup_suspect_ids.append(data["submitted_asset_id"])

            self.assertEqual(data["overall_status"], "CLEAN")
            self.assertEqual(data["candidate_matches_found"], 0)
            self.assertGreater(data["lowest_l2_distance"], 0.75)
            self.assertEqual(data["matched_assets"], [])

    # ─── Scenario 4, 5, 6, 7: Input Validation & Error Handling ─────────────────

    def test_scenario_04_corrupt_video_renamed_to_mp4(self):
        """Scenario 4: Corrupt non-video bytes renamed to .mp4 rejected with 422 and cleaned up."""
        corrupt_bytes = b"CORRUPTED_FILE_DATA_HEADER" * 50
        initial_suspect_files = list(SUSPECTS_VIDEOS_DIR.iterdir())
        initial_suspect_dirs = list(SUSPECTS_FRAMES_DIR.iterdir())

        res = self.client.post(
            "/api/threats/scan",
            files={"file": ("fake_video.mp4", io.BytesIO(corrupt_bytes), "video/mp4")},
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("Invalid suspect video", res.json()["detail"])

        # No dangling files or frame dirs left behind
        self.assertEqual(list(SUSPECTS_VIDEOS_DIR.iterdir()), initial_suspect_files)
        self.assertEqual(list(SUSPECTS_FRAMES_DIR.iterdir()), initial_suspect_dirs)

    def test_scenario_05_unsupported_file_extension(self):
        """Scenario 5: Unsupported file extension rejected with 400."""
        res = self.client.post(
            "/api/threats/scan",
            files={"file": ("script.py", io.BytesIO(b"print('hello')"), "text/x-python")},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Unsupported video format", res.json()["detail"])

    def test_scenario_06_empty_upload(self):
        """Scenario 6: 0-byte upload rejected with 400."""
        res = self.client.post(
            "/api/threats/scan",
            files={"file": ("empty.mp4", io.BytesIO(b""), "video/mp4")},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("empty", res.json()["detail"])

    def test_scenario_07_oversized_upload(self):
        """Scenario 7: File exceeding MAX_FILE_SIZE_BYTES rejected with 413 and unlinked."""
        # Test boundary logic with patched smaller threshold for test speed
        with patch("app.main.MAX_FILE_SIZE_BYTES", 1024 * 1024):  # 1 MB threshold
            oversized_payload = b"A" * (1024 * 1024 + 500)
            res = self.client.post(
                "/api/threats/scan",
                files={"file": ("huge_clip.mp4", io.BytesIO(oversized_payload), "video/mp4")},
            )
            self.assertEqual(res.status_code, 413)
            self.assertIn("exceeds maximum allowed size", res.json()["detail"])

    # ─── Scenario 8: Empty Vault Behavior ──────────────────────────────────────

    def test_scenario_08_valid_video_against_empty_vault(self):
        """Scenario 8: Scanning against empty vault returns NO_REFERENCE_DATA, never CLEAN."""
        isolated_empty = ReferenceVault(vault_dir=self.temp_dir / "empty_vault")
        isolated_empty.clear()

        valid_path = self.temp_dir / "valid_clip.mp4"
        make_pattern_mp4(valid_path, pattern="stripes", duration_sec=5, fps=10)

        with patch("app.main.default_vault", isolated_empty):
            with open(valid_path, "rb") as f:
                res = self.client.post(
                    "/api/threats/scan",
                    files={"file": ("valid_clip.mp4", f, "video/mp4")},
                )

            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.cleanup_suspect_ids.append(data["submitted_asset_id"])

            self.assertEqual(data["overall_status"], "NO_REFERENCE_DATA")
            self.assertEqual(data["candidate_matches_found"], 0)
            self.assertEqual(data["highest_confidence"], 0.0)
            self.assertIsNone(data["lowest_l2_distance"])
            self.assertIn("Reference vault is empty", data["message"])
            self.assertGreater(data["total_frames_analyzed"], 0)

    # ─── Scenario 9: Extraction Failure & Cleanup ──────────────────────────────

    def test_scenario_09_extraction_failure_cleanup(self):
        """Scenario 9: Exception during extraction cleans up partial files with no dangling directories."""
        valid_path = self.temp_dir / "extract_fail.mp4"
        make_pattern_mp4(valid_path, duration_sec=5, fps=10)

        initial_suspect_files = list(SUSPECTS_VIDEOS_DIR.iterdir())
        initial_suspect_dirs = list(SUSPECTS_FRAMES_DIR.iterdir())

        # Simulate unexpected extraction I/O error
        with patch("app.main.extract_video_frames", side_effect=IOError("Disk write simulated failure")):
            with open(valid_path, "rb") as f:
                res = self.client.post(
                    "/api/threats/scan",
                    files={"file": ("extract_fail.mp4", f, "video/mp4")},
                )
            self.assertEqual(res.status_code, 500)
            self.assertIn("Failed to scan suspect video", res.json()["detail"])

        # No dangling files left behind
        self.assertEqual(list(SUSPECTS_VIDEOS_DIR.iterdir()), initial_suspect_files)
        self.assertEqual(list(SUSPECTS_FRAMES_DIR.iterdir()), initial_suspect_dirs)

    # ─── Scenario 10: Consecutive Scans ────────────────────────────────────────

    def test_scenario_10_consecutive_scans(self):
        """Scenario 10: Back-to-back scans succeed with distinct IDs and no state cross-talk."""
        clip1 = self.temp_dir / "clip1.mp4"
        clip2 = self.temp_dir / "clip2.mp4"
        make_pattern_mp4(clip1, pattern="stripes", duration_sec=5, fps=10)
        make_pattern_mp4(clip2, pattern="cross", duration_sec=5, fps=10)

        with open(clip1, "rb") as f1, open(clip2, "rb") as f2:
            res1 = self.client.post("/api/threats/scan", files={"file": ("clip1.mp4", f1, "video/mp4")})
            res2 = self.client.post("/api/threats/scan", files={"file": ("clip2.mp4", f2, "video/mp4")})

        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res2.status_code, 200)

        d1 = res1.json()
        d2 = res2.json()
        self.cleanup_suspect_ids.extend([d1["submitted_asset_id"], d2["submitted_asset_id"]])

        self.assertNotEqual(d1["submitted_asset_id"], d2["submitted_asset_id"])
        self.assertNotEqual(d1["incident_id"], d2["incident_id"])
        self.assertEqual(d1["suspect_filename"], "clip1.mp4")
        self.assertEqual(d2["suspect_filename"], "clip2.mp4")

    # ─── Scenario 11: Incident Creation and Retrieval ──────────────────────────

    def test_scenario_11_incident_creation_and_retrieval(self):
        """Scenario 11: Scan records incident in incidents.json, retrievable via GET /api/incidents."""
        vid = self.temp_dir / "incident_test.mp4"
        make_pattern_mp4(vid, pattern="circle", duration_sec=5, fps=10)

        with open(vid, "rb") as f:
            res = self.client.post("/api/threats/scan", files={"file": ("incident_test.mp4", f, "video/mp4")})
        self.assertEqual(res.status_code, 200)
        scan_data = res.json()
        incident_id = scan_data["incident_id"]
        self.cleanup_suspect_ids.append(scan_data["submitted_asset_id"])

        # Fetch all incidents
        list_res = self.client.get("/api/incidents")
        self.assertEqual(list_res.status_code, 200)
        incidents = list_res.json()
        self.assertTrue(any(inc.get("incident_id") == incident_id for inc in incidents))

        # Fetch single incident
        single_res = self.client.get(f"/api/incidents/{incident_id}")
        self.assertEqual(single_res.status_code, 200)
        self.assertEqual(single_res.json()["incident_id"], incident_id)
        self.assertEqual(single_res.json()["suspect_filename"], "incident_test.mp4")

        # 404 for nonexistent incident
        missing_res = self.client.get("/api/incidents/nonexistent-id-0000")
        self.assertEqual(missing_res.status_code, 404)

    # ─── Scenario 12: Reference Ingest, Index, Delete Lifecycle ─────────────────

    def test_scenario_12_reference_ingest_index_delete_lifecycle(self):
        """Scenario 12: Reference video uploads, indexes, deletes cleanly, updating vault status."""
        ref_path = self.temp_dir / "lifecycle_ref.mp4"
        make_pattern_mp4(ref_path, pattern="stripes", duration_sec=5, fps=10)

        # 1. Ingest without auto_index
        with open(ref_path, "rb") as f:
            r1 = self.client.post("/api/vault/ingest?auto_index=false", files={"file": ("lifecycle_ref.mp4", f, "video/mp4")})
        self.assertEqual(r1.status_code, 200)
        aid = r1.json()["asset_id"]
        self.cleanup_asset_ids.append(aid)
        self.assertFalse(r1.json()["indexed"])

        # 2. Index asset
        r2 = self.client.post(f"/api/vault/index/{aid}")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["status"], "indexed")

        # 3. Check registered status
        detail_res = self.client.get(f"/api/vault/assets/{aid}")
        self.assertEqual(detail_res.status_code, 200)
        self.assertTrue(detail_res.json()["indexed"])

        # 4. Delete asset
        del_res = self.client.delete(f"/api/vault/assets/{aid}")
        self.assertEqual(del_res.status_code, 200)

        # 5. Check 404
        self.assertEqual(self.client.get(f"/api/vault/assets/{aid}").status_code, 404)

    # ─── Scenario 13: Suspect Isolation Guarantee ──────────────────────────────

    def test_scenario_13_suspect_isolation(self):
        """Scenario 13: Suspect uploads never enter reference asset registry or FAISS vault."""
        isolated_vault = ReferenceVault(vault_dir=self.temp_dir / "isolated_vault")
        isolated_vault.clear()

        ref_path = self.temp_dir / "ref_iso.mp4"
        suspect_path = self.temp_dir / "suspect_iso.mp4"
        make_pattern_mp4(ref_path, pattern="stripes", duration_sec=5, fps=10)
        make_pattern_mp4(suspect_path, pattern="stripes", duration_sec=5, fps=10)

        with patch("app.main.default_vault", isolated_vault):
            with open(ref_path, "rb") as f:
                r_ref = self.client.post("/api/vault/ingest?auto_index=true", files={"file": ("ref_iso.mp4", f, "video/mp4")})
            ref_id = r_ref.json()["asset_id"]
            self.cleanup_asset_ids.append(ref_id)
            initial_vault_size = isolated_vault.vector_db.ntotal

            with open(suspect_path, "rb") as f:
                r_suspect = self.client.post("/api/threats/scan", files={"file": ("suspect_iso.mp4", f, "video/mp4")})
            suspect_id = r_suspect.json()["submitted_asset_id"]
            self.cleanup_suspect_ids.append(suspect_id)

            # Check vault assets list: reference is present, suspect is NOT present
            assets_res = self.client.get("/api/vault/assets")
            all_ids = [a["asset_id"] for a in assets_res.json()]
            self.assertIn(ref_id, all_ids)
            self.assertNotIn(suspect_id, all_ids)

            # Vault size is identical: zero vectors added from suspect
            self.assertEqual(isolated_vault.vector_db.ntotal, initial_vault_size)

            # Filesystem check: suspect is in storage/suspects/, NOT storage/videos/
            self.assertFalse((STORAGE_DIR / f"{suspect_id}.mp4").exists())
            self.assertFalse((FRAMES_DIR / suspect_id).exists())

    # ─── Scenario 14: Missing or Invalid Frame Evidence ────────────────────────

    def test_scenario_14_frame_streaming_security_and_404(self):
        """Scenario 14: Missing frames return 404; invalid asset IDs and frame formats return 400."""
        # 404 for missing frame on nonexistent asset
        res_404 = self.client.get("/api/vault/assets/nonexistent-asset-00/frames/frame_0000s.jpg")
        self.assertEqual(res_404.status_code, 404)

        # Invalid asset_id with special characters/semicolon returns 400
        res_bad_id = self.client.get("/api/vault/assets/invalid;asset;id/frames/frame_0000s.jpg")
        self.assertEqual(res_bad_id.status_code, 400)
        self.assertIn("Invalid asset ID format", res_bad_id.json()["detail"])

        # Invalid frame filename with path traversal characters returns 400
        res_bad_frame = self.client.get("/api/vault/assets/valid-id-123/frames/bad;frame.jpg")
        self.assertEqual(res_bad_frame.status_code, 400)
        self.assertIn("Invalid frame filename", res_bad_frame.json()["detail"])

        # Non-image extension in frame endpoint returns 400
        res_bad_ext = self.client.get("/api/vault/assets/valid-id-123/frames/script.sh")
        self.assertEqual(res_bad_ext.status_code, 400)
        self.assertIn("Invalid frame filename", res_bad_ext.json()["detail"])

    # ─── Scenario 15: Error Never Becomes CLEAN ────────────────────────────────

    def test_scenario_15_error_never_becomes_clean(self):
        """Scenario 15: Failed/rejected scans return HTTP errors and are never misreported as CLEAN."""
        # Empty file -> 400, not CLEAN
        res_empty = self.client.post("/api/threats/scan", files={"file": ("empty.mp4", io.BytesIO(b""), "video/mp4")})
        self.assertEqual(res_empty.status_code, 400)
        self.assertNotIn("CLEAN", res_empty.text)

        # Corrupt file -> 422, not CLEAN
        res_corrupt = self.client.post("/api/threats/scan", files={"file": ("corrupt.mp4", io.BytesIO(b"GARBAGE" * 20), "video/mp4")})
        self.assertEqual(res_corrupt.status_code, 422)
        self.assertNotIn("CLEAN", res_corrupt.text)

        # Unsupported ext -> 400, not CLEAN
        res_ext = self.client.post("/api/threats/scan", files={"file": ("test.png", io.BytesIO(b"\x89PNG\r\n"), "image/png")})
        self.assertEqual(res_ext.status_code, 400)
        self.assertNotIn("CLEAN", res_ext.text)


if __name__ == "__main__":
    unittest.main()
