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
}[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "vault", label: "Asset Vault", icon: Database },
  { id: "hunter", label: "Threat Hunter", icon: Search },
  { id: "incidents", label: "Incidents", icon: ShieldAlert },
  { id: "intelligence", label: "Intelligence", icon: BarChart3 },
  { id: "enforcer", label: "Enforce & License", icon: Gavel },
  { id: "notifications", label: "Swarm Logs", icon: Bell },
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
        background: "#141312",
        borderRight: "1px solid rgba(238, 231, 219, 0.08)",
      }}
      className="sticky top-0 h-screen flex flex-col shrink-0 overflow-hidden z-30 select-none text-[#aba497]"
    >
      {/* Brand Header */}
      <div
        style={{
          minHeight: 64,
          borderBottom: "1px solid rgba(238, 231, 219, 0.08)",
          padding: collapsed ? "16px 0" : "16px 18px",
        }}
        className="flex items-center justify-between"
      >
        {!collapsed ? (
          <div className="flex items-center gap-3">
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: "#eee7db",
                color: "#141312",
              }}
              className="flex items-center justify-center shrink-0 font-black shadow-sm"
            >
              <Shield size={18} />
            </div>
            <div>
              <div className="text-[13px] font-extrabold tracking-tight text-[#f4efe6] leading-tight">
                FIXPROOF
              </div>
              <div className="text-[9px] font-semibold text-[#8e887d] tracking-wider uppercase">
                Digital Forensics
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full flex justify-center">
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: "#eee7db",
                color: "#141312",
              }}
              className="flex items-center justify-center font-black"
            >
              <Shield size={17} />
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
            border: "1px solid rgba(238, 231, 219, 0.1)",
            background: "transparent",
          }}
          className={`flex items-center justify-center text-[#8e887d] hover:text-[#f4efe6] hover:bg-[#1f1e1c] transition-colors cursor-pointer ${
            collapsed ? "hidden" : ""
          }`}
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      {collapsed && (
        <div className="flex justify-center py-2 border-b border-[rgba(238,231,219,0.08)]">
          <button
            onClick={onToggleCollapse}
            title="Expand sidebar"
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: "1px solid rgba(238, 231, 219, 0.1)",
              background: "transparent",
            }}
            className="flex items-center justify-center text-[#8e887d] hover:text-[#f4efe6] hover:bg-[#1f1e1c] cursor-pointer"
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
              letterSpacing: "0.14em",
              color: "#736d62",
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
                padding: collapsed ? "10px 0" : "8px 12px",
                justifyContent: collapsed ? "center" : "flex-start",
                borderRadius: 8,
                marginBottom: 3,
                width: "100%",
                textDecoration: "none",
                fontSize: "0.82rem",
                fontWeight: isActive ? 600 : 500,
                transition: "all 0.15s ease",
                background: isActive ? "rgba(238, 231, 219, 0.08)" : "transparent",
                border: isActive
                  ? "1px solid rgba(238, 231, 219, 0.16)"
                  : "1px solid transparent",
                color: isActive ? "#f4efe6" : "#aba497",
                position: "relative",
              }}
              className="cursor-pointer hover:bg-[rgba(238,231,219,0.04)] hover:text-[#f4efe6]"
            >
              {isActive && !collapsed && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "24%",
                    bottom: "24%",
                    width: 2.5,
                    borderRadius: 99,
                    background: "#eee7db",
                  }}
                />
              )}

              <Icon
                size={16}
                style={{
                  color: isActive ? "#f4efe6" : "#736d62",
                  flexShrink: 0,
                }}
              />

              {!collapsed && (
                <span className="flex-1 text-left truncate">{item.label}</span>
              )}

              {isActive && !collapsed && (
                <div
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    background: "#eee7db",
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
          borderTop: "1px solid rgba(238, 231, 219, 0.08)",
          padding: collapsed ? "10px 8px" : "12px 12px",
        }}
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div
              title={backendOnline ? "System Online" : "Backend Offline"}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: backendOnline ? "#eee7db" : "#c48a56",
              }}
            />
            <button
              onClick={() => onSelectTab("settings")}
              title="Settings"
              className="p-1.5 text-[#8e887d] hover:text-[#f4efe6] hover:bg-[#1f1e1c] rounded-lg cursor-pointer transition-colors"
            >
              <Settings size={15} />
            </button>
          </div>
        ) : (
          <div>
            <div
              style={{
                background: "#191817",
                border: "1px solid rgba(238, 231, 219, 0.08)",
                borderRadius: 10,
                padding: "9px 11px",
                marginBottom: 8,
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: backendOnline ? "#eee7db" : "#c48a56",
                  }}
                />
                <span className="text-[11px] font-semibold text-[#ded7cb]">
                  {backendOnline ? "Forensics Engine Online" : "Backend Offline"}
                </span>
              </div>

              <div className="flex justify-between items-center text-[10px] text-[#8e887d] mb-1">
                <span className="font-semibold uppercase tracking-wider text-[9px] text-[#736d62]">
                  FAISS Vault
                </span>
                <span
                  className="font-bold"
                  style={{ color: backendOnline ? "#eee7db" : "#c48a56" }}
                >
                  {vaultSize > 0 ? `${vaultSize} vectors` : "Ready"}
                </span>
              </div>

              <div className="h-1 bg-[#242220] rounded-full overflow-hidden mt-1.5">
                <div
                  style={{
                    width: backendOnline ? "100%" : "0%",
                    background: "#eee7db",
                  }}
                  className="h-full rounded-full transition-all duration-300"
                />
              </div>
            </div>

            <div className="flex gap-1 text-[11px] text-[#8e887d]">
              <button
                onClick={() => onSelectTab("settings")}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-[#1f1e1c] hover:text-[#f4efe6] w-1/2 transition-colors cursor-pointer"
              >
                <Settings size={13} />
                <span>Settings</span>
              </button>
              <button
                onClick={() => onSelectTab("support")}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-[#1f1e1c] hover:text-[#f4efe6] w-1/2 transition-colors cursor-pointer"
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
