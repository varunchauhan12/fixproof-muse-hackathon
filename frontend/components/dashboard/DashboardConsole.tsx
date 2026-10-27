"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Sidebar, NavTab } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { AssetVault } from "@/components/dashboard/AssetVault";
import { ThreatHunter } from "@/components/dashboard/ThreatHunter";
import { IncidentResponse } from "@/components/dashboard/IncidentResponse";
import { Overview } from "@/components/dashboard/Overview";
import { Intelligence } from "@/components/dashboard/Intelligence";
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
import { ArrowLeft, Home } from "lucide-react";

const PAGE_TITLES: Record<NavTab, string> = {
  overview: "Command Overview",
  vault: "Digital Asset Vault",
  hunter: "Sentinel Threat Hunter",
  incidents: "Incident Response",
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

  const handleNavigateToIncidents = (incident: MatchAnalysisResult) => {
    setSelectedIncidentForInspection(incident);
    setActiveTab("incidents");
  };

  const currentTitle = PAGE_TITLES[activeTab] || "Command Center";
  const isDarkTab = [
    "overview",
    "vault",
    "hunter",
    "incidents",
    "intelligence",
    "enforcer",
    "notifications",
    "analytics",
    "settings",
    "support",
  ].includes(activeTab);

  return (
    <div
      style={{
        background: "#121211",
        transition: "background 0.25s ease",
      }}
      className="flex min-h-screen text-[#aba497]"
    >
      {/* ─── Sidebar ─── */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        backendOnline={backendOnline}
        vaultSize={vaultStatus?.vault_size ?? 0}
      />

      {/* ─── Main Content Area ─── */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#121211]">
        <div
          style={{
            background: "#141312",
            borderBottom: "1px solid rgba(238, 231, 219, 0.08)",
          }}
          className="flex items-center justify-between px-6 py-2 text-[#aba497] text-[11px]"
        >
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#eee7db]" />
            <span className="font-bold text-[#f4efe6] uppercase tracking-wider">FixProof Active Node</span>
            <span className="text-[#5a554c]">•</span>
            <span className="text-[#8e887d]">MediaGuard Protocol Swarm Engine</span>
          </div>

          {onBackToLanding && (
            <button
              onClick={onBackToLanding}
              style={{
                background: "#1c1b1a",
                border: "1px solid rgba(238, 231, 219, 0.1)",
                color: "#ded7cb",
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-[#262422] hover:text-[#f4efe6] font-medium transition-colors cursor-pointer"
            >
              <Home size={12} />
              <span>Back to Landing Page</span>
            </button>
          )}
        </div>

        <Header
          title={currentTitle}
          backendOnline={backendOnline}
          vaultSize={vaultStatus?.vault_size ?? 0}
          dbMode={vaultStatus?.db_mode}
          isCloud={vaultStatus?.is_cloud}
          onRefresh={loadBackendState}
          refreshing={refreshing}
        />

        <main className="flex-1 p-6 overflow-y-auto">
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
            <EnforcementView incidents={incidents} assets={assets} />
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
