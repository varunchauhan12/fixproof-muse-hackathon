"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Sidebar, NavTab } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { AssetVault } from "@/components/dashboard/AssetVault";
import { ThreatHunter } from "@/components/dashboard/ThreatHunter";
import { IncidentResponse } from "@/components/dashboard/IncidentResponse";
import { Overview } from "@/components/dashboard/Overview";
import { Intelligence } from "@/components/dashboard/Intelligence";
import { NemotronCenter } from "@/components/dashboard/NemotronCenter";
import {
  EnforcementView,
  SwarmLogsView,
  SettingsView,
  SupportView,
} from "@/components/dashboard/SecondaryViews";
import { AssetRecord, VaultStatus, MatchAnalysisResult } from "@/lib/types";
import {
  checkBackendHealth,
  getVaultStatus,
  getRegisteredAssets,
  getIncidentsList,
} from "@/lib/api";
import { Home } from "lucide-react";

const PAGE_TITLES: Record<NavTab, string> = {
  overview: "Command Overview",
  vault: "Digital Asset Vault",
  hunter: "Sentinel Threat Hunter",
  incidents: "Incident Response",
  nemotron: "Nemotron Intelligence & Action Center",
  intelligence: "Intelligence & Analytics",
  enforcer: "Enforcement & Licensing",
  notifications: "Forensics Swarm Logs",
  analytics: "Intelligence & Analytics",
  settings: "System Settings",
  support: "Support & Documentation",
};

interface DashboardConsoleProps {
  onBackToLanding?: () => void;
  defaultTab?: NavTab;
}

