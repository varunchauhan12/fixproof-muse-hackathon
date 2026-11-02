/**
 * Canonical Temporal Evidence Engine Types & API Client (FixProof P3)
 */

import { API_BASE, fetchNoCache } from "./api";

export interface ToleranceBand {
  lower: number;
  upper: number;
  method: string;
  sample_count: number;
  is_zero_dispersion: boolean;
}

export interface OffsetStatistics {
  sample_count: number;
  valid_pair_count: number;
  missing_timestamp_count: number;
  min_offset_sec: number | null;
  max_offset_sec: number | null;
  median_offset_sec: number | null;
  mad_sec: number | null;
  tolerance_band: ToleranceBand | null;
  dispersion_note: string;
  method: string;
}

export interface ChronologicalInversion {
  candidate_a_id: string;
  candidate_b_id: string;
  frame_match_index_a: number;
  frame_match_index_b: number;
  suspect_a_sec: number;
  suspect_b_sec: number;
  source_a_sec: number;
  source_b_sec: number;
  delta_suspect_sec: number;
  delta_source_sec: number;
  description: string;
}

export interface ChronologicalConsistency {
  sample_count: number;
  inversions_count: number;
  inversions: ChronologicalInversion[];
  lis_length: number;
  lis_candidate_ids: string[];
  consistency_ratio: number;
  interpretation: string;
  method: string;
}

export interface ClusterTemporalSummary {
  interval_id: string;
  source_asset_id: string;
  suspect_start_sec: number;
  suspect_end_sec: number;
  source_start_sec: number;
  source_end_sec: number;
  duration_sec: number;
  frame_count: number;
  continuity_status: string;
  evidence_ids: string[];
  candidate_ids: string[];
  median_offset_sec: number | null;
  mad_sec: number | null;
  min_offset_sec: number | null;
  max_offset_sec: number | null;
  is_zero_dispersion: boolean;
}

export interface TrendMetrics {
  sample_count: number;
  distinct_suspect_timestamps: number;
  slope: number | null;
  offset_slope: number | null;
  method: string;
  interpretation: string;
}

export interface TemporalCandidate {
  candidate_id: string;
  incident_id: string;
  frame_match_index: number;
  suspect_frame_idx: number | null;
  source_asset_id: string | null;
  source_frame_id: number | null;
  source_filename: string | null;
  suspect_filename: string | null;
  suspect_timestamp_sec: number | null;
  source_timestamp_sec: number | null;
  offset_sec: number | null;
  l2_distance: number | null;
  visual_similarity_score: number | null;
  match_confirmed: boolean;
  similarity_status: string;
  evidence_id: string | null;
  interval_id: string | null;
  rank: number;
  deviation_from_median_sec: number | null;
  is_outlier: boolean;
  sam_available: boolean;
  sam_object_count: number | null;
  is_report_fallback: boolean;
  eligible: boolean;
  eligibility_reason: string;
  deviation_baseline: string | null;
}

export interface PopulationMetrics {
  population_name: string;
  population_definition: string;
  total_candidates: number;
  valid_pairs: number;
  missing_timestamps: number;
  offset_stats: OffsetStatistics;
  chronological_consistency: ChronologicalConsistency;
  trend: TrendMetrics | null;
}

export interface TemporalEvidenceResult {
  incident_id: string;
  generated_at: string;
  by_source: Record<string, Record<string, PopulationMetrics>>;
  methodology: string;
  limitations: string[];
  candidates: TemporalCandidate[];
  total_candidate_count: number;
  valid_pair_count: number;
  missing_timestamp_count: number;
  populations: Record<string, PopulationMetrics>;
  global_offset: OffsetStatistics;
  chronological_consistency: ChronologicalConsistency;
  clusters: ClusterTemporalSummary[];
  trend: TrendMetrics | null;
  has_raw_evidence: boolean;
  is_report_fallback_only: boolean;
}

/**
 * Retrieves the canonical temporal evidence intelligence for an incident.
 */
export async function getTemporalEvidence(incidentId: string, signal?: AbortSignal): Promise<TemporalEvidenceResult> {
  const res = await fetchNoCache(`${API_BASE}/api/incidents/${encodeURIComponent(incidentId)}/temporal-evidence`, { signal });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.detail || `Failed to fetch temporal evidence: HTTP ${res.status}`);
  }
  return res.json();
}


/** Resolve the original array index AND candidate rank in P1's sorted explorer. */
export function findCVPairIndex(pairs: { frameIndex: number | null; rank: number | null }[], candidate: Pick<TemporalCandidate, 'frame_match_index' | 'rank'>): number {
  return pairs.findIndex(pair => pair.frameIndex === candidate.frame_match_index && pair.rank === candidate.rank);
}
