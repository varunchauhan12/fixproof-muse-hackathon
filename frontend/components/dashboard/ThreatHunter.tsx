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
  Plus,
  RefreshCw,
  X,
  FileCheck2,
  Check,
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
import SlideToConfirm from "@/components/kokonutui/slide-to-confirm";
import AILoadingState, { useAnimatedInvestigationSteps } from "@/components/kokonutui/ai-loading";
import { useActivity } from "@/context/ActivityContext";

const MAX_BATCH_FILES = 3;
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const ALLOWED_EXTS = [
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".m4v",
  ".flv",
  ".wmv",
  ".ts",
  ".3gp",
  ".ogg",
  ".ogv",
];

const videoScanStepsConfig = [
  {
    id: "ingest",
    label: "Suspect video ingest & container probe",
    detail: [
      "streaming chunks to forensic storage",
      "validating video container and codec headers",
      "computing SHA-256 integrity hash",
    ],
  },
  {
    id: "sampling",
    label: "Temporal keyframe extraction",
    detail: [
      "sampling 1 keyframe every 5 seconds",
      "decoding RGB frames at native aspect ratio",
      "generating forensic review thumbnails",
    ],
  },
  {
    id: "faiss",
    label: "MobileNetV3 & FAISS vault search",
    detail: [
      "computing 576-dim L2-normalized embeddings",
      "querying nearest-neighbor IndexFlatL2 index",
      "filtering candidate match intervals",
    ],
  },
  {
    id: "phash",
    label: "Dual-layer pHash cross-check",
    detail: [
      "computing 64-bit DCT perceptual hash signatures",
      "evaluating Hamming distance threshold",
      "triggering pairwise Nemotron Vision verification check",
    ],
  },
];

const urlScreenStepsConfig = [
  {
    id: "ssrf",
    label: "SSRF validation & URL metadata screening",
    detail: [
      "validating allowed video platform domain",
      "probing stream metadata without downloading",
      "resolving public video thumbnail",
    ],
  },
  {
    id: "vector",
    label: "FAISS vector reference screening",
    detail: [
      "extracting 576-dim MobileNetV3 visual embedding",
      "querying reference index for nearest neighbor",
      "calculating initial L2 distance metric",
    ],
  },
  {
    id: "phash_url",
    label: "Perceptual hash comparison",
    detail: [
      "computing 64-bit DCT pHash signature",
      "cross-checking against official reference frames",
      "triggering Nemotron Vision thumbnail verification",
    ],
  },
];

export interface BatchItemResult {
  id: string;
  file: File;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  result?: MatchAnalysisResult;
  error?: string;
}

