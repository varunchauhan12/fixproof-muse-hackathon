"""
URL-Based Video Screening module for FixProof (Milestone 6C.5).
Ported and adapted from MediaGuard Sports (agents/spider.py & agents/sentinel.py).

Features:
- Validates public video URLs and blocks SSRF vectors (localhost, private IP ranges,
  cloud metadata endpoints, loopback, link-local, unsafe redirects).
- Uses yt-dlp strictly with download=False to extract public metadata and thumbnail URL
  without downloading or streaming third-party video.
- Safely retrieves public thumbnail bytes with preflight limits and redirect checks.
- Screens suspect thumbnail against the trusted FAISS reference vault using FixProof's
  MobileNetV3 (576-dim) L2 embeddings and pHash cross-verification.
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

from app.matcher import match_single_frame, l2_to_confidence, severity_from_confidence, MATCH_THRESHOLD, SUSPECT_THRESHOLD
from app.registry import save_incident
from app.vault import ReferenceVault, default_vault

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
    "Preliminary thumbnail screening only. A thumbnail-only visual similarity match is NOT "
    "a definitive copyright-infringement finding and cannot verify the contents of the full video. "
    "Definitive legal or forensic assessment requires full video acquisition and verification."
)

SCREENING_LIMITATIONS = [
    "Evaluated ONLY the public static thumbnail image; underlying video frames were not scanned.",
    "Third-party video stream was not downloaded, inspected, or bypassed per platform restrictions.",
    "Video content may differ substantially from thumbnail artwork, clickbait stills, or title cards.",
    "A clean thumbnail screening result does NOT guarantee non-infringing video content.",
    "Preliminary screening results are non-adjudicative and require full video review."
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
    # Check built-in properties
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return True

    # Check against explicit restricted networks
    for net in RESTRICTED_NETWORKS:
        if ip in net:
            return True

    # Handle IPv4-mapped IPv6 addresses (e.g., ::ffff:127.0.0.1)
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

    # Remove enclosing IPv6 brackets if present
    clean_host = hostname.strip("[]")

    if clean_host in BLOCKED_HOSTNAMES:
        raise SSRFValidationError(f"Access to host '{hostname}' is blocked for security.")

    # Check if host is a direct IP literal
    try:
        ip = ipaddress.ip_address(clean_host)
        if is_ip_restricted(ip):
            raise SSRFValidationError(f"Direct access to private/restricted IP '{ip}' is blocked.")
        return parsed
    except ValueError:
        # Host is a domain name, proceed to DNS resolution
        pass

    # Resolve domain to all IP addresses
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
        # Validate current URL before each outbound request to block redirect SSRF
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

        # Check for HTTP redirect
        if resp.status_code in (301, 302, 303, 307, 308):
            location = resp.headers.get("Location")
            if not location:
                raise MetadataExtractionError("Redirect response missing Location header.")
            current_url = urllib.parse.urljoin(current_url, location)
            continue

        if resp.status_code != 200:
            raise MetadataExtractionError(f"Thumbnail fetch returned HTTP status {resp.status_code}.")

        # Check declared content-length if present
        cl_header = resp.headers.get("Content-Length")
        if cl_header:
            try:
                if int(cl_header) > max_bytes:
                    raise MetadataExtractionError(
                        f"Thumbnail exceeds maximum size of {max_bytes // (1024 * 1024)} MB."
                    )
            except ValueError:
                pass

        # Stream content with hard size cap
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

    # Decode image using PIL
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

    # Fallback to capitalized extractor key if available
    if extractor:
        return extractor.capitalize()
    return "Public Video Platform"


def extract_public_video_metadata(url: str) -> Dict[str, Any]:
    """
    Extracts public video metadata and thumbnail URL using yt-dlp without downloading.
    
    Guarantees:
    - Enforces SSRF preflight validation.
    - Uses download=False, skip_download=True, extract_flat=False.
    - Never accesses third-party video media stream.
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

    # Determine best thumbnail URL
    thumbnail_url = info.get("thumbnail")
    if not thumbnail_url and info.get("thumbnails"):
        # Select thumbnail with highest resolution or last entry
        thumbnails = info.get("thumbnails")
        if isinstance(thumbnails, list) and len(thumbnails) > 0:
            thumbnail_url = thumbnails[-1].get("url")

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
    }

    return metadata


