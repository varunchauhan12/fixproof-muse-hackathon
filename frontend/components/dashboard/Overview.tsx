"use client";

import React from "react";
import {
  ShieldCheck,
  Database,
  Search,
  ShieldAlert,
  ArrowRight,
  Clock,
  Layers,
  Zap,
  Activity,
  HardDrive,
  FileVideo,
} from "lucide-react";
import { AssetRecord, VaultStatus, MatchAnalysisResult } from "@/lib/types";
import { formatBytes, formatDuration } from "@/lib/api";

interface OverviewProps {
  assets: AssetRecord[];
  vaultStatus: VaultStatus | null;
  incidents: MatchAnalysisResult[];
  onNavigateToTab: (tab: any) => void;
}

export const Overview: React.FC<OverviewProps> = ({
  assets,
  vaultStatus,
  incidents,
  onNavigateToTab,
}) => {
  const protectedCount = assets.filter((a) => a.indexed).length;
  const matchIncidents = incidents.filter((i) => i.candidate_matches_found > 0);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* ─── Hero Banner ─── */}
      <div
        style={{
          background: "linear-gradient(135deg, #0d9488 0%, #115e59 100%)",
          borderRadius: 20,
          boxShadow: "0 8px 24px rgba(13, 148, 136, 0.18)",
        }}
        className="p-6 text-white relative overflow-hidden"
      >
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/20 text-[10px] font-extrabold uppercase tracking-wider mb-2">
            <Zap size={11} />
            <span>Forensic Operations Active</span>
          </div>
          <h2 className="text-2xl font-black tracking-tight m-0">
            FixProof Visual Rights & Forensics Console
          </h2>
          <p className="text-[13px] text-teal-100 mt-1.5 leading-relaxed">
            Multi-stage autonomous video protection engine. Ingest official broadcast footage, index visual fingerprints into FAISS, and analyze suspect clips for candidate copyright infringement.
          </p>

          <div className="flex gap-3 mt-4">
            <button
              onClick={() => onNavigateToTab("vault")}
              className="px-4 py-2 rounded-xl bg-white text-teal-900 text-[12px] font-extrabold hover:bg-teal-50 transition-colors flex items-center gap-1.5 shadow-md"
            >
              <Database size={13} />
              <span>Open Asset Vault</span>
            </button>
            <button
              onClick={() => onNavigateToTab("hunter")}
              className="px-4 py-2 rounded-xl bg-teal-800/60 hover:bg-teal-800 text-white text-[12px] font-bold border border-white/20 transition-colors flex items-center gap-1.5"
            >
              <Search size={13} />
              <span>Scan Suspect Stream</span>
            </button>
          </div>
        </div>
      </div>

      {/* ─── Stats KPI Row (MediaGuard card style) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Reference Assets",
            value: assets.length.toString(),
            color: "#6366f1",
            icon: Database,
            sub: `${protectedCount} indexed in FAISS`,
          },
          {
            label: "FAISS Vectors",
            value: (vaultStatus?.vault_size ?? 0).toLocaleString(),
            color: "#a855f7",
            icon: Layers,
            sub: "576-dim L2 embeddings",
          },
          {
            label: "Threat Scans",
            value: incidents.length.toString(),
            color: "#f59e0b",
            icon: Search,
            sub: `${matchIncidents.length} candidate matches found`,
          },
          {
            label: "Avg Match Confidence",
            value:
              matchIncidents.length > 0
                ? `${(
                    matchIncidents.reduce((sum, i) => sum + (i.highest_confidence || 0), 0) /
                    matchIncidents.length
                  ).toFixed(1)}%`
                : "—",
            color: "#0d9488",
            icon: ShieldCheck,
            sub:
              matchIncidents.length > 0
                ? `Across ${matchIncidents.length} candidate match incident(s)`
                : "Dual-layer L2 + pHash engine ready",
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              style={{
                background: "#ffffff",
                borderRadius: 16,
                padding: "18px 20px",
                border: "1px solid rgba(148, 163, 184, 0.2)",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.03)",
              }}
              className="transition-transform hover:-translate-y-0.5 flex flex-col justify-between"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    {card.label}
                  </p>
                  <p
                    style={{ color: card.color }}
                    className="text-2xl font-black tracking-tight m-0"
                  >
                    {card.value}
                  </p>
                </div>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    background: `${card.color}15`,
                    color: card.color,
                  }}
                  className="flex items-center justify-center shrink-0"
                >
                  <Icon size={18} />
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-2.5 pt-2.5 border-t border-slate-100">
                {card.sub}
              </p>
            </div>
          );
        })}
      </div>

      {/* ─── Two-Column Section: Recent Vault Items + Recent Incidents ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Vaulted Assets */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: 20,
            padding: "20px 22px",
            border: "1px solid rgba(148, 163, 184, 0.2)",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.03)",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-extrabold text-slate-900 m-0">
              Recent Vault References
            </h3>
            <button
              onClick={() => onNavigateToTab("vault")}
              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              <span>View all ({assets.length})</span>
              <ArrowRight size={11} />
            </button>
          </div>

          {assets.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-[12px]">
              No reference footage registered yet.
            </div>
          ) : (
            <div className="space-y-2.5">
              {assets.slice(0, 4).map((asset) => (
                <div
                  key={asset.asset_id}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3 truncate">
                    <div className="w-12 h-8 rounded bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center">
                      {asset.thumbnail_url ? (
                        <img
                          src={`http://localhost:8000${asset.thumbnail_url}`}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <FileVideo size={14} className="text-slate-500" />
                      )}
                    </div>
                    <div className="truncate">
                      <p className="text-[12px] font-bold text-slate-900 truncate m-0">
                        {asset.filename}
                      </p>
                      <p className="text-[10px] text-slate-400 m-0">
                        {asset.frame_count} frames • {formatBytes(asset.file_size)}
                      </p>
                    </div>
                  </div>

                  <span
                    style={{
                      background: asset.indexed
                        ? "rgba(13, 148, 136, 0.08)"
                        : "rgba(245, 158, 11, 0.08)",
                      color: asset.indexed ? "#0d9488" : "#d97706",
                    }}
                    className="px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0"
                  >
                    {asset.indexed ? "Indexed" : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Detections / Threat Scans */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: 20,
            padding: "20px 22px",
            border: "1px solid rgba(148, 163, 184, 0.2)",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.03)",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-extrabold text-slate-900 m-0">
              Recent Forensic Scans
            </h3>
            <button
              onClick={() => onNavigateToTab("incidents")}
              className="text-[11px] font-bold text-orange-600 hover:text-orange-800 flex items-center gap-1"
            >
              <span>View all ({incidents.length})</span>
              <ArrowRight size={11} />
            </button>
          </div>

          {incidents.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-[12px]">
              No scans performed yet. Submit a clip in Threat Hunter.
            </div>
          ) : (
            <div className="space-y-2.5">
              {incidents.slice(0, 4).map((inc, i) => (
                <div
                  key={inc.incident_id || i}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <div className="truncate pr-2">
                    <p className="text-[12px] font-bold text-slate-900 truncate m-0">
                      {inc.suspect_filename || `Suspect ${inc.submitted_asset_id.slice(0, 8)}`}
                    </p>
                    <p className="text-[10px] text-slate-400 m-0">
                      Confidence: {inc.highest_confidence}% • {inc.candidate_matches_found} candidate match(es)
                    </p>
                  </div>

                  <span
                    style={{
                      background:
                        inc.overall_status === "CANDIDATE_MATCH"
                          ? "#ef4444"
                          : inc.overall_status === "SUSPECT"
                          ? "#f59e0b"
                          : "#0d9488",
                    }}
                    className="px-2 py-0.5 rounded text-[9px] font-extrabold uppercase text-white shrink-0"
                  >
                    {inc.overall_status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
