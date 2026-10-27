import urllib.request
import urllib.error
import json
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def post_file(url, filepath):
    boundary = "----WebKitFormBoundaryFixProofTest7MA4YWxkTrZu0gW"
    filename = Path(filepath).name
    with open(filepath, "rb") as f:
        file_bytes = f.read()

    body = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        f"Content-Type: video/mp4\r\n\r\n"
    ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")

print("==================================================")
print("FIXPROOF MATCHING QUALITY EVALUATION")
print("==================================================")

# 1. Identical copy
code1, res1 = post_file("http://localhost:8000/api/threats/scan", "acceptance_ref_broadcast.mp4")
print("\n[TEST 1] Identical Reference/Suspect Video:")
print(f"  HTTP: {code1}")
print(f"  Status: {res1.get('overall_status')}")
print(f"  Confidence: {res1.get('highest_confidence')}%")
print(f"  L2 Distance: {res1.get('lowest_l2_distance')}")
print(f"  Candidate Matches Found: {res1.get('candidate_matches_found')}")
if res1.get('frame_matches'):
    bm = res1['frame_matches'][0].get('best_match')
    print(f"  Frame 0: L2={bm.get('l2_distance')}, Conf={bm.get('confidence_score')}%, pHash Match={bm.get('phash_match')}, pHash Score={bm.get('phash_score')}")

# 2. Re-encoded copy
code2, res2 = post_file("http://localhost:8000/api/threats/scan", "test_reencoded.mp4")
print("\n[TEST 2] Re-encoded Copy of Reference:")
print(f"  HTTP: {code2}")
print(f"  Status: {res2.get('overall_status')}")
print(f"  Confidence: {res2.get('highest_confidence')}%")
print(f"  L2 Distance: {res2.get('lowest_l2_distance')}")
print(f"  Candidate Matches Found: {res2.get('candidate_matches_found')}")
if res2.get('frame_matches'):
    bm = res2['frame_matches'][0].get('best_match')
    print(f"  Frame 0: L2={bm.get('l2_distance')}, Conf={bm.get('confidence_score')}%, pHash Match={bm.get('phash_match')}, pHash Score={bm.get('phash_score')}")

# 3. Resized and compressed copy
code3, res3 = post_file("http://localhost:8000/api/threats/scan", "test_resized.mp4")
print("\n[TEST 3] Resized & Compressed Copy (downscaled + noise):")
print(f"  HTTP: {code3}")
print(f"  Status: {res3.get('overall_status')}")
print(f"  Confidence: {res3.get('highest_confidence')}%")
print(f"  L2 Distance: {res3.get('lowest_l2_distance')}")
print(f"  Candidate Matches Found: {res3.get('candidate_matches_found')}")
if res3.get('frame_matches'):
    bm = res3['frame_matches'][0].get('best_match')
    print(f"  Frame 0: L2={bm.get('l2_distance')}, Conf={bm.get('confidence_score')}%, pHash Match={bm.get('phash_match')}, pHash Score={bm.get('phash_score')}")

# 4. Short clip (6 seconds from middle)
code4, res4 = post_file("http://localhost:8000/api/threats/scan", "test_subclip.mp4")
print("\n[TEST 4] Short Clip Subsegment:")
print(f"  HTTP: {code4}")
print(f"  Status: {res4.get('overall_status')}")
print(f"  Confidence: {res4.get('highest_confidence')}%")
print(f"  L2 Distance: {res4.get('lowest_l2_distance')}")
print(f"  Candidate Matches Found: {res4.get('candidate_matches_found')}")

# 5. Unrelated video
code5, res5 = post_file("http://localhost:8000/api/threats/scan", "test_unrelated.mp4")
print("\n[TEST 5] Unrelated Video (Green / Brown Shapes):")
print(f"  HTTP: {code5}")
print(f"  Status: {res5.get('overall_status')}")
print(f"  Confidence: {res5.get('highest_confidence')}%")
print(f"  L2 Distance: {res5.get('lowest_l2_distance')}")
print(f"  Candidate Matches Found: {res5.get('candidate_matches_found')}")

# 6. Corrupt video
Path("test_corrupt.mp4").write_bytes(b"CORRUPTED_STREAM_HEADER_INVALID_DATA" * 50)
code6, res6 = post_file("http://localhost:8000/api/threats/scan", "test_corrupt.mp4")
print("\n[TEST 6] Corrupt Video:")
print(f"  HTTP: {code6}")
print(f"  Response: {res6}")


# 7. Empty Reference Vault (isolated check using empty vault instance)
from app.vault import ReferenceVault
from app.matcher import analyze_asset_matches
empty_vault = ReferenceVault(vault_dir=Path(os.environ.get("TMPDIR", "/tmp")) / "fixproof_empty_test_vault")
empty_vault.clear()
dummy_frames_dir = Path("storage/frames/c7fd5fed-eb3f-493d-a4b4-26a511751289")
res7 = analyze_asset_matches("test-empty-check", dummy_frames_dir, empty_vault)
print("\n[TEST 7] Empty Reference Vault:")
print(f"  Status: {res7.get('overall_status')}")
print(f"  Candidate Matches: {res7.get('candidate_matches_found')}")
print(f"  Message: {res7.get('message')}")
print("==================================================")
