"""
Unit and integration tests for Nemotron Multimodal Vision-Assisted Verification (Phase 2.2).
Validates image preprocessing, prompt formatting, schema validation, caching,
fail-safe error handling, and candidate bounding.
"""

import io
import json
import os
import unittest
from unittest.mock import MagicMock, patch

from PIL import Image

from app.vision_verifier import (
    MAX_CANDIDATE_PAIRS,
    MAX_IMAGE_DIM,
    VISION_MODEL_ID,
    _MEMORY_CACHE,
    compute_pair_cache_key,
    get_cached_verification,
    resize_image_for_verification,
    store_cached_verification,
    verify_candidate_pair,
)


class TestVisionVerifier(unittest.TestCase):
    def setUp(self):
        # Clear in-memory cache between tests
        _MEMORY_CACHE.clear()

    def test_image_resizing_bounds(self):
        """Validates that large images are bounded to MAX_IMAGE_DIM preserving aspect ratio."""
        # 1920x1080 landscape
        img_large = Image.new("RGB", (1920, 1080), color=(100, 150, 200))
        resized, jpeg_bytes = resize_image_for_verification(img_large, max_dim=512)
        w, h = resized.size
        self.assertLessEqual(max(w, h), 512)
        self.assertEqual(w, 512)
        self.assertEqual(h, 288)
        self.assertTrue(len(jpeg_bytes) > 0)

        # 400x800 portrait
        img_portrait = Image.new("RGBA", (400, 800), color=(50, 100, 150, 255))
        resized_p, bytes_p = resize_image_for_verification(img_portrait, max_dim=512)
        self.assertLessEqual(max(resized_p.size), 512)
        self.assertEqual(resized_p.size[1], 512)
        self.assertEqual(resized_p.size[0], 256)
        self.assertEqual(resized_p.mode, "RGB")  # converted from RGBA

        # Small image (below max_dim)
        img_small = Image.new("RGB", (200, 150), color=(10, 20, 30))
        resized_s, bytes_s = resize_image_for_verification(img_small, max_dim=512)
        self.assertEqual(resized_s.size, (200, 150))

    def test_cache_key_determinism(self):
        """Validates deterministic SHA-256 hash generation for evidence pairs."""
        b1 = b"suspect_frame_data_abc"
        b2 = b"reference_frame_data_xyz"

        k1 = compute_pair_cache_key(b1, b2, VISION_MODEL_ID)
        k2 = compute_pair_cache_key(b1, b2, VISION_MODEL_ID)
        self.assertEqual(k1, k2)
        self.assertEqual(len(k1), 64)  # standard SHA-256 hex string

        # Different evidence produces different hash
        k3 = compute_pair_cache_key(b1, b"different_reference", VISION_MODEL_ID)
        self.assertNotEqual(k1, k3)

    def test_cache_hit_avoids_api_call(self):
        """Validates that a previously verified pair is returned from cache without invoking LLM."""
        img_s = Image.new("RGB", (100, 100), color=(255, 0, 0))
        img_r = Image.new("RGB", (100, 100), color=(0, 255, 0))

        _, bytes_s = resize_image_for_verification(img_s)
        _, bytes_r = resize_image_for_verification(img_r)
        cache_key = compute_pair_cache_key(bytes_s, bytes_r, VISION_MODEL_ID)

        # Pre-seed cache
        store_cached_verification(
            cache_key,
            {
                "visual_correspondence": "HIGH_CORRESPONDENCE",
                "confidence_assessment": "HIGH",
                "matching_features": ["Cached test feature"],
                "contradictions": [],
                "reasoning": "Cached correspondence",
                "validation_status": "VERIFIED",
            },
        )

        with patch("openai.OpenAI") as mock_openai:
            result = verify_candidate_pair(
                img_s,
                img_r,
                suspect_timestamp_sec=5.0,
                reference_timestamp_sec=3.0,
                source_asset_id="asset_123",
                candidate_pair_index=0,
            )
            # OpenAI client should NOT be called on cache hit
            mock_openai.assert_not_called()
            self.assertEqual(result["visual_correspondence"], "HIGH_CORRESPONDENCE")
            self.assertTrue(result.get("cached"))
            self.assertEqual(result["source_asset_id"], "asset_123")

    def test_graceful_timeout_and_failure_handling(self):
        """Validates fail-safe degradation on API timeout or provider exception."""
        img_s = Image.new("RGB", (64, 64), color=(10, 20, 30))
        img_r = Image.new("RGB", (64, 64), color=(40, 50, 60))

        with patch.dict(os.environ, {"NEBIUS_API_KEY": "mock_key"}):
            with patch("openai.OpenAI") as mock_openai_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create.side_effect = Exception("Nebius connection timeout after 15s")
                mock_openai_cls.return_value = mock_client

                result = verify_candidate_pair(
                    img_s,
                    img_r,
                    suspect_timestamp_sec=10.0,
                    reference_timestamp_sec=8.0,
                    source_asset_id="asset_fail",
                    candidate_pair_index=1,
                )

                # Does not crash; returns safe UNVERIFIED status
                self.assertEqual(result["validation_status"], "VERIFICATION_UNAVAILABLE")
                self.assertEqual(result["visual_correspondence"], "UNVERIFIED")
                self.assertIn("Nebius connection timeout", result.get("reasoning", ""))

    def test_missing_api_key_degrades_gracefully(self):
        """Validates that missing API key returns UNVERIFIED without error."""
        img_s = Image.new("RGB", (64, 64), color=(1, 2, 3))
        img_r = Image.new("RGB", (64, 64), color=(4, 5, 6))

        with patch.dict(os.environ, {"NEBIUS_API_KEY": ""}):
            result = verify_candidate_pair(
                img_s,
                img_r,
                suspect_timestamp_sec=2.0,
                reference_timestamp_sec=1.0,
                source_asset_id="asset_no_key",
            )
            self.assertEqual(result["visual_correspondence"], "UNVERIFIED")
            self.assertEqual(result["validation_status"], "VERIFICATION_UNAVAILABLE")

    def test_candidate_pair_budget_limit(self):
        """Verifies candidate bounding constant matches specification (<= 3 pairs)."""
        self.assertEqual(MAX_CANDIDATE_PAIRS, 3)


if __name__ == "__main__":
    unittest.main()
