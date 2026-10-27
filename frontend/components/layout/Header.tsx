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
  vaultSize: _vaultSize,
  dbMode: _dbMode,
  isCloud = false,
  onRefresh,
  refreshing = false,
}) => {
  return (
    <header
      style={{
        height: 64,
        background: "rgba(11, 15, 25, 0.92)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        backdropFilter: "blur(12px)",
      }}
      className="sticky top-0 z-20 px-6 flex items-center justify-between shrink-0"
    >
      {/* Title + Status Badges */}
      <div className="flex items-center gap-3.5">
        <h1 className="text-[15px] font-bold text-white tracking-tight">{title}</h1>
        <div className="h-4 w-[1px] bg-slate-800" />
        <div
          style={{
            background: backendOnline ? "rgba(13, 148, 136, 0.14)" : "rgba(245, 158, 11, 0.14)",
            border: `1px solid ${
              backendOnline ? "rgba(13, 148, 136, 0.35)" : "rgba(245, 158, 11, 0.35)"
            }`,
            color: backendOnline ? "#2dd4bf" : "#fbbf24",
          }}
          className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
        >
          <Zap size={11} className={backendOnline ? "text-teal-400 fill-teal-400" : ""} />
          <span>{backendOnline ? "Forensic Node Ready" : "Awaiting Backend"}</span>
        </div>

        {backendOnline && (
          <div
            style={{
              background: isCloud ? "rgba(99, 102, 241, 0.14)" : "rgba(100, 116, 139, 0.14)",
              border: `1px solid ${
                isCloud ? "rgba(99, 102, 241, 0.35)" : "rgba(100, 116, 139, 0.3)"
              }`,
              color: isCloud ? "#818cf8" : "#94a3b8",
            }}
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold hidden sm:flex"
            title={isCloud ? "PostgreSQL & Supabase Storage Active" : "Local SQLite & Filesystem Active"}
          >
            <ShieldCheck size={11} className={isCloud ? "text-indigo-400" : "text-slate-400"} />
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
              background: "#111522",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 text-[12px] font-medium transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw
              size={13}
              className={refreshing ? "animate-spin text-teal-400" : ""}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        )}

        {/* Search */}
        <div className="relative hidden md:block">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="text"
            placeholder="Search assets, incidents..."
            style={{
              border: "1px solid rgba(255, 255, 255, 0.08)",
              background: "#111522",
            }}
            className="w-56 pl-8 pr-3 py-1.5 rounded-lg text-[12px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-teal-500 transition-all"
          />
        </div>

        {/* Backend Connectivity Status Pill */}
        <div
          style={{
            background: backendOnline ? "rgba(13, 148, 136, 0.14)" : "rgba(239, 68, 68, 0.14)",
            border: `1px solid ${
              backendOnline ? "rgba(13, 148, 136, 0.3)" : "rgba(239, 68, 68, 0.3)"
            }`,
            color: backendOnline ? "#2dd4bf" : "#f87171",
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold"
        >
          {backendOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
          <span>{backendOnline ? "Live" : "Offline"}</span>
        </div>

        {/* User profile avatar */}
        <div
          style={{
            background: "#111522",
            border: "1px solid rgba(255, 255, 255, 0.08)",
          }}
          className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full select-none"
        >
          <div
            style={{
              background: "linear-gradient(135deg, #0d9488, #2dd4bf)",
            }}
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-slate-950 shrink-0"
          >
            FP
          </div>
          <span className="text-[12px] font-semibold text-slate-200">SecOps</span>
        </div>
      </div>
    </header>
  );
};

export default Header;
