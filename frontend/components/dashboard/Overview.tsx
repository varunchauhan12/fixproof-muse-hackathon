"use client";

import React, { useRef } from "react";
import {
  ShieldCheck,
  Database,
  Search,
  ShieldAlert,
  ArrowRight,
  Layers,
  Cpu,
  Hash,
  Sparkles,
  BrainCircuit,
  FileVideo,
  RefreshCw,
  ExternalLink,
  Activity,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Radio,
} from "lucide-react";
import { motion } from "framer-motion";
import { AssetRecord, VaultStatus, MatchAnalysisResult } from "@/lib/types";
import { formatBytes } from "@/lib/api";
import { Skiper61MouseFollow } from "@/components/ui/Skiper61MouseFollow";

interface OverviewProps {
  assets: AssetRecord[];
  vaultStatus: VaultStatus | null;
  incidents: MatchAnalysisResult[];
  onNavigateToTab: (tab: any) => void;
  onViewIncident?: (incident: MatchAnalysisResult) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export const Overview: React.FC<OverviewProps> = ({
  assets,
  vaultStatus,
  incidents,
  onNavigateToTab,
  onViewIncident,
  onRefresh,
  refreshing = false,
}) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const protectedCount = assets.filter((a) => a.indexed).length;
  const matchIncidents = incidents.filter((i) => i.candidate_matches_found > 0);
  const isOnline = Boolean(vaultStatus);

  // Calculate actual mean confidence across genuine candidate matches
  const avgConfidence =
    matchIncidents.length > 0
      ? (
          matchIncidents.reduce((sum, i) => sum + (i.highest_confidence || 0), 0) /
          matchIncidents.length
        ).toFixed(1)
      : null;