export interface BatchSummaryStats {
  total: number;
  completed: number;
  failed: number;
  matches: number;
  clean: number;
}

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
  const { addTask, updateTask } = useActivity();
  const [submissionMode, setSubmissionMode] = useState<"file" | "url">("file");

  // Multi-file selection state (max 3)
  const [suspectFiles, setSuspectFiles] = useState<File[]>([]);
  const [suspectUrl, setSuspectUrl] = useState<string>("");

  // Scan & Batch execution state
  const [scanState, setScanState] = useState<ScanLifecycleState>("idle");
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [scanError, setScanError] = useState<string>("");
  const [scanResult, setScanResult] = useState<MatchAnalysisResult | null>(null);

  // Batch tracking
  const [batchItems, setBatchItems] = useState<BatchItemResult[]>([]);
  const [activeBatchIndex, setActiveBatchIndex] = useState<number | null>(null);
  const [batchSummary, setBatchSummary] = useState<BatchSummaryStats | null>(null);
  const cancelBatchRef = useRef<boolean>(false);

  // Telemetry log & UI state
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

  const isUrlScreen = submissionMode === "url";
  const hunterSteps = useAnimatedInvestigationSteps(
    isScanActive,
    isUrlScreen ? urlScreenStepsConfig : videoScanStepsConfig,
    {
      isError: scanState === "failed",
      errorMsg: scanError || undefined,
    }
  );

  const addEvent = (type: ScanEvent["type"], text: string) => {
    const newEvent: ScanEvent = {
      id: Math.random().toString(36).substring(2),
      timestamp: new Date().toLocaleTimeString(),
      type,
      text,
    };
    setEvents((prev) => [newEvent, ...prev]);
  };

  // Validate incoming files (max 3 total, format, size)
  const validateAndAddFiles = (incomingList: FileList | File[]) => {
    if (isScanActive) return;
    setScanError("");

    const newFiles = Array.from(incomingList);
    if (newFiles.length === 0) return;

    // Check count boundary: strictly reject 4+ files with explanatory message
    if (suspectFiles.length + newFiles.length > MAX_BATCH_FILES) {
      setScanError(
        `Maximum 3 video files permitted per investigation batch. You currently have ${suspectFiles.length} selected and attempted to add ${newFiles.length}. Please select no more than 3 videos.`
      );
      return;
    }

    const validated: File[] = [];
    for (const file of newFiles) {
      const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
      const isAllowedExt = ALLOWED_EXTS.includes(ext) || file.type.startsWith("video/");
      if (!isAllowedExt) {
        setScanError(
          `Unsupported file format: "${file.name}". Supported video formats: MP4, MOV, AVI, MKV, WEBM, M4V, FLV, WMV, TS.`
        );
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        setScanError(
          `File "${file.name}" (${formatBytes(file.size)}) exceeds the maximum limit of 500 MB.`
        );
        return;
      }

      const isDuplicate =
        suspectFiles.some((f) => f.name === file.name && f.size === file.size) ||
        validated.some((f) => f.name === file.name && f.size === file.size);

      if (!isDuplicate) {
        validated.push(file);
      }
    }

    if (validated.length > 0) {
      setSuspectFiles((prev) => [...prev, ...validated]);
      setScanResult(null);
      setBatchSummary(null);
      validated.forEach((f) => {
        addEvent("info", `Selected suspect stream: "${f.name}" (${formatBytes(f.size)})`);
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      validateAndAddFiles(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (isScanActive) return;
    if (e.dataTransfer.files) {
      validateAndAddFiles(e.dataTransfer.files);
    }
  };

  const handleRemoveFile = (index: number) => {
    if (isScanActive) return;
    setSuspectFiles((prev) => prev.filter((_, i) => i !== index));
    setScanError("");
  };

  const handleResetScan = () => {
    setSuspectFiles([]);
    setSuspectUrl("");
    setScanResult(null);
    setBatchItems([]);
    setBatchSummary(null);
    setActiveBatchIndex(null);
    setScanError("");
    setScanState("idle");
    setUploadProgress(0);
    cancelBatchRef.current = false;
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Sequential Batch Investigation (Part 2 + Part 4)
  const handleStartBatchScan = async () => {
    if (suspectFiles.length === 0 || isScanActive) return;

    cancelBatchRef.current = false;
    setScanError("");
    setScanResult(null);
    setBatchSummary(null);
    setScanState("uploading");
    setUploadProgress(0);

    const initialItems: BatchItemResult[] = suspectFiles.map((f, idx) => ({
      id: `item-${Date.now()}-${idx}`,
      file: f,
      status: "queued",
    }));

    setBatchItems(initialItems);

    const islandTaskId = addTask({
      label: "Threat Hunter Investigation",
      detail: `Queued ${initialItems.length} suspect video${initialItems.length > 1 ? "s" : ""}...`,
      status: "running",
    });

    addEvent(
      "info",
      `Initiating sequential batch investigation for ${initialItems.length} suspect stream(s)`
    );

    const workingItems = [...initialItems];

    for (let i = 0; i < workingItems.length; i++) {
      if (cancelBatchRef.current) {
        for (let j = i; j < workingItems.length; j++) {
          workingItems[j] = { ...workingItems[j], status: "cancelled" };
          addEvent("warning", `Cancelled queued investigation for "${workingItems[j].file.name}"`);
        }
        setBatchItems([...workingItems]);
        break;
      }

      setActiveBatchIndex(i);
      workingItems[i] = { ...workingItems[i], status: "running" };
      setBatchItems([...workingItems]);

      const currentFile = workingItems[i].file;
      updateTask(islandTaskId, {
        detail: `Investigating video ${i + 1} of ${workingItems.length}: "${currentFile.name}"`,
        status: "running",
      });

      addEvent(
        "info",
        `[${i + 1}/${workingItems.length}] Uploading & scanning: "${currentFile.name}" (${formatBytes(
          currentFile.size
        )})`
      );

      try {
        setUploadProgress(0);
        const result = await scanSuspectVideo(currentFile, (progress) => {
          setUploadProgress(progress);
        });

        workingItems[i] = {
          ...workingItems[i],
          status: "completed",
          result,
        };
        setBatchItems([...workingItems]);

        const hasMatch = result.candidate_matches_found > 0;
        addEvent(
          hasMatch ? "match" : "success",
          `[${i + 1}/${workingItems.length}] Complete: ${result.overall_status.replace(
            /_/g,
            " "
          )} (${result.highest_confidence}% peak confidence, ${
            result.candidate_matches_found
          } candidate frames)`
        );

        // If single file, also update legacy scanResult for deep inspection
        if (workingItems.length === 1) {
          setScanResult(result);
        }
      } catch (err: any) {
        const errMsg = err?.message || "Forensic investigation failed for this video stream";
        workingItems[i] = {
          ...workingItems[i],
          status: "failed",
          error: errMsg,
        };
        setBatchItems([...workingItems]);
        addEvent("error", `[${i + 1}/${workingItems.length}] "${currentFile.name}" failed: ${errMsg}`);
      }
    }

    setActiveBatchIndex(null);
    setScanState("completed");

    const total = workingItems.length;
    const completed = workingItems.filter((x) => x.status === "completed").length;
    const failed = workingItems.filter((x) => x.status === "failed").length;
    const matches = workingItems.filter(
      (x) => x.status === "completed" && (x.result?.candidate_matches_found ?? 0) > 0
    ).length;
    const clean = workingItems.filter(
      (x) => x.status === "completed" && (x.result?.candidate_matches_found ?? 0) === 0
    ).length;

    setBatchSummary({ total, completed, failed, matches, clean });

    updateTask(islandTaskId, {
      status: completed > 0 ? "done" : "error",
      detail: `Batch complete: ${completed}/${total} videos processed (${matches} candidate matches, ${clean} clean, ${failed} failed)`,
    });
  };

  // Independent retry of a failed item in the batch
  const handleRetryItem = async (index: number) => {
    if (isScanActive) return;
    const item = batchItems[index];
    if (!item) return;

    setScanState("uploading");
    setActiveBatchIndex(index);
    const updated = [...batchItems];
    updated[index] = { ...item, status: "running", error: undefined };
    setBatchItems(updated);

    const retryTaskId = addTask({
      label: `Retry: ${item.file.name}`,
      detail: `Investigating "${item.file.name}"...`,
      status: "running",
    });

    try {
      setUploadProgress(0);
      const result = await scanSuspectVideo(item.file, (p) => setUploadProgress(p));
      updated[index] = { ...updated[index], status: "completed", result };
      setBatchItems([...updated]);

      updateTask(retryTaskId, {
        status: "done",
        detail: `Retry complete: ${result.overall_status.replace(/_/g, " ")}`,
      });

      // Update aggregate summary
      const total = updated.length;
      const completed = updated.filter((x) => x.status === "completed").length;
      const failed = updated.filter((x) => x.status === "failed").length;
      const matches = updated.filter(
        (x) => x.status === "completed" && (x.result?.candidate_matches_found ?? 0) > 0
      ).length;
      const clean = updated.filter(
        (x) => x.status === "completed" && (x.result?.candidate_matches_found ?? 0) === 0
      ).length;
      setBatchSummary({ total, completed, failed, matches, clean });
    } catch (err: any) {
      const errMsg = err?.message || "Retry failed";
      updated[index] = { ...updated[index], status: "failed", error: errMsg };
      setBatchItems([...updated]);
      updateTask(retryTaskId, { status: "error", detail: errMsg });
    } finally {
      setActiveBatchIndex(null);
      setScanState("completed");
    }
  };

  const handleCancelRemaining = () => {
    cancelBatchRef.current = true;
    addEvent(
      "warning",
      "Cancellation requested: current active video will finish, remaining queued videos will be stopped."
    );
  };

  // Single URL screening
  const handleStartUrlScreen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspectUrl.trim() || isScanActive) return;

    setScanError("");
    setScanResult(null);
    setScanState("processing");
    setUploadProgress(100);

    const islandTaskId = addTask({
      label: "URL Screening",
      detail: `Screening public video URL: "${suspectUrl.trim()}"`,
      status: "running",
    });

    addEvent("info", `Screening public video URL: "${suspectUrl.trim()}"`);

    try {
      const result = await screenSuspectUrl(suspectUrl.trim());
      setScanResult(result);
      setScanState("completed");

      const matchFound = result.candidate_matches_found > 0;
      addEvent(
        matchFound ? "match" : "success",
        `URL screening complete: ${result.overall_status.replace(/_/g, " ")} (${
          result.highest_confidence
        }% similarity)`
      );

      updateTask(islandTaskId, {
        status: "done",
        detail: `URL screening complete: ${result.overall_status.replace(/_/g, " ")} (${result.highest_confidence}% similarity)`,
      });
    } catch (err: any) {
      setScanState("failed");
      const errorMsg =
        err.message || "URL screening failed. Please check the URL syntax and server connectivity.";
      setScanError(errorMsg);
      addEvent("error", `URL screening failed: ${errorMsg}`);
      updateTask(islandTaskId, {
        status: "error",
        detail: `URL screening error: ${errorMsg}`,
      });
    }
  };

  const totalSelectedBytes = suspectFiles.reduce((acc, f) => acc + f.size, 0);

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
              <Radio size={12} className={isVaultReady ? "text-teal-400" : "text-[#736d62]"} />
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
            Investigate up to 3 suspect video streams or screen public broadcast URLs against the FAISS visual vector repository.
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
            <Database size={13} className="text-teal-400" />
            <span>Vault Library ({assets.length})</span>
          </button>
        </div>
      </div>

      {/* ─── 2. Investigation Submission Area ─── */}
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
              <span>Multi-Video File Batch (Max 3)</span>
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
              <span>Screen Public URL</span>
            </button>
          </div>

          <span className="text-[11px] text-[#8e887d] font-medium">
            {submissionMode === "file"
              ? "Sequential multi-video FAISS vector match • Up to 3 videos"
              : "Zero stream download • SSRF-guarded preliminary check"}
          </span>
        </div>

        {/* Hidden File Input for Picker */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp4,.mov,.avi,.mkv,.webm,.m4v,.flv,.wmv,.ts,.3gp,.ogg,.ogv,video/*"
          multiple
          onChange={handleFileChange}
          disabled={isScanActive}
          className="hidden"
        />

        {/* File Upload Mode (Part 2 + Part 4) */}
        {submissionMode === "file" ? (
          <div className="space-y-4">
            {/* Dropzone & Picker Header */}
            {suspectFiles.length === 0 ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => {
                  if (!isScanActive) fileInputRef.current?.click();
                }}
                style={{
                  border: "1px dashed rgba(238, 231, 219, 0.18)",
                  background: "#1a1918",
                  cursor: isScanActive ? "not-allowed" : "pointer",
                  borderRadius: 12,
                }}
                className="p-6 flex flex-col items-center justify-center text-center gap-2.5 transition-colors hover:bg-[#201f1d] hover:border-teal-500/30"
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: "rgba(20, 184, 166, 0.1)",
                    color: "#5eead4",
                  }}
                  className="flex items-center justify-center shrink-0 mb-1"
                >
                  <FileVideo size={22} />
                </div>
                <div>
                  <p className="text-[14px] font-bold text-[#f4efe6] m-0">
                    Select or drag & drop up to 3 suspect video files
                  </p>
                  <p className="text-[11px] text-[#8e887d] mt-1 m-0">
                    Supported: MP4, MOV, AVI, MKV, WEBM (Max 500 MB per video) • Investigates sequentially
                  </p>
                </div>
              </div>
            ) : (
              /* Selected Files List & Add More Area */
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[12px] pb-1 border-b border-[rgba(238,231,219,0.06)]">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#f4efe6]">
                      {suspectFiles.length} / {MAX_BATCH_FILES} videos selected
                    </span>
                    <span className="text-[#8e887d] font-mono text-[11px]">
                      ({formatBytes(totalSelectedBytes)} total)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {suspectFiles.length < MAX_BATCH_FILES && !isScanActive && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-2.5 py-1 rounded bg-[#242220] hover:bg-[#2c2a27] text-teal-300 hover:text-white text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Plus size={12} />
                        <span>Add Video</span>
                      </button>
                    )}
                    {!isScanActive && (
                      <button
                        type="button"
                        onClick={handleResetScan}
                        className="px-2 py-1 rounded text-[#8e887d] hover:text-[#f4efe6] text-[11px] transition-colors cursor-pointer"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                </div>

                {/* Selected Files Row/Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {suspectFiles.map((file, idx) => (
                    <div
                      key={`${file.name}-${idx}`}
                      style={{
                        background: "#1a1918",
                        border: "1px solid rgba(238, 231, 219, 0.12)",
                        borderRadius: 10,
                      }}
                      className="p-3 flex items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <div
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 8,
                            background: "rgba(20, 184, 166, 0.12)",
                            color: "#5eead4",
                          }}
                          className="flex items-center justify-center shrink-0 font-mono text-[11px] font-bold"
                        >
                          #{idx + 1}
                        </div>
                        <div className="truncate">
                          <p className="text-[12px] font-bold text-[#f4efe6] truncate m-0">
                            {file.name}
                          </p>
                          <p className="text-[10px] text-[#8e887d] m-0 font-mono">
                            {formatBytes(file.size)}
                          </p>
                        </div>
                      </div>

                      {!isScanActive && (
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(idx)}
                          className="text-[#8e887d] hover:text-red-400 p-1 rounded transition-colors cursor-pointer shrink-0"
                          title="Remove video"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Slide to Investigate Control (Part 4) */}
                <div className="pt-2 flex flex-col items-center justify-center gap-2">
                  <SlideToConfirm
                    label={`Slide to Investigate ${suspectFiles.length} Video${suspectFiles.length > 1 ? "s" : ""}`}
                    confirmingLabel="Investigating Batch"
                    doneLabel="Batch Completed"
                    disabled={suspectFiles.length === 0 || suspectFiles.length > MAX_BATCH_FILES || isScanActive}
                    onConfirm={handleStartBatchScan}
                    className="w-full max-w-sm mx-auto"
                  />

                  {isScanActive && suspectFiles.length > 1 && (
                    <button
                      type="button"
                      onClick={handleCancelRemaining}
                      className="text-[11px] text-amber-400 hover:text-amber-300 font-semibold underline cursor-pointer pt-1"
                    >
                      Cancel Remaining Queued Videos
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
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
        {scanError && (
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
              <AlertTriangle size={15} className="shrink-0 text-amber-400" />
              <span className="truncate">{scanError}</span>
            </div>
            <button
              type="button"
              onClick={() => setScanError("")}
              className="px-2.5 py-1 rounded bg-[#242220] hover:bg-[#2c2a27] text-[#f4efe6] text-[10px] font-bold shrink-0 transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* ─── 3. Main Investigation Workspace ─── */}
      <div className="space-y-4">
        {/* Dynamic Pipeline Progress during active processing */}
        <AnimatePresence>
          {isScanActive && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
              style={{
                background: "#171615",
                border: "1px solid rgba(20, 184, 166, 0.25)",
                borderRadius: 16,
              }}
              className="p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 size={16} className="text-teal-400 animate-spin" />
                  <h3 className="text-[13px] font-bold text-[#f4efe6] m-0 tracking-tight">
                    {submissionMode === "file" && activeBatchIndex !== null
                      ? `Investigating Video ${activeBatchIndex + 1} of ${suspectFiles.length}: "${suspectFiles[activeBatchIndex]?.name}"`
                      : scanState === "uploading"
                      ? "Uploading Suspect Video Stream"
                      : "Forensic Analysis Active"}
                  </h3>
                </div>
                <span className="text-[10px] text-teal-300 font-mono font-bold uppercase tracking-wider">
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
                      className="h-full bg-teal-500 rounded-full transition-all duration-200"
                    />
                  </div>
                </div>
              )}

              {/* KokonutUI Animated AI Loading State */}
              <div className="p-3.5 bg-[#141312] border border-[rgba(238,231,219,0.08)] rounded-xl">
                <AILoadingState steps={hunterSteps} />
              </div>

              {/* 4-Stage Animated Pipeline */}
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

                  return (
                    <div
                      key={stage.key}
                      style={{
                        background: isDone
                          ? "rgba(20, 184, 166, 0.08)"
                          : isCurrent
                          ? "rgba(20, 184, 166, 0.15)"
                          : "#1a1918",
                        border: `1px solid ${
                          isDone
                            ? "rgba(20, 184, 166, 0.2)"
                            : isCurrent
                            ? "rgba(20, 184, 166, 0.4)"
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
                          background: isDone ? "#14b8a6" : isCurrent ? "rgba(20, 184, 166, 0.25)" : "#282624",
                          color: isDone ? "#141312" : isCurrent ? "#5eead4" : "#736d62",
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

        {/* ─── Batch Investigation Summary Card (Part 2) ─── */}
        <AnimatePresence>
          {batchSummary && batchItems.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              style={{
                background: "#171615",
                border: "1px solid rgba(238, 231, 219, 0.14)",
                borderRadius: 16,
              }}
              className="p-5 space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[rgba(238, 231, 219, 0.08)]">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400 block mb-0.5">
                    Batch Investigation Summary
                  </span>
                  <h3 className="text-[16px] font-bold text-[#f4efe6] m-0">
                    Processed {batchSummary.total} Suspect Video{batchSummary.total > 1 ? "s" : ""}
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={handleResetScan}
                  className="px-3 py-1.5 rounded-lg bg-[#242220] hover:bg-[#2c2a27] text-[#ded7cb] hover:text-white text-[11px] font-semibold transition-colors cursor-pointer shrink-0"
                >
                  New Investigation
                </button>
              </div>

              {/* Aggregate KPI Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {[
                  { label: "Total Selected", val: batchSummary.total, color: "text-[#f4efe6]" },
                  { label: "Completed", val: batchSummary.completed, color: "text-teal-400" },
                  { label: "Matches Found", val: batchSummary.matches, color: batchSummary.matches > 0 ? "text-amber-400" : "text-[#aba497]" },
                  { label: "Clean / Clean", val: batchSummary.clean, color: "text-emerald-400" },
                  { label: "Failed", val: batchSummary.failed, color: batchSummary.failed > 0 ? "text-red-400" : "text-[#aba497]" },
                ].map((kpi) => (
                  <div
                    key={kpi.label}
                    style={{ background: "#1e1d1b", borderRadius: 10 }}
                    className="p-3 border border-[rgba(238,231,219,0.08)] text-center"
                  >
                    <span className="text-[9px] uppercase tracking-wider text-[#8e887d] block mb-1">
                      {kpi.label}
                    </span>
                    <span className={`text-xl font-extrabold ${kpi.color}`}>{kpi.val}</span>
                  </div>
                ))}
              </div>

              {/* Per-Video Result List */}
              <div className="space-y-2 pt-1">
                <h4 className="text-[12px] font-bold text-[#aba497] m-0 uppercase tracking-wider">
                  Individual Video Findings
                </h4>

                <div className="space-y-2">
                  {batchItems.map((item, idx) => {
                    const res = item.result;
                    const hasMatch = (res?.candidate_matches_found ?? 0) > 0;

                    return (
                      <div
                        key={item.id}
                        style={{
                          background: "#1a1918",
                          border: `1px solid ${
                            item.status === "failed"
                              ? "rgba(239, 68, 68, 0.3)"
                              : hasMatch
                              ? "rgba(212, 163, 115, 0.3)"
                              : "rgba(238, 231, 219, 0.08)"
                          }`,
                          borderRadius: 12,
                        }}
                        className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 truncate">
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 8,
                              background:
                                item.status === "failed"
                                  ? "rgba(239, 68, 68, 0.15)"
                                  : hasMatch
                                  ? "rgba(212, 163, 115, 0.15)"
                                  : "rgba(20, 184, 166, 0.15)",
                              color:
                                item.status === "failed"
                                  ? "#f87171"
                                  : hasMatch
                                  ? "#dfa974"
                                  : "#5eead4",
                            }}
                            className="flex items-center justify-center shrink-0 font-bold text-[12px]"
                          >
                            #{idx + 1}
                          </div>

                          <div className="truncate">
                            <div className="flex items-center gap-2">
                              <p className="text-[13px] font-bold text-[#f4efe6] truncate m-0">
                                {item.file.name}
                              </p>
                              <span className="text-[10px] text-[#8e887d] font-mono shrink-0">
                                ({formatBytes(item.file.size)})
                              </span>
                            </div>

                            <p className="text-[11px] text-[#aba497] mt-0.5 m-0">
                              {item.status === "completed" && res ? (
                                <span>
                                  Status: <strong className="text-white">{res.overall_status.replace(/_/g, " ")}</strong> •{" "}
                                  Peak Confidence: <strong className="text-white">{res.highest_confidence}%</strong> •{" "}
                                  Matches: <strong className="text-white">{res.candidate_matches_found} frame(s)</strong>
                                </span>
                              ) : item.status === "failed" ? (
                                <span className="text-red-400">Failed: {item.error}</span>
                              ) : item.status === "cancelled" ? (
                                <span className="text-[#8e887d]">Investigation cancelled</span>
                              ) : (
                                <span>Queued in batch...</span>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Actions per item */}
                        <div className="flex items-center gap-2 shrink-0">
                          {item.status === "completed" && res && (
                            <button
                              type="button"
                              onClick={() => onViewIncident(res)}
                              className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                            >
                              <span>View Investigation Dossier</span>
                              <ExternalLink size={12} />
                            </button>
                          )}

                          {item.status === "failed" && (
                            <button
                              type="button"
                              onClick={() => handleRetryItem(idx)}
                              disabled={isScanActive}
                              className="px-3 py-1.5 rounded-lg bg-[#242220] hover:bg-[#2c2a27] text-amber-300 text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <RefreshCw size={12} />
                              <span>Retry Video</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── Single Completed Scan Result Card (URL Screening or Single File) ─── */}
        <AnimatePresence>
          {scanState === "completed" && scanResult && !batchSummary && (
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
                    {scanResult.metadata?.title ||
                      scanResult.suspect_filename ||
                      `Suspect ${scanResult.submitted_asset_id.slice(0, 8)}`}
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

        {/* Default Idle State */}
        {scanState === "idle" && suspectFiles.length === 0 && !batchSummary && (
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
                  ? `Select up to 3 suspect broadcast files or paste a public URL above. FixProof will extract keyframes and query the FAISS reference vault containing ${vaultStatus?.vault_size ?? 0} visual vectors.`
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

        {/* ─── 4. Collapsible Technical Log ─── */}
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
                <Activity size={13} className="text-teal-400" />
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
              <div className="p-3.5 pt-0 space-y-1.5 border-t border-[rgba(238,231,219,0.08)] max-h-56 overflow-y-auto font-mono text-[11px]">
                {events.map((evt) => (
                  <div
                    key={evt.id}
                    style={{
                      background:
                        evt.type === "match"
                          ? "rgba(212, 163, 115, 0.12)"
                          : evt.type === "error"
                          ? "rgba(239, 68, 68, 0.1)"
                          : evt.type === "warning"
                          ? "rgba(245, 158, 11, 0.1)"
                          : "#141312",
                    }}
                    className="p-2 rounded flex items-start gap-2 border border-[rgba(238,231,219,0.04)]"
                  >
                    <span className="text-[#736d62] shrink-0 text-[10px]">{evt.timestamp}</span>
                    <span
                      className={
                        evt.type === "match"
                          ? "text-[#dfa974] font-bold"
                          : evt.type === "error"
                          ? "text-red-400 font-bold"
                          : evt.type === "warning"
                          ? "text-amber-400 font-bold"
                          : "text-[#ded7cb]"
                      }
                    >
                      {evt.text}
                    </span>
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
