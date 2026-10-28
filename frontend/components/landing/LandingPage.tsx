"use client";

import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  ArrowRight,
  Database,
  Globe,
  Eye,
  Brain,
  Gavel,
  Coins,
  Zap,
  CheckCircle,
  AlertCircle,
  LayoutDashboard,
  Radar,
  Users,
  Mail,
  Activity,
  Layers,
  Lock,
  Cpu,
  Sparkles,
  Info,
} from "lucide-react";
import createGlobe from "cobe";
import HalftoneBackground from "@/components/kokonutui/halftone-background";
import { JudgeWelcomeOverlay } from "@/components/ui/JudgeWelcomeOverlay";
import { CultGlobe } from "@/components/cultui/globe";
import GridBeamCapabilities from "./GridBeamCapabilities";
import AgentScrollStory from "./AgentScrollStory";

// ─── Flip Words ─────────────────────────────────────────────────────────────
export const FlipWords = ({
  words,
  interval = 2400,
  className = "",
}: {
  words: string[];
  interval?: number;
  className?: string;
}) => {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIndex((i) => (i + 1) % words.length), interval);
    return () => clearInterval(t);
  }, [words, interval]);

  return (
    <span className={`relative inline-block overflow-hidden ${className}`}>
      <AnimatePresence mode="wait">
        <motion.span
          key={words[index]}
          initial={{ opacity: 0, y: 28, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -28, filter: "blur(6px)" }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          className="inline-block"
        >
          {words[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};

// ─── COBE Globe ─────────────────────────────────────────────────────────────
export const CobeGlobe = () => {
  const [mounted, setMounted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const globeRef = useRef<any>(null);
  const phiRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !canvasRef.current) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 600;

    globeRef.current = createGlobe(canvasRef.current, {
      devicePixelRatio: dpr,
      width: size * dpr,
      height: size * dpr,
      phi: 0,
      theta: 0.25,
      dark: 1,
      diffuse: 1.6,
      mapSamples: 20000,
      mapBrightness: 5,
      mapBaseBrightness: 0.04,
      baseColor: [0.04, 0.14, 0.14],
      markerColor: [0.1, 0.85, 0.75],
      glowColor: [0.05, 0.45, 0.42],
      scale: 1.05,
      markers: [
        { location: [37.78, -122.44], size: 0.05 },
        { location: [51.51, -0.13], size: 0.05 },
        { location: [35.68, 139.65], size: 0.04 },
        { location: [28.61, 77.21], size: 0.06 },
        { location: [-23.55, -46.63], size: 0.04 },
        { location: [25.2, 55.27], size: 0.04 },
        { location: [1.35, 103.82], size: 0.03 },
        { location: [48.85, 2.35], size: 0.04 },
        { location: [-33.87, 151.21], size: 0.04 },
        { location: [55.75, 37.62], size: 0.04 },
        { location: [19.43, -99.13], size: 0.04 },
        { location: [31.23, 121.47], size: 0.05 },
      ],
    });

    const animate = () => {
      phiRef.current += 0.003;
      globeRef.current?.update({ phi: phiRef.current });
      rafRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      globeRef.current?.destroy();
    };
  }, [mounted]);

  if (!mounted) {
    return <div style={{ width: 600, height: 600 }} />;
  }

  return <canvas ref={canvasRef} style={{ width: 600, height: 600 }} />;
};

// ─── CometCard (Interactive cursor glow & tail) ──────────────────────────────
export const CometCard = ({
  children,
  className = "",
  style = {},
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const cometRef = useRef<HTMLDivElement>(null);
  const rafId = useRef<number | null>(null);
  const pos = useRef({ x: 0, y: 0, active: false });

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    pos.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      active: true,
    };
    if (!rafId.current) {
      const tick = () => {
        const comet = cometRef.current;
        if (comet && pos.current.active) {
          comet.style.left = `${pos.current.x}px`;
          comet.style.top = `${pos.current.y}px`;
          comet.style.opacity = "1";
        }
        rafId.current = requestAnimationFrame(tick);
      };
      rafId.current = requestAnimationFrame(tick);
    }
  }, []);

  const onLeave = useCallback(() => {
    pos.current.active = false;
    if (cometRef.current) cometRef.current.style.opacity = "0";
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  }, []);

  return (
    <div
      ref={cardRef}
      className={`relative overflow-hidden ${className}`}
      style={style}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <div
        ref={cometRef}
        className="pointer-events-none absolute z-20 transition-opacity duration-300"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "radial-gradient(circle, #2dd4bf 0%, transparent 70%)",
          boxShadow:
            "0 0 12px 6px rgba(45,212,191,0.5), 0 0 40px 16px rgba(45,212,191,0.15)",
          transform: "translate(-50%, -50%)",
          opacity: 0,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(600px circle at var(--mx,50%) var(--my,50%), rgba(45,212,191,0.04) 0%, transparent 60%)",
        }}
        ref={(el) => {
          if (!el) return;
          const card = cardRef.current;
          if (!card) return;
          const update = () => {
            if (pos.current.active) {
              el.style.setProperty("--mx", `${pos.current.x}px`);
              el.style.setProperty("--my", `${pos.current.y}px`);
            }
            requestAnimationFrame(update);
          };
          update();
        }}
      />
      {children}
    </div>
  );
};

// ─── Ripple Grid (Interactive Ripple Effect) ─────────────────────────────────
export const RippleGrid = ({
  rows = 10,
  cols = 24,
  cellSize = 60,
}: {
  rows?: number;
  cols?: number;
  cellSize?: number;
}) => {
  const [clicked, setClicked] = useState<{ row: number; col: number } | null>(null);
  const [key, setKey] = useState(0);
  const cells = useMemo(
    () => Array.from({ length: rows * cols }, (_, i) => i),
    [rows, cols]
  );

  return (
    <div
      className="absolute inset-0 overflow-hidden z-0"
      style={{
        maskImage:
          "radial-gradient(ellipse 100% 80% at 50% 0%, black 20%, transparent 100%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 100% 80% at 50% 0%, black 20%, transparent 100%)",
      }}
    >
      <div
        className="cursor-crosshair"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
          gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
          width: cols * cellSize,
          marginInline: "auto",
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setClicked({
            row: Math.floor((e.clientY - rect.top) / cellSize),
            col: Math.floor((e.clientX - rect.left) / cellSize),
          });
          setKey((k) => k + 1);
        }}
      >
        {cells.map((idx) => {
          const r = Math.floor(idx / cols);
          const c = idx % cols;
          const dist = clicked ? Math.hypot(clicked.row - r, clicked.col - c) : 0;
          return (
            <div
              key={`${key}-${idx}`}
              className={`border border-teal-600/10 hover:bg-teal-500/10 transition-colors duration-100 will-change-transform ${
                clicked ? "animate-cell-ripple" : ""
              }`}
              style={
                {
                  width: cellSize,
                  height: cellSize,
                  "--delay": `${clicked ? Math.max(0, dist * 28) : 0}ms`,
                  "--duration": `${130 + dist * 48}ms`,
                } as any
              }
            />
          );
        })}
      </div>
    </div>
  );
};

