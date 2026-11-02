"""
Canonical Temporal Evidence Engine for FixProof P3.
Calculates deterministic temporal statistics, offset distributions, chronological
inversions, and timeline clusters between reference and suspect video frames.

Invariants:
- Pure, deterministic calculation; no live model inference or database writes.
- Never replaces missing timestamps with zero, estimates, or report fallbacks.
- Report fallbacks never enter raw temporal statistics.
- Explicit sample counts, formulas, and population labels on every derived metric.
- Visual similarity measurements are not calibrated probabilities of copyright infringement.
- Temporal consistency or offset stability is an evidence metric, not proof of infringement.
"""

from datetime import datetime, timezone
import hashlib
import json
import math
import statistics
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.evidence_models import FrameEvidence, build_frame_evidence_from_matches
from app.timeline import TimelineInterval, cluster_frame_matches


def _is_valid_number(val: Any) -> bool:
    """Returns True if val is a non-boolean finite number >= 0."""
    return isinstance(val, (int, float)) and not isinstance(val, bool) and math.isfinite(val) and val >= 0


def _is_finite(val: Any) -> bool:
    """Returns True if val is a non-boolean finite float or int."""
    return isinstance(val, (int, float)) and not isinstance(val, bool) and math.isfinite(val)


def _fingerprint(payload: Dict[str, Any]) -> str:
    """Computes a deterministic SHA-256 fingerprint for a candidate dictionary."""
    serialized = json.dumps(payload, sort_keys=True, allow_nan=False, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:24]


class ToleranceBand(BaseModel):
    lower: float
    upper: float
    method: str
    sample_count: int
    is_zero_dispersion: bool = False


class OffsetStatistics(BaseModel):
    candidate_ids: List[str] = Field(default_factory=list)
    sample_count: int
    valid_pair_count: int
    missing_timestamp_count: int
    min_offset_sec: Optional[float] = None
    max_offset_sec: Optional[float] = None
    median_offset_sec: Optional[float] = None
    mad_sec: Optional[float] = None
    tolerance_band: Optional[ToleranceBand] = None
    dispersion_note: str
    method: str = "offset = suspect_timestamp_sec - reference_timestamp_sec; MAD = median(|offset - median|); heuristic band (n>=3, MAD>0) = median ± 2.5 MAD, not a confidence interval"
    disclaimer: str = (
        "Temporal offset describes time delta between recorded frames; "
        "it is not legal proof of copying or copyright infringement."
    )


class ChronologicalInversion(BaseModel):
    candidate_a_id: str
    candidate_b_id: str
    frame_match_index_a: int
    frame_match_index_b: int
    suspect_a_sec: float
    suspect_b_sec: float
    source_a_sec: float
    source_b_sec: float
    delta_suspect_sec: float
    delta_source_sec: float
    description: str


class ChronologicalConsistency(BaseModel):
    candidate_ids: List[str] = Field(default_factory=list)
    missing_timestamp_count: int = 0
    source_asset_count: int = 0
    sample_count: int
    inversions_count: int
    inversions: List[ChronologicalInversion] = Field(default_factory=list)
    lis_length: int
    lis_candidate_ids: List[str] = Field(default_factory=list)
    consistency_ratio: float
    method: str = "Patience sorting / dynamic programming on reference timestamps ordered by suspect timestamp"
    interpretation: str


class ClusterTemporalSummary(BaseModel):
    sample_count: int = 0
    missing_timestamp_count: int = 0
    method: str = "Existing cluster_frame_matches; offset median/MAD over exact retained candidate identities; minimum 2 pairs."
    interval_id: str
    source_asset_id: str
    suspect_start_sec: float
    suspect_end_sec: float
    source_start_sec: float
    source_end_sec: float
    duration_sec: float
    frame_count: int
    continuity_status: str
    evidence_ids: List[str] = Field(default_factory=list)
    candidate_ids: List[str] = Field(default_factory=list)
    median_offset_sec: Optional[float] = None
    mad_sec: Optional[float] = None
    min_offset_sec: Optional[float] = None
    max_offset_sec: Optional[float] = None
    is_zero_dispersion: bool = False


class TrendMetrics(BaseModel):
    candidate_ids: List[str] = Field(default_factory=list)
    missing_timestamp_count: int = 0
    sample_count: int
    distinct_suspect_timestamps: int
    slope: Optional[float] = None
    offset_slope: Optional[float] = None
    method: str
    interpretation: str
    limitation: str = (
        "Slope is a descriptive linear regression across sampled keyframes; "
        "it does not correct playback speed or warp timestamps."
    )


