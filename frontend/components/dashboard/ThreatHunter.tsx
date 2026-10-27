"use client";

import React, { useState, useRef } from "react";
import {
  Search,
  UploadCloud,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FileVideo,
  ExternalLink,
  Activity,
  ArrowRight,
  Database,
  XCircle,
  Clock,
  ShieldAlert,
  Globe,
  Link as LinkIcon,
  Info,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
  Hash,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AssetRecord,
  VaultStatus,
  MatchAnalysisResult,
  ScanLifecycleState,
} from "@/lib/types";
import {
  scanSuspectVideo,
  screenSuspectUrl,
  formatBytes,
  formatDuration,
  API_BASE,
} from "@/lib/api";

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
  const [showTechnicalLog, setShowTechnicalLog] = useState<boolean>(false);
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
    if (isScanActive) return;

    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSuspectFile(file);
      setScanResult(null);
      setScanError("");
      setScanState("idle");
      setUploadProgress(0);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (isScanActive) return;

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSuspectFile(file);
      setScanResult(null);
      setScanError("");
      setScanState("idle");
      setUploadProgress(0);
    }
  };

  const handleStartScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspectFile || isScanActive) return;

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
          addEvent("info", "Upload complete. Server decoding stream and extracting frames...");
        }
      });

      setScanState("completed");
      setScanResult(result);

      if (result.overall_status === "CANDIDATE_MATCH") {
        addEvent(
          "match",
          `Confirmed ${result.candidate_matches_found} candidate match(es) with highest similarity of ${result.highest_confidence}% (Lowest L2: ${result.lowest_l2_distance?.toFixed(4)})`
        );
      } else if (result.overall_status === "SUSPECT") {
        addEvent(
          "warning",
          `Visual proximity match detected (${result.highest_confidence}%, Lowest L2: ${result.lowest_l2_distance?.toFixed(4)})`
        );
      } else if (result.overall_status === "NO_REFERENCE_DATA") {
        addEvent("warning", "Reference vault is empty. No reference vectors were available for comparison.");
      } else {
        addEvent("success", `Investigation complete: CLEAN. No visual matches found across ${result.total_frames_analyzed} frames.`);
      }

      addEvent("info", `Forensic incident recorded: ${result.incident_id || "registered"}`);
    } catch (err: any) {
      const errorMessage = err?.message || "Threat scan failed. Check if the FixProof backend is running.";
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
    addEvent("info", "Executing SSRF verification and querying public metadata...");

    try {
      const result = await screenSuspectUrl(suspectUrl.trim());
      setScanState("completed");
      setScanResult(result);

      if (result.overall_status === "CANDIDATE_MATCH") {
        addEvent(
          "match",
          `Confirmed preliminary candidate match on thumbnail with ${result.highest_confidence}% confidence (Lowest L2: ${result.lowest_l2_distance?.toFixed(4)})`
        );
      } else if (result.overall_status === "SUSPECT") {
        addEvent(
          "warning",
          `Thumbnail proximity match detected (${result.highest_confidence}%, Lowest L2: ${result.lowest_l2_distance?.toFixed(4)})`
        );
      } else if (result.overall_status === "NO_REFERENCE_DATA") {
        addEvent("warning", "Reference vault is empty. No reference vectors were available for comparison.");
      } else {
        addEvent("info", "No visual match detected on thumbnail image. Overall status: NEEDS_FULL_VIDEO_REVIEW.");
      }

      addEvent("info", `Screening incident recorded: ${result.incident_id || "registered"}`);
    } catch (err: any) {
      const errorMessage = err?.message || "URL screening failed. Check if the FixProof backend is running.";
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
    <div className="max-w-7xl mx-auto space-y-6 text-slate-100">
      {/* ─── 1. Compact Header ─── */}
      <div
        style={{
          background: "#0c101b",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 16,
        }}
        className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/60">
              <Search size={12} className="text-amber-400" />
              <span>Sentinel Threat Hunter</span>
            </span>

            <span
              style={{
                background: isVaultReady ? "rgba(13, 148, 136, 0.14)" : "rgba(245, 158, 11, 0.14)",
                color: isVaultReady ? "#2dd4bf" : "#fbbf24",
                border: `1px solid ${isVaultReady ? "rgba(13, 148, 136, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
              }}
              className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
            >
              {isVaultReady
                ? `Reference Vault Ready (${vaultStatus?.vault_size ?? 0} vectors)`
                : "Vault Empty — Ingest Assets First"}
            </span>

            {vaultStatus?.is_cloud ? (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-900 text-slate-300 border border-slate-800 hidden md:inline">
                Supabase Cloud
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-900 text-slate-300 border border-slate-800 hidden md:inline">
                Local SQLite
              </span>
            )}
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white m-0">
            Threat Hunter
          </h1>
          <p className="text-[13px] text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Upload suspect video files or screen public broadcast URLs against the FAISS visual vector repository.
          </p>
        </div>

        {/* Header Action */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onNavigateToVault}
            style={{
              background: "#111522",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-300 hover:text-white text-[11px] font-semibold transition-colors cursor-pointer"
          >
            <Database size={13} className="text-indigo-400" />
            <span>Vault Library ({assets.length})</span>
          </button>
        </div>
      </div>

      {/* ─── 2. Investigation Submission Area (Compact, Focused) ─── */}
      <div
        style={{
          background: "#0c101b",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 16,
        }}
        className="p-5 space-y-4"
      >
        {/* Mode Selector Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center p-1 rounded-xl bg-slate-900 border border-slate-800 text-[12px]">
            <button
              type="button"
              onClick={() => {
                if (isScanActive) return;
                setSubmissionMode("file");
                handleResetScan();
              }}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                submissionMode === "file"
                  ? "bg-teal-500 text-slate-950 shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <UploadCloud size={14} />
              <span>Upload Suspect Video</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (isScanActive) return;
                setSubmissionMode("url");
                handleResetScan();
              }}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                submissionMode === "url"
                  ? "bg-teal-500 text-slate-950 shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Globe size={14} />
              <span>Screen Public Video URL</span>
            </button>
          </div>

          <span className="text-[11px] text-slate-400 font-medium">
            {submissionMode === "file"
              ? "Full frame extraction & dual-layer L2 + pHash match"
              : "Zero stream download • SSRF-guarded preliminary check"}
          </span>
        </div>

        {/* File Upload Mode */}
        {submissionMode === "file" ? (
          <form onSubmit={handleStartScan} className="space-y-3">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => {
                if (!isScanActive) fileInputRef.current?.click();
              }}
              style={{
                border: suspectFile
                  ? "1px solid #0d9488"
                  : "1px dashed rgba(255, 255, 255, 0.15)",
                background: suspectFile ? "rgba(13, 148, 136, 0.05)" : "#0f1523",
                cursor: isScanActive ? "not-allowed" : "pointer",
                borderRadius: 12,
              }}
              className="p-4 sm:p-5 flex items-center justify-between gap-3 transition-colors hover:bg-slate-800/40 hover:border-slate-600"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,.mov,.avi,.mkv,.webm,.m4v,.flv,.wmv,.ts,.3gp,.ogg,.ogv,video/*"
                onChange={handleFileChange}
                disabled={isScanActive}
                className="hidden"
              />

              <div className="flex items-center gap-3 truncate">
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: suspectFile ? "rgba(13, 148, 136, 0.15)" : "#1a2234",
                    color: suspectFile ? "#2dd4bf" : "#94a3b8",
                  }}
                  className="flex items-center justify-center shrink-0"
                >
                  <FileVideo size={18} />
                </div>
                <div className="truncate">
                  <p className="text-[13px] font-bold text-white truncate m-0">
                    {suspectFile
                      ? suspectFile.name
                      : "Select or drop suspect video file (.mp4, .mov, .avi, .mkv, .webm)"}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 m-0">
                    {suspectFile
                      ? `${formatBytes(suspectFile.size)} • Click or drop to change`
                      : "Maximum file size: 500 MB"}
                  </p>
                </div>
              </div>

              <button
                type="submit"
                disabled={!suspectFile || isScanActive}
                style={{
                  background: !suspectFile || isScanActive ? "#1a2234" : "#0d9488",
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-[12px] text-white transition-all disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer shrink-0 shadow-sm hover:bg-teal-600"
              >
                {isScanActive ? (
                  <>
                    <Loader2 size={13} className="animate-spin text-teal-300" />
                    <span>
                      {scanState === "uploading"
                        ? `Uploading (${uploadProgress}%)...`
                        : "Investigating..."}
                    </span>
                  </>
                ) : (
                  <>
                    <Search size={14} />
                    <span>Launch Investigation</span>
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          /* Public URL Screening Mode */
          <form onSubmit={handleStartUrlScreen} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div
                style={{
                  border: suspectUrl.trim()
                    ? "1px solid #0d9488"
                    : "1px solid rgba(255, 255, 255, 0.12)",
                  background: "#0f1523",
                  borderRadius: 12,
                }}
                className="flex-1 px-3.5 py-2 flex items-center gap-2.5 transition-colors"
              >
                <LinkIcon size={16} className={suspectUrl.trim() ? "text-teal-400" : "text-slate-500"} />
                <input
                  type="url"
                  value={suspectUrl}
                  onChange={(e) => {
                    setSuspectUrl(e.target.value);
                    if (scanError) setScanError("");
                  }}
                  disabled={isScanActive}
                  placeholder="Paste public video URL, e.g. https://www.youtube.com/watch?v=... or https://vimeo.com/..."
                  className="w-full bg-transparent border-none text-[12px] text-white placeholder-slate-500 focus:outline-none"
                />
                {suspectUrl && !isScanActive && (
                  <button
                    type="button"
                    onClick={() => setSuspectUrl("")}
                    className="text-slate-500 hover:text-white cursor-pointer"
                  >
                    <XCircle size={15} />
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={!suspectUrl.trim() || isScanActive}
                style={{
                  background: !suspectUrl.trim() || isScanActive ? "#1a2234" : "#0d9488",
                }}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-bold text-[12px] text-white transition-all disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer shrink-0 shadow-sm hover:bg-teal-600"
              >
                {isScanActive ? (
                  <>
                    <Loader2 size={13} className="animate-spin text-teal-300" />
                    <span>Screening URL...</span>
                  </>
                ) : (
                  <>
                    <Globe size={14} />
                    <span>Screen Public URL</span>
                  </>
                )}
              </button>
            </div>

            <p className="text-[11px] text-slate-500 m-0">
              Supported platforms: YouTube, Vimeo, Twitch, Dailymotion. The stream is never downloaded; only public metadata and thumbnail are compared.
            </p>
          </form>
        )}

        {/* Validation / Execution Error Alert */}
        {scanState === "failed" && scanError && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#f87171",
              borderRadius: 10,
            }}
            className="p-3 flex items-center justify-between gap-3 text-[12px] font-medium"
          >
            <div className="flex items-center gap-2 truncate">
              <AlertTriangle size={15} className="shrink-0" />
              <span className="truncate">{scanError}</span>
            </div>
            <button
              type="button"
              onClick={handleResetScan}
              className="px-2.5 py-1 rounded bg-red-900/60 hover:bg-red-800 text-white text-[10px] font-bold shrink-0 transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* ─── 3. Main Investigation Workspace (Dynamic, Spacious) ─── */}
      <div className="space-y-4">
        {/* Dynamic Pipeline Progress (Revealed ONLY during active processing) */}
        <AnimatePresence>
          {isScanActive && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
              style={{
                background: "#0c101b",
                border: "1px solid rgba(13, 148, 136, 0.3)",
                borderRadius: 16,
              }}
              className="p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 size={16} className="text-teal-400 animate-spin" />
                  <h3 className="text-[13px] font-bold text-white m-0 tracking-tight">
                    {scanState === "uploading"
                      ? "Uploading Suspect Video Stream"
                      : "Forensic Analysis Active"}
                  </h3>
                </div>
                <span className="text-[10px] text-teal-400 font-mono font-bold uppercase tracking-wider">
                  State: {scanState}
                </span>
              </div>

              {/* Progress Bar during upload */}
              {scanState === "uploading" && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Streaming chunks to forensic storage</span>
                    <span className="font-mono text-teal-400 font-bold">{uploadProgress}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${uploadProgress}%` }}
                      className="h-full bg-teal-500 rounded-full transition-all duration-200"
                    />
                  </div>
                </div>
              )}

              {/* Real 4-Stage Animated Pipeline */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                {[
                  {
                    step: 1,
                    key: "ingest",
                    label: "Stream Ingest",
                    desc: "Safe storage & chunk reception",
                    icon: UploadCloud,
                    active: scanState === "uploading",
                    done: scanState !== "uploading",
                  },
                  {
                    step: 2,
                    key: "sampling",
                    label: "Temporal Sampling",
                    desc: "1 keyframe every 5s",
                    icon: Layers,
                    active: scanState === "processing" && uploadProgress >= 100,
                    done: scanState === "matching" || scanState === "finalizing",
                  },
                  {
                    step: 3,
                    key: "faiss",
                    label: "MobileNetV3 & FAISS",
                    desc: "576-dim L2 distance query",
                    icon: Cpu,
                    active: scanState === "matching" || (scanState === "processing" && uploadProgress >= 100),
                    done: scanState === "finalizing",
                  },
                  {
                    step: 4,
                    key: "phash",
                    label: "pHash Cross-Check",
                    desc: "64-bit DCT dual-layer check",
                    icon: Hash,
                    active: scanState === "finalizing",
                    done: false,
                  },
                ].map((stage) => {
                  const isDone = stage.done;
                  const isCurrent = stage.active;
                  const Icon = stage.icon;

                  return (
                    <div
                      key={stage.key}
                      style={{
                        background: isDone
                          ? "rgba(13, 148, 136, 0.1)"
                          : isCurrent
                          ? "rgba(45, 212, 191, 0.1)"
                          : "#111522",
                        border: `1px solid ${
                          isDone
                            ? "rgba(13, 148, 136, 0.35)"
                            : isCurrent
                            ? "rgba(45, 212, 191, 0.4)"
                            : "rgba(255, 255, 255, 0.06)"
                        }`,
                        borderRadius: 12,
                      }}
                      className="p-3 flex items-start gap-2.5 transition-colors"
                    >
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 7,
                          background: isDone ? "#0d9488" : isCurrent ? "rgba(45, 212, 191, 0.2)" : "#1e293b",
                          color: isDone ? "#ffffff" : isCurrent ? "#2dd4bf" : "#64748b",
                        }}
                        className="flex items-center justify-center shrink-0 text-[11px] font-bold"
                      >
                        {isDone ? <CheckCircle2 size={13} /> : stage.step}
                      </div>
                      <div className="truncate">
                        <p className="text-[12px] font-bold text-white m-0 leading-tight">
                          {stage.label}
                        </p>
                        <p className="text-[10px] text-slate-400 m-0 mt-0.5 truncate">
                          {stage.desc}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dynamic Completed Scan Result Card */}
        <AnimatePresence>
          {scanState === "completed" && scanResult && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              style={{
                background: "#0c101b",
                border: `1px solid ${
                  scanResult.overall_status === "CANDIDATE_MATCH"
                    ? "rgba(239, 68, 68, 0.35)"
                    : scanResult.overall_status === "SUSPECT"
                    ? "rgba(245, 158, 11, 0.35)"
                    : "rgba(13, 148, 136, 0.35)"
                }`,
                borderRadius: 16,
              }}
              className="p-5 space-y-4"
            >
              {/* Result Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                    {scanResult.investigation_type === "URL_SCREENING"
                      ? "Public URL Screening Result"
                      : "Forensic Investigation Outcome"}
                  </span>
                  <h3 className="text-[16px] font-bold text-white m-0 truncate">
                    {scanResult.metadata?.title || scanResult.suspect_filename || `Suspect ${scanResult.submitted_asset_id.slice(0, 8)}`}
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    style={{
                      background:
                        scanResult.overall_status === "CANDIDATE_MATCH"
                          ? "rgba(239, 68, 68, 0.2)"
                          : scanResult.overall_status === "SUSPECT"
                          ? "rgba(245, 158, 11, 0.2)"
                          : scanResult.overall_status === "NO_REFERENCE_DATA"
                          ? "rgba(100, 116, 139, 0.2)"
                          : "rgba(13, 148, 136, 0.2)",
                      color:
                        scanResult.overall_status === "CANDIDATE_MATCH"
                          ? "#f87171"
                          : scanResult.overall_status === "SUSPECT"
                          ? "#fbbf24"
                          : scanResult.overall_status === "NO_REFERENCE_DATA"
                          ? "#94a3b8"
                          : "#2dd4bf",
                      border: `1px solid ${
                        scanResult.overall_status === "CANDIDATE_MATCH"
                          ? "rgba(239, 68, 68, 0.35)"
                          : scanResult.overall_status === "SUSPECT"
                          ? "rgba(245, 158, 11, 0.35)"
                          : "rgba(13, 148, 136, 0.35)"
                      }`,
                    }}
                    className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider"
                  >
                    {scanResult.overall_status.replace(/_/g, " ")}
                  </span>
                </div>
              </div>

              {/* URL Screening Disclaimer Banner */}
              {scanResult.investigation_type === "URL_SCREENING" && (
                <div
                  style={{
                    background: "rgba(245, 158, 11, 0.08)",
                    border: "1px solid rgba(245, 158, 11, 0.25)",
                    color: "#fbbf24",
                    borderRadius: 10,
                  }}
                  className="p-3 text-[11px] leading-relaxed flex items-start gap-2"
                >
                  <ShieldAlert size={15} className="shrink-0 mt-0.5 text-amber-400" />
                  <div>
                    <strong className="font-bold text-amber-300 block mb-0.5">
                      Preliminary Thumbnail Screening — Not Full Stream Verification
                    </strong>
                    <span>{scanResult.disclaimer}</span>
                  </div>
                </div>
              )}

              {/* Forensic Metrics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div
                  style={{ background: "#111522", borderRadius: 10 }}
                  className="p-3 border border-slate-800"
                >
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 block mb-1">
                    Highest Similarity
                  </span>
                  <span className="text-xl font-extrabold text-white">
                    {scanResult.highest_confidence}%
                  </span>
                </div>

                <div
                  style={{ background: "#111522", borderRadius: 10 }}
                  className="p-3 border border-slate-800"
                >
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 block mb-1">
                    Lowest L2 Distance
                  </span>
                  <span className="text-xl font-extrabold text-slate-200">
                    {scanResult.lowest_l2_distance !== null
                      ? scanResult.lowest_l2_distance.toFixed(4)
                      : "—"}
                  </span>
                </div>

                <div
                  style={{ background: "#111522", borderRadius: 10 }}
                  className="p-3 border border-slate-800"
                >
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 block mb-1">
                    Candidate Matches
                  </span>
                  <span className="text-xl font-extrabold text-teal-400">
                    {scanResult.candidate_matches_found} / {scanResult.total_frames_analyzed}
                  </span>
                </div>
              </div>

              {/* Matched Reference Assets */}
              {scanResult.matched_assets && scanResult.matched_assets.length > 0 && (
                <div
                  style={{ background: "#111522", borderRadius: 10 }}
                  className="p-3 border border-slate-800 flex items-center justify-between text-[11px]"
                >
                  <span className="text-slate-400">Matched Reference Footage:</span>
                  <span className="font-mono text-teal-300 font-bold truncate max-w-md">
                    {scanResult.matched_assets.join(", ")}
                  </span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => onViewIncident(scanResult)}
                  className="w-full sm:flex-1 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-[12px] font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm"
                >
                  <span>Inspect Synchronized Evidence & Video in Incidents</span>
                  <ExternalLink size={13} />
                </button>

                <button
                  type="button"
                  onClick={handleResetScan}
                  style={{ border: "1px solid rgba(255, 255, 255, 0.1)" }}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 text-[12px] font-semibold transition-colors cursor-pointer"
                >
                  New Scan
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Default Idle State (Spacious, Clean Forensic Guidance) */}
        {scanState === "idle" && (
          <div
            style={{
              background: "#0c101b",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 16,
            }}
            className="p-8 sm:p-12 text-center space-y-4"
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: isVaultReady ? "rgba(13, 148, 136, 0.12)" : "rgba(245, 158, 11, 0.12)",
                color: isVaultReady ? "#2dd4bf" : "#fbbf24",
              }}
              className="mx-auto flex items-center justify-center"
            >
              <Search size={22} />
            </div>

            <div className="max-w-md mx-auto">
              <h3 className="text-[15px] font-bold text-white m-0">
                {isVaultReady
                  ? "Investigation Workspace Primed"
                  : "Reference Vault Requires Official Footage"}
              </h3>
              <p className="text-[12px] text-slate-400 mt-1 leading-relaxed">
                {isVaultReady
                  ? `Select a suspect broadcast file or paste a public URL above. The engine will sample keyframes and query the FAISS reference vault containing ${vaultStatus?.vault_size ?? 0} visual vectors.`
                  : "Before scanning suspect clips, please ingest at least one official reference video into the Digital Asset Vault so the engine has reference embeddings to compare against."}
              </p>
            </div>

            {!isVaultReady && (
              <button
                type="button"
                onClick={onNavigateToVault}
                className="mt-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-[12px] font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Database size={13} />
                <span>Go to Asset Vault</span>
              </button>
            )}
          </div>
        )}

        {/* ─── 4. Optional Collapsible Technical Log (Audit Log Disclosure) ─── */}
        {events.length > 0 && (
          <div
            style={{
              background: "#0c101b",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 14,
            }}
            className="overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setShowTechnicalLog((prev) => !prev)}
              className="w-full p-3.5 flex items-center justify-between text-left text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Activity size={13} className="text-teal-400" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Technical Telemetry Log ({events.length} events)
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-slate-500">
                <span>{showTechnicalLog ? "Hide" : "Show"}</span>
                {showTechnicalLog ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </div>
            </button>

            {showTechnicalLog && (
              <div className="p-3.5 pt-0 space-y-1.5 border-t border-slate-800/60 max-h-56 overflow-y-auto">
                {events.map((evt) => (
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
                      borderLeft: `2.5px solid ${
                        evt.type === "match" || evt.type === "error"
                          ? "#ef4444"
                          : evt.type === "warning"
                          ? "#fbbf24"
                          : evt.type === "success"
                          ? "#2dd4bf"
                          : "#64748b"
                      }`,
                    }}
                    className="p-2 rounded-r text-[10px] font-mono leading-relaxed"
                  >
                    <span className="text-slate-500 mr-2">{evt.timestamp}</span>
                    <span className="text-slate-300">{evt.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ThreatHunter;
