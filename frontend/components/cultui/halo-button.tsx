"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

const LABEL_STAGGER_SEC = 0.016;
const LABEL_CHAR_DURATION_SEC = 0.14;
const DEFAULT_LOADING_STAGGER_SEC = 0.032;
const DEFAULT_LOADING_CHAR_DURATION_SEC = 0.3;
const TRAILING_EXIT_DURATION_SEC = 0.2;

const layoutSpring = {
  type: "spring" as const,
  bounce: 0.12,
  damping: 34,
  stiffness: 420,
};

const trailingExitTransition = (reduceMotion: boolean) => ({
  duration: reduceMotion ? 0 : TRAILING_EXIT_DURATION_SEC,
  ease: "easeOut" as const,
});

const trailingCrossfade = (reduceMotion: boolean) => ({
  exit: {
    opacity: reduceMotion ? 1 : 0,
    scale: reduceMotion ? 1 : 0.88,
  },
  initial: {
    opacity: reduceMotion ? 1 : 0,
    scale: reduceMotion ? 1 : 0.88,
  },
});

function ButtonSpinner({
  className,
  reduceMotion,
}: {
  className?: string;
  reduceMotion: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex origin-center text-current opacity-70",
        !reduceMotion && "animate-spin",
        className
      )}
    >
      <svg
        aria-hidden="true"
        className="h-3.5 w-3.5"
        focusable="false"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          fill="none"
          r="9"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <circle
          cx="12"
          cy="12"
          fill="none"
          r="9"
          stroke="currentColor"
          strokeDasharray="14 42"
          strokeLinecap="round"
          strokeWidth="2.5"
        />
      </svg>
    </span>
  );
}

function StaggeredTextLabel({
  text,
  reduceMotion,
  staggerSec = LABEL_STAGGER_SEC,
  charDurationSec = LABEL_CHAR_DURATION_SEC,
  className,
}: {
  text: string;
  reduceMotion: boolean;
  staggerSec?: number;
  charDurationSec?: number;
  className?: string;
}) {
  const chars = useMemo(() => {
    const counts = new Map<string, number>();
    return Array.from(text, (char) => {
      const count = counts.get(char) ?? 0;
      counts.set(char, count + 1);
      return { char, key: `${char}-${count}` };
    });
  }, [text]);

  return (
    <motion.span
      animate="visible"
      className={cn("inline-flex items-center font-bold text-sm tracking-tight antialiased", className)}
      initial="hidden"
      key={text}
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: reduceMotion ? 0 : staggerSec,
          },
        },
      }}
    >
      {chars.map((glyph) => (
        <motion.span
          className="inline-block whitespace-pre"
          key={glyph.key}
          transition={{
            duration: reduceMotion ? 0 : charDurationSec,
            ease: "easeOut",
          }}
          variants={{
            hidden: { opacity: reduceMotion ? 1 : 0 },
            visible: { opacity: 1 },
          }}
        >
          {glyph.char}
        </motion.span>
      ))}
    </motion.span>
  );
}

function TrailingLoadingSlot({
  reduceMotion,
  reveal,
}: {
  reduceMotion: boolean;
  reveal: boolean;
}) {
  const cross = trailingCrossfade(reduceMotion);
  return (
    <motion.div
      animate={
        reveal
          ? { opacity: 1, scale: 1 }
          : { opacity: 0, scale: reduceMotion ? 1 : 0.88 }
      }
      aria-hidden
      className={cn(
        "absolute inset-0 flex items-center justify-center rounded-full pointer-events-none"
      )}
      exit={{ ...cross.exit, transition: trailingExitTransition(reduceMotion) }}
      initial={cross.initial}
      key="trailing-loading"
      transition={
        reduceMotion
          ? { duration: 0 }
          : reveal
          ? { ...layoutSpring }
          : { duration: 0 }
      }
    >
      <ButtonSpinner reduceMotion={reduceMotion} />
    </motion.div>
  );
}

export interface HaloButtonProps extends ComponentProps<"button"> {
  children: ReactNode;
  /** Primary = subtle dark #171918; secondary = cream #FFFEFA; accent = cream-teal; dark = deep near-black */
  variant?: "primary" | "secondary" | "accent" | "dark";
  size?: "sm" | "md" | "lg";
  translucent?: boolean;
  isLoading?: boolean;
  loadingText?: string;
  loadingStaggerSec?: number;
  loadingCharDurationSec?: number;
  staggerLabel?: boolean;
}