class TemporalCandidate(BaseModel):
    candidate_id: str
    incident_id: Optional[str] = None
    frame_match_index: int
    suspect_frame_idx: Optional[int] = None
    source_asset_id: Optional[str] = None
    source_frame_id: Optional[int] = None
    source_filename: Optional[str] = None
    suspect_filename: Optional[str] = None
    suspect_timestamp_sec: Optional[float] = None
    source_timestamp_sec: Optional[float] = None
    offset_sec: Optional[float] = None
    l2_distance: Optional[float] = None
    visual_similarity_score: Optional[float] = None
    match_confirmed: bool = False
    similarity_status: str = "UNVERIFIED"
    evidence_id: Optional[str] = None
    interval_id: Optional[str] = None
    rank: int = 1
    deviation_from_median_sec: Optional[float] = None
    is_outlier: bool = False
    sam_available: bool = False
    sam_object_count: Optional[int] = None
    is_report_fallback: bool = False
    eligible: bool = False
    eligibility_reason: str = "No reference correspondence"
    deviation_baseline: Optional[str] = None


class PopulationMetrics(BaseModel):
    population_name: str
    population_definition: str
    total_candidates: int
    valid_pairs: int
    missing_timestamps: int
    offset_stats: OffsetStatistics
    chronological_consistency: ChronologicalConsistency
    trend: Optional[TrendMetrics] = None


class TemporalEvidenceResult(BaseModel):
    incident_id: str
    generated_at: str
    by_source: Dict[str, Dict[str, PopulationMetrics]] = Field(default_factory=dict)
    methodology: str
    limitations: List[str]
    candidates: List[TemporalCandidate] = Field(default_factory=list)
    total_candidate_count: int
    valid_pair_count: int
    missing_timestamp_count: int
    populations: Dict[str, PopulationMetrics] = Field(default_factory=dict)
    global_offset: OffsetStatistics
    chronological_consistency: ChronologicalConsistency
    clusters: List[ClusterTemporalSummary] = Field(default_factory=list)
    trend: Optional[TrendMetrics] = None
    metric_population: str = "all_eligible"
    has_raw_evidence: bool = True
    is_report_fallback_only: bool = False


# ─────────────────────────────────────────────────────────────────────────────
# 1. CANONICAL CANDIDATE EXTRACTION
# ─────────────────────────────────────────────────────────────────────────────

