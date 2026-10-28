"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

// Lazy-load shaders with SSR disabled to prevent hydration mismatch and unnecessary canvas creation
const DynamicStaticRadialGradient = dynamic(
  () =>
    import("@paper-design/shaders-react").then((m) => m.StaticRadialGradient),
  { ssr: false }
);

const DynamicLiquidMetal = dynamic(
  () =>
    import("@paper-design/shaders-react").then((m) => m.LiquidMetal),
  { ssr: false }
);

/**
 * Restrained Static Radial Gradient for the Adjudicator step.
 * Uses FixProof deep teal & cyan colors with a soft CSS fallback.
 */
export function RestrainedRadialGradient({
  active = false,
  className,
}: {
  active?: boolean;
  className?: string;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (active) setMounted(true);
  }, [active]);

  if (shouldReduceMotion || !active || !mounted) {
    return (
      <div
        className={cn(
          "absolute inset-0 pointer-events-none opacity-40 transition-opacity duration-700",
          className
        )}
        style={{
          background:
            "radial-gradient(circle at 60% 40%, rgba(20, 184, 166, 0.25) 0%, rgba(15, 118, 110, 0.12) 45%, transparent 70%)",
        }}
      />
    );
  }

  return (
    <div
      className={cn(
        "absolute inset-0 pointer-events-none opacity-45 overflow-hidden transition-opacity duration-700",
        className
      )}
    >
      <DynamicStaticRadialGradient
        width={640}
        height={480}
        colors={["#14b8a6", "#0d9488", "#0284c7"]}
        colorBack="#00000000"
        radius={0.92}
        focalDistance={0.1}
        focalAngle={0}
        falloff={0.88}
        mixing={0.65}
        distortion={0.08}
        distortionFreq={8}
        grainMixer={0.6}
        grainOverlay={0.3}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

/**
 * Restrained Liquid Metal for the Sentinel step.
 * Depicts continuous visual embedding resonance with a pure CSS fallback.
 */
export function RestrainedLiquidMetal({
  active = false,
  className,
}: {
  active?: boolean;
  className?: string;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (active) setMounted(true);
  }, [active]);

  if (shouldReduceMotion || !active || !mounted) {
    return (
      <div
        className={cn(
          "absolute inset-0 pointer-events-none opacity-35 transition-opacity duration-700",
          className
        )}
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(45, 212, 191, 0.22) 0%, rgba(13, 148, 136, 0.1) 50%, transparent 75%)",
        }}
      />
    );
  }

  return (
    <div
      className={cn(
        "absolute inset-0 pointer-events-none opacity-40 overflow-hidden transition-opacity duration-700",
        className
      )}
    >
      <DynamicLiquidMetal
        width={640}
        height={480}
        colorTint="#14b8a6"
        colorBack="#00000000"
        softness={0.75}
        distortion={0.3}
        contour={0.35}
        speed={0.4}
        scale={0.7}
        repetition={5}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

