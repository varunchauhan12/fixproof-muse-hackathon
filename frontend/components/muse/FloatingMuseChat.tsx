"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { getClientSessionId } from "@/lib/api";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import {
  listMuseIncidents,
  workflowForText,
  type MuseWorkflow,
  MuseConversationClient,
  transcribeRecording,
  type MuseIncident,
  type MuseMessage,
} from "@/lib/muse-assistant";
import { MuseDocumentWorkspace } from "./MuseDocumentWorkspace";
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

/** Animated audio equalizer bars indicating live voice recording */
function AudioEqualizerBars({ active }: { active: boolean }) {
  const bars = [8, 20, 14, 28, 18, 32, 12, 26, 16, 22];
  return (
    <div className="flex items-center gap-1 h-7 px-1.5 select-none" aria-hidden="true">
      {bars.map((maxH, i) => (
        <motion.span
          key={i}
          animate={
            active
              ? {
                  height: [4, maxH, 6, Math.round(maxH * 0.7), 4],
                  opacity: [0.65, 1, 0.8, 1, 0.65],
                }
              : { height: 4, opacity: 0.35 }
          }
          transition={{
            duration: 0.38 + (i % 4) * 0.08,
            repeat: Infinity,
            repeatType: "mirror",
            ease: "easeInOut",
            delay: i * 0.04,
          }}
          className="w-1 rounded-full bg-rose-600 block origin-bottom shadow-xs"
        />
      ))}
    </div>
  );
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
  const [workflow, setWorkflow] = useState<MuseWorkflow | null>(null);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const client = useRef<MuseConversationClient | null>(null);
  const epoch = useRef(0);
  const sending = useRef(false);
  const isHoldingRef = useRef(false);
  const autoSendRef = useRef(false);
  const transcribingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const shouldReduceMotion = useReducedMotion();
  const capture = useVoiceRecorder(busy || transcribing);
  const discardRef = useRef(capture.discard);
  discardRef.current = capture.discard;

  // Initialize client and incident list ONCE on mount or session change
  useEffect(() => {
    let lookup: AbortController;
    function initialize() {
      epoch.current++;
      sending.current = false;
      setWorkflow(null);
      lookup?.abort();
      discardRef.current?.();

      const session = getClientSessionId();
      const initialActive = selectedRef.current || effectiveActiveIncident || null;
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
            if (!selectedRef.current && items.length > 0) {
              const defaultInc = items[0].incident_id;
              selectedRef.current = defaultInc;
              setSelected(defaultInc);
              setContextIncident(defaultInc);
              if (client.current) {
                client.current.selectedIncident = defaultInc;
              }
            }
          }
        })
        .catch(() => {
          // Non-critical background incident fetch
        });
    }

    initialize();

    const handleOpen = () => setIsOpen(true);
    const handleSelect = (e: Event) => {
      const customEvent = e as CustomEvent<string | { incident_id?: string; session_id?: string } | null>;
      const detail = customEvent.detail;
      const newInc = typeof detail === "string" ? detail : (detail?.incident_id || "");
      const newSess = (typeof detail === "object" && detail?.session_id) ? detail.session_id : getClientSessionId();
      if (newInc && (newInc !== selectedRef.current || client.current?.selectedIncident !== newInc)) {
        epoch.current++; sending.current = false; setBusy(false); setPendingText(""); setWorkflow(null);
        selectedRef.current = newInc;
        setSelected(newInc);
        setContextIncident(newInc);
        setMessages([]); // Reset messages on incident switch so conversation binds cleanly to new incident
        client.current = new MuseConversationClient(newSess, newInc);
      }
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
  }, []);

  // Synchronize active incident from dashboard automatically when effectiveActiveIncident changes
  useEffect(() => {
    const targetInc = effectiveActiveIncident || "";
    if (targetInc && (targetInc !== selectedRef.current || client.current?.selectedIncident !== targetInc)) {
      epoch.current++; sending.current = false; setBusy(false); setPendingText(""); setWorkflow(null);
      selectedRef.current = targetInc;
      setSelected(targetInc);
      setContextIncident(targetInc);
      setMessages([]);
      const session = getClientSessionId();
      client.current = new MuseConversationClient(session, targetInc);
    }
  }, [effectiveActiveIncident]);

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

    const requestedWorkflow = workflowForText(textToSend);
    if (requestedWorkflow) {
      if (!selectedRef.current) { setError("Select an incident before opening a document workflow."); return; }
      setWorkflow(requestedWorkflow); setDraft(""); setError("");
      return; // UI navigation only; Generate and Send remain separate human actions.
    }
    sending.current = true;
    setBusy(true);
    setError("");
    setPendingText(textToSend);
    const ticket = epoch.current;

    // Use selected incident, or effective active incident, or fallback to first known incident
    const incidentToUse = selected || effectiveActiveIncident || client.current?.selectedIncident || (incidents.length > 0 ? incidents[0].incident_id : null);

    try {
      const reply = await active.send(textToSend, incidentToUse || null);
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
  }, [draft, selected, effectiveActiveIncident, incidents]);

  // Reset conversation to start fresh
  const handleNewChat = useCallback(() => {
    const session = getClientSessionId();
    const activeToSet = selected || (incidents.length > 0 ? incidents[0].incident_id : null);
    client.current = new MuseConversationClient(session, activeToSet);
    setMessages([]);
    setWorkflow(null);
    setDraft("");
    setError("");
    setPendingText("");
  }, [selected, incidents]);

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
    if (autoSendRef.current && capture.captured && capture.file && !transcribingRef.current) {
      autoSendRef.current = false;
      transcribingRef.current = true;
      const fileToTranscribe = capture.file;
      const targetSession = client.current?.session || getClientSessionId();

      setTranscribing(true);
      setError("");

      // Safety timeout guard (12s) so the UI never gets stuck on transcribing
      const timeoutTimer = setTimeout(() => {
        if (transcribingRef.current) {
          transcribingRef.current = false;
          setTranscribing(false);
          capture.discard();
          setError("Transcription timed out. Please hold and speak again.");
        }
      }, 12000);

      (async () => {
        let transcriptText = "";
        let errorMsg = "";
        try {
          const result = await transcribeRecording(fileToTranscribe, targetSession);
          transcriptText = result?.transcript?.trim() || "";
        } catch (err) {
          errorMsg = err instanceof Error ? err.message : "Voice transcription failed.";
        } finally {
          clearTimeout(timeoutTimer);
          capture.discard();
          transcribingRef.current = false;
          setTranscribing(false);
        }

        if (errorMsg) {
          setError(errorMsg);
        } else if (transcriptText) {
          void send(transcriptText);
        } else {
          setError("No speech was detected. Hold and speak again.");
        }
      })();
    }
  }, [capture.captured, capture.file, send, capture.discard]);

  const disabled = busy || transcribing || !ready;

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
              className="group relative flex items-center justify-center w-13 h-13 rounded-full bg-[#18181B] hover:bg-black border border-white/20 shadow-2xl transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer"
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

      {/* Open State: Whitish Cream Island with Slide Animation, Viewport Gap & Rounded Corners */}
      <AnimatePresence>
        {isOpen && (
          <motion.section
            role="dialog"
            aria-label="Muse AI Forensics Chat"
            initial={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, x: "100%" }
            }
            animate={{ opacity: 1, x: 0 }}
            exit={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, x: "100%" }
            }
            transition={{
              duration: shouldReduceMotion ? 0.15 : 0.32,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="fixed top-3 right-3 bottom-3 sm:top-4 sm:right-4 sm:bottom-4 z-50 flex flex-col w-[calc(100vw-24px)] sm:w-[430px] lg:w-[450px] max-w-[calc(100vw-24px)] h-[calc(100vh-24px)] sm:h-[calc(100vh-32px)] rounded-2xl sm:rounded-3xl bg-[#FAF8F5] border border-[#D5D0C5] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.35)] overflow-hidden font-sans text-black dark:text-black [color-scheme:light]"
          >
            {/* Minimal Deskwright-style Top Bar */}
            <header className="flex items-center justify-between px-4 py-3.5 border-b border-[#E8E3D8] bg-[#FAF8F5] select-none shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="relative w-7 h-7 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center p-0.5">
                  <Image
                    src="/muse-logo-64.png"
                    alt="Muse"
                    width={26}
                    height={26}
                    className="object-cover w-full h-full rounded-md"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-black dark:text-black tracking-tight">
                    Muse
                  </span>
                  <span className="text-[10px] text-zinc-600 dark:text-zinc-600 font-semibold">· Analyst</span>
                </div>
              </div>

              {/* Header Action Controls */}
              <div className="flex items-center gap-1">
                {/* New Chat */}
                <button
                  type="button"
                  onClick={handleNewChat}
                  title="New conversation"
                  aria-label="New conversation"
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-700 dark:text-zinc-700 hover:text-black dark:hover:text-black hover:bg-zinc-200/60 transition-colors text-xs cursor-pointer"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>

                {/* Minimize / Close Button */}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  title="Close chat"
                  aria-label="Minimize chat"
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-700 dark:text-zinc-700 hover:text-black dark:hover:text-black hover:bg-zinc-200/60 transition-colors text-xs cursor-pointer font-bold ml-0.5"
                >
                  ✕
                </button>
              </div>
            </header>

            <div className="border-b border-[#e8e3d8] px-4 py-3 space-y-2">
              <label className="block text-[11px] font-medium">Active investigation
                <select aria-label="Muse active incident" className="mt-1 w-full rounded-lg border border-[#d5d0c5] bg-white p-2 text-xs" value={selected} disabled={busy || transcribing} onChange={e => {
                  const iid=e.target.value; epoch.current++; sending.current=false; setBusy(false); setPendingText("");
                  selectedRef.current=iid; setSelected(iid); setContextIncident(iid || null); setMessages([]); setWorkflow(null); setError("");
                  client.current=new MuseConversationClient(getClientSessionId(),iid || null);
                }}><option value="">Select an incident</option>{selected && !incidents.some(i=>i.incident_id===selected) && <option value={selected}>{selected}</option>}{incidents.map(i=><option key={i.incident_id} value={i.incident_id}>{i.suspect_filename || i.incident_id}</option>)}</select>
              </label>
              <div className="flex flex-wrap gap-1.5">{[
                ["Explain investigation","Explain what happened in this selected incident."],
                ["Temporal analysis","Explain the temporal evidence and its inconsistencies for this incident."],
                ["SAM findings","Explain the recorded SAM observations and any unavailable information."],
                ["Generate report","Generate an investigation report."],
                ["Copyright notice","Prepare a copyright notice."],
                ["Licensing proposal","Prepare a licensing proposal."],
                ["Prepare email","Prepare an email with the investigation report."],
              ].map(([label,prompt])=><button key={label} type="button" disabled={disabled || !selected} onClick={()=>send(prompt)} className="rounded-full border border-[#d5d0c5] bg-white px-2 py-1 text-[10px] hover:bg-zinc-100 disabled:opacity-40">{label}</button>)}</div>
            </div>
            {/* Conversation Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5 scrollbar-thin scrollbar-thumb-zinc-400/50 hover:scrollbar-thumb-zinc-500/70">
              {workflow && selected && <MuseDocumentWorkspace key={`${getClientSessionId()}:${selected}`} incidentId={selected} initial={workflow} onClose={()=>setWorkflow(null)} />}
              {/* Empty State: Matching the Deskwright Aesthetic in Screenshot */}
              {!messages.length && !busy && !workflow && (
                <div className="flex flex-col items-center justify-center text-center h-full min-h-[300px] px-2 space-y-4 my-auto select-none">
                  <div className="space-y-1.5 mt-8">
                    <h2 className="text-2xl font-serif text-black dark:text-black tracking-tight font-semibold">
                      What should I do?
                    </h2>
                    <p className="text-xs text-zinc-600 dark:text-zinc-600 font-normal max-w-[260px] leading-relaxed mx-auto">
                      Describe a task or ask about video evidence.
                    </p>
                  </div>

                  {/* Clean Action Chips above composer */}
                  <div className="w-full pt-10 space-y-2">
                    <div className="flex flex-wrap gap-2 justify-center">
                      <button
                        type="button"
                        onClick={() => send("Explain what happened in this selected incident.")}
                        className="flex items-center gap-1.5 text-[11px] font-semibold px-3.5 py-1.5 rounded-full bg-black text-white hover:bg-zinc-800 transition-all cursor-pointer shadow-xs"
                      >
                        <span>🎓</span>
                        <span>Overview</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => send("Can you tell me about this incident , give me the detailed report")}
                        className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full bg-white border border-[#D5D0C5] text-black dark:text-black hover:bg-zinc-100 hover:border-zinc-400 transition-all cursor-pointer shadow-xs"
                      >
                        <span>Detailed report</span>
                        <span className="text-[10px] text-zinc-500">▶ Run</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => send("Were candidate matches found? Detail frame evidence.")}
                        className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full bg-white border border-[#D5D0C5] text-black dark:text-black hover:bg-zinc-100 hover:border-zinc-400 transition-all cursor-pointer shadow-xs"
                      >
                        <span>Examine matches</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Message Thread with High-Contrast Black Typography */}
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
                      className={`max-w-[92%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                        isUser
                          ? "bg-white border border-[#D8D3C8] text-black dark:text-black font-normal rounded-tr-xs shadow-xs"
                          : "bg-[#F2ECE1] border border-[#DDD6C8] text-black dark:text-black font-normal rounded-tl-xs shadow-2xs"
                      }`}
                    >
                      {!isUser && (
                        <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-semibold text-black dark:text-black">
                          <span>Muse</span>
                          {message.metadata?.status === "failed" && (
                            <span className="text-amber-700 font-normal">· Incomplete</span>
                          )}
                        </div>
                      )}
                      {citations.length > 0 ? (
                        <AICitations
                          parts={citationParts}
                          sources={citationSources}
                          className="text-xs leading-relaxed text-black dark:text-black font-normal"
                        />
                      ) : (
                        <p className="whitespace-pre-wrap text-black dark:text-black text-xs leading-relaxed font-normal">{message.text}</p>
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
                  className="flex flex-col items-start space-y-2 mr-auto max-w-[92%]"
                >
                  {pendingText && (
                    <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-xs px-4 py-2.5 text-xs bg-white border border-[#D8D3C8] text-black dark:text-black font-normal shadow-xs">
                      {pendingText}
                    </div>
                  )}
                  <div className="rounded-2xl rounded-tl-xs px-4 py-2.5 text-xs bg-[#F2ECE1] border border-[#DDD6C8] text-black dark:text-black shadow-2xs">
                    <AITextLoading
                      texts={[
                        "Waiting for the grounded assistant response…",
                      ]}
                      interval={1400}
                      className="text-black dark:text-black text-xs font-semibold"
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
                className="mx-3 my-1 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-300 text-[11px] text-amber-900 flex items-center justify-between"
              >
                <span className="truncate">{error || capture.error}</span>
                <button
                  type="button"
                  onClick={() => setError("")}
                  className="text-[10px] text-amber-800 hover:text-black ml-2 cursor-pointer font-bold"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Bottom Composer Area: Deskwright Rounded White Card */}
            <div className="p-3.5 bg-[#FAF8F5] border-t border-[#E8E3D8] space-y-2 select-none shrink-0">
              {/* Push-to-Talk Voice Bubble with Animated Equalizer Bars */}
              <div className="flex justify-center">
                <button
                  type="button"
                  onMouseDown={handleHoldStart}
                  onMouseUp={handleHoldEnd}
                  onMouseLeave={handleHoldEnd}
                  onTouchStart={handleHoldStart}
                  onTouchEnd={handleHoldEnd}
                  onPointerDown={handleHoldStart}
                  onPointerUp={handleHoldEnd}
                  onPointerCancel={handleHoldEnd}
                  disabled={disabled && !isHolding}
                  aria-label="Hold to speak to Muse"
                  className={`relative flex items-center justify-center gap-2 px-5 py-2.5 rounded-full font-semibold text-xs transition-all select-none cursor-pointer shadow-xs ${
                    isHolding
                      ? "bg-rose-50 border-2 border-rose-500 text-rose-950 shadow-rose-200 scale-105"
                      : transcribing
                      ? "bg-teal-50 border border-teal-500 text-teal-950"
                      : "bg-white hover:bg-zinc-100 border border-[#D5D0C5] text-black dark:text-black hover:border-zinc-400 active:scale-95"
                  }`}
                >
                  {isHolding ? (
                    <div className="flex items-center gap-2">
                      <AudioEqualizerBars active={true} />
                      <span className="font-bold text-rose-950">
                        Listening… ({Math.floor(capture.seconds)}s) · Release to send
                      </span>
                    </div>
                  ) : transcribing ? (
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-teal-600 animate-ping" />
                      <span className="font-semibold text-teal-950">Transcribing voice…</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-800">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                      </svg>
                      <span>Hold to speak</span>
                    </div>
                  )}
                </button>
              </div>

              {/* Text Input Pill Card with Microphone & Vertical Up-Arrow Send Button */}
              <div className={`flex items-center gap-2 w-full bg-white border rounded-2xl p-2 shadow-xs transition-all ${
                isHolding ? "border-rose-400 ring-1 ring-rose-200 bg-rose-50/40" : "border-[#D5D0C5] focus-within:border-zinc-500 focus-within:ring-1 focus-within:ring-zinc-400/40"
              }`}>
                {isHolding ? (
                  <div className="flex items-center gap-2 w-full px-2 py-0.5 select-none min-h-[28px]">
                    <AudioEqualizerBars active={true} />
                    <span className="text-xs font-semibold text-rose-950 truncate">
                      Listening… ({Math.floor(capture.seconds)}s) · Release to send
                    </span>
                  </div>
                ) : (
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
                    className="w-full bg-transparent px-2 text-xs text-black dark:text-black placeholder:text-zinc-500 focus:outline-none font-normal"
                  />
                )}

                {/* Microphone Hold Icon */}
                <button
                  type="button"
                  onMouseDown={handleHoldStart}
                  onMouseUp={handleHoldEnd}
                  onMouseLeave={handleHoldEnd}
                  onTouchStart={handleHoldStart}
                  onTouchEnd={handleHoldEnd}
                  onPointerDown={handleHoldStart}
                  onPointerUp={handleHoldEnd}
                  onPointerCancel={handleHoldEnd}
                  disabled={disabled && !isHolding}
                  title="Hold to speak"
                  className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors cursor-pointer shrink-0 ${
                    isHolding ? "text-rose-700 bg-rose-100" : "text-zinc-600 dark:text-zinc-600 hover:text-black dark:hover:text-black hover:bg-zinc-100"
                  }`}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                </button>

                {/* Deskwright Black Pill Send Button with Up-Arrow ↑ */}
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
                  title="Send message"
                  aria-label="Send"
                  className="w-7 h-9 rounded-full bg-black hover:bg-zinc-800 disabled:opacity-20 disabled:hover:bg-black text-white flex items-center justify-center font-bold text-xs transition-all shrink-0 cursor-pointer shadow-xs active:scale-95"
                >
                  <span className="sr-only">Send</span>
                  <span aria-hidden="true" className="text-sm font-semibold">↑</span>
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
