"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence, useScroll, useMotionValueEvent, useReducedMotion } from "framer-motion";
import {
  Database,
  Radar,
  Eye,
  Brain,
  Gavel,
  Coins,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Shield,
  Layers,
  Cpu,
  FileCheck2,
  Lock,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GatewayEndpoint } from "@/components/cultui/gateway-endpoint-illustration";
import { GatewayRouting } from "@/components/cultui/gateway-route-illustration";
import { GatewayOverhead } from "@/components/cultui/gateway-svg-illustration";
import { SecurityCheckpoint } from "@/components/cultui/security-checkpoint";
import { FluidRendering } from "@/components/cultui/illustration-fluid-rendering";
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

export function AgentScrollStory() {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const [activeStep, setActiveStep] = useState(0);

  // Scroll tracking across the section
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    // Map progress 0.0 -> 1.0 into 6 steps
    const step = Math.min(5, Math.max(0, Math.floor(latest * 6)));
    if (step !== activeStep) {
      setActiveStep(step);
    }
  });

  const handleJumpToStep = (index: number) => {
    setActiveStep(index);
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scrollTop = window.scrollY + rect.top;
    const sectionHeight = rect.height;
    // Target position for step
    const targetY = scrollTop + (index / 6) * sectionHeight + 50;
    window.scrollTo({ top: targetY, behavior: "smooth" });
  };

  const handlePrev = () => {
    handleJumpToStep(Math.max(0, activeStep - 1));
  };

  const handleNext = () => {
    handleJumpToStep(Math.min(5, activeStep + 1));
  };

  const currentAgent = AGENTS[activeStep];

  return (
    <section
      id="agents"
      ref={containerRef}
      className="relative bg-[#0b0c0e] text-slate-100 border-t border-slate-800/80"
      style={{ minHeight: "360vh" }}
    >
      {/* Sticky viewport frame */}
      <div className="sticky top-0 h-screen flex flex-col justify-between py-6 md:py-8 px-6 md:px-10 lg:px-16 overflow-hidden">
        {/* Background glow specific to current step */}
        <div
          className="absolute inset-0 pointer-events-none transition-opacity duration-700 blur-[130px]"
          style={{
            background:
              activeStep === 0
                ? "radial-gradient(circle at 75% 50%, rgba(13,148,136,0.18), transparent 60%)"
                : activeStep === 1
                ? "radial-gradient(circle at 75% 50%, rgba(2,132,199,0.18), transparent 60%)"
                : activeStep === 2
                ? "radial-gradient(circle at 75% 50%, rgba(16,185,129,0.18), transparent 60%)"
                : activeStep === 3
                ? "radial-gradient(circle at 75% 50%, rgba(139,92,246,0.18), transparent 60%)"
                : activeStep === 4
                ? "radial-gradient(circle at 75% 50%, rgba(244,63,94,0.18), transparent 60%)"
                : "radial-gradient(circle at 75% 50%, rgba(245,158,11,0.18), transparent 60%)",
          }}
        />

        {/* Section Top Header & Navigation Rail */}
        <div className="relative z-20 max-w-7xl mx-auto w-full">
          {/* Eyebrow & Architecture Subtitle */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-4 pb-4 border-b border-slate-800/70">
            <div>
              <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.22em] text-teal-400 mb-1">
                <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                The MediaGuard Agent Architecture
              </div>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight">
                Six specialists. One rights-protection workflow.
              </h2>
            </div>

            {/* Architecture Scope Clarification */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono text-slate-400 hidden sm:inline-block max-w-[280px] text-right">
                Describing the full MediaGuard vision alongside verified FixProof features
              </span>
              <div className="flex items-center gap-1.5 bg-slate-900/80 border border-slate-800 px-3 py-1.5 rounded-full text-xs font-mono">
                <span className="text-teal-400 font-bold">{currentAgent.number}</span>
                <span className="text-slate-600">/</span>
                <span className="text-slate-400">06</span>
              </div>
            </div>
          </div>

          {/* Six-Agent Navigation Rail */}
          <div className="flex items-center justify-between gap-1 overflow-x-auto pb-1 scrollbar-none">
            {AGENTS.map((agent, idx) => {
              const isActive = activeStep === idx;
              const Icon = agent.icon;
              return (
                <button
                  key={agent.id}
                  onClick={() => handleJumpToStep(idx)}
                  className={cn(
                    "flex-1 min-w-[110px] md:min-w-0 px-2.5 py-2 rounded-xl text-left transition-all duration-300 border flex items-center gap-2 group cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-500/50",
                    isActive
                      ? "bg-slate-900/90 border-teal-500/50 shadow-lg shadow-teal-950/40"
                      : "bg-slate-950/40 border-slate-800/50 hover:bg-slate-900/50 hover:border-slate-700/60"
                  )}
                  aria-label={`Jump to Agent ${agent.number}: ${agent.name}`}
                  aria-selected={isActive}
                >
                  <div
                    className={cn(
                      "w-6 h-6 rounded-md flex items-center justify-center shrink-0 text-xs transition-colors font-mono font-bold",
                      isActive
                        ? "bg-teal-500/20 text-teal-300 border border-teal-500/40"
                        : "bg-slate-900 text-slate-500 group-hover:text-slate-300"
                    )}
                  >
                    {agent.number}
                  </div>
                  <div className="truncate">
                    <div
                      className={cn(
                        "text-xs font-bold truncate transition-colors",
                        isActive ? "text-white" : "text-slate-400 group-hover:text-slate-200"
                      )}
                    >
                      {agent.name}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Center Main Stage: 2-Column Split */}
        <div className="relative z-10 max-w-7xl mx-auto w-full my-auto py-4 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Agent Content & Technical Details (5 cols) */}
          <div className="lg:col-span-5 flex flex-col justify-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentAgent.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.35, ease: "easeInOut" }}
                className="space-y-4"
              >
                {/* Agent Number & Status Badge */}
                <div className="flex items-center gap-3">
                  <span className="text-4xl sm:text-5xl font-black font-mono text-slate-800">
                    {currentAgent.number}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-bold uppercase tracking-wider border",
                      currentAgent.status === "live"
                        ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                        : currentAgent.status === "targeted"
                        ? "bg-sky-500/10 text-sky-300 border-sky-500/30"
                        : "bg-amber-500/10 text-amber-300 border-amber-500/30"
                    )}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {currentAgent.statusLabel}
                  </span>
                </div>

                {/* Name & Role */}
                <div>
                  <h3 className="text-3xl sm:text-4xl font-black text-white tracking-tight mb-1">
                    {currentAgent.name}
                  </h3>
                  <p className="text-sm font-mono text-teal-400 font-medium">
                    {currentAgent.role}
                  </p>
                </div>

                {/* Story Tagline & Description */}
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80">
                  <div className="text-sm font-bold text-slate-200 mb-1">
                    &ldquo;{currentAgent.tagline}&rdquo;
                  </div>
                  <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                    {currentAgent.description}
                  </p>
                </div>

                {/* Technical Specs 2x2 Grid */}
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  {currentAgent.technicalSpecs.map((spec) => (
                    <div
                      key={spec.label}
                      className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 transition-colors"
                    >
                      <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-0.5">
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

                {/* Implementation Note Disclaimer */}
                {currentAgent.implementationDisclaimer && (
                  <div className="text-[11px] text-slate-400 italic flex items-start gap-1.5 pt-1">
                    <span className="text-teal-400 font-bold not-italic">Note:</span>
                    <span>{currentAgent.implementationDisclaimer}</span>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Right Column: Visual Stage with Cult UI Illustrations & Shaders (7 cols) */}
          <div className="lg:col-span-7 relative flex items-center justify-center min-h-[380px] lg:min-h-[460px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentAgent.id}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="relative w-full max-w-[560px] rounded-2xl border border-slate-800 bg-[#12141a]/90 backdrop-blur-xl p-4 sm:p-6 shadow-2xl overflow-hidden flex flex-col items-center justify-center"
                style={{ minHeight: "420px" }}
              >
                {/* ─── Shaders: Conditionally rendered only on their designated step ─── */}
                {activeStep === 2 && !shouldReduceMotion && (
                  <div className="absolute inset-0 pointer-events-none opacity-45 overflow-hidden rounded-2xl">
                    <RestrainedLiquidMetal />
                  </div>
                )}

                {activeStep === 3 && !shouldReduceMotion && (
                  <div className="absolute inset-0 pointer-events-none opacity-40 overflow-hidden rounded-2xl">
                    <RestrainedRadialGradient />
                  </div>
                )}

                {/* ─── Visual Illustration Per Agent ─── */}
                <div className="relative z-10 w-full flex flex-col items-center justify-center">
                  {/* Step 01: Archivist -> GatewayEndpoint */}
                  {activeStep === 0 && (
                    <div className="w-full flex flex-col items-center">
                      <div className="text-xs font-mono uppercase tracking-[0.2em] text-teal-400 mb-3 text-center">
                        Controlled Reference Ingestion Pipeline
                      </div>
                      <div className="w-full overflow-hidden flex justify-center">
                        <GatewayEndpoint
                          className="max-h-[300px] w-full"
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
                  {activeStep === 1 && (
                    <div className="w-full flex flex-col items-center">
                      <div className="text-xs font-mono uppercase tracking-[0.2em] text-sky-400 mb-3 text-center">
                        Stream Discovery & Sequential Queue Screening
                      </div>
                      <div className="w-full overflow-hidden flex justify-center">
                        <GatewayRouting
                          className="max-h-[300px] w-full"
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
                  {activeStep === 2 && (
                    <div className="w-full flex flex-col items-center">
                      <div className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400 mb-2 text-center">
                        Dual-Layer Mathematical Verification
                      </div>
                      <div className="w-full overflow-hidden flex justify-center">
                        <GatewayOverhead
                          className="max-h-[290px] w-full"
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
                  {activeStep === 3 && (
                    <div className="w-full flex flex-col items-center">
                      <div className="text-xs font-mono uppercase tracking-[0.2em] text-violet-400 mb-3 text-center">
                        Nemotron Reasoning & Evidence Triage
                      </div>
                      <div className="w-full max-w-md p-4 rounded-xl bg-slate-950/80 border border-violet-500/30 shadow-xl space-y-3">
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
                  {activeStep === 4 && (
                    <div className="w-full flex flex-col items-center">
                      <div className="text-xs font-mono uppercase tracking-[0.2em] text-rose-400 mb-3 text-center">
                        Evidence Packaging & Human Approval Gate
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

                  {/* Step 06: Broker -> Dual Path Routing / Fluid Inflow */}
                  {activeStep === 5 && (
                    <div className="w-full flex flex-col items-center">
                      <div className="text-xs font-mono uppercase tracking-[0.2em] text-amber-400 mb-3 text-center">
                        Collaborative Licensing & Rev-Share Vision
                      </div>
                      <div className="w-full max-w-md p-4 rounded-xl bg-slate-950/80 border border-amber-500/30 shadow-xl space-y-3">
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
                          Future Vision: On-chain smart contract escrow & automated creator payouts
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Section Bottom Controls: Prev/Next & Step Dots */}
        <div className="relative z-20 max-w-7xl mx-auto w-full pt-3 border-t border-slate-800/70 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-mono text-slate-400">Scroll to advance</span>
            <span className="hidden sm:inline text-slate-400">·</span>
            <span className="hidden sm:inline text-slate-400">or use step controls</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePrev}
              disabled={activeStep === 0}
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
              aria-label="Previous Agent Step"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Step indicator dots */}
            <div className="flex items-center gap-1.5">
              {AGENTS.map((agent, i) => (
                <button
                  key={agent.id}
                  onClick={() => handleJumpToStep(i)}
                  className={cn(
                    "w-2 h-2 rounded-full transition-all duration-300 cursor-pointer",
                    activeStep === i
                      ? "w-6 bg-teal-400"
                      : "bg-slate-700 hover:bg-slate-500"
                  )}
                  aria-label={`Jump to Agent ${i + 1}`}
                />
              ))}
            </div>

            <button
              onClick={handleNext}
              disabled={activeStep === 5}
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
              aria-label="Next Agent Step"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default AgentScrollStory;
