"""
Temporal Correspondence Clustering module for FixProof Milestone 6C.6B.
Reconstructs continuous timeline intervals between suspect video timestamps
and trusted reference source asset footage.

Principles:
- Group temporally coherent suspect/reference frame matches into intervals.
- Handle missing frames, gaps, out-of-order inputs, duplicate matches, and multiple reference assets.
- Never combine incompatible reference assets or unrelated source-time sequences into one interval.
- Preserve underlying frame evidence IDs for every interval.
- If a reliable continuous interval cannot be formed, return singleton evidence records without inventing duration.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional
import logging

from app.evidence_models import FrameEvidence, TimelineInterval, ContinuityStatus

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TimelineClusteringConfig:
    """
    Configurable parameters for temporal correspondence clustering.
    
    Attributes:
        max_suspect_gap_sec: Maximum gap between consecutive suspect frames allowed
            in a single interval. FixProof samples every 5s; 15.0s allows up to 2
            dropped/unmatched frames before forcing an interval boundary.
        max_drift_sec: Maximum allowable deviation between elapsed suspect time
            and elapsed reference time (i.e. abs(dt_source - dt_suspect)).
            Clips playing at 1.0x speed have drift ~ 0. A drift > 5.0s indicates
            a scene transition, commercial break, or discontinuous edit.
        min_frames_for_interval: Minimum number of frames required to declare a
            coherent multi-frame interval. Single frames are categorized as 'SINGLETON'.
        min_match_threshold_l2: Maximum L2 distance to consider a frame as a match
            candidate for clustering. Default 0.75 (matches SUSPECT_THRESHOLD in matcher.py).
    """
    max_suspect_gap_sec: float = 15.0
    max_drift_sec: float = 5.0
    min_frames_for_interval: int = 2
    min_match_threshold_l2: float = 0.75


def _is_match_candidate(frame: FrameEvidence, threshold_l2: float) -> bool:
    """Checks whether a frame evidence item qualifies as an asset match candidate."""
    if not frame.source_asset_id:
        return False
    if frame.source_timestamp_sec is None:
        return False
    if frame.similarity_status == "NO_MATCH":
        return False
    if frame.similarity_status in ("CONFIRMED_MATCH", "SUSPECT_MATCH"):
        return True
    if frame.l2_distance is not None and frame.l2_distance < threshold_l2:
        return True
    return False


def cluster_frame_matches(
    frames: List[FrameEvidence],
    config: Optional[TimelineClusteringConfig] = None,
) -> List[TimelineInterval]:
    """
    Clusters discrete frame-level matches into temporally coherent timeline intervals.
    
    Rules:
    1. Only frames with a valid source_asset_id and acceptable distance are clustered.
    2. Frames are strictly partitioned by source_asset_id. Incompatible reference assets
       are never merged.
    3. Input frames are sorted by suspect_timestamp_sec. Out-of-order input is resolved.
    4. Duplicate suspect timestamps are resolved by selecting the match with the lowest L2 distance.
    5. Consecutive frames within an asset cluster must satisfy:
       - Forward suspect progression: dt_suspect > 0.
       - Maximum gap: dt_suspect <= max_suspect_gap_sec.
       - Forward source progression: dt_source > 0 (source cannot jump backwards).
       - Synchronization / drift tolerance: abs(dt_source - dt_suspect) <= max_drift_sec.
    6. If any continuity condition fails, the current interval terminates and a new one begins.
    7. Single isolated matching frames form 'SINGLETON' intervals with duration_sec = 0.0.
    
    Returns:
        List of structured TimelineInterval records sorted chronologically by suspect_start_sec.
    """
    if config is None:
        config = TimelineClusteringConfig()

    # 1. Filter candidate frames
    candidates = [f for f in frames if _is_match_candidate(f, config.min_match_threshold_l2)]
    if not candidates:
        return []

    # 2. Partition candidates by source_asset_id
    asset_groups: Dict[str, List[FrameEvidence]] = {}
    for f in candidates:
        aid = str(f.source_asset_id)
        asset_groups.setdefault(aid, []).append(f)

    intervals: List[TimelineInterval] = []
    interval_seq = 0

    for aid, group in asset_groups.items():
        # 3. Sort chronologically by suspect timestamp
        group.sort(key=lambda x: (x.suspect_timestamp_sec, x.l2_distance or 999.0))

        # 4. Deduplicate frames at identical suspect timestamps (keep lowest L2 distance)
        deduped: List[FrameEvidence] = []
        for f in group:
            if not deduped:
                deduped.append(f)
            elif deduped[-1].suspect_timestamp_sec == f.suspect_timestamp_sec:
                # Keep lower L2 distance
                if (f.l2_distance or 999.0) < (deduped[-1].l2_distance or 999.0):
                    deduped[-1] = f
            else:
                deduped.append(f)

        if not deduped:
            continue

        # 5. Segment into coherent clusters
        raw_clusters: List[List[FrameEvidence]] = []
        current_cluster: List[FrameEvidence] = [deduped[0]]

        for curr_frame in deduped[1:]:
            prev_frame = current_cluster[-1]

            dt_suspect = curr_frame.suspect_timestamp_sec - prev_frame.suspect_timestamp_sec
            dt_source = (curr_frame.source_timestamp_sec or 0.0) - (prev_frame.source_timestamp_sec or 0.0)

            # Continuity conditions
            forward_suspect = dt_suspect > 0.0
            within_suspect_gap = dt_suspect <= config.max_suspect_gap_sec
            forward_source = dt_source > 0.0
            within_drift = abs(dt_source - dt_suspect) <= config.max_drift_sec

            if forward_suspect and within_suspect_gap and forward_source and within_drift:
                current_cluster.append(curr_frame)
            else:
                raw_clusters.append(current_cluster)
                current_cluster = [curr_frame]

        if current_cluster:
            raw_clusters.append(current_cluster)

        # 6. Build TimelineInterval for each cluster
        for cluster in raw_clusters:
            interval_seq += 1
            f_start = cluster[0]
            f_end = cluster[-1]

            suspect_start = float(f_start.suspect_timestamp_sec)
            suspect_end = float(f_end.suspect_timestamp_sec)
            source_start = float(f_start.source_timestamp_sec or 0.0)
            source_end = float(f_end.source_timestamp_sec or 0.0)

            dur = round(max(0.0, suspect_end - suspect_start), 2)
            frame_cnt = len(cluster)

            l2_vals = [f.l2_distance for f in cluster if f.l2_distance is not None]
            mean_l2 = round(sum(l2_vals) / len(l2_vals), 4) if l2_vals else 0.0
            min_l2 = round(min(l2_vals), 4) if l2_vals else 0.0

            phash_matches = sum(1 for f in cluster if f.phash_match is True)
            phash_ratio = round(phash_matches / frame_cnt, 2)

            # Determine continuity status
            if frame_cnt == 1:
                status: ContinuityStatus = "SINGLETON"
            else:
                # Check maximum step size within the cluster
                gaps = [
                    cluster[i].suspect_timestamp_sec - cluster[i - 1].suspect_timestamp_sec
                    for i in range(1, len(cluster))
                ]
                max_gap = max(gaps) if gaps else 0.0
                if max_gap <= 5.5:  # Standard 5s sample interval
                    status = "CONTINUOUS_MATCH"
                else:
                    status = "SPARSE_MATCH"

            evidence_ids = [f.evidence_id for f in cluster]
            interval_id = f"interval_{interval_seq}_{aid[:8]}"

            intervals.append(
                TimelineInterval(
                    interval_id=interval_id,
                    source_asset_id=aid,
                    suspect_start_sec=suspect_start,
                    suspect_end_sec=suspect_end,
                    source_start_sec=source_start,
                    source_end_sec=source_end,
                    duration_sec=dur,
                    frame_count=frame_cnt,
                    mean_l2_distance=mean_l2,
                    min_l2_distance=min_l2,
                    phash_match_ratio=phash_ratio,
                    continuity_status=status,
                    evidence_ids=evidence_ids,
                )
            )

    # Sort all reconstructed intervals chronologically by suspect start time
    intervals.sort(key=lambda x: (x.suspect_start_sec, x.source_asset_id))
    return intervals
