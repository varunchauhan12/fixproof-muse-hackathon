"use client";

import React, { useState, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  Eye,
  FileCode,
  FileVideo,
  Filter,
  Globe,
  Layers,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { AssetRecord, MatchAnalysisResult, VaultStatus } from "@/lib/types";

export interface SwarmLogsViewProps {
  incidents: MatchAnalysisResult[];
  assets: AssetRecord[];
  vaultStatus?: VaultStatus | null;
  backendOnline?: boolean;
  onNavigateToTab?: (tab: any) => void;
  onSelectIncident?: (incident: MatchAnalysisResult) => void;
}

export type EventCategory = "ALL" | "INVESTIGATION" | "VAULT" | "AI_REASONING" | "WARNINGS";

export interface ForensicLogEvent {
  id: string;
  timestamp: string;
  category: "INVESTIGATION" | "VAULT" | "AI_REASONING" | "SYSTEM";
  severity: "FLAGGED" | "SUSPECT" | "CLEAN" | "INDEXED" | "PENDING" | "INFO" | "WARN";
  summary: string;
  details: string;
  targetId?: string;
  targetType?: "incident" | "asset";
  incidentRef?: MatchAnalysisResult;
  assetRef?: AssetRecord;
  payload: Record<string, any>;
}

export const SwarmLogsView: React.FC<SwarmLogsViewProps> = ({
  incidents,
  assets,
  vaultStatus,
  backendOnline = true,
  onNavigateToTab,
  onSelectIncident,
}) => {
  const [activeCategory, setActiveCategory] = useState<EventCategory>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedEvent, setSelectedEvent] = useState<ForensicLogEvent | null>(null);
  const [viewMode, setViewMode] = useState<"structured" | "technical">("structured");

  // Construct genuine forensic events from persisted records
  const allEvents: ForensicLogEvent[] = useMemo(() => {
    const list: ForensicLogEvent[] = [];

    // 1. Investigation Events from genuine incidents
    incidents.forEach((inc, idx) => {
      const isMatch = inc.overall_status === "CANDIDATE_MATCH";
      const isSuspect = inc.overall_status === "SUSPECT";
      const isReview = inc.overall_status === "NEEDS_FULL_VIDEO_REVIEW";
      const isClean = inc.overall_status === "CLEAN";

      const severity: ForensicLogEvent["severity"] = isMatch
        ? "FLAGGED"
        : isSuspect
        ? "SUSPECT"
        : isReview
        ? "WARN"
        : isClean
        ? "CLEAN"
        : "INFO";

      const incIdStr = inc.incident_id || `inc-${idx}`;
      const name =
        inc.suspect_filename ||
        (inc.source_url ? `URL: ${inc.source_url}` : `Suspect ${incIdStr.slice(0, 8)}`);

      list.push({
        id: `inc-${incIdStr}`,
        timestamp: inc.scanned_at || new Date().toISOString(),
        category: "INVESTIGATION",
        severity,
        summary: `${inc.investigation_type === "URL_SCREENING" ? "URL Screen" : "Video Scan"}: "${name}" → ${inc.overall_status.replace(/_/g, " ")} (${inc.highest_confidence}% Sim)`,
        details: `Analyzed ${inc.total_frames_analyzed || 0} frames. Lowest L2 distance: ${inc.lowest_l2_distance !== null ? inc.lowest_l2_distance.toFixed(4) : "—"}. Matched ${inc.matched_assets?.length || 0} reference assets.`,
        targetId: inc.incident_id,
        targetType: "incident",
        incidentRef: inc,
        payload: {
          event_type: inc.investigation_type === "URL_SCREENING" ? "URL_SCREENING_COMPLETED" : "VIDEO_SCAN_COMPLETED",
          incident_id: inc.incident_id,
          investigation_type: inc.investigation_type,
          suspect_filename: inc.suspect_filename,
          source_url: inc.source_url,
          platform: inc.platform,
          overall_status: inc.overall_status,
          highest_confidence: inc.highest_confidence,
          lowest_l2_distance: inc.lowest_l2_distance,
          total_frames_analyzed: inc.total_frames_analyzed,
          candidate_matches_found: inc.candidate_matches_found,
          matched_assets: inc.matched_assets,
          score_version: inc.score_version,
          timestamp: inc.scanned_at,
        },
      });

      // If AI legal assessment exists for this incident
      if (inc.recommended_action || inc.status_message) {
        list.push({
          id: `ai-${incIdStr}`,
          timestamp: inc.scanned_at || new Date().toISOString(),
          category: "AI_REASONING",
          severity: isMatch ? "FLAGGED" : "INFO",
          summary: `Nemotron Legal Triage: Incident ${incIdStr.slice(0, 8)} → Recommendation: ${inc.recommended_action || "REVIEW"}`,
          details: inc.status_message || "Automated synthesis of visual frame correlations into bounded copyright assessment.",
          targetId: inc.incident_id,
          targetType: "incident",
          incidentRef: inc,
          payload: {
            event_type: "NEMOTRON_SYNTHESIS_EVALUATION",
            incident_id: inc.incident_id,
            model_id: "nvidia/Nemotron-3_5-Lightning",
            recommended_action: inc.recommended_action,
            disclaimer: inc.disclaimer,
            limitations: inc.limitations,
            status_message: inc.status_message,
          },
        });
      }
    });

    // 2. Vault Events from registered reference assets
    assets.forEach((asset, idx) => {
      list.push({
        id: `vault-${asset.asset_id || idx}`,
        timestamp: asset.uploaded_at || new Date().toISOString(),
        category: "VAULT",
        severity: asset.indexed ? "INDEXED" : "PENDING",
        summary: `Reference Vault Ingest: "${asset.filename}" (${asset.frame_count} frames, ${asset.indexed_vectors ?? (asset.indexed ? asset.frame_count : 0)} vectors)`,
        details: `Sample interval: ${asset.sample_interval_seconds || 5}s. File size: ${(asset.file_size / (1024 * 1024)).toFixed(2)} MB. Indexing state: ${asset.indexed ? "FAISS L2 Index Active" : "Unindexed"}.`,
        targetId: asset.asset_id,
        targetType: "asset",
        assetRef: asset,
        payload: {
          event_type: asset.indexed ? "VAULT_INDEXED" : "VAULT_INGEST",
          asset_id: asset.asset_id,
          filename: asset.filename,
          file_size_bytes: asset.file_size,
          duration_seconds: asset.duration_seconds,
          frame_count: asset.frame_count,
          indexed_vectors: asset.indexed_vectors,
          indexed: asset.indexed,
          uploaded_at: asset.uploaded_at,
        },
      });
    });

    // Sort chronologically (newest first)
    list.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime() || 0;
      const timeB = new Date(b.timestamp).getTime() || 0;
      return timeB - timeA;
    });

    return list;
  }, [incidents, assets]);

  // Filtered events
  const filteredEvents = useMemo(() => {
    return allEvents.filter((ev) => {
      // Category filter
      if (activeCategory === "INVESTIGATION" && ev.category !== "INVESTIGATION") return false;
      if (activeCategory === "VAULT" && ev.category !== "VAULT") return false;
      if (activeCategory === "AI_REASONING" && ev.category !== "AI_REASONING") return false;
      if (activeCategory === "WARNINGS" && !(ev.severity === "FLAGGED" || ev.severity === "SUSPECT" || ev.severity === "WARN")) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchSummary = ev.summary.toLowerCase().includes(q);
        const matchDetails = ev.details.toLowerCase().includes(q);
        const matchId = ev.targetId?.toLowerCase().includes(q);
        if (!matchSummary && !matchDetails && !matchId) return false;
      }

      return true;
    });
  }, [allEvents, activeCategory, searchQuery]);

  // Aggregate stats
  const totalEventsCount = allEvents.length;
  const warningsCount = allEvents.filter(
    (e) => e.severity === "FLAGGED" || e.severity === "SUSPECT" || e.severity === "WARN"
  ).length;
  const investigationCount = allEvents.filter((e) => e.category === "INVESTIGATION").length;
  const vaultCount = allEvents.filter((e) => e.category === "VAULT").length;
  const reasoningCount = allEvents.filter((e) => e.category === "AI_REASONING").length;

  return (
    <div
      style={{
        background: "#121211",
        color: "#ded7cb",
      }}
      className="p-5 md:p-6 max-w-7xl mx-auto space-y-5 font-sans"
    >
      {/* ─── Header & Health Telemetry Banner ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[rgba(238,231,219,0.08)]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              style={{
                background: backendOnline ? "#eee7db" : "#dfa974",
              }}
              className="w-2 h-2 rounded-full"
            />
            <h2 className="text-[18px] font-bold text-[#f4efe6] tracking-tight m-0">
              Forensic Event Explorer & Swarm Telemetry
            </h2>
          </div>
          <p className="text-[12px] text-[#aba497] m-0">
            Audit feed of reference ingestion, vector indexing checkpoints, and similarity scan evaluations.
          </p>
        </div>

        {/* Live Service Status Indicator */}
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <div
            style={{
              background: backendOnline ? "rgba(238, 231, 219, 0.08)" : "rgba(223, 169, 116, 0.15)",
              border: `1px solid ${backendOnline ? "rgba(238, 231, 219, 0.15)" : "rgba(223, 169, 116, 0.3)"}`,
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          >
            {backendOnline ? (
              <>
                <Wifi size={13} className="text-[#eee7db]" />
                <span className="text-[#f4efe6] font-bold">Backend Online</span>
                <span className="text-[#736d62]">|</span>
                <span className="text-[#aba497]">
                  FAISS: {vaultStatus?.vault_size ?? 0} vecs ({vaultStatus?.embedding_dim || 576}d)
                </span>
              </>
            ) : (
              <>
                <WifiOff size={13} className="text-[#dfa974]" />
                <span className="text-[#dfa974] font-bold">Backend Offline</span>
                <span className="text-[#aba497]">(Port 8000 Unreachable)</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ─── Backend Offline Warning Banner (if disconnected) ─── */}
      {!backendOnline && (
        <div
          style={{
            background: "rgba(223, 169, 116, 0.08)",
            border: "1px solid rgba(223, 169, 116, 0.25)",
            borderRadius: 12,
          }}
          className="p-3.5 flex items-center gap-3 text-[12px] text-[#dfa974]"
        >
          <AlertTriangle size={18} className="shrink-0" />
          <div>
            <strong className="block text-[#f4efe6]">Service Communication Unavailable</strong>
            <span>
              The forensic backend server is not responding to health checks. Displayed events reflect cached state.
            </span>
          </div>
        </div>
      )}

      {/* ─── A. Summary Row (5 Compact Cards) ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          {
            label: "Total Events in Scope",
            value: totalEventsCount.toString(),
            sub: "Persisted audit records",
            icon: Activity,
            onClick: () => setActiveCategory("ALL"),
            active: activeCategory === "ALL",
          },
          {
            label: "Flagged & Warnings",
            value: warningsCount.toString(),
            sub: "Proximity & matches",
            icon: ShieldAlert,
            onClick: () => setActiveCategory("WARNINGS"),
            active: activeCategory === "WARNINGS",
          },
          {
            label: "Investigation Scans",
            value: investigationCount.toString(),
            sub: "Video & URL screenings",
            icon: FileVideo,
            onClick: () => setActiveCategory("INVESTIGATION"),
            active: activeCategory === "INVESTIGATION",
          },
          {
            label: "Vault Operations",
            value: vaultCount.toString(),
            sub: "Ingest & FAISS vectors",
            icon: Database,
            onClick: () => setActiveCategory("VAULT"),
            active: activeCategory === "VAULT",
          },
          {
            label: "AI Reasoning Reports",
            value: reasoningCount.toString(),
            sub: "Nemotron legal evaluations",
            icon: Cpu,
            onClick: () => setActiveCategory("AI_REASONING"),
            active: activeCategory === "AI_REASONING",
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
                  card.active ? "rgba(238, 231, 219, 0.25)" : "rgba(238, 231, 219, 0.08)"
                }`,
                borderRadius: 14,
                cursor: "pointer",
              }}
              className="p-3 transition-all hover:bg-[#1c1b19] group"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#aba497]">
                  {card.label}
                </span>
                <Icon
                  size={13}
                  className={card.active ? "text-[#eee7db]" : "text-[#736d62] group-hover:text-[#aba497]"}
                />
              </div>
              <span className="text-xl font-bold tracking-tight text-[#f4efe6] block my-0.5 font-mono">
                {card.value}
              </span>
              <span className="text-[10px] text-[#8e887d] block truncate">{card.sub}</span>
            </div>
          );
        })}
      </div>

      {/* ─── B. Filter & Search Toolbar ─── */}
      <div
        style={{
          background: "#171615",
          border: "1px solid rgba(238, 231, 219, 0.08)",
          borderRadius: 14,
        }}
        className="p-3 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3"
      >
        {/* Category Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
          {[
            { id: "ALL", label: "All Events" },
            { id: "INVESTIGATION", label: "Investigations" },
            { id: "VAULT", label: "Vault & Vectors" },
            { id: "AI_REASONING", label: "AI Reasoning" },
            { id: "WARNINGS", label: "Warnings / Flagged" },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id as EventCategory)}
              style={{
                background: activeCategory === cat.id ? "#eee7db" : "transparent",
                color: activeCategory === cat.id ? "#141312" : "#aba497",
                border: `1px solid ${
                  activeCategory === cat.id ? "#eee7db" : "rgba(238, 231, 219, 0.08)"
                }`,
              }}
              className="px-2.5 py-1 rounded-lg transition-all font-semibold cursor-pointer hover:text-[#f4efe6]"
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search Bar & View Mode Toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 md:w-64">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#736d62]"
            />
            <input
              type="text"
              placeholder="Search filename, ID, or status..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: "#121211",
                border: "1px solid rgba(238, 231, 219, 0.08)",
                color: "#f4efe6",
              }}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg text-[11px] focus:outline-none focus:border-[rgba(238,231,219,0.25)] placeholder:text-[#736d62]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#736d62] hover:text-[#f4efe6]"
              >
                <X size={11} />
              </button>
            )}
          </div>

          {/* Mode Switch: Structured Cards vs Technical Terminal Log */}
          <div
            style={{
              background: "#121211",
              border: "1px solid rgba(238, 231, 219, 0.08)",
            }}
            className="flex items-center p-0.5 rounded-lg text-[10.5px] font-semibold"
          >
            <button
              onClick={() => setViewMode("structured")}
              style={{
                background: viewMode === "structured" ? "#242220" : "transparent",
                color: viewMode === "structured" ? "#f4efe6" : "#736d62",
              }}
              className="px-2.5 py-1 rounded-md transition-colors cursor-pointer flex items-center gap-1"
            >
              <Layers size={11} />
              <span>Cards</span>
            </button>
            <button
              onClick={() => setViewMode("technical")}
              style={{
                background: viewMode === "technical" ? "#242220" : "transparent",
                color: viewMode === "technical" ? "#f4efe6" : "#736d62",
              }}
              className="px-2.5 py-1 rounded-md transition-colors cursor-pointer flex items-center gap-1 font-mono"
            >
              <Terminal size={11} />
              <span>Raw</span>
            </button>
          </div>
        </div>
      </div>

      {/* ─── C. Main Event Feed ─── */}
      {filteredEvents.length === 0 ? (
        <div
          style={{
            background: "#171615",
            border: "1px solid rgba(238, 231, 219, 0.08)",
            borderRadius: 16,
          }}
          className="text-center py-16 text-[#736d62] text-[12px] space-y-2"
        >
          <Activity size={24} className="mx-auto opacity-30 text-[#aba497]" />
          <p className="font-semibold text-[#aba497] m-0">No Forensic Events Match Filter</p>
          <p className="text-[11px] text-[#736d62] m-0">
            {searchQuery
              ? `No operations matched query "${searchQuery}". Clear query to see all records.`
              : "No operations found in selected scope."}
          </p>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="mt-2 text-[11px] font-bold text-[#eee7db] hover:underline"
            >
              Reset Search Filter
            </button>
          )}
        </div>
      ) : viewMode === "structured" ? (
        /* Structured Event Card List */
        <div className="space-y-2.5">
          {filteredEvents.map((ev) => {
            const isFlagged = ev.severity === "FLAGGED";
            const isSuspect = ev.severity === "SUSPECT";
            const isWarn = ev.severity === "WARN";

            return (
              <div
                key={ev.id}
                style={{
                  background: "#171615",
                  border: `1px solid ${
                    isFlagged
                      ? "rgba(223, 169, 116, 0.28)"
                      : isSuspect
                      ? "rgba(212, 163, 115, 0.2)"
                      : "rgba(238, 231, 219, 0.08)"
                  }`,
                  borderRadius: 14,
                }}
                className="p-3.5 transition-all hover:bg-[#1a1918] flex flex-col md:flex-row md:items-center justify-between gap-3 text-[11.5px]"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  {/* Category Icon Badge */}
                  <div
                    style={{
                      background:
                        ev.category === "INVESTIGATION"
                          ? "rgba(238, 231, 219, 0.06)"
                          : ev.category === "VAULT"
                          ? "rgba(238, 231, 219, 0.06)"
                          : "rgba(223, 169, 116, 0.08)",
                      border: "1px solid rgba(238, 231, 219, 0.08)",
                    }}
                    className="p-2 rounded-xl shrink-0 mt-0.5 text-[#aba497]"
                  >
                    {ev.category === "INVESTIGATION" ? (
                      <FileVideo size={15} />
                    ) : ev.category === "VAULT" ? (
                      <Database size={15} />
                    ) : (
                      <Cpu size={15} />
                    )}
                  </div>

                  {/* Summary & Meta */}
                  <div className="min-w-0 space-y-1 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Category Label */}
                      <span className="px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase tracking-wider bg-[#242220] text-[#aba497] font-mono border border-[rgba(238,231,219,0.06)]">
                        {ev.category}
                      </span>

                      {/* Severity Badge */}
                      <span
                        style={{
                          background: isFlagged
                            ? "rgba(223, 169, 116, 0.18)"
                            : isSuspect || isWarn
                            ? "rgba(212, 163, 115, 0.12)"
                            : "rgba(238, 231, 219, 0.08)",
                          color: isFlagged ? "#dfa974" : isSuspect || isWarn ? "#d4a373" : "#ded7cb",
                          border: `1px solid ${
                            isFlagged
                              ? "rgba(223, 169, 116, 0.3)"
                              : "rgba(238, 231, 219, 0.1)"
                          }`,
                        }}
                        className="px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase tracking-wider font-mono"
                      >
                        {ev.severity}
                      </span>

                      {/* Timestamp */}
                      <span className="text-[10px] text-[#736d62] font-mono flex items-center gap-1">
                        <Clock size={10} />
                        {new Date(ev.timestamp).toLocaleString([], {
                          dateStyle: "short",
                          timeStyle: "medium",
                        })}
                      </span>
                    </div>

                    <p className="font-semibold text-[#f4efe6] text-[12px] leading-snug m-0">
                      {ev.summary}
                    </p>

                    <p className="text-[11px] text-[#aba497] leading-tight m-0">{ev.details}</p>
                  </div>
                </div>

                {/* Right Actions */}
                <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                  <button
                    onClick={() => setSelectedEvent(ev)}
                    style={{
                      background: "#242220",
                      border: "1px solid rgba(238, 231, 219, 0.08)",
                      color: "#ded7cb",
                    }}
                    className="px-2.5 py-1.5 rounded-lg hover:bg-[#2c2a27] hover:text-[#f4efe6] text-[10.5px] font-semibold transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <FileCode size={11} />
                    <span>Payload</span>
                  </button>

                  {ev.targetType === "incident" && ev.incidentRef && (
                    <button
                      onClick={() => {
                        if (onSelectIncident) {
                          onSelectIncident(ev.incidentRef!);
                        } else if (onNavigateToTab) {
                          onNavigateToTab("incidents");
                        }
                      }}
                      style={{
                        background: "#eee7db",
                        color: "#141312",
                      }}
                      className="px-2.5 py-1.5 rounded-lg hover:bg-[#fbf7ef] text-[10.5px] font-bold transition-all cursor-pointer flex items-center gap-1"
                    >
                      <span>Inspect</span>
                      <ArrowUpRight size={11} />
                    </button>
                  )}

                  {ev.targetType === "asset" && onNavigateToTab && (
                    <button
                      onClick={() => onNavigateToTab("vault")}
                      style={{
                        background: "#242220",
                        border: "1px solid rgba(238, 231, 219, 0.08)",
                        color: "#ded7cb",
                      }}
                      className="px-2.5 py-1.5 rounded-lg hover:bg-[#2c2a27] text-[10.5px] font-semibold transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <span>Vault</span>
                      <ArrowUpRight size={11} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Technical Monospaced Terminal View */
        <div
          style={{
            background: "#121211",
            border: "1px solid rgba(238, 231, 219, 0.08)",
            borderRadius: 14,
          }}
          className="p-4 font-mono text-[11.5px] space-y-1.5 max-h-[600px] overflow-y-auto"
        >
          <div className="text-[#eee7db] pb-2 mb-2 border-b border-[rgba(238,231,219,0.06)] flex items-center justify-between text-[11px]">
            <span>[FIXPROOF FORENSICS LOG TERMINAL] — {filteredEvents.length} records</span>
            <span className="text-[#736d62]">REST Polling 12s</span>
          </div>

          {filteredEvents.map((ev) => {
            const timeStr = new Date(ev.timestamp).toLocaleTimeString([], { hour12: false });
            const isMatch = ev.severity === "FLAGGED" || ev.severity === "SUSPECT";

            return (
              <div
                key={ev.id}
                onClick={() => setSelectedEvent(ev)}
                className="hover:bg-[#1a1918] p-1 rounded cursor-pointer transition-colors flex items-start gap-2"
              >
                <span className="text-[#736d62] shrink-0">{timeStr}</span>
                <span
                  style={{
                    color: isMatch ? "#dfa974" : "#aba497",
                  }}
                  className="shrink-0 font-bold"
                >
                  [{ev.category}]
                </span>
                <span className={isMatch ? "text-[#dfa974]" : "text-[#ded7cb]"}>
                  {ev.summary}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── D. Structured Payload Inspector Modal ─── */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            style={{
              background: "#171615",
              border: "1px solid rgba(238, 231, 219, 0.16)",
              borderRadius: 16,
              maxWidth: 680,
              width: "100%",
            }}
            className="p-5 space-y-4 shadow-2xl font-sans"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[rgba(238,231,219,0.08)]">
              <div className="flex items-center gap-2">
                <FileCode size={16} className="text-[#eee7db]" />
                <h3 className="text-[14px] font-bold text-[#f4efe6] m-0">
                  Forensic Event Payload Details
                </h3>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-1 rounded-lg hover:bg-[#242220] text-[#aba497] hover:text-[#f4efe6] transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2 text-[11.5px]">
              <div className="grid grid-cols-2 gap-2 text-[10.5px] font-mono p-2.5 rounded-xl bg-[#121211] border border-[rgba(238,231,219,0.06)]">
                <div>
                  <span className="text-[#736d62] block">Event ID:</span>
                  <span className="text-[#f4efe6] font-bold">{selectedEvent.id}</span>
                </div>
                <div>
                  <span className="text-[#736d62] block">Recorded Timestamp:</span>
                  <span className="text-[#f4efe6]">{selectedEvent.timestamp}</span>
                </div>
                <div>
                  <span className="text-[#736d62] block">Category:</span>
                  <span className="text-[#dfa974] font-bold">{selectedEvent.category}</span>
                </div>
                <div>
                  <span className="text-[#736d62] block">Severity Status:</span>
                  <span className="text-[#ded7cb] font-bold">{selectedEvent.severity}</span>
                </div>
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#736d62] block mb-1">
                  Canonical JSON Payload:
                </span>
                <pre
                  style={{
                    background: "#121211",
                    border: "1px solid rgba(238, 231, 219, 0.08)",
                    borderRadius: 10,
                  }}
                  className="p-3 text-[11px] font-mono text-[#ded7cb] overflow-x-auto max-h-[300px]"
                >
                  {JSON.stringify(selectedEvent.payload, null, 2)}
                </pre>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[rgba(238,231,219,0.08)]">
              <span className="text-[10px] text-[#736d62] font-mono">
                Security: No private reasoning or server credentials exposed.
              </span>
              <button
                onClick={() => setSelectedEvent(null)}
                style={{
                  background: "#eee7db",
                  color: "#141312",
                }}
                className="px-4 py-1.5 rounded-lg text-[11px] font-bold hover:bg-[#fbf7ef] transition-colors cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SwarmLogsView;
