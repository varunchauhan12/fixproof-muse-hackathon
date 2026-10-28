export interface FrameRecord {
  frame_index: number;
  timestamp_sec: number;
  filename: string;
  url: string;
}

export interface AssetRecord {
  asset_id: string;
  filename: string;
  uploaded_at: string;
  duration_seconds: number;
  frame_count: number;
  file_size: number;
  indexed: boolean;
  indexed_vectors: number;
  sample_interval_seconds: number;
  video_url: string | null;
  thumbnail_url: string | null;
  frames: FrameRecord[];
}

export interface VaultStatus {
  status: "ready" | "empty";
  vault_size: number;
  embedding_dim: number;
  total_indexed_assets: number;
  indexed_assets: string[];
  total_registered_assets?: number;
  total_protected_assets?: number;
  index_file?: string;
  metadata_file?: string;
  db_mode?: "local" | "supabase" | string;
  is_cloud?: boolean;
}

export interface VisionVerificationResult {
  pair_id?: string;
  source_asset_id?: string;
  source_frame_id?: number | string;
  suspect_frame_idx?: number | string;
  model_id?: string;
  visual_correspondence?: "HIGH_CORRESPONDENCE" | "POSSIBLE_REUSE" | "UNRELATED_SCENE" | "UNVERIFIED";
  supporting_visible_features?: string[];
  contradictions?: string[];
  uncertainty_notes?: string;
  reasoning_summary?: string;
  status?: "VERIFIED" | "FAILED" | "SKIPPED";
  verified_at?: string;
  cached?: boolean;
}

export interface MatchCandidate {
  vector_id: number;
  source_asset_id: string;
  source_frame_id: number;
  source_timestamp_sec: number;
  source_filename: string;
  source_frame_path: string;
  l2_distance: number;
  confidence_score: number;
  visual_similarity_score?: number;
  score_version?: string;
  score_calibration_notice?: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  match_confirmed: boolean;
  phash_match?: boolean;
  phash_score?: number;
  phash_evidence?: {
    suspect_phash: string;
    matched_phash: string;
    hamming_distance: number;
    phash_score: number;
    phash_match: boolean;
  } | null;
  vision_verification?: VisionVerificationResult | null;
}

export interface FrameMatchDetail {
  submitted_frame: {
    frame_index: number;
    timestamp_sec: number;
    filename: string;
    frame_path: string;
  };
  best_match: MatchCandidate | null;
  top_candidates: MatchCandidate[];
}

export interface MatchAnalysisResult {
  incident_id?: string;
  investigation_type?: "FULL_VIDEO_SCAN" | "URL_SCREENING";
  submitted_asset_id: string;
  suspect_filename?: string;
  suspect_url?: string;
  source_url?: string;
  platform?: string;
  metadata?: Record<string, any>;
  thumbnail_url?: string;
  suspect_thumbnail_preview_url?: string;
  disclaimer: string;
  limitations?: string[];
  recommended_action?: string;
  status_message?: string;
  total_frames_analyzed: number;
  candidate_matches_found: number;
  highest_confidence: number;
  lowest_l2_distance: number | null;
  overall_status: "CANDIDATE_MATCH" | "SUSPECT" | "CLEAN" | "NO_REFERENCE_DATA" | "NEEDS_FULL_VIDEO_REVIEW";
  score_version?: string;
  score_calibration_notice?: string;
  screening_mode?: "SINGLE_FRAME_PRELIMINARY" | "MULTI_FRAME_PREVIEW_SCREENING";
  evaluated_previews_count?: number;
  message?: string;
  matched_assets: string[];
  frame_matches: FrameMatchDetail[];
  scanned_at?: string;
  file_size?: number;
  duration_seconds?: number;
  frame_count?: number;
}

export type ScanLifecycleState =
  | "idle"
  | "uploading"
  | "processing"
  | "matching"
  | "finalizing"
  | "completed"
  | "failed";

export type RecommendedAction =
  | "ESCALATE_LEGAL_TAKEDOWN"
  | "FLAG_FOR_BROKER_LICENSING"
  | "DISMISS_FAIR_USE"
  | "NEEDS_FULL_VIDEO_REVIEW"
  | "MONITOR_ACCOUNT";

export type ConfidenceAssessment =
  | "HIGH_CONFIDENCE_MATCH"
  | "MODERATE_PROBABILITY"
  | "INCONCLUSIVE_DATA"
  | "CONFIRMED_DISTINCT";

export type ContinuityStatus =
  | "CONTINUOUS_MATCH"
  | "SPARSE_MATCH"
  | "SINGLETON";

export type FindingCategory =
  | "TIMELINE_CORRESPONDENCE"
  | "PERCEPTUAL_SIMILARITY"
  | "ANOMALY_OR_DISCREPANCY"
  | "LIMITATION";

