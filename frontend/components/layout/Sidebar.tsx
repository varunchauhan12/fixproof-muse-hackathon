"use client";

import React from "react";
import {
  Shield,
  LayoutDashboard,
  Database,
  Search,
  ShieldAlert,
  Gavel,
  Coins,
  Bell,
  Settings,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Server,
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
  { id: "overview", label: "Overview", icon: LayoutDashboard, color: "#0d9488" },
  { id: "vault", label: "Asset Vault", icon: Database, color: "#6366f1" },
  { id: "hunter", label: "Threat Hunter", icon: Search, color: "#f59e0b" },
  { id: "incidents", label: "Incidents", icon: ShieldAlert, color: "#f97316" },
  { id: "intelligence", label: "Intelligence", icon: BarChart3, color: "#a855f7" },
  { id: "enforcer", label: "Enforce & License", icon: Gavel, color: "#ef4444" },
  { id: "notifications", label: "Swarm Logs", icon: Bell, color: "#0d9488" },
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
        background: "#ffffff",
        borderRight: "1px solid rgba(148, 163, 184, 0.2)",
      }}
      className="sticky top-0 h-screen flex flex-col shrink-0 overflow-hidden z-30 select-none"
    >
      {/* Brand Header */}
      <div
        style={{
          minHeight: 64,
          borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
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
              className="flex items-center justify-center shrink-0 text-white"
            >
              <Shield size={19} />
            </div>
            <div>
              <div className="text-[13px] font-extrabold tracking-tight text-slate-900 leading-tight">
                FIXPROOF
              </div>
              <div className="text-[9px] font-bold text-teal-700 tracking-wider uppercase">
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
              className="flex items-center justify-center text-white"
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
            border: "1px solid rgba(148, 163, 184, 0.2)",
          }}
          className={`flex items-center justify-center text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors ${
            collapsed ? "hidden" : ""
          }`}
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      {collapsed && (
        <div className="flex justify-center py-2 border-b border-slate-100">
          <button
            onClick={onToggleCollapse}
            title="Expand sidebar"
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: "1px solid rgba(148, 163, 184, 0.2)",
            }}
            className="flex items-center justify-center text-slate-400 hover:text-slate-800 hover:bg-slate-100"
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
              color: "#94a3b8",
            }}
            className="uppercase px-2 mb-2"
          >
            Swarm Command
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
                background: isActive ? `${item.color}14` : "transparent",
                border: isActive ? `1px solid ${item.color}35` : "1px solid transparent",
                color: isActive ? item.color : "#64748b",
                position: "relative",
              }}
              className="cursor-pointer hover:bg-slate-50"
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
                  color: isActive ? item.color : "#94a3b8",
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
          borderTop: "1px solid rgba(148, 163, 184, 0.2)",
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
                background: backendOnline ? "#0d9488" : "#ef4444",
                boxShadow: backendOnline
                  ? "0 0 8px #0d9488"
                  : "0 0 8px #ef4444",
              }}
            />
            <button
              onClick={() => onSelectTab("settings")}
              title="Settings"
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              <Settings size={15} />
            </button>
          </div>
        ) : (
          <div>
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid rgba(148, 163, 184, 0.2)",
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
                    background: backendOnline ? "#0d9488" : "#ef4444",
                    boxShadow: backendOnline
                      ? "0 0 6px #0d9488"
                      : "0 0 6px #ef4444",
                  }}
                />
                <span className="text-[11px] font-bold text-slate-800">
                  {backendOnline ? "Forensics Engine Online" : "Backend Offline"}
                </span>
              </div>

              <div className="flex justify-between items-center text-[10px] text-slate-500 mb-1">
                <span className="font-semibold uppercase tracking-wider text-[9px] text-slate-400">
                  FAISS Vault
                </span>
                <span
                  className="font-bold"
                  style={{ color: backendOnline ? "#0d9488" : "#ef4444" }}
                >
                  {vaultSize > 0 ? `${vaultSize} vectors` : "Ready"}
                </span>
              </div>

              <div className="h-1 bg-slate-200 rounded-full overflow-hidden mt-1.5">
                <div
                  style={{
                    width: backendOnline ? "100%" : "0%",
                    background: "linear-gradient(to right, #0d9488, #2dd4bf)",
                  }}
                  className="h-full rounded-full transition-all duration-500"
                />
              </div>
            </div>

            <div className="flex gap-1 text-[11px] text-slate-500">
              <button
                onClick={() => onSelectTab("settings")}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-slate-100 hover:text-slate-800 w-1/2 transition-colors"
              >
                <Settings size={13} />
                <span>Settings</span>
              </button>
              <button
                onClick={() => onSelectTab("support")}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-slate-100 hover:text-slate-800 w-1/2 transition-colors"
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