def _extract_candidates_from_frame_matches(
    incident_id: str,
    frame_matches: List[Dict[str, Any]],
) -> List[TemporalCandidate]:
    """
    Extracts structured TemporalCandidate items from raw frame_matches.
    Preserves exact frame_match_index vs submitted suspect_frame_idx.
    Missing timestamps remain None.
    """
    candidates: List[TemporalCandidate] = []

    for array_index, item in enumerate(frame_matches):
        if not isinstance(item, dict):
            continue
        sub = item.get("submitted_frame")
        sub = sub if isinstance(sub, dict) else {}
        suspect_frame_idx = sub.get("frame_index")
        if suspect_frame_idx is None:
            suspect_frame_idx = item.get("frame_idx")

        raw_suspect_ts = sub.get("timestamp_sec") if sub.get("timestamp_sec") is not None else item.get("timestamp_sec")
        suspect_ts = float(raw_suspect_ts) if _is_valid_number(raw_suspect_ts) else None

        suspect_filename = sub.get("filename") if isinstance(sub.get("filename"), str) else None
        if not suspect_filename and sub.get("frame_path"):
            suspect_filename = str(sub["frame_path"]).replace("\\", "/").rsplit("/", 1)[-1]

        ev_id = item.get("evidence_id")
        if not isinstance(suspect_frame_idx, int) or isinstance(suspect_frame_idx, bool) or suspect_frame_idx < 0:
            suspect_frame_idx = None
        if not ev_id and suspect_frame_idx is not None and suspect_ts is not None:
            ev_id = f"frame_{suspect_frame_idx}_t{int(suspect_ts)}s"

        match_pool: List[Dict[str, Any]] = []
        best = item.get("best_match")
        if isinstance(best, dict):
            match_pool.append(best)
        top = item.get("top_candidates")
        if isinstance(top, list):
            match_pool.extend([c for c in top if isinstance(c, dict)])

        seen_keys = set()
        rank = 0

        for m in match_pool:
            src_asset = m.get("source_asset_id")
            src_frame = m.get("source_frame_id")
            src_frame = src_frame if isinstance(src_frame, int) and not isinstance(src_frame, bool) and src_frame >= 0 else None
            src_asset = src_asset if isinstance(src_asset, str) else None
            raw_src_ts = m.get("source_timestamp_sec")
            src_ts = float(raw_src_ts) if _is_valid_number(raw_src_ts) else None

            # Deduplicate multiple identical candidates on same frame
            dedup_key = json.dumps([src_asset, src_frame, m.get("source_filename"), raw_src_ts], default=str)
            if dedup_key in seen_keys:
                continue
            seen_keys.add(dedup_key)
            rank += 1

            raw_l2 = m.get("l2_distance")
            l2_dist = float(raw_l2) if _is_finite(raw_l2) and raw_l2 >= 0 else None

            raw_sim = m.get("visual_similarity_score")
            if raw_sim is None and m.get("confidence_score") is not None:
                raw_sim = m.get("confidence_score")
            sim_score = float(raw_sim) if _is_finite(raw_sim) and raw_sim >= 0 else None

            src_fn = m.get("source_filename") if isinstance(m.get("source_filename"), str) else None
            if not src_fn and m.get("source_frame_path"):
                src_fn = str(m["source_frame_path"]).replace("\\", "/").rsplit("/", 1)[-1]

            confirmed = m.get("match_confirmed") is True
            # Adapt the existing canonical FrameEvidence normalizer, never feed it missing
            # timestamps (its legacy default is zero). Preserve missing provenance below.
            normalized = None
            if suspect_ts is not None and suspect_frame_idx is not None:
                clean = {"source_asset_id": src_asset, "source_frame_id": src_frame,
                         "source_timestamp_sec": src_ts, "source_filename": src_fn,
                         "l2_distance": l2_dist, "visual_similarity_score": sim_score,
                         "match_confirmed": confirmed, "low_entropy_flag": bool(m.get("low_entropy_flag"))}
                normalized = build_frame_evidence_from_matches([{
                    "submitted_frame": {"frame_index": suspect_frame_idx, "timestamp_sec": suspect_ts},
                    "best_match": clean}])[0]
            status = (normalized.similarity_status if normalized else
                      "NO_MATCH" if m.get("low_entropy_flag") else
                      "CONFIRMED_MATCH" if confirmed else
                      "SUSPECT_MATCH" if l2_dist is not None and l2_dist < .75 else "NO_MATCH")
            if m.get("similarity_status") == "NO_MATCH":
                status = "NO_MATCH"
            eligible = bool(isinstance(src_asset, str) and src_asset not in ("", "unknown", "unregistered", "other_asset")
                            and not m.get("low_entropy_flag") and status != "NO_MATCH"
                            and (confirmed or (l2_dist is not None and l2_dist < .75)))

            offset_sec = (suspect_ts - src_ts) if (suspect_ts is not None and src_ts is not None) else None
            cand_ev_id = m.get("evidence_id") or ev_id

            # Check SAM presence without performing inference
            sam_seg = m.get("sam_segmentation") or (item.get("sam_segmentation") if m is best else None)
            ref_sam_seg = m.get("ref_sam_segmentation") or (item.get("ref_sam_segmentation") if m is best else None)
            sam_avail = any(isinstance(seg, dict) and seg.get("validation_status") == "VALIDATED" for seg in (sam_seg, ref_sam_seg))
            sam_objs = None
            if sam_avail and isinstance(sam_seg, dict) and sam_seg.get("validation_status") == "VALIDATED":
                sam_objs = len(sam_seg.get("objects") or [])

            cid = _fingerprint({
                "incident_id": incident_id,
                "frame_match_index": array_index,
                "suspect_frame_idx": suspect_frame_idx,
                "source_asset_id": src_asset,
                "source_frame_id": src_frame,
                "suspect_timestamp_sec": suspect_ts,
                "source_timestamp_sec": src_ts,
                "source_filename": src_fn,
            })

            candidates.append(
                TemporalCandidate(
                    candidate_id=cid,
                    incident_id=incident_id,
                    frame_match_index=array_index,
                    suspect_frame_idx=suspect_frame_idx,
                    source_asset_id=src_asset,
                    source_frame_id=src_frame,
                    source_filename=src_fn,
                    suspect_filename=suspect_filename,
                    suspect_timestamp_sec=suspect_ts,
                    source_timestamp_sec=src_ts,
                    offset_sec=offset_sec,
                    l2_distance=l2_dist,
                    visual_similarity_score=sim_score,
                    match_confirmed=confirmed,
                    similarity_status=status,
                    evidence_id=cand_ev_id,
                    rank=rank,
                    sam_available=sam_avail,
                    sam_object_count=sam_objs,
                    is_report_fallback=False,
                    eligible=eligible,
                    eligibility_reason="Recorded backend CV confirmation or L2 < 0.75; no low-entropy/NO_MATCH flag" if eligible else "Excluded: no eligible reference or CV gate not passed",
                )
            )

        # If this frame had zero candidate matches, record an observation candidate with null reference
        if not match_pool:
            cid = _fingerprint({
                "incident_id": incident_id,
                "frame_match_index": array_index,
                "suspect_frame_idx": suspect_frame_idx,
                "suspect_timestamp_sec": suspect_ts,
            })
            candidates.append(
                TemporalCandidate(
                    candidate_id=cid,
                    incident_id=incident_id,
                    frame_match_index=array_index,
                    suspect_frame_idx=suspect_frame_idx,
                    source_asset_id=None,
                    source_frame_id=None,
                    suspect_filename=suspect_filename,
                    suspect_timestamp_sec=suspect_ts,
                    source_timestamp_sec=None,
                    offset_sec=None,
                    l2_distance=None,
                    visual_similarity_score=None,
                    match_confirmed=False,
                    similarity_status="NO_MATCH",
                    evidence_id=ev_id,
                    rank=1,
                    sam_available=bool(item.get("sam_segmentation")),
                    is_report_fallback=False,
                )
            )

    return candidates


