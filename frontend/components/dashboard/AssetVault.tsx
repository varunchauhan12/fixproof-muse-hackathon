"use client";

import React, { useState, useRef } from "react";
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
  ArrowRight,
  ExternalLink,
} from "lucide-react";
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

  // Stats calculation
  const totalAssets = assets.length;
  const protectedAssets = assets.filter((a) => a.indexed).length;
  const totalVectors = vaultStatus?.vault_size ?? 0;

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
      // Simulate stages for responsive feedback during streaming
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
      }, 3500);
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
      const res = await indexAssetInVault(asset.asset_id);
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
    <div className="max-w-7xl mx-auto space-y-6">
      {/* ─── 1. Stats KPI Row (MediaGuard GSSoC card style) ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            label: "Assets Vaulted",
            value: totalAssets.toString(),
            color: "#6366f1",
            sub: `${assets.length} official reference items`,
          },
          {
            label: "Total Vectors",
            value: totalVectors > 0 ? totalVectors.toLocaleString() : "0",
            color: "#a855f7",
            sub: "576-dim MobileNetV3 embeddings",
          },
          {
            label: "Protected References",
            value: protectedAssets.toString(),
            color: "#0d9488",
            sub: `${totalAssets - protectedAssets} awaiting indexing`,
          },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              background: "#ffffff",
              borderRadius: 16,
              padding: "18px 20px",
              border: "1px solid rgba(148, 163, 184, 0.2)",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.03)",
            }}
            className="transition-transform hover:-translate-y-0.5"
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              {card.label}
            </p>
            <p
              style={{ color: card.color }}
              className="text-3xl font-black tracking-tight leading-none my-1"
            >
              {card.value}
            </p>
            <p className="text-[11px] text-slate-500">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* ─── 2. Ingest Official Content Form ─── */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: 20,
          padding: "22px 24px",
          border: "1px solid rgba(148, 163, 184, 0.2)",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.03)",
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-[16px] font-extrabold text-slate-900 m-0">
              Ingest Official Content
            </h2>
            <p className="text-[12px] text-slate-500 mt-1 max-w-2xl leading-relaxed">
              The FixProof Archivist extracts 1 frame every 5s, embeds each through MobileNetV3 (576-dim L2-normalized), and registers vectors into the persistent FAISS vault with synchronized frame timestamps.
            </p>
          </div>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            style={{
              border: "1px solid rgba(148, 163, 184, 0.25)",
            }}
            className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-50 text-[11px] font-semibold transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin-smooth" : ""} />
            <span>Sync Vault</span>
          </button>
        </div>

        <form onSubmit={handleIngest} className="space-y-4">
          {/* Drag & Drop File Zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: selectedFile
                ? "2px solid #0d9488"
                : "2px dashed rgba(148, 163, 184, 0.35)",
              background: selectedFile ? "rgba(13, 148, 136, 0.03)" : "#f8fafc",
              borderRadius: 14,
            }}
            className="p-6 text-center cursor-pointer transition-all hover:bg-slate-50"
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
                <FileVideo size={28} className="text-teal-600 shrink-0" />
                <div className="text-left">
                  <p className="text-[13px] font-bold text-slate-900 truncate max-w-md">
                    {selectedFile.name}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {formatBytes(selectedFile.size)} • Click or drop to change
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <UploadCloud size={32} className="mx-auto text-slate-400 mb-2 opacity-80" />
                <p className="text-[13px] font-bold text-slate-700 m-0">
                  Click to select reference video or drag and drop
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Supported formats: MP4, MOV, AVI, MKV, WEBM, M4V, FLV, WMV, TS (Max 50 MB)
                </p>
              </div>
            )}
          </div>

          {/* Options & Action Row */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoIndex}
                onChange={(e) => setAutoIndex(e.target.checked)}
                className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500 border-slate-300"
              />
              <span className="text-[12px] font-medium text-slate-700">
                Auto-index visual vectors into FAISS reference vault immediately
              </span>
            </label>

            <button
              type="submit"
              disabled={!selectedFile || ingestStage !== "idle"}
              style={{
                background:
                  !selectedFile || ingestStage !== "idle"
                    ? "rgba(148, 163, 184, 0.2)"
                    : "linear-gradient(135deg, #0d9488, #2dd4bf)",
                boxShadow:
                  !selectedFile || ingestStage !== "idle"
                    ? "none"
                    : "0 4px 14px rgba(13, 148, 136, 0.3)",
              }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-[13px] text-white transition-all disabled:text-slate-400 disabled:cursor-not-allowed cursor-pointer"
            >
              {ingestStage !== "idle" ? (
                <>
                  <Loader2 size={14} className="animate-spin-smooth" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={16} />
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
              background: "#f8fafc",
              border: "1px solid rgba(13, 148, 136, 0.25)",
              borderRadius: 14,
            }}
            className="mt-4 p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Loader2 size={14} className="text-teal-600 animate-spin-smooth" />
              <span className="text-[11px] font-bold text-teal-700 uppercase tracking-wider">
                Ingestion Pipeline Active
              </span>
            </div>

            <div className="flex items-center justify-between max-w-lg mx-auto py-2">
              {[
                { key: "uploading", label: "Upload Stream" },
                { key: "extracting", label: "Frame Extraction (5s)" },
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
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          background: isDone
                            ? "#0d9488"
                            : isCurrent
                            ? "rgba(13, 148, 136, 0.15)"
                            : "#e2e8f0",
                          border: `2px solid ${isDone || isCurrent ? "#0d9488" : "#cbd5e1"}`,
                          color: isDone ? "#ffffff" : isCurrent ? "#0d9488" : "#94a3b8",
                        }}
                        className="flex items-center justify-center text-[10px] font-bold"
                      >
                        {isDone ? <CheckCircle2 size={13} /> : idx + 1}
                      </div>
                      <span
                        style={{
                          color: isDone ? "#0d9488" : isCurrent ? "#0f172a" : "#94a3b8",
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
                          background: isDone ? "#0d9488" : "#cbd5e1",
                          height: 2,
                          flex: 1,
                          margin: "0 8px 16px 8px",
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
              background: "rgba(239, 68, 68, 0.06)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              color: "#ef4444",
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
              background: "rgba(13, 148, 136, 0.08)",
              border: "1px solid rgba(13, 148, 136, 0.25)",
              color: "#0d9488",
              borderRadius: 10,
            }}
            className="mt-3 p-3 flex items-center gap-2 text-[12px] font-semibold"
          >
            <CheckCircle2 size={15} className="shrink-0" />
            <span>{ingestSuccess}</span>
          </div>
        )}

        {actionError && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.06)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              color: "#ef4444",
              borderRadius: 10,
            }}
            className="mt-3 p-3 flex items-center gap-2 text-[12px] font-medium"
          >
            <AlertTriangle size={15} className="shrink-0" />
            <span>{actionError}</span>
          </div>
        )}
      </div>

      {/* ─── 3. Registered Assets Section ─── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-[15px] font-extrabold text-slate-900 m-0">
              Registered Reference Vault
            </h3>
            <span
              style={{
                background: "rgba(99, 102, 241, 0.08)",
                border: "1px solid rgba(99, 102, 241, 0.2)",
                color: "#6366f1",
              }}
              className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide"
            >
              {assets.length} official assets
            </span>
            {vaultStatus?.is_cloud ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                Supabase Cloud (PostgreSQL + Storage)
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                Local Mode (Filesystem)
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-slate-500 hidden sm:inline">
              {protectedAssets} of {totalAssets} indexed for matching
            </span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              title="Fetch latest library state from backend"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin text-teal-600" : "text-slate-500"} />
              <span>{refreshing ? "Refreshing..." : "Refresh Library"}</span>
            </button>
          </div>
        </div>

        {/* Empty State */}
        {assets.length === 0 ? (
          <div
            style={{
              background: "#ffffff",
              borderRadius: 20,
              border: "1px dashed rgba(148, 163, 184, 0.35)",
            }}
            className="text-center py-16 px-4"
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                background: "rgba(99, 102, 241, 0.08)",
              }}
              className="mx-auto flex items-center justify-center text-indigo-500 mb-3"
            >
              <Database size={26} />
            </div>
            <p className="text-[15px] font-bold text-slate-800 m-0">Reference Vault is Empty</p>
            <p className="text-[12px] text-slate-500 mt-1 max-w-sm mx-auto">
              Upload an official broadcast or video using the ingestion control above to generate the first reference fingerprints.
            </p>
          </div>
        ) : (
          /* Assets Grid (MediaGuard style cards) */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {assets.map((asset) => {
              const isIndexed = asset.indexed;
              const hasVideo = Boolean(asset.video_url);

              return (
                <div
                  key={asset.asset_id}
                  style={{
                    background: "#ffffff",
                    borderRadius: 18,
                    overflow: "hidden",
                    border: "1px solid rgba(148, 163, 184, 0.2)",
                    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.03)",
                  }}
                  className="flex flex-col transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  {/* Thumbnail & Badges */}
                  <div
                    style={{ aspectRatio: "16/9", background: "#0f172a" }}
                    className="relative overflow-hidden group select-none"
                  >
                    {asset.thumbnail_url ? (
                      <img
                        src={`${API_BASE}${asset.thumbnail_url}`}
                        alt={asset.filename}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-600">
                        <FileVideo size={36} />
                      </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />

                    {/* Status Badge */}
                    <div className="absolute top-2.5 right-2.5">
                      <span
                        style={{
                          background: isIndexed
                            ? "rgba(13, 148, 136, 0.9)"
                            : "rgba(245, 158, 11, 0.9)",
                          backdropFilter: "blur(6px)",
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider text-white shadow-sm"
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

                    {/* Frame count badge */}
                    <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5">
                      <span
                        style={{
                          background: "rgba(15, 23, 42, 0.8)",
                          backdropFilter: "blur(6px)",
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold text-white"
                      >
                        <Layers size={10} className="text-indigo-400" />
                        <span>{asset.frame_count} frames</span>
                      </span>

                      {asset.duration_seconds > 0 && (
                        <span
                          style={{
                            background: "rgba(15, 23, 42, 0.8)",
                            backdropFilter: "blur(6px)",
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold text-slate-300"
                        >
                          <Clock size={10} />
                          <span>{formatDuration(asset.duration_seconds)}</span>
                        </span>
                      )}
                    </div>

                    {/* Video preview hover trigger */}
                    {hasVideo && (
                      <button
                        onClick={() => setPreviewingVideoAsset(asset)}
                        title="Play video"
                        className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-white/80 hover:bg-white text-slate-900 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                      >
                        <Play size={16} className="ml-0.5" />
                      </button>
                    )}
                  </div>

                  {/* Body Content */}
                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div>
                      <p
                        title={asset.filename}
                        className="text-[13px] font-bold text-slate-900 truncate mb-1"
                      >
                        {asset.filename}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono truncate mb-3">
                        ID: {asset.asset_id}
                      </p>

                      {/* Technical Specs Grid */}
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        <div
                          style={{ background: "#f8fafc", borderRadius: 10 }}
                          className="p-2 border border-slate-100"
                        >
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                            FAISS Vectors
                          </span>
                          <span
                            style={{ color: isIndexed ? "#6366f1" : "#94a3b8" }}
                            className="text-[13px] font-extrabold"
                          >
                            {asset.indexed_vectors > 0 ? asset.indexed_vectors : "0"}
                          </span>
                        </div>

                        <div
                          style={{ background: "#f8fafc", borderRadius: 10 }}
                          className="p-2 border border-slate-100"
                        >
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                            File Size
                          </span>
                          <span className="text-[13px] font-extrabold text-slate-700">
                            {formatBytes(asset.file_size)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            setInspectingAsset(asset);
                            setActiveFrameIndex(0);
                          }}
                          style={{ border: "1px solid rgba(148, 163, 184, 0.25)" }}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-50 text-[11px] font-semibold transition-colors"
                        >
                          <Eye size={12} />
                          <span>Sampled Frames</span>
                        </button>

                        {!isIndexed && (
                          <button
                            onClick={() => handleIndexAsset(asset)}
                            disabled={indexingAssetId === asset.asset_id}
                            style={{
                              background: "rgba(13, 148, 136, 0.1)",
                              border: "1px solid rgba(13, 148, 136, 0.3)",
                              color: "#0d9488",
                            }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold hover:bg-teal-50 transition-colors disabled:opacity-50"
                          >
                            {indexingAssetId === asset.asset_id ? (
                              <Loader2 size={12} className="animate-spin-smooth" />
                            ) : (
                              <ShieldCheck size={12} />
                            )}
                            <span>Index Vault</span>
                          </button>
                        )}
                      </div>

                      <button
                        onClick={() => setDeletingAsset(asset)}
                        title="Delete asset from vault"
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── 4. Inspect Sampled Frames Modal ─── */}
      {inspectingAsset && (
        <div
          style={{ background: "rgba(15, 23, 42, 0.65)", backdropFilter: "blur(6px)" }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setInspectingAsset(null)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 20,
              maxWidth: 900,
              width: "100%",
              maxHeight: "90vh",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
            }}
            className="flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h4 className="text-[15px] font-extrabold text-slate-900 m-0">
                  Sampled Frames — {inspectingAsset.filename}
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  1 frame sampled every 5s • MobileNetV3 576-dim L2 embeddings
                </p>
              </div>
              <button
                onClick={() => setInspectingAsset(null)}
                className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {inspectingAsset.frames.length > 0 ? (
                <>
                  {/* Large Active Frame View */}
                  <div
                    style={{ background: "#090d16", borderRadius: 14 }}
                    className="relative overflow-hidden aspect-video flex items-center justify-center border border-slate-800"
                  >
                    <img
                      src={`${API_BASE}${inspectingAsset.frames[activeFrameIndex]?.url}`}
                      alt={`Frame at ${inspectingAsset.frames[activeFrameIndex]?.timestamp_sec}s`}
                      className="max-h-full max-w-full object-contain"
                    />

                    <div className="absolute top-3 left-3 bg-black/70 backdrop-blur px-2.5 py-1 rounded text-[11px] font-mono text-teal-400 font-bold">
                      Timestamp: {inspectingAsset.frames[activeFrameIndex]?.timestamp_sec}s
                    </div>

                    <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur px-2.5 py-1 rounded text-[11px] font-mono text-slate-300">
                      {inspectingAsset.frames[activeFrameIndex]?.filename}
                    </div>
                  </div>

                  {/* Frame Thumbnails Strip */}
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                      Extracted Frame Timeline ({inspectingAsset.frames.length} total)
                    </p>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {inspectingAsset.frames.map((frame, idx) => (
                        <button
                          key={frame.filename}
                          onClick={() => setActiveFrameIndex(idx)}
                          style={{
                            border:
                              idx === activeFrameIndex
                                ? "2px solid #0d9488"
                                : "1px solid rgba(148, 163, 184, 0.3)",
                            borderRadius: 10,
                          }}
                          className="shrink-0 overflow-hidden w-28 bg-slate-900 text-left transition-all hover:opacity-90"
                        >
                          <img
                            src={`${API_BASE}${frame.url}`}
                            alt={frame.filename}
                            className="w-full aspect-video object-cover"
                          />
                          <div className="p-1.5 text-[10px] font-mono text-slate-300 flex justify-between">
                            <span>{frame.timestamp_sec}s</span>
                            <span className="text-slate-500">#{idx}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-10 text-slate-400 text-[13px]">
                  No frames found on storage for this asset.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-[12px] text-slate-500">
                Indexed status:{" "}
                <strong style={{ color: inspectingAsset.indexed ? "#0d9488" : "#f59e0b" }}>
                  {inspectingAsset.indexed ? "Vaulted in FAISS" : "Unindexed"}
                </strong>
              </span>

              {inspectingAsset.video_url && (
                <button
                  onClick={() => {
                    setPreviewingVideoAsset(inspectingAsset);
                    setInspectingAsset(null);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[12px] font-bold"
                >
                  <Play size={13} />
                  <span>Play Original Video</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── 5. Video Player Modal ─── */}
      {previewingVideoAsset && (
        <div
          style={{ background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(6px)" }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewingVideoAsset(null)}
        >
          <div
            style={{
              background: "#090d16",
              borderRadius: 20,
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
                onClick={() => setPreviewingVideoAsset(null)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 bg-black flex justify-center">
              <video
                controls
                autoPlay
                src={`${API_BASE}${previewingVideoAsset.video_url}`}
                className="max-h-[70vh] w-full rounded"
              >
                Your browser does not support HTML5 video streaming.
              </video>
            </div>
          </div>
        </div>
      )}

      {/* ─── 6. Delete Confirmation Dialog (MediaGuard style) ─── */}
      {deletingAsset && (
        <div
          style={{ background: "rgba(15, 23, 42, 0.65)", backdropFilter: "blur(4px)" }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !isDeleting && setDeletingAsset(null)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 20,
              maxWidth: 420,
              width: "100%",
              padding: "24px 24px 20px",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
              }}
              className="flex items-center justify-center text-red-500 mb-4"
            >
              <Trash2 size={22} />
            </div>

            <h4 className="text-[16px] font-extrabold text-slate-900 m-0 mb-1.5">
              Delete from Vault?
            </h4>
            <p className="text-[13px] text-slate-600 mb-3 leading-relaxed">
              <strong className="text-slate-900">{deletingAsset.filename}</strong> will be permanently removed from FixProof.
            </p>
            <div
              style={{
                background: "rgba(239, 68, 68, 0.06)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                color: "#dc2626",
                borderRadius: 10,
              }}
              className="p-3 text-[11px] leading-relaxed mb-5"
            >
              ⚠️ This operation permanently deletes the stored video, its extracted frames, and removes all its vector embeddings from the FAISS reference vault.
            </div>

            <div className="flex gap-2.5">
              <button
                onClick={() => setDeletingAsset(null)}
                disabled={isDeleting}
                className="flex-1 py-2 rounded-xl border border-slate-300 text-slate-700 text-[13px] font-bold hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[13px] font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 shadow-md shadow-red-500/20"
              >
                {isDeleting ? (
                  <>
                    <Loader2 size={14} className="animate-spin-smooth" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
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
