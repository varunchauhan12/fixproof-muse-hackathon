-- ============================================================================
-- FixProof Database Migration 002: Cloud Persistence Expansion
-- Target Engine: PostgreSQL 15+ (Supabase)
-- Milestone: Phase 3.1 — Cloud-Ready Demo Persistence
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extend Incidents Table
-- Adds fields for score versioning, screening mode, session isolation,
-- and persistent storage paths in Supabase Storage.
-- ----------------------------------------------------------------------------
ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS score_version VARCHAR(64) DEFAULT 'v1.1-uncalibrated-heuristic',
    ADD COLUMN IF NOT EXISTS screening_mode VARCHAR(64) DEFAULT 'FULL_VIDEO_SCAN',
    ADD COLUMN IF NOT EXISTS session_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS suspect_storage_path TEXT,
    ADD COLUMN IF NOT EXISTS thumbnail_storage_path TEXT;

CREATE INDEX IF NOT EXISTS idx_incidents_session ON incidents(session_id);
CREATE INDEX IF NOT EXISTS idx_incidents_screening_mode ON incidents(screening_mode);

-- ----------------------------------------------------------------------------
-- 2. Multimodal Vision Verifications Table
-- Structured, immutable cache for Nemotron-3.5-Super-VL paired verification results.
-- Prevents repeated model calls during repeat visits, report history viewing, or playback scrubbing.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vision_verifications (
    verification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key VARCHAR(64) NOT NULL UNIQUE,
    source_asset_id VARCHAR(64),
    suspect_timestamp_sec NUMERIC(10, 2),
    reference_timestamp_sec NUMERIC(10, 2),
    visual_correspondence VARCHAR(32) NOT NULL
        CHECK (visual_correspondence IN ('HIGH_CORRESPONDENCE', 'POSSIBLE_REUSE', 'UNRELATED_SCENE', 'UNVERIFIED')),
    confidence_assessment VARCHAR(32)
        CHECK (confidence_assessment IN ('HIGH', 'MODERATE', 'LOW', 'INCONCLUSIVE')),
    matching_features JSONB NOT NULL DEFAULT '[]'::jsonb,
    contradictions JSONB NOT NULL DEFAULT '[]'::jsonb,
    reasoning TEXT,
    uncertainty_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
    validation_status VARCHAR(32) NOT NULL DEFAULT 'VERIFIED',
    model_id VARCHAR(128) NOT NULL,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vision_verifications_key ON vision_verifications(cache_key);
CREATE INDEX IF NOT EXISTS idx_vision_verifications_asset ON vision_verifications(source_asset_id);
CREATE INDEX IF NOT EXISTS idx_vision_verifications_created ON vision_verifications(created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. Evidence Packages Table
-- Persistent registry of cryptographically signed evidence packages (ZIP archives).
-- Links digital signatures, manifests, and file digests to persistent Supabase Storage objects.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence_packages (
    package_id VARCHAR(128) PRIMARY KEY,
    incident_id UUID NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    sha256_hash VARCHAR(64) NOT NULL,
    signing_key_id VARCHAR(128) NOT NULL,
    signature_hex TEXT NOT NULL,
    manifest_json JSONB NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_packages_incident ON evidence_packages(incident_id);
CREATE INDEX IF NOT EXISTS idx_evidence_packages_hash ON evidence_packages(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_evidence_packages_created ON evidence_packages(created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. Enable Row Level Security (RLS) with Safe Public Demo Access
-- Enforces server-side privileged access via service role, while allowing
-- authenticated and anonymous demo visitors to query public reference data and incidents.
-- ----------------------------------------------------------------------------
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE nemotron_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE vision_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_vectors ENABLE ROW LEVEL SECURITY;

-- Allow anon and authenticated users to select reference data
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read reference_assets') THEN
        CREATE POLICY "Allow public read reference_assets" ON reference_assets FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read reference_frames') THEN
        CREATE POLICY "Allow public read reference_frames" ON reference_frames FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read incidents') THEN
        CREATE POLICY "Allow public read incidents" ON incidents FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read nemotron_reports') THEN
        CREATE POLICY "Allow public read nemotron_reports" ON nemotron_reports FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read vision_verifications') THEN
        CREATE POLICY "Allow public read vision_verifications" ON vision_verifications FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read evidence_packages') THEN
        CREATE POLICY "Allow public read evidence_packages" ON evidence_packages FOR SELECT USING (true);
    END IF;
END $$;