# ─────────────────────────────────────────────────────────────────────────────
# 2. DETERMINISTIC METRICS CALCULATION
# ─────────────────────────────────────────────────────────────────────────────

def calculate_offset_statistics(candidates: List[TemporalCandidate]) -> OffsetStatistics:
    """
    Computes deterministic offset statistics and dispersion:
    - offset = suspect_timestamp_sec - reference_timestamp_sec
    - Median offset
    - Median Absolute Deviation (MAD)
    - Minimum and maximum
    - Explicit zero-MAD handling (never fabricate tolerance band when dispersion is 0)
    - Tolerance band defined only when sample count >= 3 and MAD > 0
    """
    valid_offsets: List[float] = [
        c.offset_sec for c in candidates
        if c.offset_sec is not None and c.suspect_timestamp_sec is not None and c.source_timestamp_sec is not None
    ]
    provenance = [c.candidate_id for c in candidates if c.offset_sec is not None]
    missing_count = sum(
        1 for c in candidates
        if c.suspect_timestamp_sec is None or c.source_timestamp_sec is None
    )
    valid_count = len(valid_offsets)
    total_count = len(candidates)

    if valid_count == 0:
        return OffsetStatistics(
            candidate_ids=provenance,
            sample_count=total_count,
            valid_pair_count=0,
            missing_timestamp_count=missing_count,
            min_offset_sec=None,
            max_offset_sec=None,
            median_offset_sec=None,
            mad_sec=None,
            tolerance_band=None,
            dispersion_note="No valid candidate timestamp pairs recorded.",
        )

    min_val = round(min(valid_offsets), 4)
    max_val = round(max(valid_offsets), 4)
    med_val = float(statistics.median(valid_offsets))

    abs_deviations = [abs(x - med_val) for x in valid_offsets]
    mad_val = float(statistics.median(abs_deviations))

    if mad_val == 0.0:
        band = None
        dispersion_note = (
            f"Measured dispersion (MAD) is 0.00s across {valid_count} candidate pairs; "
            f"at least half the absolute deviations are zero; offsets need not all be identical (median {med_val:.2f}s)."
        )
    elif valid_count < 3:
        band = None
        dispersion_note = (
            f"Sample count ({valid_count}) is below 3; tolerance band is not statistically defined. "
            f"Median offset is {med_val:.2f}s with MAD {mad_val:.2f}s."
        )
    else:
        # Standard robust dispersion interval: median ± 2.5 * MAD
        lower_bound = round(med_val - 2.5 * mad_val, 4)
        upper_bound = round(med_val + 2.5 * mad_val, 4)
        band = ToleranceBand(
            lower=lower_bound,
            upper=upper_bound,
            method="median ± 2.5 * MAD",
            sample_count=valid_count,
            is_zero_dispersion=False,
        )
        dispersion_note = (
            f"Median offset is {med_val:.2f}s with MAD dispersion {mad_val:.2f}s. "
            f"Descriptive heuristic band (not a confidence interval): [{lower_bound:.2f}s, {upper_bound:.2f}s]."
        )

    return OffsetStatistics(
        candidate_ids=provenance,
        sample_count=total_count,
        valid_pair_count=valid_count,
        missing_timestamp_count=missing_count,
        min_offset_sec=min_val,
        max_offset_sec=max_val,
        median_offset_sec=med_val,
        mad_sec=mad_val,
        tolerance_band=band,
        dispersion_note=dispersion_note,
    )


def calculate_chronological_consistency(candidates: List[TemporalCandidate]) -> ChronologicalConsistency:
    groups = {}
    for c in candidates:
        if c.source_asset_id and c.offset_sec is not None:
            groups.setdefault(c.source_asset_id, []).append(c)
    results = [_chronology_one(group) for group in groups.values()]
    count = sum(r.sample_count for r in results)
    lis = sum(r.lis_length for r in results)
    inversions = [i for r in results for i in r.inversions]
    return ChronologicalConsistency(
        candidate_ids=[c.candidate_id for group in groups.values() for c in group],
        missing_timestamp_count=sum(c.offset_sec is None for c in candidates), source_asset_count=len(groups),
        sample_count=count, inversions_count=len(inversions), inversions=inversions,
        lis_length=lis, lis_candidate_ids=[i for r in results for i in r.lis_candidate_ids],
        consistency_ratio=round(lis/count, 4) if count else 0,
        method="Per reference asset: count pairs with strictly increasing suspect time and decreasing reference time; DP longest strictly increasing sequence in both timestamps. Sum per-asset LIS lengths / valid pairs; alternatives are not independent observations.",
        interpretation=("No valid timestamp pairs available." if not count else
            f"{len(inversions)} backward reference comparisons; {lis}/{count} pairs in per-asset increasing subsequences. "
            "Equal timestamps and alternative matches are ambiguous; no inversions does not imply strict ordering. Repeated/static scenes provide low-confidence temporal evidence."))


