"use client";

/**
 * @author: @kokonutui (adapted for FixProof Muse Chatbot)
 * @description: AI Input Search text composer component
 * @license: MIT
 * @website: https://kokonutui.com
 */

import { CornerDownLeft, Plus, X } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Textarea } from "@/components/ui/textarea";
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea";
import { cn } from "@/lib/utils";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const EASE_OUT_CSS = "ease-[cubic-bezier(0.23,1,0.32,1)]";

export interface AIInputSearchProps {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (query: string) => void;
  onStop?: () => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  onAttachFile?: () => void;
  className?: string;
}

function useContentWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | "auto">("auto");

  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

function SendStopButton({
  running,
  canSubmit,
  onSubmit,
  onStop,
}: {
  running: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onStop?: () => void;
}) {
  const [innerRef, width] = useContentWidth<HTMLSpanElement>();
  const live = running || canSubmit;
  const face = running ? "stop" : "ask";

  return (
    <motion.button
      animate={{ width }}
      aria-label={running ? "Stop" : "Send message"}
      className={cn(
        "h-7 shrink-0 overflow-hidden rounded-lg px-2",
        "transition-[background-color,color] duration-150",
        EASE_OUT_CSS,
        "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-white/30",
        live
          ? "bg-zinc-800 text-white hover:bg-zinc-700"
          : "bg-white/5 text-white/30 cursor-not-allowed"
      )}
      disabled={!live}
      onClick={running ? onStop : onSubmit}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      type="button"
    >
      <span className="flex h-full w-max items-center" ref={innerRef}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            animate={{ opacity: 1, filter: "blur(0px)" }}
            className="flex h-7 items-center gap-1.5 font-mono text-[11px]"
            exit={{
              opacity: 0,
              filter: "blur(2px)",
              transition: { duration: 0.08 },
            }}
            initial={{ opacity: 0, filter: "blur(2px)" }}
            key={face}
            transition={{ duration: 0.16, ease: EASE_OUT }}
          >
            {face === "stop" ? (
              <>
                <span className="size-2 rounded-[2px] bg-amber-400" />
                <span>Working…</span>
              </>
            ) : (
              <>
                <span>Send</span>
                <CornerDownLeft aria-hidden="true" className="size-3 opacity-60" />
              </>
            )}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.button>
  );
}

export default function AI_Input_Search({
  id,
  value: controlledValue,
  onChange: controlledOnChange,
  onSubmit,
  onStop,
  placeholder = "Type your investigation question… (Enter to send)",
  disabled = false,
  loading = false,
  onAttachFile,
  className,
}: AIInputSearchProps) {
  const [internalValue, setInternalValue] = useState("");
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;

  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 40,
    maxHeight: 120,
  });

  const handleChange = useCallback(
    (next: string) => {
      if (!isControlled) {
        setInternalValue(next);
      }
      controlledOnChange?.(next);
      adjustHeight();
    },
    [isControlled, controlledOnChange, adjustHeight]
  );

  const handleSubmit = useCallback(() => {
    if (disabled || loading || !value.trim()) return;
    onSubmit?.(value.trim());
  }, [disabled, loading, value, onSubmit]);

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn("relative w-full", className)}>
        <div
          className={cn(
            "rounded-xl border border-white/10 bg-[#0c1017]/95 transition-colors",
            "focus-within:border-white/20"
          )}
        >
          <Textarea
            id={id}
            aria-label="Message"
            className="min-h-[40px] w-full resize-none rounded-t-xl border-none bg-transparent px-3 pt-2.5 pb-1 text-xs sm:text-[13px] text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-0 leading-relaxed shadow-none"
            disabled={disabled}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={placeholder}
            ref={textareaRef}
            value={value}
          />

          <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 border-t border-white/5 bg-[#090d14]/60 rounded-b-xl">
            <div className="flex items-center gap-1.5">
              {onAttachFile && (
                <button
                  aria-label="Attach WAV audio file"
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 border border-white/10 hover:text-zinc-200 hover:bg-white/5 transition-colors",
                    disabled && "opacity-40 cursor-not-allowed"
                  )}
                  disabled={disabled}
                  onClick={onAttachFile}
                  title="Upload WAV file"
                  type="button"
                >
                  <Plus aria-hidden="true" className="size-3.5" />
                </button>
              )}
              {value && (
                <button
                  aria-label="Clear text"
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
                  onClick={() => handleChange("")}
                  type="button"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              )}
            </div>

            <SendStopButton
              canSubmit={!disabled && !!value.trim()}
              onStop={onStop ?? (() => {})}
              onSubmit={handleSubmit}
              running={loading}
            />
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
export { AI_Input_Search };
