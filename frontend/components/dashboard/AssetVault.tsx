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
  HardDrive,
  Trash2,
  Play,
  X,
  Eye,
  ShieldCheck,
  FileVideo,
  Search,
  Filter,
  Check,
  Info,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AssetRecord, VaultStatus, FrameRecord } from "@/lib/types";
import {
  API_BASE,
  ingestReferenceVideo,
  indexAssetInVault,
  deleteAssetFromVault,
  formatBytes,
  formatDuration,
} from "@/lib/api";

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
  // Ingest form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [autoIndex, setAutoIndex] = useState<boolean>(true);
  const [ingestStage, setIngestStage] = useState<IngestStage>("idle");
  const [ingestError, setIngestError] = useState<string>("");
  const [ingestSuccess, setIngestSuccess] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterMode, setFilterMode] = useState<"all" | "indexed" | "unindexed">("all");

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

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setIngestError("");
      setIngestSuccess("");
    }
  };

  // Handle drag and drop
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
      setIngestError("");
      setIngestSuccess("");
    }
  };

  // Handle ingest submission
  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setIngestError("Please select a video file to ingest.");
      return;
    }

    setIngestError("");
    setIngestSuccess("");
    setIngestStage("uploading");

    try {
      const t1 = setTimeout(() => setIngestStage("extracting"), 800);
      const t2 = setTimeout(() => {
        if (autoIndex) setIngestStage("embedding");
      }, 2200);

      const result = await ingestReferenceVideo(selectedFile, autoIndex);

      clearTimeout(t1);
      clearTimeout(t2);
      setIngestStage("complete");

      const framesCount = result.frame_count || result.frames?.length || 0;
      const vecCount = result.indexed_vectors ?? (autoIndex ? framesCount : 0);

      setIngestSuccess(
        `Successfully ingested "${result.filename}". Extracted ${framesCount} frames${
          autoIndex ? ` and vaulted ${vecCount} visual embeddings` : ""
        }.`
      );

      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onRefresh();

      setTimeout(() => {
        setIngestStage("idle");
      }, 4000);
    } catch (err: any) {
      setIngestStage("idle");
      setIngestError(err.message || "Failed to ingest reference video. Please check backend connection.");
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
    <div className="max-w-7xl mx-auto space-y-6 text-slate-100">
      {/* ─── Compact Top Bar / Status Header ─── */}
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
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
              <Database size={12} className="text-indigo-400" />
              <span>Reference Vault</span>
            </span>

            {vaultStatus?.is_cloud ? (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-900 text-slate-300 border border-slate-800">
                Supabase Cloud (PostgreSQL + S3 Storage)
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-900 text-slate-300 border border-slate-800">
                Local Mode (Filesystem Storage)
              </span>
            )}
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white m-0">
            Digital Asset Vault
          </h1>
          <p className="text-[13px] text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Protected reference broadcast library. Each official video is sampled every 5s and indexed into FAISS with 576-dim L2 MobileNetV3 visual vectors.
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            background: "#131826",
            border: "1px solid rgba(255, 255, 255, 0.09)",
          }}
          className="self-start sm:self-auto flex items-center gap-2 px-3.5 py-2 rounded-xl text-slate-200 hover:text-white hover:border-slate-700 text-[12px] font-semibold transition-colors disabled:opacity-50 cursor-pointer shrink-0"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin text-teal-400" : "text-slate-400"} />
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
            accent: "#6366f1",
            icon: Database,
          },
          {
            label: "FAISS Vectors Vaulted",
            value: totalVectors > 0 ? totalVectors.toLocaleString() : "0",
            sub: "576-dim MobileNetV3 embeddings",
            accent: "#14b8a6",
            icon: Layers,
          },
          {
            label: "Protected References",
            value: protectedAssets.toString(),
            sub: `${totalAssets - protectedAssets} awaiting indexation`,
            accent: "#10b981",
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
                background: "#0c101b",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 14,
              }}
              className="p-4 sm:p-5 flex flex-col justify-between hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    {card.label}
                  </p>
                  <p className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white m-0">
                    {card.value}
                  </p>
                </div>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: `${card.accent}14`,
                    border: `1px solid ${card.accent}30`,
                    color: card.accent,
                  }}
                  className="flex items-center justify-center shrink-0"
                >
                  <Icon size={18} />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-800/80">
                {card.sub}
              </p>
            </motion.div>
          );
        })}
      </div>

      {/* ─── Concise & Prominent Ingestion Section ─── */}
      <div
        style={{
          background: "#0c101b",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 16,
        }}
        className="p-5"
      >
        <div className="mb-3.5">
          <h2 className="text-[15px] font-bold text-white m-0 tracking-tight">
            Ingest Official Reference Content
          </h2>
          <p className="text-[12px] text-slate-400 mt-0.5 leading-relaxed">
            The FixProof ingest pipeline decodes reference video, samples 1 frame every 5s, computes 576-dim L2-normalized embeddings, and registers vectors into the FAISS index with synchronized timestamps.
          </p>
        </div>

        <form onSubmit={handleIngest} className="space-y-4">
          {/* Drag & Drop Upload Zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: selectedFile
                ? "2px solid #0d9488"
                : "2px dashed rgba(255, 255, 255, 0.12)",
              background: selectedFile ? "rgba(13, 148, 136, 0.05)" : "#0f1523",
              borderRadius: 12,
            }}
            className="p-6 text-center cursor-pointer transition-all hover:bg-slate-800/40 hover:border-slate-600"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp4,.mov,.avi,.mkv,.webm,.m4v,.flv,.wmv,.ts,.3gp,.ogg,.ogv,video/*"
              onChange={handleFileChange}
              className="hidden"
            />
            {selectedFile ? (
              <div className="flex items-center justify-center gap-3">
                <FileVideo size={28} className="text-teal-400 shrink-0" />
                <div className="text-left">
                  <p className="text-[13px] font-bold text-white truncate max-w-md m-0">
                    {selectedFile.name}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 m-0">
                    {formatBytes(selectedFile.size)} • Click or drop another file to replace
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <UploadCloud size={30} className="mx-auto text-slate-400 mb-2 opacity-80" />
                <p className="text-[13px] font-semibold text-slate-200 m-0">
                  Select official reference video or drag and drop
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  MP4, MOV, AVI, MKV, WEBM, M4V, FLV, WMV, TS (Max 500 MB)
                </p>
              </div>
            )}
          </div>

          {/* Options & Action Row */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoIndex}
                onChange={(e) => setAutoIndex(e.target.checked)}
                className="w-4 h-4 rounded text-teal-600 bg-slate-900 border-slate-700 focus:ring-teal-500"
              />
              <span className="text-[12px] text-slate-300 font-medium">
                Auto-index visual vectors into FAISS reference vault immediately
              </span>
            </label>

            <button
              type="submit"
              disabled={!selectedFile || ingestStage !== "idle"}
              style={{
                background:
                  !selectedFile || ingestStage !== "idle"
                    ? "#1a2234"
                    : "#0d9488",
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-[12px] text-white transition-all disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer shadow-sm hover:bg-teal-600"
            >
              {ingestStage !== "idle" ? (
                <>
                  <Loader2 size={13} className="animate-spin text-teal-300" />
                  <span>Processing Stream...</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={15} />
                  <span>Ingest Reference Video</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Progress Pipeline Visualization */}
        {ingestStage !== "idle" && (
          <div
            style={{
              background: "#111522",
              border: "1px solid rgba(13, 148, 136, 0.3)",
              borderRadius: 12,
            }}
            className="mt-4 p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Loader2 size={13} className="text-teal-400 animate-spin" />
              <span className="text-[11px] font-bold text-teal-300 uppercase tracking-wider">
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
                            ? "#0d9488"
                            : isCurrent
                            ? "rgba(13, 148, 136, 0.2)"
                            : "#1e293b",
                          border: `2px solid ${isDone || isCurrent ? "#0d9488" : "#334155"}`,
                          color: isDone ? "#ffffff" : isCurrent ? "#2dd4bf" : "#64748b",
                        }}
                        className="flex items-center justify-center text-[10px] font-bold"
                      >
                        {isDone ? <Check size={12} /> : idx + 1}
                      </div>
                      <span
                        style={{
                          color: isDone ? "#2dd4bf" : isCurrent ? "#f1f5f9" : "#64748b",
                          fontWeight: isCurrent || isDone ? 700 : 500,
                        }}
                        className="text-[9px] uppercase tracking-wider whitespace-nowrap"
                      >
                        {step.label}
                      </span>
                    </div>

                    {idx < 3 && (
                      <div
                        style={{
                          background: isDone ? "#0d9488" : "#334155",
                          height: 2,
                          flex: 1,
                          margin: "0 8px 14px 8px",
                        }}
                        className="transition-colors duration-300"
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* Alerts */}
        {ingestError && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#f87171",
              borderRadius: 10,
            }}
            className="mt-3 p-3 flex items-center gap-2 text-[12px] font-medium"
          >
            <AlertTriangle size={15} className="shrink-0" />
            <span>{ingestError}</span>
          </div>
        )}

        {ingestSuccess && (
          <div
            style={{
              background: "rgba(13, 148, 136, 0.12)",
              border: "1px solid rgba(13, 148, 136, 0.3)",
              color: "#2dd4bf",
              borderRadius: 10,
            }}
            className="mt-3 p-3 flex items-center gap-2 text-[12px] font-medium"
          >
            <CheckCircle2 size={15} className="shrink-0" />
            <span>{ingestSuccess}</span>
          </div>
        )}

        {actionError && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#f87171",
              borderRadius: 10,
            }}
            className="mt-3 p-3 flex items-center gap-2 text-[12px] font-medium"
          >
            <AlertTriangle size={15} className="shrink-0" />
            <span>{actionError}</span>
          </div>
        )}
      </div>

      {/* ─── Registered Reference Assets Section ─── */}
      <div className="space-y-4">
        {/* Section Header with Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-[15px] font-bold text-white m-0">
              Registered Reference Vault
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 uppercase">
              {filteredAssets.length} of {assets.length} items
            </span>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Search Input */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search reference assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: "#111522",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                }}
                className="w-48 sm:w-56 pl-8 pr-2.5 py-1.5 rounded-lg text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-teal-500"
              />
            </div>

            {/* Status Filter */}
            <div className="flex items-center p-0.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px]">
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  filterMode === "all" ? "bg-slate-800 text-white font-bold" : "text-slate-400 hover:text-white"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("indexed")}
                className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  filterMode === "indexed" ? "bg-slate-800 text-teal-300 font-bold" : "text-slate-400 hover:text-white"
                }`}
              >
                Vaulted
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("unindexed")}
                className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  filterMode === "unindexed" ? "bg-slate-800 text-amber-300 font-bold" : "text-slate-400 hover:text-white"
                }`}
              >
                Pending
              </button>
            </div>
          </div>
        </div>

        {/* Empty State */}
        {filteredAssets.length === 0 ? (
          <div
            style={{
              background: "#0c101b",
              borderRadius: 16,
              border: "1px dashed rgba(255, 255, 255, 0.12)",
            }}
            className="text-center py-16 px-4"
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: "rgba(99, 102, 241, 0.1)",
              }}
              className="mx-auto flex items-center justify-center text-indigo-400 mb-3"
            >
              <Database size={22} />
            </div>
            <p className="text-[14px] font-bold text-slate-200 m-0">
              {assets.length === 0 ? "Reference Vault is Empty" : "No matching assets found"}
            </p>
            <p className="text-[12px] text-slate-400 mt-1 max-w-sm mx-auto">
              {assets.length === 0
                ? "Upload an official broadcast using the ingestion control above to generate reference fingerprints."
                : "Try adjusting your search query or filter to view registered reference assets."}
            </p>
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
                    background: "#0c101b",
                    borderRadius: 14,
                    overflow: "hidden",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                  }}
                  className="flex flex-col hover:border-slate-700 transition-colors"
                >
                  {/* Smaller Thumbnail with Consistent 16:9 Aspect Ratio (max-height clamped) */}
                  <div
                    style={{
                      aspectRatio: "16/9",
                      maxHeight: "140px",
                      background: "#070a12",
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
                      <div className="w-full h-full flex items-center justify-center text-slate-600">
                        <FileVideo size={28} />
                      </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />

                    {/* Status Badge */}
                    <div className="absolute top-2 right-2">
                      <span
                        style={{
                          background: isIndexed
                            ? "rgba(13, 148, 136, 0.85)"
                            : "rgba(245, 158, 11, 0.85)",
                          backdropFilter: "blur(6px)",
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-white"
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
                          background: "rgba(11, 15, 25, 0.85)",
                          backdropFilter: "blur(4px)",
                        }}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold text-slate-200"
                      >
                        <Layers size={9} className="text-teal-400" />
                        <span>{asset.frame_count} frames</span>
                      </span>

                      {asset.duration_seconds > 0 && (
                        <span
                          style={{
                            background: "rgba(11, 15, 25, 0.85)",
                            backdropFilter: "blur(4px)",
                          }}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold text-slate-300"
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
                        className="absolute inset-0 m-auto w-9 h-9 rounded-full bg-teal-500/90 hover:bg-teal-400 text-slate-950 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md cursor-pointer"
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
                        className="text-[12px] font-bold text-slate-100 truncate mb-0.5"
                      >
                        {asset.filename}
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono truncate mb-2.5">
                        ID: {asset.asset_id.slice(0, 12)}...
                      </p>

                      {/* Technical Specs Row */}
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div
                          style={{ background: "#111522", borderRadius: 8 }}
                          className="p-1.5 px-2 border border-slate-800"
                        >
                          <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                            FAISS Vectors
                          </span>
                          <span
                            style={{ color: isIndexed ? "#2dd4bf" : "#64748b" }}
                            className="text-[12px] font-bold"
                          >
                            {asset.indexed_vectors > 0 ? asset.indexed_vectors : "0"}
                          </span>
                        </div>

                        <div
                          style={{ background: "#111522", borderRadius: 8 }}
                          className="p-1.5 px-2 border border-slate-800"
                        >
                          <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                            File Size
                          </span>
                          <span className="text-[12px] font-bold text-slate-300">
                            {formatBytes(asset.file_size)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setInspectingAsset(asset);
                            setActiveFrameIndex(0);
                          }}
                          style={{ border: "1px solid rgba(255, 255, 255, 0.08)" }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 text-[10px] font-semibold transition-colors cursor-pointer"
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
                              background: "rgba(13, 148, 136, 0.15)",
                              border: "1px solid rgba(13, 148, 136, 0.3)",
                              color: "#2dd4bf",
                            }}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold hover:bg-teal-900/40 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {indexingAssetId === asset.asset_id ? (
                              <Loader2 size={11} className="animate-spin text-teal-400" />
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
                        className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-950/40 rounded transition-colors cursor-pointer"
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
          style={{ background: "rgba(5, 8, 15, 0.8)", backdropFilter: "blur(6px)" }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setInspectingAsset(null)}
        >
          <div
            style={{
              background: "#0c101b",
              borderRadius: 18,
              maxWidth: 900,
              width: "100%",
              maxHeight: "90vh",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
            }}
            className="flex flex-col overflow-hidden text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h4 className="text-[14px] font-bold text-white m-0">
                  Sampled Frames — {inspectingAsset.filename}
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5 m-0">
                  1 frame sampled every 5s • MobileNetV3 576-dim L2 embeddings
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingAsset(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
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
                    style={{ background: "#050810", borderRadius: 12 }}
                    className="relative overflow-hidden aspect-video flex items-center justify-center border border-slate-800 max-h-[50vh]"
                  >
                    <img
                      src={`${API_BASE}${inspectingAsset.frames[activeFrameIndex]?.url}`}
                      alt={`Frame at ${inspectingAsset.frames[activeFrameIndex]?.timestamp_sec}s`}
                      className="max-h-full max-w-full object-contain"
                    />

                    <div className="absolute top-2.5 left-2.5 bg-black/80 backdrop-blur px-2.5 py-1 rounded text-[10px] font-mono text-teal-400 font-bold border border-slate-800">
                      Timestamp: {inspectingAsset.frames[activeFrameIndex]?.timestamp_sec}s
                    </div>

                    <div className="absolute bottom-2.5 right-2.5 bg-black/80 backdrop-blur px-2.5 py-1 rounded text-[10px] font-mono text-slate-300 border border-slate-800">
                      {inspectingAsset.frames[activeFrameIndex]?.filename}
                    </div>
                  </div>

                  {/* Frame Thumbnails Strip */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
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
                                ? "2px solid #0d9488"
                                : "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: 8,
                          }}
                          className="shrink-0 overflow-hidden w-24 bg-slate-900 text-left transition-all hover:opacity-90 cursor-pointer"
                        >
                          <img
                            src={`${API_BASE}${frame.url}`}
                            alt={frame.filename}
                            className="w-full aspect-video object-cover"
                          />
                          <div className="p-1 text-[9px] font-mono text-slate-400 flex justify-between">
                            <span>{frame.timestamp_sec}s</span>
                            <span className="text-slate-500">#{idx}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-10 text-slate-500 text-[12px]">
                  No frames found on storage for this reference asset.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                Index status:{" "}
                <strong style={{ color: inspectingAsset.indexed ? "#2dd4bf" : "#fbbf24" }}>
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-bold transition-colors cursor-pointer"
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
          style={{ background: "rgba(5, 8, 15, 0.85)", backdropFilter: "blur(6px)" }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewingVideoAsset(null)}
        >
          <div
            style={{
              background: "#0c101b",
              borderRadius: 18,
              maxWidth: 800,
              width: "100%",
              overflow: "hidden",
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between text-white">
              <span className="text-[13px] font-bold truncate max-w-lg">
                {previewingVideoAsset.filename}
              </span>
              <button
                type="button"
                onClick={() => setPreviewingVideoAsset(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X size={17} />
              </button>
            </div>
            <div className="p-4 bg-black flex justify-center">
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
          style={{ background: "rgba(5, 8, 15, 0.8)", backdropFilter: "blur(4px)" }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !isDeleting && setDeletingAsset(null)}
        >
          <div
            style={{
              background: "#0c101b",
              borderRadius: 18,
              maxWidth: 420,
              width: "100%",
              padding: "22px 24px 20px",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
              }}
              className="flex items-center justify-center text-red-400 mb-3.5"
            >
              <Trash2 size={20} />
            </div>

            <h4 className="text-[15px] font-bold text-white m-0 mb-1.5">
              Delete from Reference Vault?
            </h4>
            <p className="text-[12px] text-slate-300 mb-3 leading-relaxed">
              <strong className="text-white">{deletingAsset.filename}</strong> will be permanently removed from FixProof.
            </p>
            <div
              style={{
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                color: "#f87171",
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
                className="flex-1 py-2 rounded-xl border border-slate-700 text-slate-300 text-[12px] font-semibold hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-[12px] font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 shadow-md cursor-pointer"
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
