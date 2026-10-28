"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import {
  Database,
  Radar,
  Eye,
  Brain,
  Gavel,
  Coins,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GatewayEndpoint } from "@/components/cultui/gateway-endpoint-illustration";
import { GatewayRouting } from "@/components/cultui/gateway-route-illustration";
import { GatewayOverhead } from "@/components/cultui/gateway-svg-illustration";
import { SecurityCheckpoint } from "@/components/cultui/security-checkpoint";
import { RestrainedRadialGradient, RestrainedLiquidMetal } from "@/components/cultui/shaders";

export interface AgentStep {
  id: string;
  number: string;
  name: string;
  role: string;
  tagline: string;
  story: string;
  description: string;
  status: "live" | "targeted" | "vision";
  statusLabel: string;
  statusNote?: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
  technicalSpecs: {
    label: string;
    value: string;
    desc: string;
  }[];
  implementationDisclaimer?: string;
}

const AGENTS: AgentStep[] = [
  {
    id: "archivist",
    number: "01",
    name: "Archivist",
    role: "Trusted Reference Ingestion & Indexing",
    tagline: "Build the trusted reference vault",
    story: "Ingests official sports media and generates durable visual embeddings.",
    description:
      "Official sports media is ingested, sampled into frames, and represented as searchable visual embeddings. Reference assets remain cryptographically isolated from suspect evidence.",
    status: "live",
    statusLabel: "Live in FixProof",
    icon: Database,
    accentColor: "teal",
    technicalSpecs: [
      { label: "Frame Sampling", value: "OpenCV 30fps/1fps", desc: "Configurable stride keyframe extraction" },
      { label: "Vector Embeddings", value: "MobileNetV3 576-dim", desc: "L2-normalized invariant visual vectors" },
      { label: "Nearest Neighbor", value: "FAISS IndexFlatL2", desc: "Sub-millisecond high-dimensional search" },
      { label: "Asset Manifest", value: "SHA-256 Fingerprint", desc: "Tamper-proof metadata and frame store" },
    ],
    implementationDisclaimer:
      "Live today in Reference Vault. Supports MP4, MOV, and AVI official reference uploads.",
  },
  {
    id: "spider",
    number: "02",
    name: "Spider",
    role: "Candidate Discovery & Stream Screening",
    tagline: "Find candidate videos worth investigating",
    story: "Screen public candidate streams and isolate candidate frames.",
    description:
      "The discovery stage identifies candidate broadcast feeds, extracts public previews or thumbnails, and stages them for forensic inspection without contaminating reference records.",
    status: "targeted",
    statusLabel: "Targeted Live · Autonomous Vision",
    icon: Radar,
    accentColor: "sky",
    technicalSpecs: [
      { label: "Input Screening", value: "Max 3 Streams", desc: "Sequential investigation batch queue" },
      { label: "Preview Extraction", value: "Thumbnail / Storyboard", desc: "Lightweight candidate pre-screening" },
      { label: "Isolation Guard", value: "Independent Errors", desc: "Per-stream failure containment" },
      { label: "Domain Discovery", value: "Platform Metadata", desc: "URL source attribution & timing" },
    ],
    implementationDisclaimer:
      "Manual URL and multi-video upload live in Threat Hunter. Continuous autonomous platform crawling represents original vision roadmap.",
  },
  {
    id: "sentinel",
    number: "03",
    name: "Sentinel",
    role: "Visual Vector Matching & Frame Verification",
    tagline: "Compare suspect streams against known reference media",
    story: "Calculates mathematical similarity metrics across dual validation layers.",
    description:
      "Visual embeddings, perceptual discrete cosine hashing, and temporal alignment help identify candidate matches. Vector metrics guide investigation without declaring legal infringement.",
    status: "live",
    statusLabel: "Live in FixProof",
    icon: Eye,
    accentColor: "emerald",
    technicalSpecs: [
      { label: "Embedding Distance", value: "FAISS L2 Norm", desc: "Dense feature vector proximity" },
      { label: "Perceptual Hash", value: "64-Bit DCT pHash", desc: "Geometric and photometric invariance" },
      { label: "Temporal Span", value: "Match Interval Mapping", desc: "Identifies start/stop scene overlap" },
      { label: "Multimodal Vision", value: "Nemotron Vision", desc: "Deep visual confirmation on keyframes" },
    ],
    implementationDisclaimer:
      "Similarity scores are heuristic vector distances, not legal proof. Live in FixProof matching core.",
  },
  {
    id: "adjudicator",
    number: "04",
    name: "Adjudicator",
    role: "Evidence-Grounded Interpretation & Triage",
    tagline: "Turn raw matches into an explainable assessment",
    story: "Model-assisted reasoning synthesizes forensic evidence for human review.",
    description:
      "Nemotron reasoning evaluates recorded similarity metrics, visual verification results, and missing evidence to help human investigators understand confidence levels and fair-use factors.",
    status: "live",
    statusLabel: "Live in FixProof",
    icon: Brain,
    accentColor: "violet",
    technicalSpecs: [
      { label: "Reasoning Engine", value: "Nemotron 70B via Nebius", desc: "Structured forensic evaluation" },
      { label: "Evidence Anchoring", value: "Strict Frame Grounding", desc: "Hallucination-resistant analysis" },
      { label: "Triage Protocol", value: "Uncertainty Handling", desc: "Explicitly flags missing or weak signals" },
      { label: "Human Escalation", value: "Review Required", desc: "Assists human decision-makers" },
    ],
    implementationDisclaimer:
      "AI provides technical triage only; human counsel retains full authority over all legal determinations.",
  },
  {
    id: "enforcer",
    number: "05",
    name: "Enforcer",
    role: "Evidence-Grounded Action Preparation",
    tagline: "Prepare responses ready for human review and dispatch",
    story: "Synthesizes multi-page forensic PDF reports and verified notice drafts.",
    description:
      "Generates detailed forensic investigation reports and editable statutory copyright notice drafts grounded in verified evidence, requiring explicit human approval before dispatch.",
    status: "live",
    statusLabel: "Live in FixProof",
    icon: Gavel,
    accentColor: "rose",
    technicalSpecs: [
      { label: "Forensic Report", value: "Automated Multi-Page PDF", desc: "Timeline, hash proof & visual evidence" },
      { label: "Cryptographic Seal", value: "Ed25519 ZIP Package", desc: "Tamper-evident verification archive" },
      { label: "Notice Drafting", value: "DMCA § 512 / EU DSA", desc: "Jurisdiction-compliant templates" },
      { label: "Dispatch Gate", value: "Slide-to-Confirm", desc: "Zero unauthorized or automated takedowns" },
    ],
    implementationDisclaimer:
      "All notice drafts remain editable. Automated takedowns are deliberately prohibited by architecture.",
  },
  {
    id: "broker",
    number: "06",
    name: "Broker",
    role: "Legitimate Licensing & Fan-Content Monetization",
    tagline: "Create a path from enforcement to shared value",
    story: "Transforms eligible fan reuse into collaborative revenue opportunities.",
    description:
      "The original MediaGuard vision proposed a revenue-sharing pathway for eligible fan-created sports content, treating creative derivative works as licensing opportunities rather than automatic takedowns.",
    status: "vision",
    statusLabel: "Drafting Live · Smart Contracts Vision",
    icon: Coins,
    accentColor: "amber",
    technicalSpecs: [
      { label: "Proposal Drafting", value: "Rev-Share Offer Drafts", desc: "Live in Nemotron Action Center" },
      { label: "Fair-Use Filter", value: "Commercial vs Editorial", desc: "Triage derivative fan creations" },
      { label: "Smart Settlement", value: "On-Chain Escrow", desc: "Automated rights split (Roadmap Vision)" },
      { label: "Micro-Licensing", value: "Decentralized Registry", desc: "Instant tokenized clearance (Roadmap Vision)" },
    ],
    implementationDisclaimer:
      "Proposal drafting is live in Nemotron Center. On-chain settlement and automated payout distribution represent original MediaGuard vision.",
  },
];

