"use client";

import React, { useState, useRef } from "react";
import {
  UploadCloud,
  Globe,
  Search,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ExternalLink,
  Layers,
  Cpu,
  Hash,
  Link as LinkIcon,
  XCircle,
  FileVideo,
  ChevronDown,
  ChevronUp,
  Activity,
  Database,
  Radio,
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
      addEvent("info", `Selected suspect stream: "${file.name}" (${formatBytes(file.size)})`);
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
      addEvent("info", `Dropped suspect stream: "${file.name}" (${formatBytes(file.size)})`);
    }
  };

  const handleResetScan = () => {
    setSuspectFile(null);
    setSuspectUrl("");
    setScanResult(null);
    setScanError("");
    setScanState("idle");
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleStartScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspectFile || isScanActive) return;

    setScanError("");
    setScanResult(null);
    setScanState("uploading");
    setUploadProgress(0);

    addEvent("info", `Initiating forensic upload: "${suspectFile.name}"`);

    try {
      const uploadInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(uploadInterval);
            return 90;
          }
          return prev + 15;
        });
      }, 150);

      const t1 = setTimeout(() => {
        setScanState("processing");
        addEvent("info", "Extracting keyframes at 5s temporal intervals via OpenCV decoder");
      }, 1200);

      const t2 = setTimeout(() => {
        setScanState("matching");
        addEvent("info", "Querying 576-dim L2 MobileNetV3 visual embeddings in FAISS vault");
      }, 2600);

      const t3 = setTimeout(() => {
        setScanState("finalizing");
        addEvent("info", "Executing 64-bit DCT perceptual hash dual-layer validation");
      }, 4200);

      const result = await scanSuspectVideo(suspectFile, (progress) => {
        setUploadProgress(progress);
      });

      clearInterval(uploadInterval);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);

      setUploadProgress(100);
      setScanResult(result);
      setScanState("completed");

      const matchFound = result.candidate_matches_found > 0;
      addEvent(
        matchFound ? "match" : "success",
        `Forensic investigation complete: ${result.overall_status.replace(/_/g, " ")} (${
          result.highest_confidence
        }% peak confidence, ${result.candidate_matches_found} candidate frames)`
      );
    } catch (err: any) {
      setScanState("failed");
      const errorMsg =
        err.message || "Forensic investigation failed. Verify backend and FAISS vault status.";
      setScanError(errorMsg);
      addEvent("error", `Investigation failed: ${errorMsg}`);
    }
  };

  const handleStartUrlScreen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspectUrl.trim() || isScanActive) return;

    setScanError("");
    setScanResult(null);
    setScanState("processing");
    setUploadProgress(100);

    addEvent("info", `Screening public video URL: "${suspectUrl.trim()}"`);

    try {
      const t1 = setTimeout(() => {
        setScanState("matching");
        addEvent("info", "Extracting public metadata and comparing against FAISS vectors");
      }, 1200);

      const t2 = setTimeout(() => {
        setScanState("finalizing");
        addEvent("info", "Performing DCT pHash thumbnail screening");
      }, 2400);

      const result = await screenSuspectUrl(suspectUrl.trim());

      clearTimeout(t1);
      clearTimeout(t2);

      setScanResult(result);
      setScanState("completed");

      const matchFound = result.candidate_matches_found > 0;
      addEvent(
        matchFound ? "match" : "success",
        `URL screening complete: ${result.overall_status.replace(/_/g, " ")} (${
          result.highest_confidence
        }% similarity)`
      );
    } catch (err: any) {
      setScanState("failed");
      const errorMsg =
        err.message || "URL screening failed. Please check the URL syntax and server connectivity.";
      setScanError(errorMsg);
      addEvent("error", `URL screening failed: ${errorMsg}`);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 text-[#ded7cb]">
      {/* ─── 1. Compact Header ─── */}
      <div
        style={{
          background: "#171615",
          border: "1px solid rgba(238, 231, 219, 0.08)",
          borderRadius: 16,
        }}
        className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#1e1d1b] text-[#f4efe6] border border-[rgba(238,231,219,0.12)]">
              <Radio size={12} className={isVaultReady ? "text-[#eee7db]" : "text-[#736d62]"} />
              <span>{isVaultReady ? "FAISS Vault Online" : "Vault Empty"}</span>
            </span>

            {vaultStatus?.is_cloud ? (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#1e1d1b] text-[#aba497] border border-[rgba(238,231,219,0.08)]">
                Supabase Cloud Persistence
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#1e1d1b] text-[#aba497] border border-[rgba(238,231,219,0.08)]">
                Local SQLite Mode
              </span>
            )}
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#f4efe6] m-0">
            Threat Hunter
          </h1>
          <p className="text-[13px] text-[#aba497] mt-1 max-w-2xl leading-relaxed">
            Upload suspect video files or screen public broadcast URLs against the FAISS visual vector repository.
          </p>
        </div>

        {/* Header Action */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onNavigateToVault}
            style={{
              background: "#1e1d1b",
              border: "1px solid rgba(238, 231, 219, 0.1)",
              color: "#ded7cb",
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:text-[#f4efe6] hover:bg-[#262422] text-[11px] font-medium transition-colors cursor-pointer"
          >
            <Database size={13} className="text-[#eee7db]" />
            <span>Vault Library ({assets.length})</span>
          </button>
        </div>
      </div>

      {/* ─── 2. Investigation Submission Area (Compact, Focused) ─── */}
      <div
        style={{
          background: "#171615",
          border: "1px solid rgba(238, 231, 219, 0.08)",
          borderRadius: 16,
        }}
        className="p-5 space-y-4"
      >
        {/* Mode Selector Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[rgba(238,231,219,0.08)]">
          <div className="flex items-center p-1 rounded-xl bg-[#1a1918] border border-[rgba(238,231,219,0.08)] text-[12px]">
            <button
              type="button"
              onClick={() => {
                if (isScanActive) return;
                setSubmissionMode("file");
                handleResetScan();
              }}
              style={{
                background: submissionMode === "file" ? "#eee7db" : "transparent",
                color: submissionMode === "file" ? "#141312" : "#8e887d",
              }}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer shadow-sm"
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
              style={{
                background: submissionMode === "url" ? "#eee7db" : "transparent",
                color: submissionMode === "url" ? "#141312" : "#8e887d",
              }}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer shadow-sm"
            >
              <Globe size={14} />
              <span>Screen Public Video URL</span>
            </button>
          </div>

          <span className="text-[11px] text-[#8e887d] font-medium">
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
                  ? "1px solid #eee7db"
                  : "1px dashed rgba(238, 231, 219, 0.12)",
                background: suspectFile ? "rgba(238, 231, 219, 0.04)" : "#1a1918",
                cursor: isScanActive ? "not-allowed" : "pointer",
                borderRadius: 12,
              }}
              className="p-4 sm:p-5 flex items-center justify-between gap-3 transition-colors hover:bg-[#201f1d] hover:border-[rgba(238,231,219,0.22)]"
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
                    background: "rgba(238, 231, 219, 0.06)",
                    color: "#eee7db",
                  }}
                  className="flex items-center justify-center shrink-0"
                >
                  <FileVideo size={18} />
                </div>
                <div className="truncate">
                  <p className="text-[13px] font-bold text-[#f4efe6] truncate m-0">
                    {suspectFile
                      ? suspectFile.name
                      : "Select or drop suspect video file (.mp4, .mov, .avi, .mkv, .webm)"}
                  </p>
                  <p className="text-[11px] text-[#8e887d] mt-0.5 m-0">
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
                  background: !suspectFile || isScanActive ? "#242220" : "#eee7db",
                  color: !suspectFile || isScanActive ? "#736d62" : "#141312",
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-[12px] transition-all disabled:cursor-not-allowed cursor-pointer shrink-0 shadow-sm hover:opacity-95"
              >
                {isScanActive ? (
                  <>
                    <Loader2 size={13} className="animate-spin text-[#eee7db]" />
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
                    ? "1px solid #eee7db"
                    : "1px solid rgba(238, 231, 219, 0.12)",
                  background: "#1a1918",
                  borderRadius: 12,
                }}
                className="flex-1 px-3.5 py-2 flex items-center gap-2.5 transition-colors"
              >
                <LinkIcon size={16} className={suspectUrl.trim() ? "text-[#eee7db]" : "text-[#736d62]"} />
                <input
                  type="url"
                  value={suspectUrl}
                  onChange={(e) => {
                    setSuspectUrl(e.target.value);
                    if (scanError) setScanError("");
                  }}
                  disabled={isScanActive}
                  placeholder="Paste public video URL, e.g. https://www.youtube.com/watch?v=... or https://vimeo.com/..."
                  className="w-full bg-transparent border-none text-[12px] text-[#f4efe6] placeholder-[#736d62] focus:outline-none"
                />
                {suspectUrl && !isScanActive && (
                  <button
                    type="button"
                    onClick={() => setSuspectUrl("")}
                    className="text-[#8e887d] hover:text-[#f4efe6] cursor-pointer"
                  >
                    <XCircle size={15} />
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={!suspectUrl.trim() || isScanActive}
                style={{
                  background: !suspectUrl.trim() || isScanActive ? "#242220" : "#eee7db",
                  color: !suspectUrl.trim() || isScanActive ? "#736d62" : "#141312",
                }}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-bold text-[12px] transition-all disabled:cursor-not-allowed cursor-pointer shrink-0 shadow-sm hover:opacity-95"
              >
                {isScanActive ? (
                  <>
                    <Loader2 size={13} className="animate-spin text-[#eee7db]" />
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

            <p className="text-[11px] text-[#736d62] m-0">
              Supported platforms: YouTube, Vimeo, Twitch, Dailymotion. The stream is never downloaded; only public metadata and thumbnail are compared.
            </p>
          </form>
        )}

        {/* Validation / Execution Error Alert */}
        {scanState === "failed" && scanError && (
          <div
            style={{
              background: "rgba(212, 163, 115, 0.12)",
              border: "1px solid rgba(212, 163, 115, 0.25)",
              color: "#d4a373",
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
              className="px-2.5 py-1 rounded bg-[#242220] hover:bg-[#2c2a27] text-[#f4efe6] text-[10px] font-bold shrink-0 transition-colors cursor-pointer"
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
                background: "#171615",
                border: "1px solid rgba(238, 231, 219, 0.14)",
                borderRadius: 16,
              }}
              className="p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 size={16} className="text-[#eee7db] animate-spin" />
                  <h3 className="text-[13px] font-bold text-[#f4efe6] m-0 tracking-tight">
                    {scanState === "uploading"
                      ? "Uploading Suspect Video Stream"
                      : "Forensic Analysis Active"}
                  </h3>
                </div>
                <span className="text-[10px] text-[#ded7cb] font-mono font-bold uppercase tracking-wider">
                  State: {scanState}
                </span>
              </div>

              {/* Progress Bar during upload */}
              {scanState === "uploading" && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-[#8e887d]">
                    <span>Streaming chunks to forensic storage</span>
                    <span className="font-mono text-[#f4efe6] font-bold">{uploadProgress}%</span>
                  </div>
                  <div className="h-1.5 bg-[#242220] rounded-full overflow-hidden">
                    <div
                      style={{ width: `${uploadProgress}%` }}
                      className="h-full bg-[#eee7db] rounded-full transition-all duration-200"
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
                          ? "rgba(238, 231, 219, 0.08)"
                          : isCurrent
                          ? "rgba(238, 231, 219, 0.14)"
                          : "#1a1918",
                        border: `1px solid ${
                          isDone
                            ? "rgba(238, 231, 219, 0.16)"
                            : isCurrent
                            ? "rgba(238, 231, 219, 0.25)"
                            : "rgba(238, 231, 219, 0.06)"
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
                          background: isDone ? "#eee7db" : isCurrent ? "rgba(238, 231, 219, 0.2)" : "#282624",
                          color: isDone ? "#141312" : isCurrent ? "#f4efe6" : "#736d62",
                        }}
                        className="flex items-center justify-center shrink-0 text-[11px] font-bold"
                      >
                        {isDone ? <CheckCircle2 size={13} /> : stage.step}
                      </div>
                      <div className="truncate">
                        <p className="text-[12px] font-bold text-[#f4efe6] m-0 leading-tight">
                          {stage.label}
                        </p>
                        <p className="text-[10px] text-[#8e887d] m-0 mt-0.5 truncate">
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
                background: "#171615",
                border: `1px solid ${
                  scanResult.overall_status === "CANDIDATE_MATCH"
                    ? "rgba(212, 163, 115, 0.3)"
                    : scanResult.overall_status === "SUSPECT"
                    ? "rgba(212, 163, 115, 0.2)"
                    : "rgba(238, 231, 219, 0.14)"
                }`,
                borderRadius: 16,
              }}
              className="p-5 space-y-4"
            >
              {/* Result Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[rgba(238,231,219,0.08)]">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#8e887d] block mb-0.5">
                    {scanResult.investigation_type === "URL_SCREENING"
                      ? "Public URL Screening Result"
                      : "Forensic Investigation Outcome"}
                  </span>
                  <h3 className="text-[16px] font-bold text-[#f4efe6] m-0 truncate">
                    {scanResult.metadata?.title || scanResult.suspect_filename || `Suspect ${scanResult.submitted_asset_id.slice(0, 8)}`}
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    style={{
                      background:
                        scanResult.overall_status === "CANDIDATE_MATCH"
                          ? "rgba(212, 163, 115, 0.16)"
                          : scanResult.overall_status === "SUSPECT"
                          ? "rgba(212, 163, 115, 0.1)"
                          : "rgba(238, 231, 219, 0.08)",
                      color:
                        scanResult.overall_status === "CANDIDATE_MATCH"
                          ? "#dfa974"
                          : scanResult.overall_status === "SUSPECT"
                          ? "#d4a373"
                          : "#ded7cb",
                      border: `1px solid ${
                        scanResult.overall_status === "CANDIDATE_MATCH"
                          ? "rgba(212, 163, 115, 0.3)"
                          : scanResult.overall_status === "SUSPECT"
                          ? "rgba(212, 163, 115, 0.2)"
                          : "rgba(238, 231, 219, 0.14)"
                      }`,
                    }}
                    className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                  >
                    {scanResult.overall_status.replace(/_/g, " ")}
                  </span>
                </div>
              </div>

              {/* URL Screening Disclaimer Banner */}
              {scanResult.investigation_type === "URL_SCREENING" && (
                <div
                  style={{
                    background: "rgba(212, 163, 115, 0.08)",
                    border: "1px solid rgba(212, 163, 115, 0.2)",
                    color: "#d4a373",
                    borderRadius: 10,
                  }}
                  className="p-3 text-[11px] leading-relaxed flex items-start gap-2"
                >
                  <AlertTriangle size={15} className="shrink-0 mt-0.5 text-[#d4a373]" />
                  <div>
                    <strong className="font-bold text-[#f4efe6] block mb-0.5">
                      Preliminary Thumbnail Screening — Not Full Stream Verification
                    </strong>
                    <span>{scanResult.disclaimer}</span>
                  </div>
                </div>
              )}

              {/* Forensic Metrics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div
                  style={{ background: "#1e1d1b", borderRadius: 10 }}
                  className="p-3 border border-[rgba(238,231,219,0.08)]"
                >
                  <span className="text-[9px] uppercase tracking-wider text-[#8e887d] block mb-1">
                    Highest Similarity
                  </span>
                  <span className="text-xl font-extrabold text-[#f4efe6]">
                    {scanResult.highest_confidence}%
                  </span>
                </div>

                <div
                  style={{ background: "#1e1d1b", borderRadius: 10 }}
                  className="p-3 border border-[rgba(238,231,219,0.08)]"
                >
                  <span className="text-[9px] uppercase tracking-wider text-[#8e887d] block mb-1">
                    Lowest L2 Distance
                  </span>
                  <span className="text-xl font-extrabold text-[#ded7cb]">
                    {scanResult.lowest_l2_distance !== null
                      ? scanResult.lowest_l2_distance.toFixed(4)
                      : "—"}
                  </span>
                </div>

                <div
                  style={{ background: "#1e1d1b", borderRadius: 10 }}
                  className="p-3 border border-[rgba(238,231,219,0.08)]"
                >
                  <span className="text-[9px] uppercase tracking-wider text-[#8e887d] block mb-1">
                    Candidate Matches
                  </span>
                  <span className="text-xl font-extrabold text-[#f4efe6]">
                    {scanResult.candidate_matches_found} / {scanResult.total_frames_analyzed}
                  </span>
                </div>
              </div>

              {/* Matched Reference Assets */}
              {scanResult.matched_assets && scanResult.matched_assets.length > 0 && (
                <div
                  style={{ background: "#1e1d1b", borderRadius: 10 }}
                  className="p-3 border border-[rgba(238,231,219,0.08)] flex items-center justify-between text-[11px]"
                >
                  <span className="text-[#8e887d]">Matched Reference Footage:</span>
                  <span className="font-mono text-[#ded7cb] font-bold truncate max-w-md">
                    {scanResult.matched_assets.join(", ")}
                  </span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => onViewIncident(scanResult)}
                  style={{
                    background: "#eee7db",
                    color: "#141312",
                  }}
                  className="w-full sm:flex-1 py-2.5 rounded-xl font-bold text-[12px] flex items-center justify-center gap-2 hover:bg-[#fbf7ef] transition-colors cursor-pointer shadow-sm"
                >
                  <span>Inspect Synchronized Evidence & Video in Incidents</span>
                  <ExternalLink size={13} />
                </button>

                <button
                  type="button"
                  onClick={handleResetScan}
                  style={{
                    border: "1px solid rgba(238, 231, 219, 0.12)",
                    background: "#1e1d1b",
                    color: "#ded7cb",
                  }}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl hover:text-[#f4efe6] hover:bg-[#262422] text-[12px] font-semibold transition-colors cursor-pointer"
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
              background: "#171615",
              border: "1px solid rgba(238, 231, 219, 0.08)",
              borderRadius: 16,
            }}
            className="p-8 sm:p-12 text-center space-y-4"
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "rgba(238, 231, 219, 0.06)",
                border: "1px solid rgba(238, 231, 219, 0.1)",
                color: "#eee7db",
              }}
              className="mx-auto flex items-center justify-center"
            >
              <Search size={20} />
            </div>

            <div className="max-w-md mx-auto">
              <h3 className="text-[15px] font-bold text-[#f4efe6] m-0">
                {isVaultReady
                  ? "Investigation Workspace Primed"
                  : "Reference Vault Requires Official Footage"}
              </h3>
              <p className="text-[12px] text-[#8e887d] mt-1 leading-relaxed">
                {isVaultReady
                  ? `Select a suspect broadcast file or paste a public URL above. The engine will sample keyframes and query the FAISS reference vault containing ${vaultStatus?.vault_size ?? 0} visual vectors.`
                  : "Before scanning suspect clips, please ingest at least one official reference video into the Digital Asset Vault so the engine has reference embeddings to compare against."}
              </p>
            </div>

            {!isVaultReady && (
              <button
                type="button"
                onClick={onNavigateToVault}
                style={{
                  background: "#eee7db",
                  color: "#141312",
                }}
                className="mt-2 px-4 py-2 rounded-xl hover:bg-[#fbf7ef] text-[12px] font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
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
              background: "#171615",
              border: "1px solid rgba(238, 231, 219, 0.08)",
              borderRadius: 14,
            }}
            className="overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setShowTechnicalLog((prev) => !prev)}
              className="w-full p-3.5 flex items-center justify-between text-left text-[#ded7cb] hover:text-[#f4efe6] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Activity size={13} className="text-[#eee7db]" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#8e887d]">
                  Technical Telemetry Log ({events.length} events)
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-[#736d62]">
                <span>{showTechnicalLog ? "Hide" : "Show"}</span>
                {showTechnicalLog ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </div>
            </button>

            {showTechnicalLog && (
              <div className="p-3.5 pt-0 space-y-1.5 border-t border-[rgba(238,231,219,0.08)] max-h-56 overflow-y-auto">
                {events.map((evt) => (
                  <div
                    key={evt.id}
                    style={{
                      background: "#1a1918",
                      borderLeft: `2.5px solid ${
                        evt.type === "match"
                          ? "#d4a373"
                          : evt.type === "error"
                          ? "#ef4444"
                          : evt.type === "warning"
                          ? "#c48a56"
                          : "#eee7db"
                      }`,
                    }}
                    className="p-2 rounded-r text-[10px] font-mono leading-relaxed"
                  >
                    <span className="text-[#736d62] mr-2">{evt.timestamp}</span>
                    <span className="text-[#ded7cb]">{evt.text}</span>
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
