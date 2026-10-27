"use client";

import React from "react";
import { AssetRecord, VaultStatus, MatchAnalysisResult } from "@/lib/types";
import { formatBytes } from "@/lib/api";

interface IntelligenceProps {
  assets: AssetRecord[];
  vaultStatus: VaultStatus | null;
  incidents: MatchAnalysisResult[];
  onNavigateToTab: (tab: any) => void;
}

export const Intelligence: React.FC<IntelligenceProps> = ({
  assets,
  vaultStatus,
  incidents,
}) => {
  const totalAssets = assets.length;
  const protectedCount = assets.filter((a) => a.indexed).length;
  const totalVectors = vaultStatus?.vault_size ?? 0;

  const matchCount = incidents.filter((i) => i.overall_status === "CANDIDATE_MATCH").length;
  const suspectCount = incidents.filter((i) => i.overall_status === "SUSPECT").length;
  const cleanCount = incidents.filter((i) => i.overall_status === "CLEAN").length;

  return (
    <div
      style={{
        background: "#171615",
        borderRadius: 20,
        border: "1px solid rgba(238, 231, 219, 0.08)",
      }}
      className="p-6 text-[#ded7cb] max-w-7xl mx-auto space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-[rgba(238,231,219,0.08)]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-[#eee7db]" />
            <h2 className="text-[17px] font-extrabold text-[#f4efe6] m-0">
              Intelligence & Vector Telemetry
            </h2>
          </div>
          <p className="text-[12px] text-[#8e887d] m-0">
            Real-time biometric vector distribution and candidate match telemetry.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            label: "FAISS Vector Density",
            value: totalVectors.toLocaleString(),
            sub: "576-dim feature vectors",
          },
          {
            label: "Reference Assets",
            value: totalAssets.toString(),
            sub: `${protectedCount} indexed (${
              totalAssets > 0 ? Math.round((protectedCount / totalAssets) * 100) : 0
            }%)`,
          },
          {
            label: "Forensic Inquiries",
            value: incidents.length.toString(),
            sub: `${matchCount} confirmed candidate matches`,
          },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              background: "#1a1918",
              border: "1px solid rgba(238, 231, 219, 0.08)",
              borderRadius: 14,
            }}
            className="p-4"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8e887d] block mb-1">
              {card.label}
            </span>
            <span className="text-2xl font-extrabold tracking-tight text-[#f4efe6] block my-0.5">
              {card.value}
            </span>
            <span className="text-[11px] text-[#736d62]">{card.sub}</span>
          </div>
        ))}
      </div>

      {/* Main Analysis Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Detection Breakdown */}
        <div
          style={{
            background: "#1a1918",
            border: "1px solid rgba(238, 231, 219, 0.08)",
            borderRadius: 16,
          }}
          className="p-5 space-y-4"
        >
          <h4 className="text-[12px] font-bold uppercase tracking-wider text-[#8e887d] m-0">
            Scan Outcome Distribution
          </h4>

          {incidents.length === 0 ? (
            <div className="text-center py-12 text-[#736d62] text-[12px]">
              No scans recorded yet to generate outcome telemetry.
            </div>
          ) : (
            <div className="space-y-3">
              {[
                { label: "Candidate Match (Infringement)", count: matchCount, color: "#d4a373" },
                { label: "Suspect Visual Proximity", count: suspectCount, color: "rgba(212, 163, 115, 0.6)" },
                { label: "Clean / Distinct Content", count: cleanCount, color: "#eee7db" },
              ].map((item) => {
                const pct = incidents.length > 0 ? (item.count / incidents.length) * 100 : 0;
                return (
                  <div key={item.label}>
                    <div className="flex justify-between text-[12px] mb-1">
                      <span className="text-[#ded7cb] font-medium">{item.label}</span>
                      <span className="font-bold text-[#f4efe6]">
                        {item.count} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-1.5 bg-[#242220] rounded-full overflow-hidden">
                      <div
                        style={{
                          width: `${pct}%`,
                          background: item.color,
                        }}
                        className="h-full rounded-full transition-all duration-300"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Protected Reference Inventory */}
        <div
          style={{
            background: "#1a1918",
            border: "1px solid rgba(238, 231, 219, 0.08)",
            borderRadius: 16,
          }}
          className="p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-[12px] font-bold uppercase tracking-wider text-[#8e887d] m-0">
              Reference Footprint Allocation
            </h4>
            <span className="text-[10px] text-[#aba497] font-mono">MobileNetV3</span>
          </div>

          {assets.length === 0 ? (
            <div className="text-center py-12 text-[#736d62] text-[12px]">
              Reference vault contains no official assets.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
              {assets.map((asset) => (
                <div
                  key={asset.asset_id}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-[#141312] border border-[rgba(238,231,219,0.06)] text-[11px]"
                >
                  <div className="truncate pr-2">
                    <p className="font-semibold text-[#f4efe6] truncate m-0">{asset.filename}</p>
                    <p className="text-[10px] text-[#8e887d] m-0">
                      {asset.frame_count} frames • {formatBytes(asset.file_size)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono text-[#ded7cb] font-bold block">
                      {asset.indexed_vectors} vectors
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Intelligence;