// ─── Stat Card (Glass Floating Badge) ─────────────────────────────────────────
export const StatCard = ({
  label,
  value,
  sub,
  tag,
  delay = 0,
  rotate = 0,
}: {
  label: string;
  value: string;
  sub: string;
  tag: string;
  delay?: number;
  rotate?: number;
}) => (
  <motion.div
    initial={{ y: -60, opacity: 0, rotate: rotate - 10, scale: 0.72, filter: "blur(8px)" }}
    animate={{ y: 0, opacity: 1, rotate, scale: 1, filter: "blur(0px)" }}
    transition={{ delay, duration: 1.0, type: "spring", stiffness: 120, damping: 16 }}
  >
    <motion.div
      animate={{ y: [0, -9, 0], rotate: [rotate, rotate + 1.5, rotate] }}
      transition={{
        duration: 5 + delay * 1.5,
        repeat: Infinity,
        ease: "easeInOut",
        delay: delay * 0.3,
      }}
      whileHover={{
        scale: 1.06,
        boxShadow: "0 12px 40px rgba(20,184,166,0.18), 0 2px 8px rgba(0,0,0,0.06)",
      }}
      className="bg-white/95 backdrop-blur-sm rounded-2xl p-4 border border-slate-100 w-[164px] cursor-default"
      style={{
        boxShadow: "0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)",
        transform: `rotate(${rotate}deg)`,
      }}
    >
      <div className="w-6 h-[2.5px] bg-teal-500 rounded-full mb-2.5" />
      <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.22em] mb-0.5">
        {label}
      </p>
      <p className="text-[1.65rem] font-black text-slate-900 leading-none mb-1">{value}</p>
      <p className="text-[10px] text-slate-400 font-medium mb-2.5 leading-snug">{sub}</p>
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-50 border border-teal-200/60 rounded-full text-[8px] font-bold text-teal-700 uppercase tracking-wider">
        <span className="w-1 h-1 rounded-full bg-teal-500 shrink-0" />
        {tag}
      </span>
    </motion.div>
  </motion.div>
);

// ─── Live Activity Ticker ─────────────────────────────────────────────────────
const TICKER_EVENTS = [
  { icon: "🕷️", text: "Spider found 18 suspects on YouTube", time: "2s ago", color: "#818cf8" },
  { icon: "👁️", text: "Sentinel: CRITICAL match — L2 0.00", time: "8s ago", color: "#fbbf24" },
  { icon: "⚖️", text: "Adjudicator: SEVERE PIRACY → Enforcer", time: "14s ago", color: "#c084fc" },
  { icon: "🔨", text: "Enforcer: DMCA drafted for @SportsStream", time: "21s ago", color: "#f87171" },
  { icon: "💰", text: "Broker: Rev-share contract minted", time: "35s ago", color: "#34d399" },
  { icon: "✅", text: "Swarm complete — 8 incidents resolved", time: "1m ago", color: "#2dd4bf" },
];

export const LiveTicker = () => (
  <div
    className="relative overflow-hidden rounded-2xl bg-[#0d1117] border border-slate-800/60 py-2.5"
    style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}
  >
    <div
      className="absolute left-0 top-0 bottom-0 w-12 z-10 pointer-events-none"
      style={{ background: "linear-gradient(to right, #0d1117, transparent)" }}
    />
    <div
      className="absolute right-0 top-0 bottom-0 w-12 z-10 pointer-events-none"
      style={{ background: "linear-gradient(to left, #0d1117, transparent)" }}
    />
    <motion.div
      animate={{ x: ["0%", "-50%"] }}
      transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
      className="flex gap-6 w-max px-4"
    >
      {[...TICKER_EVENTS, ...TICKER_EVENTS].map((e, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-2 text-[11px] font-medium whitespace-nowrap"
        >
          <span>{e.icon}</span>
          <span style={{ color: e.color }}>{e.text}</span>
          <span className="text-slate-600">{e.time}</span>
          <span className="text-slate-700 mx-1">·</span>
        </span>
      ))}
    </motion.div>
  </div>
);

// ─── 3D Tilt Card (Aceternity-style) ─────────────────────────────────────────
export const TiltCard = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [glowPos, setGlowPos] = useState({ x: 50, y: 50 });
  const [hovered, setHovered] = useState(false);

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    setTilt({ x: (cy - 0.5) * -14, y: (cx - 0.5) * 14 });
    setGlowPos({ x: cx * 100, y: cy * 100 });
  }, []);

  const onLeave = useCallback(() => {
    setTilt({ x: 0, y: 0 });
    setHovered(false);
  }, []);

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={onLeave}
      animate={{ rotateX: tilt.x, rotateY: tilt.y }}
      transition={{ type: "spring", stiffness: 300, damping: 28, mass: 0.6 }}
      style={{ transformStyle: "preserve-3d", perspective: 1000 }}
      className={`relative ${className}`}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-3xl z-10 transition-opacity duration-300"
        style={{
          opacity: hovered ? 1 : 0,
          background: `radial-gradient(280px circle at ${glowPos.x}% ${glowPos.y}%, rgba(20,184,166,0.10) 0%, transparent 70%)`,
        }}
      />
      {children}
    </motion.div>
  );
};

// ─── Agent Split Card ─────────────────────────────────────────────────────────
const SplitCard = ({
  num,
  tag,
  title,
  label,
  desc,
  cta,
  reverse = false,
}: {
  num: number;
  tag: string;
  title: string;
  label: string;
  desc: string;
  cta: string;
  reverse?: boolean;
}) => (
  <TiltCard>
    <motion.div
      initial={{ opacity: 0, y: 44 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`flex flex-col ${
        reverse ? "md:flex-row-reverse" : "md:flex-row"
      } rounded-3xl overflow-hidden border border-slate-200/70 bg-white group hover:shadow-xl transition-shadow duration-500`}
    >
      <div className="md:w-[40%] bg-gradient-to-br from-[#eef0f8] to-[#e8eef6] relative flex items-center justify-center p-10 min-h-[200px] overflow-hidden">
        <span
          className="absolute bottom-0 right-3 text-[110px] font-black leading-none select-none pointer-events-none"
          style={{ color: "rgba(148,163,184,0.18)" }}
        >
          {String(num).padStart(2, "0")}
        </span>
        <motion.div
          animate={{ y: [0, -7, 0] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: num * 0.3 }}
          className="relative z-10 px-5 py-2.5 bg-white/75 backdrop-blur-sm border border-slate-200/80 rounded-full shadow-sm"
        >
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.22em]">
            {tag}
          </span>
        </motion.div>
      </div>
      <div className="md:w-[60%] p-9 flex flex-col justify-center">
        <p className="text-[10px] font-bold text-teal-600 uppercase tracking-[0.24em] mb-3">
          — {String(num).padStart(2, "0")}, {label}
        </p>
        <h3 className="text-2xl md:text-[1.7rem] font-black text-slate-900 mb-3 leading-tight group-hover:text-teal-700 transition-colors duration-300">
          {title}
        </h3>
        <p className="text-slate-500 leading-relaxed mb-5 text-[14px]">{desc}</p>
        <div className="inline-flex">
          <span className="px-4 py-2 bg-teal-500/[0.08] border border-teal-500/20 rounded-full text-[10px] font-bold text-teal-700 uppercase tracking-[0.16em]">
            {cta}
          </span>
        </div>
      </div>
    </motion.div>
  </TiltCard>
);

