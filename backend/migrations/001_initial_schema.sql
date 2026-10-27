-- ============================================================================
-- FixProof Database Migration 001: Initial Cloud Persistence Schema
-- Target Engine: PostgreSQL 15+ (Supabase)
-- Milestone: 6C.2A (Foundation Layer)
-- ============================================================================

-- Ensure standard UUID generation function is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. Reference Assets Table
-- Official broadcaster reference footage registered in FixProof.
-- Supports idempotent ingestion, tracking of upload/indexing lifecycle, and size limits.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reference_assets (
    asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 52428800), -- 50 MB limit
    content_type VARCHAR(64) NOT NULL DEFAULT 'video/mp4',
    duration_seconds NUMERIC(10, 2) NOT NULL CHECK (duration_seconds >= 0),
    frame_count INTEGER NOT NULL DEFAULT 0 CHECK (frame_count >= 0),
    sample_interval_sec INTEGER NOT NULL DEFAULT 5 CHECK (sample_interval_sec > 0),
    sha256_hash VARCHAR(64) NOT NULL,
    indexing_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_UPLOAD'
        CHECK (indexing_status IN ('PENDING_UPLOAD', 'UPLOADED', 'INDEXING', 'INDEXED', 'FAILED', 'DELETED')),
    indexed_vectors_count INTEGER NOT NULL DEFAULT 0 CHECK (indexed_vectors_count >= 0),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reference_assets_status ON reference_assets(indexing_status);
