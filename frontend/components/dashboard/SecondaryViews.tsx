"use client";

import React from "react";
import { Gavel, Settings as SettingsIcon, HelpCircle } from "lucide-react";
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
        background: "#171615",
        borderRadius: 20,
        border: "1px solid rgba(238, 231, 219, 0.08)",
      }}
      className="p-6 text-[#ded7cb] max-w-7xl mx-auto space-y-6"
    >
      <div className="flex items-center justify-between pb-4 border-b border-[rgba(238,231,219,0.08)]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-[#d4a373]" />
            <h2 className="text-[17px] font-extrabold text-[#f4efe6] m-0">
              Enforcement & Licensing Operations
            </h2>
          </div>
          <p className="text-[12px] text-[#8e887d] m-0">
            Review confirmed candidate matches for legal takedown drafting or commercial licensing.
          </p>
        </div>
      </div>

      {matchIncidents.length === 0 ? (
        <div
          style={{
            background: "#1a1918",
            borderRadius: 16,
            border: "1px dashed rgba(238, 231, 219, 0.12)",
          }}
          className="text-center py-20 px-4"
        >
          <Gavel size={36} className="mx-auto text-[#736d62] mb-3" />
          <h3 className="text-[15px] font-bold text-[#f4efe6] m-0">No Actionable Infringements</h3>
          <p className="text-[12px] text-[#8e887d] mt-1 max-w-sm mx-auto">
            When a suspect video matches an official reference with confidence &gt; 60%, it will appear here for rights enforcement or revenue licensing.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {matchIncidents.map((inc) => (
            <div
              key={inc.incident_id}
              style={{
                background: "#1a1918",
                border: "1px solid rgba(212, 163, 115, 0.2)",
                borderRadius: 14,
              }}
              className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            >
              <div>
                <span className="px-2 py-0.5 rounded bg-[rgba(212,163,115,0.15)] text-[#d4a373] border border-[rgba(212,163,115,0.25)] text-[10px] font-bold uppercase tracking-wider inline-block mb-1">
                  Actionable Candidate Match
                </span>
                <p className="text-[14px] font-bold text-[#f4efe6] m-0">
                  {inc.suspect_filename || `Suspect ${inc.submitted_asset_id}`}
                </p>
                <p className="text-[11px] text-[#8e887d] m-0 mt-0.5">
                  Confidence: {inc.highest_confidence}% • {inc.candidate_matches_found} matched frame(s)
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => alert(`Notice drafted for review: ${inc.suspect_filename}`)}
                  className="px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-800 text-[#f4efe6] text-[11px] font-bold transition-colors cursor-pointer"
                >
                  Draft Notice
                </button>
                <button
                  onClick={() => alert(`Licensing contract drafted for: ${inc.suspect_filename}`)}
                  style={{
                    background: "#eee7db",
                    color: "#141312",
                  }}
                  className="px-3.5 py-1.5 rounded-lg hover:bg-[#fbf7ef] text-[11px] font-bold transition-colors cursor-pointer"
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

export { SwarmLogsView } from "./SwarmLogsView";


export const SettingsView: React.FC = () => (
  <div
    style={{
      background: "#171615",
      borderRadius: 20,
      border: "1px solid rgba(238, 231, 219, 0.08)",
    }}
    className="p-6 max-w-4xl mx-auto space-y-6 text-[#ded7cb]"
  >
    <div className="flex items-center gap-2 pb-3 border-b border-[rgba(238,231,219,0.08)]">
      <SettingsIcon size={18} className="text-[#eee7db]" />
      <h2 className="text-[17px] font-extrabold text-[#f4efe6] m-0">System Configuration</h2>
    </div>

    <div className="space-y-3 text-[13px]">
      <div
        style={{
          background: "#1a1918",
          border: "1px solid rgba(238, 231, 219, 0.08)",
          borderRadius: 12,
        }}
        className="p-4"
      >
        <strong className="block text-[#f4efe6] mb-1">Visual Backbone Model</strong>
        <p className="text-[#8e887d] m-0 text-[12px]">MobileNetV3-Small (576-dimensional L2-normalized vector embedding output)</p>
      </div>
      <div
        style={{
          background: "#1a1918",
          border: "1px solid rgba(238, 231, 219, 0.08)",
          borderRadius: 12,
        }}
        className="p-4"
      >
        <strong className="block text-[#f4efe6] mb-1">Vector Indexing Store</strong>
        <p className="text-[#8e887d] m-0 text-[12px]">FAISS IndexFlatL2 with synchronized disk metadata mappings</p>
      </div>
      <div
        style={{
          background: "#1a1918",
          border: "1px solid rgba(238, 231, 219, 0.08)",
          borderRadius: 12,
        }}
        className="p-4"
      >
        <strong className="block text-[#f4efe6] mb-1">Sampling Frequency</strong>
        <p className="text-[#8e887d] m-0 text-[12px]">1 frame every 5.0 seconds (OpenCV VideoCapture)</p>
      </div>
    </div>
  </div>
);

export const SupportView: React.FC = () => (
  <div
    style={{
      background: "#171615",
      borderRadius: 20,
      border: "1px solid rgba(238, 231, 219, 0.08)",
    }}
    className="p-6 max-w-4xl mx-auto space-y-6 text-[#ded7cb]"
  >
    <div className="flex items-center gap-2 pb-3 border-b border-[rgba(238,231,219,0.08)]">
      <HelpCircle size={18} className="text-[#eee7db]" />
      <h2 className="text-[17px] font-extrabold text-[#f4efe6] m-0">Documentation & Support</h2>
    </div>

    <div className="text-[13px] text-[#aba497] space-y-3 leading-relaxed">
      <p>
        <strong className="text-[#f4efe6]">FixProof</strong> is an autonomous video copyright detection and forensics platform designed for content owners, broadcast organizations, and digital rights holders.
      </p>
      <div
        style={{
          background: "#1a1918",
          border: "1px solid rgba(238, 231, 219, 0.1)",
          borderRadius: 12,
        }}
        className="p-4 text-[#ded7cb]"
      >
        <strong className="text-[#f4efe6]">Operational Guidelines:</strong>
        <ul className="list-disc list-inside mt-2 space-y-1 text-[12px] text-[#aba497]">
          <li>Official broadcast videos are ingested and registered into the Asset Vault.</li>
          <li>Suspect videos are scanned via Threat Hunter without being indexed as reference material.</li>
          <li>Frame matches are strictly candidate forensic comparisons, not definitive legal rulings.</li>
        </ul>
      </div>
    </div>
  </div>
);
