"use client";

import React, { useState, useRef } from "react";
import {
  Search,
  UploadCloud,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Eye,
  Shield,
  Layers,
  FileVideo,
  ExternalLink,
  Activity,
  Zap,
  ArrowRight,
  Database,
  RefreshCw,
  XCircle,
  Clock,
  ShieldAlert,
  Globe,
  Link as LinkIcon,
  Info,
  ShieldCheck,
} from "lucide-react";
import {
  AssetRecord,
  VaultStatus,
  MatchAnalysisResult,
  ScanLifecycleState,
} from "@/lib/types";
import { scanSuspectVideo, screenSuspectUrl, formatBytes, formatDuration, API_BASE } from "@/lib/api";

interface ThreatHunterProps {
  assets: AssetRecord[];
  vaultStatus: VaultStatus | null;
  onNavigateToVault: () => void;
  onViewIncident: (incident: MatchAnalysisResult) => void;
}

interface ScanEvent {
  id: string;
  timestamp: string;
  type: "info" | "success" | "warning" | "match" | "error";
  text: string;
}

export const ThreatHunter: React.FC<ThreatHunterProps> = ({
  assets,
  vaultStatus,
  onNavigateToVault,
  onViewIncident,
}) => {
  const [submissionMode, setSubmissionMode] = useState<"file" | "url">("file");
  const [suspectFile, setSuspectFile] = useState<File | null>(null);
  const [suspectUrl, setSuspectUrl] = useState<string>("");
  const [scanState, setScanState] = useState<ScanLifecycleState>("idle");
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [scanError, setScanError] = useState<string>("");
  const [scanResult, setScanResult] = useState<MatchAnalysisResult | null>(null);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const indexedAssetsCount = assets.filter((a) => a.indexed).length;
  const isVaultReady = (vaultStatus?.vault_size ?? 0) > 0 && indexedAssetsCount > 0;

  const isScanActive =
    scanState === "uploading" ||
    scanState === "processing" ||
    scanState === "matching" ||
    scanState === "finalizing";

  const addEvent = (type: ScanEvent["type"], text: string) => {
    const newEvent: ScanEvent = {
      id: Math.random().toString(36).substring(2),
      timestamp: new Date().toLocaleTimeString(),
      type,
      text,
    };
    setEvents((prev) => [newEvent, ...prev]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isScanActive) return; // Prevent file change while scan is active

    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSuspectFile(file);
      // Immediately clear any previous scan results or errors to prevent stale output
      setScanResult(null);
      setScanError("");
      setScanState("idle");
      setUploadProgress(0);
    }
  };

  const handleStartScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspectFile || isScanActive) return;

    // Reset scan state completely before launching
    setScanResult(null);
    setScanError("");
    setEvents([]);
    setUploadProgress(0);
    setScanState("uploading");

    addEvent(
      "info",
      `Initiated forensic investigation for: ${suspectFile.name} (${formatBytes(suspectFile.size)})`
    );

    try {
      const result = await scanSuspectVideo(suspectFile, (progress) => {
        setUploadProgress(progress);
        if (progress >= 100) {
          setScanState("processing");
          addEvent("info", "Upload complete (100%). Server decoding stream and extracting frames...");
        }
      });

      // Scan completed successfully
      setScanState("completed");
      setScanResult(result);

      if (result.overall_status === "CANDIDATE_MATCH") {
        addEvent(
          "match",
          `⚠️ Confirmed ${result.candidate_matches_found} candidate visual match(es) with highest confidence of ${result.highest_confidence}% (Lowest L2: ${result.lowest_l2_distance?.toFixed(4)})`
        );
      } else if (result.overall_status === "SUSPECT") {
        addEvent(
          "warning",
          `Visual proximity match detected (${result.highest_confidence}% confidence, Lowest L2: ${result.lowest_l2_distance?.toFixed(4)})`
        );
      } else if (result.overall_status === "NO_REFERENCE_DATA") {
        addEvent(
          "warning",
          "Reference vault is empty. No reference vectors were available for comparison."
        );
      } else {
        addEvent(
          "success",
          `Forensic investigation complete: CLEAN. No visual matches found across ${result.total_frames_analyzed} frames.`
        );
      }

      addEvent(
        "info",
        `Forensic dossier recorded with incident ID: ${result.incident_id || "registered"}`
      );
    } catch (err: any) {
      // Scan failed
      const errorMessage =
        err?.message || "Threat scan failed. Check if the FixProof backend is running.";
      setScanState("failed");
      setScanError(errorMessage);
      setScanResult(null);
      addEvent("error", `Investigation failed: ${errorMessage}`);
    }
  };

  const handleStartUrlScreen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspectUrl.trim() || isScanActive) return;

    setScanResult(null);
    setScanError("");
    setEvents([]);
    setUploadProgress(0);
    setScanState("processing");

    addEvent("info", `Initiated public URL preliminary screening: ${suspectUrl.trim()}`);
    addEvent("info", "Executing SSRF defense checks and querying public video metadata...");

    try {
      const result = await screenSuspectUrl(suspectUrl.trim());
      setScanState("completed");
      setScanResult(result);

      if (result.overall_status === "CANDIDATE_MATCH") {
        addEvent(
          "match",
          `⚠️ Confirmed preliminary candidate match on thumbnail with ${result.highest_confidence}% confidence (Lowest L2: ${result.lowest_l2_distance?.toFixed(4)})`
        );
      } else if (result.overall_status === "SUSPECT") {
        addEvent(
          "warning",
          `Thumbnail visual proximity match detected (${result.highest_confidence}% confidence, Lowest L2: ${result.lowest_l2_distance?.toFixed(4)})`
        );
      } else if (result.overall_status === "NO_REFERENCE_DATA") {
        addEvent(
          "warning",
          "Reference vault is empty. No reference vectors were available for comparison."
        );
      } else {
        addEvent(
          "info",
          "No visual match detected on thumbnail image. Overall status: NEEDS_FULL_VIDEO_REVIEW."
        );
      }

      addEvent(
        "info",
        `Screening dossier recorded with incident ID: ${result.incident_id || "registered"}`
      );
    } catch (err: any) {
      const errorMessage =
        err?.message || "URL screening failed. Check if the FixProof backend is running.";
      setScanState("failed");
      setScanError(errorMessage);
      setScanResult(null);
      addEvent("error", `Screening failed: ${errorMessage}`);
    }
  };

  const handleResetScan = () => {
    setScanState("idle");
    setScanError("");
    setScanResult(null);
    setUploadProgress(0);
  };

  return (
    <div
      style={{
        background: "#090d16",
        borderRadius: 24,
        border: "1px solid rgba(255, 255, 255, 0.08)",
      }}
      className="p-6 text-slate-100 max-w-7xl mx-auto space-y-6"
    >
      {/* ─── Top Operational Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`w-2 h-2 rounded-full ${
                isScanActive
                  ? "bg-amber-400 animate-ping"
                  : scanState === "completed"
                  ? "bg-teal-400"
                  : "bg-amber-500"
              }`}
            />
            <h2 className="text-[17px] font-extrabold text-white m-0">
              Sentinel Threat Hunter
            </h2>
          </div>
          <p className="text-[12px] text-slate-400 m-0">
            Automated visual similarity & perceptual hash forensics against official vault.
          </p>
        </div>

        {/* Vault Status Indicator */}
        <div
          style={{
            background: isVaultReady ? "rgba(13, 148, 136, 0.12)" : "rgba(245, 158, 11, 0.12)",
            border: `1px solid ${
              isVaultReady ? "rgba(13, 148, 136, 0.3)" : "rgba(245, 158, 11, 0.3)"
            }`,
            color: isVaultReady ? "#2dd4bf" : "#fbbf24",
          }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[12px] font-bold"
        >
          <Database size={14} />
          <span>
            {isVaultReady
              ? `Targeting ${vaultStatus?.vault_size} vectors across ${indexedAssetsCount} registered assets`
              : "Vault is empty — Please register official footage"}
          </span>
        </div>
      </div>

      {/* Vault Empty Callout */}
      {!isVaultReady && (
        <div
          style={{
            background: "rgba(245, 158, 11, 0.08)",
            border: "1px solid rgba(245, 158, 11, 0.25)",
          }}
          className="p-4 rounded-xl flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-amber-400 shrink-0" size={20} />
            <p className="text-[12px] text-amber-200 m-0">
              No official reference videos have been indexed into the FAISS vault yet. Threat Hunter needs at least one registered reference asset to compare suspect video against.
            </p>
          </div>
          <button
            onClick={onNavigateToVault}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-[11px] font-extrabold shrink-0 transition-colors"
          >
            <span>Go to Asset Vault</span>
            <ArrowRight size={12} />
          </button>
        </div>
      )}

      {/* ─── Suspect Video / URL Submission Control ─── */}
      <div
        style={{
          background: "#0f172a",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 18,
        }}
        className="p-5 space-y-4"
      >
        {/* Mode Selector Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2 p-1 rounded-xl bg-slate-900 border border-slate-800">
            <button
              type="button"
              onClick={() => {
                if (isScanActive) return;
                setSubmissionMode("file");
                handleResetScan();
              }}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[12px] font-bold transition-all ${
                submissionMode === "file"
                  ? "bg-amber-500 text-slate-950 shadow-md font-extrabold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <UploadCloud size={14} />
              <span>Upload Video File</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (isScanActive) return;
                setSubmissionMode("url");
                handleResetScan();
              }}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[12px] font-bold transition-all ${
                submissionMode === "url"
                  ? "bg-teal-500 text-slate-950 shadow-md font-extrabold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Globe size={14} />
              <span>Screen Public Video URL</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-teal-950 text-teal-300">
                MediaGuard
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            {submissionMode === "file" ? (
              <span>Full temporal frame scan (.mp4, .mov, .avi, .mkv, .webm, .m4v, .flv, .wmv, .ts)</span>
            ) : (
              <span className="text-teal-400/90 font-medium">
                Public thumbnail screening • Zero stream downloads
              </span>
            )}
          </div>
        </div>

        {/* File Upload Mode */}
        {submissionMode === "file" ? (
          <div>
            <h3 className="text-[13px] font-bold uppercase tracking-wider text-slate-400 mb-3">
              Submit Suspect Video File For Forensic Scanning
            </h3>

            <form onSubmit={handleStartScan} className="flex flex-col sm:flex-row gap-3">
              <div
                onClick={() => {
                  if (!isScanActive) fileInputRef.current?.click();
                }}
                style={{
                  border: suspectFile
                    ? "1px solid #f59e0b"
                    : "1px dashed rgba(255, 255, 255, 0.2)",
                  background: "#1e293b",
                  cursor: isScanActive ? "not-allowed" : "pointer",
                  opacity: isScanActive ? 0.7 : 1,
                }}
                className="flex-1 px-4 py-3 rounded-xl flex items-center gap-3 transition-colors"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp4,.mov,.avi,.mkv,.webm,.m4v,.flv,.wmv,.ts,.3gp,.ogg,.ogv,video/*"
                  onChange={handleFileChange}
                  disabled={isScanActive}
                  className="hidden"
                />
                <FileVideo size={20} className={suspectFile ? "text-amber-400" : "text-slate-400"} />
                <span className="text-[12px] text-slate-200 truncate font-medium">
                  {suspectFile
                    ? `${suspectFile.name} (${formatBytes(suspectFile.size)})`
                    : "Select suspect video to inspect..."}
                </span>
              </div>

              <button
                type="submit"
                disabled={!suspectFile || isScanActive}
                style={{
                  background:
                    !suspectFile || isScanActive
                      ? "rgba(255, 255, 255, 0.1)"
                      : "linear-gradient(135deg, #f59e0b, #d97706)",
                  boxShadow: !suspectFile || isScanActive ? "none" : "0 0 20px rgba(245, 158, 11, 0.3)",
                }}
                className="px-6 py-3 rounded-xl font-bold text-[13px] text-white flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed disabled:text-slate-500 transition-all shrink-0"
              >
                {isScanActive ? (
                  <>
                    <Loader2 size={15} className="animate-spin-smooth" />
                    <span>
                      {scanState === "uploading"
                        ? `Uploading (${uploadProgress}%)...`
                        : "Investigating..."}
                    </span>
                  </>
                ) : (
                  <>
                    <Search size={15} />
                    <span>Launch Scan</span>
                  </>
                )}
              </button>
            </form>
          </div>
        ) : (
          /* URL Screening Mode */
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="text-[13px] font-bold uppercase tracking-wider text-slate-400 m-0">
                Screen Public Video URL (Preliminary Thumbnail Check)
              </h3>
              <div className="flex items-center gap-1.5 flex-wrap">
                {["YouTube", "Vimeo", "Twitch", "Dailymotion"].map((plat) => (
                  <span
                    key={plat}
                    className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-800 text-slate-300 border border-slate-700"
                  >
                    {plat}
                  </span>
                ))}
              </div>
            </div>

            <form onSubmit={handleStartUrlScreen} className="flex flex-col sm:flex-row gap-3">
              <div
                style={{
                  border: suspectUrl.trim()
                    ? "1px solid #14b8a6"
                    : "1px solid rgba(255, 255, 255, 0.15)",
                  background: "#1e293b",
                }}
                className="flex-1 px-4 py-2.5 rounded-xl flex items-center gap-3 transition-colors"
              >
                <LinkIcon size={18} className={suspectUrl.trim() ? "text-teal-400" : "text-slate-400"} />
                <input
                  type="url"
                  value={suspectUrl}
                  onChange={(e) => {
                    setSuspectUrl(e.target.value);
                    if (scanError) setScanError("");
                  }}
                  disabled={isScanActive}
                  placeholder="Paste public video URL, e.g. https://www.youtube.com/watch?v=... or https://vimeo.com/..."
                  className="w-full bg-transparent border-none text-[13px] text-white placeholder-slate-500 focus:outline-none"
                />
                {suspectUrl && !isScanActive && (
                  <button
                    type="button"
                    onClick={() => setSuspectUrl("")}
                    className="text-slate-400 hover:text-white"
                  >
                    <XCircle size={16} />
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={!suspectUrl.trim() || isScanActive}
                style={{
                  background:
                    !suspectUrl.trim() || isScanActive
                      ? "rgba(255, 255, 255, 0.1)"
                      : "linear-gradient(135deg, #0d9488, #14b8a6)",
                  boxShadow: !suspectUrl.trim() || isScanActive ? "none" : "0 0 20px rgba(13, 148, 136, 0.3)",
                }}
                className="px-6 py-3 rounded-xl font-bold text-[13px] text-white flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed disabled:text-slate-500 transition-all shrink-0"
              >
                {isScanActive ? (
                  <>
                    <Loader2 size={15} className="animate-spin-smooth" />
                    <span>Screening Thumbnail...</span>
                  </>
                ) : (
                  <>
                    <Globe size={15} />
                    <span>Screen Video URL</span>
                  </>
                )}
              </button>
            </form>

            <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-1">
              <Info size={13} className="text-teal-400 shrink-0" />
              <span>
                SSRF-guarded. Only public metadata & thumbnail are retrieved. Video streams are NEVER downloaded. Unsupported platforms or direct files are rejected.
              </span>
            </div>
          </div>
        )}

        {/* Failed Scan Error Banner */}
        {scanState === "failed" && scanError && (
          <div className="mt-3 p-3 bg-red-950/50 border border-red-500/40 rounded-xl text-red-300 text-[12px] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 truncate">
              <AlertTriangle size={16} className="text-red-400 shrink-0" />
              <span className="truncate">{scanError}</span>
            </div>
            <button
              onClick={handleResetScan}
              className="px-2.5 py-1 rounded-lg bg-red-900/60 hover:bg-red-900 text-red-200 text-[11px] font-bold shrink-0 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* ─── Main Investigation Layout (Left: Workflow & Results, Right: Audit Log) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Investigation Workflow & Match Result (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div
            style={{
              background: "#0f172a",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 18,
            }}
            className="p-5"
          >
            <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-4">
              Forensic Detection Pipeline
            </h4>

            {/* Pipeline Stage Steps */}
            <div className="space-y-3">
              {[
                {
                  step: 1,
                  key: "ingest",
                  label: "Ingest Suspect Clip",
                  desc: "Stream chunks to forensic storage",
                  active: scanState === "uploading",
                  done: ["processing", "matching", "finalizing", "completed"].includes(scanState),
                },
                {
                  step: 2,
                  key: "sampling",
                  label: "Temporal Sampling",
                  desc: "Extract keyframe images every 5s",
                  active: scanState === "processing",
                  done: ["matching", "finalizing", "completed"].includes(scanState),
                },
                {
                  step: 3,
                  key: "faiss",
                  label: "FAISS L2 Similarity Search",
                  desc: "MobileNetV3 576-dim feature distance",
                  active: scanState === "matching" || (scanState === "processing" && uploadProgress >= 100),
                  done: ["finalizing", "completed"].includes(scanState),
                },
                {
                  step: 4,
                  key: "phash",
                  label: "Perceptual Hash Cross-Check",
                  desc: "pHash hamming distance verification",
                  active: scanState === "finalizing",
                  done: scanState === "completed",
                },
              ].map((item) => {
                const isPassed = item.done;
                const isCurrent = item.active;

                return (
                  <div
                    key={item.key}
                    style={{
                      background: isCurrent
                        ? "rgba(245, 158, 11, 0.08)"
                        : isPassed
                        ? "rgba(13, 148, 136, 0.08)"
                        : "#1e293b",
                      border: `1px solid ${
                        isCurrent
                          ? "rgba(245, 158, 11, 0.3)"
                          : isPassed
                          ? "rgba(13, 148, 136, 0.3)"
                          : "rgba(255, 255, 255, 0.04)"
                      }`,
                    }}
                    className="p-3 rounded-xl flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: isPassed
                            ? "#0d9488"
                            : isCurrent
                            ? "#f59e0b"
                            : "#334155",
                          color: "#ffffff",
                        }}
                        className="flex items-center justify-center text-[11px] font-black shrink-0"
                      >
                        {isPassed ? <CheckCircle2 size={14} /> : item.step}
                      </div>
                      <div>
                        <p className="text-[13px] font-bold text-white m-0 leading-tight">
                          {item.label}
                        </p>
                        <p className="text-[11px] text-slate-400 m-0">{item.desc}</p>
                      </div>
                    </div>

                    {isCurrent && (
                      <div className="flex items-center gap-2">
                        {item.key === "ingest" && uploadProgress > 0 && uploadProgress < 100 && (
                          <span className="text-[11px] font-mono font-bold text-amber-400">
                            {uploadProgress}%
                          </span>
                        )}
                        <Loader2 size={16} className="text-amber-400 animate-spin-smooth shrink-0" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─── Neutral In-Flight Processing State (Shown strictly while active) ─── */}
          {isScanActive && (
            <div
              style={{
                background: "rgba(30, 41, 59, 0.6)",
                border: "1px solid rgba(148, 163, 184, 0.2)",
                borderRadius: 18,
              }}
              className="p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 size={16} className="text-amber-400 animate-spin-smooth" />
                  <span className="text-[12px] font-extrabold uppercase tracking-wider text-amber-300">
                    {scanState === "uploading"
                      ? "Uploading Video Stream"
                      : "Forensic Analysis in Progress"}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">
                  State: {scanState.toUpperCase()}
                </span>
              </div>

              {scanState === "uploading" && (
                <div>
                  <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>Transferring suspect video chunks to backend</span>
                    <span className="font-mono text-amber-400 font-bold">{uploadProgress}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${uploadProgress}%` }}
                      className="h-full bg-amber-500 rounded-full transition-all duration-200"
                    />
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-400 m-0 leading-relaxed">
                Evaluating temporal frames against MobileNetV3 reference embeddings. A final forensic outcome (CANDIDATE MATCH, SUSPECT, or CLEAN) is rendered only after all frames are verified.
              </p>
            </div>
          )}

          {/* ─── Results Summary Card (Shown ONLY on Completed Scan) ─── */}
          {scanState === "completed" && scanResult && (
            <div
              style={{
                background:
                  scanResult.overall_status === "CANDIDATE_MATCH"
                    ? "rgba(239, 68, 68, 0.08)"
                    : scanResult.overall_status === "SUSPECT"
                    ? "rgba(245, 158, 11, 0.08)"
                    : scanResult.overall_status === "NO_REFERENCE_DATA"
                    ? "rgba(100, 116, 139, 0.08)"
                    : scanResult.overall_status === "NEEDS_FULL_VIDEO_REVIEW"
                    ? "rgba(59, 130, 246, 0.08)"
                    : "rgba(13, 148, 136, 0.08)",
                border: `1px solid ${
                  scanResult.overall_status === "CANDIDATE_MATCH"
                    ? "rgba(239, 68, 68, 0.3)"
                    : scanResult.overall_status === "SUSPECT"
                    ? "rgba(245, 158, 11, 0.3)"
                    : scanResult.overall_status === "NO_REFERENCE_DATA"
                    ? "rgba(100, 116, 139, 0.3)"
                    : scanResult.overall_status === "NEEDS_FULL_VIDEO_REVIEW"
                    ? "rgba(59, 130, 246, 0.3)"
                    : "rgba(13, 148, 136, 0.3)"
                }`,
                borderRadius: 18,
              }}
              className="p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {scanResult.investigation_type === "URL_SCREENING"
                    ? "Preliminary URL Screening Verdict"
                    : "Forensic Video Scan Outcome"}
                </span>
                <span
                  style={{
                    background:
                      scanResult.overall_status === "CANDIDATE_MATCH"
                        ? "#ef4444"
                        : scanResult.overall_status === "SUSPECT"
                        ? "#f59e0b"
                        : scanResult.overall_status === "NO_REFERENCE_DATA"
                        ? "#64748b"
                        : scanResult.overall_status === "NEEDS_FULL_VIDEO_REVIEW"
                        ? "#3b82f6"
                        : "#0d9488",
                  }}
                  className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase text-white tracking-wider"
                >
                  {scanResult.overall_status.replace(/_/g, " ")}
                </span>
              </div>

              {/* URL SCREENING SPECIFIC RESULTS */}
              {scanResult.investigation_type === "URL_SCREENING" ? (
                <div className="space-y-4">
                  {/* Distinct Mandatory Disclaimer Alert */}
                  <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-[12px] text-amber-300">
                      <ShieldAlert size={16} className="shrink-0" />
                      <span>PRELIMINARY THUMBNAIL SCREENING — NOT FULL VIDEO VERIFICATION</span>
                    </div>
                    <p className="text-[11px] text-amber-200/90 leading-relaxed m-0">
                      {scanResult.disclaimer}
                    </p>
                  </div>

                  {/* Recommended Action & Platform Banner */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">
                        Recommended Action:
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-blue-500/20 text-blue-300 border border-blue-500/40">
                        {scanResult.recommended_action || "NEEDS_FULL_VIDEO_REVIEW"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                      <span>Platform: {scanResult.platform || "Public Video"}</span>
                    </div>
                  </div>

                  {/* Two-Column Suspect Preview & Metadata */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                    {/* Left: Thumbnail & Source Metadata */}
                    <div className="md:col-span-6 space-y-2">
                      <div className="relative rounded-xl overflow-hidden border border-slate-700 bg-slate-950 aspect-video flex items-center justify-center">
                        {scanResult.suspect_thumbnail_preview_url || scanResult.thumbnail_url ? (
                          <img
                            src={
                              scanResult.suspect_thumbnail_preview_url
                                ? `${API_BASE}${scanResult.suspect_thumbnail_preview_url}`
                                : scanResult.thumbnail_url
                            }
                            alt="Screened public thumbnail"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // Fallback if local preview fails
                              if (scanResult.thumbnail_url && (e.target as HTMLElement).getAttribute("src") !== scanResult.thumbnail_url) {
                                (e.target as HTMLImageElement).src = scanResult.thumbnail_url;
                              }
                            }}
                          />
                        ) : (
                          <div className="text-slate-500 text-[11px]">Thumbnail preview unavailable</div>
                        )}
                        <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/80 text-white text-[9px] font-extrabold uppercase tracking-wider backdrop-blur-sm">
                          Screened Thumbnail
                        </span>
                      </div>

                      <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 text-[11px] space-y-1.5">
                        <p className="font-bold text-white text-[12px] truncate m-0">
                          {scanResult.metadata?.title || scanResult.suspect_filename}
                        </p>
                        <div className="flex items-center justify-between text-slate-400 text-[10px]">
                          <span>Channel: {scanResult.metadata?.uploader || "Unknown"}</span>
                          <span>Duration: {formatDuration(scanResult.duration_seconds || 0)}</span>
                        </div>
                        {scanResult.source_url && (
                          <a
                            href={scanResult.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-teal-400 hover:text-teal-300 font-medium text-[10px] pt-1"
                          >
                            <span>Open public video in new tab</span>
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Right: Visual Screening Metrics */}
                    <div className="md:col-span-6 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-3 bg-black/30 rounded-xl">
                          <span className="text-[9px] uppercase tracking-wider text-slate-400 block mb-0.5">
                            Confidence Score
                          </span>
                          <span className="text-lg font-black text-white">
                            {scanResult.highest_confidence}%
                          </span>
                        </div>
                        <div className="p-3 bg-black/30 rounded-xl">
                          <span className="text-[9px] uppercase tracking-wider text-slate-400 block mb-0.5">
                            Lowest L2 Distance
                          </span>
                          <span className="text-lg font-black text-white">
                            {scanResult.lowest_l2_distance !== null
                              ? scanResult.lowest_l2_distance.toFixed(4)
                              : "—"}
                          </span>
                        </div>
                      </div>

                      <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 text-[11px] space-y-1">
                        <span className="text-[9px] uppercase font-bold text-slate-400 block">
                          Visual Comparison Result
                        </span>
                        <p className="text-slate-200 m-0 leading-relaxed text-[11px]">
                          {scanResult.status_message ||
                            (scanResult.candidate_matches_found > 0
                              ? `Visual match confirmed against reference asset '${scanResult.matched_assets[0]}'.`
                              : "No visual similarity detected on static thumbnail.")}
                        </p>
                        {scanResult.matched_assets.length > 0 && (
                          <div className="pt-1 flex items-center gap-1.5 text-[10px] text-amber-300">
                            <span className="font-bold">Matched Reference:</span>
                            <span className="font-mono">{scanResult.matched_assets[0]}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Screening Limitations Checklist */}
                  {scanResult.limitations && scanResult.limitations.length > 0 && (
                    <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase text-slate-400">
                        <Info size={12} className="text-slate-400" />
                        <span>Preliminary Screening Limitations</span>
                      </div>
                      <ul className="list-disc pl-4 space-y-1 text-slate-400 text-[10px] m-0">
                        {scanResult.limitations.map((lim, idx) => (
                          <li key={idx} className="leading-tight">
                            {lim}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                /* FULL VIDEO SCAN RESULTS (Standard Upload) */
                <>
                  {scanResult.overall_status === "NO_REFERENCE_DATA" ? (
                    <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800 text-[12px] text-slate-300 space-y-2 mb-4">
                      <p className="font-bold text-white m-0">No Reference Vault Data</p>
                      <p className="text-slate-400 m-0">
                        {scanResult.message ||
                          "The reference vault is empty or contains no external reference footage. Candidate matching requires indexed assets."}
                      </p>
                      <button
                        onClick={onNavigateToVault}
                        className="mt-2 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors"
                      >
                        <span>Add Official Assets in Vault</span>
                        <ArrowRight size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="p-3 bg-black/30 rounded-xl">
                        <span className="text-[9px] uppercase tracking-wider text-slate-400 block mb-0.5">
                          Highest Confidence
                        </span>
                        <span className="text-xl font-black text-white">
                          {scanResult.highest_confidence}%
                        </span>
                      </div>

                      <div className="p-3 bg-black/30 rounded-xl">
                        <span className="text-[9px] uppercase tracking-wider text-slate-400 block mb-0.5">
                          Lowest L2 Distance
                        </span>
                        <span className="text-xl font-black text-white">
                          {scanResult.lowest_l2_distance !== null
                            ? scanResult.lowest_l2_distance.toFixed(4)
                            : "—"}
                        </span>
                      </div>

                      <div className="p-3 bg-black/30 rounded-xl">
                        <span className="text-[9px] uppercase tracking-wider text-slate-400 block mb-0.5">
                          Matched Frames
                        </span>
                        <span className="text-xl font-black text-white">
                          {scanResult.candidate_matches_found} / {scanResult.total_frames_analyzed}
                        </span>
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-slate-400 italic mb-4">
                    {scanResult.disclaimer}
                  </p>
                </>
              )}

              <button
                onClick={() => onViewIncident(scanResult)}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-[12px] font-bold flex items-center justify-center gap-1.5 transition-colors border border-slate-700"
              >
                <span>Inspect Detailed Evidence in Incidents</span>
                <ExternalLink size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Right: Live Event Feed (5 cols) */}
        <div className="lg:col-span-5">
          <div
            style={{
              background: "#0f172a",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 18,
            }}
            className="p-5 h-full flex flex-col"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-teal-400" />
                <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-300 m-0">
                  Sentinel Audit Log
                </h4>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                {isScanActive ? "Scanning" : "Ready"}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 max-h-[380px] pr-1">
              {events.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-center text-slate-600 text-[12px]">
                  No active scan. Submit a video above to observe real forensic telemetry.
                </div>
              ) : (
                events.map((evt) => (
                  <div
                    key={evt.id}
                    style={{
                      background:
                        evt.type === "match"
                          ? "rgba(239, 68, 68, 0.1)"
                          : evt.type === "warning"
                          ? "rgba(245, 158, 11, 0.1)"
                          : evt.type === "error"
                          ? "rgba(239, 68, 68, 0.15)"
                          : "rgba(255, 255, 255, 0.02)",
                      borderLeft: `3px solid ${
                        evt.type === "match" || evt.type === "error"
                          ? "#ef4444"
                          : evt.type === "warning"
                          ? "#f59e0b"
                          : evt.type === "success"
                          ? "#0d9488"
                          : "#64748b"
                      }`,
                    }}
                    className="p-2.5 rounded-r text-[11px] font-mono leading-relaxed"
                  >
                    <div className="text-[9px] text-slate-500 mb-0.5">{evt.timestamp}</div>
                    <div className="text-slate-200">{evt.text}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
