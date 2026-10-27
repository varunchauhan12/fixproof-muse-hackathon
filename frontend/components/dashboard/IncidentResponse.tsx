"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Layers,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  Search,
  Copy,
  Check,
  Info,
  Cpu,
  Download,
  ShieldCheck,
  FileArchive,
  X,
  Play,
  Pause,
  RotateCcw,
  Sliders,
  SplitSquareVertical,
  Volume2,
  VolumeX,
  ImageOff,
  Upload,
  FileText,
  Database,
  Crosshair,
} from "lucide-react";
import {
  MatchAnalysisResult,
  FrameMatchDetail,
  AssetRecord,
  PackageVerificationResult,
} from "@/lib/types";
import {
  API_BASE,
  getIncidentsList,
  exportIncidentEvidencePackage,
  verifyEvidencePackage,
  getAssetVideoUrl,
  getAssetFrameUrl,
  formatDuration,
} from "@/lib/api";

interface IncidentResponseProps {
  initialIncident?: MatchAnalysisResult | null;
  assets: AssetRecord[];
  onNavigateToVault: (assetId?: string) => void;
  onNavigateToHunter: () => void;
  onNavigateToNemotron?: (incident: MatchAnalysisResult) => void;
}

export const IncidentResponse: React.FC<IncidentResponseProps> = ({
  initialIncident,
  assets,
  onNavigateToVault,
  onNavigateToHunter,
  onNavigateToNemotron,
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

  // Evidence inspection display mode: Side-by-side vs Difference-blend
  const [inspectionMode, setInspectionMode] = useState<"side-by-side" | "difference">("side-by-side");
  const [overlayOpacity, setOverlayOpacity] = useState<number>(50); // 0-100%
  const [blendDifference, setBlendDifference] = useState<boolean>(true);

  // Keyframe sequence ledger filter
  const [keyframeFilter, setKeyframeFilter] = useState<"ALL" | "CONFIRMED" | "HIGH_SIMILARITY">("ALL");

  // Image loading error tracking (prevents broken image icons)
  const [refFrameError, setRefFrameError] = useState<boolean>(false);
  const [suspectFrameError, setSuspectFrameError] = useState<boolean>(false);

  // Evidence Package Export & Verification state
  const [exportingPackage, setExportingPackage] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showVerifyModal, setShowVerifyModal] = useState<boolean>(false);
  const [verifyingPackage, setVerifyingPackage] = useState<boolean>(false);
  const [verificationResult, setVerificationResult] = useState<PackageVerificationResult | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  // Copy feedback state
  const [copiedIncidentId, setCopiedIncidentId] = useState<boolean>(false);

  const handleCopy = async (text: string) => {
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

      setCopiedIncidentId(true);
      setTimeout(() => setCopiedIncidentId(false), 2000);
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

  // Derived matched reference asset ID
  const matchedAssetId =
    selectedFrameMatch?.best_match?.source_asset_id ||
    (selectedIncident?.matched_assets && selectedIncident.matched_assets.length > 0
      ? typeof selectedIncident.matched_assets[0] === "object"
        ? (selectedIncident.matched_assets[0] as any).asset_id
        : String(selectedIncident.matched_assets[0])
      : null);

  const togglePlay = () => {
    if (isPlaying) {
      suspectVideoRef.current?.pause();
      refVideoRef.current?.pause();
      setIsPlaying(false);
    } else {
      suspectVideoRef.current?.play().catch(() => {});
      refVideoRef.current?.play().catch(() => {});
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

  const handleMarkerClick = (fm: FrameMatchDetail) => {
    setSelectedFrameMatch(fm);
    setRefFrameError(false);
    setSuspectFrameError(false);

    // Pause on keyframe selection
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
    setRefFrameError(false);
    setSuspectFrameError(false);

    // Reset video playback states
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
  }, [selectedIncident]);

  // Derive URLs for suspect and reference frames
  const suspectFrameUrl =
    selectedIncident?.investigation_type === "URL_SCREENING"
      ? selectedIncident.suspect_thumbnail_preview_url
        ? `${API_BASE}${selectedIncident.suspect_thumbnail_preview_url}`
        : selectedIncident.thumbnail_url || ""
      : selectedIncident?.submitted_asset_id && selectedFrameMatch?.submitted_frame?.filename
      ? getAssetFrameUrl(selectedIncident.submitted_asset_id, selectedFrameMatch.submitted_frame.filename)
      : "";

  const refFrameUrl =
    selectedFrameMatch?.best_match?.source_asset_id && selectedFrameMatch.best_match.source_filename
      ? getAssetFrameUrl(
          selectedFrameMatch.best_match.source_asset_id,
          selectedFrameMatch.best_match.source_filename
        )
      : "";

  // Filtered keyframes for the forensic sequence ledger
  const filteredKeyframes = (selectedIncident?.frame_matches || []).filter((fm) => {
    if (keyframeFilter === "CONFIRMED") return fm.best_match?.match_confirmed;
    if (keyframeFilter === "HIGH_SIMILARITY") return (fm.best_match?.confidence_score ?? 0) >= 70;
    return true;
  });

  return (
    <div
      style={{
        background: "#121211",
        color: "#ded7cb",
      }}
      className="p-5 md:p-6 max-w-7xl mx-auto space-y-5"
    >
      {/* ─── Compact Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[rgba(238,231,219,0.08)]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-[#eee7db]" />
            <h2 className="text-[18px] font-bold text-[#f4efe6] tracking-tight m-0">
              Incident Response & Evidence
            </h2>
          </div>
          <p className="text-[12px] text-[#aba497] m-0">
            Cryptographic frame matching, synchronized forensic video player, and tamper-evident proof packages.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchIncidents}
            disabled={loading}
            style={{
              border: "1px solid rgba(238, 231, 219, 0.12)",
              background: "#1a1918",
              color: "#ded7cb",
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:text-[#f4efe6] hover:bg-[#242220] text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={12} className={loading ? "animate-spin text-[#eee7db]" : ""} />
            <span>Refresh Incidents</span>
          </button>
        </div>
      </div>

      {incidents.length === 0 && !selectedIncident ? (
        /* Empty State */
        <div
          style={{
            background: "#171615",
            borderRadius: 16,
            border: "1px dashed rgba(238, 231, 219, 0.12)",
          }}
          className="text-center py-16 px-4"
        >
          <ShieldAlert size={36} className="mx-auto text-[#736d62] mb-3" />
          <h3 className="text-[15px] font-bold text-[#f4efe6] m-0">No Recorded Threat Incidents</h3>
          <p className="text-[12px] text-[#aba497] mt-1 max-w-sm mx-auto mb-4">
            Upload a video or screen a URL in Threat Hunter to generate forensic evidence against the reference vault.
          </p>
          <button
            onClick={onNavigateToHunter}
            style={{
              background: "#eee7db",
              color: "#141312",
            }}
            className="px-4 py-2 rounded-xl hover:bg-[#fbf7ef] text-[12px] font-bold inline-flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Search size={13} />
            <span>Launch Threat Hunter Scan</span>
          </button>
        </div>
      ) : (
        /* ─── Two-Column Desktop Layout ─── */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* ─── Left Column: Compact Incident Feed (3 cols) ─── */}
          <div className="lg:col-span-4 xl:col-span-3 space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#aba497]">
                Recorded Scans
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[#1a1918] text-[#aba497] border border-[rgba(238,231,219,0.08)]">
                {incidents.length}
              </span>
            </div>

            <div className="space-y-2 max-h-[720px] overflow-y-auto pr-1">
              {incidents.map((inc, i) => {
                const isSelected = selectedIncident?.incident_id === inc.incident_id;

                return (
                  <div
                    key={inc.incident_id || i}
                    onClick={() => setSelectedIncident(inc)}
                    style={{
                      background: isSelected ? "#242220" : "#171615",
                      border: `1px solid ${
                        isSelected ? "rgba(238, 231, 219, 0.28)" : "rgba(238, 231, 219, 0.08)"
                      }`,
                      cursor: "pointer",
                    }}
                    className="p-3 rounded-xl transition-all hover:bg-[#1e1d1b]"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          style={{
                            background:
                              inc.overall_status === "CANDIDATE_MATCH"
                                ? "rgba(212, 163, 115, 0.15)"
                                : inc.overall_status === "SUSPECT"
                                ? "rgba(212, 163, 115, 0.10)"
                                : "rgba(238, 231, 219, 0.06)",
                            color:
                              inc.overall_status === "CANDIDATE_MATCH"
                                ? "#dfa974"
                                : inc.overall_status === "SUSPECT"
                                ? "#d4a373"
                                : "#ded7cb",
                            border: `1px solid ${
                              inc.overall_status === "CANDIDATE_MATCH"
                                ? "rgba(212, 163, 115, 0.3)"
                                : "rgba(238, 231, 219, 0.1)"
                            }`,
                          }}
                          className="px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider"
                        >
                          {inc.overall_status === "CANDIDATE_MATCH"
                            ? "Candidate Match"
                            : inc.overall_status.replace(/_/g, " ")}
                        </span>
                        {inc.investigation_type === "URL_SCREENING" && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-[#1a1918] text-[#aba497] border border-[rgba(238,231,219,0.08)]">
                            URL
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-[#736d62] font-mono" suppressHydrationWarning>
                        {inc.scanned_at ? new Date(inc.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Recent"}
                      </span>
                    </div>

                    <p className="text-[12.5px] font-semibold text-[#f4efe6] truncate m-0">
                      {inc.suspect_filename || (inc.submitted_asset_id ? `Suspect ${inc.submitted_asset_id.slice(0, 8)}` : "Public Media Stream")}
                    </p>

                    <div className="flex items-center justify-between text-[10.5px] text-[#aba497] mt-2 pt-1.5 border-t border-[rgba(238,231,219,0.06)] font-mono">
                      <span>Sim: <strong className="text-[#ded7cb]">{inc.highest_confidence}%</strong></span>
                      <span>Matches: <strong className="text-[#ded7cb]">{inc.candidate_matches_found}</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─── Main Column: Selected Incident & Evidence Workspace (9 cols) ─── */}
          <div className="lg:col-span-8 xl:col-span-9 space-y-5">
            {selectedIncident ? (
              <>
                {/* ─── A. Incident Dossier Header & Action Toolbar ─── */}
                <div
                  style={{
                    background: "#171615",
                    border: "1px solid rgba(238, 231, 219, 0.08)",
                    borderRadius: 16,
                  }}
                  className="p-4 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#736d62]">
                          Incident Dossier
                        </span>
                        {selectedIncident.investigation_type === "URL_SCREENING" && (
                          <span className="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-[#242220] text-[#aba497] border border-[rgba(238,231,219,0.08)]">
                            Single-Frame Screen
                          </span>
                        )}
                      </div>
                      <h3 className="text-[15px] font-bold text-[#f4efe6] m-0 truncate">
                        {selectedIncident.suspect_filename || selectedIncident.submitted_asset_id || "Unlabeled Suspect"}
                      </h3>
                      {selectedIncident.source_url && (
                        <a
                          href={selectedIncident.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#aba497] hover:text-[#f4efe6] text-[11px] font-mono transition-colors"
                        >
                          <span className="truncate max-w-md">{selectedIncident.source_url}</span>
                          <ExternalLink size={11} className="shrink-0" />
                        </a>
                      )}
                    </div>

                    {/* Integrated Dossier Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        style={{
                          background:
                            selectedIncident.overall_status === "CANDIDATE_MATCH"
                              ? "rgba(212, 163, 115, 0.18)"
                              : selectedIncident.overall_status === "SUSPECT"
                              ? "rgba(212, 163, 115, 0.12)"
                              : "rgba(238, 231, 219, 0.08)",
                          color:
                            selectedIncident.overall_status === "CANDIDATE_MATCH"
                              ? "#dfa974"
                              : selectedIncident.overall_status === "SUSPECT"
                              ? "#d4a373"
                              : "#ded7cb",
                          border: `1px solid ${
                            selectedIncident.overall_status === "CANDIDATE_MATCH"
                              ? "rgba(212, 163, 115, 0.35)"
                              : "rgba(238, 231, 219, 0.12)"
                          }`,
                        }}
                        className="px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-wider"
                      >
                        {selectedIncident.overall_status.replace(/_/g, " ")}
                      </span>

                      {selectedIncident.incident_id && (
                        <button
                          onClick={() => handleCopy(selectedIncident.incident_id!)}
                          title={`Click to copy incident ID: ${selectedIncident.incident_id}`}
                          style={{
                            background: "#242220",
                            border: "1px solid rgba(238, 231, 219, 0.12)",
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[#aba497] hover:text-[#f4efe6] text-[10.5px] font-mono transition-colors cursor-pointer"
                        >
                          {copiedIncidentId ? (
                            <>
                              <Check size={11} className="text-[#eee7db]" />
                              <span className="text-[#eee7db] font-semibold">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy size={11} />
                              <span>{selectedIncident.incident_id.slice(0, 8)}...</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Export Evidence Package ZIP */}
                      <button
                        onClick={handleExportPackage}
                        disabled={exportingPackage}
                        style={{
                          background: "#242220",
                          border: "1px solid rgba(238, 231, 219, 0.12)",
                          color: "#ded7cb",
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:text-[#f4efe6] hover:bg-[#2c2a27] text-[10.5px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                        title="Export cryptographically signed evidence package (ZIP)"
                      >
                        <Download size={11} className={exportingPackage ? "animate-bounce" : ""} />
                        <span>{exportingPackage ? "Exporting..." : "Export ZIP"}</span>
                      </button>

                      {/* Verify Package ZIP */}
                      <button
                        onClick={() => setShowVerifyModal(true)}
                        style={{
                          background: "#242220",
                          border: "1px solid rgba(238, 231, 219, 0.12)",
                          color: "#aba497",
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:text-[#f4efe6] hover:bg-[#2c2a27] text-[10.5px] font-semibold transition-colors cursor-pointer"
                        title="Verify integrity of an evidence package ZIP"
                      >
                        <ShieldCheck size={11} />
                        <span>Verify ZIP</span>
                      </button>

                      {/* Direct Bridge to Nemotron Center */}
                      {onNavigateToNemotron && (
                        <button
                          onClick={() => onNavigateToNemotron(selectedIncident)}
                          style={{
                            background: "#eee7db",
                            color: "#141312",
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg hover:bg-[#fbf7ef] text-[10.5px] font-bold transition-all cursor-pointer shadow-sm ml-1"
                          title="Open this incident in Nemotron Intelligence Center"
                        >
                          <Cpu size={11} />
                          <span>Nemotron Center</span>
                          <ArrowRight size={10} />
                        </button>
                      )}
                    </div>
                  </div>

                  {exportError && (
                    <div className="p-2.5 rounded-lg bg-[#242220] border border-[rgba(212,163,115,0.3)] text-[11px] text-[#dfa974] flex items-center gap-2">
                      <AlertTriangle size={13} className="shrink-0" />
                      <span>{exportError}</span>
                    </div>
                  )}

                  {/* Concise Facts Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] py-2 border-t border-[rgba(238,231,219,0.06)]">
                    <div>
                      <span className="text-[#736d62] text-[10px] block">Analyzed Content</span>
                      <strong className="text-[#f4efe6] font-mono">
                        {selectedIncident.investigation_type === "URL_SCREENING"
                          ? "1 thumbnail"
                          : `${selectedIncident.total_frames_analyzed} frames`}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[#736d62] text-[10px] block">Visual Similarity</span>
                      <strong className="text-[#f4efe6] font-mono">{selectedIncident.highest_confidence}%</strong>
                    </div>
                    <div>
                      <span className="text-[#736d62] text-[10px] block">Lowest L2 Dist</span>
                      <strong className="text-[#f4efe6] font-mono">
                        {selectedIncident.lowest_l2_distance !== null
                          ? selectedIncident.lowest_l2_distance.toFixed(4)
                          : "—"}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[#736d62] text-[10px] block">Matched Reference</span>
                      <strong className="text-[#f4efe6] font-mono">
                        {selectedIncident.matched_assets.length} asset(s)
                      </strong>
                    </div>
                  </div>

                  {selectedIncident.investigation_type === "URL_SCREENING" && (
                    <div className="p-2.5 rounded-lg bg-[#1a1918] border border-[rgba(212,163,115,0.2)] text-[10.5px] text-[#aba497] flex items-center gap-2">
                      <Info size={12} className="text-[#d4a373] shrink-0" />
                      <span>
                        <strong className="text-[#dfa974]">Preliminary Thumbnail Screening:</strong> Single-frame preview evaluated. Underlying third-party stream was not fetched.
                      </span>
                    </div>
                  )}
                </div>

                {/* ─── B. Cohesive Evidence Viewer (Dual Viewport) ─── */}
                <div
                  style={{
                    background: "#171615",
                    border: "1px solid rgba(238, 231, 219, 0.08)",
                    borderRadius: 16,
                  }}
                  className="p-4 md:p-5 space-y-4"
                >
                  {/* Transport & Mode Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[rgba(238,231,219,0.08)]">
                    {/* View mode toggle */}
                    <div className="flex items-center gap-1 p-1 rounded-xl bg-[#1a1918] border border-[rgba(238,231,219,0.08)]">
                      <button
                        onClick={() => setInspectionMode("side-by-side")}
                        style={{
                          background: inspectionMode === "side-by-side" ? "#eee7db" : "transparent",
                          color: inspectionMode === "side-by-side" ? "#141312" : "#aba497",
                        }}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer"
                      >
                        <SplitSquareVertical size={12} />
                        <span>Side-by-Side</span>
                      </button>
                      <button
                        onClick={() => setInspectionMode("difference")}
                        style={{
                          background: inspectionMode === "difference" ? "#eee7db" : "transparent",
                          color: inspectionMode === "difference" ? "#141312" : "#aba497",
                        }}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer"
                      >
                        <Layers size={12} />
                        <span>Difference Blend</span>
                      </button>
                    </div>

                    {/* Synchronized playback controls */}
                    {selectedIncident.investigation_type !== "URL_SCREENING" && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={togglePlay}
                          style={{
                            background: "#242220",
                            border: "1px solid rgba(238, 231, 219, 0.12)",
                            color: "#f4efe6",
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-[#2c2a27] text-[11px] font-bold transition-colors cursor-pointer"
                        >
                          {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                          <span>{isPlaying ? "Pause Sync" : "Play Sync"}</span>
                        </button>

                        <button
                          onClick={handleRestart}
                          style={{
                            background: "#1a1918",
                            border: "1px solid rgba(238, 231, 219, 0.08)",
                            color: "#aba497",
                          }}
                          className="p-1.5 rounded-lg hover:text-[#f4efe6] transition-colors cursor-pointer"
                          title="Restart to beginning"
                        >
                          <RotateCcw size={12} />
                        </button>

                        {/* Speed Selector */}
                        <div className="flex items-center gap-0.5 bg-[#1a1918] p-0.5 rounded-lg border border-[rgba(238,231,219,0.08)]">
                          {[0.5, 1.0, 1.5, 2.0].map((rate) => (
                            <button
                              key={rate}
                              onClick={() => handleRateChange(rate)}
                              style={{
                                background: playbackRate === rate ? "#242220" : "transparent",
                                color: playbackRate === rate ? "#f4efe6" : "#736d62",
                              }}
                              className="px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors cursor-pointer"
                            >
                              {rate}x
                            </button>
                          ))}
                        </div>

                        {/* Audio Mute Toggle */}
                        <button
                          onClick={() => {
                            const newMute = !isMuted;
                            setIsMuted(newMute);
                            if (suspectVideoRef.current) suspectVideoRef.current.muted = newMute;
                            if (refVideoRef.current) refVideoRef.current.muted = newMute;
                          }}
                          style={{
                            background: "#1a1918",
                            border: "1px solid rgba(238, 231, 219, 0.08)",
                            color: isMuted ? "#736d62" : "#f4efe6",
                          }}
                          className="p-1.5 rounded-lg hover:text-[#f4efe6] transition-colors cursor-pointer"
                          title={isMuted ? "Unmute audio" : "Mute audio"}
                        >
                          {isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* ─── Video & Frame Viewports ─── */}
                  {inspectionMode === "side-by-side" ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Left: Suspect Footage / Keyframe */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-[#f4efe6] uppercase tracking-wider flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#d4a373]" />
                            {selectedIncident.investigation_type === "URL_SCREENING"
                              ? "Screened Public Preview"
                              : "Suspect Video Stream"}
                          </span>
                          <span className="text-[#736d62] font-mono text-[10px]">
                            {selectedIncident.investigation_type === "URL_SCREENING"
                              ? (selectedIncident.platform || "Web")
                              : `${formatDuration(suspectCurrentTime)} / ${formatDuration(suspectDuration)}`}
                          </span>
                        </div>

                        <div
                          style={{ background: "#141312", borderRadius: 12 }}
                          className="aspect-video overflow-hidden border border-[rgba(238,231,219,0.1)] flex items-center justify-center relative bg-black"
                        >
                          {selectedIncident.investigation_type === "URL_SCREENING" ? (
                            suspectFrameError || !suspectFrameUrl ? (
                              <div className="flex flex-col items-center justify-center p-4 text-center text-[#736d62]">
                                <ImageOff size={22} className="mb-1" />
                                <span className="text-[11px] font-semibold text-[#aba497]">Preview image unavailable</span>
                              </div>
                            ) : (
                              <img
                                src={suspectFrameUrl}
                                alt="Screened Preview"
                                onError={() => setSuspectFrameError(true)}
                                className="max-h-full max-w-full object-contain"
                              />
                            )
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
                              <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/80 text-[9px] font-mono text-[#eee7db] border border-[rgba(238,231,219,0.12)]">
                                SUSPECT: {suspectCurrentTime.toFixed(2)}s
                              </div>
                            </>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-[#736d62] font-mono px-0.5">
                          <span className="truncate">
                            {selectedFrameMatch?.submitted_frame?.filename || selectedIncident.suspect_filename}
                          </span>
                          <span>Timestamp: {selectedFrameMatch?.submitted_frame?.timestamp_sec ?? 0}s</span>
                        </div>
                      </div>

                      {/* Right: Vaulted Reference Frame / Video */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-[#f4efe6] uppercase tracking-wider flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#eee7db]" />
                            Vaulted Reference Match
                          </span>
                          <span className="text-[#736d62] font-mono text-[10px]">
                            {matchedAssetId
                              ? `ID: ${matchedAssetId.slice(0, 8)}... | ${formatDuration(refCurrentTime)} / ${formatDuration(refDuration)}`
                              : "No Vault Match"}
                          </span>
                        </div>

                        <div
                          style={{ background: "#141312", borderRadius: 12 }}
                          className="aspect-video overflow-hidden border border-[rgba(238,231,219,0.1)] flex items-center justify-center relative bg-black"
                        >
                          {matchedAssetId ? (
                            isPlaying ? (
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
                            ) : refFrameError || !refFrameUrl ? (
                              <div className="flex flex-col items-center justify-center p-6 text-center text-[#8e887d]">
                                <ImageOff size={22} className="mb-1 text-[#736d62]" />
                                <span className="text-[12px] font-bold text-[#f4efe6]">Reference frame unavailable</span>
                                <span className="text-[10px] text-[#736d62] max-w-xs mt-0.5">
                                  Frame image not in local/cloud cache. Forensic similarity metrics remain recorded.
                                </span>
                                {selectedFrameMatch?.best_match?.source_filename && (
                                  <span className="mt-2 text-[9.5px] font-mono bg-[#242220] text-[#aba497] px-2 py-0.5 rounded">
                                    {selectedFrameMatch.best_match.source_filename}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <img
                                src={refFrameUrl}
                                alt="Vaulted Reference Frame"
                                onError={() => setRefFrameError(true)}
                                className="max-h-full max-w-full object-contain"
                              />
                            )
                          ) : (
                            <div className="text-[#736d62] text-[11px] flex flex-col items-center gap-1">
                              <Database size={18} className="text-[#524e47]" />
                              <span>No reference match candidate</span>
                            </div>
                          )}

                          <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/80 text-[9px] font-mono text-[#eee7db] border border-[rgba(238,231,219,0.12)]">
                            REF: {refCurrentTime.toFixed(2)}s
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-[#736d62] font-mono px-0.5">
                          <span className="truncate">
                            {selectedFrameMatch?.best_match?.source_filename || "—"}
                          </span>
                          <span>
                            Source Ts: {selectedFrameMatch?.best_match?.source_timestamp_sec ?? 0}s
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* ─── Difference Blend Overlay Mode ─── */
                    <div className="space-y-3">
                      <div
                        style={{ background: "#141312", borderRadius: 12 }}
                        className="w-full aspect-video max-w-2xl mx-auto overflow-hidden border border-[rgba(238,231,219,0.15)] relative flex items-center justify-center bg-black"
                      >
                        {/* Base Suspect Frame */}
                        {suspectFrameUrl && !suspectFrameError ? (
                          <img
                            src={suspectFrameUrl}
                            alt="Base Suspect"
                            onError={() => setSuspectFrameError(true)}
                            className="absolute inset-0 w-full h-full object-contain"
                          />
                        ) : (
                          <div className="text-[#736d62] text-[11px]">Suspect frame unavailable for overlay</div>
                        )}

                        {/* Top Reference Frame Overlay */}
                        {refFrameUrl && !refFrameError && (
                          <img
                            src={refFrameUrl}
                            alt="Reference Overlay"
                            onError={() => setRefFrameError(true)}
                            style={{
                              opacity: overlayOpacity / 100,
                              mixBlendMode: blendDifference ? "difference" : "normal",
                            }}
                            className="absolute inset-0 w-full h-full object-contain transition-opacity duration-75"
                          />
                        )}

                        <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded bg-black/80 text-[9.5px] font-mono text-[#eee7db] border border-[rgba(238,231,219,0.12)]">
                          Mode: {blendDifference ? "mix-blend-mode: difference" : "Alpha Opacity Blend"} | Opacity: {overlayOpacity}%
                        </div>
                      </div>

                      {/* Blend Slider Controls */}
                      <div className="p-3 bg-[#1a1918] rounded-xl border border-[rgba(238,231,219,0.08)] max-w-2xl mx-auto flex items-center justify-between gap-4 text-[11px]">
                        <div className="flex items-center gap-2 text-[#aba497]">
                          <Sliders size={13} className="text-[#eee7db]" />
                          <span>Overlay Mix:</span>
                          <span className="font-mono text-[#f4efe6]">{overlayOpacity}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={overlayOpacity}
                          onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                          className="flex-1 accent-[#eee7db] cursor-pointer"
                        />
                        <button
                          onClick={() => setBlendDifference(!blendDifference)}
                          style={{
                            background: blendDifference ? "#242220" : "transparent",
                            border: "1px solid rgba(238, 231, 219, 0.12)",
                            color: "#f4efe6",
                          }}
                          className="px-2.5 py-1 rounded text-[10px] font-bold uppercase cursor-pointer"
                        >
                          {blendDifference ? "Difference Mode" : "Normal Blend"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ─── Compact Sampled-Frame Scrubber ─── */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-[10px] font-mono text-[#736d62]">
                      <span className="uppercase font-bold tracking-wider">
                        Sampled Keyframes ({selectedIncident.frame_matches.length})
                      </span>
                      <span>
                        Temporal Offset: {temporalOffset >= 0 ? `+${temporalOffset}` : temporalOffset}s
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5">
                      {selectedIncident.frame_matches.map((fm, idx) => {
                        const isMatch = fm.best_match?.match_confirmed;
                        const isSelectedMarker =
                          selectedFrameMatch?.submitted_frame.timestamp_sec === fm.submitted_frame.timestamp_sec;

                        return (
                          <button
                            key={idx}
                            onClick={() => handleMarkerClick(fm)}
                            style={{
                              background: isSelectedMarker
                                ? "#eee7db"
                                : isMatch
                                ? "#242220"
                                : "#1a1918",
                              color: isSelectedMarker ? "#141312" : isMatch ? "#dfa974" : "#aba497",
                              border: `1px solid ${
                                isSelectedMarker
                                  ? "#eee7db"
                                  : isMatch
                                  ? "rgba(212, 163, 115, 0.3)"
                                  : "rgba(238, 231, 219, 0.08)"
                              }`,
                            }}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-mono shrink-0 transition-all font-semibold cursor-pointer"
                          >
                            <span>{fm.submitted_frame.timestamp_sec}s</span>
                            {isMatch && <span className="ml-1 text-[8.5px]">★</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ─── Compact Forensic Metrics Strip ─── */}
                  {selectedFrameMatch && (
                    <div className="p-3 bg-[#1a1918] rounded-xl border border-[rgba(238,231,219,0.08)] space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                        <div>
                          <span className="text-[#736d62] text-[10px] block">Visual Similarity</span>
                          <strong className="text-[#f4efe6] font-mono">
                            {selectedFrameMatch.best_match?.confidence_score ?? 0}%
                          </strong>
                          <span className="text-[9px] text-[#736d62] block">Feature space metric</span>
                        </div>
                        <div>
                          <span className="text-[#736d62] text-[10px] block">Raw L2 Distance</span>
                          <strong className="text-[#ded7cb] font-mono">
                            {selectedFrameMatch.best_match?.l2_distance !== undefined &&
                            selectedFrameMatch.best_match?.l2_distance !== null
                              ? selectedFrameMatch.best_match.l2_distance.toFixed(4)
                              : "—"}
                          </strong>
                          <span className="text-[9px] text-[#736d62] block">MobileNetV3 vector</span>
                        </div>
                        <div>
                          <span className="text-[#736d62] text-[10px] block">pHash Distance</span>
                          <strong className="text-[#ded7cb] font-mono">
                            {selectedFrameMatch.best_match?.phash_evidence
                              ? `Hamming: ${selectedFrameMatch.best_match.phash_evidence.hamming_distance}`
                              : selectedFrameMatch.best_match?.phash_match
                              ? "Match Confirmed"
                              : "No Match"}
                          </strong>
                          <span className="text-[9px] text-[#736d62] block">Perceptual hash</span>
                        </div>
                        <div>
                          <span className="text-[#736d62] text-[10px] block">Target Vault Asset</span>
                          <strong className="text-[#ded7cb] font-mono truncate block">
                            {selectedFrameMatch.best_match?.source_asset_id
                              ? `${selectedFrameMatch.best_match.source_asset_id.slice(0, 8)}...`
                              : "Unregistered"}
                          </strong>
                          <span className="text-[9px] text-[#736d62] block">
                            {selectedFrameMatch.best_match?.source_filename || "—"}
                          </span>
                        </div>
                      </div>

                      {/* Frame-level Vision Verification Badge (if already evaluated by model) */}
                      {selectedFrameMatch.best_match?.vision_verification && (
                        <div className="pt-2 border-t border-[rgba(238,231,219,0.06)] flex items-start gap-2 text-[10.5px]">
                          <Cpu size={13} className="text-[#eee7db] shrink-0 mt-0.5" />
                          <div className="space-y-0.5 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-[#f4efe6]">
                                Multimodal Vision Verification:
                              </span>
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-[#242220] text-[#eee7db] border border-[rgba(238,231,219,0.12)]">
                                {selectedFrameMatch.best_match.vision_verification.visual_correspondence?.replace(/_/g, " ") || "UNVERIFIED"}
                              </span>
                            </div>
                            {selectedFrameMatch.best_match.vision_verification.reasoning_summary && (
                              <p className="text-[#aba497] m-0 leading-relaxed">
                                {selectedFrameMatch.best_match.vision_verification.reasoning_summary}
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Single Concise Calibration Disclaimer */}
                      <div className="pt-2 border-t border-[rgba(238,231,219,0.06)] flex items-center gap-1.5 text-[9.5px] text-[#736d62]">
                        <Info size={11} className="text-[#aba497] shrink-0" />
                        <span>
                          Calibration Disclosure: Visual similarity and L2 distances are heuristic feature measurements and do not constitute legal proof of infringement. Human review required.
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* ─── C. Forensic Keyframe Sequence & Evidence Integrity Ledger ─── */}
                <div
                  style={{
                    background: "#171615",
                    border: "1px solid rgba(238, 231, 219, 0.08)",
                    borderRadius: 16,
                  }}
                  className="p-4 md:p-5 space-y-4"
                >
                  {/* Sequence Ledger Header & Filter Tabs */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[rgba(238,231,219,0.08)]">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-[#242220] border border-[rgba(238,231,219,0.1)] text-[#eee7db]">
                        <Layers size={16} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-[14px] font-bold text-[#f4efe6] m-0">
                            Forensic Keyframe Sequence & Match Ledger
                          </h4>
                          <span className="px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase tracking-wider bg-[#242220] text-[#aba497] border border-[rgba(238,231,219,0.08)]">
                            {selectedIncident.frame_matches.length} Keyframes
                          </span>
                        </div>
                        <p className="text-[10.5px] text-[#aba497] m-0">
                          Individual sampled frame matches, MobileNetV3 feature vectors, perceptual hash distances, and temporal offsets.
                        </p>
                      </div>
                    </div>

                    {/* Filter Pills */}
                    <div className="flex items-center gap-1 bg-[#1a1918] p-1 rounded-xl border border-[rgba(238,231,219,0.08)] text-[10.5px]">
                      <button
                        onClick={() => setKeyframeFilter("ALL")}
                        style={{
                          background: keyframeFilter === "ALL" ? "#242220" : "transparent",
                          color: keyframeFilter === "ALL" ? "#f4efe6" : "#aba497",
                        }}
                        className="px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer"
                      >
                        All ({selectedIncident.frame_matches.length})
                      </button>
                      <button
                        onClick={() => setKeyframeFilter("CONFIRMED")}
                        style={{
                          background: keyframeFilter === "CONFIRMED" ? "#242220" : "transparent",
                          color: keyframeFilter === "CONFIRMED" ? "#dfa974" : "#aba497",
                        }}
                        className="px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer"
                      >
                        Matches ({selectedIncident.frame_matches.filter((f) => f.best_match?.match_confirmed).length})
                      </button>
                      <button
                        onClick={() => setKeyframeFilter("HIGH_SIMILARITY")}
                        style={{
                          background: keyframeFilter === "HIGH_SIMILARITY" ? "#242220" : "transparent",
                          color: keyframeFilter === "HIGH_SIMILARITY" ? "#f4efe6" : "#aba497",
                        }}
                        className="px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer"
                      >
                        Sim &gt; 70% ({selectedIncident.frame_matches.filter((f) => (f.best_match?.confidence_score ?? 0) >= 70).length})
                      </button>
                    </div>
                  </div>

                  {/* Sequence Table */}
                  {filteredKeyframes.length === 0 ? (
                    <div className="p-8 text-center text-[#736d62] text-[11px] bg-[#1a1918] rounded-xl border border-dashed border-[rgba(238,231,219,0.08)]">
                      No keyframes meet the selected filter criteria.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-[11px] border-collapse">
                        <thead>
                          <tr className="border-b border-[rgba(238,231,219,0.08)] text-[#736d62] text-[10px] uppercase tracking-wider font-mono">
                            <th className="py-2.5 px-3"># / Query Ts</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3">Reference Match</th>
                            <th className="py-2.5 px-3">Ref Ts / Δt</th>
                            <th className="py-2.5 px-3">Visual Sim</th>
                            <th className="py-2.5 px-3">L2 Vector</th>
                            <th className="py-2.5 px-3">pHash</th>
                            <th className="py-2.5 px-3 text-right">Inspect</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[rgba(238,231,219,0.04)] font-mono">
                          {filteredKeyframes.map((fm, idx) => {
                            const isSelected =
                              selectedFrameMatch?.submitted_frame.timestamp_sec === fm.submitted_frame.timestamp_sec;
                            const isMatch = fm.best_match?.match_confirmed;
                            const conf = fm.best_match?.confidence_score ?? 0;
                            const sTs = fm.submitted_frame.timestamp_sec;
                            const rTs = fm.best_match?.source_timestamp_sec ?? 0;
                            const delta = (sTs - rTs).toFixed(2);

                            return (
                              <tr
                                key={idx}
                                onClick={() => handleMarkerClick(fm)}
                                style={{
                                  background: isSelected ? "#242220" : "transparent",
                                }}
                                className="hover:bg-[#1f1e1c] transition-colors cursor-pointer group"
                              >
                                <td className="py-2 px-3 text-[#f4efe6] font-semibold whitespace-nowrap">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[#736d62] text-[10px]">#{String(idx + 1).padStart(2, "0")}</span>
                                    <span>{sTs.toFixed(2)}s</span>
                                  </div>
                                </td>
                                <td className="py-2 px-3 whitespace-nowrap">
                                  <span
                                    style={{
                                      background: isMatch
                                        ? "rgba(212, 163, 115, 0.16)"
                                        : conf >= 65
                                        ? "rgba(212, 163, 115, 0.08)"
                                        : "rgba(238, 231, 219, 0.05)",
                                      color: isMatch ? "#dfa974" : conf >= 65 ? "#d4a373" : "#736d62",
                                      border: `1px solid ${
                                        isMatch
                                          ? "rgba(212, 163, 115, 0.3)"
                                          : "rgba(238, 231, 219, 0.08)"
                                      }`,
                                    }}
                                    className="px-2 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider"
                                  >
                                    {isMatch ? "Match Confirmed" : conf >= 65 ? "Candidate" : "No Match"}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-[#ded7cb] whitespace-nowrap max-w-[140px] truncate">
                                  {fm.best_match?.source_filename || (fm.best_match?.source_asset_id ? `${fm.best_match.source_asset_id.slice(0, 8)}...` : "—")}
                                </td>
                                <td className="py-2 px-3 text-[#aba497] whitespace-nowrap">
                                  {fm.best_match ? (
                                    <span>
                                      {rTs.toFixed(2)}s{" "}
                                      <span className="text-[10px] text-[#736d62]">
                                        (Δ {Number(delta) >= 0 ? `+${delta}` : delta}s)
                                      </span>
                                    </span>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="py-2 px-3 whitespace-nowrap">
                                  <div className="flex items-center gap-2">
                                    <div className="w-14 h-1.5 rounded-full bg-[#242220] overflow-hidden">
                                      <div
                                        style={{ width: `${conf}%` }}
                                        className={`h-full ${
                                          conf >= 80 ? "bg-[#eee7db]" : conf >= 60 ? "bg-[#dfa974]" : "bg-[#736d62]"
                                        }`}
                                      />
                                    </div>
                                    <span className="text-[#f4efe6] font-semibold">{conf}%</span>
                                  </div>
                                </td>
                                <td className="py-2 px-3 text-[#ded7cb] whitespace-nowrap">
                                  {fm.best_match?.l2_distance !== undefined && fm.best_match?.l2_distance !== null
                                    ? fm.best_match.l2_distance.toFixed(4)
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-[#aba497] whitespace-nowrap">
                                  {fm.best_match?.phash_evidence?.hamming_distance !== undefined
                                    ? `Dist: ${fm.best_match.phash_evidence.hamming_distance}`
                                    : fm.best_match?.phash_match
                                    ? "Confirmed"
                                    : "None"}
                                </td>
                                <td className="py-2 px-3 text-right whitespace-nowrap">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMarkerClick(fm);
                                    }}
                                    style={{
                                      background: isSelected ? "#eee7db" : "#242220",
                                      color: isSelected ? "#141312" : "#ded7cb",
                                      border: "1px solid rgba(238, 231, 219, 0.12)",
                                    }}
                                    className="px-2 py-0.5 rounded text-[10px] font-sans font-bold hover:bg-[#eee7db] hover:text-[#141312] transition-colors cursor-pointer"
                                  >
                                    {isSelected ? "Active" : "Inspect"}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* ─── Evidence Package & Proof Package Integrity Section ─── */}
                  <div className="pt-3 border-t border-[rgba(238,231,219,0.06)] grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                    <div className="p-3 bg-[#1a1918] rounded-xl border border-[rgba(238,231,219,0.06)] space-y-2">
                      <div className="flex items-center gap-2 text-[#f4efe6] font-bold">
                        <FileArchive size={14} className="text-[#eee7db]" />
                        <span>Tamper-Evident Evidence Package</span>
                      </div>
                      <p className="text-[#aba497] text-[10.5px] leading-relaxed m-0">
                        Export an Ed25519 digitally signed ZIP containing raw frame matches, MobileNet embeddings, SHA-256 asset checksums, and cryptographic chain-of-custody metadata suitable for courtroom or platform disputes.
                      </p>
                      <div className="pt-1 flex items-center gap-2">
                        <button
                          onClick={handleExportPackage}
                          disabled={exportingPackage}
                          style={{
                            background: "#242220",
                            border: "1px solid rgba(238, 231, 219, 0.12)",
                            color: "#f4efe6",
                          }}
                          className="px-3 py-1.5 rounded-lg hover:bg-[#2c2a27] text-[10.5px] font-bold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          <Download size={11} className={exportingPackage ? "animate-bounce" : ""} />
                          <span>{exportingPackage ? "Packaging..." : "Export ZIP Package"}</span>
                        </button>
                        <button
                          onClick={() => setShowVerifyModal(true)}
                          style={{
                            background: "#1a1918",
                            border: "1px solid rgba(238, 231, 219, 0.12)",
                            color: "#aba497",
                          }}
                          className="px-3 py-1.5 rounded-lg hover:text-[#f4efe6] text-[10.5px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <ShieldCheck size={11} />
                          <span>Verify Archive</span>
                        </button>
                      </div>
                    </div>

                    {/* Bridge to Dedicated Nemotron Intelligence Page */}
                    <div className="p-3 bg-[#1a1918] rounded-xl border border-[rgba(238,231,219,0.06)] space-y-2 flex flex-col justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-[#f4efe6] font-bold">
                          <Cpu size={14} className="text-[#dfa974]" />
                          <span>Legal Synthesis & Commercial Enforcement</span>
                        </div>
                        <p className="text-[#aba497] text-[10.5px] leading-relaxed m-0">
                          Automated reasoning, multi-interval timeline derivation, copyright notice preparation, and revenue-sharing outreach are consolidated exclusively in the Nemotron Intelligence & Action Center.
                        </p>
                      </div>
                      <div className="pt-2">
                        {onNavigateToNemotron ? (
                          <button
                            onClick={() => onNavigateToNemotron(selectedIncident)}
                            style={{
                              background: "#eee7db",
                              color: "#141312",
                            }}
                            className="w-full sm:w-auto px-4 py-1.5 rounded-lg hover:bg-[#fbf7ef] text-[11px] font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
                          >
                            <span>Open in Nemotron Center</span>
                            <ArrowRight size={12} />
                          </button>
                        ) : (
                          <span className="text-[10px] text-[#736d62] font-mono">
                            Navigate to the Nemotron tab from the sidebar.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-[#736d62]">
                Select an incident from the left column to view forensic evidence.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Evidence Package Verification Modal ─── */}
      {showVerifyModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            style={{
              background: "#171615",
              border: "1px solid rgba(238, 231, 219, 0.16)",
              borderRadius: 20,
            }}
            className="w-full max-w-lg p-5 space-y-4 shadow-2xl text-[#ded7cb]"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[rgba(238,231,219,0.08)]">
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-[#eee7db]" />
                <h4 className="text-[14px] font-bold text-[#f4efe6] m-0">
                  Verify Evidence Package (ZIP)
                </h4>
              </div>
              <button
                onClick={() => {
                  setShowVerifyModal(false);
                  setVerificationResult(null);
                  setVerificationError(null);
                }}
                className="text-[#736d62] hover:text-[#f4efe6] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-[11px] text-[#aba497] m-0">
              Upload an exported FixProof evidence package (.zip) to verify its cryptographic SHA-256 manifest and digital signatures.
            </p>

            {/* File Upload Box */}
            <div
              style={{
                border: "1px dashed rgba(238, 231, 219, 0.18)",
                background: "#1a1918",
              }}
              className="p-6 rounded-xl text-center space-y-2 relative"
            >
              <Upload size={24} className="mx-auto text-[#736d62]" />
              <p className="text-[11.5px] font-semibold text-[#f4efe6] m-0">
                Drag and drop package ZIP, or click to browse
              </p>
              <input
                type="file"
                accept=".zip"
                disabled={verifyingPackage}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleVerifyPackage(file);
                }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
            </div>

            {verifyingPackage && (
              <div className="flex items-center justify-center gap-2 text-[11px] text-[#eee7db] py-2">
                <RefreshCw size={12} className="animate-spin" />
                <span>Verifying package cryptographic checksums...</span>
              </div>
            )}

            {verificationError && (
              <div className="p-3 rounded-xl bg-[#242220] border border-[rgba(212,163,115,0.3)] text-[11px] text-[#dfa974] flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{verificationError}</span>
              </div>
            )}

            {verificationResult && (
              <div
                style={{
                  background: "#1a1918",
                  border: `1px solid ${
                    verificationResult.valid ? "rgba(238, 231, 219, 0.2)" : "rgba(212, 163, 115, 0.3)"
                  }`,
                }}
                className="p-3.5 rounded-xl space-y-2 text-[11px]"
              >
                <div className="flex items-center gap-2">
                  {verificationResult.valid ? (
                    <CheckCircle2 size={16} className="text-[#eee7db]" />
                  ) : (
                    <AlertTriangle size={16} className="text-[#dfa974]" />
                  )}
                  <span className="font-bold text-[#f4efe6]">
                    {verificationResult.valid ? "Cryptographically Valid Package" : "Package Integrity Warning"}
                  </span>
                </div>
                <div className="space-y-1 text-[#aba497] font-mono text-[10px]">
                  <div>Verified Incident ID: {verificationResult.incident_id || "Unknown"}</div>
                  <div>Payload Integrity: {verificationResult.payload_integrity_verified ? "Verified" : "Failed"}</div>
                  <div>Signature Verified: {verificationResult.signature_verified ? "Valid" : "Invalid"}</div>
                  <div>Files in Archive: {verificationResult.file_count ?? "—"}</div>
                  {verificationResult.errors.length > 0 && (
                    <div className="text-[#dfa974]">Errors: {verificationResult.errors.join(", ")}</div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => {
                  setShowVerifyModal(false);
                  setVerificationResult(null);
                  setVerificationError(null);
                }}
                style={{
                  background: "#242220",
                  border: "1px solid rgba(238, 231, 219, 0.12)",
                  color: "#f4efe6",
                }}
                className="px-4 py-2 rounded-xl text-[11px] font-bold hover:bg-[#2c2a27] transition-colors cursor-pointer"
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
