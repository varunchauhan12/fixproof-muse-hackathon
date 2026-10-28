"use client";

import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Check, AlertCircle, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useActivity } from "@/context/ActivityContext";

export interface AnimatedDownloadButtonProps {
  label: string;
  preparingLabel?: string;
  successLabel?: string;
  onDownload: () => Promise<void>;
  icon?: LucideIcon;
  disabled?: boolean;
  className?: string;
  taskTitle?: string;
  variant?: "primary" | "secondary" | "subtle";
}

type ButtonState = "idle" | "preparing" | "success" | "error";

export function AnimatedDownloadButton({
  label,
  preparingLabel = "Preparing...",
  successLabel = "Downloaded",
  onDownload,
  icon: Icon = Download,
  disabled = false,
  className,
  taskTitle,
  variant = "secondary",
}: AnimatedDownloadButtonProps) {
  const [state, setState] = useState<ButtonState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const isBusy = state === "preparing";
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const { addTask, updateTask } = useActivity();

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (disabled || isBusy) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    setState("preparing");
    setErrorMessage("");

    const islandTaskId = addTask({
      label: taskTitle || label,
      detail: "Initiating forensic download...",
      status: "running",
    });

    try {
      await onDownload();
      setState("success");
      updateTask(islandTaskId, {
        status: "done",
        detail: `${label} completed successfully`,
      });

      timerRef.current = setTimeout(() => {
        setState("idle");
      }, 2400);
    } catch (err: any) {
      const msg = err?.message || "Download failed";
      setState("error");
      setErrorMessage(msg);
      updateTask(islandTaskId, {
        status: "error",
        detail: `Download error: ${msg}`,
      });

      timerRef.current = setTimeout(() => {
        setState("idle");
      }, 3500);
    }
  };

  // Base styling per variant
  const variantStyles = {
    primary:
      "bg-teal-600 hover:bg-teal-500 text-white border-teal-500/40 shadow-sm",
    secondary:
      "bg-[#242220] hover:bg-[#2c2a27] text-[#ded7cb] hover:text-[#f4efe6] border-[rgba(238,231,219,0.12)]",
    subtle:
      "bg-transparent hover:bg-[#242220] text-[#a8a196] hover:text-[#f4efe6] border-transparent",
  };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      disabled={disabled || isBusy}
      whileHover={disabled || isBusy ? undefined : { scale: 1.02 }}
      whileTap={disabled || isBusy ? undefined : { scale: 0.98 }}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold tracking-wide border transition-all duration-200 select-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden",
        variantStyles[variant],
        state === "success" && "border-teal-500/50 bg-teal-950/40 text-teal-300",
        state === "error" && "border-amber-500/50 bg-amber-950/40 text-amber-300",
        className
      )}
      title={errorMessage || label}
    >
      <AnimatePresence mode="wait">
        {state === "preparing" && (
          <motion.span
            key="preparing"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="flex items-center gap-1.5"
          >
            <Loader2 size={12} className="animate-spin text-teal-400" />
            <span>{preparingLabel}</span>
          </motion.span>
        )}

        {state === "success" && (
          <motion.span
            key="success"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 450, damping: 25 }}
            className="flex items-center gap-1.5 text-teal-300"
          >
            <Check size={12} strokeWidth={2.8} className="text-teal-400" />
            <span>{successLabel}</span>
          </motion.span>
        )}

        {state === "error" && (
          <motion.span
            key="error"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.16 }}
            className="flex items-center gap-1.5 text-amber-300"
          >
            <AlertCircle size={12} className="text-amber-400" />
            <span>Failed</span>
          </motion.span>
        )}

        {state === "idle" && (
          <motion.span
            key="idle"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16 }}
            className="flex items-center gap-1.5"
          >
            <Icon size={12} className="text-teal-400/90" />
            <span>{label}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

export default AnimatedDownloadButton;
