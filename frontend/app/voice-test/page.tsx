"use client";

import { useState } from "react";
import Link from "next/link";
import { getClientSessionId } from "@/lib/api";
import { transcribeRecording } from "@/lib/muse-assistant";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";

type Result = { success: boolean; transcript: string; provider: string; model_id: string; language: string | null };

export default function VoiceTranscriptionTest() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const { file, setFile, error, setError, recordState, recordingBusy, seconds,
    playback, captured, setCaptured, startRecording, stopRecording, discard } = useVoiceRecorder(busy);

  async function transcribe() {
    if (!file || busy || recordingBusy) return;
    setError(""); setResult(null);
    if (!file.name.toLowerCase().endsWith(".wav")) { setError("Select a PCM WAV recording."); return; }
    if (!file.size || file.size > 25 * 1024 * 1024) { setError("Choose a nonempty WAV file no larger than 25 MiB."); return; }
    setBusy(true);
    try {
      const data = await transcribeRecording(file, getClientSessionId());
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
      <button className="border rounded px-4 py-2 disabled:opacity-50" disabled={busy || (!file && !recordingBusy)} onClick={() => { discard(); setResult(null); }}>Discard / Record Again</button>
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