const AGENTS = [
  {
    num: 1,
    tag: "MobileNetV3 + FAISS",
    label: "INGESTION",
    title: "The Archivist",
    reverse: false,
    desc: "Ingests any official video file or broadcast URL. Extracts one frame every 5s, embeds each through PyTorch MobileNetV3 into 576-dimensional L2-normalized feature vectors, and persists vectors in a FAISS index with synchronized timestamp metadata.",
    cta: "Vector Vault",
  },
  {
    num: 2,
    tag: "OSINT CRAWLER",
    label: "HUNT",
    title: "The Spider",
    reverse: true,
    desc: "Autonomous stream crawling with zero-download architecture. Scrapes suspect video streams, captures temporal frame keypoints, deduplicates URLs, and streams suspects to the threat detection queue.",
    cta: "Zero-Download Architecture",
  },
  {
    num: 3,
    tag: "DUAL-LAYER SCAN",
    label: "DETECTION",
    title: "The Sentinel",
    reverse: false,
    desc: "Layer 1: MobileNetV3 Euclidean L2 distance vector search in FAISS against all vaulted reference frames. Layer 2: Perceptual hash (pHash) hamming distance verification eliminates sub-pixel false positives with exact frame timestamp matches.",
    cta: "pHash + L2 Fusion",
  },
  {
    num: 4,
    tag: "GEMINI 2.5 FLASH",
    label: "TRIAGE",
    title: "The Adjudicator",
    reverse: true,
    desc: "Classifies each flagged incident as SEVERE PIRACY or FAIR USE / FAN CONTENT with a 0–100 numeric risk score and 17 U.S.C. § 107 fair use factor citations. Automated decision caching ensures ultra-low latency.",
    cta: "Risk Score Engine",
  },
  {
    num: 5,
    tag: "17 U.S.C. § 512(c)",
    label: "TAKEDOWN",
    title: "The Enforcer",
    reverse: false,
    desc: "Drafts legally precise DMCA takedown notices tailored to platform context, incident timestamps, and severity tiers. Notices are staged for human-in-the-loop review before dispatch.",
    cta: "DMCA Automation",
  },
  {
    num: 6,
    tag: "POLYGON REV-SHARE",
    label: "MONETIZE",
    title: "The Broker",
    reverse: true,
    desc: "Deploys dynamic revenue-sharing smart contracts for Fair Use content. Virality tiers determine the split (Platinum 20/80, Gold 25/75, Silver 30/70). Contracts are minted with mock Polygon transaction hashes.",
    cta: "Smart Contract Minting",
  },
];

// ─── Navbar Component ────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: LayoutDashboard,
    title: "Asset Vault",
    desc: "Digital reference vault with 5s frame sampling, MobileNetV3 vectors, and FAISS.",
    img: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=320&h=180&fit=crop&auto=format&q=80",
    action: "launch",
    accent: "#2dd4bf",
  },
  {
    icon: Radar,
    title: "Sentinel Threat Hunter",
    desc: "Autonomous visual similarity scan with dual-layer L2 distance and pHash cross-check.",
    img: "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=320&h=180&fit=crop&auto=format&q=80",
    action: "scroll",
    section: "pipeline",
    accent: "#818cf8",
  },
  {
    icon: Users,
    title: "Incident Dossier",
    desc: "Side-by-side suspect vs reference frame comparison with exact millisecond timestamps.",
    img: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=320&h=180&fit=crop&auto=format&q=80",
    action: "scroll",
    section: "agents",
    accent: "#34d399",
  },
  {
    icon: Mail,
    title: "Technology Stack",
    desc: "PyTorch, MobileNetV3, FAISS, Next.js 16, and Sentinel forensic algorithms.",
    img: "https://images.unsplash.com/photo-1596526131083-e8c633c948d2?w=320&h=180&fit=crop&auto=format&q=80",
    action: "scroll",
    section: "stack",
    accent: "#fbbf24",
  },
];

