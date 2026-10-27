"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  FileVideo,
  Hash,
  Database,
  Search,
  Copy,
  Check,
  BrainCircuit,
  Sparkles,
  AlertCircle,
  Info,
  Cpu,
  History,
  Download,
  ShieldCheck,
  FileArchive,
  X,
} from "lucide-react";
import {
  MatchAnalysisResult,
  FrameMatchDetail,
  AssetRecord,
  InvestigationReport,
  ReportHistoryItem,
  PackageVerificationResult,
  TimelineInterval,
  InvestigationFinding,
  RecommendedAction,
  ConfidenceAssessment,
} from "@/lib/types";
import {
  API_BASE,
  getIncidentsList,
  getIncidentLatestReport,
  getIncidentReportHistory,
  getReportById,
  investigateIncident,
  exportIncidentEvidencePackage,
  verifyEvidencePackage,
} from "@/lib/api";

interface IncidentResponseProps {
  initialIncident?: MatchAnalysisResult | null;
  assets: AssetRecord[];
  onNavigateToVault: (assetId?: string) => void;
  onNavigateToHunter: () => void;
}

export const IncidentResponse: React.FC<IncidentResponseProps> = ({
  initialIncident,
  assets,
  onNavigateToVault,
  onNavigateToHunter,
}) => {
  const [incidents, setIncidents] = useState<MatchAnalysisResult[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<MatchAnalysisResult | null>(
    initialIncident || null
  );
  const [selectedFrameMatch, setSelectedFrameMatch] = useState<FrameMatchDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Nemotron Investigation state
  const [report, setReport] = useState<InvestigationReport | null>(null);
  const [reportLoading, setReportLoading] = useState<boolean>(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Investigation Report History state
  const [reportHistory, setReportHistory] = useState<ReportHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const activeIncidentIdRef = useRef<string | null>(null);

  // Evidence Package Export & Verification state
  const [exportingPackage, setExportingPackage] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showVerifyModal, setShowVerifyModal] = useState<boolean>(false);
  const [verifyingPackage, setVerifyingPackage] = useState<boolean>(false);
  const [verificationResult, setVerificationResult] = useState<PackageVerificationResult | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  // Copy feedback state
  const [copiedIncidentId, setCopiedIncidentId] = useState<boolean>(false);
  const [copiedReportId, setCopiedReportId] = useState<boolean>(false);

  const handleCopy = async (text: string, type: "incident" | "report" | "generic") => {
    if (!text) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== "undefined") {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
      }

      if (type === "incident") {
        setCopiedIncidentId(true);
        setTimeout(() => setCopiedIncidentId(false), 2000);
      } else if (type === "report") {
        setCopiedReportId(true);
        setTimeout(() => setCopiedReportId(false), 2000);
      }
    } catch (err) {
      console.warn("Clipboard copy failed gracefully:", err);
    }
  };

  const fetchIncidents = async () => {
    setLoading(true);
    try {
      const data = await getIncidentsList();
      setIncidents(data);
      if (!selectedIncident && data.length > 0) {
        setSelectedIncident(data[0]);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  // Safe read-only report fetcher for selected incident (does NOT trigger new model investigation)
  const fetchReportForIncident = useCallback(async (incidentId: string) => {
    setReportLoading(true);
    setReportError(null);
    try {
      const existingReport = await getIncidentLatestReport(incidentId);
      if (activeIncidentIdRef.current === incidentId) {
        setReport(existingReport);
      }
    } catch (err: unknown) {
      if (activeIncidentIdRef.current === incidentId) {
        const msg = err instanceof Error ? err.message : "Failed to load investigation report.";
        setReportError(msg);
        setReport(null);
      }
    } finally {
      if (activeIncidentIdRef.current === incidentId) {
        setReportLoading(false);
      }
    }
  }, []);

  // Safe read-only report history fetcher (does NOT trigger new model investigation)
  const fetchHistoryForIncident = useCallback(async (incidentId: string) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const history = await getIncidentReportHistory(incidentId);
      if (activeIncidentIdRef.current === incidentId) {
        setReportHistory(history);
      }
    } catch (err: unknown) {
      if (activeIncidentIdRef.current === incidentId) {
        const msg = err instanceof Error ? err.message : "Failed to load report history.";
        setHistoryError(msg);
        setReportHistory([]);
      }
    } finally {
      if (activeIncidentIdRef.current === incidentId) {
        setHistoryLoading(false);
      }
    }
  }, []);

  // Safe selection of a specific saved report (loads by ID, NEVER triggers model)
  const handleSelectReport = async (reportId: string) => {
    if (!reportId || reportId === report?.report_id) return;
    const currentIncidentId = selectedIncident?.incident_id;
    if (!currentIncidentId) return;

    setReportLoading(true);
    setReportError(null);
    try {
      const loadedReport = await getReportById(reportId);
      if (activeIncidentIdRef.current === currentIncidentId) {
        setReport(loadedReport);
      }
    } catch (err: unknown) {
      if (activeIncidentIdRef.current === currentIncidentId) {
        const msg = err instanceof Error ? err.message : `Failed to load report ${reportId}.`;
        setReportError(msg);
      }
    } finally {
      if (activeIncidentIdRef.current === currentIncidentId) {
        setReportLoading(false);
      }
    }
  };

  // Run Nemotron investigation (user-triggered via button)
  const handleRunInvestigation = async (forceRefresh: boolean = false) => {
    const incidentId = selectedIncident?.incident_id;
    if (!incidentId) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const generatedReport = await investigateIncident(incidentId, {
        force_refresh: forceRefresh,
        model_override: null,
      });
      if (activeIncidentIdRef.current === incidentId) {
        setReport(generatedReport);
        // Refresh history after a successful new investigation
        fetchHistoryForIncident(incidentId);
      }
    } catch (err: unknown) {
      if (activeIncidentIdRef.current === incidentId) {
        const msg = err instanceof Error ? err.message : "Investigation failed to execute.";
        setReportError(msg);
      }
    } finally {
      if (activeIncidentIdRef.current === incidentId) {
        setReportLoading(false);
      }
    }
  };

  // Export cryptographically signed evidence package (ZIP)
  const handleExportPackage = async () => {
    const incidentId = selectedIncident?.incident_id;
    if (!incidentId) return;

    setExportingPackage(true);
    setExportError(null);
    try {
      const { blob, filename } = await exportIncidentEvidencePackage(incidentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to export evidence package.";
      setExportError(msg);
    } finally {
      setExportingPackage(false);
    }
  };

  // Verify an uploaded evidence package ZIP
  const handleVerifyPackage = async (file: File) => {
    if (!file) return;
    setVerifyingPackage(true);
    setVerificationError(null);
    setVerificationResult(null);
    try {
      const result = await verifyEvidencePackage(file);
      setVerificationResult(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Package verification failed to complete.";
      setVerificationError(msg);
    } finally {
      setVerifyingPackage(false);
    }
  };

  useEffect(() => {
    fetchIncidents();
  }, []);

  useEffect(() => {
    if (initialIncident) {
      setSelectedIncident(initialIncident);
    }
  }, [initialIncident]);

  useEffect(() => {
    const incidentId = selectedIncident?.incident_id || null;
    activeIncidentIdRef.current = incidentId;

    if (selectedIncident && selectedIncident.frame_matches.length > 0) {
      const firstWithMatch = selectedIncident.frame_matches.find(
        (f) => f.best_match?.match_confirmed
      );
      setSelectedFrameMatch(firstWithMatch || selectedIncident.frame_matches[0]);
    } else {
      setSelectedFrameMatch(null);
    }

    // Fetch existing report and history when selected incident changes
    if (incidentId) {
      fetchReportForIncident(incidentId);
      fetchHistoryForIncident(incidentId);
    } else {
      setReport(null);
      setReportError(null);
      setReportHistory([]);
      setHistoryError(null);
    }
  }, [selectedIncident, fetchReportForIncident, fetchHistoryForIncident]);

  return (
    <div
      style={{
        background: "#090d16",
        borderRadius: 24,
        border: "1px solid rgba(255, 255, 255, 0.08)",
      }}
      className="p-6 text-slate-100 max-w-7xl mx-auto space-y-6"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-orange-500" />
            <h2 className="text-[17px] font-extrabold text-white m-0">
              Incident Response & Forensic Comparison
            </h2>
          </div>
          <p className="text-[12px] text-slate-400 m-0">
            Side-by-side frame verification, MobileNetV3 cosine distances, and perceptual hash evidence.
          </p>
        </div>

        <button
          onClick={fetchIncidents}
          disabled={loading}
          style={{ border: "1px solid rgba(255, 255, 255, 0.15)" }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 text-[11px] font-semibold transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? "animate-spin-smooth" : ""} />
          <span>Refresh Incidents</span>
        </button>
      </div>

      {incidents.length === 0 && !selectedIncident ? (
        <div
          style={{
            background: "#0f172a",
            borderRadius: 20,
            border: "1px dashed rgba(255, 255, 255, 0.15)",
          }}
          className="text-center py-20 px-4"
        >
          <ShieldAlert size={40} className="mx-auto text-slate-600 mb-3" />
          <h3 className="text-[16px] font-bold text-white m-0">No Threat Incidents Recorded</h3>
          <p className="text-[12px] text-slate-400 mt-1 max-w-sm mx-auto mb-5">
            Launch a suspect video scan in Threat Hunter to generate side-by-side forensic evidence against the reference vault.
          </p>
          <button
            onClick={onNavigateToHunter}
            className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-[12px] font-bold inline-flex items-center gap-2"
          >
            <Search size={14} />
            <span>Launch Threat Hunter Scan</span>
          </button>
        </div>
      ) : (
        /* Investigation Workspace Grid */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Compact Incidents List (4 cols) */}
          <div className="lg:col-span-4 space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">
              Recorded Scans ({incidents.length})
            </h4>

            <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
              {incidents.map((inc, i) => {
                const isSelected = selectedIncident?.incident_id === inc.incident_id;

                return (
                  <div
                    key={inc.incident_id || i}
                    onClick={() => setSelectedIncident(inc)}
                    style={{
                      background: isSelected ? "#1e293b" : "#0f172a",
                      border: `1px solid ${
                        isSelected ? "rgba(249, 115, 22, 0.4)" : "rgba(255, 255, 255, 0.06)"
                      }`,
                      cursor: "pointer",
                    }}
                    className="p-3.5 rounded-xl transition-all hover:bg-slate-800"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          style={{
                            background:
                              inc.overall_status === "CANDIDATE_MATCH"
                                ? "#ef4444"
                                : inc.overall_status === "SUSPECT"
                                ? "#f59e0b"
                                : inc.overall_status === "NO_REFERENCE_DATA"
                                ? "#64748b"
                                : inc.overall_status === "NEEDS_FULL_VIDEO_REVIEW"
                                ? "#3b82f6"
                                : "#0d9488",
                          }}
                          className="px-2 py-0.5 rounded text-[9px] font-extrabold uppercase text-white tracking-wider"
                        >
                          {inc.overall_status.replace(/_/g, " ")}
                        </span>
                        {inc.investigation_type === "URL_SCREENING" && (
                          <span className="px-1.5 py-0.2 rounded text-[8px] font-black uppercase bg-teal-950 text-teal-300 border border-teal-800">
                            URL
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono" suppressHydrationWarning>
                        {inc.scanned_at ? new Date(inc.scanned_at).toLocaleTimeString() : "Recent"}
                      </span>
                    </div>

                    <p className="text-[13px] font-bold text-white truncate m-0">
                      {inc.suspect_filename || `Suspect ${inc.submitted_asset_id?.slice(0, 8)}`}
                    </p>

                    {/* Shortened Incident ID for clear identification */}
                    {inc.incident_id && (
                      <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono mt-1">
                        <Hash size={10} className="text-slate-500 shrink-0" />
                        <span className="text-slate-400 truncate">{inc.incident_id.slice(0, 8)}...</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2">
                      <span>Conf: {inc.highest_confidence}%</span>
                      <span>Matches: {inc.candidate_matches_found}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Forensic Comparison Workspace (8 cols) */}
          <div className="lg:col-span-8 space-y-5">
            {selectedIncident ? (
              <>
                {/* Incident Technical Header */}
                <div
                  style={{
                    background: "#0f172a",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 18,
                  }}
                  className="p-5 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Incident Dossier
                        </span>
                        {selectedIncident.investigation_type === "URL_SCREENING" && (
                          <span className="px-1.5 py-0.2 rounded text-[8px] font-black uppercase bg-teal-950 text-teal-300 border border-teal-800">
                            URL Screening
                          </span>
                        )}
                      </div>
                      <h3 className="text-[16px] font-extrabold text-white m-0">
                        {selectedIncident.suspect_filename || selectedIncident.submitted_asset_id}
                      </h3>
                      {selectedIncident.source_url && (
                        <a
                          href={selectedIncident.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-teal-400 hover:text-teal-300 font-medium text-[11px]"
                        >
                          <span>{selectedIncident.source_url}</span>
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        style={{
                          background:
                            selectedIncident.overall_status === "CANDIDATE_MATCH"
                              ? "rgba(239, 68, 68, 0.2)"
                              : selectedIncident.overall_status === "SUSPECT"
                              ? "rgba(245, 158, 11, 0.2)"
                              : selectedIncident.overall_status === "NO_REFERENCE_DATA"
                              ? "rgba(100, 116, 139, 0.2)"
                              : selectedIncident.overall_status === "NEEDS_FULL_VIDEO_REVIEW"
                              ? "rgba(59, 130, 246, 0.2)"
                              : "rgba(13, 148, 136, 0.2)",
                          color:
                            selectedIncident.overall_status === "CANDIDATE_MATCH"
                              ? "#f87171"
                              : selectedIncident.overall_status === "SUSPECT"
                              ? "#fbbf24"
                              : selectedIncident.overall_status === "NO_REFERENCE_DATA"
                              ? "#cbd5e1"
                              : selectedIncident.overall_status === "NEEDS_FULL_VIDEO_REVIEW"
                              ? "#60a5fa"
                              : "#2dd4bf",
                        }}
                        className="px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wide border border-current/20"
                      >
                        {selectedIncident.overall_status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>

                  {/* Prominent Full Incident ID Pill with Copy Control */}
                  {selectedIncident.incident_id && (
                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700/80 text-[11px] font-mono">
                        <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                          Incident ID:
                        </span>
                        <span className="text-orange-400 font-extrabold select-all tracking-tight">
                          {selectedIncident.incident_id}
                        </span>
                      </div>
                      <button
                        onClick={() => handleCopy(selectedIncident.incident_id!, "incident")}
                        title="Copy full incident ID to clipboard"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold transition-colors border border-slate-700 cursor-pointer"
                      >
                        {copiedIncidentId ? (
                          <>
                            <Check size={13} className="text-emerald-400" />
                            <span className="text-emerald-400 font-bold">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy size={13} />
                            <span>Copy ID</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {selectedIncident.investigation_type === "URL_SCREENING" && (
                    <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 space-y-1">
                      <div className="flex items-center gap-2 font-bold text-[11px] text-amber-300">
                        <ShieldAlert size={14} className="shrink-0" />
                        <span>PRELIMINARY THUMBNAIL SCREENING — NOT FULL VIDEO VERIFICATION</span>
                      </div>
                      <p className="text-[10px] text-amber-200/90 leading-relaxed m-0">
                        {selectedIncident.disclaimer}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] py-2 border-y border-slate-800">
                    <div>
                      <span className="text-slate-500 block">Total Analyzed</span>
                      <strong className="text-white">
                        {selectedIncident.investigation_type === "URL_SCREENING"
                          ? "1 thumbnail"
                          : `${selectedIncident.total_frames_analyzed} frames`}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Highest Confidence</span>
                      <strong className="text-white">{selectedIncident.highest_confidence}%</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Lowest L2 Distance</span>
                      <strong className="text-white">
                        {selectedIncident.lowest_l2_distance !== null
                          ? selectedIncident.lowest_l2_distance.toFixed(4)
                          : "—"}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Matched References</span>
                      <strong className="text-teal-400">
                        {selectedIncident.matched_assets.length} asset(s)
                      </strong>
                    </div>
                  </div>
                </div>

                {/* ─── NEMOTRON AI INVESTIGATION DOSSIER PANEL ─── */}
                <div
                  style={{
                    background: "#0b1220",
                    border: "1px solid rgba(56, 189, 248, 0.22)",
                    borderRadius: 18,
                  }}
                  className="p-5 space-y-4 shadow-xl shadow-cyan-950/20"
                >
                  {/* Panel Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-cyan-950/80 border border-cyan-500/40 text-cyan-400">
                        <BrainCircuit size={18} className={reportLoading ? "animate-pulse" : ""} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-[14px] font-extrabold text-white m-0">
                            Nemotron Forensic Reasoning & Synthesis
                          </h4>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                            NVIDIA 3.5
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 m-0">
                          Evidence-grounded hypothesis testing, interval clustering, and legal triage
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      {report ? (
                        <button
                          onClick={() => handleRunInvestigation(true)}
                          disabled={reportLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-[11px] font-bold transition-all border border-slate-700 disabled:opacity-50 cursor-pointer"
                        >
                          <RefreshCw size={12} className={reportLoading ? "animate-spin-smooth" : ""} />
                          <span>Re-run Investigation</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRunInvestigation(false)}
                          disabled={reportLoading}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white text-[11px] font-extrabold transition-all shadow-md shadow-cyan-900/30 disabled:opacity-50 cursor-pointer"
                        >
                          <Sparkles size={13} className={reportLoading ? "animate-spin-smooth" : ""} />
                          <span>Generate Investigation Report</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Investigation Report History Bar */}
                  <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/90 space-y-2.5">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <History size={14} className="text-cyan-400" />
                        <span className="text-[11px] font-bold text-slate-200">
                          Investigation History
                        </span>
                        {reportHistory.length > 0 && (
                          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-500/30">
                            {reportHistory.length} {reportHistory.length === 1 ? "report" : "reports"}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleExportPackage}
                          disabled={exportingPackage || !selectedIncident?.incident_id}
                          title="Export cryptographically signed evidence package (ZIP with manifest, PDF, hashes & reports)"
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-cyan-950/80 hover:bg-cyan-900/90 text-cyan-200 hover:text-white border border-cyan-500/40 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {exportingPackage ? (
                            <RefreshCw size={11} className="animate-spin-smooth text-cyan-400" />
                          ) : (
                            <Download size={11} className="text-cyan-400" />
                          )}
                          <span>{exportingPackage ? "Exporting..." : "Export Package"}</span>
                        </button>

                        <button
                          onClick={() => setShowVerifyModal(true)}
                          title="Cryptographically verify an exported FixProof package"
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer"
                        >
                          <ShieldCheck size={11} className="text-emerald-400" />
                          <span>Verify Package</span>
                        </button>

                        <button
                          onClick={() => selectedIncident?.incident_id && fetchHistoryForIncident(selectedIncident.incident_id)}
                          disabled={historyLoading}
                          title="Refresh history"
                          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          <RefreshCw size={10} className={historyLoading ? "animate-spin-smooth" : ""} />
                          <span>Refresh</span>
                        </button>
                      </div>
                    </div>

                    {exportError && (
                      <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 text-[10px] flex items-center gap-2">
                        <AlertCircle size={12} className="shrink-0" />
                        <span>{exportError}</span>
                      </div>
                    )}

                    {historyLoading && reportHistory.length === 0 ? (
                      <div className="py-2 text-[11px] text-slate-500 flex items-center gap-2">
                        <RefreshCw size={11} className="animate-spin-smooth text-cyan-400" />
                        <span>Loading report history...</span>
                      </div>
                    ) : historyError && reportHistory.length === 0 ? (
                      <div className="py-1 text-[11px] text-rose-400 flex items-center gap-2">
                        <AlertCircle size={11} />
                        <span>{historyError}</span>
                      </div>
                    ) : reportHistory.length === 0 ? (
                      <p className="text-[11px] text-slate-500 m-0 py-0.5">
                        No previous investigation reports on record for this incident.
                      </p>
                    ) : (
                      <div className="flex items-center gap-2 overflow-x-auto pb-1.5 pt-0.5 scrollbar-thin">
                        {reportHistory.map((item) => {
                          const isSelected = item.report_id === report?.report_id;
                          const timeStr = item.created_at
                            ? new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                            : "N/A";
                          const dateStr = item.created_at
                            ? new Date(item.created_at).toLocaleDateString([], { month: "short", day: "numeric" })
                            : "";

                          return (
                            <button
                              key={item.report_id}
                              onClick={() => handleSelectReport(item.report_id)}
                              disabled={reportLoading}
                              className={`shrink-0 flex items-center gap-2.5 px-3 py-1.5 rounded-lg border text-left transition-all cursor-pointer ${
                                isSelected
                                  ? "bg-cyan-950/70 border-cyan-400 text-cyan-100 shadow-sm shadow-cyan-950/50"
                                  : "bg-slate-900/80 border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white"
                              }`}
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-mono font-bold text-slate-200">
                                    {item.report_id.slice(0, 14)}...
                                  </span>
                                  {isSelected && (
                                    <span className="px-1 py-0.2 rounded text-[8px] font-black uppercase bg-cyan-500 text-slate-950">
                                      Active
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 text-[9px] text-slate-400">
                                  <span>{dateStr} {timeStr}</span>
                                  {item.validation_status && (
                                    <span
                                      className={`px-1 py-0.2 rounded font-bold uppercase ${
                                        item.validation_status === "VALIDATED"
                                          ? "text-emerald-400"
                                          : "text-rose-400"
                                      }`}
                                    >
                                      {item.validation_status === "VALIDATED" ? "VALID" : "WARN"}
                                    </span>
                                  )}
                                  {item.recommended_action && (
                                    <span className="font-semibold text-slate-300">
                                      {item.recommended_action}
                                    </span>
                                  )}
                                  {item.confidence_assessment && (
                                    <span className="font-mono text-cyan-400/90">
                                      {item.confidence_assessment}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* LOADING STATE */}
                  {reportLoading && (
                    <div className="py-10 text-center space-y-3">
                      <div className="inline-flex p-3 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-400 animate-pulse">
                        <BrainCircuit size={28} />
                      </div>
                      <h5 className="text-[13px] font-bold text-white m-0">
                        Analyzing Computer-Vision Evidence via Nemotron 3.5...
                      </h5>
                      <p className="text-[11px] text-slate-400 max-w-md mx-auto leading-relaxed m-0">
                        Clustering frame matches into coherent source timeline intervals, verifying perceptual continuity, and assessing fair use indicators. Deep thinking takes ~20–40s.
                      </p>
                    </div>
                  )}

                  {/* ERROR STATE */}
                  {!reportLoading && reportError && !report && (
                    <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/40 text-rose-200 space-y-2">
                      <div className="flex items-center gap-2 text-[12px] font-bold text-rose-300">
                        <AlertCircle size={15} />
                        <span>Investigation Request Error</span>
                      </div>
                      <p className="text-[11px] text-rose-200/90 leading-relaxed m-0">
                        {reportError}
                      </p>
                      <button
                        onClick={() => handleRunInvestigation(false)}
                        className="px-3 py-1 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-white text-[11px] font-semibold transition-colors border border-rose-700"
                      >
                        Retry Investigation
                      </button>
                    </div>
                  )}

                  {/* EMPTY / UN-INVESTIGATED STATE */}
                  {!reportLoading && !report && !reportError && (
                    <div className="py-8 px-4 text-center rounded-xl bg-slate-900/40 border border-slate-800/80 space-y-3">
                      <div className="w-10 h-10 rounded-full bg-slate-800/80 border border-slate-700/80 flex items-center justify-center mx-auto text-slate-400">
                        <Cpu size={20} />
                      </div>
                      <div className="space-y-1">
                        <h5 className="text-[13px] font-bold text-white m-0">
                          No AI Investigation Report Generated Yet
                        </h5>
                        <p className="text-[11px] text-slate-400 max-w-md mx-auto leading-relaxed m-0">
                          Execute NVIDIA Nemotron 3.5 to synthesize timeline intervals from computer-vision frame matches, assess match continuity, and generate evidence-grounded legal triage findings.
                        </p>
                      </div>
                      <button
                        onClick={() => handleRunInvestigation(false)}
                        className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-extrabold inline-flex items-center gap-2 transition-all shadow-md shadow-cyan-950/40 cursor-pointer"
                      >
                        <Sparkles size={13} />
                        <span>Generate Nemotron Report</span>
                      </button>
                    </div>
                  )}

                  {/* SUCCESS / COMPLETED REPORT STATE */}
                  {!reportLoading && report && (
                    <div className="space-y-4">
                      {/* Report Identifiers Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 rounded-xl bg-slate-900/90 border border-slate-800">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-300">
                            <span className="text-slate-500 font-bold uppercase text-[10px]">
                              Report ID:
                            </span>
                            <span className="text-cyan-300 font-bold select-all">
                              {report.report_id}
                            </span>
                          </div>

                          <button
                            onClick={() => handleCopy(report.report_id, "report")}
                            title="Copy Report ID"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-semibold transition-colors border border-slate-700 cursor-pointer"
                          >
                            {copiedReportId ? (
                              <>
                                <Check size={11} className="text-emerald-400" />
                                <span className="text-emerald-400">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy size={11} />
                                <span>Copy ID</span>
                              </>
                            )}
                          </button>
                        </div>

                        <div className="flex items-center gap-2 text-[10px]">
                          <span
                            className={`px-2 py-0.5 rounded font-extrabold uppercase tracking-wide border ${
                              report.operational_metadata?.validation_status === "VALIDATED"
                                ? "bg-emerald-950/60 text-emerald-300 border-emerald-500/40"
                                : "bg-rose-950/60 text-rose-300 border-rose-500/40"
                            }`}
                          >
                            {report.operational_metadata?.validation_status === "VALIDATED"
                              ? "VALIDATED REPORT"
                              : "FAILED VALIDATION"}
                          </span>

                          <span className="text-slate-400 font-mono">
                            {report.model_id}
                          </span>

                          {report.operational_metadata?.latency_ms ? (
                            <span className="text-slate-500 font-mono">
                              ({(report.operational_metadata.latency_ms / 1000).toFixed(1)}s)
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* Validation Warning Alert if failed */}
                      {report.operational_metadata?.validation_status === "FAILED_VALIDATION" && (
                        <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-500/40 text-rose-200 space-y-1.5">
                          <div className="flex items-center gap-2 text-[11px] font-bold text-rose-300">
                            <AlertCircle size={14} className="shrink-0" />
                            <span>
                              Model Validation Warning: {report.operational_metadata.failure_type || "INCOMPLETE_ANALYSIS"}
                            </span>
                          </div>
                          {report.operational_metadata.errors && report.operational_metadata.errors.length > 0 && (
                            <ul className="list-disc pl-4 text-[10px] text-rose-300/90 space-y-0.5 m-0">
                              {report.operational_metadata.errors.map((err, idx) => (
                                <li key={idx}>{err}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      {/* Triage & Assessment Badges */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {/* Recommended Action */}
                        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                            Recommended Action
                          </span>
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-black uppercase tracking-wide border ${
                              report.recommended_action === "ESCALATE_LEGAL_TAKEDOWN"
                                ? "bg-rose-950 text-rose-300 border-rose-600"
                                : report.recommended_action === "FLAG_FOR_BROKER_LICENSING"
                                ? "bg-purple-950 text-purple-300 border-purple-600"
                                : report.recommended_action === "DISMISS_FAIR_USE"
                                ? "bg-emerald-950 text-emerald-300 border-emerald-600"
                                : report.recommended_action === "MONITOR_ACCOUNT"
                                ? "bg-amber-950 text-amber-300 border-amber-600"
                                : "bg-blue-950 text-blue-300 border-blue-600"
                            }`}
                          >
                            {report.recommended_action ? report.recommended_action.replace(/_/g, " ") : "NEEDS REVIEW"}
                          </span>
                        </div>

                        {/* Confidence Assessment */}
                        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                            Confidence Assessment
                          </span>
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-black uppercase tracking-wide border ${
                              report.confidence_assessment === "HIGH_CONFIDENCE_MATCH"
                                ? "bg-rose-950 text-rose-300 border-rose-600"
                                : report.confidence_assessment === "MODERATE_PROBABILITY"
                                ? "bg-amber-950 text-amber-300 border-amber-600"
                                : report.confidence_assessment === "CONFIRMED_DISTINCT"
                                ? "bg-teal-950 text-teal-300 border-teal-600"
                                : "bg-slate-900 text-slate-300 border-slate-600"
                            }`}
                          >
                            {report.confidence_assessment ? report.confidence_assessment.replace(/_/g, " ") : "INCONCLUSIVE"}
                          </span>
                        </div>

                        {/* Human Review Status */}
                        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                            Human Review Audit
                          </span>
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-black uppercase tracking-wide border ${
                              report.human_review_required
                                ? "bg-amber-950 text-amber-300 border-amber-600"
                                : "bg-emerald-950 text-emerald-300 border-emerald-600"
                            }`}
                          >
                            {report.human_review_required ? "MANDATORY HUMAN AUDIT" : "AUTOMATED PASS"}
                          </span>
                        </div>
                      </div>

                      {/* Executive Forensic Summary */}
                      <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-[12px] text-slate-200 leading-relaxed space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 block">
                          Forensic Synthesis Summary
                        </span>
                        <p className="m-0 text-slate-200">
                          {report.summary || "No narrative summary provided."}
                        </p>
                      </div>

                      {/* Synthesized Timeline Intervals */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            Synthesized Timeline Intervals ({report.timeline_intervals?.length || 0})
                          </span>
                        </div>

                        {!report.timeline_intervals || report.timeline_intervals.length === 0 ? (
                          <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800 text-[11px] text-slate-500">
                            No discrete timeline intervals identified from frame matches.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {report.timeline_intervals.map((itv) => (
                              <div
                                key={itv.interval_id}
                                className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 text-[11px]"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-cyan-300 text-[11px]">
                                      {itv.interval_id}
                                    </span>
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase bg-slate-800 text-slate-300 border border-slate-700">
                                      {itv.continuity_status.replace(/_/g, " ")}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3 text-slate-400 font-mono text-[10px]">
                                    <span>Mean L2: {itv.mean_l2_distance.toFixed(4)}</span>
                                    <span>pHash: {(itv.phash_match_ratio * 100).toFixed(0)}%</span>
                                    <span>{itv.frame_count} frames</span>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] bg-slate-950/60 p-2 rounded-lg font-mono">
                                  <div>
                                    <span className="text-slate-500 block">Suspect Time Range:</span>
                                    <span className="text-white font-bold">
                                      {itv.suspect_start_sec}s → {itv.suspect_end_sec}s ({itv.duration_sec}s)
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500 block">Reference Source Range:</span>
                                    <span className="text-teal-300 font-bold">
                                      {itv.source_start_sec}s → {itv.source_end_sec}s (Asset {itv.source_asset_id.slice(0, 8)}...)
                                    </span>
                                  </div>
                                </div>

                                {itv.evidence_ids && itv.evidence_ids.length > 0 && (
                                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                    <span className="text-[10px] text-slate-500">Frames:</span>
                                    {itv.evidence_ids.map((eid) => (
                                      <span
                                        key={eid}
                                        className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-slate-800 text-slate-300 border border-slate-700"
                                      >
                                        {eid}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Evidence-Grounded Findings */}
                      <div className="space-y-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          Evidence-Grounded Findings ({report.findings?.length || 0})
                        </span>

                        {!report.findings || report.findings.length === 0 ? (
                          <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800 text-[11px] text-slate-500">
                            No discrete narrative findings reported for this incident.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {report.findings.map((finding) => (
                              <div
                                key={finding.finding_id}
                                className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1.5 text-[11px]"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase bg-cyan-950 text-cyan-300 border border-cyan-800">
                                    {finding.category ? finding.category.replace(/_/g, " ") : "FINDING"}
                                  </span>
                                  <span className="text-[10px] text-slate-500 font-mono">
                                    {finding.finding_id}
                                  </span>
                                </div>
                                <p className="text-slate-200 m-0 leading-relaxed text-[11px]">
                                  {finding.statement}
                                </p>
                                {finding.evidence_ids && finding.evidence_ids.length > 0 && (
                                  <div className="flex items-center gap-1 flex-wrap pt-1 text-[10px] text-slate-400">
                                    <span className="text-slate-500 font-semibold">Evidence:</span>
                                    {finding.evidence_ids.map((eid) => (
                                      <span
                                        key={eid}
                                        className="px-1 py-0.2 rounded font-mono bg-slate-800/80 text-cyan-300 border border-slate-700/60"
                                      >
                                        {eid}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Contradictions Detected (if any) */}
                      {report.contradictions_detected && report.contradictions_detected.length > 0 && (
                        <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 space-y-1">
                          <div className="flex items-center gap-2 text-[11px] font-bold text-amber-300">
                            <AlertTriangle size={13} className="shrink-0" />
                            <span>Contradictions & Temporal Anomalies Detected</span>
                          </div>
                          <ul className="list-disc pl-4 text-[10px] text-amber-200/90 space-y-0.5 m-0">
                            {report.contradictions_detected.map((c, idx) => (
                              <li key={idx} className="leading-tight">{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Unresolved Questions & Limitations */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                        {report.unresolved_questions && report.unresolved_questions.length > 0 && (
                          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                              Unresolved Questions ({report.unresolved_questions.length})
                            </span>
                            <ul className="list-disc pl-4 text-[10px] text-slate-400 space-y-1 m-0">
                              {report.unresolved_questions.map((q, idx) => (
                                <li key={idx} className="leading-tight">{q}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {report.limitations_disclosed && report.limitations_disclosed.length > 0 && (
                          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                              Disclosed Scope Limitations ({report.limitations_disclosed.length})
                            </span>
                            <ul className="list-disc pl-4 text-[10px] text-slate-400 space-y-1 m-0">
                              {report.limitations_disclosed.map((lim, idx) => (
                                <li key={idx} className="leading-tight">{lim}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      {/* Telemetry Footer */}
                      <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-500 font-mono pt-2 border-t border-slate-800">
                        <span>Tokens: {report.operational_metadata?.total_tokens || "—"} total</span>
                        <span>Prompt Version: {report.prompt_version || "v1.0"}</span>
                        <span>Created: {report.operational_metadata?.created_at ? new Date(report.operational_metadata.created_at).toLocaleString() : "Recent"}</span>
                      </div>
                    </div>
                  )}

                  {/* MANDATORY LEGAL & FORENSIC DISCLAIMER */}
                  <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/80 text-[10px] text-slate-400 leading-relaxed flex items-start gap-2">
                    <Info size={13} className="text-cyan-400 shrink-0 mt-0.5" />
                    <span>
                      Automated findings represent evidence analysis and correlation, not a legal determination of copyright infringement or fair use. Human review is required before enforcement decisions.
                    </span>
                  </div>
                </div>

                {/* Side-by-Side Visual Evidence Workspace */}
                <div
                  style={{
                    background: "#0f172a",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 18,
                  }}
                  className="p-5"
                >
                  <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-4">
                    Side-by-Side Visual Evidence
                  </h4>

                  {selectedFrameMatch ? (
                    <div className="space-y-4">
                      {/* Image Comparison Box */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Suspect Frame / Thumbnail */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-amber-400 uppercase">
                              {selectedIncident.investigation_type === "URL_SCREENING"
                                ? "Screened Public Thumbnail"
                                : "Suspect Video Frame"}
                            </span>
                            <span className="text-slate-400 font-mono">
                              {selectedIncident.investigation_type === "URL_SCREENING"
                                ? `Platform: ${selectedIncident.platform || "Web"}`
                                : `Timestamp: ${selectedFrameMatch.submitted_frame.timestamp_sec}s`}
                            </span>
                          </div>
                          <div
                            style={{ background: "#000000", borderRadius: 12 }}
                            className="aspect-video overflow-hidden border border-amber-500/30 flex items-center justify-center"
                          >
                            <img
                              src={
                                selectedIncident.investigation_type === "URL_SCREENING"
                                  ? (selectedIncident.suspect_thumbnail_preview_url
                                      ? `${API_BASE}${selectedIncident.suspect_thumbnail_preview_url}`
                                      : selectedIncident.thumbnail_url || "")
                                  : `${API_BASE}/api/vault/assets/${selectedIncident.submitted_asset_id}/frames/${selectedFrameMatch.submitted_frame.filename}`
                              }
                              alt="Suspect frame or thumbnail"
                              className="max-h-full max-w-full object-contain"
                              onError={(e) => {
                                if (selectedIncident.thumbnail_url && (e.target as HTMLElement).getAttribute("src") !== selectedIncident.thumbnail_url) {
                                  (e.target as HTMLImageElement).src = selectedIncident.thumbnail_url;
                                }
                              }}
                            />
                          </div>
                          <p className="text-[10px] text-slate-500 font-mono truncate">
                            {selectedIncident.investigation_type === "URL_SCREENING"
                              ? (selectedIncident.metadata?.title || selectedIncident.suspect_filename)
                              : selectedFrameMatch.submitted_frame.filename}
                          </p>
                        </div>

                        {/* Matched Reference Frame */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-teal-400 uppercase">
                              Vaulted Reference Frame
                            </span>
                            <span className="text-slate-400 font-mono">
                              Timestamp:{" "}
                              {selectedFrameMatch.best_match
                                ? `${selectedFrameMatch.best_match.source_timestamp_sec}s`
                                : "No match"}
                            </span>
                          </div>
                          <div
                            style={{ background: "#000000", borderRadius: 12 }}
                            className="aspect-video overflow-hidden border border-teal-500/30 flex items-center justify-center"
                          >
                            {selectedFrameMatch.best_match?.source_asset_id ? (
                              <img
                                src={`${API_BASE}/api/vault/assets/${selectedFrameMatch.best_match.source_asset_id}/frames/${selectedFrameMatch.best_match.source_filename}`}
                                alt="Matched reference frame"
                                className="max-h-full max-w-full object-contain"
                              />
                            ) : (
                              <div className="text-slate-600 text-[12px]">
                                No reference match candidate
                              </div>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 font-mono truncate">
                            {selectedFrameMatch.best_match?.source_filename || "—"}
                          </p>
                        </div>
                      </div>

                      {/* Technical Scores for this Frame */}
                      {selectedFrameMatch.best_match && (
                        <div
                          style={{ background: "#1e293b", borderRadius: 12 }}
                          className="p-3.5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]"
                        >
                          <div>
                            <span className="text-slate-400 block mb-0.5">L2 Distance</span>
                            <span className="font-mono font-bold text-white text-[13px]">
                              {selectedFrameMatch.best_match.l2_distance.toFixed(4)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block mb-0.5">Confidence Score</span>
                            <span className="font-mono font-bold text-teal-400 text-[13px]">
                              {selectedFrameMatch.best_match.confidence_score}%
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block mb-0.5">pHash Match</span>
                            <span className="font-mono font-bold text-amber-400 text-[13px]">
                              {selectedFrameMatch.best_match.phash_match ? "Confirmed" : "Non-identical"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block mb-0.5">Target Asset</span>
                            <button
                              onClick={() =>
                                onNavigateToVault(selectedFrameMatch.best_match?.source_asset_id)
                              }
                              className="font-mono text-indigo-400 hover:underline truncate block"
                            >
                              {selectedFrameMatch.best_match.source_asset_id.slice(0, 8)}...
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Frame Match Selector Timeline */}
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                          Switch Analyzed Frame ({selectedIncident.frame_matches.length} keyframes)
                        </span>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {selectedIncident.frame_matches.map((fm) => {
                            const isSelected =
                              selectedFrameMatch?.submitted_frame.filename ===
                              fm.submitted_frame.filename;
                            const isConfirmed = fm.best_match?.match_confirmed;

                            return (
                              <button
                                key={fm.submitted_frame.filename}
                                onClick={() => setSelectedFrameMatch(fm)}
                                style={{
                                  border: isSelected
                                    ? "2px solid #f97316"
                                    : `1px solid ${isConfirmed ? "#ef4444" : "#334155"}`,
                                  background: isConfirmed
                                    ? "rgba(239, 68, 68, 0.15)"
                                    : "#1e293b",
                                }}
                                className="px-3 py-1.5 rounded-lg text-left shrink-0 transition-all text-[11px] text-white cursor-pointer"
                              >
                                <span className="font-bold">
                                  {fm.submitted_frame.timestamp_sec}s
                                </span>
                                <span className="block text-[9px] text-slate-400">
                                  {isConfirmed
                                    ? `Match (${fm.best_match?.confidence_score}%)`
                                    : "Clean"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-500 text-[12px]">
                      No frame matches available for this incident.
                    </div>
                  )}
                </div>

                {/* Legal Limitation Notice */}
                <div
                  style={{
                    background: "rgba(148, 163, 184, 0.05)",
                    border: "1px solid rgba(148, 163, 184, 0.15)",
                  }}
                  className="p-3.5 rounded-xl text-[11px] text-slate-400 leading-relaxed"
                >
                  <strong>Disclaimer & Operational Scope:</strong> {selectedIncident.disclaimer}{" "}
                  Similarity scores are generated by vector nearest neighbor search and perceptual hash distance. Review by qualified rights personnel is required before dispatching legal enforcement notices.
                </div>
              </>
            ) : (
              <div className="text-center py-24 text-slate-500 text-[13px]">
                Select an incident on the left to review side-by-side evidence.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cryptographic Package Verification Modal */}
      {showVerifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div
            style={{ background: "#0b1220", border: "1px solid rgba(56, 189, 248, 0.3)" }}
            className="w-full max-w-xl rounded-2xl p-6 shadow-2xl text-slate-100 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-950/80 border border-cyan-500/40 text-cyan-400">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h3 className="text-[14px] font-extrabold text-white m-0">
                    Verify Evidence Package
                  </h3>
                  <p className="text-[11px] text-slate-400 m-0">
                    Ed25519 digital signature, SHA-256 digests, and hash-linked chain of custody
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowVerifyModal(false);
                  setVerificationResult(null);
                  setVerificationError(null);
                }}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Upload Zone */}
            <div className="p-5 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 text-center space-y-2.5">
              <input
                type="file"
                accept=".zip"
                id="verify-package-input"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleVerifyPackage(file);
                }}
              />
              <label
                htmlFor="verify-package-input"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-950/80 hover:bg-cyan-900 text-cyan-200 hover:text-white text-[11px] font-bold cursor-pointer transition-all border border-cyan-500/40 shadow-sm"
              >
                <FileArchive size={14} className="text-cyan-400" />
                <span>Select .zip Evidence Package to Verify</span>
              </label>
              <p className="text-[10px] text-slate-400 m-0">
                Upload a FixProof export ZIP to independently verify manifest signature and file hashes
              </p>
            </div>

            {/* Verifying Indicator */}
            {verifyingPackage && (
              <div className="py-4 text-center space-y-2">
                <RefreshCw size={18} className="animate-spin-smooth text-cyan-400 mx-auto" />
                <p className="text-[11px] text-slate-300 font-medium m-0">
                  Verifying Ed25519 signature, SHA-256 payload hashes, and chain of custody...
                </p>
              </div>
            )}

            {/* Verification Request Error */}
            {verificationError && (
              <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/40 text-rose-200 space-y-1 text-[11px]">
                <div className="font-bold flex items-center gap-1.5 text-rose-300">
                  <AlertCircle size={13} />
                  <span>Verification Request Failed</span>
                </div>
                <p className="m-0 text-rose-200/90">{verificationError}</p>
              </div>
            )}

            {/* Verification Result Card */}
            {verificationResult && (
              <div
                className={`p-4 rounded-xl border space-y-3 ${
                  verificationResult.valid
                    ? "bg-emerald-950/30 border-emerald-500/40"
                    : "bg-rose-950/30 border-rose-500/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {verificationResult.valid ? (
                      <CheckCircle2 size={18} className="text-emerald-400" />
                    ) : (
                      <AlertTriangle size={18} className="text-rose-400" />
                    )}
                    <span
                      className={`text-[12px] font-extrabold uppercase tracking-wide ${
                        verificationResult.valid ? "text-emerald-300" : "text-rose-300"
                      }`}
                    >
                      {verificationResult.valid
                        ? "Cryptographically Verified"
                        : "Verification Failed / Tampered"}
                    </span>
                  </div>
                  {verificationResult.signing_key_id && (
                    <span className="font-mono text-[9px] text-slate-400">
                      {verificationResult.signing_key_id}
                    </span>
                  )}
                </div>

                {/* Sub-checks */}
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                    <div className="text-slate-400">Ed25519 Signature</div>
                    <div
                      className={`font-bold ${
                        verificationResult.signature_verified ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {verificationResult.signature_verified ? "VALID" : "INVALID"}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                    <div className="text-slate-400">SHA-256 Hashes</div>
                    <div
                      className={`font-bold ${
                        verificationResult.payload_integrity_verified ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {verificationResult.payload_integrity_verified ? "MATCH" : "MISMATCH"}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                    <div className="text-slate-400">Chain of Custody</div>
                    <div
                      className={`font-bold ${
                        verificationResult.chain_of_custody_verified ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {verificationResult.chain_of_custody_verified ? "INTACT" : "BROKEN"}
                    </div>
                  </div>
                </div>

                {/* Discrepancy errors */}
                {verificationResult.errors && verificationResult.errors.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-rose-300">Discrepancy Details:</div>
                    <ul className="list-disc pl-4 text-[10px] text-rose-200/90 space-y-0.5 m-0">
                      {verificationResult.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => {
                  setShowVerifyModal(false);
                  setVerificationResult(null);
                  setVerificationError(null);
                }}
                className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-[11px] font-semibold transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
