"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Search, CheckCircle2, FileText, ArrowRight, X, Sparkles } from "lucide-react";

interface JudgeWelcomeOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunchConsole: () => void;
}

export function JudgeWelcomeOverlay({
  isOpen,
  onClose,
  onLaunchConsole,
}: JudgeWelcomeOverlayProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mediaQuery.matches);
      const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="judge-welcome-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-hidden select-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Subtle dark backdrop with radial illumination */}
          <div className="absolute inset-0 bg-[#0c0c0b]/92 backdrop-blur-xl pointer-events-auto" />

          {/* Curtain panels parting entrance */}
          {!prefersReducedMotion && (
            <>
              <motion.div
                className="absolute inset-y-0 left-0 w-1/2 bg-[#121211] border-r border-teal-500/20 z-10 pointer-events-none"
                initial={{ x: 0 }}
                animate={{ x: "-100%" }}
                exit={{ x: 0 }}
                transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
              />
              <motion.div
                className="absolute inset-y-0 right-0 w-1/2 bg-[#121211] border-l border-teal-500/20 z-10 pointer-events-none"
                initial={{ x: 0 }}
                animate={{ x: "100%" }}
                exit={{ x: 0 }}
                transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
              />
            </>
          )}

          {/* Background subtle teal highlight ambient */}
          <div
            className="absolute inset-0 pointer-events-none z-0"
            style={{
              background:
                "radial-gradient(circle 500px at 50% 45%, rgba(20,184,166,0.12) 0%, transparent 70%)",
            }}
          />

          {/* Welcome Card */}
          <motion.div
            initial={
              prefersReducedMotion
                ? { opacity: 0, y: 0 }
                : { opacity: 0, scale: 0.94, y: 16 }
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.96, y: 12 }
            }
            transition={{
              duration: prefersReducedMotion ? 0.2 : 0.6,
              ease: [0.16, 1, 0.3, 1],
              delay: prefersReducedMotion ? 0 : 0.25,
            }}
            className="relative z-20 w-full max-w-2xl bg-[#171615] border border-zinc-800/90 rounded-2xl shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85),0_0_50px_-10px_rgba(20,184,166,0.18)] overflow-hidden text-[#f4efe6]"
          >
            {/* Top Bar with Eyebrow and Skip Button */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-zinc-800/60">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
                </span>
                <span className="text-[11px] font-mono tracking-widest text-teal-400 uppercase font-semibold">
                  WELCOME, JUDGES · FIXPROOF 2026
                </span>
              </div>
              <button
                onClick={onClose}
                className="group flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer px-2 py-1 rounded-md hover:bg-zinc-800/60"
                aria-label="Skip Intro"
              >
                <span>Skip Intro</span>
                <X className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
              </button>
            </div>

            {/* Main Content Area */}
            <div className="px-6 sm:px-8 py-6 space-y-6">
              {/* Heading & Intro */}
              <div className="space-y-3">
                <h1
                  id="judge-welcome-title"
                  className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight"
                >
                  From suspicious sports clips to evidence-backed decisions.
                </h1>
                <p className="text-sm sm:text-[15px] text-zinc-300 leading-relaxed font-normal">
                  FixProof monitors, fingerprints, and verifies sports video across platforms. Instead of treating similarity as proof, it combines reference vault comparison with vision-assisted analysis to confirm whether footage is licensed, mirrored, or infringed.
                </p>
              </div>

              {/* What You'll See (3 Steps) */}
              <div className="space-y-3">
                <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                  What you&apos;ll see
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Step 1 */}
                  <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-zinc-800/70 hover:border-teal-500/30 transition-colors flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="w-7 h-7 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 mb-2">
                        <Search className="w-3.5 h-3.5" />
                      </div>
                      <div className="text-xs font-semibold text-white">1. Investigate</div>
                      <p className="text-[12px] text-zinc-400 leading-snug">
                        Inspect suspect footage against reference media with frame-level precision.
                      </p>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-zinc-800/70 hover:border-teal-500/30 transition-colors flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="w-7 h-7 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 mb-2">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                      <div className="text-xs font-semibold text-white">2. Verify</div>
                      <p className="text-[12px] text-zinc-400 leading-snug">
                        Review actual frame matches, visual findings, and forensic limitations.
                      </p>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-zinc-800/70 hover:border-teal-500/30 transition-colors flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="w-7 h-7 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 mb-2">
                        <FileText className="w-3.5 h-3.5" />
                      </div>
                      <div className="text-xs font-semibold text-white">3. Take action</div>
                      <p className="text-[12px] text-zinc-400 leading-snug">
                        Generate detailed evidence-backed reports and prepare enforcement drafts.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col-reverse sm:flex-row items-center justify-between gap-3 border-t border-zinc-800/70">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs sm:text-sm font-medium text-zinc-300 hover:text-white bg-zinc-800/50 hover:bg-zinc-800 transition-colors cursor-pointer text-center"
                >
                  Explore the Platform
                </button>
                <button
                  type="button"
                  onClick={onLaunchConsole}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-zinc-950 bg-teal-400 hover:bg-teal-300 transition-all shadow-[0_0_20px_rgba(45,212,191,0.3)] hover:shadow-[0_0_25px_rgba(45,212,191,0.45)] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Launch Console</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