def screen_video_url(
    url: str,
    vault: Optional[ReferenceVault] = None,
) -> Dict[str, Any]:
    """
    Orchestrates URL-based preliminary video screening.
    
    Workflow:
    1. Validates URL against SSRF and platform restrictions.
    2. Extracts public metadata and thumbnail URL without video stream download.
    3. Retrieves public thumbnail image bytes safely.
    4. Screens thumbnail against trusted reference FAISS vault using MobileNetV3 + pHash.
    5. Caches suspect thumbnail locally under storage/suspects/thumbnails/ (never in reference vault).
    6. Persists investigation incident with investigation_type='URL_SCREENING'.
    7. Returns complete evidence dossier with disclaimers and recommended action.
    """
    if vault is None:
        vault = default_vault

    incident_id = str(uuid.uuid4())
    scanned_at = datetime.now(timezone.utc).isoformat()

    # Step 1 & 2: Extract public metadata
    metadata = extract_public_video_metadata(url)
    thumbnail_url = metadata.get("thumbnail_url")

    if not thumbnail_url:
        raise MetadataExtractionError(
            "Video metadata retrieved successfully, but no public thumbnail image was found. "
            "Screening cannot proceed without a thumbnail."
        )

    # Step 3: Safely download suspect thumbnail
    pil_img, raw_bytes = fetch_suspect_thumbnail_image(thumbnail_url)

    # Step 4: Cache suspect thumbnail locally for UI display (isolated in suspects dir)
    cached_thumbnail_path = SUSPECTS_THUMBNAILS_DIR / f"{incident_id}.jpg"
    try:
        cached_thumbnail_path.write_bytes(raw_bytes)
    except Exception as e:
        logger.warning(f"[URL Screener] Could not cache suspect thumbnail on disk: {e}")

    # Step 5: Screen against reference vault
    match_result = match_single_frame(
        suspect_img=pil_img,
        submitted_asset_id=incident_id,
        vault=vault,
        k=3,
    )

    best_match = match_result.get("best_match") if match_result else None
    top_candidates = match_result.get("top_candidates", []) if match_result else []

    # Frame match representation for consistency with incident schema
    frame_matches = []
    thumbnail_frame_info = {
        "frame_index": 0,
        "timestamp_sec": 0,
        "filename": f"thumbnail_{incident_id[:8]}.jpg",
        "frame_path": str(cached_thumbnail_path),
    }

    highest_confidence = 0.0
    lowest_l2_distance = None
    candidate_matches_found = 0
    matched_asset_ids = set()

    if best_match:
        highest_confidence = float(best_match.get("confidence_score") or 0.0)
        lowest_l2_distance = float(best_match.get("l2_distance")) if best_match.get("l2_distance") is not None else None

        if best_match.get("match_confirmed"):
            candidate_matches_found = 1
            matched_asset_ids.add(best_match.get("source_asset_id"))
        elif lowest_l2_distance is not None and lowest_l2_distance < SUSPECT_THRESHOLD:
            matched_asset_ids.add(best_match.get("source_asset_id"))

        frame_matches.append({
            "submitted_frame": thumbnail_frame_info,
            "best_match": best_match,
            "top_candidates": top_candidates,
        })
    else:
        frame_matches.append({
            "submitted_frame": thumbnail_frame_info,
            "best_match": None,
            "top_candidates": [],
        })

    # Determine overall status & recommended action
    # Requirement: "If evidence is insufficient, return NEEDS_FULL_VIDEO_REVIEW rather than claiming the video is clean or pirated."
    if vault.vector_db.ntotal == 0:
        overall_status = "NO_REFERENCE_DATA"
        status_message = "Reference library is empty. No reference videos are currently indexed for comparison."
    elif candidate_matches_found > 0:
        overall_status = "CANDIDATE_MATCH"
        status_message = (
            f"Preliminary visual match detected on thumbnail against reference asset '{list(matched_asset_ids)[0]}'. "
            "Thumbnail match is preliminary; full video review is required for definitive assessment."
        )
    elif highest_confidence >= 62.5:  # L2 distance < 0.75
        overall_status = "SUSPECT"
        status_message = (
            "Visual proximity to reference asset detected on thumbnail image. "
            "Preliminary thumbnail check requires full video review."
        )
    else:
        # Crucial: Thumbnail does not match, but video itself is unverified!
        overall_status = "NEEDS_FULL_VIDEO_REVIEW"
        status_message = (
            "No visual match detected on the public thumbnail image. Because only the static thumbnail "
            "was screened, full video content remains unverified. If copyright infringement is suspected, "
            "full video acquisition and review is required."
        )

    # Format incident record
    incident_record = {
        "incident_id": incident_id,
        "investigation_type": "URL_SCREENING",
        "suspect_filename": f"[{metadata['platform']}] {metadata['title']}",
        "suspect_url": url,
        "source_url": url,
        "platform": metadata["platform"],
        "metadata": metadata,
        "thumbnail_url": thumbnail_url,
        "suspect_thumbnail_preview_url": f"/api/threats/suspect-thumbnail/{incident_id}",
        "file_size": len(raw_bytes),
        "duration_seconds": metadata.get("duration_seconds", 0.0),
        "total_frames_analyzed": 1,  # Thumbnail-only
        "frame_count": 1,
        "candidate_matches_found": candidate_matches_found,
        "highest_confidence": highest_confidence,
        "lowest_l2_distance": lowest_l2_distance,
        "overall_status": overall_status,
        "recommended_action": "NEEDS_FULL_VIDEO_REVIEW",
        "status_message": status_message,
        "matched_assets": sorted(list(matched_asset_ids)),
        "frame_matches": frame_matches,
        "disclaimer": PRELIMINARY_SCREENING_DISCLAIMER,
        "limitations": SCREENING_LIMITATIONS,
        "scanned_at": scanned_at,
    }

    # Step 6: Persist incident in FixProof incident registry (local & Supabase modes)
    try:
        save_incident(incident_record)
    except Exception as e:
        logger.error(f"[URL Screener] Failed to persist incident {incident_id}: {e}")

    return incident_record
