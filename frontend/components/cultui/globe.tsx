"use client";

import * as React from "react";
import createGlobe from "cobe";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface CultGlobeProps {
  className?: string;
  globeSize?: number;
  orbitPhrase?: string;
  hideOrbitPhrase?: boolean;
}

// Illustrative verified broadcast network hubs (not fake threat tracking)
const BROADCAST_HUBS = [
  { id: "hub-lon", location: [51.5074, -0.1278] as [number, number], label: "London Hub", size: 0.045 },
  { id: "hub-nyc", location: [40.7128, -74.006] as [number, number], label: "New York Hub", size: 0.045 },
  { id: "hub-tok", location: [35.6762, 139.6503] as [number, number], label: "Tokyo Hub", size: 0.045 },
  { id: "hub-par", location: [48.8566, 2.3522] as [number, number], label: "Paris Hub", size: 0.04 },
  { id: "hub-syd", location: [-33.8688, 151.2093] as [number, number], label: "Sydney Hub", size: 0.04 },
  { id: "hub-dxb", location: [25.2048, 55.2708] as [number, number], label: "Dubai Hub", size: 0.04 },
  { id: "hub-sin", location: [1.3521, 103.8198] as [number, number], label: "Singapore Hub", size: 0.04 },
];

const ILLUSTRATIVE_ARCS = [
  { from: [40.7128, -74.006] as [number, number], to: [51.5074, -0.1278] as [number, number] }, // NYC -> London
  { from: [51.5074, -0.1278] as [number, number], to: [35.6762, 139.6503] as [number, number] }, // London -> Tokyo
  { from: [35.6762, 139.6503] as [number, number], to: [1.3521, 103.8198] as [number, number] }, // Tokyo -> Singapore
  { from: [48.8566, 2.3522] as [number, number], to: [25.2048, 55.2708] as [number, number] }, // Paris -> Dubai
];

