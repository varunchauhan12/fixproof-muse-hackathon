"use client";

import React, { useEffect, useRef } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";

/**
 * Skiper61 Mouse Follow Animation
 *
 * Physics-based spring mouse tracking adapted from Skiper UI (skiper61).
 * Reference: https://skiper-ui.com/v1/skiper61
 *
 * Attribution License: Free component from Skiper UI.
 *
 * Forensic Design Principles:
 * - Subtle and non-distracting: uses low-opacity radial aura and hairline crosshair.
 * - Localized: clamps tracking to the provided container ref (or parent container).
 * - Non-blocking: pointer-events: none, does not interfere with clicks, drag-and-drop,
 *   text selection, or video controls.
 * - Accessibility: respects prefers-reduced-motion and automatically disables on touch devices.
 * - Preserves native OS cursor: does not hide or modify standard cursor.
 * - Zero React re-renders: updates motion values directly on DOM without setState.
 */

interface Skiper61MouseFollowProps {
  containerRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  size?: number;
}

export const Skiper61MouseFollow: React.FC<Skiper61MouseFollowProps> = ({
  containerRef,
  className = "",
  size = 180,
}) => {
  const prefersReduced = useReducedMotion();
  const radius = size / 2;

  // Raw coordinate motion values
  const mouseX = useMotionValue(-500);
  const mouseY = useMotionValue(-500);
  const opacity = useMotionValue(0);

  // Spring physics from Skiper61 (damped for forensic console subtlety)
  const springX = useSpring(mouseX, { stiffness: 140, damping: 20, mass: 0.6 });
  const springY = useSpring(mouseY, { stiffness: 140, damping: 20, mass: 0.6 });
  const springOpacity = useSpring(opacity, { stiffness: 200, damping: 25 });

  const isTouchRef = useRef(false);

  useEffect(() => {
    // Detect touch device once on mount
    isTouchRef.current =
      typeof window !== "undefined" &&
      ("ontouchstart" in window ||
        navigator.maxTouchPoints > 0 ||
        window.matchMedia("(pointer: coarse)").matches);

    if (prefersReduced || isTouchRef.current) {
      return;
    }

    const targetEl =
      containerRef?.current ||
      (typeof document !== "undefined" ? document.body : null);
    if (!targetEl) return;

    const handlePointerMove = (e: Event) => {
      const pe = e as PointerEvent;
      if (containerRef?.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (
          pe.clientX >= rect.left &&
          pe.clientX <= rect.right &&
          pe.clientY >= rect.top &&
          pe.clientY <= rect.bottom
        ) {
          opacity.set(1);
          mouseX.set(pe.clientX - rect.left);
          mouseY.set(pe.clientY - rect.top);
        } else {
          opacity.set(0);
        }
      } else {
        opacity.set(1);
        mouseX.set(pe.clientX);
        mouseY.set(pe.clientY);
      }
    };

    const handlePointerLeave = () => {
      opacity.set(0);
    };

    targetEl.addEventListener("pointermove", handlePointerMove);
    targetEl.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      targetEl.removeEventListener("pointermove", handlePointerMove);
      targetEl.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [containerRef, prefersReduced, mouseX, mouseY, opacity]);

  if (prefersReduced) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 1,
      }}
      className={`select-none ${className}`}
    >
      {/* 
        Spring-based follower from Skiper UI (skiper61)
        Styled as a forensic scanner reticle with subtle teal aura.
      */}
      <motion.div
        style={{
          position: "absolute",
          top: -radius,
          left: -radius,
          width: size,
          height: size,
          x: springX,
          y: springY,
          opacity: springOpacity,
          pointerEvents: "none",
        }}
      >
        {/* Soft radial glow aura */}
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(13, 148, 136, 0.12) 0%, rgba(45, 212, 191, 0.04) 40%, transparent 70%)",
          }}
        />

        {/* Subtle forensic reticle crosshair/ring */}
        <div
          style={{
            position: "absolute",
            inset: radius - 16,
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "1px solid rgba(45, 212, 191, 0.22)",
            boxShadow: "0 0 10px rgba(13, 148, 136, 0.15)",
          }}
        >
          {/* Center coordinate dot */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: "#2dd4bf",
              opacity: 0.7,
            }}
          />
        </div>
      </motion.div>
    </div>
  );
};

export default Skiper61MouseFollow;