CREATE INDEX IF NOT EXISTS idx_reference_assets_hash ON reference_assets(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_reference_assets_created_at ON reference_assets(created_at DESC);

-- ----------------------------------------------------------------------------
-- 2. Reference Extracted Frames Table
-- Keyframes sampled at fixed intervals (default 5s) from reference videos.
-- Cascading delete ensures no orphaned frame records on asset removal.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reference_frames (
    frame_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES reference_assets(asset_id) ON DELETE CASCADE,
    frame_index INTEGER NOT NULL CHECK (frame_index >= 0),
    timestamp_sec INTEGER NOT NULL CHECK (timestamp_sec >= 0),
    storage_path TEXT NOT NULL,
    phash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_asset_frame_index UNIQUE (asset_id, frame_index),
    CONSTRAINT uq_asset_timestamp UNIQUE (asset_id, timestamp_sec)
);

CREATE INDEX IF NOT EXISTS idx_reference_frames_asset ON reference_frames(asset_id);
CREATE INDEX IF NOT EXISTS idx_reference_frames_phash ON reference_frames(phash);

-- ----------------------------------------------------------------------------
-- 3. Reference Vectors Table
-- 576-dimensional MobileNetV3-Small L2-normalized float32 embeddings.
-- ARCHITECTURAL DESIGN FOR VECTOR STABILITY & FAISS COMPACTION:
--   - vector_uuid: Immutable logical primary key. Stable across FAISS compactions.
--   - faiss_index_position: Current 0-indexed position within FAISS IndexFlatL2.
--   - Deterministic rebuild order: ORDER BY asset_id ASC, frame_id ASC ensures
--     rebuilding into FAISS is 100% reproducible at any time without database renumbering.
--   - Strict foreign keys prevent suspect media from ever entering this table.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reference_vectors (
    vector_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES reference_assets(asset_id) ON DELETE CASCADE,
    frame_id UUID NOT NULL REFERENCES reference_frames(frame_id) ON DELETE CASCADE,
    faiss_index_position INTEGER CHECK (faiss_index_position >= 0),
    embedding_dim INTEGER NOT NULL DEFAULT 576 CHECK (embedding_dim = 576),
    embedding_vector BYTEA NOT NULL, -- 2304 bytes (576 x 4-byte float32 binary)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_reference_vector_frame UNIQUE (asset_id, frame_id)
);

CREATE INDEX IF NOT EXISTS idx_reference_vectors_asset ON reference_vectors(asset_id);
CREATE INDEX IF NOT EXISTS idx_reference_vectors_faiss_pos ON reference_vectors(faiss_index_position);

-- ----------------------------------------------------------------------------
-- 4. Investigation Jobs Table
-- State machine for tracking asynchronous / streaming suspect video scans and URL screenings.
-- Enables interrupted-job recovery, audit trails, and progress monitoring.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investigation_jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_type VARCHAR(32) NOT NULL DEFAULT 'FULL_VIDEO_SCAN'
        CHECK (investigation_type IN ('FULL_VIDEO_SCAN', 'URL_SCREENING')),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'UPLOADING', 'PROCESSING', 'MATCHING', 'SYNTHESIZING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    suspect_filename TEXT,
    suspect_url TEXT,
    file_size_bytes BIGINT,
    sha256_hash VARCHAR(64),
    error_message TEXT,
    progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investigation_jobs_status ON investigation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_investigation_jobs_created ON investigation_jobs(created_at DESC);

-- ----------------------------------------------------------------------------
-- 5. Incidents Table
-- Permanent forensic record of suspect video threat scans and candidate matches.
-- Completely separates suspect investigation data from trusted reference vectors.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
    incident_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES investigation_jobs(job_id) ON DELETE SET NULL,
    investigation_type VARCHAR(32) NOT NULL DEFAULT 'FULL_VIDEO_SCAN'
        CHECK (investigation_type IN ('FULL_VIDEO_SCAN', 'URL_SCREENING')),
    suspect_filename TEXT,
    suspect_url TEXT,
    file_size_bytes BIGINT,
    duration_seconds NUMERIC(10, 2),
    total_frames_analyzed INTEGER NOT NULL DEFAULT 0 CHECK (total_frames_analyzed >= 0),
    candidate_matches_found INTEGER NOT NULL DEFAULT 0 CHECK (candidate_matches_found >= 0),
    highest_confidence NUMERIC(5, 2) NOT NULL DEFAULT 0.0 CHECK (highest_confidence >= 0.0 AND highest_confidence <= 100.0),
    lowest_l2_distance NUMERIC(6, 4),
    overall_status VARCHAR(32) NOT NULL
        CHECK (overall_status IN ('CANDIDATE_MATCH', 'SUSPECT', 'CLEAN', 'NO_REFERENCE_DATA', 'NEEDS_FULL_VIDEO_REVIEW')),
    matched_asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    cv_evidence_dossier JSONB NOT NULL DEFAULT '{}'::jsonb,
    human_verdict VARCHAR(32)
        CHECK (human_verdict IN ('CONFIRMED_INFRINGEMENT', 'FALSE_POSITIVE', 'DISMISSED', 'UNDER_REVIEW')),
    human_reviewer_notes TEXT,
    reviewed_at TIMESTAMPTZ,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(overall_status);
CREATE INDEX IF NOT EXISTS idx_incidents_scanned_at ON incidents(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_job ON incidents(job_id);

-- ----------------------------------------------------------------------------
-- 6. Nemotron Reports Table
-- Structured legal / forensic intelligence reports generated by NVIDIA Nemotron
-- via Nebius Token Factory. Distinguishes model reasoning from human review.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nemotron_reports (
    report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
    model_id VARCHAR(128) NOT NULL, -- e.g. 'nvidia/Nemotron-3_5-Lightning'
    prompt_version VARCHAR(32) NOT NULL DEFAULT 'v1.0',
    summary TEXT NOT NULL,
    recommended_action VARCHAR(64) NOT NULL
        CHECK (recommended_action IN (
            'ESCALATE_LEGAL_TAKEDOWN',
            'FLAG_FOR_BROKER_LICENSING',
            'DISMISS_FAIR_USE',
            'NEEDS_FULL_VIDEO_REVIEW',
            'MONITOR_ACCOUNT'
        )),
    confidence_assessment VARCHAR(32) NOT NULL
        CHECK (confidence_assessment IN (
            'HIGH_CONFIDENCE_MATCH',
            'MODERATE_PROBABILITY',
            'INCONCLUSIVE_DATA',
            'CONFIRMED_DISTINCT'
        )),
    human_review_required BOOLEAN NOT NULL DEFAULT FALSE,
    contradictions_detected JSONB NOT NULL DEFAULT '[]'::jsonb,
    limitations_disclosed JSONB NOT NULL DEFAULT '[]'::jsonb,
    full_report_json JSONB NOT NULL,
    raw_model_response TEXT,
    prompt_tokens INTEGER CHECK (prompt_tokens >= 0),
    completion_tokens INTEGER CHECK (completion_tokens >= 0),
    latency_ms INTEGER CHECK (latency_ms >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nemotron_reports_incident ON nemotron_reports(incident_id);
CREATE INDEX IF NOT EXISTS idx_nemotron_reports_model ON nemotron_reports(model_id);

-- ----------------------------------------------------------------------------
-- 7. Vault Snapshots Table
-- Tracks versioned FAISS checkpoints in object storage.
-- Enables instant hydration on container restart and verifiable checksums.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_snapshots (
    snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_number INTEGER NOT NULL UNIQUE CHECK (version_number > 0),
    total_vectors INTEGER NOT NULL CHECK (total_vectors >= 0),
    total_assets INTEGER NOT NULL CHECK (total_assets >= 0),
    storage_index_path TEXT NOT NULL,
    storage_meta_path TEXT NOT NULL,
    sha256_checksum VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'CORRUPT')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_snapshots_version ON vault_snapshots(version_number DESC);
CREATE INDEX IF NOT EXISTS idx_vault_snapshots_status ON vault_snapshots(status);
