"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Send, RotateCcw } from "lucide-react";
import { getClientSessionId } from "@/lib/api";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { listMuseIncidents, MuseConversationClient, transcribeRecording, type MuseIncident, type MuseMessage } from "@/lib/muse-assistant";

export default function MuseAssistantPage() {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<MuseMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [incidentError, setIncidentError] = useState("");
  const [incidents, setIncidents] = useState<MuseIncident[]>([]);
  const [loadingIncidents, setLoadingIncidents] = useState(true);
  const [selected, setSelected] = useState("");
  const [contextIncident, setContextIncident] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [asrModel, setAsrModel] = useState("");
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const client = useRef<MuseConversationClient | null>(null);
  const epoch = useRef(0);
  const sending = useRef(false);
  const audioRequest = useRef<AbortController | null>(null);
  const audioBusy = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const capture = useVoiceRecorder(busy || transcribing);
  const { discard } = capture;

  useEffect(() => {
    let lookup: AbortController;
    function initialize() {
      epoch.current++; sending.current = false; audioBusy.current = false;
      audioRequest.current?.abort(); lookup?.abort(); discard();
      const session = getClientSessionId();
      client.current = new MuseConversationClient(session);
      setDraft(""); setMessages([]); setSelected(""); setContextIncident(null); setError("");
      setPendingText(""); setBusy(false); setTranscribing(false); setAsrModel(""); setReady(true); setNeedsRecovery(false);
      setIncidents([]); setLoadingIncidents(true); setIncidentError("");
      lookup = new AbortController();
      const ticket = epoch.current;
      listMuseIncidents(session, lookup.signal).then(items => {
        if (ticket === epoch.current) setIncidents(items);
      }).catch(e => {
        if (ticket === epoch.current && !lookup.signal.aborted) setIncidentError(e instanceof Error ? e.message : "Could not load incidents.");
      }).finally(() => { if (ticket === epoch.current) setLoadingIncidents(false); });
    }
    initialize();
    window.addEventListener("fixproof_session_changed", initialize);
    const cancelPending = () => { epoch.current++; lookup?.abort(); audioRequest.current?.abort(); };
    return () => { cancelPending(); window.removeEventListener("fixproof_session_changed", initialize); };
  }, [discard]);

  function reset(incident = selected) {
    if (sending.current || audioBusy.current || capture.recordingBusy) return;
    client.current = new MuseConversationClient(getClientSessionId(), incident || null);
    setMessages([]); setContextIncident(incident || null); setSelected(incident); setError(""); setPendingText(""); setNeedsRecovery(false);
  }

  async function transcribe() {
    if (!capture.file || audioBusy.current || sending.current || capture.recordingBusy) return;
    audioBusy.current = true; setTranscribing(true); setError(""); capture.setError("");
    const ticket = epoch.current; const controller = new AbortController(); audioRequest.current = controller;
    try {
      const result = await transcribeRecording(capture.file, client.current?.session || getClientSessionId(), controller.signal);
      if (ticket !== epoch.current) return;
      setDraft(result.transcript); setAsrModel(result.model_id);
      if (!result.transcript.trim()) setError("No speech was detected. Record again or type your question.");
      composer.current?.focus();
    } catch (e) {
      if (ticket === epoch.current && !controller.signal.aborted) setError(e instanceof Error ? e.message : "Transcription failed.");
    } finally {
      if (ticket === epoch.current) { audioBusy.current = false; setTranscribing(false); }
    }
  }

  async function send() {
    const active = client.current;
    if (!active || sending.current || audioBusy.current || capture.recordingBusy || !draft.trim()) return;
    sending.current = true; setBusy(true); setError(""); setPendingText(draft.trim());
    const ticket = epoch.current;
    try {
      const reply = await active.send(draft);
      if (ticket !== epoch.current) return;
      setDraft(""); setMessages(active.conversation?.messages || []); setContextIncident(active.selectedIncident);
      if (reply.status === "failed") setError(reply.text);
    } catch (e) {
      if (ticket !== epoch.current) return;
      setMessages(active.conversation?.messages || []); setContextIncident(active.selectedIncident); setNeedsRecovery(active.needsRecovery);
      setError(e instanceof Error ? e.message : "Muse could not answer. Your question has been kept for review.");
    } finally {
      if (ticket === epoch.current) { sending.current = false; setBusy(false); setPendingText(""); }
    }
  }

  async function recover() {
    if (!client.current || sending.current) return;
    const active = client.current; const ticket = epoch.current;
    sending.current = true; setBusy(true); setError("");
    try {
      await active.recover();
      if (ticket === epoch.current) { setMessages(active.conversation?.messages || []); setContextIncident(active.selectedIncident); setNeedsRecovery(active.needsRecovery); }
    } catch (e) { if (ticket === epoch.current) setError(e instanceof Error ? e.message : "History is unavailable."); }
    finally { if (ticket === epoch.current) { sending.current = false; setBusy(false); } }
  }

  const disabled = busy || transcribing || capture.recordingBusy || !ready;
  const context = incidents.find(item => item.incident_id === contextIncident);
  const button = "rounded-xl border border-white/15 px-4 py-3 text-sm disabled:opacity-40 hover:bg-white/5 transition-colors";
  return <main className="mx-auto w-full max-w-3xl px-5 py-10 pb-32 text-[#f4efe6]">
    <Link href="/dashboard" className="text-sm text-teal-300 hover:underline">← Back to dashboard</Link>
    <header className="my-7 space-y-3">
      <p className="text-xs uppercase tracking-[.2em] text-teal-300">FixProof · Muse</p>
      <h1 className="text-3xl font-semibold">Talk through your investigation</h1>
      <p className="text-sm text-stone-400">Ask by voice or text. Muse reads your stored incident data and explains what is known, what matched, and what needs review.</p>
    </header>
    <section className="rounded-2xl border border-white/10 bg-white/[.03] p-5 space-y-3" aria-label="Incident context">
      <label htmlFor="muse-incident" className="text-sm font-medium">Choose an incident</label>
      <select id="muse-incident" className="w-full rounded-lg border border-white/15 bg-[#171717] p-3 text-sm" value={selected} disabled={disabled || loadingIncidents} onChange={e => reset(e.target.value)}>
        <option value="">Latest incident in this session</option>
        {incidents.map(item => <option key={item.incident_id} value={item.incident_id}>{item.suspect_filename || item.incident_id.slice(0, 8)} · {item.overall_status || "Status not recorded"} · {item.scanned_at ? new Date(item.scanned_at).toLocaleString() : "Date not recorded"}</option>)}
      </select>
      {loadingIncidents && <p role="status" className="text-sm text-stone-400">Loading your incidents…</p>}
      {incidentError && <p role="alert" className="text-sm text-amber-300">{incidentError} You can still ask Muse to look up your latest incident.</p>}
      {!loadingIncidents && !incidentError && !incidents.length && <p role="status" className="text-sm text-amber-300">No incidents were found in this session. Open your existing investigation in the dashboard using the same session, or scan a video there first.</p>}
      <p className="text-xs text-teal-200">Discussing: {contextIncident ? `${context?.suspect_filename || "Incident"} · ${contextIncident.slice(0, 8)}` : "Your latest incident will be resolved when you send."}</p>
      <p className="text-xs text-stone-500">Conversation memory lasts until you leave this page or the backend restarts/expires it. Similarity is not proof of infringement.</p>
    </section>
    <section role="log" aria-live="polite" aria-label="Conversation with Muse" className="my-6 space-y-4 min-h-40">
      {!messages.length && !busy && <p className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-stone-400">Try “Show me the latest incident and explain what happened.” Then ask “Can you explain the evidence in more detail?”</p>}
      {messages.map(message => <article key={message.message_id} className={`rounded-2xl border p-5 ${message.role === "user" ? "ml-8 border-white/10 bg-white/5" : "mr-8 border-teal-400/20 bg-teal-400/5"}`}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">{message.role === "user" ? "You" : "Muse"}{message.metadata?.status === "failed" ? " · Unable to complete" : ""}</p>
        <p className="whitespace-pre-wrap text-sm leading-7">{message.text}</p>
        {!!message.metadata?.citations?.length && <p className="mt-3 text-xs text-stone-400">Sources: {message.metadata.citations.map(c => `Incident ${c.incident_id.slice(0, 8)}${c.evidence_id ? ` · ${c.evidence_id}` : ""}${c.timestamp_sec != null ? ` · suspect ${c.timestamp_sec}s` : ""}`).join("; ")}</p>}
        {message.metadata?.provider && <p className="mt-2 text-xs text-stone-500">{message.metadata.provider} · {message.metadata.model_id}</p>}
      </article>)}
      {busy && <div role="status" className="rounded-2xl border border-teal-400/20 p-5 text-sm text-teal-200">{pendingText && <p className="mb-2 text-stone-400">{pendingText}</p>}Muse is reading the investigation and preparing an answer…</div>}
    </section>
    <section className="rounded-2xl border border-white/15 bg-white/[.03] p-5 space-y-4" aria-label="Ask Muse">
      <div className="flex flex-wrap items-center gap-3">
        <button className={button} disabled={busy || transcribing || !ready || ["permission", "converting"].includes(capture.recordState)} onClick={() => capture.recordState === "recording" ? capture.stopRecording() : void capture.startRecording()}>
          {capture.recordState === "recording" ? <><Square className="inline size-4 mr-2" />Stop recording</> : <><Mic className="inline size-4 mr-2" />Record question</>}
        </button>
        <button className={button} disabled={disabled || !capture.file} onClick={() => void transcribe()}>{transcribing ? "Transcribing…" : "Transcribe recording"}</button>
        <button className={button} disabled={busy || transcribing || (!capture.file && !capture.recordingBusy)} onClick={capture.discard}>Discard audio</button>
      </div>
      <p role="status" className="text-xs text-stone-400">{capture.recordState === "permission" ? "Waiting for microphone permission…" : capture.recordState === "recording" ? `Recording · ${Math.floor(capture.seconds)}s` : capture.recordState === "converting" ? "Converting to WAV…" : transcribing ? "Waiting for transcription…" : "Microphone off"}</p>
      {capture.playback && <audio aria-label="Review recorded question" controls src={capture.playback} className="w-full" />}
      <label className="block text-xs text-stone-400">Or upload an existing WAV<input type="file" accept=".wav,audio/wav" className="mt-2 block w-full text-xs" disabled={disabled} onChange={e => { capture.setFile(e.target.files?.[0] || null); capture.setCaptured(false); }} /></label>
      <label htmlFor="muse-composer" className="block text-sm font-medium">Your question · edit the transcript before sending</label>
      <textarea id="muse-composer" ref={composer} maxLength={8000} rows={4} value={draft} disabled={disabled} onChange={e => setDraft(e.target.value)} placeholder="Speak a question or type here…" className="w-full rounded-xl border border-white/15 bg-[#111] p-4 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-teal-400/50 disabled:opacity-50" />
      {asrModel && <p className="text-xs text-stone-500">Transcript from {asrModel}. Review any names or timestamps before sending.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded-xl bg-teal-300 px-5 py-3 text-sm font-semibold text-black disabled:opacity-40" disabled={disabled || !draft.trim()} onClick={() => void send()}><Send className="inline mr-2 size-4" />{busy ? "Working…" : "Send to Muse"}</button>
        <button className={button} disabled={disabled} onClick={() => reset()}><RotateCcw className="inline mr-2 size-4" />New conversation</button>
        {needsRecovery && <button className={button} disabled={disabled} onClick={() => void recover()}>Check conversation</button>}
      </div>
      <p className="text-xs leading-5 text-stone-500">Transcribe sends audio to Meta. Send calls Muse using your stored investigation. Neither happens automatically. This assistant cannot generate reports or send email.</p>
      {(error || capture.error) && <p role="alert" className="text-sm text-amber-300">{error || capture.error}</p>}
    </section>
  </main>;
}