def _chronology_one(candidates: List[TemporalCandidate]) -> ChronologicalConsistency:
    """
    Computes chronological inversions and longest strictly increasing subsequence (LIS)
    on reference timestamps when ordered by suspect timestamp.
    """
    valid = [
        c for c in candidates
        if c.suspect_timestamp_sec is not None and c.source_timestamp_sec is not None
    ]
    total_valid = len(valid)

    if total_valid == 0:
        return ChronologicalConsistency(
            sample_count=0,
            inversions_count=0,
            inversions=[],
            lis_length=0,
            lis_candidate_ids=[],
            consistency_ratio=0.0,
            interpretation="No valid timestamp pairs available for chronological ordering evaluation.",
        )

    # Order candidates chronologically by suspect timestamp, tie-breaking by frame_match_index
    sorted_pairs = sorted(valid, key=lambda c: (c.suspect_timestamp_sec, c.frame_match_index, c.rank))

    # Detect all chronological inversions
    inversions: List[ChronologicalInversion] = []
    for i in range(len(sorted_pairs)):
        for j in range(i + 1, len(sorted_pairs)):
            c_a = sorted_pairs[i]
            c_b = sorted_pairs[j]

            # Suspect progresses or stays flat, but source jumps backwards
            if c_a.suspect_timestamp_sec < c_b.suspect_timestamp_sec and c_a.source_timestamp_sec > c_b.source_timestamp_sec:
                d_sus = round(c_b.suspect_timestamp_sec - c_a.suspect_timestamp_sec, 4)
                d_src = round(c_b.source_timestamp_sec - c_a.source_timestamp_sec, 4)
                desc = (
                    f"Chronological inversion: suspect time advanced by {d_sus:.2f}s "
                    f"({c_a.suspect_timestamp_sec:.2f}s -> {c_b.suspect_timestamp_sec:.2f}s), "
                    f"but reference time reversed by {abs(d_src):.2f}s "
                    f"({c_a.source_timestamp_sec:.2f}s -> {c_b.source_timestamp_sec:.2f}s)."
                )
                inversions.append(
                    ChronologicalInversion(
                        candidate_a_id=c_a.candidate_id,
                        candidate_b_id=c_b.candidate_id,
                        frame_match_index_a=c_a.frame_match_index,
                        frame_match_index_b=c_b.frame_match_index,
                        suspect_a_sec=c_a.suspect_timestamp_sec,
                        suspect_b_sec=c_b.suspect_timestamp_sec,
                        source_a_sec=c_a.source_timestamp_sec,
                        source_b_sec=c_b.source_timestamp_sec,
                        delta_suspect_sec=d_sus,
                        delta_source_sec=d_src,
                        description=desc,
                    )
                )

    # Compute Longest Strictly Increasing Subsequence (LIS) on source_timestamp_sec
    # DP tracking indices for path reconstruction
    n = len(sorted_pairs)
    lengths = [1] * n
    prev_indices = [-1] * n

    for i in range(1, n):
        for j in range(0, i):
            if sorted_pairs[j].suspect_timestamp_sec < sorted_pairs[i].suspect_timestamp_sec and sorted_pairs[j].source_timestamp_sec < sorted_pairs[i].source_timestamp_sec:
                if lengths[j] + 1 > lengths[i]:
                    lengths[i] = lengths[j] + 1
                    prev_indices[i] = j

    max_len = 0
    best_end = 0
    for i in range(n):
        if lengths[i] > max_len:
            max_len = lengths[i]
            best_end = i

    # Reconstruct LIS candidate sequence
    lis_ids: List[str] = []
    curr = best_end
    while curr != -1:
        lis_ids.append(sorted_pairs[curr].candidate_id)
        curr = prev_indices[curr]
    lis_ids.reverse()

    ratio = round(max_len / total_valid, 4) if total_valid > 0 else 0.0

    if len(inversions) == 0:
        interpretation = (
            f"Chronological ordering is strictly monotonic across all {total_valid} valid candidate pairs "
            f"(consistency ratio: {ratio * 100:.1f}%)."
        )
    else:
        interpretation = (
            f"Detected {len(inversions)} chronological inversion(s). "
            f"Longest monotonic reference subsequence contains {max_len} of {total_valid} pairs "
            f"({ratio * 100:.1f}% consistent)."
        )

    return ChronologicalConsistency(
        sample_count=total_valid,
        inversions_count=len(inversions),
        inversions=inversions,
        lis_length=max_len,
        lis_candidate_ids=lis_ids,
        consistency_ratio=ratio,
        interpretation=interpretation,
    )


