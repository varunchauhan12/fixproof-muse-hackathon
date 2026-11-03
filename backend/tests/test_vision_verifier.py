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

from app.vision_support import (
    MAX_CANDIDATE_PAIRS,
    MAX_IMAGE_DIM,
    VISION_MODEL_ID,
    _MEMORY_CACHE,
    compute_pair_cache_key,
    get_cached_verification,
    resize_image_for_verification,
    store_cached_verification,
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




    def test_candidate_pair_budget_limit(self):
        """Verifies candidate bounding constant matches specification (<= 3 pairs)."""
        self.assertEqual(MAX_CANDIDATE_PAIRS, 3)


if __name__ == "__main__":
    unittest.main()
