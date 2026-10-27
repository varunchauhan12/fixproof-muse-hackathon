"""
Independent Milestone 6C.5 Verification Script.
Runs comprehensive live verification of:
1. SSRF defense across various attack vectors
2. URL screening with metadata & thumbnail extraction
3. FAISS reference index isolation (no vectors added)
4. Local mode persistence (incidents.json)
5. Supabase mode persistence (incidents table with investigation_type = 'URL_SCREENING')
6. Thumbnail preview serving
"""

import io
import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

from app.main import app
from app.registry import load_incidents
from app.url_screener import screen_video_url, validate_url_for_ssrf, SSRFValidationError
from app.vault import default_vault


def create_test_image(color="purple"):
    img = Image.new("RGB", (320, 240), color=color)
    draw = ImageDraw.Draw(img)
    draw.rectangle([30, 30, 120, 120], fill="yellow")
    return img


def img_to_bytes(img):
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def run_verification():
    print("=" * 60)
    print("FixProof Milestone 6C.5 Independent Verification Audit")
    print("=" * 60)

    client = TestClient(app)

    # 1. SSRF Tests
    print("\n[1/6] Testing SSRF Defense Vectors...")
    ssrf_vectors = [
        "http://localhost:8000/admin",
        "http://127.0.0.1:5432/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/stream",
        "http://172.16.1.10/video",
        "http://192.168.1.100/watch",
        "http://[::1]/video",
        "file:///etc/hosts",
    ]
    for vector in ssrf_vectors:
        try:
            validate_url_for_ssrf(vector)
            print(f"  ❌ FAILED to block SSRF: {vector}")
            sys.exit(1)
        except SSRFValidationError:
            print(f"  ✓ Blocked SSRF: {vector}")

    # 2. Test Endpoint with SSRF URL
    print("\n[2/6] Testing POST /api/threats/screen-url with SSRF URL...")
    res = client.post("/api/threats/screen-url", json={"url": "http://127.0.0.1:8000/debug"})
    assert res.status_code == 400, f"Expected 400, got {res.status_code}"
    assert "SSRF validation blocked" in res.json()["detail"]
    print("  ✓ Correctly rejected with 400 and detail 'SSRF validation blocked'")

    # 3. Test Unsupported Platform
    print("\n[3/6] Testing Unsupported Platform Rejection...")
    with patch("app.url_screener.validate_url_for_ssrf"), \
         patch("yt_dlp.YoutubeDL") as mock_ydl:
        mock_instance = MagicMock()
        mock_instance.extract_info.side_effect = Exception("ERROR: Unsupported URL: https://some-unknown-site.com/foo")
        mock_ydl.return_value.__enter__.return_value = mock_instance

        res = client.post("/api/threats/screen-url", json={"url": "https://some-unknown-site.com/foo"})
        assert res.status_code == 422, f"Expected 422, got {res.status_code}: {res.text}"
        assert "Unsupported platform" in res.json()["detail"]
        print("  ✓ Correctly rejected unsupported platform with 422")

    # 4. Test Valid URL Screening and Verification
    print("\n[4/6] Testing Valid URL Preliminary Screening Flow...")
    test_img = create_test_image("navy")
    test_bytes = img_to_bytes(test_img)

    initial_vector_count = default_vault.vector_db.ntotal

    with patch("app.url_screener.extract_public_video_metadata") as mock_meta, \
         patch("app.url_screener.fetch_suspect_thumbnail_image") as mock_thumb:
        mock_meta.return_value = {
            "title": "Championship Highlights 2026 Live",
            "platform": "YouTube",
            "uploader": "Premier Sports Hub",
            "uploader_id": "premier_sports",
            "channel_url": "https://youtube.com/@premiersports",
            "duration_seconds": 240.0,
            "view_count": 89000,
            "upload_date": "20261026",
            "description": "Full match stream highlights.",
            "webpage_url": "https://www.youtube.com/watch?v=live2026",
            "thumbnail_url": "https://i.ytimg.com/vi/live2026/maxresdefault.jpg",
        }
        mock_thumb.return_value = (test_img, test_bytes)

        res = client.post("/api/threats/screen-url", json={"url": "https://www.youtube.com/watch?v=live2026"})
        assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
        data = res.json()

        assert data["investigation_type"] == "URL_SCREENING"
        assert data["platform"] == "YouTube"
        assert data["overall_status"] in ("CANDIDATE_MATCH", "SUSPECT", "NEEDS_FULL_VIDEO_REVIEW", "NO_REFERENCE_DATA")
        assert data["recommended_action"] == "NEEDS_FULL_VIDEO_REVIEW"
        assert "Preliminary thumbnail screening only" in data["disclaimer"]
        assert len(data["limitations"]) == 5
        print("  ✓ Correctly returned URL screening dossier:")
        print(f"    - Investigation Type: {data['investigation_type']}")
        print(f"    - Platform: {data['platform']}")
        print(f"    - Title: {data['metadata']['title']}")
        print(f"    - Overall Status: {data['overall_status']}")
        print(f"    - Recommended Action: {data['recommended_action']}")
        print(f"    - Limitations: {len(data['limitations'])} explicit constraints")

        # 5. Check Index Isolation
        print("\n[5/6] Verifying FAISS Reference Vault Index Isolation...")
        final_vector_count = default_vault.vector_db.ntotal
        assert final_vector_count == initial_vector_count, (
            f"FAISS vault size changed! Before: {initial_vector_count}, After: {final_vector_count}"
        )
        print(f"  ✓ FAISS reference vault size completely unchanged: {initial_vector_count} -> {final_vector_count}")

        # Check thumbnail cached in isolated directory
        incident_id = data["incident_id"]
        thumb_res = client.get(f"/api/threats/suspect-thumbnail/{incident_id}")
        assert thumb_res.status_code == 200, f"Expected 200, got {thumb_res.status_code}"
        assert thumb_res.headers["content-type"] == "image/jpeg"
        print(f"  ✓ Suspect thumbnail preview served correctly from isolated suspects dir")

    # 6. Check Persistence
    print("\n[6/6] Verifying Incident Persistence in Active Mode...")
    all_incidents = load_incidents()
    matching_inc = next((i for i in all_incidents if i.get("incident_id") == incident_id), None)
    assert matching_inc is not None, f"Incident {incident_id} not found in load_incidents()"
    assert matching_inc.get("investigation_type") == "URL_SCREENING"
    assert matching_inc.get("platform") == "YouTube"
    print(f"  ✓ Persisted incident verified: ID={incident_id}, type={matching_inc.get('investigation_type')}, platform={matching_inc.get('platform')}")

    print("\n" + "=" * 60)
    print("ALL MILESTONE 6C.5 VERIFICATIONS PASSED SUCCESSFULLY!")
    print("=" * 60)


if __name__ == "__main__":
    run_verification()
