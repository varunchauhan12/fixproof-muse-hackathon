"""
Unit test suite for FixProof Phase 3.1:
- Provider Abstraction Layer (Nemotron & Muse scaffold)
- Storyboard Sprite-Sheet Extraction & Tile Coordinate Slicing
- Cloud Persistence, Database Caching & Session Isolation
"""

import io
import json
import unittest
import uuid
from unittest.mock import MagicMock, patch
from PIL import Image

from app.providers import get_vision_provider, get_reasoning_provider
from app.providers.base import BaseVisionProvider, BaseReasoningProvider
from app.providers.nemotron import NemotronVisionProvider, NemotronReasoningProvider
from app.providers.muse import MuseVisionProvider, MuseReasoningProvider
from app.matcher import compute_image_entropy, MIN_IMAGE_ENTROPY
from app.url_screener import extract_public_video_metadata
from app.vision_verifier import (
    compute_pair_cache_key,
    get_cached_verification,
    store_cached_verification,
    _MEMORY_CACHE,
)
from app.registry import load_incidents, save_incident


class TestPhase31ProviderAbstraction(unittest.TestCase):
    """Verifies the provider abstraction layer and factory resolution."""

    def test_default_providers_are_nemotron(self):
        vp = get_vision_provider()
        rp = get_reasoning_provider()

        self.assertIsInstance(vp, BaseVisionProvider)
        self.assertIsInstance(vp, NemotronVisionProvider)
        self.assertEqual(vp.provider_name, "nemotron")
        self.assertEqual(vp.model_id, "nvidia/Nemotron-3.5-Super-VL")

        self.assertIsInstance(rp, BaseReasoningProvider)
        self.assertIsInstance(rp, NemotronReasoningProvider)
        self.assertEqual(rp.provider_name, "nemotron")
        self.assertEqual(rp.model_id, "nvidia/Nemotron-3_5-Lightning")

    def test_muse_scaffold_raises_not_implemented(self):
        vp = get_vision_provider("muse")
        rp = get_reasoning_provider("muse")

        self.assertIsInstance(vp, MuseVisionProvider)
        self.assertIsInstance(rp, MuseReasoningProvider)
        self.assertEqual(vp.provider_name, "muse")
        self.assertEqual(rp.provider_name, "muse")

        with self.assertRaises(NotImplementedError):
            vp.verify_candidate_pair(b"suspect", b"ref")

        with self.assertRaises(NotImplementedError):
            rp.generate_investigation_report(None)

    def test_invalid_provider_name_raises_value_error(self):
        with self.assertRaises(ValueError):
            get_vision_provider("invalid-provider-xyz")

        with self.assertRaises(ValueError):
            get_reasoning_provider("invalid-provider-xyz")


