"use client";

import React, { useState, useMemo } from "react";
import {
  AlertTriangle,
  Cpu,
  ArrowRight,
  Clock,
  ExternalLink,
  Download,
  RefreshCw,
  Copy,
  Check,
  Info,
  FileText,
  Activity,
  FileCheck,
  Sparkles,
} from "lucide-react";
import {
  MatchAnalysisResult,
  InvestigationReport,
  DetailedReportRecord,
  TimelineInterval,
} from "@/lib/types";
import {
  downloadDetailedReportPdf,
} from "@/lib/api";
import { buildEvidencePairs } from "@/lib/forensic-evidence";
import { SAMInvestigationWorkspace } from "./SAMInvestigationWorkspace";
import { InvestigationWorkspace } from "./InvestigationWorkspace";
import { useActivity } from "@/context/ActivityContext";

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

export const ForensicEvidenceExperience: React.FC<ForensicEvidenceExperienceProps> = (props) => (
  <ForensicInvestigationRoom key={props.incident.incident_id || props.incident.submitted_asset_id} {...props}
    detailedReport={props.detailedReport?.incident_id === props.incident.incident_id ? props.detailedReport : null} />
);

const ForensicInvestigationRoom: React.FC<ForensicEvidenceExperienceProps> = ({
  incident,
  latestReport,
  detailedReport,
  onRefreshReport,
  refreshingReport = false,
  onGenerateDetailedReport,
  generatingDetailedReport = false,
  detailedReportError,
  onNavigateToNemotron,
}) => {
  const [samOpened, setSamOpened] = useState(false);
  const [investigationTab, setInvestigationTab] = useState<'cv' | 'sam'>('cv');
  const currentIncident = incident;
  const [selectedPairIndex, setSelectedPairIndex] = useState<number>(0);
  const [activeIntervalId, setActiveIntervalId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<boolean>(false);
  const [downloadingPdf, setDownloadingPdf] = useState<boolean>(false);
  const [pdfDownloadError, setPdfDownloadError] = useState<string | null>(null);
  const [pdfDownloadSuccess, setPdfDownloadSuccess] = useState<boolean>(false);
  const [activeReportTab, setActiveReportTab] = useState<"summary" | "methodology" | "continuity" | "assessment" | "actions">("summary");

  const activityContext = useActivity();

  // Sync currentIncident and reset active pair / errors when incident changes
  React.useEffect(() => {
    if (incident?.incident_id && activityContext?.setActiveIncidentId) {
      activityContext.setActiveIncidentId(incident.incident_id, incident.session_id);
    }
  }, [incident?.incident_id, incident?.session_id, activityContext]);



  const handleCopyIncidentId = () => {
    const incId = currentIncident.incident_id || incident.incident_id;
    if (incId && typeof navigator !== "undefined") {
      navigator.clipboard.writeText(incId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const evidencePairs = useMemo(() => buildEvidencePairs(incident, detailedReport), [incident, detailedReport]);

  // Timeline intervals from detailed report or latest report
  const timelineIntervals: TimelineInterval[] = useMemo(() => {
    return (
      detailedReport?.sections?.timeline_intervals ||
      latestReport?.timeline_intervals ||
      []
    );
  }, [detailedReport, latestReport]);



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
    } catch (err: unknown) {
      setPdfDownloadError(err instanceof Error ? err.message : "Failed to download forensic report PDF.");
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
        <div className="grid gap-3 sm:grid-cols-2 text-xs">
          <div className="rounded-lg border border-teal-900 p-3"><span className="block text-teal-300">Reference assets in recorded candidates</span><p className="mt-1 break-all font-mono">{Array.from(new Set(evidencePairs.map(p => p.sourceAssetId).filter(Boolean))).join(', ') || 'No reference asset recorded'}</p></div>
          <div className="rounded-lg border border-amber-900 p-3"><span className="block text-amber-300">Suspect footage</span><p className="mt-1 break-all">{incident.suspect_filename || incident.submitted_asset_id || 'Not recorded'}</p><p className="mt-1 text-[#8e887d]">Backend threshold matches: {incident.candidate_matches_found ?? 'Not recorded'}</p></div>
        </div>
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

            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("fixproof_muse_select_incident", {
                      detail: incident.incident_id,
                    })
                  );
                  window.dispatchEvent(new CustomEvent("fixproof_open_muse"));
                }
              }}
              style={{
                background: "#1c1b1a",
                border: "1px solid rgba(72, 199, 181, 0.35)",
                color: "#48C7B5",
              }}
              className="px-3 py-1.5 rounded-lg hover:bg-teal-500/10 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Open Muse AI Copilot for this incident"
            >
              <Sparkles size={12} className="text-teal-400" />
              <span>Ask Muse</span>
            </button>
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
            <span className="text-[10px] text-[#8e887d] uppercase font-semibold block">Inspectable Frame Pairs</span>
            <strong className="text-[15px] text-[#f4efe6] font-mono block mt-0.5">
              {evidencePairs.length}
            </strong>
            <span className="text-[10px] text-[#736d62]">Includes alternative candidates</span>
          </div>

          <div className="p-3 bg-[#141312] rounded-xl border border-[rgba(238,231,219,0.06)]">
            <span className="text-[10px] text-[#8e887d] uppercase font-semibold block">Peak Visual Sim</span>
            <strong className="text-[15px] text-teal-400 font-mono block mt-0.5">
              {typeof incident.highest_confidence === "number" ? `${incident.highest_confidence.toFixed(1)} / 100` : "Not recorded"}
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

      <div role="tablist" aria-label="Investigation stages" className="flex gap-2 rounded-xl border border-white/10 p-2">
        {(['cv', 'sam'] as const).map(tab => <button key={tab} role="tab" id={`${tab}-investigation-tab`} aria-selected={investigationTab === tab} aria-controls={`${tab}-investigation-panel`} onClick={() => { setInvestigationTab(tab); if (tab === 'sam') setSamOpened(true); }} className={`rounded-lg px-4 py-2 text-sm ${investigationTab === tab ? 'bg-teal-950/40 text-teal-200 ring-1 ring-teal-700' : 'text-[#aba497]'}`}>{tab === 'cv' ? 'CV Investigation' : 'SAM Investigation'}</button>)}
      </div>
      <div role="tabpanel" id="sam-investigation-panel" aria-labelledby="sam-investigation-tab" hidden={investigationTab !== 'sam'}>
        {samOpened && (incident.incident_id ? <SAMInvestigationWorkspace incidentId={incident.incident_id} active={investigationTab === 'sam'}/> : <p>Save an investigation before starting SAM analysis.</p>)}
      </div>
      <div role="tabpanel" id="cv-investigation-panel" aria-labelledby="cv-investigation-tab" hidden={investigationTab !== 'cv'}>
      <InvestigationWorkspace key={incident.incident_id || incident.submitted_asset_id} pairs={evidencePairs} selectedIndex={Math.min(selectedPairIndex, Math.max(0, evidencePairs.length - 1))} onSelect={setSelectedPairIndex} />

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
            <strong>System Sampling Disclosure:</strong> The forensic pipeline evaluates discrete sampled keyframes.
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
                      const foundIdx = evidencePairs.findIndex((p) => p.sourceAssetId === interval.source_asset_id && (
                        interval.evidence_ids.includes(p.evidenceId) || interval.evidence_ids.includes(p.id))
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
            No stored temporal clusters are available. The sampled evidence timeline above remains inspectable; missing clusters do not establish absence of a match.
          </div>
        )}
      </div>

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
              Pipeline roles and recorded model provenance. Missing metadata is not evidence of a successful provider call.
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
                    Recorded CV results
                  </span>
                </td>
              </tr>

              {/* Muse Spark 1.3 */}
              <tr className="hover:bg-[#1a1918] transition-colors">
                <td className="py-2.5 px-3 font-semibold text-[#f4efe6]">Vision Verification</td>
                <td className="py-2.5 px-3 text-[#ded7cb]">Recorded model below</td>
                <td className="py-2.5 px-3 text-teal-400">{Array.from(new Set(evidencePairs.map(p => p.vision?.model_id).filter(Boolean))).join(", ") || "Not recorded"}</td>
                <td className="py-2.5 px-3 text-[#aba497]">Pairwise candidate visual correspondence & contradiction review</td>
                <td className="py-2.5 px-3 text-right">
                  <span className="px-2 py-0.5 rounded text-[9.5px] uppercase font-bold bg-[#1c1b1a] text-teal-400 border border-teal-500/20">
                    {evidencePairs.some(p => p.vision) ? "Vision annotation recorded" : "Not recorded"}
                  </span>
                </td>
              </tr>



              {/* Muse Wonder 1.0 */}
              <tr className="hover:bg-[#1a1918] transition-colors">
                <td className="py-2.5 px-3 font-semibold text-[#f4efe6]">Multimodal Reasoning</td>
                <td className="py-2.5 px-3 text-[#ded7cb]">Recorded model below</td>
                <td className="py-2.5 px-3 text-teal-400">{detailedReport?.model_id || "Not recorded"}</td>
                <td className="py-2.5 px-3 text-[#aba497]">Temporal continuity analysis & evidence-grounded report synthesis</td>
                <td className="py-2.5 px-3 text-right">
                  <span className="px-2 py-0.5 rounded text-[9.5px] uppercase font-bold bg-[#1c1b1a] text-teal-400 border border-teal-500/20">
                    {detailedReport ? detailedReport.ai_synthesized ? "AI synthesis recorded" : "Deterministic report" : "No report loaded"}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Validation Scope Notice */}
        <div className="p-3 bg-[#141312] rounded-xl border border-[rgba(238,231,219,0.06)] text-[10.5px] text-[#8e887d] leading-relaxed">
          <strong className="text-[#ded7cb]">VALIDATION SCOPE NOTICE:</strong> Statuses reflect stored annotations, not a live provider health check.
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
                  onClick={() => setActiveReportTab(tab.id as typeof activeReportTab)}
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