const FeaturesDropdown = ({
  onNavigate,
  onLaunch,
}: {
  onNavigate: (section: string) => void;
  onLaunch: () => void;
}) => {
  const [hovered, setHovered] = useState<number | null>(null);

  const handle = (item: (typeof FEATURES)[0]) => {
    if (item.action === "launch") onLaunch();
    else onNavigate(item.section!);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.94 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="absolute top-[calc(100%+18px)] left-1/2 -translate-x-1/2 z-50 w-[640px]"
    >
      <div
        className="absolute -top-[7px] left-1/2 -translate-x-1/2 w-3.5 h-3.5 rotate-45 rounded-tl-sm"
        style={{
          background: "#13141c",
          border: "1px solid rgba(255,255,255,0.1)",
          borderBottom: "none",
          borderRight: "none",
        }}
      />
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(145deg, #13141c 0%, #0f1018 100%)",
          border: "1px solid rgba(255,255,255,0.09)",
          boxShadow:
            "0 40px 100px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        <div className="px-5 pt-4 pb-3 border-b border-white/5">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.28em]">
            Explore FixProof Engine
          </p>
        </div>
        <div className="grid grid-cols-2 p-2 gap-1">
          {FEATURES.map((item, i) => {
            const Icon = item.icon;
            const isHovered = hovered === i;
            return (
              <motion.button
                key={item.title}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.2 }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => handle(item)}
                className="relative flex items-start gap-4 p-4 rounded-xl text-left overflow-hidden transition-colors duration-150"
                style={{ background: isHovered ? "rgba(255,255,255,0.05)" : "transparent" }}
              >
                <div className="w-[110px] h-[68px] rounded-xl overflow-hidden shrink-0 border border-white/8 bg-black/40 relative">
                  <img
                    src={item.img}
                    alt={item.title}
                    className="w-full h-full object-cover transition-all duration-500"
                    style={{
                      opacity: isHovered ? 1 : 0.65,
                      transform: isHovered ? "scale(1.07)" : "scale(1)",
                    }}
                  />
                  <div
                    className="absolute inset-0 transition-opacity duration-300"
                    style={{
                      background: `linear-gradient(135deg, ${item.accent}22, transparent)`,
                      opacity: isHovered ? 1 : 0,
                    }}
                  />
                </div>
                <div className="flex-1 min-w-0 pt-0.5 relative z-10">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon
                      className="w-3.5 h-3.5 shrink-0 transition-colors duration-150"
                      style={{ color: isHovered ? item.accent : "rgba(148,163,184,0.7)" }}
                    />
                    <p
                      className="text-[14px] font-bold leading-tight transition-colors duration-150"
                      style={{ color: isHovered ? "#fff" : "rgba(226,232,240,0.9)" }}
                    >
                      {item.title}
                    </p>
                  </div>
                  <p className="text-[11.5px] text-slate-400 leading-relaxed">{item.desc}</p>
                </div>
              </motion.button>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-white/5 flex items-center justify-between">
          <p className="text-[11px] text-slate-500">
            MediaGuard AI Video Protection Protocol · 2026
          </p>
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={onLaunch}
            className="text-[11px] font-bold text-teal-400 hover:text-teal-300 transition-colors flex items-center gap-1"
          >
            Launch Console →
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

export const LandingNavbar = ({
  onLaunch,
  onReplayIntro,
}: {
  onLaunch: () => void;
  onReplayIntro?: () => void;
}) => {
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const closeTimer = useRef<any>(null);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const open = useCallback(() => {
    clearTimeout(closeTimer.current);
    setFeaturesOpen(true);
  }, []);
  const close = useCallback(() => {
    closeTimer.current = setTimeout(() => setFeaturesOpen(false), 110);
  }, []);
  const keep = useCallback(() => clearTimeout(closeTimer.current), []);

  const scrollTo = (id: string) => {
    setFeaturesOpen(false);
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }), 80);
  };

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-4 px-4"
    >
      <div
        className="flex items-center w-full max-w-[820px] rounded-full px-5 py-2.5 transition-all duration-300"
        style={{
          background: scrolled ? "rgba(10,11,16,0.97)" : "rgba(10,11,16,0.88)",
          border: "1px solid rgba(255,255,255,0.09)",
          boxShadow: scrolled
            ? "0 8px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(45,212,191,0.07)"
            : "0 4px 24px rgba(0,0,0,0.4)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
        }}
      >
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="flex items-center gap-2.5 shrink-0 group mr-8"
        >
          <div className="p-1.5 rounded-lg bg-teal-500/15 border border-teal-500/20 group-hover:bg-teal-500/25 transition-colors">
            <Shield className="w-3.5 h-3.5 text-teal-400" />
          </div>
          <span className="text-[14px] font-black text-white tracking-tight">
            FixProof<span className="text-teal-400">&apos;26</span>
          </span>
        </button>

        <nav className="flex-1 flex items-center justify-center gap-0.5">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="px-4 py-1.5 text-[13px] font-medium text-slate-300 hover:text-white rounded-full hover:bg-white/5 transition-all duration-150"
          >
            Home
          </button>

          <div className="relative" onMouseEnter={open} onMouseLeave={close}>
            <button
              className="flex items-center gap-1 px-4 py-1.5 text-[13px] font-medium rounded-full transition-all duration-150"
              style={{
                color: featuresOpen ? "#fff" : "rgba(203,213,225,0.9)",
                background: featuresOpen ? "rgba(255,255,255,0.06)" : "transparent",
              }}
            >
              Features
              <motion.svg
                animate={{ rotate: featuresOpen ? 180 : 0 }}
                transition={{ duration: 0.22 }}
                className="w-3 h-3 opacity-50"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </motion.svg>
            </button>

            <AnimatePresence>
              {featuresOpen && (
                <div onMouseEnter={keep} onMouseLeave={close}>
                  <FeaturesDropdown onNavigate={scrollTo} onLaunch={onLaunch} />
                </div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={() => scrollTo("capabilities")}
            className="px-4 py-1.5 text-[13px] font-medium text-slate-300 hover:text-white rounded-full hover:bg-white/5 transition-all duration-150"
          >
            Capabilities
          </button>

          <button
            onClick={() => scrollTo("agents")}
            className="px-4 py-1.5 text-[13px] font-medium text-slate-300 hover:text-white rounded-full hover:bg-white/5 transition-all duration-150"
          >
            Agents
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0 ml-6">
          {onReplayIntro && (
            <button
              type="button"
              onClick={onReplayIntro}
              className="px-3 py-1.5 text-[12px] font-semibold text-teal-300 hover:text-white rounded-full bg-teal-500/10 border border-teal-500/30 hover:bg-teal-500/20 transition-all duration-150 flex items-center gap-1.5 cursor-pointer shadow-sm"
              title="Replay Judge Welcome Intro"
            >
              <Sparkles className="w-3.5 h-3.5 text-teal-400" />
              <span>Judge Intro</span>
            </button>
          )}
          <button
            onClick={() => scrollTo("stack")}
            className="text-[13px] font-medium text-slate-300 hover:text-white transition-colors"
          >
            Technology
          </button>
          <motion.button
            whileHover={{ scale: 1.04, boxShadow: "0 0 24px rgba(255,255,255,0.18)" }}
            whileTap={{ scale: 0.96 }}
            onClick={onLaunch}
            className="px-5 py-2 bg-white hover:bg-slate-100 text-slate-900 text-[13px] font-bold rounded-full transition-colors duration-200 cursor-pointer"
            style={{ boxShadow: "0 2px 12px rgba(255,255,255,0.12)" }}
          >
            Launch Console →
          </motion.button>
        </div>
      </div>
    </motion.header>
  );
};

// ─── Stat Cards Definitions ──────────────────────────────────────────────────
const STAT_CARDS = [
  {
    label: "Feature Pipeline",
    value: "Dual-Layer",
    sub: "MobileNetV3 + pHash embeddings",
    tag: "Forensic Core",
    delay: 0.1,
    rotate: 5,
  },
  {
    label: "Swarm Agents",
    value: "6",
    sub: "Autonomous forensic pipeline",
    tag: "Multi-Agent",
    delay: 0.24,
    rotate: -4,
  },
  {
    label: "Threat Hunter",
    value: "Max 3",
    sub: "Sequential stream inspection",
    tag: "Isolated Queue",
    delay: 0.38,
    rotate: 6,
  },
  {
    label: "Vector Store",
    value: "FAISS",
    sub: "576-dim L2 embeddings",
    tag: "Instant Index",
    delay: 0.52,
    rotate: -3,
  },
];

const CARD_POSITIONS = [
  { top: "4%", left: "-6%" },
  { top: "-4%", left: "44%" },
  { bottom: "6%", left: "-2%" },
  { bottom: "2%", right: "-8%" },
];

const WORDS = ["Detects", "Adjudicates", "Monetizes", "Protects"];

// ─── Hero Section ────────────────────────────────────────────────────────────
export const Hero = ({
  onLaunch,
  onReplayIntro,
}: {
  onLaunch: () => void;
  onReplayIntro?: () => void;
}) => (
  <section
    className="relative min-h-screen overflow-hidden pt-24"
    style={{ background: "linear-gradient(140deg, #daf2ed 0%, #edf0f8 50%, #e2e8f6 100%)" }}
  >
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: "radial-gradient(circle, #9abfb8 1px, transparent 1px)",
        backgroundSize: "26px 26px",
        opacity: 0.28,
      }}
    />
    <RippleGrid rows={10} cols={24} cellSize={60} />

    <div className="relative z-10 max-w-7xl mx-auto px-8 lg:px-12 flex flex-col lg:flex-row items-center gap-8 min-h-[calc(100vh-6rem)]">
      <div className="flex-none w-full lg:w-[500px] xl:w-[540px] py-12">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/25 mb-7"
        >
          <Zap className="w-3 h-3 text-teal-600 fill-teal-600" />
          <span className="text-[10px] font-bold text-teal-700 uppercase tracking-[0.22em]">
            Autonomous IP Protection · MediaGuard-Powered Console
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
          className="font-black text-slate-900 tracking-tight leading-[0.9] mb-5"
          style={{ fontSize: "clamp(2.8rem, 5.5vw, 4.2rem)" }}
        >
          FixProof
          <br />
          Sports
          <br />
          <span
            className="text-teal-600"
            style={{
              textDecoration: "underline",
              textDecorationColor: "#2dd4bf",
              textDecorationThickness: "4px",
              textUnderlineOffset: "7px",
            }}
          >
            <FlipWords words={WORDS} />
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="text-[15px] font-bold text-teal-600 mb-4 tracking-wide"
        >
          Detect. Adjudicate. Monetize.
        </motion.p>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="text-slate-500 leading-relaxed mb-4 text-[15px] max-w-[430px]"
        >
          An autonomous forensic pipeline that monitors video streams, flags candidate visual matches with MobileNetV3 embeddings and pHash, and prepares evidence-backed reports and enforcement drafts for human review.
        </motion.p>

        {/* Heuristic metric disclaimer badge */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5 }}
          className="mb-8 p-3 rounded-xl bg-teal-900/5 border border-teal-600/20 max-w-[430px] flex items-start gap-2.5 text-[11.5px] text-slate-600 leading-snug"
        >
          <Info className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
          <span>
            <strong>Heuristic Metric:</strong> Similarity scores represent visual vector distances, not calibrated legal proof of infringement. All findings require human review.
          </span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.42, duration: 0.55 }}
          className="flex flex-wrap items-center gap-3"
        >
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            onClick={onLaunch}
            className="px-7 py-3.5 bg-slate-900 hover:bg-teal-700 text-white font-bold text-sm rounded-full transition-all duration-200 shadow-xl shadow-slate-900/20 flex items-center gap-2 cursor-pointer"
          >
            Launch Swarm Console <ArrowRight className="w-4 h-4" />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            onClick={() =>
              document.getElementById("agents")?.scrollIntoView({ behavior: "smooth" })
            }
            className="px-6 py-3.5 bg-white/80 border border-slate-200 text-slate-700 hover:border-teal-400 hover:text-teal-700 font-bold text-sm rounded-full transition-all duration-200 shadow-sm cursor-pointer"
          >
            Explore Agents
          </motion.button>
          {onReplayIntro && (
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              onClick={onReplayIntro}
              className="px-5 py-3.5 bg-teal-500/10 border border-teal-500/25 text-teal-800 hover:bg-teal-500/20 font-semibold text-sm rounded-full transition-all duration-200 flex items-center gap-2 cursor-pointer shadow-sm"
              title="Open Welcome Overview for Judges"
            >
              <Sparkles className="w-4 h-4 text-teal-600" />
              <span>Judge Intro</span>
            </motion.button>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.58, duration: 0.55 }}
          className="mt-8 max-w-[430px]"
        >
          <LiveTicker />
        </motion.div>
      </div>

      <div
        className="flex-1 relative hidden lg:flex items-center justify-end pr-4"
        style={{ minHeight: 600 }}
      >
        {/* Kokonut UI Halftone Background Layer behind Globe */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none flex items-center justify-center">
          <HalftoneBackground
            className="!bg-transparent w-full h-full min-h-0 opacity-75"
            cell={14}
            inkColor="#0d9488"
            center={true}
            loupe={false}
          >
            {null}
          </HalftoneBackground>
        </div>

        <div className="relative z-10 flex items-center justify-center" style={{ width: 560, height: 560 }}>
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: "radial-gradient(circle, rgba(20,184,166,0.18) 0%, transparent 70%)",
            }}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex items-center justify-center"
          >
            <CultGlobe globeSize={520} />
          </motion.div>
          {STAT_CARDS.map((card, i) => (
            <div key={card.label} className="absolute z-10 pointer-events-auto" style={CARD_POSITIONS[i] as any}>
              <StatCard {...card} />
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

// ─── Agents Section ──────────────────────────────────────────────────────────
export const AgentsSection = () => (
  <section id="agents" className="py-28 px-8 bg-[#f6f7fc]">
    <div className="max-w-5xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 22 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="text-center mb-16"
      >
        <p className="text-[10px] font-bold text-teal-600 uppercase tracking-[0.28em] mb-4">
          The Autonomous Swarm
        </p>
        <h2 className="text-5xl md:text-6xl font-black text-slate-900 tracking-tight mb-5">
          6 Agents.
          <br />
          <span className="text-teal-600">One Pipeline.</span>
        </h2>
        <p className="text-[17px] text-slate-500 max-w-lg mx-auto leading-relaxed">
          One video ingestion triggers the entire swarm. Each agent hands off to the next
          automatically. Human intervention only at the final approval step.
        </p>
      </motion.div>
      <div className="space-y-5">
        {AGENTS.map((a) => (
          <SplitCard key={a.num} {...a} />
        ))}
      </div>
    </div>
  </section>
);

// ─── Pipeline Section ────────────────────────────────────────────────────────
const HOW_STEPS = [
  { icon: Globe, label: "Spider Crawls", desc: "Temporal stream sampling", color: "#6366f1" },
  { icon: Eye, label: "Sentinel Scans", desc: "MobileNetV3 + pHash dual-layer", color: "#f59e0b" },
  { icon: Brain, label: "Adjudicator Rules", desc: "Risk score & fair use triage", color: "#a855f7" },
  { icon: Gavel, label: "Enforcer Drafts", desc: "17 U.S.C. § 512(c) notice", color: "#ef4444" },
  { icon: Coins, label: "Broker Mints", desc: "Dynamic rev-share contract", color: "#10b981" },
  { icon: CheckCircle, label: "Human Approves", desc: "One click. Mission complete.", color: "#0d9488" },
];

export const PipelineSection = () => (
  <section id="pipeline" className="py-28 px-8 bg-white">
    <div className="max-w-5xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 22 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="text-center mb-16"
      >
        <p className="text-[10px] font-bold text-teal-600 uppercase tracking-[0.28em] mb-4">
          The Agentic Pipeline
        </p>
        <h2 className="text-5xl md:text-6xl font-black text-slate-900 tracking-tight mb-5">
          One Video.
          <br />
          <span className="text-teal-600">Full Autonomy.</span>
        </h2>
        <p className="text-[17px] text-slate-500 max-w-lg mx-auto leading-relaxed">
          POST{" "}
          <code className="text-teal-600 bg-teal-50 px-2 py-0.5 rounded-md text-sm font-mono border border-teal-100">
            /api/threats/scan
          </code>{" "}
          — all phases execute autonomously, verifying candidate visual matches in sub-seconds.
        </p>
      </motion.div>

      <div className="flex flex-col md:flex-row items-start justify-between gap-6 relative mb-16">
        <div className="hidden md:block absolute top-11 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
        {HOW_STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <motion.div
              key={step.label}
              initial={{ opacity: 0, y: 36 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.09, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center text-center relative z-10 flex-1"
            >
              <motion.div
                whileHover={{ scale: 1.1, rotate: 3 }}
                className="w-[88px] h-[88px] rounded-2xl flex items-center justify-center mb-4"
                style={{
                  backgroundColor: `${step.color}12`,
                  border: `1.5px solid ${step.color}22`,
                  boxShadow: `0 4px 20px ${step.color}18`,
                }}
              >
                <Icon className="w-7 h-7" style={{ color: step.color }} />
              </motion.div>
              <p className="text-[13px] font-black text-slate-900 mb-1">{step.label}</p>
              <p className="text-[11px] text-slate-400 font-medium leading-snug">{step.desc}</p>
            </motion.div>
          );
        })}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 22 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="bg-[#0d1117] rounded-3xl p-8 font-mono overflow-x-auto border border-slate-800/60"
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}
      >
        <div className="flex items-center gap-2 mb-5">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
          <span className="ml-4 text-[10px] text-slate-500 uppercase tracking-widest font-bold">
            fixproof_telemetry.log
          </span>
        </div>
        <div className="space-y-1.5 text-[12px]">
          {[
            ["#818cf8", "🕷️  [Phase 1] Ingest — Extracting keyframes every 5s via OpenCV..."],
            ["#64748b", "   → 3 frames extracted. Validated MP4 container format."],
            ["#fbbf24", "👁️  [Phase 2] Sentinel — Querying 576-dim FAISS vault (L2 + pHash)..."],
            ["#64748b", "   → L2: 0.0000 (Exact match) | pHash Hamming: 0 (100% Score)"],
            ["#c084fc", "⚖️  [Phase 3] Adjudicator — Evaluating candidate similarity risk..."],
            ["#64748b", "   → Result: CANDIDATE_MATCH (Severity: CRITICAL)"],
            ["#f87171", "🔨 [Phase 4] Enforcer — Staging legal DMCA draft (17 U.S.C. § 512(c))..."],
            ["#64748b", "   → Staged in Incident Response dossier. Awaiting human approval."],
            ["#34d399", "💰 [Phase 5] Broker — Rev-share calculation ready for fair use terms..."],
            ["#2dd4bf", "✅ [Swarm Complete] Forensic investigation completed in 0.89s."],
          ].map(([color, msg], i) => (
            <motion.p
              key={i}
              style={{ color }}
              initial={{ opacity: 0, x: -10 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.25 + i * 0.07 }}
            >
              {msg}
            </motion.p>
          ))}
        </div>
      </motion.div>
    </div>
  </section>
);

// ─── Tech Marquee ─────────────────────────────────────────────────────────────
const MARQUEE_ITEMS = [
  "PyTorch MobileNetV3",
  "FAISS Vector DB",
  "pHash Perceptual Hashing",
  "OpenCV Video Sampling",
  "FastAPI Engine",
  "Next.js 16.4 Turbopack",
  "React 19 Interactive UI",
  "Tailwind CSS 4",
  "L2 Euclidean Distance",
  "Sentinel Forensics",
  "SHA-256 Verification",
  "Framer Motion Physics",
  "Cobe 3D WebGL Globe",
];

export const Marquee = () => (
  <div className="relative overflow-hidden py-4 bg-white border-y border-slate-100">
    <div
      className="absolute left-0 top-0 bottom-0 w-24 z-10 pointer-events-none"
      style={{ background: "linear-gradient(to right, white, transparent)" }}
    />
    <div
      className="absolute right-0 top-0 bottom-0 w-24 z-10 pointer-events-none"
      style={{ background: "linear-gradient(to left, white, transparent)" }}
    />
    <motion.div
      animate={{ x: ["0%", "-50%"] }}
      transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
      className="flex gap-3 w-max"
    >
      {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200/70 rounded-full text-[11px] font-bold text-slate-600 whitespace-nowrap"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
          {item}
        </span>
      ))}
    </motion.div>
  </div>
);

