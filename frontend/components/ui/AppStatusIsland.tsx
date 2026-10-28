"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Activity, Wifi, WifiOff } from "lucide-react";
import { StatusIsland } from "@/components/kokonutui/status-island";
import { useActivity } from "@/context/ActivityContext";

export function AppStatusIsland() {
  const { tasks, backendHealth, dismissTask } = useActivity();
  const [showIdleDetail, setShowIdleDetail] = useState(false);

  const hasActiveTasks = tasks.length > 0;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none select-none">
      <div className="pointer-events-auto">
        <AnimatePresence mode="wait">
          {hasActiveTasks ? (
            <motion.div
              key="active-island"
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.95 }}
              transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            >
              <StatusIsland
                tasks={tasks}
                onDismiss={dismissTask}
                dismissAfter={4500}
                className="shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
              />
            </motion.div>
          ) : (
            /* Idle Readiness Pill */
            <motion.div
              key="idle-pill"
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }}
              transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
              onMouseEnter={() => setShowIdleDetail(true)}
              onMouseLeave={() => setShowIdleDetail(false)}
              onClick={() => setShowIdleDetail((prev) => !prev)}
              className="group flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#171615]/95 border border-[rgba(238,231,219,0.12)] shadow-[0_8px_24px_rgba(0,0,0,0.55),0_0_20px_-8px_rgba(20,184,166,0.2)] backdrop-blur-md cursor-pointer transition-all hover:border-teal-500/30"
              title="Click to view Sentinel system status"
            >
              {/* Indicator Dot */}
              <div className="flex items-center justify-center">
                {backendHealth === "healthy" ? (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-60"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-400"></span>
                  </span>
                ) : backendHealth === "offline" ? (
                  <span className="relative flex h-2 w-2">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400"></span>
                  </span>
                ) : (
                  <span className="relative flex h-2 w-2">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-zinc-500 animate-pulse"></span>
                  </span>
                )}
              </div>

              {/* Status Text */}
              <span className="text-[11px] font-mono font-medium text-[#ded7cb] group-hover:text-white transition-colors">
                {backendHealth === "healthy"
                  ? "FixProof Ready"
                  : backendHealth === "offline"
                  ? "Backend Offline"
                  : "Checking Status"}
              </span>

              {/* Expanded detail on hover/click */}
              <AnimatePresence>
                {showIdleDetail && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                    className="overflow-hidden whitespace-nowrap text-[10.5px] font-mono text-teal-400 pl-1 border-l border-[rgba(238,231,219,0.1)]"
                  >
                    Sentinel Core Active · FAISS Ready
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
export default AppStatusIsland;
