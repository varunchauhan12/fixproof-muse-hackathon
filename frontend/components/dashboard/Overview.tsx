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
  Activity,
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

  // Genuine FixProof processing stages and subsystems with semantic accent types
  const subsystems = [
    {
      id: "preflight",
      name: "Preflight Ingestion",
      technology: "OpenCV Stream Decoder",
      description: "Codec validation, safe path containment, 5s frame extraction",
      status: isOnline ? "Ready" : "Unavailable",
      statusType: isOnline ? "ready" : "offline",
      category: "core",
      icon: FileVideo,
    },
    {
      id: "mobilenet",
      name: "Feature Extractor",
      technology: "MobileNetV3 Penultimate",
      description: "576-dim L2-normalized visual embeddings",
      status: isOnline ? "Ready" : "Unavailable",
      statusType: isOnline ? "ready" : "offline",
      category: "core",
      icon: Cpu,
    },
    {
      id: "faiss",
      name: "Vector Vault",
      technology: "FAISS IndexFlatL2",
      description: `Nearest-neighbor search across ${vaultStatus?.vault_size ?? 0} vectors`,
      status: isOnline ? `${vaultStatus?.vault_size ?? 0} Vectors` : "Unavailable",
      statusType: isOnline ? "ready" : "offline",
      category: "core",
      icon: Database,
    },
    {
      id: "phash",
      name: "Perceptual Hash",
      technology: "64-bit DCT pHash",
      description: "Dual-layer secondary validation (Hamming distance < 15)",
      status: isOnline ? "Ready" : "Unavailable",
      statusType: isOnline ? "ready" : "offline",
      category: "core",
      icon: Hash,
    },
    {
      id: "vision",
      name: "Vision Verifier",
      technology: "Nemotron-3.5-Super-VL",
      description: "Multimodal verification for borderline match candidates",
      status: isOnline ? "Standby" : "Unavailable",
      statusType: isOnline ? "standby" : "offline",
      category: "ai",
      icon: Sparkles,
    },
    {
      id: "reasoning",
      name: "Forensic Reasoning",
      technology: "Nemotron-3_5-Lightning",
      description: "Timeline clustering, statutory triage & signed dossier synthesis",
      status: isOnline ? "Standby" : "Unavailable",
      statusType: isOnline ? "standby" : "offline",
      category: "ai",
      icon: BrainCircuit,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6 text-[#A29B8F]">
      {/* ─── Compact Top Section / Operations Bar with Skiper61 Localized Mouse-Follow ─── */}
      <div
        ref={headerRef}
        style={{
          background: "#1B1A18",
          border: "1px solid #302E29",
          borderRadius: 16,
        }}
        className="relative overflow-hidden p-5 sm:p-6 shadow-sm"
      >
        {/* Skiper61 spring-based mouse follow effect (localized, non-blocking, attribution licensed) */}
        <Skiper61MouseFollow containerRef={headerRef} size={220} />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span
                style={{
                  background: isOnline ? "rgba(72, 199, 181, 0.1)" : "rgba(217, 164, 65, 0.1)",
                  border: `1px solid ${isOnline ? "rgba(72, 199, 181, 0.28)" : "rgba(217, 164, 65, 0.28)"}`,
                  color: isOnline ? "#F1EBDD" : "#D9A441",
                }}
                className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
              >
                <Radio
                  size={12}
                  className={isOnline ? "text-[#48C7B5]" : "text-[#D9A441]"}
                />
                <span>{isOnline ? "Forensic Node Ready" : "Awaiting Backend"}</span>
              </span>

              {vaultStatus && (
                <span
                  style={{
                    background: "#22211E",
                    border: "1px solid #302E29",
                    color: "#A29B8F",
                  }}
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-medium"
                >
                  {vaultStatus.is_cloud ? "Supabase Cloud Persistence" : "Local SQLite Mode"}
                </span>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F1EBDD] m-0">
              Forensic Command Overview
            </h1>
            <p className="text-[13px] text-[#A29B8F] mt-1 max-w-2xl leading-relaxed">
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
                  background: "#22211E",
                  border: "1px solid #302E29",
                  color: "#F1EBDD",
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-[#2A2824] text-[12px] font-medium transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw size={13} className={refreshing ? "animate-spin text-[#48C7B5]" : "text-[#A29B8F]"} />
                <span className="hidden sm:inline">Sync</span>
              </button>
            )}

            <button
              onClick={() => onNavigateToTab("vault")}
              style={{
                background: "#22211E",
                border: "1px solid #302E29",
                color: "#F1EBDD",
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl hover:bg-[#2A2824] hover:border-[#48C7B5]/30 text-[12px] font-medium transition-colors cursor-pointer"
            >
              <Database size={13} className="text-[#48C7B5]" />
              <span>Asset Vault</span>
            </button>

            <button
              onClick={() => onNavigateToTab("hunter")}
              style={{
                background: "#F1EBDD",
                color: "#141412",
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl hover:bg-[#FAF6ED] text-[12px] font-bold transition-all shadow-sm cursor-pointer"
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
            accentColor: "#48C7B5",
            accentBg: "rgba(72, 199, 181, 0.1)",
            accentBorder: "rgba(72, 199, 181, 0.25)",
            icon: Database,
          },
          {
            label: "FAISS Vector Vault",
            value: (vaultStatus?.vault_size ?? 0).toLocaleString(),
            sub: "576-dim L2 MobileNetV3 vectors",
            accentColor: "#48C7B5",
            accentBg: "rgba(72, 199, 181, 0.1)",
            accentBorder: "rgba(72, 199, 181, 0.25)",
            icon: Layers,
          },
          {
            label: "Scanned Incidents",
            value: incidents.length.toString(),
            sub:
              matchIncidents.length > 0
                ? `${matchIncidents.length} candidate match alert(s)`
                : "No candidate matches detected",
            accentColor: matchIncidents.length > 0 ? "#D9A441" : "#A29B8F",
            accentBg: matchIncidents.length > 0 ? "rgba(217, 164, 65, 0.1)" : "rgba(241, 235, 221, 0.05)",
            accentBorder: matchIncidents.length > 0 ? "rgba(217, 164, 65, 0.25)" : "rgba(241, 235, 221, 0.1)",
            icon: Search,
          },
          {
            label: "Mean Match Score",
            value: avgConfidence ? `${avgConfidence}%` : "—",
            sub:
              matchIncidents.length > 0
                ? `Across ${matchIncidents.length} candidate match incident(s)`
                : "Dual-layer L2 + pHash engine ready",
            accentColor: "#A99AE8",
            accentBg: "rgba(169, 154, 232, 0.1)",
            accentBorder: "rgba(169, 154, 232, 0.25)",
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
                background: "#1B1A18",
                border: "1px solid #302E29",
                borderRadius: 14,
              }}
              className="p-4 sm:p-5 flex flex-col justify-between hover:border-[#48C7B5]/30 transition-colors shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A29B8F] mb-1">
                    {card.label}
                  </p>
                  <p className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#F1EBDD] m-0">
                    {card.value}
                  </p>
                </div>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: card.accentBg,
                    border: `1px solid ${card.accentBorder}`,
                    color: card.accentColor,
                  }}
                  className="flex items-center justify-center shrink-0"
                >
                  <Icon size={17} />
                </div>
              </div>
              <p className="text-[11px] text-[#736D62] mt-3 pt-3 border-t border-[#302E29]">
                {card.sub}
              </p>
            </motion.div>
          );
        })}
      </div>

      {/* ─── Forensic Subsystems Architecture & Heartbeat ─── */}
      <div
        style={{
          background: "#1B1A18",
          border: "1px solid #302E29",
          borderRadius: 16,
        }}
        className="p-5 shadow-sm"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-[#48C7B5]" />
            <h2 className="text-[14px] font-bold text-[#F1EBDD] m-0 tracking-tight">
              Forensic Subsystem Architecture &amp; Heartbeat
            </h2>
          </div>
          <span className="text-[11px] text-[#736D62] hidden sm:inline">
            FixProof Multimodal Pipeline
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {subsystems.map((sub) => {
            const Icon = sub.icon;
            const isAI = sub.category === "ai";
            const isReady = sub.statusType === "ready";
            const isStandby = sub.statusType === "standby";

            const badgeBg = isAI
              ? "rgba(169, 154, 232, 0.1)"
              : isReady
              ? "rgba(72, 199, 181, 0.1)"
              : isStandby
              ? "rgba(217, 164, 65, 0.1)"
              : "rgba(216, 107, 104, 0.1)";

            const badgeColor = isAI
              ? "#A99AE8"
              : isReady
              ? "#48C7B5"
              : isStandby
              ? "#D9A441"
              : "#D86B68";

            const badgeBorder = isAI
              ? "rgba(169, 154, 232, 0.25)"
              : isReady
              ? "rgba(72, 199, 181, 0.25)"
              : isStandby
              ? "rgba(217, 164, 65, 0.25)"
              : "rgba(216, 107, 104, 0.25)";

            return (
              <motion.div
                key={sub.id}
                whileHover={{ y: -2 }}
                transition={{ duration: 0.18 }}
                style={{
                  background: "#22211E",
                  border: "1px solid #302E29",
                  borderRadius: 12,
                }}
                className="p-3.5 flex flex-col justify-between hover:border-[#48C7B5]/30 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        background: badgeBg,
                        border: `1px solid ${badgeBorder}`,
                        color: badgeColor,
                      }}
                      className="flex items-center justify-center shrink-0"
                    >
                      <Icon size={15} />
                    </div>

                    <span
                      style={{
                        background: badgeBg,
                        color: badgeColor,
                        border: `1px solid ${badgeBorder}`,
                      }}
                      className="px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider"
                    >
                      {sub.status}
                    </span>
                  </div>

                  <p className="text-[12px] font-semibold text-[#F1EBDD] m-0 leading-snug">
                    {sub.name}
                  </p>
                  <p className="text-[10px] text-[#A29B8F] font-mono mt-0.5 mb-1.5 truncate">
                    {sub.technology}
                  </p>
                </div>

                <p className="text-[10px] text-[#736D62] m-0 line-clamp-2 leading-relaxed">
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
            background: "#1B1A18",
            border: "1px solid #302E29",
            borderRadius: 16,
          }}
          className="p-5 flex flex-col justify-between shadow-sm"
        >
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#302E29]">
              <div className="flex items-center gap-2">
                <Database size={15} className="text-[#48C7B5]" />
                <h3 className="text-[14px] font-bold text-[#F1EBDD] m-0">
                  Registered Reference Library
                </h3>
              </div>
              <button
                onClick={() => onNavigateToTab("vault")}
                className="text-[11px] font-medium text-[#A29B8F] hover:text-[#F1EBDD] flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>View all ({assets.length})</span>
                <ArrowRight size={11} />
              </button>
            </div>

            {assets.length === 0 ? (
              <div className="text-center py-10 text-[#736D62]">
                <Database size={28} className="mx-auto mb-2 text-[#736D62] opacity-60" />
                <p className="text-[12px] font-medium m-0 text-[#A29B8F]">No reference footage registered yet</p>
                <p className="text-[11px] text-[#736D62] mt-1 max-w-xs mx-auto">
                  Upload an official broadcast in the Asset Vault to extract frames and index FAISS vectors.
                </p>
                <button
                  onClick={() => onNavigateToTab("vault")}
                  style={{
                    background: "#22211E",
                    border: "1px solid #302E29",
                    color: "#F1EBDD",
                  }}
                  className="mt-3 px-3 py-1.5 rounded-lg hover:bg-[#2A2824] text-[11px] font-medium transition-colors cursor-pointer"
                >
                  Open Asset Vault
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {assets.slice(0, 4).map((asset) => (
                  <div
                    key={asset.asset_id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-[#22211E] border border-[#302E29] hover:border-[#48C7B5]/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 truncate pr-2">
                      <div className="w-14 h-9 rounded bg-[#141412] overflow-hidden shrink-0 flex items-center justify-center border border-[#302E29]">
                        {asset.thumbnail_url ? (
                          <img
                            src={`http://localhost:8000${asset.thumbnail_url}`}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <FileVideo size={16} className="text-[#736D62]" />
                        )}
                      </div>
                      <div className="truncate">
                        <p className="text-[12px] font-semibold text-[#F1EBDD] truncate m-0">
                          {asset.filename}
                        </p>
                        <p className="text-[10px] text-[#736D62] m-0">
                          {asset.frame_count} frames • {formatBytes(asset.file_size)} • {asset.indexed_vectors} vectors
                        </p>
                      </div>
                    </div>

                    <span
                      style={{
                        background: asset.indexed
                          ? "rgba(72, 199, 181, 0.1)"
                          : "rgba(217, 164, 65, 0.1)",
                        color: asset.indexed ? "#48C7B5" : "#D9A441",
                        border: `1px solid ${
                          asset.indexed
                            ? "rgba(72, 199, 181, 0.28)"
                            : "rgba(217, 164, 65, 0.28)"
                        }`,
                      }}
                      className="px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider shrink-0"
                    >
                      {asset.indexed ? "Vaulted" : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-3 mt-3 border-t border-[#302E29] flex items-center justify-between text-[11px] text-[#736D62]">
            <span>Storage: Local filesystem + FAISS</span>
            <span>{protectedCount} of {assets.length} protected</span>
          </div>
        </div>

        {/* Right Column: Recent Forensic Scans */}
        <div
          style={{
            background: "#1B1A18",
            border: "1px solid #302E29",
            borderRadius: 16,
          }}
          className="p-5 flex flex-col justify-between shadow-sm"
        >
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#302E29]">
              <div className="flex items-center gap-2">
                <ShieldAlert size={15} className="text-[#D9A441]" />
                <h3 className="text-[14px] font-bold text-[#F1EBDD] m-0">
                  Recent Forensic Investigations
                </h3>
              </div>
              <button
                onClick={() => onNavigateToTab("incidents")}
                className="text-[11px] font-medium text-[#A29B8F] hover:text-[#F1EBDD] flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>View all ({incidents.length})</span>
                <ArrowRight size={11} />
              </button>
            </div>

            {incidents.length === 0 ? (
              <div className="text-center py-10 text-[#736D62]">
                <Search size={28} className="mx-auto mb-2 text-[#736D62] opacity-60" />
                <p className="text-[12px] font-medium m-0 text-[#A29B8F]">No forensic scans performed yet</p>
                <p className="text-[11px] text-[#736D62] mt-1 max-w-xs mx-auto">
                  Submit a suspect video file or public video URL in Threat Hunter to generate candidate matches.
                </p>
                <button
                  onClick={() => onNavigateToTab("hunter")}
                  style={{
                    background: "#F1EBDD",
                    color: "#141412",
                  }}
                  className="mt-3 px-3.5 py-1.5 rounded-lg hover:bg-[#FAF6ED] text-[11px] font-bold transition-colors cursor-pointer"
                >
                  Launch Threat Hunter
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {incidents.slice(0, 4).map((inc, i) => {
                  const isMatch = inc.overall_status === "CANDIDATE_MATCH";
                  const isSuspect = inc.overall_status === "SUSPECT";

                  const statusBg = isMatch
                    ? "rgba(217, 164, 65, 0.12)"
                    : isSuspect
                    ? "rgba(217, 164, 65, 0.08)"
                    : "rgba(72, 199, 181, 0.08)";
                  const statusColor = isMatch
                    ? "#D9A441"
                    : isSuspect
                    ? "#D9A441"
                    : "#48C7B5";
                  const statusBorder = isMatch
                    ? "rgba(217, 164, 65, 0.3)"
                    : isSuspect
                    ? "rgba(217, 164, 65, 0.2)"
                    : "rgba(72, 199, 181, 0.25)";

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
                      className="flex items-center justify-between p-2.5 rounded-xl bg-[#22211E] border border-[#302E29] hover:border-[#48C7B5]/30 transition-colors cursor-pointer"
                    >
                      <div className="truncate pr-2">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <p className="text-[12px] font-semibold text-[#F1EBDD] truncate m-0">
                            {inc.suspect_filename || `Suspect ${inc.submitted_asset_id?.slice(0, 8)}`}
                          </p>
                          {inc.investigation_type === "URL_SCREENING" && (
                            <span className="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-[#1B1A18] text-[#F1EBDD] border border-[#302E29]">
                              URL
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-[#736D62] m-0">
                          Similarity: {inc.highest_confidence}% • {inc.candidate_matches_found} candidate match(es) • {inc.total_frames_analyzed} frames
                        </p>
                      </div>

                      <span
                        style={{
                          background: statusBg,
                          color: statusColor,
                          border: `1px solid ${statusBorder}`,
                        }}
                        className="px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider shrink-0"
                      >
                        {inc.overall_status.replace(/_/g, " ")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-3 mt-3 border-t border-[#302E29] flex items-center justify-between text-[11px] text-[#736D62]">
            <span>Deterministic L2 + pHash Matching</span>
            <span>{matchIncidents.length} match alerts recorded</span>
          </div>
        </div>
      </div>

      {/* ─── Restrained Legal & Attribution Footer ─── */}
      <div className="pt-4 border-t border-[#302E29] flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-[#736D62]">
        <p className="m-0">
          FixProof v3.4 • Visual similarity scores represent algorithmic feature distance and do not constitute legal determinations of copyright infringement.
        </p>
        <p className="m-0 text-[#5a554c]">
          Motion physics adapted from{" "}
          <a
            href="https://skiper-ui.com/v1/skiper61"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#A29B8F] hover:text-[#F1EBDD] underline transition-colors"
          >
            Skiper UI (skiper61)
          </a>
        </p>
      </div>
    </div>
  );
};

export default Overview;