// Single Agent Card in normal flow
function AgentPanel({
  agent,
  index,
  onInView,
}: {
  agent: AgentStep;
  index: number;
  onInView: (idx: number) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const isInView = useInView(panelRef, {
    margin: "-20% 0px -40% 0px",
  });

  useEffect(() => {
    if (isInView) {
      onInView(index);
    }
  }, [isInView, index, onInView]);

  return (
    <div
      id={`agent-panel-${agent.id}`}
      ref={panelRef}
      className="scroll-mt-40 relative rounded-3xl border border-slate-800/80 bg-[#0f1118]/90 backdrop-blur-xl p-6 sm:p-8 lg:p-10 shadow-2xl transition-all duration-300 hover:border-slate-700/80"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left Column: Details & Technical Specifications */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-4xl sm:text-5xl font-black font-mono text-slate-800">
              {agent.number}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-bold uppercase tracking-wider border",
                agent.status === "live"
                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                  : agent.status === "targeted"
                  ? "bg-sky-500/10 text-sky-300 border-sky-500/30"
                  : "bg-amber-500/10 text-amber-300 border-amber-500/30"
              )}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {agent.statusLabel}
            </span>
          </div>

          <div>
            <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-1">
              {agent.name}
            </h3>
            <p className="text-sm font-mono text-teal-400 font-medium">
              {agent.role}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <div className="text-sm font-bold text-slate-200 mb-1">
              &ldquo;{agent.tagline}&rdquo;
            </div>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              {agent.description}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            {agent.technicalSpecs.map((spec) => (
              <div
                key={spec.label}
                className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 transition-colors"
              >
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-0.5">
                  {spec.label}
                </div>
                <div className="text-xs font-bold text-slate-200 font-mono truncate">
                  {spec.value}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                  {spec.desc}
                </div>
              </div>
            ))}
          </div>

          {agent.implementationDisclaimer && (
            <div className="text-[11px] text-slate-400 italic flex items-start gap-1.5 pt-1">
              <span className="text-teal-400 font-bold not-italic">Note:</span>
              <span>{agent.implementationDisclaimer}</span>
            </div>
          )}
        </div>

        {/* Right Column: Visual Stage with Cult UI Illustrations & Shaders */}
        <div className="lg:col-span-7 relative flex items-center justify-center min-h-[360px] lg:min-h-[420px]">
          <div className="relative w-full rounded-2xl border border-slate-800/90 bg-[#0a0c12]/95 backdrop-blur-xl p-4 sm:p-6 shadow-2xl overflow-hidden flex flex-col items-center justify-center min-h-[380px]">
            {/* Conditional Shader Backdrops - Only active when this panel is in view */}
            {index === 2 && isInView && !shouldReduceMotion && (
              <div className="absolute inset-0 pointer-events-none opacity-45 overflow-hidden rounded-2xl">
                <RestrainedLiquidMetal />
              </div>
            )}

            {index === 3 && isInView && !shouldReduceMotion && (
              <div className="absolute inset-0 pointer-events-none opacity-40 overflow-hidden rounded-2xl">
                <RestrainedRadialGradient />
              </div>
            )}

            {/* Illustration Per Agent */}
            <div className="relative z-10 w-full flex flex-col items-center justify-center">
              {/* Step 01: Archivist -> GatewayEndpoint */}
              {index === 0 && (
                <div className="w-full flex flex-col items-center">
                  <div className="text-xs font-mono uppercase tracking-[0.2em] text-teal-400 mb-3 text-center">
                    Controlled Reference Ingestion Pipeline
                  </div>
                  <div className="w-full overflow-hidden flex justify-center">
                    <GatewayEndpoint
                      className="max-h-[290px] w-full"
                      backgroundColor="transparent"
                      circleStrokeColor="#1e293b"
                      centerCircleStroke="#0d9488"
                      logoColor="#2dd4bf"
                      iconBoxFill="#0f172a"
                      iconBoxStroke="#334155"
                    />
                  </div>
                  <div className="mt-3 text-[11px] font-mono text-slate-400 text-center">
                    Official Broadcast Stream → MobileNetV3 576-dim Embeddings → FAISS Vault
                  </div>
                </div>
              )}

              {/* Step 02: Spider -> GatewayRouting */}
              {index === 1 && (
                <div className="w-full flex flex-col items-center">
                  <div className="text-xs font-mono uppercase tracking-[0.2em] text-sky-400 mb-3 text-center">
                    Stream Discovery &amp; Sequential Queue Screening
                  </div>
                  <div className="w-full overflow-hidden flex justify-center">
                    <GatewayRouting
                      className="max-h-[290px] w-full"
                      backgroundColor="transparent"
                      borderColor="#1e293b"
                      innerCircleColor="#0284c7"
                      logoColor="#38bdf8"
                      iconBoxFill="#0f172a"
                      iconBoxStroke="#334155"
                    />
                  </div>
                  <div className="mt-3 text-[11px] font-mono text-slate-400 text-center">
                    Candidate Feeds (Max 3) → Pre-Filter Storyboards → Threat Hunter Inspection
                  </div>
                </div>
              )}

              {/* Step 03: Sentinel -> GatewayOverhead + Liquid Metal */}
              {index === 2 && (
                <div className="w-full flex flex-col items-center">
                  <div className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400 mb-2 text-center">
                    Dual-Layer Mathematical Verification
                  </div>
                  <div className="w-full overflow-hidden flex justify-center">
                    <GatewayOverhead
                      className="max-h-[280px] w-full"
                      backgroundColor="transparent"
                      borderColor="#1e293b"
                      centerLineColor="#059669"
                      leftLineColor="#10b981"
                      rightLineColor="#10b981"
                      logoColor="#2dd4bf"
                      showBackgroundGrid={true}
                    />
                  </div>
                  <div className="mt-2 p-2.5 rounded-lg bg-black/60 border border-emerald-500/30 text-[11px] font-mono text-emerald-300 text-center max-w-md">
                    Cross-Verification: L2 Vector Distance (0.00 – 1.00) ∩ 64-bit DCT pHash
                  </div>
                </div>
              )}

              {/* Step 04: Adjudicator -> Restrained Radial + Reasoning Cards */}
              {index === 3 && (
                <div className="w-full flex flex-col items-center">
                  <div className="text-xs font-mono uppercase tracking-[0.2em] text-violet-400 mb-3 text-center">
                    Nemotron Reasoning &amp; Evidence Triage
                  </div>
                  <div className="w-full max-w-md p-4 rounded-xl bg-slate-950/90 border border-violet-500/30 shadow-xl space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-xs font-mono text-slate-400">Model Triage State:</span>
                      <span className="text-xs font-mono font-bold text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/30">
                        EVIDENCE_GROUNDED
                      </span>
                    </div>
                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex justify-between text-slate-300">
                        <span>Keyframe Verification:</span>
                        <span className="text-emerald-400 font-bold">Nemotron Vision Match</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span>Temporal Alignment:</span>
                        <span className="text-teal-400 font-bold">00:04:12 – 00:04:28 (16s)</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span>Fair-Use Factor:</span>
                        <span className="text-amber-400 font-bold">Highlight Reuse (Low Transform)</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span>Uncertainty Margin:</span>
                        <span className="text-slate-400">Within Heuristic Threshold</span>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 leading-snug">
                      * Synthesizes reasoning chain with explicit caveats for human legal adjudicator.
                    </div>
                  </div>
                </div>
              )}

              {/* Step 05: Enforcer -> SecurityCheckpoint Approval Barrier */}
              {index === 4 && (
                <div className="w-full flex flex-col items-center">
                  <div className="text-xs font-mono uppercase tracking-[0.2em] text-rose-400 mb-3 text-center">
                    Evidence Packaging &amp; Human Approval Gate
                  </div>
                  <div className="w-full overflow-hidden flex justify-center">
                    <SecurityCheckpoint
                      title="Human Authorization Gate"
                      subtitle="Tamper-Evident Ed25519 Package"
                      message="Legal notice drafts & forensic PDFs require explicit human confirmation prior to dispatch."
                      className="max-w-md w-full"
                    />
                  </div>
                  <div className="mt-3 text-[11px] font-mono text-slate-400 text-center">
                    Court-Ready PDF Synthesis · Ed25519 Sealed ZIP · Zero Automated Takedowns
                  </div>
                </div>
              )}

              {/* Step 06: Broker -> Dual Path Routing */}
              {index === 5 && (
                <div className="w-full flex flex-col items-center">
                  <div className="text-xs font-mono uppercase tracking-[0.2em] text-amber-400 mb-3 text-center">
                    Collaborative Licensing &amp; Rev-Share Vision
                  </div>
                  <div className="w-full max-w-md p-4 rounded-xl bg-slate-950/90 border border-amber-500/30 shadow-xl space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-center text-xs font-mono">
                      <div className="p-2.5 rounded-lg bg-rose-950/30 border border-rose-800/40 text-rose-300">
                        <div className="font-bold mb-0.5">Track A: Takedown</div>
                        <div className="text-[10px] text-slate-400">Unlicensed Broadcast Stream</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-800/40 text-emerald-300">
                        <div className="font-bold mb-0.5">Track B: Monetize</div>
                        <div className="text-[10px] text-slate-400">Eligible Fan Highlight Clip</div>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/20 text-xs font-mono text-amber-200 leading-relaxed">
                      <strong>Revenue-Sharing Draft:</strong> Live in Nemotron Center. Rights holders can offer 70/30 revenue splits to creator channels directly from the evidence dashboard.
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 text-center">
                      Future Vision: On-chain smart contract escrow &amp; automated creator payouts
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentScrollStory() {
  const [activeStep, setActiveStep] = useState(0);

  const handleJumpToAgent = (id: string, index: number) => {
    setActiveStep(index);
    const element = document.getElementById(`agent-panel-${id}`);
    if (element) {
      // Offset for floating header + sticky progress rail (~150px)
      const yOffset = -150;
      const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  return (
    <section
      id="agents"
      className="relative py-24 px-4 sm:px-6 md:px-10 lg:px-12 bg-[#08090d] text-slate-100 border-t border-slate-800/80"
    >
      {/* Background radial glow */}
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[500px] pointer-events-none rounded-full blur-[160px] opacity-15"
        style={{ background: "radial-gradient(circle, #0d9488 0%, #3b82f6 40%, transparent 70%)" }}
      />

      <div className="relative z-10 max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/25 mb-4">
            <Sparkles className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-[11px] font-mono font-bold tracking-[0.22em] text-teal-300 uppercase">
              The MediaGuard Agent Architecture
            </span>
          </div>

          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight leading-[1.1] mb-5">
            Six specialists. One rights-protection workflow.
          </h2>

          <p className="text-slate-400 text-base sm:text-lg leading-relaxed mb-4">
            From trusted reference media to evidence-backed decisions, MediaGuard&apos;s original
            vision connects discovery, verification, investigation and action in one coordinated
            system.
          </p>

          <p className="text-xs font-mono text-slate-400">
            * Explains the full intended architecture alongside verified live FixProof capabilities.
          </p>
        </div>

        {/* Compact Sticky Progress & Navigation Rail */}
        <div className="sticky top-[72px] z-30 mb-12 py-2">
          <div className="bg-[#0e1119]/95 backdrop-blur-xl border border-slate-800/90 rounded-2xl p-2.5 shadow-2xl flex items-center justify-between gap-2 max-w-5xl mx-auto">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1 py-0.5">
              {AGENTS.map((agent, idx) => {
                const isActive = activeStep === idx;
                return (
                  <button
                    key={agent.id}
                    onClick={() => handleJumpToAgent(agent.id, idx)}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-left transition-all duration-200 border flex items-center gap-2 shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-500/40",
                      isActive
                        ? "bg-slate-900 border-teal-500/60 shadow-md shadow-teal-950/40 text-white"
                        : "bg-slate-950/50 border-slate-800/60 hover:bg-slate-900/60 hover:border-slate-700 text-slate-400 hover:text-slate-200"
                    )}
                    aria-label={`Navigate to Agent ${agent.number}: ${agent.name}`}
                    aria-selected={isActive}
                  >
                    <span
                      className={cn(
                        "w-5 h-5 rounded flex items-center justify-center text-[10px] font-mono font-bold transition-colors",
                        isActive
                          ? "bg-teal-500/20 text-teal-300 border border-teal-500/40"
                          : "bg-slate-900 text-slate-500"
                      )}
                    >
                      {agent.number}
                    </span>
                    <span className="text-xs font-bold tracking-tight">
                      {agent.name}
                    </span>
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        agent.status === "live"
                          ? "bg-emerald-400"
                          : agent.status === "targeted"
                          ? "bg-sky-400"
                          : "bg-amber-400"
                      )}
                    />
                  </button>
                );
              })}
            </div>

            {/* Active Step Progress Indicator */}
            <div className="hidden sm:flex items-center gap-1.5 bg-slate-950/80 border border-slate-800/80 px-3 py-1.5 rounded-xl text-xs font-mono shrink-0">
              <span className="text-teal-400 font-bold">{AGENTS[activeStep].number}</span>
              <span className="text-slate-600">/</span>
              <span className="text-slate-400">06</span>
            </div>
          </div>
        </div>

        {/* Six Distinct Agent Panels in Normal Flow */}
        <div className="space-y-12">
          {AGENTS.map((agent, index) => (
            <AgentPanel
              key={agent.id}
              agent={agent}
              index={index}
              onInView={(idx) => setActiveStep(idx)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export default AgentScrollStory;
