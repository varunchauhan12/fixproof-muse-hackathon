"use client";

import React from "react";
import {
  Shield,
  LayoutDashboard,
  Database,
  Search,
  ShieldAlert,
  Gavel,
  Bell,
  Settings,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  BarChart3,
} from "lucide-react";

export type NavTab =
  | "overview"
  | "vault"
  | "hunter"
  | "incidents"
  | "intelligence"
  | "enforcer"
  | "notifications"
  | "analytics"
  | "settings"
  | "support";

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  backendOnline: boolean;
  vaultSize: number;
}

const NAV_ITEMS: {
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  color: string;
}[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, color: "#2dd4bf" },
  { id: "vault", label: "Asset Vault", icon: Database, color: "#818cf8" },
  { id: "hunter", label: "Threat Hunter", icon: Search, color: "#fbbf24" },
  { id: "incidents", label: "Incidents", icon: ShieldAlert, color: "#fb923c" },
  { id: "intelligence", label: "Intelligence", icon: BarChart3, color: "#c084fc" },
  { id: "enforcer", label: "Enforce & License", icon: Gavel, color: "#f87171" },
  { id: "notifications", label: "Swarm Logs", icon: Bell, color: "#2dd4bf" },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  collapsed,
  onToggleCollapse,
  backendOnline,
  vaultSize,
}) => {
  return (
    <aside
      style={{
        width: collapsed ? 68 : 256,
        transition: "width 0.22s ease-in-out",
        background: "#0c101b",
        borderRight: "1px solid rgba(255, 255, 255, 0.08)",
      }}
      className="sticky top-0 h-screen flex flex-col shrink-0 overflow-hidden z-30 select-none text-slate-300"
    >
      {/* Brand Header */}
      <div
        style={{
          minHeight: 64,
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          padding: collapsed ? "16px 0" : "16px 18px",
        }}
        className="flex items-center justify-between"
      >
        {!collapsed ? (
          <div className="flex items-center gap-3">
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: "linear-gradient(135deg, #0d9488, #2dd4bf)",
                boxShadow: "0 4px 12px rgba(13, 148, 136, 0.25)",
              }}
              className="flex items-center justify-center shrink-0 text-slate-950 font-black"
            >
              <Shield size={19} />
            </div>
            <div>
              <div className="text-[13px] font-extrabold tracking-tight text-white leading-tight">
                FIXPROOF
              </div>
              <div className="text-[9px] font-bold text-teal-400 tracking-wider uppercase">
                Digital Forensics
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full flex justify-center">
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: "linear-gradient(135deg, #0d9488, #2dd4bf)",
              }}
              className="flex items-center justify-center text-slate-950 font-black"
            >
              <Shield size={18} />
            </div>
          </div>
        )}

        <button
          onClick={onToggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }}
          className={`flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer ${
            collapsed ? "hidden" : ""
          }`}
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      {collapsed && (
        <div className="flex justify-center py-2 border-b border-slate-800">
          <button
            onClick={onToggleCollapse}
            title="Expand sidebar"
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}
            className="flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Nav List */}
      <nav
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{ padding: collapsed ? "10px 8px" : "12px 10px" }}
      >
        {!collapsed && (
          <p
            style={{
              fontSize: "0.62rem",
              fontWeight: 700,
              letterSpacing: "0.16em",
              color: "#64748b",
            }}
            className="uppercase px-2 mb-2"
          >
            Forensic Command
          </p>
        )}

        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              title={collapsed ? item.label : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: collapsed ? 0 : 10,
                padding: collapsed ? "10px 0" : "9px 12px",
                justifyContent: collapsed ? "center" : "flex-start",
                borderRadius: 10,
                marginBottom: 3,
                width: "100%",
                textDecoration: "none",
                fontSize: "0.82rem",
                fontWeight: 600,
                transition: "all 0.15s ease",
                background: isActive ? `${item.color}18` : "transparent",
                border: isActive ? `1px solid ${item.color}40` : "1px solid transparent",
                color: isActive ? item.color : "#94a3b8",
                position: "relative",
              }}
              className="cursor-pointer hover:bg-slate-800/60 hover:text-slate-200"
            >
              {isActive && !collapsed && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "22%",
                    bottom: "22%",
                    width: 3,
                    borderRadius: 99,
                    background: item.color,
                    boxShadow: `0 0 8px ${item.color}`,
                  }}
                />
              )}

              <Icon
                size={17}
                style={{
                  color: isActive ? item.color : "#64748b",
                  flexShrink: 0,
                }}
              />

              {!collapsed && (
                <span className="flex-1 text-left truncate">{item.label}</span>
              )}

              {isActive && !collapsed && (
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: item.color,
                    boxShadow: `0 0 6px ${item.color}`,
                  }}
                  className="shrink-0"
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer System Status */}
      <div
        style={{
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          padding: collapsed ? "10px 8px" : "12px 12px",
        }}
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div
              title={backendOnline ? "System Online" : "Backend Offline"}
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: backendOnline ? "#2dd4bf" : "#f87171",
                boxShadow: backendOnline
                  ? "0 0 8px #2dd4bf"
                  : "0 0 8px #f87171",
              }}
            />
            <button
              onClick={() => onSelectTab("settings")}
              title="Settings"
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <Settings size={15} />
            </button>
          </div>
        ) : (
          <div>
            <div
              style={{
                background: "#111522",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 12,
                padding: "10px 12px",
                marginBottom: 8,
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: backendOnline ? "#2dd4bf" : "#f87171",
                    boxShadow: backendOnline
                      ? "0 0 6px #2dd4bf"
                      : "0 0 6px #f87171",
                  }}
                />
                <span className="text-[11px] font-bold text-slate-200">
                  {backendOnline ? "Forensics Engine Online" : "Backend Offline"}
                </span>
              </div>

              <div className="flex justify-between items-center text-[10px] text-slate-400 mb-1">
                <span className="font-semibold uppercase tracking-wider text-[9px] text-slate-500">
                  FAISS Vault
                </span>
                <span
                  className="font-bold"
                  style={{ color: backendOnline ? "#2dd4bf" : "#f87171" }}
                >
                  {vaultSize > 0 ? `${vaultSize} vectors` : "Ready"}
                </span>
              </div>

              <div className="h-1 bg-slate-800 rounded-full overflow-hidden mt-1.5">
                <div
                  style={{
                    width: backendOnline ? "100%" : "0%",
                    background: "linear-gradient(to right, #0d9488, #2dd4bf)",
                  }}
                  className="h-full rounded-full transition-all duration-500"
                />
              </div>
            </div>

            <div className="flex gap-1 text-[11px] text-slate-400">
              <button
                onClick={() => onSelectTab("settings")}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-slate-800 hover:text-white w-1/2 transition-colors cursor-pointer"
              >
                <Settings size={13} />
                <span>Settings</span>
              </button>
              <button
                onClick={() => onSelectTab("support")}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-slate-800 hover:text-white w-1/2 transition-colors cursor-pointer"
              >
                <HelpCircle size={13} />
                <span>Support</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
