"use client";

import React, { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Cpu,
  Layers,
  Radar,
  Lock,
  FileCheck2,
  Database,
  CheckCircle2,
  Sparkles,
  Info,
} from "lucide-react";
import { GridBeam } from "@/components/cultui/grid-beam";
import { cn } from "@/lib/utils";

interface CapabilityItem {
  id: string;
  metric: string;
  label: string;
  title: string;
  description: string;
  badge: string;
  badgeType: "live" | "verified" | "core";
  icon: React.ComponentType<{ className?: string }>;
  verifiedIn: string;
}

const CAPABILITIES: CapabilityItem[] = [
  {
    id: "embeddings",
    metric: "576-dim",
    label: "Vector Dimension",
    title: "MobileNetV3 Feature Embeddings",
    description:
      "Video frames are sampled and projected into dense 576-dimensional L2-normalized feature vectors for invariant cross-resolution forensic matching.",
    badge: "Active Pipeline",
    badgeType: "core",
    icon: Cpu,
    verifiedIn: "backend/app/matcher.py",
  },
  {
    id: "dual-layer",
    metric: "Dual-Layer",
    label: "Verification Pipeline",
    title: "FAISS L2 + 64-Bit pHash",
    description:
      "Deep feature nearest-neighbor search is cross-validated with discrete cosine transform perceptual hashing to reject photometric transforms.",
    badge: "Verified Matcher",
    badgeType: "verified",
    icon: Layers,
    verifiedIn: "backend/app/matcher.py",
  },
  {
    id: "batch-hunter",
    metric: "Max 3 Streams",
    label: "Sequential Processing",
    title: "Sequential Stream Hunter",
    description:
      "Processes up to 3 suspect broadcast URLs or files sequentially with independent error boundaries, per-stream progress, and isolated results.",
    badge: "Isolated Queue",
    badgeType: "live",
    icon: Radar,
    verifiedIn: "frontend/components/investigation/ThreatHunter.tsx",
  },
  {
    id: "crypto-chain",
    metric: "SHA-256 + Ed25519",
    label: "Cryptographic Seal",
    title: "Tamper-Evident Evidence Packages",
    description:
      "Raw video frames, timestamp manifests, and similarity metrics are sealed in verifiable ZIP packages with Ed25519 digital signatures.",
    badge: "Court Preparedness",
    badgeType: "verified",
    icon: Lock,
    verifiedIn: "backend/app/evidence_package.py",
  },
  {
    id: "forensic-pdf",
    metric: "Forensic PDF",
    label: "Automated Synthesis",
    title: "Detailed Investigation Reports",
    description:
      "Automated multi-page PDF reports synthesizing Nemotron Vision frame verifications, temporal match intervals, and editable legal notices.",
    badge: "Nebius Token Factory",
    badgeType: "live",
    icon: FileCheck2,
    verifiedIn: "backend/app/report_generator.py",
  },
  {
    id: "vault-storage",
    metric: "SQLite / Supabase",
    label: "Dual-Mode Vault",
    title: "Hybrid Reference Persistence",
    description:
      "Zero-dependency local SQLite storage for edge/air-gapped operations with transparent sync to Supabase Cloud PostgreSQL.",
    badge: "Dual Backend",
    badgeType: "core",
    icon: Database,
    verifiedIn: "backend/app/database.py",
  },
];