// ─── Live Threat Card ─────────────────────────────────────────────────────────
export const LiveThreatCard = () => (
  <CometCard
    className="bg-[#0d1117] rounded-3xl overflow-hidden border border-slate-800/60"
    style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}
  >
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
            Live Threat Detected
          </span>
        </div>
        <span className="text-[10px] font-bold text-teal-400 bg-teal-400/10 px-2.5 py-1 rounded-full border border-teal-400/20">
          Sentinel Active
        </span>
      </div>
      <div className="px-6 py-5 font-mono text-xs space-y-2">
        {[
          ["suspect_file", "sample_match_highlight.mp4", "#fbbf24"],
          ["vault_ref_id", "c7fd5fed-eb3f-493d-a4b4", "#e2e8f0"],
          ["l2_distance", "0.0000 (Exact)", "#f87171"],
          ["phash_match", "true (Hamming: 0)", "#f87171"],
          ["confidence", "100.0%", "#2dd4bf"],
        ].map(([k, v, c]) => (
          <div key={k} className="flex justify-between">
            <span className="text-slate-500">{k}</span>
            <span style={{ color: c }} className="truncate max-w-[200px] font-bold">
              {v}
            </span>
          </div>
        ))}
      </div>
      <div className="mx-4 mb-4 bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4">
        <p className="text-[11px] font-bold text-slate-300 mb-3">
          Adjudicator Recommended Classification
        </p>
        <div className="space-y-2">
          {[
            ["SEVERE PIRACY — direct unauthorized broadcast mirror", true],
            ["FAIR USE — transformative critique or commentary", false],
          ].map(([opt, active]) => (
            <div
              key={String(opt)}
              className={`px-3 py-2 rounded-xl text-[11px] font-medium border cursor-default ${
                active
                  ? "bg-red-500/15 border-red-500/30 text-red-300"
                  : "bg-slate-700/40 border-slate-600/40 text-slate-400"
              }`}
            >
              {opt}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  </CometCard>
);

// ─── AI Reasoning Bubble ─────────────────────────────────────────────────────
export const AICoachBubble = () => (
  <CometCard
    className="bg-[#0d1117] rounded-3xl border border-slate-800/60"
    style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}
  >
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: 0.15 }}
      className="p-6"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-teal-500/20 border border-teal-500/30 flex items-center justify-center">
          <Brain className="w-4 h-4 text-teal-400" />
        </div>
        <div>
          <p className="text-[11px] font-black text-teal-400">Sentinel Forensics Engine</p>
          <p className="text-[9px] text-slate-500 uppercase tracking-widest">
            MobileNetV3 + FAISS L2 + pHash
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
          <span className="text-[9px] text-teal-500 font-bold uppercase tracking-wider">
            Verified
          </span>
        </div>
      </div>
      <div className="bg-slate-800/50 rounded-2xl p-4 text-[12px] text-slate-300 leading-relaxed border border-slate-700/40">
        Euclidean L2 vector distance of <span className="text-red-400 font-bold">0.00</span> confirms
        exact feature congruence with official broadcast frames. Perceptual hash hamming distance of{" "}
        <span className="text-teal-400 font-bold">0</span> corroborates frame alignment. High
        confidence candidate copyright infringement confirmed.
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="px-3 py-1 bg-red-500/15 border border-red-500/25 rounded-full text-[10px] font-bold text-red-400 uppercase tracking-wider">
          → Staged for Takedown
        </span>
        <span className="px-3 py-1 bg-slate-700/50 border border-slate-600/40 rounded-full text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Confidence: 100%
        </span>
      </div>
    </motion.div>
  </CometCard>
);

