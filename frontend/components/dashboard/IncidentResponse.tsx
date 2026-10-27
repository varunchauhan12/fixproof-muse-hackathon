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
  Play,
  Pause,
  RotateCcw,
  Sliders,
  Eye,
  SplitSquareVertical,
  Volume2,
  VolumeX,
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
  VisionVerificationResult,
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
  getAssetVideoUrl,
  formatDuration,
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

  // Synchronized Playback state
  const refVideoRef = useRef<HTMLVideoElement | null>(null);
  const suspectVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [suspectCurrentTime, setSuspectCurrentTime] = useState<number>(0);
  const [suspectDuration, setSuspectDuration] = useState<number>(0);
  const [refCurrentTime, setRefCurrentTime] = useState<number>(0);
  const [refDuration, setRefDuration] = useState<number>(0);
  const [temporalOffset, setTemporalOffset] = useState<number>(0); // suspect - ref
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const isSyncingRef = useRef<boolean>(false);

  // Evidence overlay inspection state
  const [overlayMode, setOverlayMode] = useState<"side-by-side" | "difference">("side-by-side");
  const [overlayOpacity, setOverlayOpacity] = useState<number>(50); // 0-100%
  const [blendDifference, setBlendDifference] = useState<boolean>(true);

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

  // Helper to derive matched reference asset ID
  const matchedAssetId =
    selectedFrameMatch?.best_match?.source_asset_id ||
    (selectedIncident?.matched_assets && selectedIncident.matched_assets.length > 0
      ? (typeof selectedIncident.matched_assets[0] === "object"
          ? (selectedIncident.matched_assets[0] as any).asset_id
          : String(selectedIncident.matched_assets[0]))
      : null);

  // Total timeline duration calculation
  const totalTimelineDuration = Math.max(
    selectedIncident?.duration_seconds || 0,
    suspectDuration || 0,
    refDuration || 0,
    selectedIncident?.frame_matches && selectedIncident.frame_matches.length > 0
      ? Math.max(...selectedIncident.frame_matches.map((f) => f.submitted_frame.timestamp_sec)) + 5
      : 10
  );

  const togglePlay = () => {
    if (isPlaying) {
      suspectVideoRef.current?.pause();
      refVideoRef.current?.pause();
      setIsPlaying(false);
    } else {
      if (suspectVideoRef.current) {
        suspectVideoRef.current.play().catch(() => {});
      }
      if (refVideoRef.current) {
        refVideoRef.current.play().catch(() => {});
      }
      setIsPlaying(true);
    }
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (suspectVideoRef.current) suspectVideoRef.current.playbackRate = rate;
    if (refVideoRef.current) refVideoRef.current.playbackRate = rate;
  };

  const handleRestart = () => {
    if (suspectVideoRef.current) suspectVideoRef.current.currentTime = 0;
    const targetRef = Math.max(0, -temporalOffset);
    if (refVideoRef.current) refVideoRef.current.currentTime = targetRef;
    setSuspectCurrentTime(0);
    setRefCurrentTime(targetRef);
  };

  const handleSuspectTimeUpdate = () => {
    if (!suspectVideoRef.current || isSyncingRef.current) return;
    const curTime = suspectVideoRef.current.currentTime;
    setSuspectCurrentTime(curTime);

    // Drift correction on reference follower
    if (refVideoRef.current && isPlaying) {
      const expectedRefTime = Math.max(0, curTime - temporalOffset);
      const actualRefTime = refVideoRef.current.currentTime;
      if (Math.abs(actualRefTime - expectedRefTime) > 0.35) {
        isSyncingRef.current = true;
        refVideoRef.current.currentTime = expectedRefTime;
        setTimeout(() => {
          isSyncingRef.current = false;
        }, 80);
      }
    }
  };

  const handleRefTimeUpdate = () => {
    if (!refVideoRef.current) return;
    setRefCurrentTime(refVideoRef.current.currentTime);
  };

  const handleTimelineScrub = (targetSec: number) => {
    setSuspectCurrentTime(targetSec);
    if (suspectVideoRef.current) {
      suspectVideoRef.current.currentTime = targetSec;
    }
    const targetRef = Math.max(0, targetSec - temporalOffset);
    if (refVideoRef.current) {
      refVideoRef.current.currentTime = targetRef;
      setRefCurrentTime(targetRef);
    }
  };

  const handleMarkerClick = (fm: FrameMatchDetail) => {
    setSelectedFrameMatch(fm);
    // Pause on inspection
    suspectVideoRef.current?.pause();
    refVideoRef.current?.pause();
    setIsPlaying(false);

    const sTs = fm.submitted_frame.timestamp_sec;
    const rTs = fm.best_match?.source_timestamp_sec ?? Math.max(0, sTs - temporalOffset);
    setTemporalOffset(parseFloat((sTs - rTs).toFixed(2)));

    if (suspectVideoRef.current) {
      suspectVideoRef.current.currentTime = sTs;
      setSuspectCurrentTime(sTs);
    }
    if (refVideoRef.current) {
      refVideoRef.current.currentTime = rTs;
      setRefCurrentTime(rTs);
    }
  };

  useEffect(() => {
    const incidentId = selectedIncident?.incident_id || null;
    activeIncidentIdRef.current = incidentId;

    // Reset video playback states when switching incidents
    setIsPlaying(false);
    if (suspectVideoRef.current) {
      suspectVideoRef.current.pause();
      suspectVideoRef.current.currentTime = 0;
    }
    if (refVideoRef.current) {
      refVideoRef.current.pause();
      refVideoRef.current.currentTime = 0;
    }
    setSuspectCurrentTime(0);
    setRefCurrentTime(0);
    setOverlayMode("side-by-side");

    if (selectedIncident && selectedIncident.frame_matches.length > 0) {
      const firstWithMatch = selectedIncident.frame_matches.find(
        (f) => f.best_match?.match_confirmed
      );
      const chosen = firstWithMatch || selectedIncident.frame_matches[0];
      setSelectedFrameMatch(chosen);
      if (chosen.best_match) {
        const sTs = chosen.submitted_frame.timestamp_sec;
        const rTs = chosen.best_match.source_timestamp_sec ?? 0;
        setTemporalOffset(parseFloat((sTs - rTs).toFixed(2)));
      } else {
        setTemporalOffset(0);
      }
    } else {
      setSelectedFrameMatch(null);
      setTemporalOffset(0);
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
        background: "#171615",
        borderRadius: 20,
        border: "1px solid rgba(238, 231, 219, 0.08)",
      }}
      className="p-6 text-[#ded7cb] max-w-7xl mx-auto space-y-6"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-[rgba(238,231,219,0.08)]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-[#d4a373]" />
            <h2 className="text-[17px] font-extrabold text-[#f4efe6] m-0">
              Incident Response & Forensic Comparison
            </h2>
          </div>
          <p className="text-[12px] text-[#8e887d] m-0">
            Side-by-side frame verification, MobileNetV3 cosine distances, and perceptual hash evidence.
          </p>
        </div>

        <button
          onClick={fetchIncidents}
          disabled={loading}
          style={{
            border: "1px solid rgba(238, 231, 219, 0.12)",
            background: "#1e1d1b",
            color: "#ded7cb",
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:text-[#f4efe6] hover:bg-[#262422] text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={12} className={loading ? "animate-spin-smooth text-[#eee7db]" : ""} />
          <span>Refresh Incidents</span>
        </button>
      </div>

      {incidents.length === 0 && !selectedIncident ? (
        <div
          style={{
            background: "#1a1918",
            borderRadius: 20,
            border: "1px dashed rgba(238, 231, 219, 0.12)",
          }}
          className="text-center py-20 px-4"
        >
          <ShieldAlert size={40} className="mx-auto text-[#736d62] mb-3" />
          <h3 className="text-[16px] font-bold text-[#f4efe6] m-0">No Threat Incidents Recorded</h3>
          <p className="text-[12px] text-[#8e887d] mt-1 max-w-sm mx-auto mb-5">
            Launch a suspect video scan in Threat Hunter to generate side-by-side forensic evidence against the reference vault.
          </p>
          <button
            onClick={onNavigateToHunter}
            style={{
              background: "#eee7db",
              color: "#141312",
            }}
            className="px-4 py-2 rounded-xl hover:bg-[#fbf7ef] text-[12px] font-bold inline-flex items-center gap-2 transition-colors cursor-pointer"
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
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#8e887d] mb-3">
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
                      background: isSelected ? "#242220" : "#1a1918",
                      border: `1px solid ${
                        isSelected ? "rgba(238, 231, 219, 0.28)" : "rgba(238, 231, 219, 0.06)"
                      }`,
                      cursor: "pointer",
                    }}
                    className="p-3.5 rounded-xl transition-all hover:bg-[#201f1d]"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          style={{
                            background:
                              inc.overall_status === "CANDIDATE_MATCH"
                                ? "rgba(212, 163, 115, 0.2)"
                                : inc.overall_status === "SUSPECT"
                                ? "rgba(212, 163, 115, 0.12)"
                                : "rgba(238, 231, 219, 0.08)",
                            color:
                              inc.overall_status === "CANDIDATE_MATCH"
                                ? "#dfa974"
                                : inc.overall_status === "SUSPECT"
                                ? "#d4a373"
                                : "#ded7cb",
                            border: `1px solid ${
                              inc.overall_status === "CANDIDATE_MATCH"
                                ? "rgba(212, 163, 115, 0.35)"
                                : "rgba(238, 231, 219, 0.14)"
                            }`,
                          }}
                          className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                        >
                          {inc.overall_status.replace(/_/g, " ")}
                        </span>
                        {inc.investigation_type === "URL_SCREENING" && (
                          <span className="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-[#201f1d] text-[#ded7cb] border border-[rgba(238,231,219,0.12)]">
                            URL
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-[#736d62] font-mono" suppressHydrationWarning>
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
                      <span>Visual Sim: {inc.highest_confidence}%</span>
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
                    background: "#1a1918",
                    border: "1px solid rgba(238, 231, 219, 0.08)",
                    borderRadius: 18,
                  }}
                  className="p-5 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#8e887d]">
                          Incident Dossier
                        </span>
                        {selectedIncident.investigation_type === "URL_SCREENING" && (
                          <span className="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-[#201f1d] text-[#ded7cb] border border-[rgba(238,231,219,0.12)]">
                            URL Screening
                          </span>
                        )}
                      </div>
                      <h3 className="text-[16px] font-extrabold text-[#f4efe6] m-0">
                        {selectedIncident.suspect_filename || selectedIncident.submitted_asset_id}
                      </h3>
                      {selectedIncident.source_url && (
                        <a
                          href={selectedIncident.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-[#ded7cb] hover:text-[#f4efe6] font-medium text-[11px]"
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
                          ? (selectedIncident.evaluated_previews_count && selectedIncident.evaluated_previews_count > 1
                              ? `${selectedIncident.evaluated_previews_count} previews`
                              : "1 thumbnail")
                          : `${selectedIncident.total_frames_analyzed} frames`}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Peak Visual Feature Sim</span>
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
                      <span className="text-[#736d62] block">Matched References</span>
                      <strong className="text-[#f4efe6]">
                        {selectedIncident.matched_assets.length} asset(s)
                      </strong>
                    </div>
                  </div>

                  {/* Calibration Notice in Technical Header */}
                  <div className="p-2.5 rounded-xl bg-[#141312] border border-[rgba(238,231,219,0.08)] text-[10px] text-[#8e887d] leading-relaxed flex items-center gap-2">
                    <Info size={13} className="text-[#d4a373] shrink-0" />
                    <span>
                      <strong className="text-[#d4a373]">Calibration Disclosure:</strong> Visual similarity measurements are not calibrated probabilities of infringement. (Metric: {selectedIncident.score_version || "v1.1-uncalibrated-heuristic"})
                    </span>
                  </div>
                </div>

                {/* ─── NEMOTRON AI INVESTIGATION DOSSIER PANEL ─── */}
                <div
                  style={{
                    background: "#1a1918",
                    border: "1px solid rgba(238, 231, 219, 0.12)",
                    borderRadius: 18,
                  }}
                  className="p-5 space-y-4 shadow-xl shadow-black/40"
                >
                  {/* Panel Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[rgba(238,231,219,0.08)]">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-[#242220] border border-[rgba(238,231,219,0.1)] text-[#eee7db]">
                        <BrainCircuit size={18} className={reportLoading ? "animate-pulse" : ""} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-[14px] font-extrabold text-[#f4efe6] m-0">
                            Nemotron Forensic Reasoning & Synthesis
                          </h4>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-[#242220] text-[#ded7cb] border border-[rgba(238,231,219,0.12)]">
                            NVIDIA 3.5
                          </span>
                        </div>
                        <p className="text-[11px] text-[#8e887d] m-0">
                          Evidence-grounded hypothesis testing, interval clustering, and legal triage
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      {report ? (
                        <button
                          onClick={() => handleRunInvestigation(true)}
                          disabled={reportLoading}
                          style={{
                            background: "#242220",
                            border: "1px solid rgba(238, 231, 219, 0.12)",
                            color: "#ded7cb",
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:text-[#f4efe6] hover:bg-[#2c2a27] text-[11px] font-bold transition-all disabled:opacity-50 cursor-pointer"
                        >
                          <RefreshCw size={12} className={reportLoading ? "animate-spin-smooth text-[#eee7db]" : ""} />
                          <span>Re-run Investigation</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRunInvestigation(false)}
                          disabled={reportLoading}
                          style={{
                            background: "#eee7db",
                            color: "#141312",
                          }}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg hover:bg-[#fbf7ef] text-[11px] font-extrabold transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                        >
                          <Sparkles size={13} className={reportLoading ? "animate-spin-smooth" : ""} />
                          <span>Generate Investigation Report</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Investigation Report History Bar */}
                  <div className="p-3.5 rounded-xl bg-[#141312] border border-[rgba(238,231,219,0.08)] space-y-2.5">
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
                                ? "bg-[#1e1d1b] text-[#ded7cb] border-[rgba(238,231,219,0.15)]"
                                : "bg-[#1a1918] text-[#ded7cb] border-[rgba(238,231,219,0.12)]"
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
                                    <span className="text-[#8e887d] block">Reference Source Range:</span>
                                    <span className="text-[#f4efe6] font-bold">
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

                {/* Synchronized Forensic Video Playback Workspace */}
                <div
                  style={{
                    background: "#0f172a",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 18,
                  }}
                  className="p-5 space-y-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-orange-950/80 border border-orange-500/40 text-orange-400">
                        <FileVideo size={16} />
                      </div>
                      <div>
                        <h4 className="text-[13px] font-extrabold text-white m-0">
                          Synchronized Forensic Video Playback
                        </h4>
                        <p className="text-[10px] text-slate-400 m-0">
                          Side-by-side frame-accurate streaming, master/follower drift compensation, and temporal alignment
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-[10px]">
                      {selectedIncident.investigation_type === "URL_SCREENING" ? (
                        <span className="px-2 py-0.5 rounded font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-500/40">
                          THUMBNAIL-ONLY PREVIEW
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                          <CheckCircle2 size={11} />
                          HTTP 206 RANGE STREAMING
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Dual Video Players */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Vaulted Reference Video Player */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[#f4efe6] uppercase flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#eee7db]" />
                          Vault Reference Footage
                        </span>
                        <span className="text-[#8e887d] font-mono text-[10px]">
                          {matchedAssetId ? (
                            <>
                              ID: {matchedAssetId.slice(0, 8)}... | {formatDuration(refCurrentTime)} / {formatDuration(refDuration)}
                            </>
                          ) : (
                            "No Matched Asset"
                          )}
                        </span>
                      </div>
                      <div
                        style={{ background: "#000000", borderRadius: 12 }}
                        className="aspect-video overflow-hidden border border-[rgba(238,231,219,0.12)] flex items-center justify-center relative bg-black"
                      >
                        {matchedAssetId ? (
                          <video
                            ref={refVideoRef}
                            src={getAssetVideoUrl(matchedAssetId)}
                            className="w-full h-full object-contain"
                            muted={isMuted}
                            playsInline
                            onTimeUpdate={handleRefTimeUpdate}
                            onLoadedMetadata={(e) => {
                              const d = (e.target as HTMLVideoElement).duration;
                              if (!isNaN(d)) setRefDuration(d);
                            }}
                          />
                        ) : (
                          <div className="text-slate-600 text-[12px] flex flex-col items-center gap-1">
                            <Database size={20} className="text-slate-700" />
                            <span>No reference asset selected</span>
                          </div>
                        )}
                        <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[9px] font-mono text-[#f4efe6] border border-[rgba(238,231,219,0.15)]">
                          REF: {refCurrentTime.toFixed(2)}s
                        </div>
                      </div>
                    </div>

                    {/* Suspect Video Player OR URL Screening Preview */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-amber-400 uppercase flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          {selectedIncident.investigation_type === "URL_SCREENING"
                            ? "Screened Public Preview"
                            : "Suspect Video Footage"}
                        </span>
                        <span className="text-slate-400 font-mono text-[10px]">
                          {selectedIncident.investigation_type === "URL_SCREENING" ? (
                            `Platform: ${selectedIncident.platform || "Web"}`
                          ) : (
                            `${formatDuration(suspectCurrentTime)} / ${formatDuration(suspectDuration)}`
                          )}
                        </span>
                      </div>
                      <div
                        style={{ background: "#000000", borderRadius: 12 }}
                        className="aspect-video overflow-hidden border border-amber-500/30 flex items-center justify-center relative bg-black"
                      >
                        {selectedIncident.investigation_type === "URL_SCREENING" ? (
                          <div className="w-full h-full flex flex-col items-center justify-center relative p-3 text-center">
                            <img
                              src={
                                selectedIncident.suspect_thumbnail_preview_url
                                  ? `${API_BASE}${selectedIncident.suspect_thumbnail_preview_url}`
                                  : selectedIncident.thumbnail_url || ""
                              }
                              alt="Screened Public Thumbnail"
                              className="max-h-full max-w-full object-contain"
                              onError={(e) => {
                                if (
                                  selectedIncident.thumbnail_url &&
                                  (e.target as HTMLElement).getAttribute("src") !== selectedIncident.thumbnail_url
                                ) {
                                  (e.target as HTMLImageElement).src = selectedIncident.thumbnail_url;
                                }
                              }}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent flex flex-col justify-end p-3 text-left">
                              <span className="inline-block px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-950/90 text-amber-300 border border-amber-500/40 w-fit mb-1">
                                SINGLE-FRAME PRELIMINARY SCREENING — STREAM NOT DOWNLOADED
                              </span>
                              <p className="text-[10px] text-slate-300 m-0 leading-tight">
                                FixProof bounded screener evaluated publicly exposed preview thumbnails without fetching third-party video streams.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <>
                            <video
                              ref={suspectVideoRef}
                              src={selectedIncident.incident_id ? getAssetVideoUrl(selectedIncident.incident_id) : undefined}
                              className="w-full h-full object-contain"
                              muted={isMuted}
                              playsInline
                              onTimeUpdate={handleSuspectTimeUpdate}
                              onLoadedMetadata={(e) => {
                                const d = (e.target as HTMLVideoElement).duration;
                                if (!isNaN(d)) setSuspectDuration(d);
                              }}
                            />
                            <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[9px] font-mono text-amber-300 border border-amber-500/30">
                              SUSPECT: {suspectCurrentTime.toFixed(2)}s
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Playback Transport & Synchronization Controls */}
                  <div
                    style={{ background: "#1e293b", borderRadius: 14 }}
                    className="p-3 flex flex-wrap items-center justify-between gap-3 text-[11px]"
                  >
                    {/* Left: Play/Pause, Restart, Speeds */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={togglePlay}
                        disabled={selectedIncident.investigation_type === "URL_SCREENING" && !matchedAssetId}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-white transition-all cursor-pointer shadow-sm ${
                          isPlaying
                            ? "bg-amber-600 hover:bg-amber-500"
                            : "bg-orange-600 hover:bg-orange-500"
                        }`}
                      >
                        {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                        <span>{isPlaying ? "Pause" : "Play Synced"}</span>
                      </button>

                      <button
                        onClick={handleRestart}
                        title="Seek both videos to start"
                        className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer border border-slate-700"
                      >
                        <RotateCcw size={13} />
                      </button>

                      <div className="flex items-center bg-slate-900 rounded-lg p-0.5 border border-slate-800 text-[10px]">
                        {[0.5, 1.0, 1.5, 2.0].map((rate) => (
                          <button
                            key={rate}
                            onClick={() => handleRateChange(rate)}
                            className={`px-2 py-1 rounded transition-colors cursor-pointer font-mono ${
                              playbackRate === rate
                                ? "bg-orange-500/30 text-orange-300 font-bold"
                                : "text-slate-400 hover:text-white"
                            }`}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>

                      <button
                        onClick={() => setIsMuted(!isMuted)}
                        title={isMuted ? "Unmute audio" : "Mute audio"}
                        className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer border border-slate-700"
                      >
                        {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                      </button>
                    </div>

                    {/* Middle: Drift Compensation & Offset Adjustment */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800 font-mono text-[11px]">
                        <span className="text-slate-500 font-bold uppercase text-[9px]">Offset (Δt):</span>
                        <button
                          onClick={() => setTemporalOffset((prev) => parseFloat((prev - 0.5).toFixed(2)))}
                          title="Shift reference back 0.5s"
                          className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                        >
                          -0.5s
                        </button>
                        <span className="text-white font-bold px-1">
                          {temporalOffset >= 0 ? `+${temporalOffset.toFixed(2)}s` : `${temporalOffset.toFixed(2)}s`}
                        </span>
                        <button
                          onClick={() => setTemporalOffset((prev) => parseFloat((prev + 0.5).toFixed(2)))}
                          title="Shift reference forward 0.5s"
                          className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                        >
                          +0.5s
                        </button>
                      </div>

                      <span className="text-[10px] text-slate-400 hidden xl:inline-block">
                        Auto drift-correction threshold: <strong className="text-slate-300 font-mono">0.35s</strong>
                      </span>
                    </div>

                    {/* Right: Timecode Readout */}
                    <div className="font-mono text-[11px] text-[#8e887d] flex items-center gap-2">
                      <span className="text-[#d4a373]">S: {suspectCurrentTime.toFixed(2)}s</span>
                      <span className="text-[#5a554c]">|</span>
                      <span className="text-[#f4efe6]">R: {refCurrentTime.toFixed(2)}s</span>
                    </div>
                  </div>

                  {/* Continuous Visual Match Timeline & Scrubber */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                      <span className="font-bold uppercase tracking-wider text-slate-300">
                        Forensic Timeline & Match Markers ({selectedIncident.frame_matches.length} sampled points)
                      </span>
                      <span>
                        Playhead: {suspectCurrentTime.toFixed(2)}s / {totalTimelineDuration.toFixed(1)}s
                      </span>
                    </div>

                    <div className="relative w-full h-10 bg-slate-950 rounded-xl border border-slate-800 overflow-hidden flex items-center px-1">
                      {/* Interval Bands (if investigation report found intervals) */}
                      {report?.timeline_intervals?.map((interval) => {
                        const leftPct = Math.min(100, Math.max(0, (interval.suspect_start_sec / totalTimelineDuration) * 100));
                        const widthPct = Math.min(100 - leftPct, Math.max(2, (interval.duration_sec / totalTimelineDuration) * 100));

                        return (
                          <div
                            key={interval.interval_id}
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                              background: "rgba(249, 115, 22, 0.25)",
                              borderLeft: "2px solid #f97316",
                              borderRight: "2px solid #f97316",
                            }}
                            title={`Interval ${interval.interval_id}: ${interval.duration_sec.toFixed(1)}s (${interval.continuity_status})`}
                            className="absolute top-1 bottom-1 rounded-sm pointer-events-none"
                          />
                        );
                      })}

                      {/* Match Markers */}
                      {selectedIncident.frame_matches.map((fm) => {
                        const ts = fm.submitted_frame.timestamp_sec;
                        const pct = Math.min(99, Math.max(1, (ts / totalTimelineDuration) * 100));
                        const isSelected = selectedFrameMatch?.submitted_frame.filename === fm.submitted_frame.filename;
                        const isConfirmed = fm.best_match?.match_confirmed;
                        const hasCandidate = fm.best_match !== null;

                        return (
                          <button
                            key={fm.submitted_frame.filename}
                            onClick={() => handleMarkerClick(fm)}
                            style={{
                              left: `${pct}%`,
                              transform: "translateX(-50%)",
                            }}
                            title={`Seek ${ts}s | ${isConfirmed ? "Confirmed Match" : hasCandidate ? "Candidate Match" : "Clean Frame"}`}
                            className={`absolute z-10 w-3 h-6 rounded-sm flex items-center justify-center transition-all cursor-pointer ${
                              isSelected
                                ? "bg-orange-500 scale-125 ring-2 ring-white z-20 shadow-lg"
                                : isConfirmed
                                ? "bg-red-500 hover:scale-110"
                                : hasCandidate
                                ? "bg-amber-500/80 hover:scale-110"
                                : "bg-slate-700 hover:bg-slate-600"
                            }`}
                          >
                            <span className="w-1 h-3 bg-white/70 rounded-full" />
                          </button>
                        );
                      })}

                      {/* Continuous Progress Scrubber Input */}
                      <input
                        type="range"
                        min={0}
                        max={totalTimelineDuration || 10}
                        step={0.1}
                        value={suspectCurrentTime}
                        onChange={(e) => handleTimelineScrub(parseFloat(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-30"
                      />

                      {/* Visible Playhead Bar */}
                      <div
                        style={{
                          left: `${Math.min(100, Math.max(0, (suspectCurrentTime / totalTimelineDuration) * 100))}%`,
                        }}
                        className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 z-15 pointer-events-none shadow-[0_0_8px_rgba(34,211,238,0.8)]"
                      />
                    </div>
                  </div>

                  {/* Forensic Frame Inspection & Difference Blend Mode */}
                  <div className="pt-4 border-t border-slate-800 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-300 m-0">
                          Forensic Evidence Frame Inspection
                        </h4>
                        <p className="text-[10px] text-slate-400 m-0">
                          Inspect corresponding keyframes with side-by-side or pixel-difference opacity blend
                        </p>
                      </div>

                      {/* Mode Toggle */}
                      <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-[11px]">
                        <button
                          onClick={() => setOverlayMode("side-by-side")}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                            overlayMode === "side-by-side"
                              ? "bg-slate-800 text-white shadow-sm"
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          <SplitSquareVertical size={13} />
                          <span>Side-by-Side</span>
                        </button>
                        <button
                          onClick={() => setOverlayMode("difference")}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                            overlayMode === "difference"
                              ? "bg-indigo-600 text-white shadow-sm"
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          <Sliders size={13} />
                          <span>Difference Blend Overlay</span>
                        </button>
                      </div>
                    </div>

                    {selectedFrameMatch ? (
                      <div className="space-y-4">
                        {overlayMode === "side-by-side" ? (
                          /* Side-by-Side Comparison Box */
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Suspect Frame / Thumbnail */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="font-bold text-amber-400 uppercase">
                                  {selectedIncident.investigation_type === "URL_SCREENING"
                                    ? "Screened Public Thumbnail"
                                    : "Suspect Video Frame"}
                                </span>
                                <span className="text-slate-400 font-mono text-[10px]">
                                  {selectedIncident.investigation_type === "URL_SCREENING"
                                    ? `Platform: ${selectedIncident.platform || "Web"}`
                                    : `Timestamp: ${selectedFrameMatch.submitted_frame.timestamp_sec}s`}
                                </span>
                              </div>
                              <div
                                style={{ background: "#000000", borderRadius: 12 }}
                                className="aspect-video overflow-hidden border border-amber-500/30 flex items-center justify-center bg-black"
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
                                    if (
                                      selectedIncident.thumbnail_url &&
                                      (e.target as HTMLElement).getAttribute("src") !== selectedIncident.thumbnail_url
                                    ) {
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
                                <span className="font-bold text-[#f4efe6] uppercase">
                                  Vaulted Reference Frame
                                </span>
                                <span className="text-[#8e887d] font-mono text-[10px]">
                                  Timestamp:{" "}
                                  {selectedFrameMatch.best_match
                                    ? `${selectedFrameMatch.best_match.source_timestamp_sec}s`
                                    : "No match"}
                                </span>
                              </div>
                              <div
                                style={{ background: "#000000", borderRadius: 12 }}
                                className="aspect-video overflow-hidden border border-[rgba(238,231,219,0.12)] flex items-center justify-center bg-black"
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
                        ) : (
                          /* Difference Blend Overlay Viewer */
                          <div className="space-y-3">
                            <div
                              style={{ background: "#000000", borderRadius: 12 }}
                              className="w-full aspect-video max-w-2xl mx-auto overflow-hidden border border-indigo-500/40 relative flex items-center justify-center bg-black shadow-2xl"
                            >
                              {/* Base: Suspect Frame */}
                              <img
                                src={
                                  selectedIncident.investigation_type === "URL_SCREENING"
                                    ? (selectedIncident.suspect_thumbnail_preview_url
                                        ? `${API_BASE}${selectedIncident.suspect_thumbnail_preview_url}`
                                        : selectedIncident.thumbnail_url || "")
                                    : `${API_BASE}/api/vault/assets/${selectedIncident.submitted_asset_id}/frames/${selectedFrameMatch.submitted_frame.filename}`
                                }
                                alt="Base Suspect Frame"
                                className="absolute inset-0 w-full h-full object-contain"
                              />

                              {/* Layer 2: Matched Reference Frame with Opacity and Mix-Blend Mode */}
                              {selectedFrameMatch.best_match?.source_asset_id && (
                                <img
                                  src={`${API_BASE}/api/vault/assets/${selectedFrameMatch.best_match.source_asset_id}/frames/${selectedFrameMatch.best_match.source_filename}`}
                                  alt="Reference Overlay Frame"
                                  style={{
                                    opacity: overlayOpacity / 100,
                                    mixBlendMode: blendDifference ? "difference" : "normal",
                                  }}
                                  className="absolute inset-0 w-full h-full object-contain transition-opacity duration-75"
                                />
                              )}

                              <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded-lg bg-black/80 backdrop-blur-sm text-[10px] font-mono text-indigo-300 border border-indigo-500/30">
                                Mode: {blendDifference ? "mix-blend-mode: difference" : "Alpha Opacity Blend"} | Opacity: {overlayOpacity}%
                              </div>
                            </div>

                            {/* Overlay Controls */}
                            <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 max-w-2xl mx-auto space-y-2 text-[11px]">
                              <div className="flex items-center justify-between text-slate-300">
                                <span className="font-semibold flex items-center gap-1.5">
                                  <Sliders size={13} className="text-indigo-400" />
                                  Overlay Balance:
                                </span>
                                <div className="flex items-center gap-3">
                                  <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={blendDifference}
                                      onChange={(e) => setBlendDifference(e.target.checked)}
                                      className="rounded bg-slate-800 text-indigo-500 border-slate-700"
                                    />
                                    <span className="text-[10px]">Difference Mode (Black = Exact Match)</span>
                                  </label>
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className="text-[10px] text-amber-400 font-mono shrink-0">Suspect (0%)</span>
                                <input
                                  type="range"
                                  min={0}
                                  max={100}
                                  value={overlayOpacity}
                                  onChange={(e) => setOverlayOpacity(parseInt(e.target.value))}
                                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                />
                                <span className="text-[10px] text-[#ded7cb] font-mono shrink-0">Reference (100%)</span>
                              </div>
                              <p className="text-[10px] text-slate-400 m-0 leading-tight">
                                In difference blend mode, identical aligned pixels cancel to pure black. Crops, logos, or alterations highlight vividly.
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Technical Evidence & Verification Panel */}
                        {selectedFrameMatch.best_match && (
                          <div className="space-y-3">
                            <div
                              style={{ background: "#1e293b", borderRadius: 12 }}
                              className="p-3.5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]"
                            >
                              <div>
                                <span className="text-slate-400 block mb-0.5">Raw L2 Distance</span>
                                <span className="font-mono font-bold text-white text-[13px]">
                                  {selectedFrameMatch.best_match.l2_distance.toFixed(4)}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-400 block mb-0.5">Visual Feature Sim</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-bold text-[#f4efe6] text-[13px]">
                                    {selectedFrameMatch.best_match.visual_similarity_score !== undefined
                                      ? `${selectedFrameMatch.best_match.visual_similarity_score}%`
                                      : `${selectedFrameMatch.best_match.confidence_score}%`}
                                  </span>
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                                    {selectedFrameMatch.best_match.score_version || "v1.1"}
                                  </span>
                                </div>
                              </div>
                              <div>
                                <span className="text-slate-400 block mb-0.5">pHash Forensic Distance</span>
                                <span className="font-mono font-bold text-amber-400 text-[13px]">
                                  {selectedFrameMatch.best_match.phash_evidence
                                    ? `${selectedFrameMatch.best_match.phash_evidence.hamming_distance}/64 (${selectedFrameMatch.best_match.phash_match ? "Match" : "Diff"})`
                                    : selectedFrameMatch.best_match.phash_match
                                    ? "Match"
                                    : "Non-identical"}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-400 block mb-0.5">Target Vault Asset</span>
                                <button
                                  onClick={() =>
                                    onNavigateToVault(selectedFrameMatch.best_match?.source_asset_id)
                                  }
                                  className="font-mono text-indigo-400 hover:underline truncate block cursor-pointer"
                                >
                                  {selectedFrameMatch.best_match.source_asset_id.slice(0, 8)}...
                                </button>
                              </div>
                            </div>

                            {/* Nemotron Vision Verification Card (Milestone 2.2) */}
                            {selectedFrameMatch.best_match.vision_verification && (
                              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-indigo-500/30 space-y-2.5 text-[11px]">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                                  <div className="flex items-center gap-2">
                                    <Sparkles size={14} className="text-indigo-400" />
                                    <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                                      Nemotron Vision Verification Assessment
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                                        selectedFrameMatch.best_match.vision_verification.visual_correspondence === "HIGH_CORRESPONDENCE"
                                          ? "bg-emerald-950 text-emerald-300 border border-emerald-500/40"
                                          : selectedFrameMatch.best_match.vision_verification.visual_correspondence === "POSSIBLE_REUSE"
                                          ? "bg-amber-950 text-amber-300 border border-amber-500/40"
                                          : selectedFrameMatch.best_match.vision_verification.visual_correspondence === "UNRELATED_SCENE"
                                          ? "bg-rose-950 text-rose-300 border border-rose-500/40"
                                          : "bg-slate-800 text-slate-300"
                                      }`}
                                    >
                                      {selectedFrameMatch.best_match.vision_verification.visual_correspondence?.replace(/_/g, " ") || "UNVERIFIED"}
                                    </span>
                                    <span className="text-[9px] text-slate-400 font-mono">
                                      {selectedFrameMatch.best_match.vision_verification.model_id || "nvidia/Nemotron-3.5-Super-VL"}
                                    </span>
                                    {selectedFrameMatch.best_match.vision_verification.cached && (
                                      <span className="text-[9px] bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 px-1.5 py-0.2 rounded font-mono">
                                        cached
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {selectedFrameMatch.best_match.vision_verification.reasoning_summary && (
                                  <p className="text-slate-300 text-[11px] leading-relaxed m-0">
                                    {selectedFrameMatch.best_match.vision_verification.reasoning_summary}
                                  </p>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-[10px]">
                                  {selectedFrameMatch.best_match.vision_verification.supporting_visible_features &&
                                    selectedFrameMatch.best_match.vision_verification.supporting_visible_features.length > 0 && (
                                      <div className="space-y-1">
                                        <span className="text-emerald-400 font-semibold block">Supporting Scene Elements:</span>
                                        <ul className="list-disc pl-3 text-slate-300 space-y-0.5 m-0">
                                          {selectedFrameMatch.best_match.vision_verification.supporting_visible_features.map((f, i) => (
                                            <li key={i}>{f}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                  {selectedFrameMatch.best_match.vision_verification.contradictions &&
                                    selectedFrameMatch.best_match.vision_verification.contradictions.length > 0 && (
                                      <div className="space-y-1">
                                        <span className="text-rose-400 font-semibold block">Contradictions & Anomalies:</span>
                                        <ul className="list-disc pl-3 text-slate-300 space-y-0.5 m-0">
                                          {selectedFrameMatch.best_match.vision_verification.contradictions.map((c, i) => (
                                            <li key={i}>{c}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                </div>

                                {selectedFrameMatch.best_match.vision_verification.uncertainty_notes && (
                                  <div className="text-[10px] text-slate-400 italic pt-1 border-t border-slate-800">
                                    Uncertainty & Limitations: {selectedFrameMatch.best_match.vision_verification.uncertainty_notes}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* MANDATORY METRIC CALIBRATION NOTICE */}
                            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-[10px] text-slate-400 leading-relaxed flex items-center gap-2">
                              <Info size={13} className="text-amber-400 shrink-0" />
                              <span>
                                <strong className="text-amber-300">Calibration Disclosure:</strong> Visual similarity measurements are not calibrated probabilities of infringement.
                              </span>
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
                                  onClick={() => handleMarkerClick(fm)}
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
                                      ? `Match (${fm.best_match?.visual_similarity_score ?? fm.best_match?.confidence_score}%)`
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