def calculate_trend_metrics(candidates: List[TemporalCandidate]) -> Optional[TrendMetrics]:
    """
    Computes descriptive Ordinary Least Squares (OLS) slope of reference vs suspect timestamps:
    slope = Cov(suspect, source) / Var(suspect).
    Requires at least 3 distinct suspect timestamps and distinct source timestamps.
    """
    valid = [
        c for c in candidates
        if c.suspect_timestamp_sec is not None and c.source_timestamp_sec is not None
    ]
    distinct_suspect = len(set(c.suspect_timestamp_sec for c in valid))
    distinct_source = len(set(c.source_timestamp_sec for c in valid))

    provenance = dict(candidate_ids=[c.candidate_id for c in valid], missing_timestamp_count=len(candidates)-len(valid))
    if len({c.source_asset_id for c in valid}) > 1 or len(valid) < 3 or distinct_suspect < 3 or distinct_source < 3:
        return TrendMetrics(**provenance,
            sample_count=len(valid),
            distinct_suspect_timestamps=distinct_suspect,
            slope=None,
            offset_slope=None,
            method="Ordinary least squares linear regression (suspect vs reference timestamp)",
            interpretation="Requires one reference asset and at least 3 distinct timestamps in each stream; repeated/static scenes provide low-confidence temporal evidence.",
        )

    suspect_vals = [c.suspect_timestamp_sec for c in valid]
    source_vals = [c.source_timestamp_sec for c in valid]

    mean_s = sum(suspect_vals) / len(suspect_vals)
    mean_r = sum(source_vals) / len(source_vals)

    var_s = sum((s - mean_s) ** 2 for s in suspect_vals)
    cov_sr = sum((s - mean_s) * (r - mean_r) for s, r in zip(suspect_vals, source_vals))

    if var_s <= 1e-9:
        return TrendMetrics(**provenance,
            sample_count=len(valid),
            distinct_suspect_timestamps=distinct_suspect,
            slope=None,
            offset_slope=None,
            method="Ordinary least squares linear regression (suspect vs reference timestamp)",
            interpretation="Variance of suspect timestamps is zero; slope cannot be determined.",
        )

    slope = round(cov_sr / var_s, 4)
    offset_slope = round(1.0 - slope, 4)

    interp = f"Measured reference-time progression per suspect second: {slope:.4f}; descriptive sample regression only, not a playback-speed determination."

    return TrendMetrics(**provenance,
        sample_count=len(valid),
        distinct_suspect_timestamps=distinct_suspect,
        slope=slope,
        offset_slope=offset_slope,
        method="Ordinary least squares regression: slope = Cov(suspect, source) / Var(suspect)",
        interpretation=interp,
    )


def summarize_clusters(
    intervals: List[TimelineInterval],
    candidates: List[TemporalCandidate],
) -> List[ClusterTemporalSummary]:
    """
    Computes per-cluster offset summaries by joining TimelineInterval records
    with TemporalCandidate items through evidence_ids.
    """
    summaries: List[ClusterTemporalSummary] = []

    # Map evidence_id to candidate
    evidence_to_candidates: Dict[str, List[TemporalCandidate]] = {}
    for c in candidates:
        if c.evidence_id:
            evidence_to_candidates.setdefault(c.evidence_id, []).append(c)

    for interval in intervals:
        matched_cands: List[TemporalCandidate] = []
        for eid in interval.evidence_ids:
            if eid in evidence_to_candidates:
                matched_cands.extend(c for c in evidence_to_candidates[eid] if c.source_asset_id == interval.source_asset_id)

        # Deduplicate candidates within cluster
        seen_cids = set()
        cluster_cands: List[TemporalCandidate] = []
        for mc in matched_cands:
            if mc.candidate_id not in seen_cids:
                seen_cids.add(mc.candidate_id)
                cluster_cands.append(mc)

        # Mark interval_id on candidate objects
        for mc in cluster_cands:
            mc.interval_id = interval.interval_id

        # Compute cluster-level offset distribution
        c_offsets = [c.offset_sec for c in cluster_cands if c.offset_sec is not None]
        if len(c_offsets) >= 2:
            c_med = round(float(statistics.median(c_offsets)), 4)
            c_abs_dev = [abs(x - c_med) for x in c_offsets]
            c_mad = round(float(statistics.median(c_abs_dev)), 4)
            c_min = round(min(c_offsets), 4)
            c_max = round(max(c_offsets), 4)
            zero_disp = (c_mad == 0.0)
        else:
            c_med = None
            c_mad = None
            c_min = None
            c_max = None
            zero_disp = False

        summaries.append(
            ClusterTemporalSummary(
                sample_count=len(c_offsets), missing_timestamp_count=len(cluster_cands)-len(c_offsets),
                interval_id=interval.interval_id,
                source_asset_id=interval.source_asset_id,
                suspect_start_sec=interval.suspect_start_sec,
                suspect_end_sec=interval.suspect_end_sec,
                source_start_sec=interval.source_start_sec,
                source_end_sec=interval.source_end_sec,
                duration_sec=interval.duration_sec,
                frame_count=interval.frame_count,
                continuity_status=interval.continuity_status,
                evidence_ids=interval.evidence_ids,
                candidate_ids=[c.candidate_id for c in cluster_cands],
                median_offset_sec=c_med,
                mad_sec=c_mad,
                min_offset_sec=c_min,
                max_offset_sec=c_max,
                is_zero_dispersion=zero_disp,
            )
        )

    return summaries