export function HaloButton({
  children,
  variant = "primary",
  size = "md",
  translucent = false,
  isLoading = false,
  loadingText = "Working…",
  loadingStaggerSec = DEFAULT_LOADING_STAGGER_SEC,
  loadingCharDurationSec = DEFAULT_LOADING_CHAR_DURATION_SEC,
  staggerLabel = false,
  disabled,
  className,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  style,
  ...props
}: HaloButtonProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [trailingRevealReady, setTrailingRevealReady] = useState(false);
  const reduceMotion = useReducedMotion() ?? false;
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;

  useEffect(() => {
    if (!isLoading) {
      setTrailingRevealReady(false);
      return;
    }
    if (reduceMotion) {
      setTrailingRevealReady(true);
    }
  }, [isLoading, reduceMotion]);

  useEffect(() => {
    if (!isLoading || reduceMotion) return;
    const id = window.setTimeout(() => setTrailingRevealReady(true), 400);
    return () => window.clearTimeout(id);
  }, [isLoading, reduceMotion]);

  const hoverAllowed = !(disabled || isLoading);
  const rimEmphasis = isFocused || (isHovered && hoverAllowed);

  // Customized Restrained Halo Rims to match FixProof Warm Cream + Teal Brand
  const borderGlow = useMemo(() => {
    if (variant === "primary" || variant === "dark") {
      return {
        opacityIdle: rimEmphasis ? 0.95 : 0.65,
        primaryBg: "linear-gradient(90deg, #009E91, #14b8a6, #c2a677, #009E91)",
        secondaryBg: "linear-gradient(90deg, #14b8a6, #2dd4bf, #009E91)",
        tertiaryBg: "linear-gradient(90deg, #c2a677, #009E91, #14b8a6)",
        primaryLeft: ["-10%", "85%", "-10%"],
        secondaryLeft: ["70%", "10%", "70%"],
        tertiaryLeft: ["20%", "60%", "20%"],
        durationMain: 5.5,
        durationSec: 4.5,
        durationTer: 3.5,
      };
    }

    if (variant === "accent") {
      return {
        opacityIdle: rimEmphasis ? 0.85 : 0.5,
        primaryBg: "linear-gradient(90deg, #009E91, #2dd4bf, #0d9488)",
        secondaryBg: "linear-gradient(90deg, #0d9488, #5eead4, #009E91)",
        tertiaryBg: "linear-gradient(90deg, #009E91, #14b8a6, #0d9488)",
        primaryLeft: ["0%", "80%", "0%"],
        secondaryLeft: ["75%", "15%", "75%"],
        tertiaryLeft: ["15%", "65%", "15%"],
        durationMain: 6,
        durationSec: 5,
        durationTer: 4,
      };
    }

    // Secondary (Cream surface)
    return {
      opacityIdle: rimEmphasis ? 0.75 : 0.4,
      primaryBg: "linear-gradient(90deg, #DCD5C9, #009E91, #C4BCAD, #DCD5C9)",
      secondaryBg: "linear-gradient(90deg, #C4BCAD, #EDE7DC, #009E91)",
      tertiaryBg: "linear-gradient(90deg, #DCD5C9, #009E91, #C4BCAD)",
      primaryLeft: ["-5%", "75%", "-5%"],
      secondaryLeft: ["65%", "10%", "65%"],
      tertiaryLeft: ["25%", "55%", "25%"],
      durationMain: 6,
      durationSec: 5,
      durationTer: 4,
    };
  }, [variant, rimEmphasis]);

  const labelIsString = typeof children === "string";
  const showTrailing = isLoading;

  const labelContent = (() => {
    if (isLoading) {
      if (staggerLabel) {
        return (
          <StaggeredTextLabel
            charDurationSec={loadingCharDurationSec}
            reduceMotion={reduceMotion}
            staggerSec={loadingStaggerSec}
            text={loadingText}
          />
        );
      }
      return <span className="font-bold text-sm tracking-tight">{loadingText}</span>;
    }
    if (labelIsString && staggerLabel) {
      return <StaggeredTextLabel reduceMotion={reduceMotion} text={children} />;
    }
    return <span className="inline-flex items-center gap-2 font-bold text-sm tracking-tight">{children}</span>;
  })();

  // Size styling
  const sizeClasses = {
    sm: "min-h-9 px-4 py-1.5 text-xs",
    md: "min-h-11 px-6 py-2.5 text-sm",
    lg: "min-h-12 px-7 py-3.5 text-sm",
  }[size];

  // Variant surface styling
  const variantClasses = {
    primary:
      "bg-[#171918] text-[#FFFEFA] border-[#2a2c2a] shadow-[0_2px_12px_rgba(23,25,24,0.18)] hover:bg-[#222524] hover:border-teal-500/40 hover:shadow-[0_4px_20px_rgba(0,158,145,0.2)]",
    dark:
      "bg-[#171918] text-[#FFFEFA] border-[#2e302e] shadow-[0_2px_12px_rgba(0,0,0,0.25)] hover:bg-[#252826] hover:border-teal-400/50",
    secondary:
      "bg-[#FFFEFA] text-[#171717] border-[#DCD5C9] shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:bg-[#F5F1E8] hover:border-[#b8b0a1] hover:text-[#171717]",
    accent:
      "bg-[#009E91]/10 text-[#009E91] border-[#009E91]/30 shadow-[0_2px_8px_rgba(0,158,145,0.08)] hover:bg-[#009E91]/20 hover:border-[#009E91]/50 hover:text-[#007b71]",
  }[variant];

  return (
    <motion.div
      className={cn("relative inline-flex max-w-full", className)}
      layout={!reduceMotion}
      transition={reduceMotion ? undefined : { layout: layoutSpring }}
    >
      <div className="relative rounded-full p-[1px]">
        {/* Animated Rim Glow Container */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
          <motion.div
            animate={{
              opacity: borderGlow.opacityIdle,
            }}
            className="absolute inset-x-0 bottom-0 h-1/2"
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <motion.div
              animate={{
                left: borderGlow.primaryLeft,
              }}
              className="-bottom-4 absolute h-14 w-44 blur-md"
              style={{
                background: borderGlow.primaryBg,
              }}
              transition={{
                duration: borderGlow.durationMain,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }}
            />
            <motion.div
              animate={{
                left: borderGlow.secondaryLeft,
              }}
              className="-bottom-3 absolute h-10 w-28 blur-md"
              style={{
                background: borderGlow.secondaryBg,
              }}
              transition={{
                duration: borderGlow.durationSec,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }}
            />
            <motion.div
              animate={{
                left: borderGlow.tertiaryLeft,
              }}
              className="-bottom-2 absolute h-8 w-20 blur-sm"
              style={{
                background: borderGlow.tertiaryBg,
              }}
              transition={{
                duration: borderGlow.durationTer,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }}
            />
          </motion.div>
        </div>

        {/* Standard Button Element */}
        <button
          aria-busy={isLoading || undefined}
          className={cn(
            "relative flex min-w-0 select-none items-center justify-center gap-2 rounded-full border cursor-pointer font-bold tracking-tight",
            "outline-none focus-visible:ring-2 focus-visible:ring-[#009E91]/40 focus-visible:ring-offset-2",
            "transition-all duration-200 ease-out",
            "enabled:active:scale-[0.97] motion-reduce:enabled:active:scale-100",
            "disabled:pointer-events-none disabled:opacity-50",
            sizeClasses,
            variantClasses,
            translucent && "backdrop-blur-md"
          )}
          disabled={disabled || isLoading}
          onBlur={(e) => {
            setIsFocused(false);
            onBlur?.(e);
          }}
          onFocus={(e) => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onMouseEnter={(e) => {
            setIsHovered(true);
            onMouseEnter?.(e);
          }}
          onMouseLeave={(e) => {
            setIsHovered(false);
            onMouseLeave?.(e);
          }}
          style={style}
          {...props}
        >
          <span className="flex min-w-0 flex-1 items-center justify-center gap-2">
            {labelContent}
          </span>

          {showTrailing ? (
            <div className="relative size-5 shrink-0 ml-1">
              <AnimatePresence initial={false} mode="popLayout">
                <TrailingLoadingSlot
                  reduceMotion={reduceMotion}
                  reveal={trailingRevealReady}
                />
              </AnimatePresence>
            </div>
          ) : null}
        </button>
      </div>
    </motion.div>
  );
}

export default HaloButton;