export function CultGlobe({
  className,
  globeSize = 520,
  orbitPhrase = "AUTONOMOUS SPORTS MEDIA RIGHTS PROTECTION PROTOCOL · ",
  hideOrbitPhrase = false,
}: CultGlobeProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const isInView = useInView(rootRef, { once: false, margin: "120px" });
  const shouldReduceMotion = useReducedMotion();
  const [hasWebGlError, setHasWebGlError] = React.useState(false);

  const phiAutoRef = React.useRef(0);
  const pointerInteracting = React.useRef<{ x: number; y: number } | null>(null);
  const lastPointer = React.useRef<{ x: number; y: number; t: number } | null>(null);
  const dragOffset = React.useRef({ phi: 0, theta: 0 });
  const velocity = React.useRef({ phi: 0, theta: 0 });
  const phiOffsetRef = React.useRef(0);
  const thetaOffsetRef = React.useRef(0);
  const isPausedRef = React.useRef(false);

  const bufferSize = globeSize * 2;
  const reactId = React.useId();
  const orbitPathId = `orbit-${reactId.replace(/:/g, "")}`;

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      pointerInteracting.current = { x: e.clientX, y: e.clientY };
      if (canvasRef.current) {
        canvasRef.current.style.cursor = "grabbing";
      }
      isPausedRef.current = true;
    },
    []
  );

  const handlePointerMove = React.useCallback((e: PointerEvent) => {
    if (pointerInteracting.current === null) return;
    const deltaX = e.clientX - pointerInteracting.current.x;
    const deltaY = e.clientY - pointerInteracting.current.y;
    dragOffset.current = { phi: deltaX / 300, theta: deltaY / 1000 };

    const now = Date.now();
    if (lastPointer.current) {
      const dt = Math.max(now - lastPointer.current.t, 1);
      const maxVelocity = 0.12;
      velocity.current = {
        phi: Math.max(-maxVelocity, Math.min(maxVelocity, ((e.clientX - lastPointer.current.x) / dt) * 0.25)),
        theta: Math.max(-maxVelocity, Math.min(maxVelocity, ((e.clientY - lastPointer.current.y) / dt) * 0.08)),
      };
    }
    lastPointer.current = { x: e.clientX, y: e.clientY, t: now };
  }, []);

  const handlePointerUp = React.useCallback(() => {
    if (pointerInteracting.current !== null) {
      phiOffsetRef.current += dragOffset.current.phi;
      thetaOffsetRef.current += dragOffset.current.theta;
      dragOffset.current = { phi: 0, theta: 0 };
      lastPointer.current = null;
    }
    pointerInteracting.current = null;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = "grab";
    }
    isPausedRef.current = false;
  }, []);

  React.useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  React.useEffect(() => {
    if (!canvasRef.current || !isInView) return;

    const canvas = canvasRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let globeInstance: any = null;

    try {
      globeInstance = createGlobe(canvas, {
        devicePixelRatio: dpr,
        width: bufferSize * dpr,
        height: bufferSize * dpr,
        phi: phiAutoRef.current + phiOffsetRef.current,
        theta: 0.24 + thetaOffsetRef.current,
        dark: 1,
        diffuse: 1.6,
        mapSamples: 18000,
        mapBrightness: 5.5,
        mapBaseBrightness: 0.05,
        baseColor: [0.03, 0.12, 0.12], // Deep teal charcoal
        markerColor: [0.08, 0.85, 0.75], // FixProof vibrant teal
        glowColor: [0.04, 0.35, 0.32], // Restrained atmospheric glow
        scale: 1.05,
        offset: [0, 0],
        opacity: 0.9,
        markers: BROADCAST_HUBS,
        arcs: ILLUSTRATIVE_ARCS,
        arcColor: [0.15, 0.75, 0.7],
        arcWidth: 0.6,
        arcHeight: 0.26,
        markerElevation: 0.015,
      });
    } catch {
      setHasWebGlError(true);
      return;
    }

    let rafId = 0;
    const tick = () => {
      if (!isPausedRef.current) {
        if (!shouldReduceMotion) {
          phiAutoRef.current += 0.0028;
        }
        if (
          Math.abs(velocity.current.phi) > 0.0001 ||
          Math.abs(velocity.current.theta) > 0.0001
        ) {
          phiOffsetRef.current += velocity.current.phi;
          thetaOffsetRef.current += velocity.current.theta;
          velocity.current.phi *= 0.94;
          velocity.current.theta *= 0.94;
        }
      }

      const totalPhi = phiAutoRef.current + phiOffsetRef.current + dragOffset.current.phi;
      const totalTheta = Math.max(
        -0.4,
        Math.min(0.6, 0.24 + thetaOffsetRef.current + dragOffset.current.theta)
      );

      globeInstance?.update({ phi: totalPhi, theta: totalTheta });
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      globeInstance?.destroy();
    };
  }, [isInView, bufferSize, shouldReduceMotion]);

  return (
    <div
      ref={rootRef}
      className={cn("relative flex items-center justify-center select-none", className)}
      style={{ width: globeSize, height: globeSize }}
    >
      {/* Fallback if WebGL fails */}
      {hasWebGlError ? (
        <div
          className="rounded-full flex items-center justify-center border border-teal-500/20 bg-[#0d1616]"
          style={{ width: globeSize * 0.85, height: globeSize * 0.85 }}
        >
          <div className="text-center p-6 text-teal-400 text-xs font-mono">
            Interactive Global Media Protection Metaphor
          </div>
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          style={{
            width: globeSize,
            height: globeSize,
            cursor: "grab",
            touchAction: "none",
          }}
          className="relative z-10 transition-opacity duration-500"
        />
      )}

      {/* Orbit Ring with Illustrative Protocol Phrase */}
      {!hideOrbitPhrase && !hasWebGlError && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
        >
          <svg
            className="w-full h-full animate-[spin_55s_linear_infinite]"
            viewBox="0 0 520 520"
          >
            <path
              id={orbitPathId}
              d="M 260, 260 m -215, 0 a 215,215 0 1,1 430,0 a 215,215 0 1,1 -430,0"
              fill="none"
              stroke="rgba(20, 184, 166, 0.12)"
              strokeWidth="1"
              strokeDasharray="4 6"
            />
            <text className="text-[9.5px] font-mono tracking-[0.28em] fill-teal-400/60 uppercase">
              <textPath href={`#${orbitPathId}`} startOffset="0%">
                {orbitPhrase}
                {orbitPhrase}
              </textPath>
            </text>
          </svg>
        </div>
      )}

      {/* Soft atmospheric depth illumination */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full z-0 opacity-40 blur-2xl"
        style={{
          background: "radial-gradient(circle at 50% 50%, rgba(20, 184, 166, 0.22) 0%, transparent 68%)",
        }}
      />
    </div>
  );
}

export default CultGlobe;