export function GridBeamCapabilities() {
  const shouldReduceMotion = useReducedMotion();
  const [activeCard, setActiveCard] = useState<string | null>(null);

  return (
    <section
      id="capabilities"
      className="scroll-mt-24 relative py-24 px-6 md:px-8 lg:px-12 bg-[#EDE7DC] text-[#171717] overflow-hidden border-t border-[#DCD5C9]"
    >
      {/* Background ambient warm tint */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] pointer-events-none rounded-full blur-[140px] opacity-25"
        style={{ background: "radial-gradient(circle, #009E91 0%, #DCD5C9 50%, transparent 70%)" }}
      />

      <div className="relative z-10 max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#FFFEFA] border border-[#DCD5C9] mb-4 shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#009E91]" />
            <span className="text-[11px] font-mono font-bold tracking-[0.22em] text-[#009E91] uppercase">
              Verified Architectural Capabilities
            </span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-3xl sm:text-4xl lg:text-5xl font-black text-[#171717] tracking-tight leading-[1.1] mb-5"
          >
            Forensic Precision by Design.
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-[#68645D] text-base sm:text-lg leading-relaxed"
          >
            Six defensible technical metrics directly verified from FixProof&apos;s active codebase.
            Every claim is backed by real implementation, not marketing benchmarks.
          </motion.p>
        </div>

        {/* Grid Beam Container */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.25 }}
          className="rounded-2xl border border-[#DCD5C9] bg-[#FFFEFA] shadow-[0_4px_24px_rgba(23,23,23,0.06)] overflow-hidden"
        >
          <GridBeam
            rows={2}
            cols={3}
            colorVariant="teal"
            theme="light"
            duration={5000}
            active={!shouldReduceMotion}
            className="w-full"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#DCD5C9]">
              {CAPABILITIES.map((cap, index) => {
                const Icon = cap.icon;
                const isHovered = activeCard === cap.id;

                return (
                  <div
                    key={cap.id}
                    onMouseEnter={() => setActiveCard(cap.id)}
                    onMouseLeave={() => setActiveCard(null)}
                    className={cn(
                      "relative p-7 sm:p-8 transition-colors duration-200 flex flex-col justify-between group cursor-default",
                      index < 3 ? "lg:border-b lg:border-[#DCD5C9]" : "",
                      isHovered ? "bg-[#F5F1E8]" : "bg-[#FFFEFA]"
                    )}
                  >
                    <div>
                      {/* Top Row: Metric & Badge */}
                      <div className="flex items-start justify-between gap-3 mb-5">
                        <div>
                          <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-[#68645D] mb-1">
                            {cap.label}
                          </div>
                          <div className="text-2xl sm:text-3xl font-black tracking-tight text-[#171717] group-hover:text-[#009E91] transition-colors">
                            {cap.metric}
                          </div>
                        </div>

                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-mono font-bold tracking-wider uppercase border",
                            cap.badgeType === "live"
                              ? "bg-[#EDE7DC] text-[#009E91] border-[#DCD5C9]"
                              : cap.badgeType === "verified"
                              ? "bg-[#EDE7DC] text-[#009E91] border-[#DCD5C9]"
                              : "bg-[#EDE7DC] text-[#171717] border-[#DCD5C9]"
                          )}
                        >
                          <CheckCircle2 className="w-3 h-3 text-[#009E91]" />
                          {cap.badge}
                        </span>
                      </div>

                      {/* Icon & Title */}
                      <div className="flex items-center gap-2.5 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-[#EDE7DC] border border-[#DCD5C9] flex items-center justify-center text-[#009E91] group-hover:bg-[#FFFEFA] transition-colors">
                          <Icon className="w-4 h-4" />
                        </div>
                        <h3 className="text-base font-bold text-[#171717] group-hover:text-[#009E91] transition-colors">
                          {cap.title}
                        </h3>
                      </div>

                      {/* Description */}
                      <p className="text-sm text-[#68645D] leading-relaxed">
                        {cap.description}
                      </p>
                    </div>

                    {/* Footer: Verified Source File */}
                    <div className="mt-6 pt-4 border-t border-[#DCD5C9] flex items-center justify-between text-[11px] font-mono text-[#68645D]">
                      <span>Implementation:</span>
                      <code className="text-[#009E91] bg-[#EDE7DC] px-2 py-0.5 rounded border border-[#DCD5C9]">
                        {cap.verifiedIn}
                      </code>
                    </div>
                  </div>
                );
              })}
            </div>
          </GridBeam>
        </motion.div>

        {/* Disclaimer Callout */}
        <div className="mt-8 p-4 rounded-xl bg-[#FFFEFA] border border-[#DCD5C9] flex items-center gap-3 text-xs text-[#68645D] shadow-sm">
          <Info className="w-4 h-4 text-[#009E91] shrink-0" />
          <span>
            <strong className="text-[#171717]">Measured Forensic Standard:</strong> All metrics
            reflect genuine code in the running FixProof repository. Similarity scores represent
            heuristic vector distances rather than legal infringement rulings, ensuring compliance
            with fair-use judicial guidelines.
          </span>
        </div>
      </div>
    </section>
  );
}

export default GridBeamCapabilities;
