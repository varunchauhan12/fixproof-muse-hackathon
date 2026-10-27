"use client";

import React from "react";
import { Search, RefreshCw, Wifi, WifiOff, ShieldCheck, Zap } from "lucide-react";

interface HeaderProps {
  title: string;
  backendOnline: boolean;
  vaultSize: number;
  dbMode?: string;
  isCloud?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  backendOnline,
  vaultSize,
  dbMode,
  isCloud = false,
  onRefresh,
  refreshing = false,
}) => {
  return (
    <header
      style={{
        height: 64,
        background: "rgba(255, 255, 255, 0.96)",
        borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
        backdropFilter: "blur(12px)",
      }}
      className="sticky top-0 z-20 px-6 flex items-center justify-between shrink-0"
    >
      {/* Title + Status Badge */}
      <div className="flex items-center gap-3.5">
        <h1 className="text-[15px] font-bold text-slate-900 tracking-tight">{title}</h1>
        <div className="h-4 w-[1px] bg-slate-200" />
        <div
          style={{
            background: backendOnline ? "rgba(13, 148, 136, 0.08)" : "rgba(245, 158, 11, 0.08)",
            border: `1px solid ${
              backendOnline ? "rgba(13, 148, 136, 0.25)" : "rgba(245, 158, 11, 0.25)"
            }`,
            color: backendOnline ? "#0d9488" : "#d97706",
          }}
          className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
        >
          <Zap size={11} className={backendOnline ? "text-teal-600 fill-teal-600" : ""} />
          <span>{backendOnline ? "Forensic Node Ready" : "Awaiting Backend"}</span>
        </div>

        {backendOnline && (
          <div
            style={{
              background: isCloud ? "rgba(99, 102, 241, 0.08)" : "rgba(100, 116, 139, 0.08)",
              border: `1px solid ${
                isCloud ? "rgba(99, 102, 241, 0.25)" : "rgba(100, 116, 139, 0.25)"
              }`,
              color: isCloud ? "#6366f1" : "#475569",
            }}
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
            title={isCloud ? "PostgreSQL & Supabase Storage Active" : "Local SQLite & Filesystem Active"}
          >
            <ShieldCheck size={11} className={isCloud ? "text-indigo-600" : "text-slate-600"} />
            <span>{isCloud ? "Supabase Cloud" : "Local Mode"}</span>
          </div>
        )}
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Refresh button */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh vault & state"
            style={{
              border: "1px solid rgba(148, 163, 184, 0.25)",
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 text-[12px] font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw
              size={13}
              className={refreshing ? "animate-spin-smooth text-teal-600" : ""}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        )}

        {/* Search */}
        <div className="relative hidden md:block">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Search assets, incidents..."
            style={{
              border: "1px solid rgba(148, 163, 184, 0.25)",
              background: "#f8fafc",
            }}
            className="w-56 pl-8 pr-3 py-1.5 rounded-lg text-[12px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:bg-white transition-all"
          />
        </div>

        {/* Backend Connectivity Status Pill */}
        <div
          style={{
            background: backendOnline ? "rgba(13, 148, 136, 0.08)" : "rgba(239, 68, 68, 0.08)",
            border: `1px solid ${
              backendOnline ? "rgba(13, 148, 136, 0.2)" : "rgba(239, 68, 68, 0.25)"
            }`,
            color: backendOnline ? "#0d9488" : "#ef4444",
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold"
        >
          {backendOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
          <span>{backendOnline ? "Live" : "Offline"}</span>
        </div>

        {/* User profile avatar */}
        <div
          style={{
            border: "1px solid rgba(148, 163, 184, 0.25)",
          }}
          className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-white select-none"
        >
          <div
            style={{
              background: "linear-gradient(135deg, #0d9488, #2dd4bf)",
            }}
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0"
          >
            FP
          </div>
          <span className="text-[12px] font-semibold text-slate-800">SecOps</span>
        </div>
      </div>
    </header>
  );
};
