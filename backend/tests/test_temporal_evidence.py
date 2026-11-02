"""
Offline unit and fixture test suite for Canonical Temporal Evidence Engine (FixProof P3).
Verifies:
1. Perfect constant +5-second offset.
2. One offset outlier.
3. One swapped consecutive candidate pair (inversion).
4. Different playback speed while chronological ordering remains consistent.
5. Repeated/static scenes with explicit low-confidence interpretation.
6. Missing timestamps.
7. Report-fallback-only incident.
8. Expired/unavailable SAM results without changing temporal statistics.
9. Duplicate candidate handling.
10. Different frame-match index and submitted frame index.
11. Multiple reference assets.
12. Empty and singleton populations.
13. Zero MAD handling.
14. Insufficient samples for slope.
"""

import unittest
from typing import Any, Dict, List

from app.temporal_evidence import (
    TemporalCandidate,
    build_temporal_evidence_for_incident,
    calculate_chronological_consistency,
    calculate_offset_statistics,
    calculate_trend_metrics,
)


def _make_frame_match(
    suspect_ts: Any,
    ref_ts: Any,
    asset_id: str = "asset-ref-1",
    frame_idx: int = 0,
    ref_frame_id: int = 0,
    l2_distance: float = 0.35,
    visual_similarity: float = 85.0,
    confirmed: bool = True,
    status: str = "CONFIRMED_MATCH",
    evidence_id: str = None,
    sam: Dict[str, Any] = None,
) -> Dict[str, Any]:
    """Helper to construct raw frame match dictionary for fixtures."""
    ev_id = evidence_id or f"frame_{frame_idx}_t{int(suspect_ts if suspect_ts is not None else 0)}s"
    return {
        "frame_idx": frame_idx,
        "evidence_id": ev_id,
        "submitted_frame": {
            "frame_index": frame_idx,
            "timestamp_sec": suspect_ts,
            "filename": f"suspect_{frame_idx:04d}.jpg",
        },
        "best_match": {
            "source_asset_id": asset_id,
            "source_frame_id": ref_frame_id,
            "source_timestamp_sec": ref_ts,
            "source_filename": f"ref_{ref_frame_id:04d}.jpg",
            "l2_distance": l2_distance,
            "visual_similarity_score": visual_similarity,
            "match_confirmed": confirmed,
            "similarity_status": status,
            "evidence_id": ev_id,
            "sam_segmentation": sam,
        },
    }


