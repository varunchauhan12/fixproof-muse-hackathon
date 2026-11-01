"use client";

import React, { useState, useMemo } from "react";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  ArrowRight,
  Layers,
  Clock,
  ExternalLink,
  Download,
  RefreshCw,
  Copy,
  Check,
  Info,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Boxes,
  Database,
  Calendar,
  Activity,
  FileCheck,
} from "lucide-react";
import {
  MatchAnalysisResult,
  InvestigationReport,
  DetailedReportRecord,
  TimelineInterval,
  FrameCorrelationEvidence,
} from "@/lib/types";
import {
  getAssetFrameUrl,
  getDetailedReportPdfUrl,
  downloadDetailedReportPdf,
  formatDuration,
} from "@/lib/api";

interface ForensicEvidenceExperienceProps {
  incident: MatchAnalysisResult;
  latestReport?: InvestigationReport | null;
  detailedReport?: DetailedReportRecord | null;
  onRefreshReport?: () => void;
  refreshingReport?: boolean;
  onGenerateDetailedReport?: () => void;
  generatingDetailedReport?: boolean;
  detailedReportError?: string | null;
  onNavigateToNemotron?: (incident: MatchAnalysisResult) => void;
  onIncidentUpdated?: (updatedIncident: MatchAnalysisResult) => void;
}