export interface TimelineInterval {
  interval_id: string;
  source_asset_id: string;
  suspect_start_sec: number;
  suspect_end_sec: number;
  source_start_sec: number;
  source_end_sec: number;
  duration_sec: number;
  frame_count: number;
  mean_l2_distance: number;
  min_l2_distance: number;
  phash_match_ratio: number;
  continuity_status: ContinuityStatus;
  evidence_ids: string[];
}

export interface InvestigationFinding {
  finding_id: string;
  category: FindingCategory;
  statement: string;
  evidence_ids: string[];
  measured_metrics?: Record<string, unknown>;
}

export interface OperationalMetadata {
  model_id?: string;
  latency_ms?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  finish_reason?: string;
  validation_status: "VALIDATED" | "FAILED_VALIDATION";
  failure_type?: string | null;
  errors?: string[];
  created_at?: string;
}

export interface InvestigationReport {
  report_id: string;
  incident_id: string;
  model_id: string;
  prompt_version: string;
  summary: string;
  recommended_action: RecommendedAction;
  confidence_assessment: ConfidenceAssessment;
  human_review_required: boolean;
  timeline_intervals: TimelineInterval[];
  findings: InvestigationFinding[];
  unresolved_questions: string[];
  contradictions_detected: string[];
  limitations_disclosed: string[];
  evidence_references: string[];
  operational_metadata: OperationalMetadata;
}

export interface InvestigateIncidentPayload {
  force_refresh?: boolean;
  model_override?: string | null;
}

export interface ReportHistoryItem {
  report_id: string;
  incident_id: string;
  created_at: string;
  model_id: string;
  recommended_action: RecommendedAction;
  confidence_assessment: ConfidenceAssessment;
  validation_status: "VALIDATED" | "FAILED_VALIDATION" | "PARTIALLY_VALIDATED";
  human_review_required: boolean;
  summary: string;
}

export interface PackageVerificationResult {
  valid: boolean;
  package_id?: string;
  incident_id?: string;
  exported_at?: string;
  signing_key_id?: string;
  signature_algorithm?: string;
  signature_verified: boolean;
  payload_integrity_verified: boolean;
  chain_of_custody_verified: boolean;
  total_reports?: number;
  file_count?: number;
  errors: string[];
  warnings?: string[];
  verified_at: string;
}

export interface NemotronStatus {
  status: "ready" | "degraded";
  configured_model: string;
  vision_model: string;
  text_reasoning_available: boolean;
  vision_verification_available: boolean;
  email_delivery_available: boolean;
  email_provider: string;
  email_from: string | null;
  supported_documents: string[];
  supported_jurisdictions: string[];
}

export interface DraftDocumentPayload {
  incident_id: string;
  document_type: "COPYRIGHT_NOTICE" | "REVENUE_SHARE_OFFER";
  rights_holder?: string;
  authorized_rep?: string;
  contact_email?: string;
  work_title?: string;
  recipient_name?: string;
  recipient_email?: string;
  jurisdiction?: string;
  custom_notes?: string;
  rev_share_pct?: number;
  commercial_terms?: string;
  response_deadline_days?: number;
  use_ai_synthesis?: boolean;
}

export interface DraftDocumentResult {
  document_id: string;
  incident_id: string;
  document_type: "COPYRIGHT_NOTICE" | "REVENUE_SHARE_OFFER";
  status: "READY_FOR_REVIEW" | "INCOMPLETE_EVIDENCE" | "UNVERIFIED_EVIDENCE";
  subject: string;
  body: string;
  facts_imported: {
    incident_id: string;
    suspect_filename?: string;
    suspect_url?: string;
    platform: string;
    scanned_at: string;
    matched_assets: string[];
    candidate_matches_found: number;
    highest_confidence: number;
    lowest_l2_distance: number | null;
    overall_status: string;
    frame_correlations: Array<{
      frame_index: number;
      suspect_timestamp_sec: number;
      source_timestamp_sec: number;
      source_asset_id: string;
      l2_distance: number | null;
      phash_match: boolean;
    }>;
  };
  user_inputs: Record<string, any>;
  missing_fields: string[];
  ai_enhanced: boolean;
  model_id: string;
  declarations_required: string[];
  created_at: string;
}

export interface SendEmailPayload {
  incident_id: string;
  document_type: "COPYRIGHT_NOTICE" | "REVENUE_SHARE_OFFER";
  recipient_email: string;
  subject: string;
  body: string;
  cc_emails?: string[];
  user_confirmed: boolean;
  rights_declaration_confirmed: boolean;
}

export interface SendEmailResult {
  success: boolean;
  status: "DELIVERED" | "NOT_CONFIGURED" | "FAILED";
  delivery_id?: string | null;
  audit_id: string;
  message: string;
}

export interface EmailAuditEntry {
  audit_id: string;
  timestamp: string;
  incident_id: string;
  document_type: string;
  recipient_email: string;
  subject: string;
  status: "DELIVERED" | "NOT_CONFIGURED" | "FAILED";
  provider: string;
  delivery_id?: string | null;
  session_id?: string | null;
  error?: string | null;
}


