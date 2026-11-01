"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { API_BASE, getClientSessionId } from "@/lib/api";
import { recordingToWav, VOICE_MAX_SECONDS, VOICE_MAX_BYTES } from "@/lib/voice-audio";

type Result = { success: boolean; transcript: string; provider: string; model_id: string; language: string | null };

export default function VoiceTranscriptionTest() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [recordState, setRecordState] = useState<"idle" | "permission" | "recording" | "converting">("idle");
  const [seconds, setSeconds] = useState(0);
  const [playback, setPlayback] = useState("");
  const [captured, setCaptured] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const recordingBusy = recordState !== "idle";

  function release() {
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (timer.current) clearInterval(timer.current); timer.current = null;
  }
  function cancelCapture() {
    generation.current++;
    const active = recorder.current; recorder.current = null;
    if (active) {
      active.onstop = null; active.ondataavailable = null; active.onerror = null;
      if (active.state !== "inactive") { try { active.stop(); } catch { /* tracks still released */ } }
    }
    release();
  }
  useEffect(() => () => cancelCapture(), []);
  useEffect(() => {
    if (!file) { setPlayback(""); return; }
    const url = URL.createObjectURL(file); setPlayback(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function stopRecording() {
    const active = recorder.current;
    try {
      if (active?.state === "recording") { setRecordState("converting"); active.stop(); }
    } catch { cancelCapture(); setRecordState("idle"); setError("Recording could not be stopped. Please try again."); }
    finally { release(); }
  }

  async function startRecording() {
    if (busy || recordingBusy) return;
    setError(""); setResult(null); setSeconds(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof OfflineAudioContext === "undefined") {
      setError("Microphone recording is unsupported here. Use a current Safari/Chrome browser on localhost or HTTPS, or upload a WAV file."); return;
    }
    cancelCapture(); const ticket = generation.current;
    setRecordState("permission");
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (ticket !== generation.current) { input.getTracks().forEach(t => t.stop()); return; }
      stream.current = input;
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(t => MediaRecorder.isTypeSupported(t));
      const active = new MediaRecorder(input, mime ? { mimeType: mime } : undefined);
      recorder.current = active;
      const chunks: Blob[] = []; let size = 0;
      active.ondataavailable = event => {
        if (ticket !== generation.current) return;
        size += event.data.size;
        if (size > VOICE_MAX_BYTES) { cancelCapture(); setRecordState("idle"); setError("Recording is too large. Record a shorter clip."); return; }
        if (event.data.size) chunks.push(event.data);
      };
      active.onerror = () => { if (ticket === generation.current) { cancelCapture(); setRecordState("idle"); setError("Microphone recording failed. Please try again."); } };
      active.onstop = async () => {
        if (ticket !== generation.current) return;
        release(); recorder.current = null;
        setRecordState("converting");
        try {
          const wav = await recordingToWav(new Blob(chunks, { type: active.mimeType }));
          if (ticket === generation.current) { setFile(wav); setCaptured(true); }
        } catch {
          if (ticket === generation.current) setError("Could not convert this recording to a supported WAV. Try a shorter recording or upload a PCM WAV file.");
        } finally { chunks.length = 0; if (ticket === generation.current) setRecordState("idle"); }
      };
      active.start(1000); setFile(null); setCaptured(false); setRecordState("recording");
      const began = performance.now();
      timer.current = setInterval(() => {
        const elapsed = (performance.now() - began) / 1000;
        setSeconds(Math.min(VOICE_MAX_SECONDS, elapsed));
        if (elapsed >= VOICE_MAX_SECONDS) stopRecording();
      }, 200);
    } catch (e) {
      if (ticket !== generation.current) return;
      cancelCapture(); setRecordState("idle");
      const name = e instanceof DOMException ? e.name : "";
      setError(name === "NotAllowedError" ? "Microphone permission was denied. Allow microphone access or upload a WAV file."
        : name === "NotFoundError" ? "No microphone was found. Connect one or upload a WAV file."
        : "Unable to start the microphone. Check that it is available and try again.");
    }
  }

  async function transcribe() {
    if (!file || busy || recordingBusy) return;
    setError(""); setResult(null);
    if (!file.name.toLowerCase().endsWith(".wav")) { setError("Select a PCM WAV recording."); return; }
    if (!file.size || file.size > 25 * 1024 * 1024) { setError("Choose a nonempty WAV file no larger than 25 MiB."); return; }
    setBusy(true);
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch(`${API_BASE}/api/voice/transcribe`, {
        method: "POST", body: form, headers: { "X-Client-Session-ID": getClientSessionId() },
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.detail || "Transcription failed.");
      if (typeof data.transcript !== "string" || typeof data.provider !== "string" || typeof data.model_id !== "string")
        throw new Error("The backend returned an invalid transcription response.");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to reach the transcription service.");
    } finally { setBusy(false); }
  }

  return <main className="max-w-2xl mx-auto p-8 space-y-5 text-[#f4efe6]">
    <Link href="/dashboard" className="underline">Back to dashboard</Link>
    <h1 className="text-2xl font-bold">Voice Transcription Test</h1>
    <p>Manual test: mono, 16-bit PCM WAV at 16 or 24 kHz. Maximum 25 MiB and 10 minutes.</p>
    <p>Microphone access is requested only when you click Start Recording. Review playback before choosing Transcribe.</p>
    <div className="flex gap-3 flex-wrap">
      <button className="border rounded px-4 py-2 disabled:opacity-50" onClick={startRecording} disabled={busy || recordingBusy}>Start Recording</button>
      <button className="border rounded px-4 py-2 disabled:opacity-50" onClick={stopRecording} disabled={recordState !== "recording"}>Stop Recording</button>
      <button className="border rounded px-4 py-2 disabled:opacity-50" disabled={busy || (!file && !recordingBusy)} onClick={() => { cancelCapture(); setRecordState("idle"); setFile(null); setCaptured(false); setSeconds(0); setError(""); setResult(null); }}>Discard / Record Again</button>
    </div>
    <p role="status">{recordState === "recording" ? "● Microphone recording" : recordState === "permission" ? "Waiting for microphone permission" : recordState === "converting" ? "Converting recording to PCM WAV…" : "Microphone off"} · {Math.floor(seconds / 60)}:{String(Math.floor(seconds % 60)).padStart(2, "0")}</p>
    {captured && file && <p>Recorded format: mono · 16-bit PCM WAV · 16,000 Hz · {((file.size - 44) / 32000).toFixed(2)} seconds · {file.size.toLocaleString()} bytes</p>}
    {playback && <audio aria-label="Review recording" controls src={playback} />}
    <p>Transcribe sends this recording to the configured Meta provider and may consume API credits. Nothing is sent automatically.</p>
    <label className="block">WAV recording
      <input className="block mt-2" type="file" accept=".wav,audio/wav" disabled={busy || recordingBusy}
        onChange={e => { setFile(e.target.files?.[0] || null); setCaptured(false); setResult(null); setError(""); }} />
    </label>
    <button className="border rounded px-4 py-2 disabled:opacity-50" disabled={!file || busy || recordingBusy} onClick={transcribe}>
      {busy ? "Transcribing…" : "Transcribe"}
    </button>
    {busy && <p role="status">Waiting for transcription…</p>}
    {error && <p role="alert" className="text-amber-300">{error}</p>}
    {result && <section aria-label="Transcription result" className="space-y-3">
      <h2 className="font-bold">Transcript</h2>
      <p className="whitespace-pre-wrap">{result.transcript || "No speech was detected."}</p>
      <p>Provider: {result.provider} · Model: {result.model_id} · Language: {result.language || "Not reported"}</p>
    </section>}
  </main>;
}
