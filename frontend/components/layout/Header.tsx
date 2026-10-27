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
        background: "rgba(20, 19, 18, 0.95)",
        borderBottom: "1px solid rgba(238, 231, 219, 0.08)",
        backdropFilter: "blur(12px)",
      }}
      className="sticky top-0 z-20 px-6 flex items-center justify-between shrink-0"
    >
      {/* Title + Status Badges */}
      <div className="flex items-center gap-3.5">
        <h1 className="text-[15px] font-bold text-[#f4efe6] tracking-tight">{title}</h1>
        <div className="h-4 w-[1px] bg-[rgba(238,231,219,0.1)]" />
        <div
          style={{
            background: "rgba(238, 231, 219, 0.06)",
            border: "1px solid rgba(238, 231, 219, 0.12)",
            color: backendOnline ? "#f4efe6" : "#c48a56",
          }}
          className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium"
        >
          <Zap size={11} className={backendOnline ? "text-[#eee7db] fill-[#eee7db]" : "text-[#8e887d]"} />
          <span>{backendOnline ? "Forensic Node Ready" : "Awaiting Backend"}</span>
        </div>

        {backendOnline && (
          <div
            style={{
              background: "rgba(238, 231, 219, 0.04)",
              border: "1px solid rgba(238, 231, 219, 0.09)",
              color: "#aba497",
            }}
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium hidden sm:flex"
            title={isCloud ? "PostgreSQL & Supabase Storage Active" : "Local SQLite & Filesystem Active"}
          >
            <ShieldCheck size={11} className="text-[#8e887d]" />
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
              background: "#1c1b1a",
              border: "1px solid rgba(238, 231, 219, 0.1)",
              color: "#ded7cb",
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:text-[#f4efe6] hover:bg-[#262422] text-[12px] font-medium transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw
              size={13}
              className={refreshing ? "animate-spin text-[#eee7db]" : ""}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        )}

        {/* Search */}
        <div className="relative hidden md:block">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#736d62]"
          />
          <input
            type="text"
            placeholder="Search assets, incidents..."
            style={{
              border: "1px solid rgba(238, 231, 219, 0.1)",
              background: "#1c1b1a",
              color: "#f4efe6",
            }}
            className="w-56 pl-8 pr-3 py-1.5 rounded-lg text-[12px] placeholder-[#736d62] focus:outline-none focus:border-[#eee7db] transition-all"
          />
        </div>

        {/* Backend Connectivity Status Pill */}
        <div
          style={{
            background: "rgba(238, 231, 219, 0.06)",
            border: "1px solid rgba(238, 231, 219, 0.12)",
            color: backendOnline ? "#f4efe6" : "#c48a56",
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold"
        >
          {backendOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
          <span>{backendOnline ? "Live" : "Offline"}</span>
        </div>

        {/* User profile avatar */}
        <div
          style={{
            background: "#1c1b1a",
            border: "1px solid rgba(238, 231, 219, 0.1)",
          }}
          className="flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full select-none"
        >
          <div
            style={{
              background: "#eee7db",
              color: "#141312",
            }}
            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0"
          >
            FP
          </div>
          <span className="text-[12px] font-medium text-[#ded7cb]">SecOps</span>
        </div>
      </div>
    </header>
  );
};

export default Header;