// ─── Metric Bars ─────────────────────────────────────────────────────────────
const METRICS = [
  { label: "MobileNetV3 Vector Similarity", value: 94, color: "#0d9488" },
  { label: "pHash Geometric Alignment", value: 91, color: "#0284c7" },
  { label: "Temporal Overlap Window", value: 88, color: "#8b5cf6" },
  { label: "Heuristic Match Confidence", value: 92, color: "#10b981" },
];

export const MetricBars = () => (
  <TiltCard>
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: 0.1 }}
      className="bg-white border border-slate-200/70 rounded-3xl p-7 h-full"
      style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.05)" }}
    >
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.28em] mb-5">
        Sentinel Confidence Profile
      </p>
      <div className="space-y-4">
        {METRICS.map((m, i) => (
          <div key={m.label}>
            <div className="flex justify-between mb-1.5">
              <span className="text-[12px] font-bold text-slate-700">{m.label}</span>
              <span className="text-[12px] font-black" style={{ color: m.color }}>
                {m.value}%
              </span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: `${m.value}%` }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 + 0.3, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                className="h-full rounded-full"
                style={{ backgroundColor: m.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  </TiltCard>
);

// ─── Verdict Duel ────────────────────────────────────────────────────────────
export const VerdictDuel = () => (
  <TiltCard>
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: 0.15 }}
      className="bg-white border border-slate-200/70 rounded-3xl p-7 h-full"
      style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.05)" }}
    >
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.28em] mb-5">
        Adjudicator Routing Decision
      </p>
      <div className="flex items-center gap-4">
        <div className="flex-1 bg-red-50 border border-red-200/60 rounded-2xl p-4 text-center">
          <Gavel className="w-6 h-6 text-red-500 mx-auto mb-2" />
          <p className="text-[11px] font-black text-red-600 uppercase tracking-wide">Enforcer</p>
          <p className="text-2xl font-black text-red-500 mt-1">5</p>
          <p className="text-[10px] text-red-400 font-medium">DMCA Notices</p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            VS
          </span>
          <div className="w-px h-8 bg-slate-200" />
        </div>
        <div className="flex-1 bg-emerald-50 border border-emerald-200/60 rounded-2xl p-4 text-center">
          <Coins className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
          <p className="text-[11px] font-black text-emerald-600 uppercase tracking-wide">Broker</p>
          <p className="text-2xl font-black text-emerald-500 mt-1">3</p>
          <p className="text-[10px] text-emerald-400 font-medium">Rev-Share Deals</p>
        </div>
      </div>
      <div className="mt-4 h-2 bg-slate-100 rounded-full overflow-hidden flex">
        <div className="bg-red-400 h-full rounded-l-full" style={{ width: "62.5%" }} />
        <div className="bg-emerald-400 h-full rounded-r-full" style={{ width: "37.5%" }} />
      </div>
      <div className="flex justify-between mt-1.5">
        <span className="text-[10px] text-red-400 font-bold">62.5% Piracy</span>
        <span className="text-[10px] text-emerald-400 font-bold">37.5% Fair Use</span>
      </div>
    </motion.div>
  </TiltCard>
);