export const DashboardConsole: React.FC<DashboardConsoleProps> = ({
  onBackToLanding,
  defaultTab = "vault",
}) => {
  const [activeTab, setActiveTab] = useState<NavTab>(defaultTab);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Initialize active tab and sidebar collapsed state from URL query param / preference / viewport
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab") as NavTab | null;
      if (tabParam && PAGE_TITLES[tabParam]) {
        setActiveTab(tabParam);
      }

      if (params.get("collapsed") === "true") {
        setSidebarCollapsed(true);
      } else if (params.get("collapsed") === "false") {
        setSidebarCollapsed(false);
      } else {
        const saved = localStorage.getItem("fixproof_sidebar_collapsed");
        if (saved !== null) {
          setSidebarCollapsed(saved === "true");
        } else if (window.innerWidth < 1024) {
          setSidebarCollapsed(true);
        }
      }
    }
  }, []);

  const handleToggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem("fixproof_sidebar_collapsed", String(next));
      }
      return next;
    });
  };

  // Backend state
  const [backendOnline, setBackendOnline] = useState<boolean>(false);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [incidents, setIncidents] = useState<MatchAnalysisResult[]>([]);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Cross-page navigation context (e.g. from Hunter to Incidents)
  const [selectedIncidentForInspection, setSelectedIncidentForInspection] =
    useState<MatchAnalysisResult | null>(null);

  const loadBackendState = useCallback(async () => {
    setRefreshing(true);
    try {
      const isHealthy = await checkBackendHealth();
      setBackendOnline(isHealthy);

      if (isHealthy) {
        const [statusData, assetsData, incidentsData] = await Promise.all([
          getVaultStatus().catch(() => null),
          getRegisteredAssets().catch(() => []),
          getIncidentsList().catch(() => []),
        ]);
        setVaultStatus(statusData);
        setAssets(assetsData);
        setIncidents(incidentsData);
      } else {
        setVaultStatus(null);
      }
    } catch {
      setBackendOnline(false);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadBackendState();

    // Auto-refresh every 12 seconds
    const interval = setInterval(loadBackendState, 12000);
    return () => clearInterval(interval);
  }, [loadBackendState]);

  const [nemotronPreselectedIncident, setNemotronPreselectedIncident] =
    useState<MatchAnalysisResult | null>(null);
  const [nemotronPreselectedDocType, setNemotronPreselectedDocType] = useState<
    "COPYRIGHT_NOTICE" | "REVENUE_SHARE_OFFER" | null
  >(null);

  const handleNavigateToIncidents = (incident: MatchAnalysisResult) => {
    setSelectedIncidentForInspection(incident);
    setActiveTab("incidents");
  };

  const handleNavigateToNemotron = (
    incident?: MatchAnalysisResult,
    docType?: "COPYRIGHT_NOTICE" | "REVENUE_SHARE_OFFER"
  ) => {
    if (incident) setNemotronPreselectedIncident(incident);
    if (docType) setNemotronPreselectedDocType(docType);
    setActiveTab("nemotron");
  };

  const currentTitle = PAGE_TITLES[activeTab] || "Command Center";

  return (
    <div
      style={{
        background: "#141412",
        transition: "background 0.22s ease",
      }}
      className="flex min-h-screen text-[#A29B8F]"
    >
      {/* ─── Sidebar (Desktop Rail & Mobile Drawer) ─── */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        backendOnline={backendOnline}
        vaultSize={vaultStatus?.vault_size ?? 0}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* ─── Main Content Area ─── */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#141412]">
        {/* Active Node Sub-header */}
        <div
          style={{
            background: "#111110",
            borderBottom: "1px solid #302E29",
          }}
          className="flex items-center justify-between px-4 sm:px-6 py-2 text-[#A29B8F] text-[11px]"
        >
          <div className="flex items-center gap-2">
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: backendOnline ? "#48C7B5" : "#D9A441",
                boxShadow: backendOnline
                  ? "0 0 6px rgba(72,199,181,0.5)"
                  : "0 0 6px rgba(217,164,65,0.5)",
              }}
              className="shrink-0"
            />
            <span className="font-bold text-[#F1EBDD] uppercase tracking-wider">
              FixProof Active Node
            </span>
            <span className="text-[#736D62] hidden xs:inline">•</span>
            <span className="text-[#A29B8F] hidden xs:inline">
              MediaGuard Protocol Swarm Engine
            </span>
          </div>

          {onBackToLanding && (
            <button
              onClick={onBackToLanding}
              style={{
                background: "#1B1A18",
                border: "1px solid #302E29",
                color: "#F1EBDD",
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-[#22211E] hover:border-[#48C7B5]/30 font-medium transition-colors cursor-pointer"
            >
              <Home size={12} className="text-[#48C7B5]" />
              <span className="hidden sm:inline">Back to Landing Page</span>
              <span className="sm:hidden">Landing</span>
            </button>
          )}
        </div>

        {/* Global Dashboard Header */}
        <Header
          title={currentTitle}
          backendOnline={backendOnline}
          vaultSize={vaultStatus?.vault_size ?? 0}
          dbMode={vaultStatus?.db_mode}
          isCloud={vaultStatus?.is_cloud}
          onRefresh={loadBackendState}
          refreshing={refreshing}
          onToggleMobileMenu={() => setMobileMenuOpen(true)}
        />

        {/* Main Routed View */}
        <main className="flex-1 p-4 sm:p-6 overflow-y-auto">
          {activeTab === "overview" && (
            <Overview
              assets={assets}
              vaultStatus={vaultStatus}
              incidents={incidents}
              onNavigateToTab={setActiveTab}
              onViewIncident={handleNavigateToIncidents}
              onRefresh={loadBackendState}
              refreshing={refreshing}
            />
          )}

          {activeTab === "vault" && (
            <AssetVault
              assets={assets}
              vaultStatus={vaultStatus}
              onRefresh={loadBackendState}
              refreshing={refreshing}
            />
          )}

          {activeTab === "hunter" && (
            <ThreatHunter
              assets={assets}
              vaultStatus={vaultStatus}
              onNavigateToVault={() => setActiveTab("vault")}
              onViewIncident={handleNavigateToIncidents}
            />
          )}

          {activeTab === "incidents" && (
            <IncidentResponse
              initialIncident={selectedIncidentForInspection}
              assets={assets}
              onNavigateToVault={() => {
                setActiveTab("vault");
              }}
              onNavigateToHunter={() => setActiveTab("hunter")}
              onNavigateToNemotron={handleNavigateToNemotron}
            />
          )}

          {activeTab === "nemotron" && (
            <NemotronCenter
              incidents={incidents}
              assets={assets}
              preselectedIncident={nemotronPreselectedIncident}
              preselectedDocType={nemotronPreselectedDocType}
              onNavigateToIncidents={handleNavigateToIncidents}
            />
          )}

          {activeTab === "intelligence" && (
            <Intelligence
              assets={assets}
              vaultStatus={vaultStatus}
              incidents={incidents}
              onNavigateToTab={setActiveTab}
              onSelectIncident={handleNavigateToIncidents}
            />
          )}

          {activeTab === "enforcer" && (
            <EnforcementView
              incidents={incidents}
              assets={assets}
              onNavigateToNemotron={handleNavigateToNemotron}
            />
          )}

          {activeTab === "notifications" && (
            <SwarmLogsView
              incidents={incidents}
              assets={assets}
              vaultStatus={vaultStatus}
              backendOnline={backendOnline}
              onNavigateToTab={setActiveTab}
              onSelectIncident={handleNavigateToIncidents}
            />
          )}

          {activeTab === "settings" && <SettingsView />}

          {activeTab === "support" && <SupportView />}
        </main>
      </div>
    </div>
  );
};

export default DashboardConsole;
