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
  getClientSessionId,
  setClientSessionId,
} from "@/lib/api";
import { useActivity } from "@/context/ActivityContext";
import { Home } from "lucide-react";

const PAGE_TITLES: Record<NavTab, string> = {
  overview: "Command Overview",
  vault: "Digital Asset Vault",
  hunter: "Sentinel Threat Hunter",
  incidents: "Incident Response",
  nemotron: "Muse Intelligence & Action Center",
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
  const [incidentsError, setIncidentsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);

  // Cross-page navigation context (e.g. from Hunter to Incidents)
  const [selectedIncidentForInspection, setSelectedIncidentForInspection] =
    useState<MatchAnalysisResult | null>(null);

  // Active visitor session tracking
  const [currentSessionId, setCurrentSessionId] = useState<string>("");

  const loadBackendState = useCallback(async () => {
    setRefreshing(true);
    setIncidentsError(null);
    const loadIncidents = () => getIncidentsList().catch(() => {
      setIncidentsError("Unable to load incidents from the backend. Refresh vault & state to retry.");
      return [];
    });
    const startMs = Date.now();
    try {
      const isHealthy = await checkBackendHealth();
      setBackendOnline(isHealthy);

      if (isHealthy) {
        const [statusData, assetsData, incidentsData] = await Promise.all([
          getVaultStatus().catch(() => null),
          getRegisteredAssets().catch(() => []),
          loadIncidents(),
        ]);
        setVaultStatus(statusData);
        setAssets(assetsData);
        setIncidents(incidentsData);
      } else {
        // Fallback probe directly to vault status
        const statusData = await getVaultStatus().catch(() => null);
        if (statusData) {
          setBackendOnline(true);
          setVaultStatus(statusData);
          const [assetsData, incidentsData] = await Promise.all([
            getRegisteredAssets().catch(() => []),
            loadIncidents(),
          ]);
          setAssets(assetsData);
          setIncidents(incidentsData);
        } else {
          setVaultStatus(null);
          setIncidentsError("Backend unavailable. Check the local backend and refresh vault & state.");
        }
      }
    } catch {
      setBackendOnline(false);
      setIncidentsError("Unable to connect to the backend. Refresh vault & state to retry.");
    } finally {
      // Ensure skeleton is visible during data extraction (minimum 700ms)
      const elapsed = Date.now() - startMs;
      if (elapsed < 700) {
        await new Promise((r) => setTimeout(r, 700 - elapsed));
      }
      setRefreshing(false);
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBackendState();
  }, [loadBackendState]);

  // Synchronize active session ID across window lifecycle
  useEffect(() => {
    if (typeof window !== "undefined") {
      setCurrentSessionId(getClientSessionId());

      const handleSessionChange = (e: any) => {
        const nextId = e.detail || getClientSessionId();
        setCurrentSessionId(nextId);
        setSelectedIncidentForInspection(null);
        loadBackendState();
      };

      window.addEventListener("fixproof_session_changed", handleSessionChange);
      return () => {
        window.removeEventListener("fixproof_session_changed", handleSessionChange);
      };
    }
  }, [loadBackendState]);

  const handleSwitchSession = useCallback((newSessionId: string) => {
    setClientSessionId(newSessionId);
    setCurrentSessionId(newSessionId);
    setSelectedIncidentForInspection(null);
    loadBackendState();
  }, [loadBackendState]);

  const [nemotronPreselectedIncident, setNemotronPreselectedIncident] =
    useState<MatchAnalysisResult | null>(null);
  const [nemotronPreselectedDocType, setNemotronPreselectedDocType] = useState<
    "COPYRIGHT_NOTICE" | "REVENUE_SHARE_OFFER" | null
  >(null);

  let activityContext: ReturnType<typeof useActivity> | null = null;
  try {
    activityContext = useActivity();
  } catch {
    // outside provider
  }

  useEffect(() => {
    const inc = selectedIncidentForInspection || nemotronPreselectedIncident;
    const incId = inc?.incident_id || null;
    const incSess = inc?.session_id || null;
    if (incId && activityContext?.setActiveIncidentId) {
      activityContext.setActiveIncidentId(incId, incSess);
    }
  }, [selectedIncidentForInspection, nemotronPreselectedIncident, activityContext]);

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
        display: "flex",
        flexDirection: "row",
        minHeight: "100vh",
        width: "100%",
      }}
      className="flex flex-row min-h-screen text-[#A29B8F]"
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
      <div
        style={{
          flex: "1 1 0%",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          background: "#141412",
        }}
        className="flex-1 flex flex-col min-w-0 bg-[#141412]"
      >
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
          currentSessionId={currentSessionId}
          onSwitchSession={handleSwitchSession}
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
              loading={initialLoading || (vaultStatus === null && assets.length === 0)}
            />
          )}

          {activeTab === "vault" && (
            <AssetVault
              assets={assets}
              vaultStatus={vaultStatus}
              onRefresh={loadBackendState}
              refreshing={refreshing}
              loading={initialLoading || (vaultStatus === null && assets.length === 0)}
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
              incidents={incidents}
              onNavigateToVault={() => {
                setActiveTab("vault");
              }}
              onNavigateToHunter={() => setActiveTab("hunter")}
              onNavigateToNemotron={handleNavigateToNemotron}
              onRefresh={loadBackendState}
            />
          )}

          {activeTab === "nemotron" && (
            <NemotronCenter
              incidents={incidents}
              assets={assets}
              incidentsLoading={initialLoading || refreshing}
              incidentsError={incidentsError}
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
