"use client";

import React, { useState, useRef, useMemo } from "react";
import {
  Database,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Layers,
  Clock,
  Trash2,
  Play,
  X,
  Eye,
  ShieldCheck,
  FileVideo,
  Search,
  Calendar,
  LayoutGrid,
  Plus,
} from "lucide-react";
import { motion } from "framer-motion";
import CardStack, { DeckCard } from "@/components/kokonutui/card-stack";
import { AssetRecord, VaultStatus } from "@/lib/types";
import {
  API_BASE,
  ingestReferenceVideo,
  indexAssetInVault,
  deleteAssetFromVault,
  formatBytes,
  formatDuration,
} from "@/lib/api";
import { useActivity } from "@/context/ActivityContext";

interface AssetVaultProps {
  assets: AssetRecord[];
  vaultStatus: VaultStatus | null;
  onRefresh: () => void;
  refreshing: boolean;
}

type IngestStage = "idle" | "uploading" | "extracting" | "embedding" | "complete";

export const AssetVault: React.FC<AssetVaultProps> = ({
  assets,
  vaultStatus,
  onRefresh,
  refreshing,
}) => {
  const { addTask, updateTask } = useActivity();

  // Ingest form state (max 3 files per upload batch)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [autoIndex, setAutoIndex] = useState<boolean>(true);
  const [ingestStage, setIngestStage] = useState<IngestStage>("idle");
  const [ingestError, setIngestError] = useState<string>("");
  const [ingestSuccess, setIngestSuccess] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Search, filter, and layout state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterMode, setFilterMode] = useState<"all" | "indexed" | "unindexed">("all");
  const [viewLayout, setViewLayout] = useState<"stacks" | "grid">("stacks");

  // Per-asset action state
  const [indexingAssetId, setIndexingAssetId] = useState<string | null>(null);
  const [deletingAsset, setDeletingAsset] = useState<AssetRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>("");

  // Inspect frames modal state
  const [inspectingAsset, setInspectingAsset] = useState<AssetRecord | null>(null);
  const [activeFrameIndex, setActiveFrameIndex] = useState<number>(0);

  // Video preview modal state
  const [previewingVideoAsset, setPreviewingVideoAsset] = useState<AssetRecord | null>(null);

  // Stats calculation from genuine API data
  const totalAssets = assets.length;
  const protectedAssets = assets.filter((a) => a.indexed).length;
  const totalVectors = vaultStatus?.vault_size ?? 0;

  // Filtered assets
  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      const matchesSearch =
        asset.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
        asset.asset_id.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;
      if (filterMode === "indexed") return asset.indexed;
      if (filterMode === "unindexed") return !asset.indexed;
      return true;
    });
  }, [assets, searchQuery, filterMode]);

  // Date-grouped assets for CardStack presentation
  const dateGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        dateKey: string;
        dateLabel: string;
        timestampMs: number;
        assets: AssetRecord[];
      }
    >();

    for (const asset of filteredAssets) {
      const rawDate = asset.uploaded_at || (asset as any).created_at;
      let dateKey = "unknown";
      let dateLabel = "Date unavailable";
      let timestampMs = 0;

      if (rawDate) {
        try {
          const d = new Date(rawDate);
          if (!isNaN(d.getTime())) {
            dateKey = d.toISOString().split("T")[0]; // YYYY-MM-DD
            dateLabel = d.toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            });
            timestampMs = d.getTime();
          }
        } catch {
          // fallback
        }
      }

      if (!groups.has(dateKey)) {
        groups.set(dateKey, {
          dateKey,
          dateLabel,
          timestampMs,
          assets: [],
        });
      }
      groups.get(dateKey)!.assets.push(asset);
    }

    // Sort groups in reverse chronological order (newest date first)
    const result = Array.from(groups.values()).sort((a, b) => b.timestampMs - a.timestampMs);

    // Sort assets within each group newest first
    for (const g of result) {
      g.assets.sort((a, b) => {
        const ta = new Date(a.uploaded_at || 0).getTime();
        const tb = new Date(b.uploaded_at || 0).getTime();
        return tb - ta;
      });
    }

    return result;
  }, [filteredAssets]);

  const MAX_VAULT_FILES = 3;
  const MAX_VAULT_FILE_SIZE = 500 * 1024 * 1024;
  const ALLOWED_VAULT_EXTS = [
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

  const validateAndAddVaultFiles = (incomingList: FileList | File[]) => {
    if (ingestStage !== "idle") return;
    setIngestError("");
    setIngestSuccess("");

    const newFiles = Array.from(incomingList);
    if (newFiles.length === 0) return;

    if (selectedFiles.length + newFiles.length > MAX_VAULT_FILES) {
      setIngestError(
        `Maximum 3 reference videos permitted per upload batch. You currently have ${selectedFiles.length} selected and attempted to add ${newFiles.length}. Please select no more than 3 videos.`
      );
      return;
    }

    const validated: File[] = [];
    for (const file of newFiles) {
      const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
      const isAllowed = ALLOWED_VAULT_EXTS.includes(ext) || file.type.startsWith("video/");
      if (!isAllowed) {
        setIngestError(
          `Unsupported format for "${file.name}". Supported formats: MP4, MOV, AVI, MKV, WEBM, M4V, FLV, WMV, TS.`
        );
        return;
      }
      if (file.size > MAX_VAULT_FILE_SIZE) {
        setIngestError(
          `File "${file.name}" (${formatBytes(file.size)}) exceeds the 500 MB maximum limit.`
        );
        return;
      }
      const isDuplicate =
        selectedFiles.some((f) => f.name === file.name && f.size === file.size) ||
        validated.some((f) => f.name === file.name && f.size === file.size);
      if (!isDuplicate) {
        validated.push(file);
      }
    }

    if (validated.length > 0) {
      setSelectedFiles((prev) => [...prev, ...validated]);
    }
  };

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      validateAndAddVaultFiles(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Handle drag and drop
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (ingestStage !== "idle") return;
    if (e.dataTransfer.files) {
      validateAndAddVaultFiles(e.dataTransfer.files);
    }
  };

  const handleRemoveFile = (index: number) => {
    if (ingestStage !== "idle") return;
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setIngestError("");
  };

  // Handle ingest submission sequentially (Part 3)
  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) {
      setIngestError("Please select at least one reference video to ingest.");
      return;
    }

    setIngestError("");
    setIngestSuccess("");
    setIngestStage("uploading");

    const islandTaskId = addTask({
      label: "Reference Vault Ingestion",
      detail: `Queued ${selectedFiles.length} reference video${selectedFiles.length > 1 ? "s" : ""}...`,
      status: "running",
    });

    const successSummaries: string[] = [];
    const failSummaries: { name: string; error: string }[] = [];

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      updateTask(islandTaskId, {
        detail: `Ingesting reference video ${i + 1} of ${selectedFiles.length}: "${file.name}"`,
        status: "running",
      });

      try {
        const result = await ingestReferenceVideo(file, autoIndex);
        const framesCount = result.frame_count || result.frames?.length || 0;
        const vecCount = result.indexed_vectors ?? (autoIndex ? framesCount : 0);
        successSummaries.push(
          `"${result.filename}" (${framesCount} frames${autoIndex ? `, ${vecCount} vectors` : ""})`
        );
      } catch (err: any) {
        failSummaries.push({
          name: file.name,
          error: err?.message || "Ingest failed",
        });
      }
    }

    setIngestStage("idle");
    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onRefresh();

    if (failSummaries.length === 0) {
      setIngestSuccess(
        `Successfully ingested ${successSummaries.length} reference video${
          successSummaries.length > 1 ? "s" : ""
        }: ${successSummaries.join("; ")}.`
      );
      updateTask(islandTaskId, {
        status: "done",
        detail: `Successfully vaulted ${successSummaries.length} reference video(s)`,
      });
    } else if (successSummaries.length > 0) {
      setIngestSuccess(
        `Ingested ${successSummaries.length} reference video(s). ${failSummaries.length} failed: ${failSummaries
          .map((f) => `${f.name} (${f.error})`)
          .join(", ")}.`
      );
      updateTask(islandTaskId, {
        status: "done",
        detail: `Partial ingest: ${successSummaries.length} vaulted, ${failSummaries.length} failed`,
      });
    } else {
      const errText = `All ${failSummaries.length} reference video uploads failed: ${failSummaries
        .map((f) => `${f.name}: ${f.error}`)
        .join("; ")}`;
      setIngestError(errText);
      updateTask(islandTaskId, {
        status: "error",
        detail: `Ingestion failed: ${failSummaries[0]?.error || "Backend error"}`,
      });
    }
  };

  // Handle Index single asset
  const handleIndexAsset = async (asset: AssetRecord) => {
    setIndexingAssetId(asset.asset_id);
    setActionError("");
    try {
      await indexAssetInVault(asset.asset_id);
      onRefresh();
    } catch (err: any) {
      setActionError(err.message || `Failed to index asset "${asset.filename}".`);
    } finally {
      setIndexingAssetId(null);
    }
  };

  // Handle delete asset confirmation
  const handleConfirmDelete = async () => {
    if (!deletingAsset) return;
    setIsDeleting(true);
    setActionError("");
    try {
      await deleteAssetFromVault(deletingAsset.asset_id);
      setDeletingAsset(null);
      onRefresh();
    } catch (err: any) {
      setActionError(err.message || "Failed to remove asset from vault.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 text-[#ded7cb]">
      {/* ─── Compact Top Bar / Status Header ─── */}
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
              <Database size={12} className="text-[#eee7db]" />
              <span>Reference Vault</span>
            </span>

            {vaultStatus?.is_cloud ? (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#1e1d1b] text-[#aba497] border border-[rgba(238,231,219,0.08)]">
                Supabase Cloud (PostgreSQL + S3 Storage)
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#1e1d1b] text-[#aba497] border border-[rgba(238,231,219,0.08)]">
                Local Mode (Filesystem Storage)
              </span>
            )}
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#f4efe6] m-0">
            Digital Asset Vault
          </h1>
          <p className="text-[13px] text-[#aba497] mt-1 max-w-2xl leading-relaxed">
            Protected reference broadcast library. Each official video is sampled every 5s and indexed into FAISS with 576-dim L2 MobileNetV3 visual vectors.
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            background: "#1e1d1b",
            border: "1px solid rgba(238, 231, 219, 0.1)",
            color: "#ded7cb",
          }}
          className="self-start sm:self-auto flex items-center gap-2 px-3.5 py-2 rounded-xl hover:text-[#f4efe6] hover:bg-[#262422] text-[12px] font-medium transition-colors disabled:opacity-50 cursor-pointer shrink-0"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin text-[#eee7db]" : ""} />
          <span>{refreshing ? "Syncing..." : "Sync Vault"}</span>
        </button>
      </div>

      {/* ─── Summary KPI Metrics Row (3 cards) ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            label: "Reference Assets",
            value: totalAssets.toString(),
            sub: `${totalAssets} official reference items`,
            icon: Database,
          },
          {
            label: "FAISS Vectors Vaulted",
            value: totalVectors > 0 ? totalVectors.toLocaleString() : "0",
            sub: "576-dim MobileNetV3 embeddings",
            icon: Layers,
          },
          {
            label: "Protected References",
            value: protectedAssets.toString(),
            sub: `${totalAssets - protectedAssets} awaiting indexation`,
            icon: ShieldCheck,
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.label}
              whileHover={{ y: -2 }}
              transition={{ duration: 0.18 }}
              style={{
                background: "#171615",
                border: "1px solid rgba(238, 231, 219, 0.08)",
                borderRadius: 14,
              }}
              className="p-4 sm:p-5 flex flex-col justify-between hover:border-[rgba(238,231,219,0.16)] transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8e887d] mb-1">
                    {card.label}
                  </p>
                  <p className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#f4efe6] m-0">
                    {card.value}
                  </p>
                </div>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: "rgba(238, 231, 219, 0.06)",
                    border: "1px solid rgba(238, 231, 219, 0.1)",
                    color: "#eee7db",
                  }}
                  className="flex items-center justify-center shrink-0"
                >
                  <Icon size={17} />
                </div>
              </div>
              <p className="text-[11px] text-[#8e887d] mt-3 pt-3 border-t border-[rgba(238,231,219,0.08)]">
                {card.sub}
              </p>
            </motion.div>
          );
        })}
      </div>

      {/* ─── Concise & Prominent Ingestion Section ─── */}
      <div
        style={{
          background: "#171615",
          border: "1px solid rgba(238, 231, 219, 0.08)",
          borderRadius: 16,
        }}
        className="p-5"
      >
        <div className="mb-3.5">
          <h2 className="text-[15px] font-bold text-[#f4efe6] m-0 tracking-tight">
            Ingest Official Reference Content
          </h2>
          <p className="text-[12px] text-[#aba497] mt-0.5 leading-relaxed">
            The FixProof ingest pipeline decodes reference video, samples 1 frame every 5s, computes 576-dim L2-normalized embeddings, and registers vectors into the FAISS index with synchronized timestamps.
          </p>
        </div>

        <form onSubmit={handleIngest} className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.mov,.avi,.mkv,.webm,.m4v,.flv,.wmv,.ts,.3gp,.ogg,.ogv,video/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />

          {selectedFiles.length === 0 ? (
            /* Drag & Drop Upload Zone */
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: "2px dashed rgba(238, 231, 219, 0.12)",
                background: "#1a1918",
                borderRadius: 12,
              }}
              className="p-6 text-center cursor-pointer transition-all hover:bg-[#201f1d] hover:border-teal-500/30"
            >
              <UploadCloud size={30} className="mx-auto text-teal-400 mb-2 opacity-80" />
              <p className="text-[13px] font-semibold text-[#f4efe6] m-0">
                Select official reference videos or drag and drop (Max 3 videos)
              </p>
              <p className="text-[11px] text-[#736d62] mt-1">
                MP4, MOV, AVI, MKV, WEBM, M4V, FLV, WMV, TS (Max 500 MB per video)
              </p>
            </div>
          ) : (
            /* Selected Reference Files Container */
            <div
              style={{
                background: "#1a1918",
                border: "1px solid rgba(238, 231, 219, 0.12)",
                borderRadius: 12,
              }}
              className="p-4 space-y-3"
            >
              <div className="flex items-center justify-between text-[12px] pb-1 border-b border-[rgba(238,231,219,0.06)]">
                <span className="font-bold text-[#f4efe6]">
                  {selectedFiles.length} / {MAX_VAULT_FILES} reference videos selected{" "}
                  <span className="text-[#8e887d] font-mono text-[11px]">
                    ({formatBytes(selectedFiles.reduce((acc, f) => acc + f.size, 0))} total)
                  </span>
                </span>

                <div className="flex items-center gap-2">
                  {selectedFiles.length < MAX_VAULT_FILES && ingestStage === "idle" && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1 rounded bg-[#242220] hover:bg-[#2c2a27] text-teal-300 hover:text-white text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Plus size={12} />
                      <span>Add Video</span>
                    </button>
                  )}
                  {ingestStage === "idle" && (
                    <button
                      type="button"
                      onClick={() => setSelectedFiles([])}
                      className="px-2 py-1 text-[#8e887d] hover:text-[#f4efe6] text-[11px] cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {selectedFiles.map((file, idx) => (
                  <div
                    key={`${file.name}-${idx}`}
                    style={{
                      background: "#171615",
                      border: "1px solid rgba(238, 231, 219, 0.1)",
                      borderRadius: 10,
                    }}
                    className="p-3 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 7,
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

                    {ingestStage === "idle" && (
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(idx)}
                        className="text-[#8e887d] hover:text-red-400 p-1 rounded cursor-pointer shrink-0"
                        title="Remove reference video"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Options & Action Row */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoIndex}
                onChange={(e) => setAutoIndex(e.target.checked)}
                className="w-4 h-4 rounded text-teal-500 bg-[#1a1918] border-[rgba(238,231,219,0.2)] focus:ring-0"
              />
              <span className="text-[12px] text-[#ded7cb] font-medium">
                Auto-index visual vectors into FAISS reference vault immediately
              </span>
            </label>

            <button
              type="submit"
              disabled={selectedFiles.length === 0 || ingestStage !== "idle"}
              style={{
                background:
                  selectedFiles.length === 0 || ingestStage !== "idle"
                    ? "#242220"
                    : "#eee7db",
                color:
                  selectedFiles.length === 0 || ingestStage !== "idle"
                    ? "#736d62"
                    : "#141312",
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-[12px] transition-all disabled:cursor-not-allowed cursor-pointer shadow-sm hover:opacity-95"
            >
              {ingestStage !== "idle" ? (
                <>
                  <Loader2 size={13} className="animate-spin text-[#eee7db]" />
                  <span>Ingesting Batch...</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={15} />
                  <span>
                    Ingest {selectedFiles.length > 0 ? `${selectedFiles.length} Video${selectedFiles.length > 1 ? "s" : ""}` : "Reference Video"}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Progress Pipeline Visualization */}
        {ingestStage !== "idle" && (
          <div
            style={{
              background: "#1a1918",
              border: "1px solid rgba(238, 231, 219, 0.12)",
              borderRadius: 12,
            }}
            className="mt-4 p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Loader2 size={13} className="text-[#eee7db] animate-spin" />
              <span className="text-[11px] font-bold text-[#f4efe6] uppercase tracking-wider">
                Ingestion Pipeline Active
              </span>
            </div>

            <div className="flex items-center justify-between max-w-lg mx-auto py-2">
              {[
                { key: "uploading", label: "Upload Stream" },
                { key: "extracting", label: "5s Frame Sampling" },
                { key: "embedding", label: "MobileNetV3 (576-dim)" },
                { key: "complete", label: "FAISS Vaulted" },
              ].map((step, idx) => {
                const stageOrder = ["idle", "uploading", "extracting", "embedding", "complete"];
                const currentIdx = stageOrder.indexOf(ingestStage);
                const stepIdx = stageOrder.indexOf(step.key);
                const isDone = currentIdx > stepIdx || ingestStage === "complete";
                const isCurrent = currentIdx === stepIdx;

                return (
                  <React.Fragment key={step.key}>
                    <div className="flex flex-col items-center gap-1.5 text-center">
                      <div
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          background: isDone
                            ? "#eee7db"
                            : isCurrent
                            ? "rgba(238, 231, 219, 0.15)"
                            : "#242220",
                          color: isDone ? "#141312" : isCurrent ? "#f4efe6" : "#736d62",
                          border: isCurrent
                            ? "2px solid #eee7db"
                            : "1px solid rgba(238, 231, 219, 0.1)",
                        }}
                        className="flex items-center justify-center text-[10px] font-bold shrink-0"
                      >
                        {isDone ? "✓" : idx + 1}
                      </div>
                      <span className="text-[10px] text-[#8e887d] max-w-[80px]">
                        {step.label}
                      </span>
                    </div>

                    {idx < 3 && (
                      <div
                        style={{
                          height: 2,
                          flex: 1,
                          background: isDone ? "#eee7db" : "#242220",
                        }}
                        className="mx-1 mt-[-14px]"
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* Feedback Messages */}
        {ingestSuccess && (
          <div
            style={{
              background: "rgba(238, 231, 219, 0.08)",
              border: "1px solid rgba(238, 231, 219, 0.18)",
              color: "#f4efe6",
              borderRadius: 10,
            }}
            className="mt-3 p-3 flex items-center gap-2 text-[12px]"
          >
            <CheckCircle2 size={15} className="text-[#eee7db] shrink-0" />
            <span>{ingestSuccess}</span>
          </div>
        )}

        {ingestError && (
          <div
            style={{
              background: "rgba(212, 163, 115, 0.12)",
              border: "1px solid rgba(212, 163, 115, 0.25)",
              color: "#d4a373",
              borderRadius: 10,
            }}
            className="mt-3 p-3 flex items-center gap-2 text-[12px]"
          >
            <AlertTriangle size={15} className="shrink-0" />
            <span>{ingestError}</span>
          </div>
        )}
      </div>

      {/* Action Error Banner */}
      {actionError && (
        <div
          style={{
            background: "rgba(212, 163, 115, 0.12)",
            border: "1px solid rgba(212, 163, 115, 0.25)",
            color: "#d4a373",
            borderRadius: 10,
          }}
          className="p-3 flex items-center justify-between text-[12px]"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            onClick={() => setActionError("")}
            className="text-[#8e887d] hover:text-[#f4efe6]"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ─── Registered Reference Assets Section ─── */}
      <div className="space-y-4">
        {/* Section Header with Search & Filter */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-[16px] font-bold text-[#f4efe6] m-0">
              Registered Reference Assets
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#1e1d1b] text-[#aba497] border border-[rgba(238,231,219,0.08)] uppercase">
              {filteredAssets.length} of {assets.length} items
            </span>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Search Input */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#736d62]" />
              <input
                type="text"
                placeholder="Search reference assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: "#1e1d1b",
                  border: "1px solid rgba(238, 231, 219, 0.1)",
                  color: "#f4efe6",
                }}
                className="w-48 sm:w-56 pl-8 pr-2.5 py-1.5 rounded-lg text-[11px] placeholder-[#736d62] focus:outline-none focus:border-[#eee7db]"
              />
            </div>

            {/* Status Filter */}
            <div className="flex items-center p-0.5 rounded-lg bg-[#1a1918] border border-[rgba(238,231,219,0.08)] text-[11px]">
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  filterMode === "all" ? "bg-[#282624] text-[#f4efe6] font-bold" : "text-[#8e887d] hover:text-[#f4efe6]"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("indexed")}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  filterMode === "indexed" ? "bg-[#282624] text-[#f4efe6] font-bold" : "text-[#8e887d] hover:text-[#f4efe6]"
                }`}
              >
                Vaulted
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("unindexed")}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  filterMode === "unindexed" ? "bg-[#282624] text-[#d4a373] font-bold" : "text-[#8e887d] hover:text-[#f4efe6]"
                }`}
              >
                Pending
              </button>
            </div>

            {/* View Layout Toggle (Date Stacks vs Grid View) */}
            <div className="flex items-center p-0.5 rounded-lg bg-[#1a1918] border border-[rgba(238,231,219,0.08)] text-[11px]">
              <button
                type="button"
                onClick={() => setViewLayout("stacks")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  viewLayout === "stacks" ? "bg-[#282624] text-teal-400 font-bold" : "text-[#8e887d] hover:text-[#f4efe6]"
                }`}
                title="Date-grouped animated card stacks"
              >
                <Layers size={12} />
                <span>Date Stacks</span>
              </button>
              <button
                type="button"
                onClick={() => setViewLayout("grid")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  viewLayout === "grid" ? "bg-[#282624] text-[#f4efe6] font-bold" : "text-[#8e887d] hover:text-[#f4efe6]"
                }`}
                title="Compact grid view"
              >
                <LayoutGrid size={12} />
                <span>Grid View</span>
              </button>
            </div>
          </div>
        </div>

        {/* Empty State */}
        {filteredAssets.length === 0 ? (
          <div
            style={{
              background: "#171615",
              borderRadius: 16,
              border: "1px dashed rgba(238, 231, 219, 0.12)",
            }}
            className="text-center py-16 px-4"
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
              className="mx-auto flex items-center justify-center mb-3"
            >
              <Database size={20} />
            </div>
            <p className="text-[14px] font-bold text-[#f4efe6] m-0">
              {assets.length === 0 ? "Reference Vault is Empty" : "No matching assets found"}
            </p>
            <p className="text-[12px] text-[#8e887d] mt-1 max-w-sm mx-auto">
              {assets.length === 0
                ? "Upload an official broadcast using the ingestion control above to generate reference fingerprints."
                : "Try adjusting your search query or filter to view registered reference assets."}
            </p>
          </div>
        ) : viewLayout === "stacks" ? (
          /* Date-Grouped Animated Card Stacks */
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {dateGroups.map((group) => {
                const groupCards: DeckCard[] = group.assets.map((asset) => ({
                  id: asset.asset_id,
                  title: asset.filename,
                  subtitle: `${asset.frame_count} frames · ${formatDuration(asset.duration_seconds)}`,
                  price: asset.indexed ? "VAULTED" : "UNINDEXED",
                  art: (
                    <div className="relative w-full h-full bg-[#121211] overflow-hidden rounded-xl flex items-center justify-center select-none">
                      {asset.thumbnail_url ? (
                        <img
                          src={`${API_BASE}${asset.thumbnail_url}`}
                          alt={asset.filename}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <FileVideo size={42} className="text-zinc-600" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/30 pointer-events-none" />
                      <div className="absolute top-2.5 right-2.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider backdrop-blur-md ${
                            asset.indexed
                              ? "bg-teal-500/20 text-teal-300 border border-teal-500/30"
                              : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          }`}
                        >
                          {asset.indexed ? "Vaulted" : "Unindexed"}
                        </span>
                      </div>
                      <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between text-[10px] text-zinc-300 font-mono">
                        <span className="bg-black/75 px-1.5 py-0.5 rounded border border-white/10">
                          {asset.frame_count} frames
                        </span>
                        {asset.duration_seconds > 0 && (
                          <span className="bg-black/75 px-1.5 py-0.5 rounded border border-white/10">
                            {formatDuration(asset.duration_seconds)}
                          </span>
                        )}
                      </div>
                    </div>
                  ),
                  description: `Asset ID: ${asset.asset_id}\nRegistered: ${
                    asset.uploaded_at ? new Date(asset.uploaded_at).toLocaleString() : "Recently"
                  }`,
                  specs: [
                    {
                      label: "Status",
                      value: asset.indexed ? "Indexed in FAISS" : "Pending Indexing",
                    },
                    {
                      label: "Vectors",
                      value: `${asset.indexed_vectors} vectors (576-dim)`,
                    },
                    {
                      label: "Duration",
                      value: formatDuration(asset.duration_seconds),
                    },
                    {
                      label: "Frames",
                      value: `${asset.frame_count} keyframes`,
                    },
                    {
                      label: "File Size",
                      value: formatBytes(asset.file_size),
                    },
                    {
                      label: "Sample Step",
                      value: `${asset.sample_interval_seconds}s interval`,
                    },
                  ],
                }));

                return (
                  <div
                    key={group.dateKey}
                    style={{
                      background: "#171615",
                      borderRadius: 16,
                      border: "1px solid rgba(238, 231, 219, 0.08)",
                    }}
                    className="p-5 flex flex-col justify-between"
                  >
                    {/* Date Stack Header */}
                    <div className="flex items-center justify-between pb-3 mb-2 border-b border-[rgba(238,231,219,0.06)]">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-teal-400" />
                        <span className="text-[13px] font-bold text-[#f4efe6]">
                          {group.dateLabel}
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[#1a1918] text-[#ded7cb] border border-[rgba(238,231,219,0.08)]">
                        {group.assets.length}{" "}
                        {group.assets.length === 1 ? "reference video" : "reference videos"}
                      </span>
                    </div>

                    {/* Animated CardStack */}
                    <div className="flex-1 flex items-center justify-center py-2">
                      <CardStack
                        key={`${group.dateKey}-${groupCards.length}`}
                        cards={groupCards}
                        accent="#14b8a6"
                        actionLabel="Inspect Keyframes"
                        onAction={(deckCard) => {
                          const asset = filteredAssets.find((a) => a.asset_id === deckCard.id);
                          if (asset) {
                            setInspectingAsset(asset);
                            setActiveFrameIndex(0);
                          }
                        }}
                        className="min-h-[25rem] max-w-sm py-4"
                      />
                    </div>

                    {/* Stack Footer Navigation Guide */}
                    <div className="pt-3 border-t border-[rgba(238,231,219,0.06)] flex items-center justify-between text-[11px] text-[#8e887d]">
                      <span>Drag or flick cards to cycle</span>
                      <span className="text-teal-400 font-medium">Click card for specs</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Compact Video Cards Grid (Visibly Smaller Video Previews) */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredAssets.map((asset) => {
              const isIndexed = asset.indexed;
              const hasVideo = Boolean(asset.video_url);

              return (
                <motion.div
                  key={asset.asset_id}
                  whileHover={{ y: -2 }}
                  transition={{ duration: 0.18 }}
                  style={{
                    background: "#171615",
                    borderRadius: 14,
                    overflow: "hidden",
                    border: "1px solid rgba(238, 231, 219, 0.08)",
                  }}
                  className="flex flex-col hover:border-[rgba(238,231,219,0.16)] transition-colors"
                >
                  {/* Smaller Thumbnail with Consistent 16:9 Aspect Ratio (max-height clamped) */}
                  <div
                    style={{
                      aspectRatio: "16/9",
                      maxHeight: "140px",
                      background: "#121211",
                    }}
                    className="relative overflow-hidden group select-none shrink-0"
                  >
                    {asset.thumbnail_url ? (
                      <img
                        src={`${API_BASE}${asset.thumbnail_url}`}
                        alt={asset.filename}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#736d62]">
                        <FileVideo size={28} />
                      </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />

                    {/* Status Badge */}
                    <div className="absolute top-2 right-2">
                      <span
                        style={{
                          background: isIndexed
                            ? "rgba(238, 231, 219, 0.15)"
                            : "rgba(212, 163, 115, 0.2)",
                          color: isIndexed ? "#f4efe6" : "#d4a373",
                          border: `1px solid ${
                            isIndexed
                              ? "rgba(238, 231, 219, 0.25)"
                              : "rgba(212, 163, 115, 0.35)"
                          }`,
                          backdropFilter: "blur(6px)",
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                      >
                        {isIndexed ? (
                          <>
                            <CheckCircle2 size={10} />
                            <span>Vaulted</span>
                          </>
                        ) : (
                          <>
                            <Clock size={10} />
                            <span>Unindexed</span>
                          </>
                        )}
                      </span>
                    </div>

                    {/* Frame count & duration badges */}
                    <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
                      <span
                        style={{
                          background: "rgba(20, 19, 18, 0.85)",
                          backdropFilter: "blur(4px)",
                          border: "1px solid rgba(238, 231, 219, 0.08)",
                        }}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium text-[#ded7cb]"
                      >
                        <Layers size={9} className="text-[#eee7db]" />
                        <span>{asset.frame_count} frames</span>
                      </span>

                      {asset.duration_seconds > 0 && (
                        <span
                          style={{
                            background: "rgba(20, 19, 18, 0.85)",
                            backdropFilter: "blur(4px)",
                            border: "1px solid rgba(238, 231, 219, 0.08)",
                          }}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium text-[#aba497]"
                        >
                          <Clock size={9} />
                          <span>{formatDuration(asset.duration_seconds)}</span>
                        </span>
                      )}
                    </div>

                    {/* Video preview hover trigger */}
                    {hasVideo && (
                      <button
                        type="button"
                        onClick={() => setPreviewingVideoAsset(asset)}
                        title="Play original video"
                        style={{
                          background: "#eee7db",
                          color: "#141312",
                        }}
                        className="absolute inset-0 m-auto w-9 h-9 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md cursor-pointer"
                      >
                        <Play size={14} className="ml-0.5 fill-current" />
                      </button>
                    )}
                  </div>

                  {/* Body Content */}
                  <div className="p-3.5 flex-1 flex flex-col justify-between">
                    <div>
                      <p
                        title={asset.filename}
                        className="text-[12px] font-semibold text-[#f4efe6] truncate mb-0.5"
                      >
                        {asset.filename}
                      </p>
                      <p className="text-[10px] text-[#736d62] font-mono truncate mb-2.5">
                        ID: {asset.asset_id.slice(0, 12)}...
                      </p>

                      {/* Technical Specs Row */}
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div
                          style={{ background: "#1e1d1b", borderRadius: 8 }}
                          className="p-1.5 px-2 border border-[rgba(238,231,219,0.06)]"
                        >
                          <span className="text-[8px] font-semibold uppercase tracking-wider text-[#8e887d] block mb-0.5">
                            FAISS Vectors
                          </span>
                          <span
                            style={{ color: isIndexed ? "#f4efe6" : "#736d62" }}
                            className="text-[12px] font-bold"
                          >
                            {asset.indexed_vectors > 0 ? asset.indexed_vectors : "0"}
                          </span>
                        </div>

                        <div
                          style={{ background: "#1e1d1b", borderRadius: 8 }}
                          className="p-1.5 px-2 border border-[rgba(238,231,219,0.06)]"
                        >
                          <span className="text-[8px] font-semibold uppercase tracking-wider text-[#8e887d] block mb-0.5">
                            File Size
                          </span>
                          <span className="text-[12px] font-bold text-[#ded7cb]">
                            {formatBytes(asset.file_size)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="pt-2 border-t border-[rgba(238,231,219,0.08)] flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setInspectingAsset(asset);
                            setActiveFrameIndex(0);
                          }}
                          style={{
                            border: "1px solid rgba(238, 231, 219, 0.1)",
                            background: "transparent",
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[#ded7cb] hover:text-[#f4efe6] hover:bg-[#22201e] text-[10px] font-medium transition-colors cursor-pointer"
                        >
                          <Eye size={11} />
                          <span>Frames</span>
                        </button>

                        {!isIndexed && (
                          <button
                            type="button"
                            onClick={() => handleIndexAsset(asset)}
                            disabled={indexingAssetId === asset.asset_id}
                            style={{
                              background: "#eee7db",
                              color: "#141312",
                            }}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold hover:bg-[#fbf7ef] transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {indexingAssetId === asset.asset_id ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <ShieldCheck size={11} />
                            )}
                            <span>Index</span>
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setDeletingAsset(asset)}
                        title="Delete asset from vault"
                        className="p-1 text-[#736d62] hover:text-red-400 hover:bg-red-950/30 rounded transition-colors cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Inspect Sampled Frames Modal ─── */}
      {inspectingAsset && (
        <div
          style={{ background: "rgba(18, 18, 17, 0.85)", backdropFilter: "blur(6px)" }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setInspectingAsset(null)}
        >
          <div
            style={{
              background: "#171615",
              borderRadius: 18,
              maxWidth: 900,
              width: "100%",
              maxHeight: "90vh",
              border: "1px solid rgba(238, 231, 219, 0.12)",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
            }}
            className="flex flex-col overflow-hidden text-[#ded7cb]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-[rgba(238,231,219,0.08)] flex items-center justify-between">
              <div>
                <h4 className="text-[14px] font-bold text-[#f4efe6] m-0">
                  Sampled Frames — {inspectingAsset.filename}
                </h4>
                <p className="text-[11px] text-[#8e887d] mt-0.5 m-0">
                  1 frame sampled every 5s • MobileNetV3 576-dim L2 embeddings
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingAsset(null)}
                className="p-1.5 text-[#8e887d] hover:text-[#f4efe6] rounded-lg hover:bg-[#242220] cursor-pointer"
              >
                <X size={17} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-5">
              {inspectingAsset.frames.length > 0 ? (
                <>
                  {/* Large Active Frame View */}
                  <div
                    style={{ background: "#121211", borderRadius: 12 }}
                    className="relative overflow-hidden aspect-video flex items-center justify-center border border-[rgba(238,231,219,0.08)] max-h-[50vh]"
                  >
                    <img
                      src={`${API_BASE}${inspectingAsset.frames[activeFrameIndex]?.url}`}
                      alt={`Frame at ${inspectingAsset.frames[activeFrameIndex]?.timestamp_sec}s`}
                      className="max-h-full max-w-full object-contain"
                    />

                    <div className="absolute top-2.5 left-2.5 bg-[#141312]/90 backdrop-blur px-2.5 py-1 rounded text-[10px] font-mono text-[#eee7db] font-bold border border-[rgba(238,231,219,0.1)]">
                      Timestamp: {inspectingAsset.frames[activeFrameIndex]?.timestamp_sec}s
                    </div>

                    <div className="absolute bottom-2.5 right-2.5 bg-[#141312]/90 backdrop-blur px-2.5 py-1 rounded text-[10px] font-mono text-[#ded7cb] border border-[rgba(238,231,219,0.1)]">
                      {inspectingAsset.frames[activeFrameIndex]?.filename}
                    </div>
                  </div>

                  {/* Frame Thumbnails Strip */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#8e887d] mb-2">
                      Extracted Frame Timeline ({inspectingAsset.frames.length} total)
                    </p>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {inspectingAsset.frames.map((frame, idx) => (
                        <button
                          key={frame.filename}
                          type="button"
                          onClick={() => setActiveFrameIndex(idx)}
                          style={{
                            border:
                              idx === activeFrameIndex
                                ? "2px solid #eee7db"
                                : "1px solid rgba(238, 231, 219, 0.1)",
                            borderRadius: 8,
                          }}
                          className="shrink-0 overflow-hidden w-24 bg-[#1a1918] text-left transition-all hover:opacity-90 cursor-pointer"
                        >
                          <img
                            src={`${API_BASE}${frame.url}`}
                            alt={frame.filename}
                            className="w-full aspect-video object-cover"
                          />
                          <div className="p-1 text-[9px] font-mono text-[#8e887d] flex justify-between">
                            <span>{frame.timestamp_sec}s</span>
                            <span className="text-[#736d62]">#{idx}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-10 text-[#736d62] text-[12px]">
                  No frames found on storage for this reference asset.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-[rgba(238,231,219,0.08)] bg-[#141312] flex items-center justify-between">
              <span className="text-[11px] text-[#8e887d]">
                Index status:{" "}
                <strong style={{ color: inspectingAsset.indexed ? "#f4efe6" : "#d4a373" }}>
                  {inspectingAsset.indexed ? "Vaulted in FAISS" : "Unindexed"}
                </strong>
              </span>

              {inspectingAsset.video_url && (
                <button
                  type="button"
                  onClick={() => {
                    setPreviewingVideoAsset(inspectingAsset);
                    setInspectingAsset(null);
                  }}
                  style={{
                    background: "#eee7db",
                    color: "#141312",
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-[#fbf7ef] text-[11px] font-bold transition-colors cursor-pointer"
                >
                  <Play size={12} className="fill-current" />
                  <span>Play Original Video</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Video Player Modal ─── */}
      {previewingVideoAsset && (
        <div
          style={{ background: "rgba(18, 18, 17, 0.85)", backdropFilter: "blur(6px)" }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewingVideoAsset(null)}
        >
          <div
            style={{
              background: "#171615",
              borderRadius: 18,
              maxWidth: 800,
              width: "100%",
              overflow: "hidden",
              border: "1px solid rgba(238, 231, 219, 0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-[rgba(238,231,219,0.08)] flex items-center justify-between text-[#f4efe6]">
              <span className="text-[13px] font-bold truncate max-w-lg">
                {previewingVideoAsset.filename}
              </span>
              <button
                type="button"
                onClick={() => setPreviewingVideoAsset(null)}
                className="text-[#8e887d] hover:text-[#f4efe6] cursor-pointer"
              >
                <X size={17} />
              </button>
            </div>
            <div className="p-4 bg-[#121211] flex justify-center">
              <video
                controls
                autoPlay
                src={`${API_BASE}${previewingVideoAsset.video_url}`}
                className="max-h-[65vh] w-full rounded"
              >
                Your browser does not support HTML5 video streaming.
              </video>
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete Confirmation Modal ─── */}
      {deletingAsset && (
        <div
          style={{ background: "rgba(18, 18, 17, 0.8)", backdropFilter: "blur(4px)" }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !isDeleting && setDeletingAsset(null)}
        >
          <div
            style={{
              background: "#171615",
              borderRadius: 18,
              maxWidth: 420,
              width: "100%",
              padding: "22px 24px 20px",
              border: "1px solid rgba(238, 231, 219, 0.12)",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.7)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "rgba(212, 163, 115, 0.12)",
                border: "1px solid rgba(212, 163, 115, 0.25)",
              }}
              className="flex items-center justify-center text-[#d4a373] mb-3.5"
            >
              <Trash2 size={20} />
            </div>

            <h4 className="text-[15px] font-bold text-[#f4efe6] m-0 mb-1.5">
              Delete from Reference Vault?
            </h4>
            <p className="text-[12px] text-[#ded7cb] mb-3 leading-relaxed">
              <strong className="text-[#f4efe6]">{deletingAsset.filename}</strong> will be permanently removed from FixProof.
            </p>
            <div
              style={{
                background: "rgba(212, 163, 115, 0.08)",
                border: "1px solid rgba(212, 163, 115, 0.2)",
                color: "#d4a373",
                borderRadius: 8,
              }}
              className="p-3 text-[11px] leading-relaxed mb-4"
            >
              This permanently deletes the stored video, its extracted frames, and strips all associated embeddings from the FAISS reference index.
            </div>

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setDeletingAsset(null)}
                disabled={isDeleting}
                className="flex-1 py-2 rounded-xl border border-[rgba(238,231,219,0.12)] text-[#ded7cb] text-[12px] font-semibold hover:bg-[#242220] transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 py-2 rounded-xl bg-red-800/80 hover:bg-red-700 text-white text-[12px] font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 shadow-md cursor-pointer"
              >
                {isDeleting ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={13} />
                    <span>Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetVault;