class TestPhase31StoryboardExtraction(unittest.TestCase):
    """Verifies storyboard sprite sheet parsing, tile cropping, and entropy filtering."""

    def test_storyboard_spec_parsing_from_formats(self):
        fake_info = {
            "title": "Championship Match Highlights",
            "formats": [
                {
                    "format_id": "sb1",
                    "format_note": "storyboard",
                    "rows": 5,
                    "columns": 5,
                    "fragments": [
                        {"url": "https://example.com/sb_m0.jpg", "duration": 60.0},
                        {"url": "https://example.com/sb_m1.jpg", "duration": 60.0},
                    ],
                },
                {"format_id": "22", "format_note": "720p", "url": "https://example.com/vid.mp4"},
            ],
            "thumbnails": [{"url": "https://example.com/thumb.jpg", "width": 1280, "height": 720}],
        }

        with patch("yt_dlp.YoutubeDL") as mock_ydl:
            mock_inst = MagicMock()
            mock_inst.extract_info.return_value = fake_info
            mock_ydl.return_value.__enter__.return_value = mock_inst

            meta = extract_public_video_metadata("https://www.youtube.com/watch?v=fake1234567")
            self.assertIn("storyboards", meta)
            self.assertEqual(len(meta["storyboards"]), 1)
            sb = meta["storyboards"][0]
            self.assertEqual(sb["format_id"], "sb1")
            self.assertEqual(sb["rows"], 5)
            self.assertEqual(sb["columns"], 5)
            self.assertEqual(len(sb["fragments"]), 2)

    def test_sprite_sheet_tile_cropping_coordinates(self):
        """Creates a synthetic 500x500 sprite sheet (5x5 tiles) and checks tile slicing."""
        cols = 5
        rows = 5
        tile_w = 100
        tile_h = 100
        sprite = Image.new("RGB", (cols * tile_w, rows * tile_h), color=(128, 128, 128))

        # Crop tile at row 2, col 3 (tile index 13)
        r, c = 2, 3
        box = (c * tile_w, r * tile_h, (c + 1) * tile_w, (r + 1) * tile_h)
        tile = sprite.crop(box)

        self.assertEqual(tile.size, (100, 100))

    def test_blank_storyboard_tile_entropy_rejection(self):
        """Solid blank tiles should fail the minimum entropy gate."""
        solid_img = Image.new("RGB", (100, 100), color=(0, 0, 0))
        entropy = compute_image_entropy(solid_img)
        self.assertLess(entropy, MIN_IMAGE_ENTROPY)

        # Non-solid image should pass
        pattern = Image.new("RGB", (100, 100))
        for x in range(100):
            for y in range(100):
                pattern.putpixel((x, y), ((x * 7) % 256, (y * 13) % 256, ((x + y) * 5) % 256))
        pat_entropy = compute_image_entropy(pattern)
        self.assertGreaterEqual(pat_entropy, MIN_IMAGE_ENTROPY)


class TestPhase31CloudPersistenceAndSessionIsolation(unittest.TestCase):
    """Verifies vision cache, incident session isolation, and storage paths."""

    def test_vision_verification_caching_roundtrip(self):
        key = compute_pair_cache_key(b"test_suspect_frame_data_xyz", b"test_reference_frame_data_abc")
        fake_res = {
            "cache_key": key,
            "visual_correspondence": "HIGH_CORRESPONDENCE",
            "confidence_assessment": "HIGH",
            "matching_features": ["Identical scoreboard bug", "Same team jerseys"],
            "contradictions": [],
            "reasoning": "Forensic comparison demonstrates visual match.",
            "uncertainty_factors": [],
            "validation_status": "VERIFIED",
            "model_id": "nvidia/Nemotron-3.5-Super-VL",
            "latency_ms": 320,
        }

        store_cached_verification(key, fake_res)
        cached = get_cached_verification(key)

        self.assertIsNotNone(cached)
        self.assertEqual(cached["visual_correspondence"], "HIGH_CORRESPONDENCE")
        self.assertEqual(len(cached["matching_features"]), 2)

    def test_session_isolation_in_incidents(self):
        session_a = "sess_user_alpha_123"
        session_b = "sess_user_beta_456"
        id_a = str(uuid.uuid4())
        id_b = str(uuid.uuid4())

        inc_a = {
            "incident_id": id_a,
            "investigation_type": "FULL_VIDEO_SCAN",
            "suspect_filename": "alpha.mp4",
            "session_id": session_a,
            "suspect_storage_path": "suspect-videos/alpha.mp4",
        }
        inc_b = {
            "incident_id": id_b,
            "investigation_type": "FULL_VIDEO_SCAN",
            "suspect_filename": "beta.mp4",
            "session_id": session_b,
            "suspect_storage_path": "suspect-videos/beta.mp4",
        }

        save_incident(inc_a, session_id=session_a)
        save_incident(inc_b, session_id=session_b)

        # In local or cloud mode, filtering by session_a should see inc_a, not inc_b
        results_a = load_incidents(session_id=session_a)
        ids_a = [r["incident_id"] for r in results_a]
        self.assertIn(id_a, ids_a)
        self.assertNotIn(id_b, ids_a)


if __name__ == "__main__":
    unittest.main()
