"use client";

import React from "react";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

/**
 * Base Shimmering Skeleton Loader
 */
export function Skeleton({ className = "", ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`relative overflow-hidden bg-[#22211E]/80 rounded ${className}`}
      {...props}
    >
      <div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-[rgba(241,235,221,0.08)] to-transparent animate-shimmer pointer-events-none"
        style={{ willChange: "transform" }}
      />
    </div>
  );
}

/**
 * Skeleton for KPI / Operational Metric Cards (Overview & AssetVault)
 */
export function MetricCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        background: "#1B1A18",
        border: "1px solid #302E29",
        borderRadius: 14,
      }}
      className={`p-4 sm:p-5 flex flex-col justify-between shadow-sm relative overflow-hidden ${className}`}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28 rounded-md bg-[#2A2824]" />
          <Skeleton className="h-8 w-20 rounded-lg bg-[#2A2824]" />
        </div>
        <Skeleton className="w-8 h-8 rounded-lg bg-[#2A2824] shrink-0" />
      </div>
      <div className="mt-4 pt-3 border-t border-[#302E29]/60">
        <Skeleton className="h-2.5 w-40 rounded bg-[#2A2824]" />
      </div>
    </div>
  );
}

/**
 * Skeleton for Subsystem Architecture Cards (Overview)
 */
export function SubsystemCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      style={{
        background: "#22211E",
        border: "1px solid #302E29",
        borderRadius: 12,
      }}
      className="p-3.5 flex flex-col justify-between"
    >
      <div>
        <div className="flex items-center justify-between mb-2">
          <Skeleton className="w-7 h-7 rounded-lg bg-[#2A2824]" />
          <Skeleton className="w-14 h-4 rounded-md bg-[#2A2824]" />
        </div>
        <Skeleton className="h-3.5 w-28 rounded bg-[#2A2824] mt-1" />
        <Skeleton className="h-2.5 w-20 rounded bg-[#2A2824] mt-1.5" />
      </div>
      <Skeleton className="h-2.5 w-full rounded bg-[#2A2824] mt-3" />
    </div>
  );
}

/**
 * Skeleton for Asset Vault Reference Cards (Grid/Stacks)
 */
export function AssetCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      style={{
        background: "#171615",
        border: "1px solid rgba(238, 231, 219, 0.08)",
        borderRadius: 14,
      }}
      className="p-4 flex flex-col gap-3"
    >
      {/* Thumbnail area */}
      <Skeleton className="w-full h-32 rounded-xl bg-[#22211E]" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-36 rounded bg-[#2A2824]" />
        <Skeleton className="h-4 w-16 rounded-md bg-[#2A2824]" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-20 rounded bg-[#2A2824]" />
        <Skeleton className="h-3 w-24 rounded bg-[#2A2824]" />
      </div>
    </div>
  );
}

/**
 * Skeleton for Incident and Reference Rows (Lists / Tables)
 */
export function TableRowSkeleton() {
  return (
    <div
      aria-hidden="true"
      style={{
        background: "#22211E",
        border: "1px solid #302E29",
        borderRadius: 12,
      }}
      className="flex items-center justify-between p-3"
    >
      <div className="flex items-center gap-3 w-3/4">
        <Skeleton className="w-14 h-9 rounded bg-[#2A2824] shrink-0" />
        <div className="space-y-1.5 flex-1 min-w-0">
          <Skeleton className="h-3.5 w-44 rounded bg-[#2A2824]" />
          <Skeleton className="h-2.5 w-28 rounded bg-[#2A2824]" />
        </div>
      </div>
      <Skeleton className="h-5 w-16 rounded-md bg-[#2A2824] shrink-0" />
    </div>
  );
}

/**
 * High-tech Forensic Skeleton for Frame Viewers (Incident Response & Video Inspection)
 */
export function FrameViewerSkeleton({
  label = "Forensic Frame",
  subtext = "Extracting verified keyframe from storage...",
  className = "",
}: {
  label?: string;
  subtext?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      style={{ background: "#141312", borderRadius: 12 }}
      className={`w-full h-full aspect-video relative overflow-hidden border border-[rgba(238,231,219,0.1)] flex flex-col items-center justify-center p-6 bg-black ${className}`}
    >
      {/* Shimmer overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[rgba(241,235,221,0.06)] to-transparent animate-shimmer pointer-events-none" />

      {/* Subtle alignment grid */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to right, #eee7db 1px, transparent 1px), linear-gradient(to bottom, #eee7db 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative z-10 flex flex-col items-center text-center space-y-3 max-w-xs">
        {/* Pulsing forensic scanner beacon */}
        <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-[#1e1d1b] border border-[rgba(238,231,219,0.12)]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#eee7db] opacity-75 animate-ping absolute" />
          <span className="w-2 h-2 rounded-full bg-[#eee7db] relative" />
        </div>

        <div className="space-y-1">
          <span className="text-[11px] font-bold tracking-wider uppercase text-[#f4efe6]">
            {label}
          </span>
          <p className="text-[10px] text-[#aba497] m-0 font-mono">
            {subtext}
          </p>
        </div>

        {/* Pulsing micro-track bar */}
        <div className="w-28 h-1 rounded-full bg-[#242220] overflow-hidden">
          <div className="w-1/2 h-full bg-[#eee7db]/50 rounded-full animate-pulse" />
        </div>
      </div>

      {/* Reticle corner markings */}
      <div className="absolute top-2 left-2 w-3 h-3 border-t border-l border-[rgba(238,231,219,0.25)]" />
      <div className="absolute top-2 right-2 w-3 h-3 border-t border-r border-[rgba(238,231,219,0.25)]" />
      <div className="absolute bottom-2 left-2 w-3 h-3 border-b border-l border-[rgba(238,231,219,0.25)]" />
      <div className="absolute bottom-2 right-2 w-3 h-3 border-b border-r border-[rgba(238,231,219,0.25)]" />
    </div>
  );
}
