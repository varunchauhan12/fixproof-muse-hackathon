"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Database,
  ChevronDown,
  Check,
  Copy,
  Plus,
  RefreshCw,
  Clock,
  ShieldAlert,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { SessionSummary } from "@/lib/types";
import {
  getActiveSessions,
  getClientSessionId,
  setClientSessionId,
  generateNewSessionId,
} from "@/lib/api";

interface SessionSwitcherProps {
  currentSessionId?: string;
  onSessionChange?: (newSessionId: string) => void;
  variant?: "header" | "compact" | "full";
  className?: string;
}

export const SessionSwitcher: React.FC<SessionSwitcherProps> = ({
  currentSessionId: propSessionId,
  onSessionChange,
  variant = "header",
  className = "",
}) => {
  const [activeSession, setActiveSession] = useState<string>(
    propSessionId || (typeof window !== "undefined" ? getClientSessionId() : "")
  );
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [discoveredSessions, setDiscoveredSessions] = useState<SessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState<boolean>(false);
  const [customInput, setCustomInput] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync with prop or global session changes
  useEffect(() => {
    if (propSessionId) {
      setActiveSession(propSessionId);
    }
  }, [propSessionId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onSessionChanged = (e: any) => {
      const nextId = e.detail || getClientSessionId();
      setActiveSession(nextId);
    };

    window.addEventListener("fixproof_session_changed", onSessionChanged);
    return () => {
      window.removeEventListener("fixproof_session_changed", onSessionChanged);
    };
  }, []);

  // Fetch available sessions from backend
  const loadSessions = async () => {
    setLoadingSessions(true);
    setErrorMsg(null);
    try {
      const list = await getActiveSessions();
      setDiscoveredSessions(list);
    } catch (err: any) {
      console.warn("Could not load sessions list:", err);
      setErrorMsg("Unable to retrieve remote session history");
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSessions();
    }
  }, [isOpen]);

  // Handle clicking outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleSelectSession = (sessionId: string) => {
    const trimmed = sessionId.trim();
    if (!trimmed || trimmed === activeSession) {
      setIsOpen(false);
      return;
    }
    setClientSessionId(trimmed);
    setActiveSession(trimmed);
    if (onSessionChange) {
      onSessionChange(trimmed);
    }
    setIsOpen(false);
  };

  const handleCreateNewSession = () => {
    const newId = generateNewSessionId();
    handleSelectSession(newId);
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeSession && typeof navigator !== "undefined") {
      navigator.clipboard.writeText(activeSession);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatShortId = (id: string) => {
    if (!id) return "No Session";
    if (id.length <= 16) return id;
    return `${id.slice(0, 10)}...${id.slice(-4)}`;
  };

  const formatTimeAgo = (isoString?: string) => {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return "";
      const now = Date.now();
      const diffMs = now - d.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);
      if (diffMins < 2) return "just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      return `${diffDays}d ago`;
    } catch {
      return "";
    }
  };

  // Find incident count for active session if known
  const activeSessionMeta = discoveredSessions.find((s) => s.session_id === activeSession);

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`}>
      {/* ─── Trigger Button ─── */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Investigation session switcher"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        style={{
          background: isOpen ? "#242220" : "#1a1918",
          border: isOpen
            ? "1px solid rgba(72, 199, 181, 0.4)"
            : "1px solid rgba(238, 231, 219, 0.12)",
          color: "#ded7cb",
        }}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono transition-all hover:bg-[#22211e] hover:border-teal-500/30 cursor-pointer shadow-sm select-none"
        title={`Active Session: ${activeSession} (Click to switch)`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0 animate-pulse" aria-hidden="true" />
        <Database size={12} className="text-teal-400 shrink-0" aria-hidden="true" />
        <span className="text-[#8e887d] hidden sm:inline">Session:</span>
        <span className="font-bold text-[#f4efe6]">{formatShortId(activeSession)}</span>
        {activeSessionMeta && activeSessionMeta.incident_count > 0 && (
          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/25">
            {activeSessionMeta.incident_count}
          </span>
        )}
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={`text-[#8e887d] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* ─── Dropdown Popover ─── */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Visitor Investigation Sessions"
          style={{
            background: "#161514",
            border: "1px solid rgba(238, 231, 219, 0.14)",
            boxShadow: "0 20px 40px -15px rgba(0,0,0,0.8), 0 0 20px rgba(72,199,181,0.06)",
            width: "360px",
            maxWidth: "calc(100vw - 24px)",
          }}
          className="absolute right-0 sm:right-auto sm:left-0 mt-2 rounded-xl z-50 p-3 space-y-3 font-sans text-xs"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2.5 border-b border-[rgba(238,231,219,0.08)]">
            <div className="flex items-center gap-1.5">
              <Database size={13} className="text-teal-400" aria-hidden="true" />
              <span className="font-bold text-[#f4efe6]">Visitor Investigation Sessions</span>
            </div>
            <button
              type="button"
              onClick={loadSessions}
              disabled={loadingSessions}
              aria-label="Refresh sessions list"
              className="text-[#8e887d] hover:text-[#f4efe6] transition-colors p-1 rounded cursor-pointer"
              title="Refresh sessions list"
            >
              <RefreshCw size={11} className={loadingSessions ? "animate-spin text-teal-400" : ""} aria-hidden="true" />
            </button>
          </div>

          {/* Active Session Display */}
          <div className="p-2.5 rounded-lg bg-[#1a1918] border border-teal-500/20 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-[#8e887d]">
              <span className="uppercase font-bold tracking-wider text-teal-400">Current Active Session</span>
              <span className="flex items-center gap-1 text-emerald-400 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" aria-hidden="true" /> Active
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="font-mono text-xs text-[#f4efe6] truncate select-all">{activeSession}</span>
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy Session ID"
                className="text-[#8e887d] hover:text-[#f4efe6] transition-colors cursor-pointer p-1 shrink-0"
                title="Copy Session ID"
              >
                {copied ? <Check size={12} className="text-emerald-400" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
              </button>
            </div>
          </div>

          {/* Discovered Sessions with Recorded Incidents */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10.5px] text-[#8e887d] px-0.5">
              <span>Discovered Sessions ({discoveredSessions.length})</span>
              <span className="text-[9.5px] text-[#736d62]">Isolated by visitor ownership</span>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
              {loadingSessions && discoveredSessions.length === 0 ? (
                <div className="py-4 text-center text-[#736d62] text-[11px] flex items-center justify-center gap-2">
                  <RefreshCw size={12} className="animate-spin text-teal-400" />
                  <span>Loading sessions...</span>
                </div>
              ) : discoveredSessions.length === 0 ? (
                <div className="py-3 text-center text-[#736d62] text-[11px]">
                  No sessions with saved incidents detected yet.
                </div>
              ) : (
                discoveredSessions.map((s) => {
                  const isCurrent = s.session_id === activeSession;
                  const timeAgo = formatTimeAgo(s.latest_activity);

                  return (
                    <button
                      key={s.session_id}
                      type="button"
                      onClick={() => handleSelectSession(s.session_id)}
                      style={{
                        background: isCurrent ? "rgba(72,199,181,0.12)" : "#1c1b1a",
                        border: isCurrent
                          ? "1px solid rgba(72,199,181,0.3)"
                          : "1px solid rgba(238,231,219,0.06)",
                      }}
                      className="w-full text-left p-2 rounded-lg hover:bg-[#252321] transition-all flex items-center justify-between gap-2 cursor-pointer group"
                    >
                      <div className="truncate">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-mono text-xs ${isCurrent ? "font-bold text-teal-300" : "text-[#ded7cb] group-hover:text-[#f4efe6]"}`}
                          >
                            {formatShortId(s.session_id)}
                          </span>
                          {isCurrent && (
                            <span className="text-[9px] font-bold uppercase px-1 py-0.2 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">
                              Selected
                            </span>
                          )}
                        </div>
                        {timeAgo && (
                          <div className="flex items-center gap-1 text-[10px] text-[#736d62] mt-0.5">
                            <Clock size={9} />
                            <span>{timeAgo}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                            s.incident_count > 0
                              ? "bg-amber-500/15 text-amber-300 border border-amber-500/25"
                              : "bg-[#252321] text-[#8e887d]"
                          }`}
                        >
                          {s.incident_count} {s.incident_count === 1 ? "incident" : "incidents"}
                        </span>
                        {!isCurrent && (
                          <ArrowRight
                            size={11}
                            className="text-[#736d62] group-hover:text-teal-400 group-hover:translate-x-0.5 transition-all"
                          />
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Switch to Custom Session ID */}
          <div className="pt-2 border-t border-[rgba(238,231,219,0.08)] space-y-1.5">
            <label htmlFor="custom-session-input" className="text-[10px] font-semibold text-[#8e887d] uppercase tracking-wider block">
              Enter or Paste Session ID
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="custom-session-input"
                type="text"
                placeholder="e.g. sess_crac4mhaxr_mvwtk3jy"
                aria-label="Enter or paste session ID"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customInput.trim()) {
                    handleSelectSession(customInput);
                  }
                }}
                style={{
                  background: "#1c1b1a",
                  border: "1px solid rgba(238, 231, 219, 0.12)",
                  color: "#f4efe6",
                }}
                className="flex-1 px-2.5 py-1.5 rounded-lg text-xs font-mono placeholder-[#736d62] focus:outline-none focus:border-teal-400"
              />
              <button
                type="button"
                onClick={() => handleSelectSession(customInput)}
                disabled={!customInput.trim() || customInput.trim() === activeSession}
                style={{
                  background: customInput.trim() && customInput.trim() !== activeSession ? "#48C7B5" : "#242220",
                  color: customInput.trim() && customInput.trim() !== activeSession ? "#141412" : "#736d62",
                }}
                className="px-3 py-1.5 rounded-lg font-bold text-xs transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed shrink-0"
              >
                Switch
              </button>
            </div>
          </div>

          {/* Action: Generate Clean Fresh Session */}
          <div className="pt-1 border-t border-[rgba(238,231,219,0.06)] flex items-center justify-between">
            <button
              type="button"
              onClick={handleCreateNewSession}
              className="w-full py-1.5 px-2 rounded-lg bg-[#1c1b1a] hover:bg-[#252321] text-[#aba497] hover:text-[#f4efe6] border border-[rgba(238,231,219,0.08)] text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus size={12} className="text-teal-400" />
              <span>Start New Clean Session</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

