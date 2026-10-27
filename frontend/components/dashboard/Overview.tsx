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
    },
    {
      id: "mobilenet",
      name: "Feature Extractor",
      technology: "MobileNetV3 Penultimate",
      description: "576-dim L2-normalized visual embeddings",
      status: isOnline ? "Ready" : "Unavailable",
      statusType: isOnline ? "ready" : "offline",
      icon: Cpu,
    },
    {
      id: "faiss",
      name: "Vector Vault",
      technology: "FAISS IndexFlatL2",
      description: `Nearest-neighbor search across ${vaultStatus?.vault_size ?? 0} vectors`,
      status: isOnline ? `${vaultStatus?.vault_size ?? 0} Vectors` : "Unavailable",
      statusType: isOnline ? "ready" : "offline",
      icon: Database,
    },
    {
      id: "phash",
      name: "Perceptual Hash",
      technology: "64-bit DCT pHash",
      description: "Dual-layer secondary validation (Hamming distance < 15)",
      status: isOnline ? "Ready" : "Unavailable",
      statusType: isOnline ? "ready" : "offline",
      icon: Hash,
    },
    {
      id: "vision",
      name: "Vision Verifier",
      technology: "Nemotron-3.5-Super-VL",
      description: "Multimodal verification for borderline match candidates",
      status: isOnline ? "Standby" : "Unavailable",
      statusType: isOnline ? "standby" : "offline",
      icon: Sparkles,
    },
    {
      id: "reasoning",
      name: "Forensic Reasoning",
      technology: "Nemotron-3_5-Lightning",
      description: "Timeline clustering, statutory triage & signed dossier synthesis",
      status: isOnline ? "Standby" : "Unavailable",
      statusType: isOnline ? "standby" : "offline",
      icon: BrainCircuit,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6 text-[#ded7cb]">
      {/* ─── Compact Top Section / Operations Bar with Skiper61 Localized Mouse-Follow ─── */}
      <div
        ref={headerRef}
        style={{
          background: "#171615",
          border: "1px solid rgba(238, 231, 219, 0.08)",
          borderRadius: 16,
        }}
        className="relative overflow-hidden p-5 sm:p-6"
      >
        {/* Skiper61 spring-based mouse follow effect (localized, non-blocking, attribution licensed) */}
        <Skiper61MouseFollow containerRef={headerRef} size={220} />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#1e1d1b] text-[#f4efe6] border border-[rgba(238,231,219,0.12)]">
                <Radio size={12} className={isOnline ? "text-[#eee7db]" : "text-[#736d62]"} />
                <span>{isOnline ? "Forensic Node Ready" : "Awaiting Backend"}</span>
              </span>

              {vaultStatus && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#1e1d1b] text-[#aba497] border border-[rgba(238,231,219,0.08)]">
                  {vaultStatus.is_cloud ? "Supabase Cloud Persistence" : "Local SQLite Mode"}
                </span>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#f4efe6] m-0">
              Forensic Command Overview
            </h1>
            <p className="text-[13px] text-[#aba497] mt-1 max-w-2xl leading-relaxed">
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
                  background: "#1e1d1b",
                  border: "1px solid rgba(238, 231, 219, 0.1)",
                  color: "#ded7cb",
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl hover:text-[#f4efe6] hover:bg-[#262422] text-[12px] font-medium transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw size={13} className={refreshing ? "animate-spin text-[#eee7db]" : ""} />
                <span className="hidden sm:inline">Sync</span>
              </button>
            )}

            <button
              onClick={() => onNavigateToTab("vault")}
              style={{
                background: "#1e1d1b",
                border: "1px solid rgba(238, 231, 219, 0.12)",
                color: "#f4efe6",
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl hover:bg-[#262422] text-[12px] font-medium transition-colors cursor-pointer"
            >
              <Database size={13} className="text-[#eee7db]" />
              <span>Asset Vault</span>
            </button>

            <button
              onClick={() => onNavigateToTab("hunter")}
              style={{
                background: "#eee7db",
                color: "#141312",
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl hover:bg-[#fbf7ef] text-[12px] font-bold transition-all shadow-sm cursor-pointer"
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
          },
          {
            label: "FAISS Vector Vault",
            value: (vaultStatus?.vault_size ?? 0).toLocaleString(),
            sub: "576-dim L2 MobileNetV3 vectors",
            icon: Layers,
          },
          {
            label: "Scanned Incidents",
            value: incidents.length.toString(),
            sub:
              matchIncidents.length > 0
                ? `${matchIncidents.length} candidate match alert(s)`
                : "No candidate matches detected",
            icon: Search,
          },
          {
            label: "Mean Match Score",
            value: avgConfidence ? `${avgConfidence}%` : "—",
            sub:
              matchIncidents.length > 0
                ? `Across ${matchIncidents.length} candidate match incident(s)`
                : "Dual-layer L2 + pHash engine ready",
            icon: ShieldCheck,
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.label}
              whileHover={{ y: -2 }}
              transition={{ duration: 0.2 }}
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

      {/* ─── Compact Subsystem & Pipeline Status Section ─── */}
      <div
        style={{
          background: "#171615",
          border: "1px solid rgba(238, 231, 219, 0.08)",
          borderRadius: 16,
        }}
        className="p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-[#eee7db]" />
            <h2 className="text-[14px] font-bold text-[#f4efe6] m-0 tracking-tight">
              Forensic Subsystem Architecture & Heartbeat
            </h2>
          </div>
          <span className="text-[11px] text-[#8e887d] hidden sm:inline">
            FixProof Multimodal Pipeline
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {subsystems.map((sub) => {
            const Icon = sub.icon;

            return (
              <motion.div
                key={sub.id}
                whileHover={{ y: -2 }}
                transition={{ duration: 0.18 }}
                style={{
                  background: "#1a1918",
                  border: "1px solid rgba(238, 231, 219, 0.06)",
                  borderRadius: 12,
                }}
                className="p-3.5 flex flex-col justify-between hover:border-[rgba(238,231,219,0.14)] transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        background: "rgba(238, 231, 219, 0.06)",
                        border: "1px solid rgba(238, 231, 219, 0.1)",
                        color: "#eee7db",
                      }}
                      className="flex items-center justify-center shrink-0"
                    >
                      <Icon size={15} />
                    </div>

                    <span
                      style={{
                        background: "rgba(238, 231, 219, 0.06)",
                        color: "#ded7cb",
                        border: "1px solid rgba(238, 231, 219, 0.12)",
                      }}
                      className="px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider"
                    >
                      {sub.status}
                    </span>
                  </div>

                  <p className="text-[12px] font-semibold text-[#f4efe6] m-0 leading-snug">
                    {sub.name}
                  </p>
                  <p className="text-[10px] text-[#8e887d] font-mono mt-0.5 mb-1.5 truncate">
                    {sub.technology}
                  </p>
                </div>

                <p className="text-[10px] text-[#736d62] m-0 line-clamp-2 leading-relaxed">
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
            background: "#171615",
            border: "1px solid rgba(238, 231, 219, 0.08)",
            borderRadius: 16,
          }}
          className="p-5 flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-[rgba(238,231,219,0.08)]">
              <div className="flex items-center gap-2">
                <Database size={15} className="text-[#eee7db]" />
                <h3 className="text-[14px] font-bold text-[#f4efe6] m-0">
                  Registered Reference Library
                </h3>
              </div>
              <button
                onClick={() => onNavigateToTab("vault")}
                className="text-[11px] font-medium text-[#ded7cb] hover:text-[#f4efe6] flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>View all ({assets.length})</span>
                <ArrowRight size={11} />
              </button>
            </div>

            {assets.length === 0 ? (
              <div className="text-center py-10 text-[#8e887d]">
                <Database size={28} className="mx-auto mb-2 text-[#736d62] opacity-60" />
                <p className="text-[12px] font-medium m-0">No reference footage registered yet</p>
                <p className="text-[11px] text-[#736d62] mt-1 max-w-xs mx-auto">
                  Upload an official broadcast in the Asset Vault to extract frames and index FAISS vectors.
                </p>
                <button
                  onClick={() => onNavigateToTab("vault")}
                  style={{
                    background: "#1e1d1b",
                    border: "1px solid rgba(238, 231, 219, 0.1)",
                    color: "#ded7cb",
                  }}
                  className="mt-3 px-3 py-1.5 rounded-lg hover:text-[#f4efe6] text-[11px] font-medium transition-colors cursor-pointer"
                >
                  Open Asset Vault
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {assets.slice(0, 4).map((asset) => (
                  <div
                    key={asset.asset_id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-[#1a1918] border border-[rgba(238,231,219,0.06)] hover:bg-[#201f1d] hover:border-[rgba(238,231,219,0.12)] transition-colors"
                  >
                    <div className="flex items-center gap-3 truncate pr-2">
                      <div className="w-14 h-9 rounded bg-[#121211] overflow-hidden shrink-0 flex items-center justify-center border border-[rgba(238,231,219,0.08)]">
                        {asset.thumbnail_url ? (
                          <img
                            src={`http://localhost:8000${asset.thumbnail_url}`}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <FileVideo size={16} className="text-[#736d62]" />
                        )}
                      </div>
                      <div className="truncate">
                        <p className="text-[12px] font-semibold text-[#f4efe6] truncate m-0">
                          {asset.filename}
                        </p>
                        <p className="text-[10px] text-[#8e887d] m-0">
                          {asset.frame_count} frames • {formatBytes(asset.file_size)} • {asset.indexed_vectors} vectors
                        </p>
                      </div>
                    </div>

                    <span
                      style={{
                        background: asset.indexed
                          ? "rgba(238, 231, 219, 0.08)"
                          : "rgba(212, 163, 115, 0.12)",
                        color: asset.indexed ? "#f4efe6" : "#d4a373",
                        border: `1px solid ${
                          asset.indexed
                            ? "rgba(238, 231, 219, 0.14)"
                            : "rgba(212, 163, 115, 0.25)"
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

          <div className="pt-3 mt-3 border-t border-[rgba(238,231,219,0.08)] flex items-center justify-between text-[11px] text-[#736d62]">
            <span>Storage: Local filesystem + FAISS</span>
            <span>{protectedCount} of {assets.length} protected</span>
          </div>
        </div>

        {/* Right Column: Recent Forensic Scans */}
        <div
          style={{
            background: "#171615",
            border: "1px solid rgba(238, 231, 219, 0.08)",
            borderRadius: 16,
          }}
          className="p-5 flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-[rgba(238,231,219,0.08)]">
              <div className="flex items-center gap-2">
                <ShieldAlert size={15} className="text-[#eee7db]" />
                <h3 className="text-[14px] font-bold text-[#f4efe6] m-0">
                  Recent Forensic Investigations
                </h3>
              </div>
              <button
                onClick={() => onNavigateToTab("incidents")}
                className="text-[11px] font-medium text-[#ded7cb] hover:text-[#f4efe6] flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>View all ({incidents.length})</span>
                <ArrowRight size={11} />
              </button>
            </div>

            {incidents.length === 0 ? (
              <div className="text-center py-10 text-[#8e887d]">
                <Search size={28} className="mx-auto mb-2 text-[#736d62] opacity-60" />
                <p className="text-[12px] font-medium m-0">No forensic scans performed yet</p>
                <p className="text-[11px] text-[#736d62] mt-1 max-w-xs mx-auto">
                  Submit a suspect video file or public video URL in Threat Hunter to generate candidate matches.
                </p>
                <button
                  onClick={() => onNavigateToTab("hunter")}
                  style={{
                    background: "#eee7db",
                    color: "#141312",
                  }}
                  className="mt-3 px-3.5 py-1.5 rounded-lg hover:bg-[#fbf7ef] text-[11px] font-bold transition-colors cursor-pointer"
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
                    ? "rgba(212, 163, 115, 0.16)"
                    : isSuspect
                    ? "rgba(212, 163, 115, 0.1)"
                    : "rgba(238, 231, 219, 0.08)";
                  const statusColor = isMatch
                    ? "#dfa974"
                    : isSuspect
                    ? "#d4a373"
                    : "#ded7cb";
                  const statusBorder = isMatch
                    ? "rgba(212, 163, 115, 0.3)"
                    : isSuspect
                    ? "rgba(212, 163, 115, 0.2)"
                    : "rgba(238, 231, 219, 0.12)";

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
                      className="flex items-center justify-between p-2.5 rounded-xl bg-[#1a1918] border border-[rgba(238,231,219,0.06)] hover:bg-[#201f1d] hover:border-[rgba(238,231,219,0.12)] transition-colors cursor-pointer"
                    >
                      <div className="truncate pr-2">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <p className="text-[12px] font-semibold text-[#f4efe6] truncate m-0">
                            {inc.suspect_filename || `Suspect ${inc.submitted_asset_id?.slice(0, 8)}`}
                          </p>
                          {inc.investigation_type === "URL_SCREENING" && (
                            <span className="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-[#242220] text-[#ded7cb] border border-[rgba(238,231,219,0.1)]">
                              URL
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-[#8e887d] m-0">
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

          <div className="pt-3 mt-3 border-t border-[rgba(238,231,219,0.08)] flex items-center justify-between text-[11px] text-[#736d62]">
            <span>Deterministic L2 + pHash Matching</span>
            <span>{matchIncidents.length} match alerts recorded</span>
          </div>
        </div>
      </div>

      {/* ─── Restrained Legal & Attribution Footer ─── */}
      <div className="pt-4 border-t border-[rgba(238,231,219,0.08)] flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-[#736d62]">
        <p className="m-0">
          FixProof v3.4 • Visual similarity scores represent algorithmic feature distance and do not constitute legal determinations of copyright infringement.
        </p>
        <p className="m-0 text-[#5a554c]">
          Motion physics adapted from{" "}
          <a
            href="https://skiper-ui.com/v1/skiper61"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#8e887d] hover:text-[#f4efe6] underline transition-colors"
          >
            Skiper UI (skiper61)
          </a>
        </p>
      </div>
    </div>
  );
};

export default Overview;