  // Genuine FixProof processing stages and subsystems
  const subsystems = [
    {
      id: "preflight",
      name: "Preflight Ingestion",
      technology: "OpenCV Stream Decoder",
      description: "Codec validation, safe path containment, 5s frame extraction",
      status: isOnline ? "Ready" : "Unavailable",
      statusType: isOnline ? "ready" : "offline",
      icon: FileVideo,
      accent: "#14b8a6",
    },
    {
      id: "mobilenet",
      name: "Feature Extractor",
      technology: "MobileNetV3 Penultimate",
      description: "576-dim L2-normalized visual embeddings",
      status: isOnline ? "Ready" : "Unavailable",
      statusType: isOnline ? "ready" : "offline",
      icon: Cpu,
      accent: "#6366f1",
    },
    {
      id: "faiss",
      name: "Vector Vault",
      technology: "FAISS IndexFlatL2",
      description: `Nearest-neighbor search across ${vaultStatus?.vault_size ?? 0} vectors`,
      status: isOnline ? `${vaultStatus?.vault_size ?? 0} Vectors` : "Unavailable",
      statusType: isOnline ? "ready" : "offline",
      icon: Database,
      accent: "#2dd4bf",
    },
    {
      id: "phash",
      name: "Perceptual Hash",
      technology: "64-bit DCT pHash",
      description: "Dual-layer secondary validation (Hamming distance < 15)",
      status: isOnline ? "Ready" : "Unavailable",
      statusType: isOnline ? "ready" : "offline",
      icon: Hash,
      accent: "#f59e0b",
    },
    {
      id: "vision",
      name: "Vision Verifier",
      technology: "Nemotron-3.5-Super-VL",
      description: "Multimodal verification for borderline match candidates",
      status: isOnline ? "Standby" : "Unavailable",
      statusType: isOnline ? "standby" : "offline",
      icon: Sparkles,
      accent: "#06b6d4",
    },
    {
      id: "reasoning",
      name: "Forensic Reasoning",
      technology: "Nemotron-3_5-Lightning",
      description: "Timeline clustering, statutory triage & signed dossier synthesis",
      status: isOnline ? "Standby" : "Unavailable",
      statusType: isOnline ? "standby" : "offline",
      icon: BrainCircuit,
      accent: "#a855f7",
    },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6 text-slate-100">
      {/* ─── Compact Top Section / Operations Bar with Skiper61 Localized Mouse-Follow ─── */}
      <div
        ref={headerRef}
        style={{
          background: "#0c101b",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 16,
        }}
        className="relative overflow-hidden p-5 sm:p-6"
      >
        {/* Skiper61 spring-based mouse follow effect (localized, non-blocking, attribution licensed) */}
        <Skiper61MouseFollow containerRef={headerRef} size={220} />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-teal-950/80 text-teal-300 border border-teal-800/60">
                <Radio size={12} className={isOnline ? "animate-pulse text-teal-400" : "text-slate-500"} />
                <span>{isOnline ? "Forensic Node Ready" : "Awaiting Backend"}</span>
              </span>

              {vaultStatus && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-900 text-slate-300 border border-slate-800">
                  {vaultStatus.is_cloud ? "Supabase Cloud Persistence" : "Local SQLite Mode"}
                </span>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white m-0">
              Forensic Command Overview
            </h1>
            <p className="text-[13px] text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Automated visual copyright investigation console. Ingest official broadcasts, maintain indexed FAISS embeddings, and run dual-layer forensic matching on suspect streams.
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2.5 shrink-0">
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={refreshing}
                title="Sync telemetry"
                style={{
                  background: "#131826",
                  border: "1px solid rgba(255, 255, 255, 0.09)",
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 text-[12px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw size={13} className={refreshing ? "animate-spin text-teal-400" : ""} />
                <span className="hidden sm:inline">Sync</span>
              </button>
            )}

            <button
              onClick={() => onNavigateToTab("vault")}
              style={{
                background: "#131826",
                border: "1px solid rgba(255, 255, 255, 0.09)",
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-slate-200 hover:text-white hover:border-slate-700 text-[12px] font-semibold transition-colors cursor-pointer"
            >
              <Database size={13} className="text-indigo-400" />
              <span>Asset Vault</span>
            </button>

            <button
              onClick={() => onNavigateToTab("hunter")}
              style={{
                background: "#0d9488",
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-white hover:bg-teal-600 text-[12px] font-semibold transition-colors shadow-sm cursor-pointer"
            >
              <Search size={13} />
              <span>Scan Suspect</span>
            </button>
          </div>
        </div>
      </div>

      {/* ─── Operational Metrics KPI Row (4 Cards) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Reference Assets",
            value: assets.length.toString(),
            sub: `${protectedCount} indexed in FAISS`,
            icon: Database,
            accent: "#6366f1",
          },
          {
            label: "FAISS Vector Vault",
            value: (vaultStatus?.vault_size ?? 0).toLocaleString(),
            sub: "576-dim L2 MobileNetV3 vectors",
            icon: Layers,
            accent: "#14b8a6",
          },
          {
            label: "Scanned Incidents",
            value: incidents.length.toString(),
            sub:
              matchIncidents.length > 0
                ? `${matchIncidents.length} candidate match alert(s)`
                : "No candidate matches detected",
            icon: Search,
            accent: matchIncidents.length > 0 ? "#f59e0b" : "#64748b",
          },
          {
            label: "Mean Match Score",
            value: avgConfidence ? `${avgConfidence}%` : "—",
            sub:
              matchIncidents.length > 0
                ? `Across ${matchIncidents.length} candidate match incident(s)`
                : "Dual-layer L2 + pHash engine ready",
            icon: ShieldCheck,
            accent: avgConfidence ? "#10b981" : "#64748b",
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.label}
              whileHover={{ y: -2 }}
              transition={{ duration: 0.2 }}
              style={{
                background: "#0c101b",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 14,
              }}
              className="p-4 sm:p-5 flex flex-col justify-between hover:border-slate-700/80 transition-colors"
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

      {/* ─── Compact Subsystem & Pipeline Status Section ─── */}
      <div
        style={{
          background: "#0c101b",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 16,
        }}
        className="p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-teal-400" />
            <h2 className="text-[14px] font-bold text-white m-0 tracking-tight">
              Forensic Subsystem Architecture & Heartbeat
            </h2>
          </div>
          <span className="text-[11px] text-slate-400 hidden sm:inline">
            FixProof Multimodal Pipeline
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {subsystems.map((sub) => {
            const Icon = sub.icon;
            const isReady = sub.statusType === "ready";
            const isStandby = sub.statusType === "standby";

            return (
              <motion.div
                key={sub.id}
                whileHover={{ y: -2 }}
                transition={{ duration: 0.18 }}
                style={{
                  background: "#111522",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  borderRadius: 12,
                }}
                className="p-3.5 flex flex-col justify-between hover:border-slate-700 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        background: `${sub.accent}14`,
                        border: `1px solid ${sub.accent}25`,
                        color: sub.accent,
                      }}
                      className="flex items-center justify-center shrink-0"
                    >
                      <Icon size={15} />
                    </div>

                    <span
                      style={{
                        background: isReady
                          ? "rgba(13, 148, 136, 0.15)"
                          : isStandby
                          ? "rgba(245, 158, 11, 0.15)"
                          : "rgba(100, 116, 139, 0.15)",
                        color: isReady
                          ? "#2dd4bf"
                          : isStandby
                          ? "#fbbf24"
                          : "#94a3b8",
                        border: `1px solid ${
                          isReady
                            ? "rgba(13, 148, 136, 0.3)"
                            : isStandby
                            ? "rgba(245, 158, 11, 0.3)"
                            : "rgba(100, 116, 139, 0.3)"
                        }`,
                      }}
                      className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                    >
                      {sub.status}
                    </span>
                  </div>

                  <p className="text-[12px] font-bold text-slate-100 m-0 leading-snug">
                    {sub.name}
                  </p>
                  <p className="text-[10px] text-teal-400 font-mono mt-0.5 mb-1.5 truncate">
                    {sub.technology}
                  </p>
                </div>

                <p className="text-[10px] text-slate-400 m-0 line-clamp-2 leading-relaxed">
                  {sub.description}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* ─── Two-Column Section: Reference Library + Recent Forensic Scans ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Registered Reference Library */}
        <div
          style={{
            background: "#0c101b",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 16,
          }}
          className="p-5 flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Database size={15} className="text-indigo-400" />
                <h3 className="text-[14px] font-bold text-white m-0">
                  Registered Reference Library
                </h3>
              </div>
              <button
                onClick={() => onNavigateToTab("vault")}
                className="text-[11px] font-semibold text-teal-400 hover:text-teal-300 flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>View all ({assets.length})</span>
                <ArrowRight size={11} />
              </button>
            </div>

            {assets.length === 0 ? (
              <div className="text-center py-10 text-slate-400">
                <Database size={28} className="mx-auto mb-2 text-slate-600 opacity-60" />
                <p className="text-[12px] font-medium m-0">No reference footage registered yet</p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto">
                  Upload an official broadcast in the Asset Vault to extract frames and index FAISS vectors.
                </p>
                <button
                  onClick={() => onNavigateToTab("vault")}
                  className="mt-3 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-teal-300 text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Open Asset Vault
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {assets.slice(0, 4).map((asset) => (
                  <div
                    key={asset.asset_id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:bg-slate-800/50 hover:border-slate-700/80 transition-colors"
                  >
                    <div className="flex items-center gap-3 truncate pr-2">
                      <div className="w-14 h-9 rounded bg-slate-950 overflow-hidden shrink-0 flex items-center justify-center border border-slate-800">
                        {asset.thumbnail_url ? (
                          <img
                            src={`http://localhost:8000${asset.thumbnail_url}`}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <FileVideo size={16} className="text-slate-600" />
                        )}
                      </div>
                      <div className="truncate">
                        <p className="text-[12px] font-semibold text-slate-200 truncate m-0">
                          {asset.filename}
                        </p>
                        <p className="text-[10px] text-slate-400 m-0">
                          {asset.frame_count} frames • {formatBytes(asset.file_size)} • {asset.indexed_vectors} vectors
                        </p>
                      </div>
                    </div>

                    <span
                      style={{
                        background: asset.indexed
                          ? "rgba(13, 148, 136, 0.15)"
                          : "rgba(245, 158, 11, 0.15)",
                        color: asset.indexed ? "#2dd4bf" : "#fbbf24",
                        border: `1px solid ${
                          asset.indexed
                            ? "rgba(13, 148, 136, 0.3)"
                            : "rgba(245, 158, 11, 0.3)"
                        }`,
                      }}
                      className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0"
                    >
                      {asset.indexed ? "Vaulted" : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
            <span>Storage: Local filesystem + FAISS</span>
            <span>{protectedCount} of {assets.length} protected</span>
          </div>
        </div>

        {/* Right Column: Recent Forensic Scans */}
        <div
          style={{
            background: "#0c101b",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 16,
          }}
          className="p-5 flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldAlert size={15} className="text-amber-400" />
                <h3 className="text-[14px] font-bold text-white m-0">
                  Recent Forensic Investigations
                </h3>
              </div>
              <button
                onClick={() => onNavigateToTab("incidents")}
                className="text-[11px] font-semibold text-teal-400 hover:text-teal-300 flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>View all ({incidents.length})</span>
                <ArrowRight size={11} />
              </button>
            </div>

            {incidents.length === 0 ? (
              <div className="text-center py-10 text-slate-400">
                <Search size={28} className="mx-auto mb-2 text-slate-600 opacity-60" />
                <p className="text-[12px] font-medium m-0">No forensic scans performed yet</p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto">
                  Submit a suspect video file or public video URL in Threat Hunter to generate candidate matches.
                </p>
                <button
                  onClick={() => onNavigateToTab("hunter")}
                  className="mt-3 px-3 py-1.5 rounded-lg bg-teal-900/60 hover:bg-teal-800 text-teal-200 text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Launch Threat Hunter
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {incidents.slice(0, 4).map((inc, i) => {
                  const statusBg =
                    inc.overall_status === "CANDIDATE_MATCH"
                      ? "rgba(239, 68, 68, 0.2)"
                      : inc.overall_status === "SUSPECT"
                      ? "rgba(245, 158, 11, 0.2)"
                      : "rgba(13, 148, 136, 0.2)";
                  const statusColor =
                    inc.overall_status === "CANDIDATE_MATCH"
                      ? "#f87171"
                      : inc.overall_status === "SUSPECT"
                      ? "#fbbf24"
                      : "#2dd4bf";
                  const statusBorder =
                    inc.overall_status === "CANDIDATE_MATCH"
                      ? "rgba(239, 68, 68, 0.35)"
                      : inc.overall_status === "SUSPECT"
                      ? "rgba(245, 158, 11, 0.35)"
                      : "rgba(13, 148, 136, 0.35)";

                  return (
                    <div
                      key={inc.incident_id || i}
                      onClick={() => {
                        if (onViewIncident) {
                          onViewIncident(inc);
                        } else {
                          onNavigateToTab("incidents");
                        }
                      }}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:bg-slate-800/50 hover:border-slate-700/80 transition-colors cursor-pointer"
                    >
                      <div className="truncate pr-2">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <p className="text-[12px] font-semibold text-slate-200 truncate m-0">
                            {inc.suspect_filename || `Suspect ${inc.submitted_asset_id?.slice(0, 8)}`}
                          </p>
                          {inc.investigation_type === "URL_SCREENING" && (
                            <span className="px-1.5 py-0.2 rounded text-[8px] font-black uppercase bg-teal-950 text-teal-300 border border-teal-800">
                              URL
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 m-0">
                          Similarity: {inc.highest_confidence}% • {inc.candidate_matches_found} candidate match(es) • {inc.total_frames_analyzed} frames
                        </p>
                      </div>

                      <span
                        style={{
                          background: statusBg,
                          color: statusColor,
                          border: `1px solid ${statusBorder}`,
                        }}
                        className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0"
                      >
                        {inc.overall_status.replace(/_/g, " ")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
            <span>Deterministic L2 + pHash Matching</span>
            <span>{matchIncidents.length} match alerts recorded</span>
          </div>
        </div>
      </div>

      {/* ─── Restrained Legal & Attribution Footer ─── */}
      <div className="pt-4 border-t border-slate-800/60 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500">
        <p className="m-0">
          FixProof v3.4 • Visual similarity scores represent algorithmic feature distance and do not constitute legal determinations of copyright infringement.
        </p>
        <p className="m-0 text-slate-600">
          Motion physics adapted from{" "}
          <a
            href="https://skiper-ui.com/v1/skiper61"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-teal-400 underline transition-colors"
          >
            Skiper UI (skiper61)
          </a>
        </p>
      </div>
    </div>
  );
};

export default Overview;