def _tag_offset_deviations(
    candidates: List[TemporalCandidate],
    global_offset: OffsetStatistics,
    cluster_summaries: List[ClusterTemporalSummary],
) -> None:
    """
    Tags each candidate with deviation from cluster (or global) median offset
    and sets is_outlier flag based on measured tolerance band without implying infringement.
    """
    cluster_by_id: Dict[str, ClusterTemporalSummary] = {
        cs.interval_id: cs for cs in cluster_summaries
    }

    glob_med = global_offset.median_offset_sec
    glob_mad = global_offset.mad_sec
    glob_band = global_offset.tolerance_band

    for c in candidates:
        if c.offset_sec is None or glob_med is None:
            c.deviation_from_median_sec = None
            c.is_outlier = False
            continue

        # If candidate belongs to a cluster with sufficient samples (>=3), use cluster statistics;
        # otherwise use the global baseline.
        cs = cluster_by_id.get(c.interval_id) if c.interval_id else None
        if cs and cs.sample_count >= 2 and cs.median_offset_sec is not None:
            ref_med = cs.median_offset_sec
            ref_mad = cs.mad_sec
            c.deviation_baseline = cs.interval_id
        else:
            ref_med = glob_med
            ref_mad = glob_mad
            c.deviation_baseline = "all_eligible"

        dev = round(c.offset_sec - ref_med, 4)
        c.deviation_from_median_sec = dev

        # An observation is an outlier if it deviates significantly from median (> 2.5 * MAD),
        # or deviates from an otherwise zero-dispersion baseline
        if ref_mad is not None and ref_mad > 0:
            c.is_outlier = abs(dev) > 2.5 * ref_mad
        elif ref_mad == 0.0:
            c.is_outlier = abs(dev) > 1e-4
        elif glob_band and (c.offset_sec < glob_band.lower or c.offset_sec > glob_band.upper):
            c.is_outlier = True
        else:
            c.is_outlier = False


