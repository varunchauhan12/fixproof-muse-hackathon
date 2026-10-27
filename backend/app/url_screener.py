"""
URL-Based Video Screening module for FixProof (Phase 2.2).
Ported and adapted from MediaGuard Sports (agents/spider.py & agents/sentinel.py).

Features:
- Validates public video URLs and blocks SSRF vectors (localhost, private IP ranges,
  cloud metadata endpoints, loopback, link-local, unsafe redirects).
- Uses yt-dlp strictly with download=False to extract public metadata and thumbnail URL
  without downloading or streaming third-party video.
- Discovers primary public thumbnail plus permitted preview/storyboard candidates.
- Evaluates candidate frames against reference vault using MobileNetV3 (576-dim) + pHash.
- Enforces Shannon image entropy filter to reject blank/solid test patterns.
- Submits top candidate pairs to Nemotron Vision Verification (nvidia/Nemotron-3.5-Super-VL).
- Isolated storage: Suspect thumbnails are kept strictly under storage/suspects/thumbnails/
  and NEVER indexed into the trusted FAISS reference vault.
- Returns structured preliminary screening results with mandatory disclaimer,
  limitations list, and recommended action ('NEEDS_FULL_VIDEO_REVIEW').
"""

import io
import ipaddress
import logging
import re
import socket
import urllib.parse
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image
import requests
import yt_dlp

from app.matcher import (
    match_single_frame,
    l2_to_confidence,
    l2_to_visual_similarity,
    severity_from_confidence,
    compute_image_entropy,
    load_reference_frame_image,
    MATCH_THRESHOLD,
    SUSPECT_THRESHOLD,
    MIN_IMAGE_ENTROPY,
    SCORE_VERSION,
    VISUAL_SIMILARITY_NOTICE,
)
from app.registry import save_incident
from app.vault import ReferenceVault, default_vault
from app.vision_verifier import verify_candidate_pair

logger = logging.getLogger(__name__)

# Directory for caching screened suspect thumbnails (isolated from reference storage)
SUSPECTS_THUMBNAILS_DIR = Path(__file__).resolve().parent.parent / "storage" / "suspects" / "thumbnails"
SUSPECTS_THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)

# Maximum thumbnail download size (10 MB)
MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024

# Restricted IP networks for SSRF defense
RESTRICTED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),          # Current network
    ipaddress.ip_network("10.0.0.0/8"),          # Private RFC 1918
    ipaddress.ip_network("100.64.0.0/10"),       # Carrier-grade NAT
    ipaddress.ip_network("127.0.0.0/8"),        # Loopback
    ipaddress.ip_network("169.254.0.0/16"),      # Link-local / Cloud metadata (AWS, GCP, Azure)
    ipaddress.ip_network("172.16.0.0/12"),       # Private RFC 1918
    ipaddress.ip_network("192.0.0.0/24"),        # IETF protocol assignments
    ipaddress.ip_network("192.0.2.0/24"),        # TEST-NET-1
    ipaddress.ip_network("192.168.0.0/16"),      # Private RFC 1918
    ipaddress.ip_network("198.18.0.0/15"),       # Benchmarking
    ipaddress.ip_network("198.51.100.0/24"),     # TEST-NET-2
    ipaddress.ip_network("203.0.113.0/24"),      # TEST-NET-3
    ipaddress.ip_network("224.0.0.0/4"),        # Multicast
    ipaddress.ip_network("240.0.0.0/4"),        # Reserved
    ipaddress.ip_network("255.255.255.255/32"), # Limited broadcast
    ipaddress.ip_network("::1/128"),            # IPv6 loopback
    ipaddress.ip_network("::/128"),             # IPv6 unspecified
    ipaddress.ip_network("fc00::/7"),           # IPv6 Unique Local
    ipaddress.ip_network("fe80::/10"),          # IPv6 Link-Local
]

BLOCKED_HOSTNAMES = {
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "metadata.google.internal",
    "metadata",
    "instance-data",
}

PRELIMINARY_SCREENING_DISCLAIMER = (
    "Preliminary preview screening only. A visual similarity match on public preview thumbnails is NOT "
    "a definitive copyright-infringement finding and cannot verify the contents of the full video. "
    "Definitive legal assessment requires authorized full video review."
)

SCREENING_LIMITATIONS = [
    "Evaluated public preview thumbnail images; third-party video stream was not downloaded per platform restrictions.",
    "Video stream was not bypassed, downloaded, or ingested per platform protections.",
    "Video content may differ from public thumbnail artwork or preview stills.",
    "A clean thumbnail screening result does NOT guarantee non-infringing video content.",
    "Visual similarity measurements are not calibrated probabilities of infringement.",
]