export const ForensicEvidenceExperience: React.FC<ForensicEvidenceExperienceProps> = ({
  incident,
  latestReport,
  detailedReport,
  onRefreshReport,
  refreshingReport = false,
  onGenerateDetailedReport,
  generatingDetailedReport = false,
  detailedReportError,
  onNavigateToNemotron,
  onIncidentUpdated,
}) => {
  const [currentIncident, setCurrentIncident] = useState<MatchAnalysisResult>(incident);
  const [selectedPairIndex, setSelectedPairIndex] = useState<number>(0);
  const [activeIntervalId, setActiveIntervalId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<boolean>(false);
  const [downloadingPdf, setDownloadingPdf] = useState<boolean>(false);
  const [pdfDownloadError, setPdfDownloadError] = useState<string | null>(null);
  const [pdfDownloadSuccess, setPdfDownloadSuccess] = useState<boolean>(false);
  const [activeReportTab, setActiveReportTab] = useState<"summary" | "methodology" | "continuity" | "assessment" | "actions">("summary");

  // Sync currentIncident when parent incident prop changes
  React.useEffect(() => {
    setCurrentIncident(incident);
  }, [incident]);

  // Handle missing image states gracefully
  const [suspectImageError, setSuspectImageError] = useState<Record<number, boolean>>({});
  const [refImageError, setRefImageError] = useState<Record<number, boolean>>({});

  const handleCopyIncidentId = () => {
    const incId = currentIncident.incident_id || incident.incident_id;
    if (incId && typeof navigator !== "undefined") {
      navigator.clipboard.writeText(incId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  // Build unified evidence pairs from detailed report or incident frame matches
  const evidencePairs: Array<{
    id: string;
    evidenceId: string;
    suspectTimestamp: number;
    sourceTimestamp: number;
    sourceAssetId: string;
    sourceAssetTitle?: string;
    l2Distance: number | null;
    visualSimilarity: number;
    phashMatch?: boolean;
    phashDistance?: number;
    sparkVerification?: {
      modelId: string;
      visualCorrespondence: string;
      matchingFeatures: string[];
      contradictions: string[];
      reasoning: string;
    } | null;
    suspectFrameFilename?: string;
    refFrameFilename?: string;
    suspectUrl?: string;
    refUrl?: string;
  }> = useMemo(() => {
    // 1. If detailed report is available with frame_correlations, use rich correlations
    const reportCorrs = detailedReport?.sections?.frame_correlations;
    if (reportCorrs && reportCorrs.length > 0) {
      return reportCorrs.map((c, idx) => {
        // Suspect frame filename extracted from path or conventional naming
        let suspectFilename = "";
        if (c.suspect_image_path) {
          suspectFilename = c.suspect_image_path.split("/").pop() || "";
        }
        if (!suspectFilename) {
          suspectFilename = `frame_${String(idx).padStart(4, "0")}s.jpg`;
        }

        // Reference frame filename extracted from path or conventional naming
        let refFilename = "";
        if (c.ref_image_path) {
          refFilename = c.ref_image_path.split("/").pop() || "";
        }
        if (!refFilename) {
          refFilename = `frame_${String(idx).padStart(4, "0")}s.jpg`;
        }

        const suspectUrl = currentIncident.submitted_asset_id
          ? getAssetFrameUrl(currentIncident.submitted_asset_id, suspectFilename)
          : "";
        const refUrl = c.source_asset_id
          ? getAssetFrameUrl(c.source_asset_id, refFilename)
          : "";

        return {
          id: c.correlation_id || `corr-${idx}`,
          evidenceId: c.evidence_id || `evidence_frame_${Math.round(c.suspect_timestamp_sec)}s`,
          suspectTimestamp: c.suspect_timestamp_sec,
          sourceTimestamp: c.source_timestamp_sec,
          sourceAssetId: c.source_asset_id,
          sourceAssetTitle: c.source_asset_title,
          l2Distance: c.l2_distance,
          visualSimilarity: c.visual_similarity_score,
          phashMatch: c.phash_match,
          phashDistance: c.phash_distance,
          sparkVerification: c.vision_verification
            ? {
                modelId: c.vision_verification.model_id,
                visualCorrespondence: c.vision_verification.visual_correspondence,
                matchingFeatures: c.vision_verification.matching_features || [],
                contradictions: c.vision_verification.contradictions || [],
                reasoning: c.vision_verification.reasoning || "",
              }
            : null,
          suspectFrameFilename: suspectFilename,
          refFrameFilename: refFilename,
          suspectUrl,
          refUrl,
        };
      });
    }

    // 2. Fallback to incident frame matches
    const matches = currentIncident.frame_matches || [];
    return matches.map((fm, idx) => {
      const best = fm.best_match;
      const suspectFilename = fm.submitted_frame.filename || `frame_${String(idx).padStart(4, "0")}s.jpg`;
      const refFilename = best?.source_filename || "";

      const suspectUrl = currentIncident.submitted_asset_id
        ? getAssetFrameUrl(currentIncident.submitted_asset_id, suspectFilename)
        : "";
      const refUrl = best?.source_asset_id && refFilename
        ? getAssetFrameUrl(best.source_asset_id, refFilename)
        : "";

      return {
        id: `pair-${idx}`,
        evidenceId: fm.evidence_id || `evidence_frame_${Math.round(fm.submitted_frame.timestamp_sec)}s`,
        suspectTimestamp: fm.submitted_frame.timestamp_sec,
        sourceTimestamp: best?.source_timestamp_sec ?? 0,
        sourceAssetId: best?.source_asset_id || "unregistered",
        sourceAssetTitle: best?.source_filename || undefined,
        l2Distance: best?.l2_distance ?? null,
        visualSimilarity: best?.confidence_score ?? best?.visual_similarity_score ?? 0,
        phashMatch: best?.phash_match ?? false,
        phashDistance: best?.phash_evidence?.hamming_distance,
        sparkVerification: best?.vision_verification
          ? {
              modelId: best.vision_verification.model_id || "muse-spark-1.3",
              visualCorrespondence: best.vision_verification.visual_correspondence || "UNVERIFIED",
              matchingFeatures: best.vision_verification.supporting_visible_features || [],
              contradictions: best.vision_verification.contradictions || [],
              reasoning: best.vision_verification.reasoning_summary || "",
            }
          : null,
        suspectFrameFilename: suspectFilename,
        refFrameFilename: refFilename,
        suspectUrl,
        refUrl,
      };
    });
  }, [detailedReport, currentIncident]);



  // Timeline intervals from detailed report or latest report
  const timelineIntervals: TimelineInterval[] = useMemo(() => {
    return (
      detailedReport?.sections?.timeline_intervals ||
      latestReport?.timeline_intervals ||
      []
    );
  }, [detailedReport, latestReport]);

  const currentPair = evidencePairs[selectedPairIndex] || null;

  // Handle PDF download directly using existing backend endpoint
  const handlePdfDownload = async () => {
    const reportId = detailedReport?.report_id || latestReport?.report_id || incident.incident_id;
    if (!reportId) {
      setPdfDownloadError("No report or incident ID available for PDF download.");
      return;
    }

    setDownloadingPdf(true);
    setPdfDownloadError(null);
    setPdfDownloadSuccess(false);

    try {
      const blob = await downloadDetailedReportPdf(reportId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fixproof-meta-forensic-report-${reportId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setPdfDownloadSuccess(true);
      setTimeout(() => setPdfDownloadSuccess(false), 3000);
    } catch (err: any) {
      setPdfDownloadError(err?.message || "Failed to download forensic report PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  };



  return (
    <div className="space-y-6 text-[#ded7cb]">
      {/* ─── 1. INVESTIGATION OVERVIEW & MANDATORY HUMAN REVIEW BANNER ─── */}
      <div
        style={{
          background: "#171615",
          borderRadius: 16,
          border: "1px solid rgba(238, 231, 219, 0.08)",
        }}
        className="p-5 space-y-4"
      >
        {/* Header row */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[rgba(238,231,219,0.08)]">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase font-bold text-teal-400 tracking-wider">
                Forensic Investigation Record
              </span>
              <span className="text-[#5a554c]">•</span>
              <span className="text-[11px] text-[#8e887d] font-mono">
                {incident.incident_id || "UNKNOWN_ID"}
              </span>
              <button
                onClick={handleCopyIncidentId}
                className="text-[#8e887d] hover:text-[#f4efe6] transition-colors cursor-pointer"
                title="Copy Incident ID"
              >
                {copiedId ? <Check size={12} className="text-teal-400" /> : <Copy size={12} />}
              </button>
              {incident.investigation_type && (
                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-[#242220] text-[#aba497] border border-[rgba(238,231,219,0.1)]">
                  {incident.investigation_type.replace(/_/g, " ")}
                </span>
              )}
            </div>

            <h2 className="text-[18px] font-bold text-[#f4efe6] m-0">
              {incident.suspect_filename || incident.submitted_asset_id || "Suspect Media Target"}
            </h2>

            {incident.source_url && (
              <a
                href={incident.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-[#aba497] hover:text-teal-400 font-mono transition-colors"
              >
                <span className="truncate max-w-md">{incident.source_url}</span>
                <ExternalLink size={12} />
              </a>
            )}
          </div>

          {/* Quick Actions & Status Badge */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <span
              style={{
                background:
                  incident.overall_status === "CANDIDATE_MATCH"
                    ? "rgba(217, 164, 65, 0.16)"
                    : incident.overall_status === "HIGH_CONFIDENCE_MATCH"
                    ? "rgba(217, 164, 65, 0.2)"
                    : incident.overall_status === "CLEAN"
                    ? "rgba(72, 199, 181, 0.1)"
                    : "rgba(238, 231, 219, 0.08)",
                color:
                  incident.overall_status === "CANDIDATE_MATCH" || incident.overall_status === "HIGH_CONFIDENCE_MATCH"
                    ? "#dfa974"
                    : incident.overall_status === "CLEAN"
                    ? "#5eead4"
                    : "#aba497",
                border: "1px solid rgba(238, 231, 219, 0.12)",
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold font-mono uppercase tracking-wider flex items-center gap-1.5"
            >
              <Activity size={12} />
              <span>{incident.overall_status || "ANALYZED"}</span>
            </span>



            {onRefreshReport && (
              <button
                onClick={onRefreshReport}
                disabled={refreshingReport}
                style={{
                  background: "#1c1b1a",
                  border: "1px solid rgba(238, 231, 219, 0.1)",
                  color: "#ded7cb",
                }}
                className="px-3 py-1.5 rounded-lg hover:bg-[#262422] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={12} className={refreshingReport ? "animate-spin" : ""} />
                <span>Refresh Telemetry</span>
              </button>
            )}

            {(detailedReport || latestReport) && (
              <button
                onClick={handlePdfDownload}
                disabled={downloadingPdf}
                style={{
                  background: pdfDownloadSuccess ? "rgba(72,199,181,0.2)" : "#1c1b1a",
                  border: pdfDownloadSuccess ? "1px solid #48C7B5" : "1px solid rgba(238, 231, 219, 0.12)",
                  color: pdfDownloadSuccess ? "#5eead4" : "#f4efe6",
                }}
                className="px-3 py-1.5 rounded-lg hover:bg-[#262422] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Download size={12} className={downloadingPdf ? "animate-bounce" : ""} />
                <span>{downloadingPdf ? "Downloading..." : pdfDownloadSuccess ? "Downloaded PDF" : "Download PDF"}</span>
              </button>
            )}

            {onNavigateToNemotron && (
              <button
                onClick={() => onNavigateToNemotron(incident)}
                style={{
                  background: "#1c1b1a",
                  border: "1px solid rgba(72, 199, 181, 0.35)",
                  color: "#48C7B5",
                }}
                className="px-3 py-1.5 rounded-lg hover:bg-teal-500/10 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Open this incident in Muse Intelligence & Action Center"
              >
                <Cpu size={12} className="text-teal-400" />
                <span>Muse Center</span>
                <ArrowRight size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Forensic metrics summary grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 text-xs">
          <div className="p-3 bg-[#141312] rounded-xl border border-[rgba(238,231,219,0.06)]">
            <span className="text-[10px] text-[#8e887d] uppercase font-semibold block">Candidate Matches</span>
            <strong className="text-[15px] text-[#f4efe6] font-mono block mt-0.5">
              {incident.candidate_matches_found ?? 0}
            </strong>
            <span className="text-[10px] text-[#736d62]">Recorded Correlations</span>
          </div>

          <div className="p-3 bg-[#141312] rounded-xl border border-[rgba(238,231,219,0.06)]">
            <span className="text-[10px] text-[#8e887d] uppercase font-semibold block">Evidence Keyframes</span>
            <strong className="text-[15px] text-[#f4efe6] font-mono block mt-0.5">
              {evidencePairs.length}
            </strong>
            <span className="text-[10px] text-[#736d62]">Sampled Frame Pairs</span>
          </div>

          <div className="p-3 bg-[#141312] rounded-xl border border-[rgba(238,231,219,0.06)]">
            <span className="text-[10px] text-[#8e887d] uppercase font-semibold block">Peak Visual Sim</span>
            <strong className="text-[15px] text-teal-400 font-mono block mt-0.5">
              {(incident.highest_confidence ?? 0).toFixed(1)}%
            </strong>
            <span className="text-[10px] text-[#736d62]">Feature vector space</span>
          </div>

          <div className="p-3 bg-[#141312] rounded-xl border border-[rgba(238,231,219,0.06)]">
            <span className="text-[10px] text-[#8e887d] uppercase font-semibold block">Lowest L2 Distance</span>
            <strong className="text-[15px] text-[#ded7cb] font-mono block mt-0.5">
              {incident.lowest_l2_distance !== null && incident.lowest_l2_distance !== undefined
                ? incident.lowest_l2_distance.toFixed(4)
                : "—"}
            </strong>
            <span className="text-[10px] text-[#736d62]">MobileNetV3 metric</span>
          </div>

          <div className="p-3 bg-[#141312] rounded-xl border border-[rgba(238,231,219,0.06)] col-span-2 sm:col-span-4 lg:col-span-1">
            <span className="text-[10px] text-[#8e887d] uppercase font-semibold block">Target Vault Assets</span>
            <strong className="text-[13px] text-[#ded7cb] font-mono block mt-0.5 truncate">
              {incident.matched_assets && incident.matched_assets.length > 0
                ? `${incident.matched_assets.length} registered`
                : "None recorded"}
            </strong>
            <span className="text-[10px] text-[#736d62] truncate block">
              {incident.matched_assets && incident.matched_assets.length > 0
                ? incident.matched_assets[0].slice(0, 16)
                : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* ─── 2. SIDE-BY-SIDE EVIDENCE COMPARISON ─── */}
      <div
        style={{
          background: "#171615",
          borderRadius: 16,
          border: "1px solid rgba(238, 231, 219, 0.08)",
        }}
        className="p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[rgba(238,231,219,0.08)]">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold text-[#f4efe6] m-0">
                Side-by-Side Forensic Evidence Comparison
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#242220] text-[#aba497] border border-[rgba(238,231,219,0.1)]">
                Pair {evidencePairs.length > 0 ? selectedPairIndex + 1 : 0} of {evidencePairs.length}
              </span>
            </div>
            <p className="text-xs text-[#aba497] m-0 mt-0.5">
              Exact reference frame versus suspect frame alignment with verified visual features, perceptual hash, and Muse multimodal verification.
            </p>
          </div>
        </div>

        {/* Evidence Pair Selector Tabs */}
        {evidencePairs.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1.5">
            <button
              onClick={() => setSelectedPairIndex((prev) => Math.max(0, prev - 1))}
              disabled={selectedPairIndex === 0}
              className="p-1.5 rounded-lg bg-[#1c1b1a] text-[#aba497] hover:text-[#f4efe6] disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed shrink-0"
              title="Previous Evidence Pair"
            >
              <ChevronLeft size={16} />
            </button>

            {evidencePairs.map((pair, idx) => {
              const isSelected = selectedPairIndex === idx;

              return (
                <button
                  key={pair.id}
                  onClick={() => setSelectedPairIndex(idx)}
                  style={{
                    background: isSelected ? "#242220" : "#1a1918",
                    border: isSelected
                      ? "1px solid #48C7B5"
                      : "1px solid rgba(238, 231, 219, 0.08)",
                    color: isSelected ? "#f4efe6" : "#aba497",
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium shrink-0 transition-all flex items-center gap-2 cursor-pointer"
                >
                  <span className="font-bold text-[11px]">#{idx + 1}</span>
                  <span>
                    {pair.suspectTimestamp.toFixed(1)}s ↔ {pair.sourceTimestamp.toFixed(1)}s
                  </span>
                  <span
                    style={{
                      color: pair.visualSimilarity >= 70 ? "#dfa974" : "#aba497",
                    }}
                    className="font-bold text-[10px]"
                  >
                    {pair.visualSimilarity.toFixed(0)}%
                  </span>
                </button>
              );
            })}

            <button
              onClick={() => setSelectedPairIndex((prev) => Math.min(evidencePairs.length - 1, prev + 1))}
              disabled={selectedPairIndex === evidencePairs.length - 1}
              className="p-1.5 rounded-lg bg-[#1c1b1a] text-[#aba497] hover:text-[#f4efe6] disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed shrink-0"
              title="Next Evidence Pair"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* Dual Frame Comparison Container */}
        {currentPair ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* ─── SUSPECT FRAME CARD ─── */}
              <div
                style={{
                  background: "#141312",
                  border: "1px solid rgba(217, 164, 65, 0.25)",
                  borderRadius: 12,
                }}
                className="overflow-hidden flex flex-col"
              >
                <div className="px-3.5 py-2.5 bg-[#1b1a18] border-b border-[rgba(238,231,219,0.06)] flex items-center justify-between text-xs gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      SUSPECT MEDIA
                    </span>
                    <span className="font-mono text-[#f4efe6] font-bold">
                      {currentPair.suspectTimestamp.toFixed(2)}s
                    </span>
                  </div>
                </div>

                {/* Suspect Frame Image Container */}
                <div className="relative aspect-video w-full bg-[#0a0a09] flex items-center justify-center overflow-hidden">
                  {currentPair.suspectUrl && !suspectImageError[selectedPairIndex] ? (
                    <img
                      src={currentPair.suspectUrl}
                      alt={`Suspect Frame at ${currentPair.suspectTimestamp}s`}
                      className="max-w-full max-h-full object-contain block"
                      onError={() => {
                        setSuspectImageError((prev) => ({ ...prev, [selectedPairIndex]: true }));
                      }}
                    />
                  ) : (
                    <div className="p-6 text-center space-y-2">
                      <div className="w-10 h-10 mx-auto rounded-full bg-[#1c1b1a] border border-[rgba(238,231,219,0.1)] flex items-center justify-center text-[#8e887d]">
                        <Boxes size={20} />
                      </div>
                      <div className="text-xs text-[#aba497]">
                        Suspect keyframe image unavailable from storage
                      </div>
                      <div className="text-[10px] text-[#736d62] font-mono">
                        {currentPair.suspectFrameFilename || "frame.jpg"} • Ts {currentPair.suspectTimestamp}s
                      </div>
                    </div>
                  )}

                  <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/80 text-[10px] font-mono text-[#f4efe6] border border-white/10 flex items-center gap-1.5">
                    <span>Suspect: {currentPair.suspectTimestamp.toFixed(2)}s</span>
                  </div>
                </div>

                {/* Suspect Footer Info */}
                <div className="p-3 text-[11px] bg-[#141312] border-t border-[rgba(238,231,219,0.06)] text-[#aba497] flex items-center justify-between">
                  <div>
                    <span className="text-[#8e887d]">Source File: </span>
                    <span className="font-mono text-[#ded7cb]">
                      {currentIncident.suspect_filename || incident.suspect_filename || "Target stream / upload"}
                    </span>
                  </div>
                  <span className="text-[10px] text-[#8e887d] font-mono">
                    {currentPair.evidenceId}
                  </span>
                </div>
              </div>

              {/* ─── REFERENCE ARCHIVE CARD ─── */}
              <div
                style={{
                  background: "#141312",
                  border: "1px solid rgba(20, 184, 166, 0.25)",
                  borderRadius: 12,
                }}
                className="overflow-hidden flex flex-col"
              >
                <div className="px-3.5 py-2.5 bg-[#1b1a18] border-b border-[rgba(238,231,219,0.06)] flex items-center justify-between text-xs gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wider bg-teal-500/15 text-teal-300 border border-teal-500/30">
                      REFERENCE ARCHIVE
                    </span>
                    <span className="font-mono text-[#f4efe6] font-bold">
                      {currentPair.sourceTimestamp.toFixed(2)}s
                    </span>
                  </div>
                </div>

                {/* Reference Frame Image Container */}
                <div className="relative aspect-video w-full bg-[#0a0a09] flex items-center justify-center overflow-hidden">
                  {currentPair.refUrl && !refImageError[selectedPairIndex] ? (
                    <img
                      src={currentPair.refUrl}
                      alt={`Reference Frame at ${currentPair.sourceTimestamp}s`}
                      className="max-w-full max-h-full object-contain block"
                      onError={() => {
                        setRefImageError((prev) => ({ ...prev, [selectedPairIndex]: true }));
                      }}
                    />
                  ) : (
                    <div className="p-6 text-center space-y-2">
                      <div className="w-10 h-10 mx-auto rounded-full bg-[#1c1b1a] border border-[rgba(238,231,219,0.1)] flex items-center justify-center text-[#8e887d]">
                        <Database size={20} />
                      </div>
                      <div className="text-xs text-[#aba497]">
                        Reference keyframe image unavailable from storage
                      </div>
                      <div className="text-[10px] text-[#736d62] font-mono">
                        Asset: {currentPair.sourceAssetId.slice(0, 16)} • Ts {currentPair.sourceTimestamp}s
                      </div>
                    </div>
                  )}

                  <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/80 text-[10px] font-mono text-[#f4efe6] border border-white/10 flex items-center gap-1.5">
                    <span>Reference: {currentPair.sourceTimestamp.toFixed(2)}s</span>
                  </div>
                </div>

                {/* Reference Footer Info */}
                <div className="p-3 text-[11px] bg-[#141312] border-t border-[rgba(238,231,219,0.06)] text-[#aba497] flex items-center justify-between">
                  <div className="truncate">
                    <span className="text-[#8e887d]">Matched Asset: </span>
                    <span className="font-mono text-[#ded7cb]">
                      {currentPair.sourceAssetTitle || currentPair.sourceAssetId}
                    </span>
                  </div>
                  <span className="text-[10px] text-[#8e887d] font-mono shrink-0">
                    Vault: {currentPair.sourceAssetId ? currentPair.sourceAssetId.slice(0, 10) : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* Evidence Telemetry & Verification Card */}
            <div className="p-4 bg-[#141312] rounded-xl border border-[rgba(238,231,219,0.08)] space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-[10px] text-[#8e887d] uppercase font-semibold block">Visual Similarity</span>
                  <strong className="text-[14px] text-teal-400 font-mono block mt-0.5">
                    {currentPair.visualSimilarity.toFixed(1)}%
                  </strong>
                  <span className="text-[9.5px] text-[#736d62]">Cos-sim feature metric</span>
                </div>

                <div>
                  <span className="text-[10px] text-[#8e887d] uppercase font-semibold block">L2 Vector Distance</span>
                  <strong className="text-[14px] text-[#ded7cb] font-mono block mt-0.5">
                    {currentPair.l2Distance !== null ? currentPair.l2Distance.toFixed(4) : "—"}
                  </strong>
                  <span className="text-[9.5px] text-[#736d62]">MobileNetV3 576-dim</span>
                </div>

                <div>
                  <span className="text-[10px] text-[#8e887d] uppercase font-semibold block">pHash Result</span>
                  <strong className="text-[14px] text-[#ded7cb] font-mono block mt-0.5">
                    {currentPair.phashDistance !== undefined
                      ? `Hamming: ${currentPair.phashDistance}`
                      : currentPair.phashMatch
                      ? "Match Confirmed"
                      : "Unmatched"}
                  </strong>
                  <span className="text-[9.5px] text-[#736d62]">64-bit DCT perceptual hash</span>
                </div>

                <div>
                  <span className="text-[10px] text-[#8e887d] uppercase font-semibold block">Temporal Offset Δt</span>
                  <strong className="text-[14px] text-[#ded7cb] font-mono block mt-0.5">
                    {(currentPair.suspectTimestamp - currentPair.sourceTimestamp) >= 0 ? "+" : ""}
                    {(currentPair.suspectTimestamp - currentPair.sourceTimestamp).toFixed(2)}s
                  </strong>
                  <span className="text-[9.5px] text-[#736d62]">Suspect vs Source time</span>
                </div>
              </div>

              {/* Muse Spark 1.3 Pairwise Verification Breakdown */}
              {currentPair.sparkVerification ? (
                <div className="pt-3 border-t border-[rgba(238,231,219,0.06)] space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#f4efe6]">
                        Pairwise Vision Verification ({currentPair.sparkVerification.modelId})
                      </span>
                      <span
                        style={{
                          background:
                            currentPair.sparkVerification.visualCorrespondence === "HIGH_CORRESPONDENCE" ||
                            currentPair.sparkVerification.visualCorrespondence === "CONFIRMED"
                              ? "rgba(72,199,181,0.15)"
                              : "rgba(217, 164, 65, 0.15)",
                          color:
                            currentPair.sparkVerification.visualCorrespondence === "HIGH_CORRESPONDENCE" ||
                            currentPair.sparkVerification.visualCorrespondence === "CONFIRMED"
                              ? "#5eead4"
                              : "#dfa974",
                        }}
                        className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-[rgba(238,231,219,0.1)]"
                      >
                        {currentPair.sparkVerification.visualCorrespondence.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>

                  {currentPair.sparkVerification.reasoning && (
                    <p className="text-[#aba497] text-[11.5px] leading-relaxed m-0">
                      {currentPair.sparkVerification.reasoning}
                    </p>
                  )}

                  {currentPair.sparkVerification.matchingFeatures.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <span className="text-[10px] font-bold text-[#8e887d] uppercase tracking-wider block">
                        Observed Supporting Features:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {currentPair.sparkVerification.matchingFeatures.map((feat, fi) => (
                          <span
                            key={fi}
                            className="px-2 py-0.5 rounded text-[10px] bg-[#1c1b1a] text-[#ded7cb] border border-[rgba(238,231,219,0.08)]"
                          >
                            ✓ {feat}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {currentPair.sparkVerification.contradictions.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <span className="text-[10px] font-bold text-[#dfa974] uppercase tracking-wider block">
                        Visual Contradictions / Divergences:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {currentPair.sparkVerification.contradictions.map((contra, ci) => (
                          <span
                            key={ci}
                            className="px-2 py-0.5 rounded text-[10px] bg-amber-950/20 text-amber-300 border border-amber-500/20"
                          >
                            ! {contra}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="pt-2 border-t border-[rgba(238,231,219,0.06)] text-[11px] text-[#736d62] italic">
                  Pairwise vision verification (Muse Spark 1.3) was not recorded for this frame correlation.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-[#736d62] text-xs bg-[#141312] rounded-xl border border-dashed border-[rgba(238,231,219,0.08)]">
            No candidate evidence keyframe pairs available for this incident.
          </div>
        )}
      </div>

      {/* ─── 3. TEMPORAL EVIDENCE TIMELINE ─── */}
      <div
        style={{
          background: "#171615",
          borderRadius: 16,
          border: "1px solid rgba(238, 231, 219, 0.08)",
        }}
        className="p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[rgba(238,231,219,0.08)]">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold text-[#f4efe6] m-0">
                Temporal Evidence Timeline & Continuity Clusters
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#242220] text-[#aba497] border border-[rgba(238,231,219,0.1)]">
                {timelineIntervals.length} Clustered Interval{timelineIntervals.length === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-xs text-[#aba497] m-0 mt-0.5">
              Correlated time windows, sequence continuity metrics, and associated keyframe evidence groups.
            </p>
          </div>
        </div>

        {/* Timeline Disclosures */}
        <div
          style={{
            background: "rgba(20, 184, 166, 0.06)",
            border: "1px solid rgba(20, 184, 166, 0.2)",
            borderRadius: 8,
          }}
          className="p-2.5 text-[11px] text-[#aba497] flex items-center gap-2"
        >
          <Info size={14} className="text-teal-400 shrink-0" />
          <span>
            <strong>System Sampling Disclosure:</strong> The forensic pipeline samples discrete keyframes at structured intervals (1.0s – 2.0s).
            Unsampled time windows between keyframes are not continuously inspected. Continuous match status denotes bounded sequence clusters.
          </span>
        </div>

        {/* Intervals rendering */}
        {timelineIntervals.length > 0 ? (
          <div className="space-y-3">
            {timelineIntervals.map((interval) => {
              const isActive = activeIntervalId === interval.interval_id;

              return (
                <div
                  key={interval.interval_id}
                  onClick={() => {
                    setActiveIntervalId(isActive ? null : interval.interval_id);
                    // If evidence_ids match a pair, jump to it
                    if (interval.evidence_ids && interval.evidence_ids.length > 0) {
                      const foundIdx = evidencePairs.findIndex((p) =>
                        interval.evidence_ids.includes(p.evidenceId) || interval.evidence_ids.includes(p.id)
                      );
                      if (foundIdx !== -1) {
                        setSelectedPairIndex(foundIdx);
                      }
                    }
                  }}
                  style={{
                    background: isActive ? "#22211e" : "#141312",
                    border: isActive
                      ? "1px solid #48C7B5"
                      : "1px solid rgba(238, 231, 219, 0.08)",
                  }}
                  className="p-3.5 rounded-xl transition-all cursor-pointer hover:border-[rgba(238,231,219,0.18)] space-y-2.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Clock size={13} className="text-teal-400" />
                      <span className="font-bold text-[#f4efe6] font-mono">
                        Suspect: {interval.suspect_start_sec.toFixed(1)}s – {interval.suspect_end_sec.toFixed(1)}s
                      </span>
                      <span className="text-[#5a554c]">↔</span>
                      <span className="font-mono text-[#ded7cb]">
                        Source: {interval.source_start_sec.toFixed(1)}s – {interval.source_end_sec.toFixed(1)}s
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        style={{
                          background:
                            interval.continuity_status === "CONTINUOUS_MATCH"
                              ? "rgba(72,199,181,0.15)"
                              : interval.continuity_status === "SPARSE_MATCH"
                              ? "rgba(217, 164, 65, 0.15)"
                              : "rgba(238, 231, 219, 0.08)",
                          color:
                            interval.continuity_status === "CONTINUOUS_MATCH"
                              ? "#5eead4"
                              : interval.continuity_status === "SPARSE_MATCH"
                              ? "#dfa974"
                              : "#aba497",
                        }}
                        className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider border border-[rgba(238,231,219,0.1)]"
                      >
                        {interval.continuity_status.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] font-mono text-[#8e887d]">
                        Duration: {interval.duration_sec.toFixed(1)}s
                      </span>
                    </div>
                  </div>

                  {/* Interval sub-metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-[#aba497] bg-[#1a1918] p-2.5 rounded-lg">
                    <div>
                      <span className="text-[9.5px] text-[#8e887d] uppercase block">Sampled Keyframes</span>
                      <span className="font-mono text-[#f4efe6] font-bold">{interval.frame_count} frames</span>
                    </div>
                    <div>
                      <span className="text-[9.5px] text-[#8e887d] uppercase block">Min L2 Distance</span>
                      <span className="font-mono text-[#ded7cb]">{interval.min_l2_distance?.toFixed(4) || "—"}</span>
                    </div>
                    <div>
                      <span className="text-[9.5px] text-[#8e887d] uppercase block">pHash Match Ratio</span>
                      <span className="font-mono text-[#ded7cb]">
                        {interval.phash_match_ratio !== undefined ? `${Math.round(interval.phash_match_ratio * 100)}%` : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9.5px] text-[#8e887d] uppercase block">Associated Evidence IDs</span>
                      <span className="font-mono text-[#ded7cb] truncate block" title={(interval.evidence_ids || []).join(", ")}>
                        {(interval.evidence_ids || []).length} cited
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-6 text-center text-[#736d62] text-xs bg-[#141312] rounded-xl border border-dashed border-[rgba(238,231,219,0.08)]">
            No temporal clusters identified. Media analysis yielded zero or isolated single-frame matches.
          </div>
        )}
      </div>

      {/* ─── 4. MODEL AND EVIDENCE PROVENANCE ─── */}
      <div
        style={{
          background: "#171615",
          borderRadius: 16,
          border: "1px solid rgba(238, 231, 219, 0.08)",
        }}
        className="p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[rgba(238,231,219,0.08)]">
          <div>
            <h3 className="text-[15px] font-bold text-[#f4efe6] m-0">
              Pipeline Architecture & Model Provenance
            </h3>
            <p className="text-xs text-[#aba497] m-0 mt-0.5">
              Verified operational roles and execution status across deterministic discovery, vision verification, segmentation, and reasoning.
            </p>
          </div>
          <span className="text-[11px] font-mono text-[#8e887d]">
            Report Ref: {detailedReport?.report_id?.slice(0, 8) || latestReport?.report_id?.slice(0, 8) || "N/A"}
          </span>
        </div>

        {/* Provenance Matrix Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[rgba(238,231,219,0.08)] text-[#8e887d] text-[10px] uppercase tracking-wider font-mono">
                <th className="py-2.5 px-3">Pipeline Stage</th>
                <th className="py-2.5 px-3">Provider</th>
                <th className="py-2.5 px-3">Model / Component ID</th>
                <th className="py-2.5 px-3">Functional Role</th>
                <th className="py-2.5 px-3 text-right">Validation Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(238,231,219,0.04)] font-mono text-[11px]">
              {/* MobileNetV3 / FAISS */}
              <tr className="hover:bg-[#1a1918] transition-colors">
                <td className="py-2.5 px-3 font-semibold text-[#f4efe6]">Candidate Discovery</td>
                <td className="py-2.5 px-3 text-[#ded7cb]">Local Vault</td>
                <td className="py-2.5 px-3 text-teal-400">MobileNetV3-Small / FAISS</td>
                <td className="py-2.5 px-3 text-[#aba497]">576-dim L2 feature extraction & nearest-neighbor search</td>
                <td className="py-2.5 px-3 text-right">
                  <span className="px-2 py-0.5 rounded text-[9.5px] uppercase font-bold bg-[#1c1b1a] text-teal-400 border border-teal-500/20">
                    Component Tested (Deterministic)
                  </span>
                </td>
              </tr>

              {/* Muse Spark 1.3 */}
              <tr className="hover:bg-[#1a1918] transition-colors">
                <td className="py-2.5 px-3 font-semibold text-[#f4efe6]">Vision Verification</td>
                <td className="py-2.5 px-3 text-[#ded7cb]">Meta Muse API</td>
                <td className="py-2.5 px-3 text-teal-400">muse-spark-1.3</td>
                <td className="py-2.5 px-3 text-[#aba497]">Pairwise candidate visual correspondence & contradiction review</td>
                <td className="py-2.5 px-3 text-right">
                  <span className="px-2 py-0.5 rounded text-[9.5px] uppercase font-bold bg-[#1c1b1a] text-teal-400 border border-teal-500/20">
                    Provider / API Validated
                  </span>
                </td>
              </tr>



              {/* Muse Wonder 1.0 */}
              <tr className="hover:bg-[#1a1918] transition-colors">
                <td className="py-2.5 px-3 font-semibold text-[#f4efe6]">Multimodal Reasoning</td>
                <td className="py-2.5 px-3 text-[#ded7cb]">Meta Muse API</td>
                <td className="py-2.5 px-3 text-teal-400">muse-wonder-1.0</td>
                <td className="py-2.5 px-3 text-[#aba497]">Temporal continuity analysis & evidence-grounded report synthesis</td>
                <td className="py-2.5 px-3 text-right">
                  <span className="px-2 py-0.5 rounded text-[9.5px] uppercase font-bold bg-[#1c1b1a] text-teal-400 border border-teal-500/20">
                    {detailedReport?.ai_synthesized ? "Provider / API Validated" : "Deterministic Fallback"}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Validation Scope Notice */}
        <div className="p-3 bg-[#141312] rounded-xl border border-[rgba(238,231,219,0.06)] text-[10.5px] text-[#8e887d] leading-relaxed">
          <strong className="text-[#ded7cb]">VALIDATION SCOPE NOTICE:</strong> Statuses reflect tested component and API interface functionality.
          Full end-to-end multimodal pipeline validation requires an active live investigation run against authenticated models.
        </div>
      </div>

      {/* ─── 5. DETAILED REPORT PREVIEW & ARTIFACT EXPORT ─── */}
      <div
        style={{
          background: "#171615",
          borderRadius: 16,
          border: "1px solid rgba(238, 231, 219, 0.08)",
        }}
        className="p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[rgba(238,231,219,0.08)]">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold text-[#f4efe6] m-0">
                Forensic Investigation Report & Export
              </h3>
              {detailedReport?.ai_synthesized && (
                <span className="px-2 py-0.5 rounded text-[9.5px] font-bold uppercase bg-teal-500/15 text-teal-300 border border-teal-500/30">
                  AI Synthesized
                </span>
              )}
            </div>
            <p className="text-xs text-[#aba497] m-0 mt-0.5">
              Structured forensic sections, methodology disclosures, and tamper-evident PDF artifact export.
            </p>
          </div>

          {/* Action button: Generate or Download PDF */}
          <div className="flex items-center gap-2">
            {detailedReport ? (
              <button
                onClick={handlePdfDownload}
                disabled={downloadingPdf}
                style={{
                  background: pdfDownloadSuccess ? "rgba(72,199,181,0.2)" : "#1c1b1a",
                  border: pdfDownloadSuccess ? "1px solid #48C7B5" : "1px solid rgba(238, 231, 219, 0.12)",
                  color: pdfDownloadSuccess ? "#5eead4" : "#f4efe6",
                }}
                className="px-3.5 py-1.5 rounded-lg hover:bg-[#262422] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Download size={13} className={downloadingPdf ? "animate-bounce" : ""} />
                <span>{downloadingPdf ? "Generating PDF..." : "Download Official PDF"}</span>
              </button>
            ) : onGenerateDetailedReport ? (
              <button
                onClick={onGenerateDetailedReport}
                disabled={generatingDetailedReport}
                style={{
                  background: "#1c1b1a",
                  border: "1px solid rgba(20, 184, 166, 0.3)",
                  color: "#5eead4",
                }}
                className="px-3.5 py-1.5 rounded-lg hover:bg-[#262422] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <FileCheck size={13} className={generatingDetailedReport ? "animate-spin" : ""} />
                <span>{generatingDetailedReport ? "Synthesizing Report..." : "Generate Detailed Report"}</span>
              </button>
            ) : null}
          </div>
        </div>

        {/* Errors & Alerts */}
        {(pdfDownloadError || detailedReportError) && (
          <div className="p-3 bg-red-950/20 border border-red-500/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{pdfDownloadError || detailedReportError}</span>
          </div>
        )}

        {/* Report Section Tabs */}
        {detailedReport ? (
          <div className="space-y-4">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              {[
                { id: "summary", label: "Executive Summary" },
                { id: "methodology", label: "Methodology & Scope" },
                { id: "continuity", label: "Temporal Continuity" },
                { id: "assessment", label: "Model Assessment" },
                { id: "actions", label: "Recommended Actions" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveReportTab(tab.id as any)}
                  style={{
                    background: activeReportTab === tab.id ? "#242220" : "#1a1918",
                    color: activeReportTab === tab.id ? "#f4efe6" : "#aba497",
                    border: activeReportTab === tab.id
                      ? "1px solid #48C7B5"
                      : "1px solid rgba(238, 231, 219, 0.08)",
                  }}
                  className="px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors cursor-pointer"
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content pane */}
            <div className="p-4 bg-[#141312] rounded-xl border border-[rgba(238,231,219,0.06)] text-xs text-[#ded7cb] leading-relaxed">
              {activeReportTab === "summary" && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400 block font-mono">
                    1. Executive Summary
                  </span>
                  <p className="m-0 text-[#f4efe6] text-[12.5px] leading-relaxed">
                    {detailedReport.sections.executive_summary || "No executive summary available."}
                  </p>
                </div>
              )}

              {activeReportTab === "methodology" && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400 block font-mono">
                    2. Forensic Methodology & Technical Scope
                  </span>
                  <p className="m-0 text-[#f4efe6] text-[12.5px] leading-relaxed">
                    {detailedReport.sections.methodology_scope || "No methodology narrative recorded."}
                  </p>
                </div>
              )}

              {activeReportTab === "continuity" && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400 block font-mono">
                    5. Temporal Continuity & Scene Progression
                  </span>
                  <p className="m-0 text-[#f4efe6] text-[12.5px] leading-relaxed">
                    {detailedReport.sections.temporal_continuity || "Zero cluster progressions observed."}
                  </p>
                </div>
              )}

              {activeReportTab === "assessment" && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400 block font-mono">
                    8. Model Assessment & Alternative Interpretations
                  </span>
                  <p className="m-0 text-[#f4efe6] text-[12.5px] leading-relaxed">
                    {detailedReport.sections.model_assessment || "No alternative visual hypotheses recorded."}
                  </p>
                </div>
              )}

              {activeReportTab === "actions" && (
                <div className="space-y-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400 block font-mono">
                    12. Mandatory Human Review & Recommended Protocol Actions
                  </span>
                  {detailedReport.sections.recommended_actions && detailedReport.sections.recommended_actions.length > 0 ? (
                    <ul className="space-y-2 m-0 p-0 list-none">
                      {detailedReport.sections.recommended_actions.map((act, ai) => (
                        <li key={ai} className="flex items-start gap-2 text-[#ded7cb]">
                          <span className="text-teal-400 font-bold shrink-0 mt-0.5">•</span>
                          <span>{act}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="m-0 text-[#aba497]">
                      Conduct mandatory qualified human review before initiating any external outreach or enforcement action.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-[#736d62] text-xs bg-[#141312] rounded-xl border border-dashed border-[rgba(238,231,219,0.08)] space-y-2">
            <FileText size={24} className="mx-auto text-[#8e887d]" />
            <div>Detailed forensic report has not yet been generated for this incident.</div>
            {onGenerateDetailedReport && (
              <button
                onClick={onGenerateDetailedReport}
                disabled={generatingDetailedReport}
                className="px-3 py-1.5 rounded-lg bg-[#1c1b1a] text-teal-400 border border-teal-500/20 hover:bg-[#262422] font-semibold text-xs transition-colors cursor-pointer"
              >
                {generatingDetailedReport ? "Synthesizing..." : "Synthesize Detailed Report Now"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