// ─── Stat Tiles ──────────────────────────────────────────────────────────────
const STAT_TILES = [
  { value: "576-D", label: "Vector Dimension", sub: "PyTorch MobileNetV3 normalized", color: "#0d9488" },
  { value: "Sub-Sec", label: "Search Latency", sub: "FAISS vector distance search", color: "#6366f1" },
  { value: "Max 3", label: "Stream Hunter Queue", sub: "Sequential isolated screening", color: "#f87171" },
  { value: "Dual", label: "Verification Layers", sub: "MobileNetV3 L2 + pHash", color: "#34d399" },
  { value: "Ed25519", label: "Evidence Packaging", sub: "SHA-256 + digital signatures", color: "#818cf8" },
  { value: "Zero", label: "Suspect Contamination", sub: "Isolated reference registry", color: "#fbbf24" },
];

export const StatTile = ({
  value,
  label,
  sub,
  color,
  delay = 0,
}: {
  value: string;
  label: string;
  sub: string;
  color: string;
  delay?: number;
}) => (
  <TiltCard>
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="bg-white border border-slate-200/70 rounded-2xl p-6 h-full"
      style={{ boxShadow: "0 2px 16px rgba(0,0,0,0.04)" }}
    >
      <div className="w-6 h-[2px] rounded-full mb-3" style={{ backgroundColor: color }} />
      <p className="text-[2.2rem] font-black leading-none mb-1" style={{ color }}>
        {value}
      </p>
      <p className="text-[12px] font-black text-slate-800 mb-1">{label}</p>
      <p className="text-[11px] text-slate-400 font-medium leading-snug">{sub}</p>
    </motion.div>
  </TiltCard>
);

