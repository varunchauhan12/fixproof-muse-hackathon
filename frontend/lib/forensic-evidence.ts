import type { DetailedReportRecord, MatchAnalysisResult, MatchCandidate } from './types';

export const measured = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const evidenceTime = (value: number | null) => value === null ? 'Not recorded' : `${value.toFixed(2)}s`;
const basename = (path?: string | null) => path?.split(/[\\/]/).pop() || '';
const validAsset = (id?: string) => !!id && !['other_asset', 'unregistered', 'unknown'].includes(id);
export interface EvidencePair {
  id: string; evidenceId: string; rank: number | null; frameIndex: number | null; suspectFrameId: number | null; referenceFrameId: number | null;
  suspectTimestamp: number | null; sourceTimestamp: number | null;
  sourceAssetId: string; sourceAssetTitle?: string;
  suspectAssetId: string; suspectFilename: string; referenceFilename: string;
  l2Distance: number | null; visualSimilarity: number | null; phashDistance: number | null;
  status: string; origin: string; vision: MatchCandidate['vision_verification'];
  sam: boolean; confirmed?: boolean;
}
/** Preserve original frame index/rank and recorded filenames. Never infer coordinates or timestamps. */
export function buildEvidencePairs(incident: MatchAnalysisResult, report?: DetailedReportRecord | null): EvidencePair[] {
  const suspectAssetId = incident.submitted_asset_id || incident.incident_id || '';
  const pairs: EvidencePair[] = [];
  for (const [frameIndex, frame] of (incident.frame_matches || []).entries()) {
    const candidates = [...(frame.best_match ? [frame.best_match] : []), ...(frame.top_candidates || [])];
    const seen = new Set<string>();
    let rank = 0;
    for (const candidate of candidates) {
      const key = JSON.stringify([candidate.source_asset_id, candidate.source_frame_id, candidate.source_filename, candidate.source_timestamp_sec]);
      if (seen.has(key)) continue;
      seen.add(key); rank++;
      pairs.push({
        id: `frame-${frameIndex}-candidate-${rank}`, evidenceId: candidate.evidence_id || frame.evidence_id || '',
        rank, frameIndex, suspectFrameId: measured(frame.submitted_frame?.frame_index), referenceFrameId: measured(candidate.source_frame_id), suspectTimestamp: measured(frame.submitted_frame?.timestamp_sec),
        sourceTimestamp: measured(candidate.source_timestamp_sec), sourceAssetId: candidate.source_asset_id,
        suspectAssetId, suspectFilename: frame.submitted_frame?.filename || basename(frame.submitted_frame?.frame_path),
        referenceFilename: validAsset(candidate.source_asset_id) ? candidate.source_filename || basename(candidate.source_frame_path) : '',
        l2Distance: measured(candidate.l2_distance), visualSimilarity: measured(candidate.visual_similarity_score ?? candidate.confidence_score),
        phashDistance: measured(candidate.phash_evidence?.hamming_distance ?? (candidate as MatchCandidate & {phash_distance?: number}).phash_distance),
        status: (candidate as MatchCandidate & {similarity_status?: string}).similarity_status || (candidate.match_confirmed === true ? 'CV threshold passed' : 'Candidate; not confirmed'),
        origin: 'Recorded CV candidate', vision: candidate.vision_verification, confirmed: candidate.match_confirmed === true,
        sam: !!(candidate.sam_segmentation || candidate.ref_sam_segmentation || (candidate === frame.best_match && (frame.sam_segmentation || frame.ref_sam_segmentation))),
      });
    }
    if (!candidates.length) pairs.push({id: `frame-${frameIndex}-observation`, evidenceId: frame.evidence_id || '', rank: null, frameIndex, suspectFrameId: measured(frame.submitted_frame?.frame_index), referenceFrameId: null,
      suspectTimestamp: measured(frame.submitted_frame?.timestamp_sec), sourceTimestamp: null, sourceAssetId: '', suspectAssetId,
      suspectFilename: frame.submitted_frame?.filename || basename(frame.submitted_frame?.frame_path), referenceFilename: '',
      l2Distance: null, visualSimilarity: null, phashDistance: null, status: 'No reference candidate recorded', origin: 'Sampled observation', vision: null, sam: !!frame.sam_segmentation});
  }
  // Reports are a fallback, never replace the actual candidate records with synthesized correlations.
  if (!pairs.length && (!report?.incident_id || !incident.incident_id || report.incident_id === incident.incident_id)) for (const [index, c] of (report?.sections?.frame_correlations || []).entries()) {
    pairs.push({id: c.correlation_id || `report-${index}`, evidenceId: c.evidence_id || '', rank: null, frameIndex: null, suspectFrameId: null, referenceFrameId: null,
      suspectTimestamp: measured(c.suspect_timestamp_sec), sourceTimestamp: measured(c.source_timestamp_sec), sourceAssetId: c.source_asset_id,
      sourceAssetTitle: c.source_asset_title, suspectAssetId, suspectFilename: basename(c.suspect_image_path),
      referenceFilename: validAsset(c.source_asset_id) ? basename(c.ref_image_path) : '', l2Distance: measured(c.l2_distance),
      visualSimilarity: measured(c.visual_similarity_score), phashDistance: measured(c.phash_distance), status: 'Report correlation; inspect original evidence',
      origin: 'Stored report correlation', vision: c.vision_verification ? { model_id: c.vision_verification.model_id,
        visual_correspondence: c.vision_verification.visual_correspondence as NonNullable<MatchCandidate['vision_verification']>['visual_correspondence'],
        reasoning_summary: c.vision_verification.reasoning, supporting_visible_features: c.vision_verification.matching_features, contradictions: c.vision_verification.contradictions } : null,
      sam: !!(c.sam_segmentation || c.ref_sam_segmentation)});
  }
  return pairs.sort((a,b) => (a.suspectTimestamp ?? Infinity) - (b.suspectTimestamp ?? Infinity));
}