class TestTemporalEvidence(unittest.TestCase):
    def test_fixture_1_perfect_constant_5sec_offset(self):
        """1. Perfect constant +5-second offset: zero dispersion, strict monotonicity, 1:1 speed."""
        frames = [
            _make_frame_match(suspect_ts=5.0, ref_ts=0.0, frame_idx=0, ref_frame_id=0),
            _make_frame_match(suspect_ts=10.0, ref_ts=5.0, frame_idx=1, ref_frame_id=1),
            _make_frame_match(suspect_ts=15.0, ref_ts=10.0, frame_idx=2, ref_frame_id=2),
            _make_frame_match(suspect_ts=20.0, ref_ts=15.0, frame_idx=3, ref_frame_id=3),
        ]
        incident = {"incident_id": "inc-fixture-1", "frame_matches": frames}
        result = build_temporal_evidence_for_incident(incident)

        self.assertEqual(result.valid_pair_count, 4)
        self.assertEqual(result.missing_timestamp_count, 0)
        self.assertEqual(result.global_offset.median_offset_sec, 5.0)
        self.assertEqual(result.global_offset.mad_sec, 0.0)
        self.assertEqual(result.global_offset.min_offset_sec, 5.0)
        self.assertEqual(result.global_offset.max_offset_sec, 5.0)
        # When MAD is 0, no fabricated tolerance band
        self.assertIsNone(result.global_offset.tolerance_band)
        self.assertIn("MAD) is 0.00s", result.global_offset.dispersion_note)

        # Monotonicity: 0 inversions, 100% LIS ratio
        self.assertEqual(result.chronological_consistency.inversions_count, 0)
        self.assertEqual(result.chronological_consistency.lis_length, 4)
        self.assertEqual(result.chronological_consistency.consistency_ratio, 1.0)

        # Trend / slope: exactly 1.0 (1:1 playback progression)
        self.assertIsNotNone(result.trend)
        self.assertAlmostEqual(result.trend.slope, 1.0, places=3)
        self.assertIn("not a playback-speed determination", result.trend.interpretation)

    def test_fixture_2_one_offset_outlier(self):
        """2. One offset outlier: non-zero MAD, tolerance band defined, outlier tagged."""
        frames = [
            _make_frame_match(suspect_ts=4.0, ref_ts=0.0, frame_idx=0),    # offset = 4.0
            _make_frame_match(suspect_ts=10.0, ref_ts=5.0, frame_idx=1),   # offset = 5.0
            _make_frame_match(suspect_ts=15.0, ref_ts=10.0, frame_idx=2),  # offset = 5.0
            _make_frame_match(suspect_ts=21.0, ref_ts=15.0, frame_idx=3),  # offset = 6.0
            _make_frame_match(suspect_ts=25.0, ref_ts=5.0, frame_idx=4),   # offset = 20.0 (OUTLIER)
        ]
        incident = {"incident_id": "inc-fixture-2", "frame_matches": frames}
        result = build_temporal_evidence_for_incident(incident)

        self.assertEqual(result.valid_pair_count, 5)
        self.assertEqual(result.global_offset.median_offset_sec, 5.0)
        self.assertEqual(result.global_offset.min_offset_sec, 4.0)
        self.assertEqual(result.global_offset.max_offset_sec, 20.0)
        self.assertEqual(result.global_offset.mad_sec, 1.0)
        self.assertIsNotNone(result.global_offset.tolerance_band)
        self.assertEqual(result.global_offset.tolerance_band.lower, 2.5)
        self.assertEqual(result.global_offset.tolerance_band.upper, 7.5)

        # Check candidate outlier tagging
        outliers = [c for c in result.candidates if c.is_outlier]
        self.assertEqual(len(outliers), 1)
        self.assertEqual(outliers[0].suspect_timestamp_sec, 25.0)
        self.assertEqual(outliers[0].offset_sec, 20.0)
        self.assertEqual(outliers[0].deviation_from_median_sec, 15.0)

    def test_fixture_3_one_swapped_consecutive_candidate_pair(self):
        """3. One swapped consecutive pair: exact inversion detected with identity and descriptions."""
        frames = [
            _make_frame_match(suspect_ts=0.0, ref_ts=0.0, frame_idx=0),
            _make_frame_match(suspect_ts=5.0, ref_ts=10.0, frame_idx=1),  # swapped: ref 10s before 5s
            _make_frame_match(suspect_ts=10.0, ref_ts=5.0, frame_idx=2),  # swapped
            _make_frame_match(suspect_ts=15.0, ref_ts=15.0, frame_idx=3),
        ]
        incident = {"incident_id": "inc-fixture-3", "frame_matches": frames}
        result = build_temporal_evidence_for_incident(incident)

        self.assertEqual(result.chronological_consistency.inversions_count, 1)
        inversion = result.chronological_consistency.inversions[0]
        self.assertEqual(inversion.frame_match_index_a, 1)
        self.assertEqual(inversion.frame_match_index_b, 2)
        self.assertEqual(inversion.source_a_sec, 10.0)
        self.assertEqual(inversion.source_b_sec, 5.0)
        self.assertIn("Chronological inversion", inversion.description)

        # LIS should have length 3 (0.0 -> 5.0 -> 15.0 or 0.0 -> 10.0 -> 15.0)
        self.assertEqual(result.chronological_consistency.lis_length, 3)
        self.assertEqual(result.chronological_consistency.consistency_ratio, 0.75)

    def test_fixture_4_different_playback_speed_consistent_ordering(self):
        """4. Different playback speed (1.5x): slope is ~1.5, inversions is 0."""
        frames = [
            _make_frame_match(suspect_ts=0.0, ref_ts=0.0, frame_idx=0),
            _make_frame_match(suspect_ts=10.0, ref_ts=15.0, frame_idx=1),
            _make_frame_match(suspect_ts=20.0, ref_ts=30.0, frame_idx=2),
            _make_frame_match(suspect_ts=30.0, ref_ts=45.0, frame_idx=3),
        ]
        incident = {"incident_id": "inc-fixture-4", "frame_matches": frames}
        result = build_temporal_evidence_for_incident(incident)

        self.assertEqual(result.chronological_consistency.inversions_count, 0)
        self.assertEqual(result.chronological_consistency.consistency_ratio, 1.0)
        self.assertIsNotNone(result.trend)
        self.assertAlmostEqual(result.trend.slope, 1.5, places=3)
        self.assertEqual(result.trend.offset_slope, -0.5)

    def test_fixture_5_repeated_static_scene(self):
        """5. Repeated/static scene: multiple suspect frames pointing to same reference timestamp."""
        frames = [
            _make_frame_match(suspect_ts=0.0, ref_ts=5.0, frame_idx=0, l2_distance=0.72),
            _make_frame_match(suspect_ts=5.0, ref_ts=5.0, frame_idx=1, l2_distance=0.74),
            _make_frame_match(suspect_ts=10.0, ref_ts=5.0, frame_idx=2, l2_distance=0.73),
        ]
        incident = {"incident_id": "inc-fixture-5", "frame_matches": frames}
        result = build_temporal_evidence_for_incident(incident)

        # Inversions: since ref_ts does not reverse (it stays equal), inversions_count is 0
        self.assertEqual(result.chronological_consistency.inversions_count, 0)
        # Because all ref timestamps are 5.0s, strictly increasing subsequence length is 1
        self.assertEqual(result.chronological_consistency.lis_length, 1)
        self.assertAlmostEqual(result.chronological_consistency.consistency_ratio, 1 / 3, places=2)

    def test_fixture_6_missing_timestamps(self):
        """6. Missing timestamps: stay None, counted as missing, not replaced by zero or guessed."""
        frames = [
            _make_frame_match(suspect_ts=None, ref_ts=10.0, frame_idx=0),
            _make_frame_match(suspect_ts=5.0, ref_ts=None, frame_idx=1),
            _make_frame_match(suspect_ts=10.0, ref_ts=5.0, frame_idx=2),
        ]
        incident = {"incident_id": "inc-fixture-6", "frame_matches": frames}
        result = build_temporal_evidence_for_incident(incident)

        self.assertEqual(result.total_candidate_count, 3)
        self.assertEqual(result.valid_pair_count, 1)
        self.assertEqual(result.missing_timestamp_count, 2)
        # Candidate 0 and candidate 1 must have None timestamps and None offsets
        self.assertIsNone(result.candidates[0].suspect_timestamp_sec)
        self.assertIsNone(result.candidates[0].offset_sec)
        self.assertIsNone(result.candidates[1].source_timestamp_sec)
        self.assertIsNone(result.candidates[1].offset_sec)

        # Global offset computed only on the 1 valid pair
        self.assertEqual(result.global_offset.valid_pair_count, 1)
        self.assertEqual(result.global_offset.median_offset_sec, 5.0)

    def test_fixture_7_report_fallback_only_incident(self):
        """7. Report-fallback-only incident: never enters raw temporal statistics."""
        incident = {
            "incident_id": "inc-report-only",
            "frame_matches": [],  # empty raw evidence
            "detailed_report": {
                "sections": {
                    "frame_correlations": [
                        {"suspect_timestamp_sec": 5.0, "source_timestamp_sec": 0.0, "l2_distance": 0.3}
                    ]
                }
            }
        }
        result = build_temporal_evidence_for_incident(incident)

        self.assertTrue(result.is_report_fallback_only)
        self.assertFalse(result.has_raw_evidence)
        self.assertEqual(result.total_candidate_count, 0)
        self.assertEqual(result.valid_pair_count, 0)
        self.assertIsNone(result.global_offset.median_offset_sec)

    def test_fixture_8_sam_presence_does_not_alter_temporal_metrics(self):
        """8. SAM results presence or absence does not change temporal statistics."""
        frames_no_sam = [
            _make_frame_match(suspect_ts=0.0, ref_ts=0.0, frame_idx=0),
            _make_frame_match(suspect_ts=5.0, ref_ts=5.0, frame_idx=1),
            _make_frame_match(suspect_ts=10.0, ref_ts=10.0, frame_idx=2),
        ]
        frames_with_sam = [
            _make_frame_match(suspect_ts=0.0, ref_ts=0.0, frame_idx=0, sam={"objects": [{"label": "car"}]}),
            _make_frame_match(suspect_ts=5.0, ref_ts=5.0, frame_idx=1, sam={"objects": [{"label": "truck"}]}),
            _make_frame_match(suspect_ts=10.0, ref_ts=10.0, frame_idx=2, sam={"objects": []}),
        ]

        res_no_sam = build_temporal_evidence_for_incident({"incident_id": "i-1", "frame_matches": frames_no_sam})
        res_with_sam = build_temporal_evidence_for_incident({"incident_id": "i-1", "frame_matches": frames_with_sam})

        self.assertEqual(res_no_sam.global_offset.median_offset_sec, res_with_sam.global_offset.median_offset_sec)
        self.assertEqual(res_no_sam.global_offset.mad_sec, res_with_sam.global_offset.mad_sec)
        self.assertEqual(res_no_sam.chronological_consistency.inversions_count, res_with_sam.chronological_consistency.inversions_count)
        self.assertEqual(res_no_sam.trend.slope, res_with_sam.trend.slope)

        # SAM flags are tracked strictly as candidate metadata
        self.assertFalse(res_no_sam.candidates[0].sam_available)
        self.assertFalse(res_with_sam.candidates[0].sam_available)
        self.assertIsNone(res_with_sam.candidates[0].sam_object_count)

    def test_duplicate_candidate_handling(self):
        """9. Duplicate candidate entries within the same frame are deduplicated."""
        raw_frame = {
            "frame_idx": 0,
            "submitted_frame": {"frame_index": 0, "timestamp_sec": 0.0},
            "best_match": {
                "source_asset_id": "asset-1",
                "source_frame_id": 100,
                "source_timestamp_sec": 5.0,
                "l2_distance": 0.4,
            },
            "top_candidates": [
                {
                    "source_asset_id": "asset-1",
                    "source_frame_id": 100,
                    "source_timestamp_sec": 5.0,
                    "l2_distance": 0.4,
                },
                {
                    "source_asset_id": "asset-2",
                    "source_frame_id": 200,
                    "source_timestamp_sec": 8.0,
                    "l2_distance": 0.6,
                },
            ]
        }
        incident = {"incident_id": "inc-dup", "frame_matches": [raw_frame]}
        result = build_temporal_evidence_for_incident(incident)
        # Duplicate candidate was discarded; asset-1 and asset-2 candidates remain
        self.assertEqual(len(result.candidates), 2)
        self.assertEqual(result.candidates[0].source_asset_id, "asset-1")
        self.assertEqual(result.candidates[1].source_asset_id, "asset-2")

    def test_different_frame_match_index_and_suspect_frame_idx(self):
        """10. Preserves distinction between array index and submitted suspect frame index."""
        raw_frame = {
            "frame_idx": 42,
            "submitted_frame": {"frame_index": 42, "timestamp_sec": 210.0},
            "best_match": {
                "source_asset_id": "asset-1",
                "source_frame_id": 10,
                "source_timestamp_sec": 10.0,
            }
        }
        incident = {"incident_id": "inc-idx", "frame_matches": [raw_frame]}
        result = build_temporal_evidence_for_incident(incident)

        cand = result.candidates[0]
        self.assertEqual(cand.frame_match_index, 0)      # array index in frame_matches
        self.assertEqual(cand.suspect_frame_idx, 42)      # submitted frame index

    def test_multiple_reference_assets_and_clusters(self):
        """11. Multiple reference assets are clustered separately into distinct intervals."""
        frames = [
            _make_frame_match(suspect_ts=0.0, ref_ts=0.0, asset_id="asset-A", frame_idx=0),
            _make_frame_match(suspect_ts=5.0, ref_ts=5.0, asset_id="asset-A", frame_idx=1),
            _make_frame_match(suspect_ts=10.0, ref_ts=0.0, asset_id="asset-B", frame_idx=2),
            _make_frame_match(suspect_ts=15.0, ref_ts=5.0, asset_id="asset-B", frame_idx=3),
        ]
        incident = {"incident_id": "inc-multi-asset", "frame_matches": frames}
        result = build_temporal_evidence_for_incident(incident)

        self.assertGreaterEqual(len(result.clusters), 2)
        asset_ids_in_clusters = {c.source_asset_id for c in result.clusters}
        self.assertIn("asset-A", asset_ids_in_clusters)
        self.assertIn("asset-B", asset_ids_in_clusters)

    def test_empty_and_singleton_population(self):
        """12 & 14. Empty population and singleton population."""
        # Empty
        empty_res = build_temporal_evidence_for_incident({"incident_id": "empty", "frame_matches": []})
        self.assertEqual(empty_res.valid_pair_count, 0)
        self.assertIsNone(empty_res.global_offset.median_offset_sec)
        self.assertEqual(empty_res.chronological_consistency.sample_count, 0)

        # Singleton
        single_frame = [_make_frame_match(suspect_ts=5.0, ref_ts=2.0, frame_idx=0)]
        single_res = build_temporal_evidence_for_incident({"incident_id": "single", "frame_matches": single_frame})
        self.assertEqual(single_res.valid_pair_count, 1)
        self.assertEqual(single_res.global_offset.median_offset_sec, 3.0)
        self.assertEqual(single_res.global_offset.mad_sec, 0.0)
        self.assertIsNone(single_res.global_offset.tolerance_band)
        # Slope requires >= 3 distinct timestamps
        self.assertIsNone(single_res.trend.slope)


    def test_zero_mad_with_outlier_is_not_identical_offsets(self):
        frames = [_make_frame_match(suspect_ts=s, ref_ts=r, frame_idx=i) for i, (s,r) in enumerate([(5,0),(10,5),(15,10),(30,15)])]
        result = build_temporal_evidence_for_incident({'incident_id':'zero-mad', 'frame_matches':frames})
        self.assertEqual(result.global_offset.mad_sec, 0)
        self.assertIsNone(result.global_offset.tolerance_band)
        self.assertNotIn('all recorded offsets are identical', result.global_offset.dispersion_note)
        self.assertEqual(result.global_offset.max_offset_sec, 15)

    def test_alternative_cannot_inherit_confirmation_or_sam(self):
        frame = _make_frame_match(suspect_ts=5, ref_ts=0, frame_idx=0)
        frame['match_confirmed'] = True
        frame['sam_segmentation'] = {'validation_status':'VALIDATED', 'objects':[{}]}
        frame['top_candidates'] = [{**frame['best_match'], 'source_frame_id':99, 'source_timestamp_sec':9, 'match_confirmed':False}]
        result = build_temporal_evidence_for_incident({'incident_id':'alternatives','frame_matches':[frame]})
        self.assertTrue(result.candidates[0].sam_available)
        self.assertFalse(result.candidates[1].sam_available)
        self.assertFalse(result.candidates[1].match_confirmed)
        self.assertEqual(result.populations['unconfirmed'].total_candidates, 1)
        self.assertEqual(result.chronological_consistency.inversions_count, 0)
        self.assertEqual(result.chronological_consistency.lis_length, 1)

    def test_distinct_assets_are_not_ordering_contradictions(self):
        frames = [_make_frame_match(suspect_ts=0, ref_ts=100, frame_idx=0, asset_id='asset-A'),
                  _make_frame_match(suspect_ts=5, ref_ts=0, frame_idx=1, asset_id='asset-B')]
        result = build_temporal_evidence_for_incident({'incident_id':'assets','frame_matches':frames})
        self.assertEqual(result.chronological_consistency.inversions_count, 0)
        self.assertIsNone(result.trend.slope)
        self.assertEqual(set(result.by_source), {'asset-A','asset-B'})
        for cluster in result.clusters:
            selected = [c for c in result.candidates if c.candidate_id in cluster.candidate_ids]
            self.assertTrue(all(c.source_asset_id == cluster.source_asset_id for c in selected))

    def test_cv_population_gate_and_metric_provenance(self):
        frames = [_make_frame_match(suspect_ts=5, ref_ts=0, frame_idx=0),
                  _make_frame_match(suspect_ts=10, ref_ts=5, frame_idx=1, l2_distance=1.2)]
        frames[1]['best_match']['match_confirmed'] = False
        result = build_temporal_evidence_for_incident({'incident_id':'gate','frame_matches':frames})
        self.assertEqual(result.total_candidate_count, 2)
        self.assertEqual(result.populations['all_eligible'].total_candidates, 1)
        self.assertEqual(result.global_offset.candidate_ids, [result.candidates[0].candidate_id])
        self.assertFalse(result.candidates[1].eligible)

    def test_filename_identity_and_rank_independent_fingerprint(self):
        frame = _make_frame_match(suspect_ts=5, ref_ts=0, frame_idx=7)
        other = {**frame['best_match'], 'source_filename':'different.jpg'}
        frame['top_candidates'] = [other]
        a = build_temporal_evidence_for_incident({'incident_id':'identity','frame_matches':[frame]})
        self.assertEqual(len(a.candidates), 2)
        frame['best_match'], frame['top_candidates'] = other, [frame['best_match']]
        b = build_temporal_evidence_for_incident({'incident_id':'identity','frame_matches':[frame]})
        self.assertEqual(a.candidates[0].candidate_id, b.candidates[1].candidate_id)

    def test_empty_is_not_report_fallback_and_malformed_records(self):
        result = build_temporal_evidence_for_incident({'incident_id':'empty','frame_matches':[]})
        self.assertFalse(result.is_report_fallback_only)
        result = build_temporal_evidence_for_incident({'incident_id':'bad','frame_matches':[None, {'submitted_frame':None}]})
        self.assertEqual(result.total_candidate_count, 1)
        self.assertIsNone(result.candidates[0].suspect_timestamp_sec)


if __name__ == "__main__":
    unittest.main()