class SSRFValidationError(Exception):
    """Raised when a URL targets restricted internal, private, or loopback network addresses."""
    pass


class UnsupportedPlatformError(Exception):
    """Raised when a video URL belongs to an unsupported or unrecognized platform."""
    pass


class MetadataExtractionError(Exception):
    """Raised when public video metadata or thumbnail cannot be retrieved."""
    pass


def is_ip_restricted(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Checks whether an IP address belongs to any private, loopback, or reserved network range."""
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return True

    for net in RESTRICTED_NETWORKS:
        if ip in net:
            return True

    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        return is_ip_restricted(ip.ipv4_mapped)

    return False


def validate_url_for_ssrf(url_str: str) -> urllib.parse.SplitResult:
    """
    Validates a URL against Server-Side Request Forgery (SSRF) threats.
    
    Rules:
    - Only 'http' and 'https' schemes are permitted.
    - Userinfo (username:password@) is forbidden.
    - Hostname must be present and not in BLOCKED_HOSTNAMES.
    - Resolves DNS hostname to IP addresses and rejects any private/loopback/link-local address.
    """
    if not url_str or not isinstance(url_str, str):
        raise SSRFValidationError("URL cannot be empty.")

    url_str = url_str.strip()
    try:
        parsed = urllib.parse.urlsplit(url_str)
    except Exception as e:
        raise SSRFValidationError(f"Malformed URL: {e}")

    scheme = (parsed.scheme or "").lower()
    if scheme not in ("http", "https"):
        raise SSRFValidationError(f"Invalid URL scheme '{scheme}'. Only http and https are permitted.")

    if parsed.username or parsed.password:
        raise SSRFValidationError("Credentials in URLs are forbidden.")

    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        raise SSRFValidationError("URL must include a valid hostname.")

    clean_host = hostname.strip("[]")
    if clean_host in BLOCKED_HOSTNAMES:
        raise SSRFValidationError(f"Access to host '{hostname}' is blocked for security.")

    try:
        ip = ipaddress.ip_address(clean_host)
        if is_ip_restricted(ip):
            raise SSRFValidationError(f"Direct access to private/restricted IP '{ip}' is blocked.")
        return parsed
    except ValueError:
        pass

    port = parsed.port or (443 if scheme == "https" else 80)
    try:
        addr_info = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise SSRFValidationError(f"Failed to resolve domain '{hostname}': {e}")
    except Exception as e:
        raise SSRFValidationError(f"DNS resolution error for '{hostname}': {e}")

    if not addr_info:
        raise SSRFValidationError(f"No IP addresses resolved for domain '{hostname}'.")

    for entry in addr_info:
        sockaddr = entry[4]
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
            if is_ip_restricted(ip):
                raise SSRFValidationError(
                    f"Domain '{hostname}' resolves to restricted/internal IP '{ip_str}', access blocked."
                )
        except ValueError:
            raise SSRFValidationError(f"Invalid IP address '{ip_str}' resolved for domain '{hostname}'.")

    return parsed


def fetch_suspect_thumbnail_image(
    thumbnail_url: str,
    timeout_sec: float = 10.0,
    max_bytes: int = MAX_THUMBNAIL_BYTES,
) -> Tuple[Image.Image, bytes]:
    """
    Safely retrieves a suspect thumbnail image using SSRF-validated redirects
    and strict preflight payload size limits.
    """
    current_url = thumbnail_url.strip()
    max_redirects = 5
    raw_content = bytearray()

    for _ in range(max_redirects):
        validate_url_for_ssrf(current_url)

        try:
            resp = requests.get(
                current_url,
                allow_redirects=False,
                timeout=timeout_sec,
                headers={"User-Agent": "FixProof-URL-Screener/1.0 (+https://fixproof.internal)"},
                stream=True,
            )
        except requests.RequestException as e:
            raise MetadataExtractionError(f"Failed to connect to thumbnail URL: {e}")

        if resp.status_code in (301, 302, 303, 307, 308):
            location = resp.headers.get("Location")
            if not location:
                raise MetadataExtractionError("Redirect response missing Location header.")
            current_url = urllib.parse.urljoin(current_url, location)
            continue

        if resp.status_code != 200:
            raise MetadataExtractionError(f"Thumbnail fetch returned HTTP status {resp.status_code}.")

        cl_header = resp.headers.get("Content-Length")
        if cl_header:
            try:
                if int(cl_header) > max_bytes:
                    raise MetadataExtractionError(
                        f"Thumbnail exceeds maximum size of {max_bytes // (1024 * 1024)} MB."
                    )
            except ValueError:
                pass

        try:
            for chunk in resp.iter_content(chunk_size=32768):
                if chunk:
                    raw_content.extend(chunk)
                    if len(raw_content) > max_bytes:
                        raise MetadataExtractionError(
                            f"Thumbnail payload exceeded {max_bytes // (1024 * 1024)} MB limit."
                        )
        except requests.RequestException as e:
            raise MetadataExtractionError(f"Interrupted while reading thumbnail stream: {e}")
        break
    else:
        raise MetadataExtractionError("Too many redirects encountered while fetching thumbnail.")

    if not raw_content:
        raise MetadataExtractionError("Retrieved thumbnail is empty (0 bytes).")

    try:
        pil_img = Image.open(io.BytesIO(raw_content)).convert("RGB")
    except Exception as e:
        raise MetadataExtractionError(f"Failed to decode image data into valid picture: {e}")

    return pil_img, bytes(raw_content)


def detect_platform_from_info(info: Dict[str, Any], url: str) -> str:
    """Normalizes the detected platform name from yt-dlp extractor info or URL."""
    extractor = (info.get("extractor_key") or info.get("extractor") or "").lower()
    url_lower = url.lower()

    if "youtube" in extractor or "youtu.be" in url_lower or "youtube.com" in url_lower:
        return "YouTube"
    if "vimeo" in extractor or "vimeo.com" in url_lower:
        return "Vimeo"
    if "twitch" in extractor or "twitch.tv" in url_lower:
        return "Twitch"
    if "dailymotion" in extractor or "dailymotion.com" in url_lower:
        return "Dailymotion"
    if "tiktok" in extractor or "tiktok.com" in url_lower:
        return "TikTok"
    if "twitter" in extractor or "x.com" in url_lower or "twitter.com" in url_lower:
        return "Twitter / X"

    if extractor:
        return extractor.capitalize()
    return "Public Video Platform"


def extract_public_video_metadata(url: str) -> Dict[str, Any]:
    """
    Extracts public video metadata and thumbnail URLs using yt-dlp without downloading streams.
    Discovers primary thumbnail plus permitted preview candidate URLs.
    """
    validate_url_for_ssrf(url)

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "extract_flat": False,
        "socket_timeout": 10,
        "no_color": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                raise MetadataExtractionError("No metadata returned by video extractor.")
    except SSRFValidationError:
        raise
    except Exception as e:
        err_msg = str(e).strip()
        first_line = err_msg.split("\n")[0]
        if "Unsupported URL" in err_msg or "is not a valid URL" in err_msg:
            raise UnsupportedPlatformError(
                "Unsupported video URL or platform. FixProof URL screening currently supports public videos "
                "from YouTube, Vimeo, Twitch, and other major video platforms. Direct video files or arbitrary URLs are not supported."
            )
        raise MetadataExtractionError(f"Could not retrieve public metadata: {first_line}")

    # Determine best primary thumbnail URL
    thumbnail_url = info.get("thumbnail")
    raw_thumbnails = info.get("thumbnails") or []

    if not thumbnail_url and raw_thumbnails:
        if isinstance(raw_thumbnails, list) and len(raw_thumbnails) > 0:
            thumbnail_url = raw_thumbnails[-1].get("url")

    # Discover candidate preview URLs (up to 5 distinct preview URLs)
    candidate_urls: List[str] = []
    if thumbnail_url:
        candidate_urls.append(thumbnail_url)

    if isinstance(raw_thumbnails, list):
        for t in raw_thumbnails:
            u = t.get("url")
            if u and isinstance(u, str) and u.startswith("http") and u not in candidate_urls:
                # Filter out tiny favicons or icons under 100px width
                w = t.get("width")
                h = t.get("height")
                if (w is None or w >= 100) and (h is None or h >= 80):
                    candidate_urls.append(u)
            if len(candidate_urls) >= 5:
                break

    platform = detect_platform_from_info(info, url)

    metadata = {
        "title": info.get("title") or "Untitled Public Video",
        "platform": platform,
        "uploader": info.get("uploader") or info.get("channel") or info.get("creator") or "Unknown Creator",
        "uploader_id": info.get("uploader_id") or "",
        "channel_url": info.get("channel_url") or info.get("uploader_url") or "",
        "duration_seconds": float(info.get("duration") or 0.0),
        "view_count": int(info.get("view_count") or 0) if info.get("view_count") is not None else None,
        "upload_date": info.get("upload_date") or "",
        "description": (info.get("description") or "")[:400],
        "webpage_url": info.get("webpage_url") or url,
        "thumbnail_url": thumbnail_url,
        "candidate_thumbnail_urls": candidate_urls,
        "candidate_count": len(candidate_urls),
    }

    return metadata


def screen_video_url(
    url: str,
    vault: Optional[ReferenceVault] = None,
    run_vision_verification: bool = True,
) -> Dict[str, Any]:
    """
    Orchestrates URL-based preliminary video screening.
    Evaluates discovered candidate preview images against the reference FAISS vault
    and executes bounded Nemotron vision verification on top candidate matches.
    """
    if vault is None:
        vault = default_vault

    incident_id = str(uuid.uuid4())
    scanned_at = datetime.now(timezone.utc).isoformat()

    # Step 1: Extract public metadata
    metadata = extract_public_video_metadata(url)
    candidate_urls = metadata.get("candidate_thumbnail_urls") or []
    if not candidate_urls and metadata.get("thumbnail_url"):
        candidate_urls = [metadata["thumbnail_url"]]

    if not candidate_urls:
        raise MetadataExtractionError(
            "Video metadata retrieved successfully, but no public thumbnail image was found. "
            "Screening cannot proceed without a thumbnail."
        )

    screening_mode = "MULTI_FRAME_PREVIEW_SCREENING" if len(candidate_urls) > 1 else "SINGLE_FRAME_PRELIMINARY"

    frame_matches = []
    highest_confidence = 0.0
    lowest_l2_distance = None
    candidate_matches_found = 0
    matched_asset_ids = set()
    raw_bytes_primary = b""

    # Candidate pairs shortlisted for second-stage Nemotron vision verification
    candidate_pairs_to_verify: List[Dict[str, Any]] = []

    for c_idx, c_url in enumerate(candidate_urls[:5]):
        try:
            pil_img, raw_bytes = fetch_suspect_thumbnail_image(c_url)
            if c_idx == 0:
                raw_bytes_primary = raw_bytes

            # Cache preview image locally in suspects directory
            cached_path = SUSPECTS_THUMBNAILS_DIR / f"{incident_id}_{c_idx}.jpg"
            if c_idx == 0:
                # Also save standard {incident_id}.jpg for legacy endpoints
                (SUSPECTS_THUMBNAILS_DIR / f"{incident_id}.jpg").write_bytes(raw_bytes)
            cached_path.write_bytes(raw_bytes)

            entropy_val = compute_image_entropy(pil_img)
            is_low_entropy = bool(entropy_val < MIN_IMAGE_ENTROPY)

            # Match against FAISS vault
            match_result = match_single_frame(
                suspect_img=pil_img,
                submitted_asset_id=incident_id,
                vault=vault,
                k=3,
            )

            best_match = match_result.get("best_match") if match_result else None
            top_candidates = match_result.get("top_candidates", []) if match_result else []

            frame_info = {
                "frame_index": c_idx,
                "timestamp_sec": c_idx * 5,  # Heuristic preview offset
                "filename": f"preview_{incident_id[:8]}_{c_idx}.jpg",
                "frame_path": str(cached_path),
                "entropy": entropy_val,
                "low_entropy_flag": is_low_entropy,
            }

            if best_match:
                conf = float(best_match.get("confidence_score") or 0.0)
                dist = float(best_match.get("l2_distance")) if best_match.get("l2_distance") is not None else None

                if conf > highest_confidence:
                    highest_confidence = conf
                if dist is not None and (lowest_l2_distance is None or dist < lowest_l2_distance):
                    lowest_l2_distance = dist

                if best_match.get("match_confirmed"):
                    candidate_matches_found += 1
                    matched_asset_ids.add(best_match.get("source_asset_id"))
                elif dist is not None and dist < SUSPECT_THRESHOLD:
                    matched_asset_ids.add(best_match.get("source_asset_id"))

                # Shortlist for Nemotron vision verification if passing CV gates
                if (
                    dist is not None
                    and dist < SUSPECT_THRESHOLD
                    and not is_low_entropy
                    and (best_match.get("phash_match") or best_match.get("phash_score", 0) >= 30)
                ):
                    comp_rank = 0.6 * (1.0 - min(1.0, dist)) + 0.4 * (best_match.get("phash_score", 0) / 100.0)
                    candidate_pairs_to_verify.append({
                        "frame_match_idx": len(frame_matches),
                        "suspect_pil": pil_img,
                        "best_match": best_match,
                        "composite_rank": comp_rank,
                    })

                frame_matches.append({
                    "submitted_frame": frame_info,
                    "best_match": best_match,
                    "top_candidates": top_candidates,
                })
            else:
                frame_matches.append({
                    "submitted_frame": frame_info,
                    "best_match": None,
                    "top_candidates": [],
                })

        except Exception as e:
            logger.warning(f"[URL Screener] Error screening candidate preview {c_idx} ({c_url}): {e}")
            continue

    if not frame_matches:
        raise MetadataExtractionError("Could not retrieve or process any candidate preview images.")

    # Execute Bounded Nemotron Vision Verification on Top Candidates (Max 3)
    if run_vision_verification and candidate_pairs_to_verify:
        try:
            candidate_pairs_to_verify.sort(key=lambda x: x["composite_rank"], reverse=True)
            top_pairs = candidate_pairs_to_verify[:3]

            for pair_idx, cand in enumerate(top_pairs):
                best = cand["best_match"]
                ref_pil = load_reference_frame_image(best)
                if ref_pil and cand.get("suspect_pil"):
                    v_res = verify_candidate_pair(
                        suspect_img=cand["suspect_pil"],
                        ref_img=ref_pil,
                        suspect_timestamp_sec=0.0,
                        reference_timestamp_sec=float(best.get("source_timestamp_sec", 0.0)),
                        source_asset_id=str(best.get("source_asset_id", "")),
                        candidate_pair_index=pair_idx,
                    )
                    fm_idx = cand["frame_match_idx"]
                    frame_matches[fm_idx]["best_match"]["vision_verification"] = v_res
        except Exception as e:
            logger.warning(f"[URL Screener] Vision verification stage encountered error: {e}")

    # Determine overall status & recommended action
    if vault.vector_db.ntotal == 0:
        overall_status = "NO_REFERENCE_DATA"
        status_message = "Reference library is empty. No reference videos are currently indexed for comparison."
    elif candidate_matches_found > 0:
        overall_status = "CANDIDATE_MATCH"
        status_message = (
            f"Preliminary visual match detected on preview thumbnail against reference asset '{list(matched_asset_ids)[0]}'. "
            "Thumbnail match is preliminary; authorized full video review is required for definitive assessment."
        )
    elif lowest_l2_distance is not None and lowest_l2_distance < SUSPECT_THRESHOLD:
        overall_status = "SUSPECT"
        status_message = (
            "Visual proximity to reference asset detected on preview thumbnail image. "
            "Preliminary preview check requires full video review."
        )
    else:
        overall_status = "NEEDS_FULL_VIDEO_REVIEW"
        status_message = (
            "No visual match detected on the public preview thumbnail image(s). Because only static preview images "
            "were screened, full video content remains unverified. If copyright infringement is suspected, "
            "authorized full video acquisition and review is required."
        )

    # Format incident record
    incident_record = {
        "incident_id": incident_id,
        "investigation_type": "URL_SCREENING",
        "screening_mode": screening_mode,
        "suspect_filename": f"[{metadata['platform']}] {metadata['title']}",
        "suspect_url": url,
        "source_url": url,
        "platform": metadata["platform"],
        "metadata": metadata,
        "thumbnail_url": metadata.get("thumbnail_url"),
        "suspect_thumbnail_preview_url": f"/api/threats/suspect-thumbnail/{incident_id}",
        "file_size": len(raw_bytes_primary),
        "duration_seconds": metadata.get("duration_seconds", 0.0),
        "total_frames_analyzed": len(frame_matches),
        "frame_count": len(frame_matches),
        "candidate_matches_found": candidate_matches_found,
        "highest_confidence": highest_confidence,
        "highest_visual_similarity": highest_confidence,
        "lowest_l2_distance": lowest_l2_distance,
        "overall_status": overall_status,
        "recommended_action": "NEEDS_FULL_VIDEO_REVIEW",
        "status_message": status_message,
        "matched_assets": sorted(list(matched_asset_ids)),
        "frame_matches": frame_matches,
        "score_version": SCORE_VERSION,
        "score_calibration_notice": VISUAL_SIMILARITY_NOTICE,
        "disclaimer": PRELIMINARY_SCREENING_DISCLAIMER,
        "limitations": SCREENING_LIMITATIONS,
        "scanned_at": scanned_at,
    }

    try:
        save_incident(incident_record)
    except Exception as e:
        logger.error(f"[URL Screener] Failed to persist incident {incident_id}: {e}")

    return incident_record