// ─── Showcase Section ────────────────────────────────────────────────────────
export const ShowcaseSection = () => (
  <section id="stack" className="bg-[#f6f7fc]">
    <Marquee />
    <div className="py-28 px-8">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <p className="text-[10px] font-bold text-teal-600 uppercase tracking-[0.28em] mb-4">
            System in Action
          </p>
          <h2 className="text-5xl md:text-6xl font-black text-slate-900 tracking-tight mb-5">
            Watch the Swarm
            <br />
            <span className="text-teal-600">Think in Real-Time.</span>
          </h2>
          <p className="text-[17px] text-slate-500 max-w-lg mx-auto leading-relaxed">
            Every detection, verdict, and action streams live to the dashboard. The agents reason,
            route, and verify — you just approve.
          </p>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          {STAT_TILES.map((t, i) => (
            <StatTile key={t.label} {...t} delay={i * 0.07} />
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <LiveThreatCard />
          <AICoachBubble />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <MetricBars />
          <VerdictDuel />
        </div>
      </div>
    </div>
  </section>
);

// ─── Deploy Card ─────────────────────────────────────────────────────────────
export const DeployCard = ({ onLaunch }: { onLaunch: () => void }) => (
  <CometCard
    className="bg-[#0d1117] rounded-3xl overflow-hidden border border-slate-800/60 max-w-2xl mx-auto mb-14"
    style={{ boxShadow: "0 24px 80px rgba(0,0,0,0.22)" }}
  >
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-teal-400 animate-pulse" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Swarm Mission Complete
          </span>
        </div>
        <span className="text-[9px] font-bold text-teal-400 bg-teal-400/10 px-2.5 py-1 rounded-full border border-teal-400/20">
          Awaiting Approval
        </span>
      </div>

      <div className="px-6 py-5 font-mono text-xs space-y-2.5">
        {[
          ["suspects_scanned", "18 keyframes", "#e2e8f0"],
          ["candidate_matches", "3 confirmed", "#f87171"],
          ["lowest_l2_dist", "0.0000 (100% Conf)", "#fbbf24"],
          ["phash_evidence", "Hamming: 0 (Exact)", "#34d399"],
          ["polygon_tx", "0x4a7f...c3e2 (Mock)", "#818cf8"],
          ["integrity_hash", "sha256:9b2d...f1a8", "#2dd4bf"],
        ].map(([k, v, c]) => (
          <div key={k} className="flex justify-between items-center">
            <span className="text-slate-500">{k}</span>
            <span style={{ color: c }} className="font-bold font-mono">
              {v}
            </span>
          </div>
        ))}
      </div>

      <div className="px-6 pb-4 flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-violet-500/10 border border-violet-500/20 rounded-full">
          <svg
            viewBox="0 0 38 33"
            className="w-4 h-4 fill-violet-400"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M29 10.2L19 4.6 9 10.2v11.2l10 5.6 10-5.6V10.2zM19 0L38 11v11L19 33 0 22V11L19 0z" />
          </svg>
          <span className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">
            Polygon Network
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-500/10 border border-teal-500/20 rounded-full">
          <CheckCircle className="w-3.5 h-3.5 text-teal-400" />
          <span className="text-[10px] font-bold text-teal-400 uppercase tracking-wider">
            SHA-256 Verified
          </span>
        </div>
      </div>

      <div className="px-6 pb-6 grid grid-cols-2 gap-3">
        <button
          onClick={onLaunch}
          className="px-4 py-3 rounded-xl bg-teal-500/15 border border-teal-500/30 text-center hover:bg-teal-500/25 transition-colors cursor-pointer"
        >
          <p className="text-[10px] font-black text-teal-300 uppercase tracking-wider mb-0.5 flex items-center justify-center gap-1.5">
            <Shield className="w-3 h-3" /> Approve &amp; Send
          </p>
          <p className="text-[9px] text-slate-500">DMCA dispatched to platform legal</p>
        </button>
        <button
          onClick={onLaunch}
          className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center hover:bg-emerald-500/20 transition-colors cursor-pointer"
        >
          <p className="text-[10px] font-black text-emerald-300 uppercase tracking-wider mb-0.5 flex items-center justify-center gap-1.5">
            <Coins className="w-3 h-3" /> Activate Contract
          </p>
          <p className="text-[9px] text-slate-500">Rev-share goes live on Polygon</p>
        </button>
      </div>
    </motion.div>
  </CometCard>
);

// ─── CTA Section ─────────────────────────────────────────────────────────────
export const CTA = ({ onLaunch }: { onLaunch: () => void }) => (
  <section className="py-28 px-8 bg-white">
    <div className="max-w-4xl mx-auto">
      <DeployCard onLaunch={onLaunch} />

      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        className="relative rounded-[2.5rem] p-14 md:p-20 text-center overflow-hidden"
        style={{
          background: "linear-gradient(140deg, #daf2ed 0%, #edf0f8 60%, #e2e8f6 100%)",
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, #9abfb8 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            opacity: 0.22,
          }}
        />
        <RippleGrid rows={6} cols={20} cellSize={52} />
        <div
          className="absolute bottom-0 right-4 text-[180px] font-black leading-none select-none pointer-events-none"
          style={{ color: "rgba(148,163,184,0.10)" }}
        >
          AI
        </div>

        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-500/10 border border-teal-500/20 mb-7">
            <Zap className="w-3.5 h-3.5 text-teal-600 fill-teal-600" />
            <span className="text-[10px] font-bold text-teal-700 uppercase tracking-[0.24em]">
              Ready to Deploy
            </span>
          </div>
          <h2 className="text-5xl md:text-6xl font-black text-slate-900 tracking-tight mb-5">
            Deploy the Swarm.
            <br />
            <span className="text-teal-600">Protect Your IP.</span>
          </h2>
          <p className="text-[17px] text-slate-500 max-w-lg mx-auto mb-10 leading-relaxed">
            Ingest official video. Six agents execute the full pipeline — detect, classify, enforce,
            and monetize — while you watch the results stream live on the command center dashboard.
          </p>

          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            onClick={onLaunch}
            className="group px-10 py-4 bg-slate-900 hover:bg-teal-700 text-white font-bold text-sm rounded-full transition-all duration-200 shadow-xl shadow-slate-900/20 flex items-center gap-3 mx-auto cursor-pointer"
          >
            <Shield className="w-5 h-5" />
            Initialize Command Center
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </motion.button>
          <p className="mt-7 text-[10px] text-slate-400 font-bold uppercase tracking-[0.28em]">
            MediaGuard AI Video Protection Protocol · FixProof 2026
          </p>
        </div>
      </motion.div>
    </div>
  </section>
);

// ─── Root Landing Page ───────────────────────────────────────────────────────
export const LandingPage = ({ onLaunch }: { onLaunch: () => void }) => {
  const [isJudgeWelcomeOpen, setIsJudgeWelcomeOpen] = useState(false);

  useEffect(() => {
    // Check sessionStorage for first-time judge visit (SSR safe)
    if (typeof window !== "undefined") {
      const seen = sessionStorage.getItem("fixproof_judge_welcome_seen");
      if (!seen) {
        setIsJudgeWelcomeOpen(true);
      }
    }
  }, []);

  const handleCloseWelcome = () => {
    setIsJudgeWelcomeOpen(false);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("fixproof_judge_welcome_seen", "true");
    }
  };

  const handleLaunchFromWelcome = () => {
    handleCloseWelcome();
    onLaunch();
  };

  const handleReplayWelcome = () => {
    setIsJudgeWelcomeOpen(true);
  };

  return (
    <div className="bg-white min-h-screen overflow-x-hidden selection:bg-teal-500/20">
      <JudgeWelcomeOverlay
        isOpen={isJudgeWelcomeOpen}
        onClose={handleCloseWelcome}
        onLaunchConsole={handleLaunchFromWelcome}
      />
      <LandingNavbar onLaunch={onLaunch} onReplayIntro={handleReplayWelcome} />
      <Hero onLaunch={onLaunch} onReplayIntro={handleReplayWelcome} />
      <GridBeamCapabilities />
      <AgentScrollStory />
      <ShowcaseSection />
      <CTA onLaunch={onLaunch} />
      <footer className="py-8 px-8 border-t border-slate-100 bg-[#f6f7fc]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Shield className="w-4 h-4 text-teal-600" />
            <span className="text-sm font-black text-slate-900">
              FixProof<span className="text-teal-600">Sports</span>
            </span>
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.28em]">
            © 2026 · Autonomous IP Intelligence · Global Protection Protocol
          </p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
