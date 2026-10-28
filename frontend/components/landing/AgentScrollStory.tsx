"use client";

import React, { useState, useRef, useEffect } from "react";
import { useInView, useReducedMotion } from "framer-motion";
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
      className="scroll-mt-36 relative rounded-3xl border border-[#DCD5C9] bg-[#FFFEFA] p-6 sm:p-8 lg:p-10 shadow-[0_4px_24px_rgba(23,23,23,0.04)] transition-all duration-300 hover:border-[#b8b0a1]"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left Column: Details & Technical Specifications */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-4xl sm:text-5xl font-black font-mono text-[#DCD5C9]">
              {agent.number}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-bold uppercase tracking-wider border",
                agent.status === "live"
                  ? "bg-[#009E91]/10 text-[#009E91] border-[#009E91]/30"
                  : agent.status === "targeted"
                  ? "bg-[#0284c7]/10 text-[#0284c7] border-[#0284c7]/30"
                  : "bg-[#d97706]/10 text-[#d97706] border-[#d97706]/30"
              )}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {agent.statusLabel}
            </span>
          </div>

          <div>
            <h3 className="text-2xl sm:text-3xl font-black text-[#171717] tracking-tight mb-1">
              {agent.name}
            </h3>
            <p className="text-sm font-mono text-[#009E91] font-semibold">
              {agent.role}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#EDE7DC]/70 border border-[#DCD5C9]">
            <div className="text-sm font-bold text-[#171717] mb-1">
              &ldquo;{agent.tagline}&rdquo;
            </div>
            <p className="text-xs sm:text-sm text-[#68645D] leading-relaxed">
              {agent.description}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            {agent.technicalSpecs.map((spec) => (
              <div
                key={spec.label}
                className="p-2.5 rounded-lg bg-[#EDE7DC]/50 border border-[#DCD5C9]"
              >
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#68645D] mb-0.5">
                  {spec.label}
                </div>
                <div className="text-xs font-bold text-[#171717] font-mono truncate">
                  {spec.value}
                </div>
                <div className="text-[10px] text-[#68645D] mt-0.5 leading-tight">
                  {spec.desc}
                </div>
              </div>
            ))}
          </div>

          {agent.implementationDisclaimer && (
            <div className="text-[11px] text-[#68645D] italic flex items-start gap-1.5 pt-1">
              <span className="text-[#009E91] font-bold not-italic">Note:</span>
              <span>{agent.implementationDisclaimer}</span>
            </div>
          )}
        </div>

        {/* Right Column: Visual Stage with Selective Near-Black Technical Contrast */}
        <div className="lg:col-span-7 relative flex items-center justify-center min-h-[360px] lg:min-h-[420px]">
          <div className="relative w-full rounded-2xl border border-[#2a2c2a] bg-[#171918] p-4 sm:p-6 shadow-xl overflow-hidden flex flex-col items-center justify-center min-h-[380px] text-white">
            {/* Conditional Shader Backdrops - Active only when this panel is in view */}
            {index === 2 && isInView && !shouldReduceMotion && (
              <div className="absolute inset-0 pointer-events-none opacity-40 overflow-hidden rounded-2xl">
                <RestrainedLiquidMetal />
              </div>
            )}

            {index === 3 && isInView && !shouldReduceMotion && (
              <div className="absolute inset-0 pointer-events-none opacity-35 overflow-hidden rounded-2xl">
                <RestrainedRadialGradient />
              </div>
            )}

            {/* Illustration Per Agent */}
            <div className="relative z-10 w-full flex flex-col items-center justify-center">
              {/* Step 01: Archivist -> GatewayEndpoint */}
              {index === 0 && (
                <div className="w-full flex flex-col items-center">
                  <div className="text-xs font-mono uppercase tracking-[0.2em] text-[#2dd4bf] mb-3 text-center font-bold">
                    Controlled Reference Ingestion Pipeline
                  </div>
                  <div className="w-full overflow-hidden flex justify-center">
                    <GatewayEndpoint
                      className="max-h-[290px] w-full"
                      backgroundColor="transparent"
                      circleStrokeColor="#2e302e"
                      centerCircleStroke="#009E91"
                      logoColor="#2dd4bf"
                      iconBoxFill="#202221"
                      iconBoxStroke="#3d403e"
                    />
                  </div>
                  <div className="mt-3 text-[11px] font-mono text-[#ded7cb] text-center">
                    Official Broadcast Stream → MobileNetV3 576-dim Embeddings → FAISS Vault
                  </div>
                </div>
              )}

              {/* Step 02: Spider -> GatewayRouting */}
              {index === 1 && (
                <div className="w-full flex flex-col items-center">
                  <div className="text-xs font-mono uppercase tracking-[0.2em] text-[#38bdf8] mb-3 text-center font-bold">
                    Stream Discovery &amp; Sequential Queue Screening
                  </div>
                  <div className="w-full overflow-hidden flex justify-center">
                    <GatewayRouting
                      className="max-h-[290px] w-full"
                      backgroundColor="transparent"
                      borderColor="#2e302e"
                      innerCircleColor="#0284c7"
                      logoColor="#38bdf8"
                      iconBoxFill="#202221"
                      iconBoxStroke="#3d403e"
                    />
                  </div>
                  <div className="mt-3 text-[11px] font-mono text-[#ded7cb] text-center">
                    Candidate Feeds (Max 3) → Pre-Filter Storyboards → Threat Hunter Inspection
                  </div>
                </div>
              )}

              {/* Step 03: Sentinel -> GatewayOverhead + Liquid Metal */}
              {index === 2 && (
                <div className="w-full flex flex-col items-center">
                  <div className="text-xs font-mono uppercase tracking-[0.2em] text-[#34d399] mb-2 text-center font-bold">
                    Dual-Layer Mathematical Verification
                  </div>
                  <div className="w-full overflow-hidden flex justify-center">
                    <GatewayOverhead
                      className="max-h-[280px] w-full"
                      backgroundColor="transparent"
                      borderColor="#2e302e"
                      centerLineColor="#059669"
                      leftLineColor="#10b981"
                      rightLineColor="#10b981"
                      logoColor="#2dd4bf"
                      showBackgroundGrid={true}
                    />
                  </div>
                  <div className="mt-2 p-2.5 rounded-lg bg-black/60 border border-emerald-500/30 text-[11px] font-mono text-[#5eead4] text-center max-w-md">
                    Cross-Verification: L2 Vector Distance (0.00 – 1.00) ∩ 64-bit DCT pHash
                  </div>
                </div>
              )}

              {/* Step 04: Adjudicator -> Restrained Radial + Reasoning Cards */}
              {index === 3 && (
                <div className="w-full flex flex-col items-center">
                  <div className="text-xs font-mono uppercase tracking-[0.2em] text-[#a78bfa] mb-3 text-center font-bold">
                    Nemotron Reasoning &amp; Evidence Triage
                  </div>
                  <div className="w-full max-w-md p-4 rounded-xl bg-[#202221] border border-violet-500/30 shadow-xl space-y-3">
                    <div className="flex items-center justify-between border-b border-zinc-700 pb-2">
                      <span className="text-xs font-mono text-[#a8a196]">Model Triage State:</span>
                      <span className="text-xs font-mono font-bold text-violet-300 bg-violet-500/20 px-2 py-0.5 rounded border border-violet-500/30">
                        EVIDENCE_GROUNDED
                      </span>
                    </div>
                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex justify-between text-[#ded7cb]">
                        <span>Keyframe Verification:</span>
                        <span className="text-emerald-400 font-bold">Nemotron Vision Match</span>
                      </div>
                      <div className="flex justify-between text-[#ded7cb]">
                        <span>Temporal Alignment:</span>
                        <span className="text-[#2dd4bf] font-bold">00:04:12 – 00:04:28 (16s)</span>
                      </div>
                      <div className="flex justify-between text-[#ded7cb]">
                        <span>Fair-Use Factor:</span>
                        <span className="text-amber-400 font-bold">Highlight Reuse (Low Transform)</span>
                      </div>
                      <div className="flex justify-between text-[#ded7cb]">
                        <span>Uncertainty Margin:</span>
                        <span className="text-[#a8a196]">Within Heuristic Threshold</span>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-zinc-700 text-[10px] text-[#a8a196] leading-snug">
                      * Synthesizes reasoning chain with explicit caveats for human legal adjudicator.
                    </div>
                  </div>
                </div>
              )}

              {/* Step 05: Enforcer -> SecurityCheckpoint Approval Barrier */}
              {index === 4 && (
                <div className="w-full flex flex-col items-center">
                  <div className="text-xs font-mono uppercase tracking-[0.2em] text-[#fb7185] mb-3 text-center font-bold">
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
                  <div className="mt-3 text-[11px] font-mono text-[#ded7cb] text-center">
                    Court-Ready PDF Synthesis · Ed25519 Sealed ZIP · Zero Automated Takedowns
                  </div>
                </div>
              )}

              {/* Step 06: Broker -> Dual Path Routing */}
              {index === 5 && (
                <div className="w-full flex flex-col items-center">
                  <div className="text-xs font-mono uppercase tracking-[0.2em] text-[#fbbf24] mb-3 text-center font-bold">
                    Collaborative Licensing &amp; Rev-Share Vision
                  </div>
                  <div className="w-full max-w-md p-4 rounded-xl bg-[#202221] border border-amber-500/30 shadow-xl space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-center text-xs font-mono">
                      <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/40 text-rose-300">
                        <div className="font-bold mb-0.5">Track A: Takedown</div>
                        <div className="text-[10px] text-[#a8a196]">Unlicensed Broadcast Stream</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-300">
                        <div className="font-bold mb-0.5">Track B: Monetize</div>
                        <div className="text-[10px] text-[#a8a196]">Eligible Fan Highlight Clip</div>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/20 text-xs font-mono text-amber-200 leading-relaxed">
                      <strong>Revenue-Sharing Draft:</strong> Live in Nemotron Center. Rights holders can offer 70/30 revenue splits to creator channels directly from the evidence dashboard.
                    </div>
                    <div className="text-[10px] font-mono text-[#a8a196] text-center">
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
      className="scroll-mt-24 relative py-24 px-4 sm:px-6 md:px-10 lg:px-12 bg-[#F5F1E8] text-[#171717] border-t border-[#DCD5C9]"
    >
      <div className="relative z-10 max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#EDE7DC] border border-[#DCD5C9] mb-4 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-[#009E91]" />
            <span className="text-[11px] font-mono font-bold tracking-[0.22em] text-[#009E91] uppercase">
              The MediaGuard Agent Architecture
            </span>
          </div>

          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-[#171717] tracking-tight leading-[1.1] mb-5">
            Six specialists. One rights-protection workflow.
          </h2>

          <p className="text-[#68645D] text-base sm:text-lg leading-relaxed mb-4">
            From trusted reference media to evidence-backed decisions, MediaGuard&apos;s original
            vision connects discovery, verification, investigation and action in one coordinated
            system.
          </p>

          <p className="text-xs font-mono text-[#68645D]">
            * Explains the full intended architecture alongside verified live FixProof capabilities.
          </p>
        </div>

        {/* Compact Sticky Progress & Navigation Rail in Warm Neutral Theme */}
        <div className="sticky top-[72px] z-30 mb-12 py-2">
          <div className="bg-[#FFFEFA]/95 backdrop-blur-md border border-[#DCD5C9] rounded-2xl p-2.5 shadow-[0_4px_24px_rgba(23,23,23,0.06)] flex items-center justify-between gap-2 max-w-5xl mx-auto">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1 py-0.5">
              {AGENTS.map((agent, idx) => {
                const isActive = activeStep === idx;
                return (
                  <button
                    key={agent.id}
                    onClick={() => handleJumpToAgent(agent.id, idx)}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-left transition-all duration-200 border flex items-center gap-2 shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#009E91]/40",
                      isActive
                        ? "bg-[#171918] border-[#171918] text-[#FFFEFA] shadow-md"
                        : "bg-[#EDE7DC]/70 border-[#DCD5C9] hover:bg-[#EDE7DC] text-[#68645D] hover:text-[#171717]"
                    )}
                    aria-label={`Navigate to Agent ${agent.number}: ${agent.name}`}
                    aria-selected={isActive}
                  >
                    <span
                      className={cn(
                        "w-5 h-5 rounded flex items-center justify-center text-[10px] font-mono font-bold transition-colors",
                        isActive
                          ? "bg-[#009E91] text-white"
                          : "bg-[#FFFEFA] text-[#68645D]"
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
                          ? "bg-[#009E91]"
                          : agent.status === "targeted"
                          ? "bg-[#0284c7]"
                          : "bg-[#d97706]"
                      )}
                    />
                  </button>
                );
              })}
            </div>

            {/* Active Step Progress Indicator */}
            <div className="hidden sm:flex items-center gap-1.5 bg-[#EDE7DC] border border-[#DCD5C9] px-3 py-1.5 rounded-xl text-xs font-mono shrink-0">
              <span className="text-[#009E91] font-bold">{AGENTS[activeStep].number}</span>
              <span className="text-[#68645D]">/</span>
              <span className="text-[#68645D]">06</span>
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
