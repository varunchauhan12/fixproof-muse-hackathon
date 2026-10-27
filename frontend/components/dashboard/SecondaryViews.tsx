"use client";

import React from "react";
import { Gavel, Bell, Settings as SettingsIcon, HelpCircle, Shield, CheckCircle2, AlertCircle } from "lucide-react";
import { MatchAnalysisResult, AssetRecord } from "@/lib/types";

interface SecondaryProps {
  incidents: MatchAnalysisResult[];
  assets: AssetRecord[];
}

export const EnforcementView: React.FC<SecondaryProps> = ({ incidents }) => {
  const matchIncidents = incidents.filter((i) => i.candidate_matches_found > 0);

  return (
    <div
      style={{
        background: "#090d16",
        borderRadius: 24,
        border: "1px solid rgba(255, 255, 255, 0.08)",
      }}
      className="p-6 text-slate-100 max-w-7xl mx-auto space-y-6"
    >
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <h2 className="text-[17px] font-extrabold text-white m-0">
              Enforcement & Licensing Operations
            </h2>
          </div>
          <p className="text-[12px] text-slate-400 m-0">
            Review confirmed candidate matches for legal takedown drafting or commercial licensing.
          </p>
        </div>
      </div>

      {matchIncidents.length === 0 ? (
        <div
          style={{
            background: "#0f172a",
            borderRadius: 20,
            border: "1px dashed rgba(255, 255, 255, 0.15)",
          }}
          className="text-center py-20 px-4"
        >
          <Gavel size={36} className="mx-auto text-slate-600 mb-3" />
          <h3 className="text-[15px] font-bold text-white m-0">No Actionable Infringements</h3>
          <p className="text-[12px] text-slate-400 mt-1 max-w-sm mx-auto">
            When a suspect video matches an official reference with confidence &gt; 60%, it will appear here for rights enforcement or revenue licensing.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {matchIncidents.map((inc) => (
            <div
              key={inc.incident_id}
              style={{
                background: "#0f172a",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                borderRadius: 16,
              }}
              className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            >
              <div>
                <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-[10px] font-extrabold uppercase tracking-wider inline-block mb-1">
                  Actionable Candidate Match
                </span>
                <p className="text-[14px] font-bold text-white m-0">
                  {inc.suspect_filename || `Suspect ${inc.submitted_asset_id}`}
                </p>
                <p className="text-[11px] text-slate-400 m-0 mt-0.5">
                  Confidence: {inc.highest_confidence}% • {inc.candidate_matches_found} matched frame(s)
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => alert(`Notice drafted for review: ${inc.suspect_filename}`)}
                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold transition-colors"
                >
                  Draft Notice
                </button>
                <button
                  onClick={() => alert(`Licensing contract drafted for: ${inc.suspect_filename}`)}
                  className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-bold transition-colors"
                >
                  Offer Rev-Share
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const SwarmLogsView: React.FC<SecondaryProps> = ({ incidents, assets }) => (
  <div
    style={{
      background: "#090d16",
      borderRadius: 24,
      border: "1px solid rgba(255, 255, 255, 0.08)",
    }}
    className="p-6 text-slate-100 max-w-7xl mx-auto space-y-6 font-mono text-[12px]"
  >
    <div className="flex items-center justify-between pb-4 border-b border-slate-800">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full bg-teal-500" />
          <h2 className="text-[17px] font-extrabold text-white m-0 font-sans">
            Forensics Telemetry & Swarm Logs
          </h2>
        </div>
        <p className="text-[12px] text-slate-400 m-0 font-sans">
          Immutable execution log of vault indexing, frame extractions, and similarity matches.
        </p>
      </div>
    </div>

    <div
      style={{
        background: "#0f172a",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: 16,
      }}
      className="p-4 space-y-2 max-h-[500px] overflow-y-auto"
    >
      <div className="text-teal-400">[SYSTEM READY] FixProof Forensics Swarm initialized.</div>
      <div className="text-slate-400">[VAULT] Reference storage connected: {assets.length} items detected.</div>
      {assets.map((a) => (
        <div key={a.asset_id} className="text-slate-300">
          [ARCHIVIST] Reference &quot;{a.filename}&quot; — {a.frame_count} frames, {a.indexed_vectors} vectors ({a.indexed ? "INDEXED" : "UNINDEXED"}).
        </div>
      ))}
      {incidents.map((inc, i) => (
        <div key={inc.incident_id || i} className={inc.candidate_matches_found > 0 ? "text-red-400" : "text-slate-300"}>
          [SENTINEL] Scan complete: {inc.suspect_filename} → {inc.overall_status} (Conf: {inc.highest_confidence}%).
        </div>
      ))}
    </div>
  </div>
);

export const SettingsView: React.FC = () => (
  <div
    style={{
      background: "#ffffff",
      borderRadius: 20,
      border: "1px solid rgba(148, 163, 184, 0.2)",
    }}
    className="p-6 max-w-4xl mx-auto space-y-6"
  >
    <h2 className="text-[17px] font-extrabold text-slate-900 m-0">System Configuration</h2>
    <div className="space-y-4 text-[13px] text-slate-700">
      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
        <strong className="block text-slate-900 mb-1">Visual Backbone Model</strong>
        <p className="text-slate-500 m-0 text-[12px]">MobileNetV3-Small (576-dimensional L2-normalized vector embedding output)</p>
      </div>
      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
        <strong className="block text-slate-900 mb-1">Vector Indexing Store</strong>
        <p className="text-slate-500 m-0 text-[12px]">FAISS IndexFlatL2 with synchronized disk metadata mappings</p>
      </div>
      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
        <strong className="block text-slate-900 mb-1">Sampling Frequency</strong>
        <p className="text-slate-500 m-0 text-[12px]">1 frame every 5.0 seconds (OpenCV VideoCapture)</p>
      </div>
    </div>
  </div>
);

export const SupportView: React.FC = () => (
  <div
    style={{
      background: "#ffffff",
      borderRadius: 20,
      border: "1px solid rgba(148, 163, 184, 0.2)",
    }}
    className="p-6 max-w-4xl mx-auto space-y-6"
  >
    <h2 className="text-[17px] font-extrabold text-slate-900 m-0">Documentation & Support</h2>
    <div className="text-[13px] text-slate-600 space-y-3 leading-relaxed">
      <p>
        <strong>FixProof</strong> is an autonomous video copyright detection and forensics platform designed for content owners, broadcast organizations, and digital rights holders.
      </p>
      <div className="p-4 bg-teal-50 border border-teal-200 rounded-xl text-teal-900">
        <strong>Milestone 5 Operational Rules:</strong>
        <ul className="list-disc list-inside mt-2 space-y-1 text-[12px]">
          <li>Official broadcast videos are ingested and registered into the Asset Vault.</li>
          <li>Suspect videos are scanned via Threat Hunter without being indexed as reference material.</li>
          <li>Frame matches are strictly candidate forensic comparisons, not definitive legal rulings.</li>
        </ul>
      </div>
    </div>
  </div>
);
