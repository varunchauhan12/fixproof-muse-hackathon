"""
Video frame extraction module for FixProof.
Ported from MediaGuard Sports Archivist logic (agents/archivist.py).
Samples keyframes at regular intervals (default: 1 frame every 5 seconds)
using OpenCV VideoCapture and records timestamp metadata.
"""

from pathlib import Path
import math
import shutil
from typing import Any, Dict, List, Optional, Tuple
import cv2


def _sanitize_fps(fps: Any) -> float:
    """Safely parses and bounds FPS, returning a valid float in [1.0, 240.0]."""
    if fps is None:
        return 1.0
    try:
        f = float(fps)
        if math.isnan(f) or math.isinf(f) or f <= 0:
            return 1.0
        if f > 240.0:
            return 240.0
        return f
    except (TypeError, ValueError, OverflowError):
        return 1.0


def _sanitize_total_frames(total_frames: Any) -> int:
    """Safely parses total frame count, returning an integer >= 0."""
    if total_frames is None:
        return 0
    try:
        f = float(total_frames)
        if math.isnan(f) or math.isinf(f) or f < 0:
            return 0
        return int(f)
    except (TypeError, ValueError, OverflowError):
        return 0


def preflight_video_file(video_path: Path) -> Dict[str, Any]:
    """
    Lightweight video preflight check before directory creation or expensive matching.
    Validates file existence, container integrity, stream decodeability,
    dimensions, and non-zero frames without decoding the entire video.

    Args:
        video_path: Path to the video file on disk.

    Returns:
        Dictionary of validated video metadata (width, height, fps, duration_est, etc.).

    Raises:
        ValueError: If the file is missing, empty, unreadable, corrupted,
                    has zero frames, or has invalid dimensions.
    """
    if not video_path.exists():
        raise ValueError(f"Video file does not exist: {video_path}")

    if not video_path.is_file():
        raise ValueError(f"Path is not a regular file: {video_path}")

    file_size = video_path.stat().st_size
    if file_size == 0:
        raise ValueError(f"Video file is empty (0 bytes): {video_path.name}")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(
            f"Could not open video file: {video_path.name}. Container corrupted or unsupported format."
        )

    try:
        # Read the first frame to confirm codec support and stream decodeability
        ret, first_frame = cap.read()
        if not ret or first_frame is None or first_frame.size == 0:
            raise ValueError(
                f"Video file '{video_path.name}' contains no readable frames or uses an unsupported codec."
            )

        height, width = first_frame.shape[:2]
        if width <= 0 or height <= 0:
            raise ValueError(
                f"Invalid video frame dimensions ({width}x{height}) in '{video_path.name}'."
            )

        raw_fps = cap.get(cv2.CAP_PROP_FPS)
        fps = _sanitize_fps(raw_fps)
        frame_rate = int(round(fps))
        if frame_rate < 1:
            frame_rate = 1

        raw_total = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        total_frames = _sanitize_total_frames(raw_total)

        estimated_duration_sec = 0.0
        if total_frames > 0 and frame_rate > 0:
            estimated_duration_sec = round(total_frames / frame_rate, 2)

        return {
            "is_valid": True,
            "width": width,
            "height": height,
            "fps": fps,
            "frame_rate": frame_rate,
            "total_frames": total_frames,
            "estimated_duration_sec": estimated_duration_sec,
            "file_size": file_size,
        }
    finally:
        cap.release()


def extract_video_frames(
    video_path: Path,
    output_dir: Path,
    sample_interval_sec: int = 5,
    preflight_info: Optional[Dict[str, Any]] = None,
    max_frames: int = 120,
) -> Tuple[float, List[Dict[str, Any]]]:
    """
    Extracts frames from a video file at regular intervals.
    Mirrors the MediaGuard sports archivist sampling logic:
      - 1 frame every 5 seconds (bounded by max_frames)
      - Records timestamp_sec = extracted_count * sample_interval_sec
      - Saves frames as JPEG images in output_dir
      - Defers output directory creation until the first valid frame is written.

    Args:
        video_path: Path to the video file on disk.
        output_dir: Directory where extracted JPEG frames will be saved.
        sample_interval_sec: Interval in seconds between extracted frames (default 5).
        preflight_info: Optional preflight metadata from `preflight_video_file`.
        max_frames: Maximum number of frames to extract (default 120) to bound resource usage.
    """
    if preflight_info is None:
        preflight_info = preflight_video_file(video_path)

    frame_rate = preflight_info.get("frame_rate", 1)
    total_frames = preflight_info.get("total_frames", 0)
    duration_sec = preflight_info.get("estimated_duration_sec", 0.0)

    # Adaptive bounding: adjust sample interval if estimated frames exceed max_frames
    if max_frames > 0 and duration_sec > 0 and (duration_sec / sample_interval_sec) > max_frames:
        sample_interval_sec = max(sample_interval_sec, int(math.ceil(duration_sec / float(max_frames))))

    sample_interval = frame_rate * sample_interval_sec
    if sample_interval < 1:
        sample_interval = 1

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Could not open video file: {video_path.name}")

    extracted_frames: List[Dict[str, Any]] = []
    extracted_count = 0
    last_frame_id = -1
    dir_created = False

    try:
        while cap.isOpened():
            frame_id = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
            ret, frame = cap.read()
            if not ret:
                break
            last_frame_id = frame_id

            if frame_id % sample_interval == 0:
                if not dir_created:
                    output_dir.mkdir(parents=True, exist_ok=True)
                    dir_created = True

                timestamp_sec = extracted_count * sample_interval_sec
                frame_filename = f"frame_{timestamp_sec:04d}s.jpg"
                frame_path = output_dir / frame_filename

                success = cv2.imwrite(str(frame_path), frame)
                if not success:
                    raise IOError(f"Failed to write extracted frame to {frame_path}")

                extracted_frames.append({
                    "frame_index": extracted_count,
                    "frame_id": frame_id,
                    "timestamp_sec": timestamp_sec,
                    "filename": frame_filename,
                    "frame_path": str(frame_path),
                })
                extracted_count += 1

        if extracted_count == 0:
            if dir_created and output_dir.exists():
                shutil.rmtree(output_dir, ignore_errors=True)
            raise ValueError("Video contains no readable frames or is corrupted.")

        if duration_sec == 0.0 and frame_rate > 0 and last_frame_id >= 0:
            duration_sec = round((last_frame_id + 1) / frame_rate, 2)

        return duration_sec, extracted_frames

    except Exception:
        if dir_created and output_dir.exists():
            shutil.rmtree(output_dir, ignore_errors=True)
        raise
    finally:
        cap.release()
