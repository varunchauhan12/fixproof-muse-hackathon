"use client";

import React, { useState, useEffect, useCallback } from "react";
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
  Cpu,
  X,
} from "lucide-react";

export type NavTab =
  | "overview"
  | "vault"
  | "hunter"
  | "incidents"
  | "nemotron"
  | "intelligence"
  | "enforcer"
  | "notifications"
  | "analytics"
  | "settings"
  | "support";

export interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  backendOnline: boolean;
  vaultSize: number;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const NAV_ITEMS: {
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
}[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "vault", label: "Asset Vault", icon: Database },
  { id: "hunter", label: "Threat Hunter", icon: Search },
  { id: "incidents", label: "Incidents", icon: ShieldAlert },
  { id: "nemotron", label: "Nemotron", icon: Cpu },
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
  mobileOpen = false,
  onCloseMobile,
}) => {
  // Floating tooltip state for collapsed rail mode (uses fixed position so it is never clipped)
  const [tooltip, setTooltip] = useState<{ label: string; top: number } | null>(null);

  const showTooltip = useCallback(
    (label: string, e: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>) => {
      if (!collapsed) return;
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltip({
        label,
        top: rect.top + rect.height / 2,
      });
    },
    [collapsed]
  );

  const hideTooltip = useCallback(() => {
    setTooltip(null);
  }, []);

  // Dismiss tooltip on window scroll or resize to avoid detachment
  useEffect(() => {
    const handleScrollOrResize = () => setTooltip(null);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, []);

  // Keyboard escape listener for mobile drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileOpen && onCloseMobile) {
        onCloseMobile();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen, onCloseMobile]);

  const handleItemClick = (id: NavTab) => {
    onSelectTab(id);
    hideTooltip();
    if (mobileOpen && onCloseMobile) {
      onCloseMobile();
    }
  };

  const sidebarContent = (isDrawer = false) => (
    <div className="flex flex-col h-full justify-between select-none">
      <div>
        {/* Brand Header */}
        <div
          style={{
            minHeight: 64,
            borderBottom: "1px solid #302E29",
            padding: !isDrawer && collapsed ? "16px 0" : "16px 18px",
          }}
          className="flex items-center justify-between"
        >
          {isDrawer || !collapsed ? (
            <div className="flex items-center gap-3">
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  background: "#F1EBDD",
                  color: "#141412",
                }}
                className="flex items-center justify-center shrink-0 font-black shadow-sm"
              >
                <Shield size={18} />
              </div>
              <div>
                <div className="text-[13px] font-extrabold tracking-tight text-[#F1EBDD] leading-tight">
                  FIXPROOF
                </div>
                <div className="text-[9px] font-semibold text-[#A29B8F] tracking-wider uppercase">
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
                  background: "#F1EBDD",
                  color: "#141412",
                }}
                className="flex items-center justify-center font-black shadow-sm"
              >
                <Shield size={17} />
              </div>
            </div>
          )}

          {/* Expand/Collapse Control */}
          {isDrawer ? (
            <button
              onClick={onCloseMobile}
              aria-label="Close navigation drawer"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                border: "1px solid #302E29",
                background: "#1B1A18",
              }}
              className="flex items-center justify-center text-[#A29B8F] hover:text-[#F1EBDD] hover:bg-[#22211E] transition-colors cursor-pointer"
            >
              <X size={15} />
            </button>
          ) : (
            <button
              onClick={onToggleCollapse}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                border: "1px solid #302E29",
                background: "transparent",
              }}
              className={`flex items-center justify-center text-[#A29B8F] hover:text-[#F1EBDD] hover:bg-[#22211E] transition-colors cursor-pointer ${
                collapsed ? "hidden" : ""
              }`}
            >
              <ChevronLeft size={14} />
            </button>
          )}
        </div>

        {/* Collapsed rail expand button */}
        {!isDrawer && collapsed && (
          <div className="flex justify-center py-2 border-b border-[#302E29]">
            <button
              onClick={onToggleCollapse}
              onMouseEnter={(e) => showTooltip("Expand sidebar", e)}
              onMouseLeave={hideTooltip}
              onFocus={(e) => showTooltip("Expand sidebar", e)}
              onBlur={hideTooltip}
              aria-label="Expand sidebar"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                border: "1px solid #302E29",
                background: "#1B1A18",
              }}
              className="flex items-center justify-center text-[#A29B8F] hover:text-[#F1EBDD] hover:border-[#48C7B5]/40 hover:bg-[#22211E] transition-colors cursor-pointer"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        {/* Navigation List */}
        <nav
          aria-label="Main Navigation"
          className="overflow-y-auto overflow-x-hidden pt-3"
          style={{ padding: !isDrawer && collapsed ? "10px 8px" : "12px 10px" }}
        >
          {(isDrawer || !collapsed) && (
            <p
              style={{
                fontSize: "0.62rem",
                fontWeight: 700,
                letterSpacing: "0.14em",
                color: "#736D62",
              }}
              className="uppercase px-2 mb-2"
            >
              Forensic Command
            </p>
          )}

          <div className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              const Icon = item.icon;

              return (
                <button
                  key={item.id}
                  onClick={() => handleItemClick(item.id)}
                  onMouseEnter={(e) => showTooltip(item.label, e)}
                  onMouseLeave={hideTooltip}
                  onFocus={(e) => showTooltip(item.label, e)}
                  onBlur={hideTooltip}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  tabIndex={0}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: !isDrawer && collapsed ? 0 : 10,
                    padding: !isDrawer && collapsed ? "10px 0" : "8px 12px",
                    justifyContent: !isDrawer && collapsed ? "center" : "flex-start",
                    borderRadius: 8,
                    width: "100%",
                    fontSize: "0.82rem",
                    fontWeight: isActive ? 600 : 500,
                    transition: "all 0.16s ease",
                    background: isActive
                      ? "rgba(72, 199, 181, 0.08)"
                      : "transparent",
                    border: isActive
                      ? "1px solid rgba(72, 199, 181, 0.28)"
                      : "1px solid transparent",
                    color: isActive ? "#F1EBDD" : "#A29B8F",
                    position: "relative",
                  }}
                  className="cursor-pointer group hover:bg-[#22211E]/70 hover:text-[#F1EBDD] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#48C7B5]"
                >
                  {/* Left accent strip for active tab */}
                  {isActive && (isDrawer || !collapsed) && (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: "22%",
                        bottom: "22%",
                        width: 2.5,
                        borderRadius: 99,
                        background: "#48C7B5",
                      }}
                    />
                  )}

                  <Icon
                    size={16}
                    style={{
                      color: isActive ? "#48C7B5" : "#736D62",
                      flexShrink: 0,
                    }}
                    className="group-hover:text-[#F1EBDD] transition-colors"
                  />

                  {(isDrawer || !collapsed) && (
                    <span className="flex-1 text-left truncate">{item.label}</span>
                  )}

                  {/* Right indicator dot for active tab in expanded view */}
                  {isActive && (isDrawer || !collapsed) && (
                    <div
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: "50%",
                        background: "#48C7B5",
                      }}
                      className="shrink-0 shadow-[0_0_8px_rgba(72,199,181,0.6)]"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Footer System Status */}
      <div
        style={{
          borderTop: "1px solid #302E29",
          padding: !isDrawer && collapsed ? "10px 8px" : "12px 12px",
          background: "#111110",
        }}
      >
        {!isDrawer && collapsed ? (
          <div className="flex flex-col items-center gap-2.5">
            <div
              onMouseEnter={(e) =>
                showTooltip(backendOnline ? "Engine Online: Operational" : "Backend Offline", e)
              }
              onMouseLeave={hideTooltip}
              onFocus={(e) =>
                showTooltip(backendOnline ? "Engine Online: Operational" : "Backend Offline", e)
              }
              onBlur={hideTooltip}
              tabIndex={0}
              aria-label={backendOnline ? "Engine Online" : "Backend Offline"}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: backendOnline ? "#48C7B5" : "#D86B68",
                boxShadow: backendOnline
                  ? "0 0 8px rgba(72,199,181,0.5)"
                  : "0 0 8px rgba(216,107,104,0.5)",
              }}
              className="cursor-help my-1"
            />
            <button
              onClick={() => handleItemClick("settings")}
              onMouseEnter={(e) => showTooltip("Settings", e)}
              onMouseLeave={hideTooltip}
              onFocus={(e) => showTooltip("Settings", e)}
              onBlur={hideTooltip}
              tabIndex={0}
              aria-label="Settings"
              className="p-1.5 text-[#A29B8F] hover:text-[#F1EBDD] hover:bg-[#22211E] rounded-lg cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#48C7B5]"
            >
              <Settings size={15} />
            </button>
            <button
              onClick={() => handleItemClick("support")}
              onMouseEnter={(e) => showTooltip("Support", e)}
              onMouseLeave={hideTooltip}
              onFocus={(e) => showTooltip("Support", e)}
              onBlur={hideTooltip}
              tabIndex={0}
              aria-label="Support & Documentation"
              className="p-1.5 text-[#A29B8F] hover:text-[#F1EBDD] hover:bg-[#22211E] rounded-lg cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#48C7B5]"
            >
              <HelpCircle size={15} />
            </button>
          </div>
        ) : (
          <div>
            <div
              style={{
                background: "#1B1A18",
                border: "1px solid #302E29",
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
                    background: backendOnline ? "#48C7B5" : "#D86B68",
                    boxShadow: backendOnline
                      ? "0 0 6px rgba(72,199,181,0.5)"
                      : "0 0 6px rgba(216,107,104,0.5)",
                  }}
                />
                <span className="text-[11px] font-semibold text-[#F1EBDD]">
                  {backendOnline ? "Forensics Engine Online" : "Backend Offline"}
                </span>
              </div>

              <div className="flex justify-between items-center text-[10px] text-[#A29B8F] mb-1">
                <span className="font-semibold uppercase tracking-wider text-[9px] text-[#736D62]">
                  FAISS Vault
                </span>
                <span
                  className="font-bold"
                  style={{ color: backendOnline ? "#48C7B5" : "#D86B68" }}
                >
                  {vaultSize > 0 ? `${vaultSize} vectors` : "Ready"}
                </span>
              </div>

              <div className="h-1 bg-[#22211E] rounded-full overflow-hidden mt-1.5">
                <div
                  style={{
                    width: backendOnline ? "100%" : "0%",
                    background: "#48C7B5",
                  }}
                  className="h-full rounded-full transition-all duration-300"
                />
              </div>
            </div>

            <div className="flex gap-1 text-[11px] text-[#A29B8F]">
              <button
                onClick={() => handleItemClick("settings")}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-[#22211E] hover:text-[#F1EBDD] w-1/2 transition-colors cursor-pointer"
              >
                <Settings size={13} />
                <span>Settings</span>
              </button>
              <button
                onClick={() => handleItemClick("support")}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-[#22211E] hover:text-[#F1EBDD] w-1/2 transition-colors cursor-pointer"
              >
                <HelpCircle size={13} />
                <span>Support</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* ─── Desktop / Tablet Sidebar (Collapsible Rail) ─── */}
      <aside
        style={{
          width: collapsed ? 68 : 256,
          transition: "width 0.22s cubic-bezier(0.2, 0, 0, 1)",
          background: "#111110",
          borderRight: "1px solid #302E29",
        }}
        className="hidden md:flex sticky top-0 h-screen flex-col shrink-0 z-30 select-none text-[#A29B8F]"
      >
        {sidebarContent(false)}
      </aside>

      {/* ─── Mobile Slide-in Drawer with Backdrop ─── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop Overlay */}
          <div
            onClick={onCloseMobile}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
            aria-hidden="true"
          />

          {/* Drawer Container */}
          <aside
            style={{
              width: 272,
              background: "#111110",
              borderRight: "1px solid #302E29",
            }}
            className="relative z-50 h-full flex flex-col shadow-2xl animate-in slide-in-from-left duration-200"
          >
            {sidebarContent(true)}
          </aside>
        </div>
      )}

      {/* ─── Floating Fixed Tooltip in Collapsed Rail Mode ─── */}
      {collapsed && tooltip && (
        <div
          role="tooltip"
          style={{
            position: "fixed",
            left: 78,
            top: tooltip.top,
            transform: "translateY(-50%)",
            background: "#22211E",
            border: "1px solid #302E29",
            color: "#F1EBDD",
            boxShadow: "0 4px 20px rgba(0,0,0,0.65), 0 0 0 1px rgba(72,199,181,0.06)",
            zIndex: 9999,
          }}
          className="px-2.5 py-1 rounded-md text-[11.5px] font-semibold whitespace-nowrap pointer-events-none flex items-center shadow-md animate-in fade-in-0 duration-150"
        >
          {/* Subtle pointer nubbin */}
          <div
            style={{
              position: "absolute",
              right: "100%",
              top: "50%",
              transform: "translateY(-50%)",
              width: 0,
              height: 0,
              borderTop: "4px solid transparent",
              borderBottom: "4px solid transparent",
              borderRight: "5px solid #22211E",
            }}
          />
          <span>{tooltip.label}</span>
        </div>
      )}
    </>
  );
};

export default Sidebar;
