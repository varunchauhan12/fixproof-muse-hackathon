"use client";

import React from "react";
import { Search, RefreshCw, Wifi, WifiOff, ShieldCheck, Zap, Menu } from "lucide-react";

interface HeaderProps {
  title: string;
  backendOnline: boolean;
  vaultSize: number;
  dbMode?: string;
  isCloud?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  onToggleMobileMenu?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  backendOnline,
  vaultSize: _vaultSize,
  dbMode: _dbMode,
  isCloud = false,
  onRefresh,
  refreshing = false,
  onToggleMobileMenu,
}) => {
  return (
    <header
      style={{
        height: 64,
        background: "rgba(20, 20, 18, 0.95)",
        borderBottom: "1px solid #302E29",
        backdropFilter: "blur(12px)",
      }}
      className="sticky top-0 z-20 px-4 sm:px-6 flex items-center justify-between shrink-0"
    >
      {/* Title + Mobile Trigger + Status Badges */}
      <div className="flex items-center gap-2.5 sm:gap-3.5">
        {onToggleMobileMenu && (
          <button
            onClick={onToggleMobileMenu}
            aria-label="Open mobile navigation"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "#1B1A18",
              border: "1px solid #302E29",
              color: "#A29B8F",
            }}
            className="md:hidden flex items-center justify-center hover:text-[#F1EBDD] hover:bg-[#22211E] transition-colors cursor-pointer"
          >
            <Menu size={16} />
          </button>
        )}

        <h1 className="text-[14px] sm:text-[15px] font-bold text-[#F1EBDD] tracking-tight truncate max-w-[160px] sm:max-w-none">
          {title}
        </h1>

        <div className="hidden sm:block h-4 w-[1px] bg-[#302E29]" />

        {/* Node Status Badge */}
        <div
          style={{
            background: backendOnline ? "rgba(72, 199, 181, 0.1)" : "rgba(217, 164, 65, 0.1)",
            border: `1px solid ${backendOnline ? "rgba(72, 199, 181, 0.28)" : "rgba(217, 164, 65, 0.28)"}`,
            color: backendOnline ? "#F1EBDD" : "#D9A441",
          }}
          className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium"
        >
          <Zap
            size={11}
            className={backendOnline ? "text-[#48C7B5] fill-[#48C7B5]" : "text-[#D9A441]"}
          />
          <span className="hidden xs:inline">
            {backendOnline ? "Forensic Node Ready" : "Awaiting Backend"}
          </span>
          <span className="xs:hidden">{backendOnline ? "Ready" : "Waiting"}</span>
        </div>

        {/* Persistence Indicator */}
        {backendOnline && (
          <div
            style={{
              background: "#1B1A18",
              border: "1px solid #302E29",
              color: "#A29B8F",
            }}
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium hidden md:flex"
            title={isCloud ? "PostgreSQL & Supabase Storage Active" : "Local SQLite & Filesystem Active"}
          >
            <ShieldCheck size={11} className="text-[#48C7B5]" />
            <span>{isCloud ? "Supabase Cloud" : "Local SQLite"}</span>
          </div>
        )}
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Refresh button */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            title="Refresh vault & state"
            style={{
              background: "#1B1A18",
              border: "1px solid #302E29",
              color: "#F1EBDD",
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-[#22211E] text-[12px] font-medium transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw
              size={13}
              className={refreshing ? "animate-spin text-[#48C7B5]" : "text-[#A29B8F]"}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        )}

        {/* Search */}
        <div className="relative hidden lg:block">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#736D62]"
          />
          <input
            type="text"
            placeholder="Search assets, incidents..."
            style={{
              border: "1px solid #302E29",
              background: "#1B1A18",
              color: "#F1EBDD",
            }}
            className="w-52 pl-8 pr-3 py-1.5 rounded-lg text-[12px] placeholder-[#736D62] focus:outline-none focus:border-[#48C7B5]/60 transition-all"
          />
        </div>

        {/* Backend Connectivity Status Pill */}
        <div
          style={{
            background: backendOnline ? "rgba(72, 199, 181, 0.08)" : "rgba(216, 107, 104, 0.1)",
            border: `1px solid ${backendOnline ? "rgba(72, 199, 181, 0.25)" : "rgba(216, 107, 104, 0.25)"}`,
            color: backendOnline ? "#48C7B5" : "#D86B68",
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold"
        >
          {backendOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
          <span className="hidden sm:inline">{backendOnline ? "Live" : "Offline"}</span>
        </div>

        {/* User profile avatar */}
        <div
          style={{
            background: "#1B1A18",
            border: "1px solid #302E29",
          }}
          className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full select-none"
        >
          <div
            style={{
              background: "#F1EBDD",
              color: "#141412",
            }}
            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0"
          >
            FP
          </div>
          <span className="text-[12px] font-medium text-[#F1EBDD] hidden sm:inline">SecOps</span>
        </div>
      </div>
    </header>
  );
};

export default Header;
