"use client";

import React, { useState, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  ExternalLink,
  FileArchive,
  FileVideo,
  Filter,
  Globe,
  Info,
  Layers,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  X,
} from "lucide-react";
import { AssetRecord, VaultStatus, MatchAnalysisResult } from "@/lib/types";
import { formatBytes } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";

interface IntelligenceProps {
  assets: AssetRecord[];
  vaultStatus: VaultStatus | null;
  incidents: MatchAnalysisResult[];
  onNavigateToTab: (tab: any) => void;
  onSelectIncident?: (incident: MatchAnalysisResult) => void;
}

export const Intelligence: React.FC<IntelligenceProps> = ({
  assets,
  vaultStatus,
  incidents,
  onNavigateToTab,
  onSelectIncident,
}) => {
  // Interactive outcome filter
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string | null>(null);

  // Aggregate KPIs
  const totalAssets = assets.length;
  const indexedCount = assets.filter((a) => a.indexed).length;
  const totalVectors = vaultStatus?.vault_size ?? 0;
  const totalFrames = assets.reduce((sum, a) => sum + (a.frame_count || 0), 0);

  // Investigation outcome counts
  const matchCount = incidents.filter((i) => i.overall_status === "CANDIDATE_MATCH").length;
  const suspectCount = incidents.filter((i) => i.overall_status === "SUSPECT").length;
  const reviewNeededCount = incidents.filter((i) => i.overall_status === "NEEDS_FULL_VIDEO_REVIEW").length;
  const cleanCount = incidents.filter((i) => i.overall_status === "CLEAN").length;
  const noReferenceCount = incidents.filter((i) => i.overall_status === "NO_REFERENCE_DATA").length;

  // Modality counts
  const videoScansCount = incidents.filter(
    (i) => i.investigation_type === "FULL_VIDEO_SCAN" || !i.investigation_type
  ).length;
  const urlScreeningsCount = incidents.filter(
    (i) => i.investigation_type === "URL_SCREENING"
  ).length;

  // Platform sources from actual URL screening records
  const platformCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    incidents.forEach((inc) => {
      if (inc.investigation_type === "URL_SCREENING") {
        const plat = inc.platform || "Web URL";
        counts[plat] = (counts[plat] || 0) + 1;
      }
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [incidents]);

  // Chronologically sorted incidents for trend timeline
  const chronologicalIncidents = useMemo(() => {
    let list = [...incidents].filter((i) => i.scanned_at);
    if (selectedStatusFilter) {
      list = list.filter((i) => i.overall_status === selectedStatusFilter);
    }
    return list
      .sort((a, b) => new Date(a.scanned_at!).getTime() - new Date(b.scanned_at!).getTime())
      .slice(-14);
  }, [incidents, selectedStatusFilter]);

  // Filtered recent investigations list
  const visibleRecentIncidents = useMemo(() => {
    let list = [...incidents];
    if (selectedStatusFilter) {
      list = list.filter((i) => i.overall_status === selectedStatusFilter);
    }
    return list.slice(0, 8);
  }, [incidents, selectedStatusFilter]);

  // Asset exposure: mapping how many incidents matched against each asset
  const assetMatchCounts = useMemo(() => {
    const map: Record<string, number> = {};
    incidents.forEach((inc) => {
      if (inc.matched_assets && inc.matched_assets.length > 0) {
        inc.matched_assets.forEach((aid) => {
          const id = typeof aid === "object" ? (aid as any).asset_id : String(aid);
          map[id] = (map[id] || 0) + 1;
        });
      }
    });
    return map;
  }, [incidents]);

  const toggleFilter = (status: string) => {
    setSelectedStatusFilter((prev) => (prev === status ? null : status));
  };

  return (
    <div
      style={{
        background: "#121211",
        color: "#ded7cb",
      }}
      className="p-5 md:p-6 max-w-7xl mx-auto space-y-6 font-sans"
    >
      {/* ─── Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[rgba(238,231,219,0.08)]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-[#eee7db]" />
            <h2 className="text-[18px] font-bold text-[#f4efe6] tracking-tight m-0">
              Intelligence & Forensic Telemetry
            </h2>
          </div>
          <p className="text-[12px] text-[#aba497] m-0">
            Verifiable vector index distribution, chronological scan telemetry, and protected asset exposure.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedStatusFilter && (
            <button
              onClick={() => setSelectedStatusFilter(null)}
              style={{
                background: "rgba(238, 231, 219, 0.08)",
                border: "1px solid rgba(238, 231, 219, 0.16)",
                color: "#f4efe6",
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono hover:bg-[#242220] transition-colors cursor-pointer"
            >
              <span>Filter: {selectedStatusFilter.replace(/_/g, " ")}</span>
              <X size={12} className="text-[#aba497]" />
            </button>
          )}

          <button
            onClick={() => onNavigateToTab("hunter")}
            style={{
              background: "#eee7db",
              color: "#141312",
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-[#fbf7ef] text-[11px] font-bold transition-all cursor-pointer"
          >
            <Search size={12} />
            <span>Launch Threat Scan</span>
          </button>
        </div>
      </div>

      {/* ─── A. Top KPI Row (6 Compact Cards) ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {!vaultStatus ? (
          <>
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                style={{
                  background: "#171615",
                  border: "1px solid rgba(238, 231, 219, 0.08)",
                  borderRadius: 14,
                }}
                className="p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-16 rounded bg-[#2A2824]" />
                  <Skeleton className="h-3.5 w-3.5 rounded bg-[#2A2824]" />
                </div>
                <Skeleton className="h-6 w-12 rounded bg-[#2A2824]" />
                <Skeleton className="h-2.5 w-20 rounded bg-[#2A2824]" />
              </div>
            ))}
          </>
        ) : (
          [
            {
              label: "Registered Assets",
            value: totalAssets.toString(),
            sub: `${indexedCount} in FAISS (${totalAssets > 0 ? Math.round((indexedCount / totalAssets) * 100) : 0}%)`,
            desc: `${totalFrames.toLocaleString()} frames`,
            icon: Database,
            onClick: () => onNavigateToTab("vault"),
            active: false,
          },
          {
            label: "FAISS Vectors",
            value: totalVectors.toLocaleString(),
            sub: `${vaultStatus?.embedding_dim || 576}-dim L2 norm`,
            desc: "MobileNetV3 feature space",
            icon: Cpu,
            onClick: () => onNavigateToTab("vault"),
            active: false,
          },
          {
            label: "Total Inquiries",
            value: incidents.length.toString(),
            sub: `${videoScansCount} video · ${urlScreeningsCount} URL`,
            desc: "Recorded scan records",
            icon: Activity,
            onClick: () => {
              setSelectedStatusFilter(null);
              onNavigateToTab("incidents");
            },
            active: selectedStatusFilter === null,
          },
          {
            label: "Candidate Matches",
            value: matchCount.toString(),
            sub: "Confirmed similarity",
            desc: "L2 < 0.15 + pHash match",
            icon: ShieldAlert,
            onClick: () => toggleFilter("CANDIDATE_MATCH"),
            active: selectedStatusFilter === "CANDIDATE_MATCH",
            highlight: "#D9A441",
          },
          {
            label: "Clean Inquiries",
            value: cleanCount.toString(),
            sub: "No match detected",
            desc: "Zero correlated vectors",
            icon: CheckCircle2,
            onClick: () => toggleFilter("CLEAN"),
            active: selectedStatusFilter === "CLEAN",
            highlight: "#48C7B5",
          },
          {
            label: "Review Needed",
            value: reviewNeededCount.toString(),
            sub: "Single-frame screens",
            desc: "Awaiting video review",
            icon: AlertTriangle,
            onClick: () => toggleFilter("NEEDS_FULL_VIDEO_REVIEW"),
            active: selectedStatusFilter === "NEEDS_FULL_VIDEO_REVIEW",
            highlight: "#A29B8F",
          },
        ].map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={idx}
              onClick={card.onClick}
              style={{
                background: card.active ? "#1f1e1c" : "#171615",
                border: `1px solid ${
                  card.active
                    ? "rgba(238, 231, 219, 0.28)"
                    : "rgba(238, 231, 219, 0.08)"
                }`,
                borderRadius: 14,
                cursor: "pointer",
              }}
              className="p-3 transition-all hover:bg-[#1c1b19] hover:border-[rgba(238,231,219,0.18)] group"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#aba497] truncate">
                  {card.label}
                </span>
                <Icon
                  size={13}
                  className={
                    card.active
                      ? "text-[#eee7db]"
                      : "text-[#736d62] group-hover:text-[#eee7db] transition-colors"
                  }
                />
              </div>
              <span
                style={{
                  color: card.highlight && card.active ? card.highlight : "#f4efe6",
                }}
                className="text-xl font-bold tracking-tight block my-0.5 font-mono"
              >
                {card.value}
              </span>
              <span className="text-[10px] text-[#ded7cb] font-semibold block truncate">
                {card.sub}
              </span>
              <span className="text-[9px] text-[#736d62] block mt-0.5 truncate">{card.desc}</span>
            </div>
          );
        })
        )}
      </div>

      {/* ─── B. Main Intelligence Telemetry (2-Column Grid) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Forensic Outcome Distribution (6 cols) */}
        <div
          style={{
            background: "#171615",
            border: "1px solid rgba(238, 231, 219, 0.08)",
            borderRadius: 16,
          }}
          className="lg:col-span-6 p-5 space-y-4"
        >
          <div className="flex items-center justify-between pb-2 border-b border-[rgba(238,231,219,0.06)]">
            <div>
              <h4 className="text-[13px] font-bold text-[#f4efe6] m-0">
                Investigation Outcome Distribution
              </h4>
              <p className="text-[10.5px] text-[#aba497] m-0 mt-0.5">
                Distribution of candidate match criteria and visual similarity outcomes. Click bar to filter feed.
              </p>
            </div>
            <span className="text-[10px] font-mono text-[#736d62]">
              {incidents.length} inquiries
            </span>
          </div>

          {incidents.length === 0 ? (
            <div className="text-center py-10 text-[#736d62] text-[11.5px]">
              No investigation records recorded yet to generate outcome telemetry.
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              {[
                {
                  statusKey: "CANDIDATE_MATCH",
                  label: "Candidate Match (Infringement Risk)",
                  count: matchCount,
                  color: "#D9A441",
                  desc: "L2 distance < 0.15 + confirmed perceptual hash match",
                },
                {
                  statusKey: "SUSPECT",
                  label: "Suspect Visual Proximity",
                  count: suspectCount,
                  color: "rgba(217, 164, 65, 0.6)",
                  desc: "Cosine proximity detected, secondary review suggested",
                },
                {
                  statusKey: "NEEDS_FULL_VIDEO_REVIEW",
                  label: "Single-Frame Screen (Full Review Needed)",
                  count: reviewNeededCount,
                  color: "#A29B8F",
                  desc: "Static thumbnail screened; underlying video uninspected",
                },
                {
                  statusKey: "CLEAN",
                  label: "Clean / Distinct Visual Features",
                  count: cleanCount,
                  color: "#48C7B5",
                  desc: "Zero correlated vectors above sensitivity threshold",
                },
                {
                  statusKey: "NO_REFERENCE_DATA",
                  label: "No Reference Data in Vault",
                  count: noReferenceCount,
                  color: "#736d62",
                  desc: "Scanned against empty or unindexed reference vault",
                },
              ]
                .filter((item) => item.count > 0 || incidents.length === 0)
                .map((item) => {
                  const pct = incidents.length > 0 ? (item.count / incidents.length) * 100 : 0;
                  const isSelected = selectedStatusFilter === item.statusKey;

                  return (
                    <div
                      key={item.statusKey}
                      onClick={() => toggleFilter(item.statusKey)}
                      style={{
                        background: isSelected ? "rgba(238, 231, 219, 0.05)" : "transparent",
                        borderRadius: 8,
                        padding: isSelected ? "4px 8px" : "0",
                      }}
                      className="space-y-1 cursor-pointer transition-colors"
                    >
                      <div className="flex justify-between text-[11px]">
                        <span
                          style={{ color: isSelected ? "#f4efe6" : "#ded7cb" }}
                          className="font-semibold flex items-center gap-1.5"
                        >
                          {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-[#eee7db]" />}
                          <span>{item.label}</span>
                        </span>
                        <span className="font-bold text-[#f4efe6] font-mono">
                          {item.count} ({pct.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="h-2 bg-[#1a1918] rounded-full overflow-hidden border border-[rgba(238,231,219,0.06)]">
                        <div
                          style={{
                            width: `${pct}%`,
                            background: item.color,
                          }}
                          className="h-full rounded-full transition-all duration-300"
                        />
                      </div>
                      <span className="text-[9.5px] text-[#736d62] block leading-tight">
                        {item.desc}
                      </span>
                    </div>
                  );
                })}

              {/* Modality Ratio Footer */}
              <div className="pt-3 border-t border-[rgba(238,231,219,0.06)] flex items-center justify-between text-[10.5px] text-[#aba497] font-mono">
                <span>Modality Breakdown:</span>
                <span>
                  {videoScansCount} Video File Scans • {urlScreeningsCount} URL Screenings
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Chronological Similarity & Distance Trend (6 cols) */}
        <div
          style={{
            background: "#171615",
            border: "1px solid rgba(238, 231, 219, 0.08)",
            borderRadius: 16,
          }}
          className="lg:col-span-6 p-5 space-y-4"
        >
          <div className="flex items-center justify-between pb-2 border-b border-[rgba(238,231,219,0.06)]">
            <div>
              <h4 className="text-[13px] font-bold text-[#f4efe6] m-0">
                Chronological Similarity Telemetry
              </h4>
              <p className="text-[10.5px] text-[#aba497] m-0 mt-0.5">
                Observed feature similarity percentages and lowest L2 distances across genuine scan history.
              </p>
            </div>
            <span className="text-[10px] font-mono text-[#736d62]">
              {chronologicalIncidents.length} recorded scans
            </span>
          </div>

          {chronologicalIncidents.length === 0 ? (
            <div className="text-center py-10 text-[#736d62] text-[11.5px]">
              No scan history available matching selected filter.
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {chronologicalIncidents.map((inc, i) => {
                const isMatch = inc.overall_status === "CANDIDATE_MATCH";
                const isSuspect = inc.overall_status === "SUSPECT";

                return (
                  <div
                    key={inc.incident_id || i}
                    onClick={() => {
                      if (onSelectIncident) {
                        onSelectIncident(inc);
                      } else {
                        onNavigateToTab("incidents");
                      }
                    }}
                    style={{
                      background: "#1a1918",
                      border: `1px solid ${
                        isMatch
                          ? "rgba(212, 163, 115, 0.3)"
                          : "rgba(238, 231, 219, 0.06)"
                      }`,
                      cursor: "pointer",
                    }}
                    className="p-2.5 rounded-xl transition-all hover:bg-[#201f1d] flex items-center justify-between gap-3 text-[11px]"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          style={{
                            background: isMatch
                              ? "rgba(212, 163, 115, 0.2)"
                              : isSuspect
                              ? "rgba(212, 163, 115, 0.1)"
                              : "rgba(238, 231, 219, 0.06)",
                            color: isMatch ? "#dfa974" : isSuspect ? "#d4a373" : "#aba497",
                            border: `1px solid ${isMatch ? "rgba(212, 163, 115, 0.35)" : "rgba(238, 231, 219, 0.08)"}`,
                          }}
                          className="px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase tracking-wider font-mono"
                        >
                          {inc.overall_status.replace(/_/g, " ")}
                        </span>
                        <span className="text-[10px] text-[#736d62] font-mono">
                          {inc.scanned_at ? new Date(inc.scanned_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Recent"}
                        </span>
                      </div>
                      <p className="font-semibold text-[#f4efe6] truncate m-0 text-[11.5px]">
                        {inc.suspect_filename || (inc.submitted_asset_id ? `Suspect ${inc.submitted_asset_id.slice(0, 8)}` : "Public Stream")}
                      </p>
                    </div>

                    <div className="text-right shrink-0 font-mono space-y-0.5">
                      <span className="text-[12px] font-bold text-[#f4efe6] block">
                        {inc.highest_confidence}% Sim
                      </span>
                      <span className="text-[9.5px] text-[#736d62] block">
                        L2: {inc.lowest_l2_distance !== null ? inc.lowest_l2_distance.toFixed(4) : "—"}
                      </span>
                    </div>

                    <ChevronRight size={13} className="text-[#736d62] shrink-0" />
                  </div>
                );
              })}
            </div>
          )}

          <div className="p-2.5 rounded-xl bg-[#141312] border border-[rgba(238,231,219,0.06)] text-[9.5px] text-[#736d62] flex items-center gap-2">
            <Info size={11} className="text-[#aba497] shrink-0" />
            <span>
              Telemetry Note: Visual similarity measurements reflect heuristic MobileNetV3 cosine distances and do not constitute independent legal findings.
            </span>
          </div>
        </div>
      </div>

      {/* ─── C. Reference Asset Footprint & Exposure Table ─── */}
      <div
        style={{
          background: "#171615",
          border: "1px solid rgba(238, 231, 219, 0.08)",
          borderRadius: 16,
        }}
        className="p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[rgba(238,231,219,0.06)]">
          <div>
            <h4 className="text-[13px] font-bold text-[#f4efe6] m-0">
              Reference Asset Exposure & Vault Footprint
            </h4>
            <p className="text-[10.5px] text-[#aba497] m-0 mt-0.5">
              Breakdown of official vault assets, vector index density, and correlated scan inquiries.
            </p>
          </div>
          <button
            onClick={() => onNavigateToTab("vault")}
            className="text-[11px] font-bold text-[#eee7db] hover:underline inline-flex items-center gap-1 cursor-pointer"
          >
            <span>Open Asset Vault</span>
            <ArrowUpRight size={12} />
          </button>
        </div>

        {assets.length === 0 ? (
          <div className="text-center py-10 text-[#736d62] text-[11.5px]">
            No reference assets registered in the vault yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11.5px]">
              <thead>
                <tr className="border-b border-[rgba(238,231,219,0.08)] text-[10px] font-bold uppercase tracking-wider text-[#736d62]">
                  <th className="pb-2 pl-2">Asset Filename</th>
                  <th className="pb-2">Size / Duration</th>
                  <th className="pb-2">Extracted Frames</th>
                  <th className="pb-2">FAISS Vectors</th>
                  <th className="pb-2">Indexing Status</th>
                  <th className="pb-2">Observed Matches</th>
                  <th className="pb-2 pr-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(238,231,219,0.04)] font-mono">
                {assets.map((asset) => {
                  const matchOccurrences = assetMatchCounts[asset.asset_id] || 0;

                  return (
                    <tr
                      key={asset.asset_id}
                      className="hover:bg-[#1a1918] transition-colors group"
                    >
                      <td className="py-2.5 pl-2 font-sans font-semibold text-[#f4efe6]">
                        <span className="truncate max-w-[220px] block" title={asset.filename}>
                          {asset.filename}
                        </span>
                      </td>
                      <td className="py-2.5 text-[#aba497] text-[10.5px]">
                        {formatBytes(asset.file_size)}
                      </td>
                      <td className="py-2.5 text-[#ded7cb]">
                        {asset.frame_count} frames
                      </td>
                      <td className="py-2.5 text-[#ded7cb] font-bold">
                        {asset.indexed_vectors ?? (asset.indexed ? asset.frame_count : 0)}
                      </td>
                      <td className="py-2.5">
                        <span
                          style={{
                            background: asset.indexed
                              ? "rgba(238, 231, 219, 0.1)"
                              : "rgba(212, 163, 115, 0.1)",
                            color: asset.indexed ? "#eee7db" : "#dfa974",
                            border: `1px solid ${
                              asset.indexed
                                ? "rgba(238, 231, 219, 0.16)"
                                : "rgba(212, 163, 115, 0.25)"
                            }`,
                          }}
                          className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                        >
                          {asset.indexed ? "Indexed" : "Pending"}
                        </span>
                      </td>
                      <td className="py-2.5">
                        {matchOccurrences > 0 ? (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#242220] text-[#dfa974] border border-[rgba(212,163,115,0.3)]">
                            {matchOccurrences} inquiry match{matchOccurrences > 1 ? "es" : ""}
                          </span>
                        ) : (
                          <span className="text-[#736d62] text-[10px]">0 matches</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-2 text-right font-sans">
                        <button
                          onClick={() => onNavigateToTab("vault")}
                          className="text-[10.5px] font-semibold text-[#aba497] hover:text-[#f4efe6] transition-colors cursor-pointer"
                        >
                          Inspect →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── D. Recent Forensic Investigations Feed ─── */}
      <div
        style={{
          background: "#171615",
          border: "1px solid rgba(238, 231, 219, 0.08)",
          borderRadius: 16,
        }}
        className="p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[rgba(238,231,219,0.06)]">
          <div>
            <h4 className="text-[13px] font-bold text-[#f4efe6] m-0">
              Recent Forensic Inquiries Feed
            </h4>
            <p className="text-[10.5px] text-[#aba497] m-0 mt-0.5">
              Verified historical record of suspect video scans and bounded URL screenings.
            </p>
          </div>
          <button
            onClick={() => onNavigateToTab("incidents")}
            className="text-[11px] font-bold text-[#eee7db] hover:underline inline-flex items-center gap-1 cursor-pointer"
          >
            <span>View All in Incident Response</span>
            <ArrowUpRight size={12} />
          </button>
        </div>

        {visibleRecentIncidents.length === 0 ? (
          <div className="text-center py-10 text-[#736d62] text-[11.5px]">
            No investigation records available matching selected filter.
          </div>
        ) : (
          <div className="space-y-2">
            {visibleRecentIncidents.map((inc, idx) => {
              const isMatch = inc.overall_status === "CANDIDATE_MATCH";
              const isUrl = inc.investigation_type === "URL_SCREENING";

              return (
                <div
                  key={inc.incident_id || idx}
                  onClick={() => {
                    if (onSelectIncident) {
                      onSelectIncident(inc);
                    } else {
                      onNavigateToTab("incidents");
                    }
                  }}
                  style={{
                    background: "#1a1918",
                    border: "1px solid rgba(238, 231, 219, 0.06)",
                    borderRadius: 12,
                    cursor: "pointer",
                  }}
                  className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#201f1d] hover:border-[rgba(238,231,219,0.12)] transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-[#242220] border border-[rgba(238,231,219,0.08)] text-[#aba497] shrink-0">
                      {isUrl ? <Globe size={14} /> : <FileVideo size={14} />}
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#f4efe6] text-[12px] truncate max-w-sm">
                          {inc.suspect_filename || (inc.submitted_asset_id ? `Suspect ${inc.submitted_asset_id.slice(0, 8)}` : "Public Stream")}
                        </span>
                        {isUrl && (
                          <span className="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase bg-[#242220] text-[#aba497] border border-[rgba(238,231,219,0.08)] font-mono">
                            {inc.platform || "URL"}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-[#736d62] font-mono">
                        <span>
                          {inc.scanned_at ? new Date(inc.scanned_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "Recent"}
                        </span>
                        <span>•</span>
                        <span>
                          {isUrl ? "1 thumbnail preview" : `${inc.total_frames_analyzed} frames`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 font-mono text-[11px] self-end sm:self-center">
                    <div className="text-right">
                      <span className="text-[#f4efe6] font-bold block">
                        {inc.highest_confidence}% Sim
                      </span>
                      <span className="text-[9.5px] text-[#736d62] block">
                        L2: {inc.lowest_l2_distance !== null ? inc.lowest_l2_distance.toFixed(4) : "—"}
                      </span>
                    </div>

                    <span
                      style={{
                        background: isMatch
                          ? "rgba(212, 163, 115, 0.18)"
                          : "rgba(238, 231, 219, 0.08)",
                        color: isMatch ? "#dfa974" : "#ded7cb",
                        border: `1px solid ${isMatch ? "rgba(212, 163, 115, 0.3)" : "rgba(238, 231, 219, 0.12)"}`,
                      }}
                      className="px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wider"
                    >
                      {inc.overall_status.replace(/_/g, " ")}
                    </span>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onSelectIncident) {
                          onSelectIncident(inc);
                        } else {
                          onNavigateToTab("incidents");
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#242220] hover:bg-[#2c2a27] text-[#ded7cb] text-[10.5px] font-sans font-semibold transition-colors cursor-pointer border border-[rgba(238,231,219,0.1)]"
                    >
                      Inspect Evidence
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── E. Source & Provenance Disclosure Panel (Evidence-Backed) ─── */}
      <div
        style={{
          background: "#171615",
          border: "1px solid rgba(238, 231, 219, 0.08)",
          borderRadius: 16,
        }}
        className="p-5 space-y-3"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-[#eee7db]" />
          <h4 className="text-[13px] font-bold text-[#f4efe6] m-0">
            Source Provenance & Propagation Telemetry
          </h4>
        </div>

        <p className="text-[11px] text-[#aba497] leading-relaxed m-0">
          FixProof evaluates direct media uploads and bounded URL screenings against registered reference assets using 576-dimensional MobileNetV3 embeddings and perceptual hashes. Cross-platform leak-chain graphs and propagation trees require verified API repost lineages or cryptographic watermarking and are not inferred from unverified social metadata.
        </p>

        {platformCounts.length > 0 && (
          <div className="pt-2 border-t border-[rgba(238,231,219,0.06)] flex flex-wrap items-center gap-3 text-[11px] font-mono">
            <span className="text-[#736d62] font-sans font-semibold text-[10.5px]">
              Observed Screening Platforms:
            </span>
            {platformCounts.map(([plat, count]) => (
              <span
                key={plat}
                className="px-2 py-0.5 rounded-lg bg-[#1a1918] border border-[rgba(238,231,219,0.08)] text-[#ded7cb]"
              >
                {plat}: <strong className="text-[#f4efe6]">{count}</strong>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Intelligence;
