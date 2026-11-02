"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { getClientSessionId } from "@/lib/api";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import {
  listMuseIncidents,
  MuseConversationClient,
  transcribeRecording,
  type MuseIncident,
  type MuseMessage,
} from "@/lib/muse-assistant";
import { useActivity } from "@/context/ActivityContext";
import AITextLoading from "@/components/kokonutui/ai-text-loading";
import AICitations, {
  type CitationSource,
  type AnswerPart,
} from "@/components/kokonutui/ai-citations";

function extractText(val: unknown): string {
  if (typeof val === "string") return val;
  if (val && typeof (val as { target?: { value?: unknown } }).target?.value === "string") {
    return (val as { target: { value: string } }).target.value;
  }
  return "";
}

export interface FloatingMuseChatProps {
  activeIncidentId?: string | null;
}

export function FloatingMuseChat({ activeIncidentId: propIncidentId }: FloatingMuseChatProps = {}) {
  let activityContext: ReturnType<typeof useActivity> | null = null;
  try {
    activityContext = useActivity();
  } catch {
    // Graceful fallback outside ActivityProvider
  }
  const contextActiveIncidentId = activityContext?.activeIncidentId;
  const effectiveActiveIncident = propIncidentId !== undefined ? propIncidentId : contextActiveIncidentId;

  // Open strictly on user click, never automatically on mount
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<MuseMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [incidents, setIncidents] = useState<MuseIncident[]>([]);
  const [selected, setSelected] = useState(effectiveActiveIncident || "");
  const [contextIncident, setContextIncident] = useState<string | null>(effectiveActiveIncident || null);
  const [pendingText, setPendingText] = useState("");
  const [isHolding, setIsHolding] = useState(false);

  const client = useRef<MuseConversationClient | null>(null);
  const epoch = useRef(0);
  const sending = useRef(false);
  const isHoldingRef = useRef(false);
  const autoSendRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const shouldReduceMotion = useReducedMotion();
  const capture = useVoiceRecorder(busy || transcribing);
  const { discard } = capture;

  // Initialize client and incident list
  useEffect(() => {
    let lookup: AbortController;
    function initialize() {
      epoch.current++;
      sending.current = false;
      lookup?.abort();
      discard();

      const session = getClientSessionId();
      const initialActive = effectiveActiveIncident || null;
      client.current = new MuseConversationClient(session, initialActive);
      setDraft("");
      setMessages([]);
      setSelected(initialActive || "");
      setContextIncident(initialActive);
      setError("");
      setPendingText("");
      setBusy(false);
      setTranscribing(false);
      setReady(true);
      setIncidents([]);

      lookup = new AbortController();
      const ticket = epoch.current;
      listMuseIncidents(session, lookup.signal)
        .then((items) => {
          if (ticket === epoch.current) {
            setIncidents(items);
            if (effectiveActiveIncident) {
              setSelected(effectiveActiveIncident);
              setContextIncident(effectiveActiveIncident);
              if (client.current) {
                client.current.selectedIncident = effectiveActiveIncident;
              }
            }
          }
        })
        .catch(() => {
          // Non-critical background incident fetch
        });
    }

    initialize();

    // Event listener: opens ONLY on explicit open event, never on incident selection
    const handleOpen = () => setIsOpen(true);
    const handleSelect = (e: Event) => {
      const customEvent = e as CustomEvent<string | null>;
      const newInc = customEvent.detail || "";
      if (newInc !== selected) {
        setSelected(newInc);
        setContextIncident(newInc || null);
        if (client.current) {
          client.current.selectedIncident = newInc || null;
        }
      }
      // CRITICAL: Does NOT call setIsOpen(true). Open strictly on user click.
    };

    window.addEventListener("fixproof_session_changed", initialize);
    window.addEventListener("fixproof_open_muse", handleOpen);
    window.addEventListener("fixproof_muse_select_incident", handleSelect);

    return () => {
      epoch.current++;
      lookup?.abort();
      window.removeEventListener("fixproof_session_changed", initialize);
      window.removeEventListener("fixproof_open_muse", handleOpen);
      window.removeEventListener("fixproof_muse_select_incident", handleSelect);
    };
  }, [effectiveActiveIncident, discard]);

  // Synchronize active incident from dashboard automatically without manual selection
  useEffect(() => {
    const targetInc = effectiveActiveIncident || "";
    if (targetInc !== selected) {
      const prevInc = selected;
      setSelected(targetInc);
      setContextIncident(targetInc || null);
      if (client.current) {
        client.current.selectedIncident = targetInc || null;
      }
      if (messages.length > 0 && prevInc && targetInc && prevInc !== targetInc) {
        const targetRec = incidents.find((i) => i.incident_id === targetInc);
        const name = targetRec?.suspect_filename || targetInc.slice(0, 8);
        const noticeMessage: MuseMessage = {
          message_id: `context-switch-${Date.now()}`,
          role: "assistant",
          text: `[Active context switched to: ${name}]`,
          metadata: {
            status: "completed",
            citations: [{ incident_id: targetInc }],
          },
        };
        setMessages((prev) => [...prev, noticeMessage]);
      }
    }
  }, [effectiveActiveIncident, selected, messages.length, incidents]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({
        behavior: shouldReduceMotion ? "auto" : "smooth",
      });
    }
  }, [messages, busy, isOpen, shouldReduceMotion]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && typeof document !== "undefined") {
      setTimeout(() => {
        document.getElementById("floating-muse-composer")?.focus();
      }, 150);
    }
  }, [isOpen]);

  const send = useCallback(async (textOverride?: unknown) => {
    const raw = extractText(textOverride) || extractText(draft);
    const textToSend = raw.trim();
    const active = client.current;
    if (!active || sending.current || !textToSend) return;

    sending.current = true;
    setBusy(true);
    setError("");
    setPendingText(textToSend);
    const ticket = epoch.current;

    try {
      const reply = await active.send(textToSend, selected || null);
      if (ticket !== epoch.current) return;
      setDraft("");
      setMessages(active.conversation?.messages || []);
      setContextIncident(
        active.selectedIncident || reply.citations[0]?.incident_id || null
      );
      if (active.selectedIncident && !selected) {
        setSelected(active.selectedIncident);
      }
    } catch (e) {
      if (ticket !== epoch.current) return;
      setError(
        e instanceof Error
          ? e.message
          : "The assistant could not complete this turn."
      );
    } finally {
      if (ticket === epoch.current) {
        sending.current = false;
        setBusy(false);
        setPendingText("");
      }
    }
  }, [draft, selected]);

  // Push-To-Talk Voice Bubble Handlers (Hold to speak, release to send)
  const handleHoldStart = useCallback(async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (busy || transcribing || isHoldingRef.current) return;
    setError("");
    isHoldingRef.current = true;
    autoSendRef.current = true;
    setIsHolding(true);
    await capture.startRecording();
  }, [busy, transcribing, capture]);

  const handleHoldEnd = useCallback((e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!isHoldingRef.current) return;
    isHoldingRef.current = false;
    setIsHolding(false);
    capture.stopRecording();
  }, [capture]);

  // Auto-transcribe and automatically send once audio recording is converted
  useEffect(() => {
    if (autoSendRef.current && capture.captured && capture.file) {
      autoSendRef.current = false;
      let cancelled = false;

      (async () => {
        setTranscribing(true);
        setError("");
        try {
          const result = await transcribeRecording(
            capture.file!,
            client.current?.session || getClientSessionId()
          );
          if (cancelled) return;
          const transcript = result.transcript.trim();
          if (transcript) {
            await send(transcript);
          } else {
            setError("No speech was detected. Hold and speak again.");
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Voice transcription failed.");
          }
        } finally {
          if (!cancelled) {
            capture.discard();
            setTranscribing(false);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }
  }, [capture.captured, capture.file, send, capture]);

  const disabled = busy || transcribing || !ready;
  const activeIncidentRecord = incidents.find(
    (i) => i.incident_id === (contextIncident || selected)
  );
  const activeIncidentName = activeIncidentRecord?.suspect_filename
    ? activeIncidentRecord.suspect_filename
    : selected
    ? `Incident ${selected.slice(0, 8)}`
    : "All Incidents";

  return (
    <>
      {/* Closed State: Floating Launcher Bubble */}
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            initial={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.85, y: 16 }
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.85, y: 16 }
            }
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-6 right-6 z-50 select-none"
          >
            <button
              onClick={() => setIsOpen(true)}
              aria-label="talk to the analyst"
              title="talk to the analyst"
              className="group relative flex items-center justify-center w-13 h-13 rounded-full bg-[#11141c] hover:bg-[#181d28] border border-white/10 hover:border-white/25 shadow-2xl transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer"
            >
              <Image
                src="/muse-logo-64.png"
                alt="talk to the analyst"
                width={38}
                height={38}
                className="rounded-full object-cover transition-transform group-hover:scale-105"
              />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Open State: Minimal Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.section
            role="dialog"
            aria-label="Muse AI Forensics Chat"
            initial={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.94, y: 20 }
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.94, y: 20 }
            }
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-3 right-3 left-3 sm:left-auto sm:bottom-6 sm:right-6 z-50 flex flex-col w-auto sm:w-[400px] h-[560px] max-h-[calc(100vh-32px)] rounded-2xl bg-[#0b0e14] border border-zinc-800 shadow-2xl overflow-hidden font-sans"
          >
            {/* Minimal Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80 bg-[#10131a] select-none">
              <div className="flex items-center gap-2.5">
                <div className="relative w-7 h-7 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/80 shrink-0">
                  <Image
                    src="/muse-logo-64.png"
                    alt="Muse"
                    width={28}
                    height={28}
                    className="object-cover w-full h-full"
                  />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-zinc-100 tracking-wide">
                      Muse
                    </span>
                    <span className="text-[10px] text-zinc-400">· Analyst</span>
                  </div>
                  {/* Automatic Incident Indicator */}
                  <span
                    className="text-[10px] font-mono text-teal-400/90 truncate max-w-[220px]"
                    title={`Current Context: ${activeIncidentName}`}
                  >
                    {activeIncidentName}
                  </span>
                </div>
              </div>

              {/* Minimal Close Button */}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                title="Close chat"
                aria-label="Minimize chat"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition-colors text-xs cursor-pointer"
              >
                ✕
              </button>
            </header>

            {/* Conversation Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
              {/* Empty State */}
              {!messages.length && !busy && (
                <div className="flex flex-col items-center justify-center text-center py-8 px-2 space-y-3">
                  <div className="relative w-12 h-12 rounded-full overflow-hidden bg-zinc-900 border border-zinc-800">
                    <Image
                      src="/muse-logo-64.png"
                      alt="Muse"
                      width={48}
                      height={48}
                      className="object-cover"
                    />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-200">
                      Muse Voice & Evidence Copilot
                    </h3>
                    <p className="mt-1 text-[11px] text-zinc-400 max-w-[260px] leading-relaxed">
                      Hold the voice bubble to speak, or type below. Active incident is synced automatically.
                    </p>
                  </div>

                  {/* Minimal Text Suggestion Chips */}
                  <div className="w-full pt-2 space-y-1.5 text-left">
                    <button
                      type="button"
                      onClick={() => send("Show me the latest incident and explain what happened.")}
                      className="w-full text-left text-[11px] px-3 py-2 rounded-xl bg-zinc-900/80 hover:bg-zinc-800/90 border border-zinc-800/80 text-zinc-300 hover:text-white transition-all cursor-pointer truncate"
                    >
                      Show me latest incident findings
                    </button>
                    <button
                      type="button"
                      onClick={() => send("Were candidate matches found? Explain frame evidence.")}
                      className="w-full text-left text-[11px] px-3 py-2 rounded-xl bg-zinc-900/80 hover:bg-zinc-800/90 border border-zinc-800/80 text-zinc-300 hover:text-white transition-all cursor-pointer truncate"
                    >
                      Detail candidate match evidence
                    </button>
                  </div>
                </div>
              )}

              {/* Message Thread */}
              {messages.map((message) => {
                const isUser = message.role === "user";
                const citations = message.metadata?.citations || [];
                const citationSources: CitationSource[] = citations.map((c, i) => {
                  const incShort = c.incident_id.slice(0, 8);
                  const title = c.evidence_id
                    ? `Evidence ${c.evidence_id} (${incShort})`
                    : `Incident ${incShort}`;
                  const snippet =
                    c.timestamp_sec != null
                      ? `Stored CV observation at timestamp ${c.timestamp_sec.toFixed(1)}s.`
                      : `Stored forensic record for ${c.incident_id}.`;
                  return {
                    id: `cite-${message.message_id}-${i}`,
                    title,
                    url: `/dashboard?tab=incidents&incident_id=${encodeURIComponent(c.incident_id)}`,
                    site: c.evidence_id || incShort,
                    snippet,
                  };
                });

                const citationParts: AnswerPart[] = citations.length
                  ? [{ text: message.text, cite: citationSources.map((s) => s.id) }]
                  : [{ text: message.text }];

                return (
                  <motion.div
                    key={message.message_id}
                    initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.16 }}
                    className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                        isUser
                          ? "bg-zinc-800 text-zinc-100 rounded-tr-xs"
                          : "bg-[#131722] border border-zinc-800/80 text-zinc-200 rounded-tl-xs"
                      }`}
                    >
                      {!isUser && (
                        <div className="flex items-center gap-1.5 mb-1 text-[10px] font-mono text-zinc-400">
                          <span>Muse</span>
                          {message.metadata?.status === "failed" && (
                            <span className="text-amber-400">· Incomplete</span>
                          )}
                        </div>
                      )}
                      {citations.length > 0 ? (
                        <AICitations
                          parts={citationParts}
                          sources={citationSources}
                          className="text-xs leading-relaxed text-zinc-200"
                        />
                      ) : (
                        <p className="whitespace-pre-wrap">{message.text}</p>
                      )}
                    </div>
                  </motion.div>
                );
              })}

              {/* Busy / Thinking Indicator */}
              {busy && (
                <motion.div
                  initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-start space-y-1.5 mr-auto max-w-[90%]"
                >
                  {pendingText && (
                    <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-xs px-3.5 py-2.5 text-xs bg-zinc-800 text-zinc-100">
                      {pendingText}
                    </div>
                  )}
                  <div className="rounded-2xl rounded-tl-xs px-3.5 py-2.5 text-xs bg-[#131722] border border-zinc-800/80 text-zinc-300">
                    <AITextLoading
                      texts={[
                        "Analyzing evidence...",
                        "Correlating candidate frames...",
                        "Grounding response...",
                      ]}
                      interval={1400}
                      className="text-zinc-300 text-xs"
                    />
                  </div>
                </motion.div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Error Banner */}
            {(error || capture.error) && (
              <div
                role="alert"
                className="mx-3 my-1 px-3 py-1.5 rounded-xl bg-amber-950/70 border border-amber-600/30 text-[11px] text-amber-200 flex items-center justify-between"
              >
                <span className="truncate">{error || capture.error}</span>
                <button
                  type="button"
                  onClick={() => setError("")}
                  className="text-[10px] text-amber-300 hover:text-white ml-2 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Minimal Composer Area */}
            <div className="p-3 bg-[#0a0d14] border-t border-zinc-800/80 space-y-2 select-none">
              {/* Push-to-Talk Voice Bubble (Hold to speak, release to send) */}
              <div className="flex justify-center">
                <button
                  type="button"
                  onMouseDown={handleHoldStart}
                  onMouseUp={handleHoldEnd}
                  onMouseLeave={handleHoldEnd}
                  onTouchStart={handleHoldStart}
                  onTouchEnd={handleHoldEnd}
                  disabled={disabled && !isHolding}
                  aria-label="Hold to speak to Muse"
                  className={`relative flex items-center justify-center gap-2 px-6 py-2.5 rounded-full font-medium text-xs transition-all select-none cursor-pointer shadow-md ${
                    isHolding
                      ? "bg-rose-500/25 border border-rose-500/60 text-rose-200 shadow-rose-500/20 scale-105 animate-pulse"
                      : transcribing
                      ? "bg-teal-500/20 border border-teal-500/40 text-teal-200"
                      : "bg-zinc-800/90 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-200 hover:text-white hover:border-zinc-600 active:scale-95"
                  }`}
                >
                  {isHolding ? (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-ping" />
                      <span>Listening… Release to send ({Math.floor(capture.seconds)}s)</span>
                    </>
                  ) : transcribing ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-teal-400 animate-ping" />
                      <span>Transcribing & sending to Muse…</span>
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-teal-400" />
                      <span>Hold to speak</span>
                    </>
                  )}
                </button>
              </div>

              {/* Secondary Minimal Text Input */}
              <div className="flex items-center gap-1.5 w-full bg-[#121620] border border-zinc-800/80 rounded-xl px-3 py-1.5 focus-within:border-zinc-700 transition-colors">
                <input
                  id="floating-muse-composer"
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (draft.trim() && !disabled) {
                        const text = draft.trim();
                        setDraft("");
                        void send(text);
                      }
                    }
                  }}
                  placeholder="Ask Muse or hold voice bubble… (Enter to send)"
                  disabled={disabled}
                  className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (draft.trim() && !disabled) {
                      const text = draft.trim();
                      setDraft("");
                      void send(text);
                    }
                  }}
                  disabled={disabled || !draft.trim()}
                  className="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-30 disabled:hover:bg-teal-600 text-white text-[11px] font-medium transition-colors shrink-0 cursor-pointer"
                >
                  Send
                </button>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}

export default FloatingMuseChat;