# ─────────────────────────────────────────────────────────────────────────────
# 3. BUILDER ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def build_temporal_evidence_for_incident(
    incident: Dict[str, Any],
) -> TemporalEvidenceResult:
    """
    Canonical temporal evidence builder.
    Constructs a deterministic, complete temporal-evidence report from an incident.
    Handles empty evidence, report fallbacks, and missing timestamps safely.
    """
    incident_id = str(incident.get("incident_id") or "unspecified_incident")
    raw_frame_matches = incident.get("frame_matches")
    raw_frame_matches = raw_frame_matches if isinstance(raw_frame_matches, list) else []

    # Check for report fallback only
    # If frame_matches is empty, we must NEVER fabricate raw candidates from reports
    is_fallback = False
    if not raw_frame_matches:
        is_fallback = bool((incident.get("sections") or {}).get("frame_correlations") or ((incident.get("detailed_report") or {}).get("sections") or {}).get("frame_correlations"))

    # 1. Extract raw candidates
    candidates = _extract_candidates_from_frame_matches(incident_id, raw_frame_matches)

    # Reuse the established FrameEvidence contract and clustering unchanged. Each
    # candidate has a unique internal join token; shared frame evidence IDs cannot
    # attach an alternative or another reference asset to the wrong interval.
    frame_evidences = []
    eligible = [c for c in candidates if c.eligible]
    for c in eligible:
        if c.offset_sec is None or c.suspect_frame_idx is None:
            continue
        frame_evidences.append(FrameEvidence(
            evidence_id=c.candidate_id, suspect_timestamp_sec=c.suspect_timestamp_sec,
            suspect_frame_idx=c.suspect_frame_idx, source_asset_id=c.source_asset_id,
            source_frame_id=c.source_frame_id, source_timestamp_sec=c.source_timestamp_sec,
            source_filename=c.source_filename, l2_distance=c.l2_distance,
            similarity_status=c.similarity_status))
    intervals = cluster_frame_matches(frame_evidences)
    by_id = {c.candidate_id: c for c in candidates}
    # Use candidate IDs for exact joins internally; expose recorded evidence IDs separately.
    join_candidates = [c.model_copy(update={"evidence_id": c.candidate_id}) for c in eligible]
    cluster_summaries = summarize_clusters(intervals, join_candidates)
    for cluster in cluster_summaries:
        cluster.evidence_ids = list(dict.fromkeys(by_id[cid].evidence_id for cid in cluster.candidate_ids if by_id[cid].evidence_id))
        for cid in cluster.candidate_ids:
            by_id[cid].interval_id = cluster.interval_id

    # 3. Compute populations
    confirmed_pool = [c for c in eligible if c.match_confirmed is True]
    unconfirmed_pool = [c for c in eligible if not c.match_confirmed]
    all_eligible_pool = eligible

    pop_confirmed = PopulationMetrics(
        population_name="confirmed",
        population_definition="Recorded candidate match_confirmed=true (matcher L2/entropy gate), not independent identity verification",
        total_candidates=len(confirmed_pool),
        valid_pairs=sum(1 for c in confirmed_pool if c.offset_sec is not None),
        missing_timestamps=sum(1 for c in confirmed_pool if c.offset_sec is None),
        offset_stats=calculate_offset_statistics(confirmed_pool),
        chronological_consistency=calculate_chronological_consistency(confirmed_pool),
        trend=calculate_trend_metrics(confirmed_pool),
    )

    pop_unconfirmed = PopulationMetrics(
        population_name="unconfirmed",
        population_definition="Eligible match candidates without backend confirmation",
        total_candidates=len(unconfirmed_pool),
        valid_pairs=sum(1 for c in unconfirmed_pool if c.offset_sec is not None),
        missing_timestamps=sum(1 for c in unconfirmed_pool if c.offset_sec is None),
        offset_stats=calculate_offset_statistics(unconfirmed_pool),
        chronological_consistency=calculate_chronological_consistency(unconfirmed_pool),
        trend=calculate_trend_metrics(unconfirmed_pool),
    )

    pop_all = PopulationMetrics(
        population_name="all_eligible",
        population_definition="All recorded reference candidates passing existing CV gate (confirmed or L2 < 0.75), excluding low entropy and NO_MATCH; alternatives counted separately",
        total_candidates=len(all_eligible_pool),
        valid_pairs=sum(1 for c in all_eligible_pool if c.offset_sec is not None),
        missing_timestamps=sum(1 for c in all_eligible_pool if c.offset_sec is None),
        offset_stats=calculate_offset_statistics(all_eligible_pool),
        chronological_consistency=calculate_chronological_consistency(all_eligible_pool),
        trend=calculate_trend_metrics(all_eligible_pool),
    )

    populations: Dict[str, PopulationMetrics] = {
        "confirmed": pop_confirmed,
        "unconfirmed": pop_unconfirmed,
        "all_eligible": pop_all,
    }

    by_source = {}
    for source in sorted({c.source_asset_id for c in eligible}):
        by_source[source] = {}
        for key, population in populations.items():
            pool = [c for c in eligible if c.source_asset_id == source and
                    (key == "all_eligible" or (key == "confirmed") == c.match_confirmed)]
            by_source[source][key] = PopulationMetrics(
                population_name=key, population_definition=population.population_definition,
                total_candidates=len(pool), valid_pairs=sum(c.offset_sec is not None for c in pool),
                missing_timestamps=sum(c.offset_sec is None for c in pool),
                offset_stats=calculate_offset_statistics(pool),
                chronological_consistency=calculate_chronological_consistency(pool),
                trend=calculate_trend_metrics(pool))

    # 4. Global statistics across all candidates
    global_offset = calculate_offset_statistics(eligible)
    chronological_consistency = calculate_chronological_consistency(eligible)
    trend = calculate_trend_metrics(eligible)

    # 5. Tag deviations and outliers
    for source in by_source:
        _tag_offset_deviations([c for c in eligible if c.source_asset_id == source],
                               by_source[source]["all_eligible"].offset_stats, cluster_summaries)

    limitations = [
        "Temporal offset describes chronological time difference; it is not proof of copying or copyright infringement.",
        "Zero MAD means at least half of absolute deviations are zero; other offsets may differ. No tolerance band is invented.",
        "Unsampled intervals or gaps between sampled keyframes cannot be evaluated.",
        "Linear slope reflects empirical progression across sampled frames; it does not correct playback speed or warp timestamps.",
        "Report-fallback correlations are never mixed into raw temporal statistics.",
        "Global offsets pool eligible reference assets; use by_source for source-specific measurements. Alternatives are not independent sampled frames.",
        "SAM caches are not queried; unavailable contextual metadata does not establish that SAM never ran.",
    ]

    methodology = (
        "Deterministic temporal correspondence analysis: candidates are ordered chronologically "
        "by suspect timestamp. Offsets are computed as (suspect_timestamp_sec - reference_timestamp_sec). "
        "Dispersion is measured by median absolute deviation (MAD). Chronological consistency evaluates "
        "monotonicity and longest strictly increasing reference subsequence (LIS). "
        "Clusters are generated via FixProof timeline correspondence clustering."
    )

    total_valid = sum(1 for c in candidates if c.offset_sec is not None)
    total_missing = sum(1 for c in candidates if c.offset_sec is None)

    return TemporalEvidenceResult(
        incident_id=incident_id,
        generated_at=datetime.now(timezone.utc).isoformat(),
        by_source=by_source,
        methodology=methodology,
        limitations=limitations,
        candidates=candidates,
        total_candidate_count=len(candidates),
        valid_pair_count=total_valid,
        missing_timestamp_count=total_missing,
        populations=populations,
        global_offset=global_offset,
        chronological_consistency=chronological_consistency,
        clusters=cluster_summaries,
        trend=trend,
        has_raw_evidence=bool(raw_frame_matches),
        is_report_fallback_only=is_fallback,
    )
