"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowRight, X } from "lucide-react";

interface NvidiaJudgePreloaderProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunchConsole?: () => void;
}

const TELEMETRY_STAGES = [
  { threshold: 0, text: "Visual matching" },
  { threshold: 28, text: "Evidence-led investigation" },
  { threshold: 62, text: "Powered by Meta Muse" },
  { threshold: 88, text: "Built for human review" },
];

export function NvidiaJudgePreloader({
  isOpen,
  onClose,
  onLaunchConsole,
}: NvidiaJudgePreloaderProps) {
  const [progress, setProgress] = useState(0);
  const [stageText, setStageText] = useState(TELEMETRY_STAGES[0].text);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const exitTriggeredRef = useRef(false);

  // Check reduced motion preference
  useEffect(() => {
    if (typeof window !== "undefined") {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mediaQuery.matches);
      const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    }
  }, []);

  const handleFinish = useCallback(() => {
    if (exitTriggeredRef.current) return;
    exitTriggeredRef.current = true;
    setIsExiting(true);
    onClose();
  }, [onClose]);

  // Keyboard navigation: Escape is the sole intro control
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleFinish();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleFinish]);

  // Lock scroll while active
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  // Progress counter simulation & fallback safety timer
  useEffect(() => {
    if (!isOpen) {
      setProgress(0);
      setIsExiting(false);
      exitTriggeredRef.current = false;
      return;
    }

    if (prefersReducedMotion) {
      setProgress(100);
      setStageText("Built for human review");
      const timer = setTimeout(handleFinish, 1400);
      return () => clearTimeout(timer);
    }

    const startTime = performance.now();
    const duration = 1400; // 1.4s smooth intro

    const timer = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setProgress(pct);

      // Find appropriate telemetry stage
      for (let i = TELEMETRY_STAGES.length - 1; i >= 0; i--) {
        if (pct >= TELEMETRY_STAGES[i].threshold) {
          setStageText(TELEMETRY_STAGES[i].text);
          break;
        }
      }

      if (pct >= 100) {
        clearInterval(timer);
        setTimeout(() => {
          handleFinish();
        }, 180);
      }
    }, 40);

    // Hard fallback safety timer (2400ms max)
    const safetyTimer = setTimeout(() => {
      handleFinish();
    }, 2400);

    return () => {
      clearInterval(timer);
      clearTimeout(safetyTimer);
    };
  }, [isOpen, prefersReducedMotion, handleFinish]);

  const handleLaunch = () => {
    handleFinish();
    if (onLaunchConsole) {
      onLaunchConsole();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Welcome Meta Judges Preloader"
          className="fixed inset-0 z-[100] flex flex-col justify-between overflow-hidden select-none bg-[#090908] will-change-transform"
          style={{ transform: "translate3d(0, 0, 0)" }}
          initial={{ y: 0, opacity: 1 }}
          exit={{
            y: prefersReducedMotion ? 0 : "-100%",
            opacity: prefersReducedMotion ? 0 : 1,
          }}
          transition={{
            duration: prefersReducedMotion ? 0.2 : 0.6,
            ease: [0.76, 0, 0.24, 1], // cinematic shutter/curtain ease
          }}
        >
          {/* ─── Dual Shining Moving Radial Glows (Framer Web-Preload Style, Hardware-Accelerated) ─── */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {/* Meta-inspired blue glow */}
            <motion.div
              className="absolute w-[500px] h-[500px] sm:w-[700px] sm:h-[700px] rounded-full pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, rgba(0, 102, 255, 0.28) 0%, rgba(0, 102, 255, 0.08) 35%, transparent 68%)",
                left: "-10%",
                top: "15%",
                willChange: "transform",
                transform: "translate3d(0, 0, 0)",
              }}
              animate={
                prefersReducedMotion
                  ? { opacity: 0.6 }
                  : {
                      x: [0, 80, -40, 0],
                      y: [0, -50, 40, 0],
                      scale: [1, 1.12, 0.96, 1],
                    }
              }
              transition={{
                duration: 9,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />

            {/* Glow 2: Cyber Teal / Turquoise (#52C7FF / #009E91) */}
            <motion.div
              className="absolute w-[500px] h-[500px] sm:w-[700px] sm:h-[700px] rounded-full pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, rgba(82, 199, 255, 0.20) 0%, rgba(8, 102, 255, 0.06) 40%, transparent 68%)",
                right: "-10%",
                bottom: "10%",
                willChange: "transform",
                transform: "translate3d(0, 0, 0)",
              }}
              animate={
                prefersReducedMotion
                  ? { opacity: 0.6 }
                  : {
                      x: [0, -70, 50, 0],
                      y: [0, 60, -40, 0],
                      scale: [1, 0.94, 1.1, 1],
                    }
              }
              transition={{
                duration: 10,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />

            {/* Futuristic Tech Grid Pattern Overlay */}
            <div
              className="absolute inset-0 opacity-[0.14]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(241, 235, 221, 0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(241, 235, 221, 0.12) 1px, transparent 1px)",
                backgroundSize: "40px 40px",
                maskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
                WebkitMaskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
              }}
            />
          </div>

          {/* ─── Top Header Bar ─── */}
          <div className="relative z-10 flex items-center justify-between px-6 sm:px-10 pt-6 pb-4">
            {/* Hackathon indicator */}
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0866FF] opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#0866FF]" />
              </span>
              <span className="text-[11px] sm:text-xs font-mono uppercase tracking-widest text-[#0866FF] font-semibold">
                META MUSE HACKATHON 2026
              </span>
              <span className="hidden sm:inline-block text-[11px] font-mono text-[#8E887D]">
                · EVALUATION PORTAL
              </span>
            </div>

            {/* Right: Skip Button */}
            <button
              onClick={handleFinish}
              className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/25 bg-white/5 hover:bg-white/10 text-xs font-mono text-[#A29B8F] hover:text-white transition-all cursor-pointer backdrop-blur-sm"
              title="Skip intro directly (Escape)"
            >
              <span>Skip Intro</span>
              <kbd className="hidden sm:inline text-[9px] px-1 py-0.5 rounded bg-white/10 text-zinc-300 font-sans">
                Esc
              </kbd>
              <X className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white transition-colors" />
            </button>
          </div>

          {/* ─── Center Hero Content (Framer Web-Preload Core) ─── */}
          <div className="relative z-10 flex flex-col items-center justify-center text-center px-6 max-w-4xl mx-auto my-auto space-y-6">
            {/* Sub-badge pill */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#0866FF]/30 bg-[#0866FF]/10 text-[#0866FF] text-[11px] sm:text-xs font-medium tracking-wide shadow-[0_0_15px_rgba(8,102,255,0.15)]"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#0866FF]" />
              <span>META MUSE HACKATHON · JUDGE PREVIEW</span>
            </motion.div>

            {/* Primary Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="font-serif text-4xl sm:text-6xl md:text-7xl font-normal italic tracking-tight text-[#F1EBDD] leading-[1.08] drop-shadow-[0_10px_35px_rgba(0,0,0,0.9)]"
            >
              Welcome,{" "}
              <span className="bg-gradient-to-r from-[#E7E8EA] via-[#FAF3E5] to-[#AEB8C7] bg-clip-text text-transparent">
                Meta judges
              </span>
            </motion.h1>

            {/* Required Secondary Line */}
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.3 }}
              className="text-base sm:text-xl md:text-2xl text-[#D8DADF] font-light max-w-2xl leading-relaxed"
            >
              Meet FixProof —{" "}
              <span className="font-normal text-[#F1EBDD]">
                visual evidence and investigation, assisted by Meta Muse
              </span>
            </motion.p>

            {/* Progress Bar & Telemetry Status */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.4 }}
              className="w-full max-w-md pt-4 space-y-3"
            >
              {/* Progress Track */}
              <div className="relative h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#0866FF] via-[#52C7FF] to-[#0866FF] rounded-full transition-all duration-75 ease-out"
                  style={{
                    width: `${progress}%`,
                    boxShadow: "0 0 12px rgba(8, 102, 255, 0.65)",
                  }}
                />
              </div>

              {/* Progress Count & Telemetry Row */}
              <div className="flex items-center justify-between text-xs font-mono text-[#A29B8F]">
                <div className="flex items-center gap-2 truncate pr-2">
                  <span className="relative flex h-1.5 w-1.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#52C7FF] opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#52C7FF]" />
                  </span>
                  <span className="truncate text-[11px] sm:text-xs text-[#F1EBDD]/80">
                    {stageText}
                  </span>
                </div>
                <span className="font-bold text-[#0866FF] shrink-0 font-mono">
                  {progress}%
                </span>
              </div>
            </motion.div>
          </div>

          {/* ─── Bottom Actions Bar ─── */}
          <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-4 px-6 sm:px-10 pb-6 pt-3 border-t border-white/5 bg-[#090908]/60 backdrop-blur-md">
            <div className="text-[11px] font-mono text-[#8E887D] hidden sm:block">
              Computer vision · Meta Muse reasoning · Human review
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={handleFinish}
                className="flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-medium text-[#F1EBDD] hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer text-center"
              >
                Explore Homepage
              </button>
              <button
                type="button"
                onClick={handleLaunch}
                className="flex-1 sm:flex-none px-5 py-2 rounded-xl text-xs font-bold text-white bg-[#0866FF] hover:bg-[#0056d6] transition-all shadow-[0_0_20px_rgba(8,102,255,0.35)] flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Launch Console</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
export default NvidiaJudgePreloader;
