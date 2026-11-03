"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startVoiceMeter, VOICE_METER_BARS } from "@/lib/voice-meter";
import { recordingToWav, VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from "@/lib/voice-audio";

/** Shared push-to-talk recorder. Recording/conversion never submits audio or chat. */
export function useVoiceRecorder(busy = false) {
  const [file, setRecordingFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [recordState, setRecordState] = useState<"idle" | "permission" | "recording" | "converting">("idle");
  const [seconds, setSeconds] = useState(0);
  const [playback, setPlayback] = useState("");
  const [captured, setCaptured] = useState(false);
  const [audioBars, setAudioBars] = useState<number[]>(Array(VOICE_METER_BARS).fill(0));
  const meter = useRef<(() => void) | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const activeCapture = useRef(false);
  const playbackUrl = useRef("");
  const setFile = useCallback((value: File | null) => {
    if (playbackUrl.current) URL.revokeObjectURL(playbackUrl.current);
    playbackUrl.current = value ? URL.createObjectURL(value) : "";
    setRecordingFile(value); setPlayback(playbackUrl.current);
  }, []);
  const release = useCallback(() => {
    meter.current?.(); meter.current = null;
    setAudioBars(Array(VOICE_METER_BARS).fill(0));
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (timer.current) clearInterval(timer.current); timer.current = null;
  }, []);
  const cancelCapture = useCallback(() => {
    generation.current++;
    const active = recorder.current; recorder.current = null;
    if (active) {
      active.onstop = null; active.ondataavailable = null; active.onerror = null;
      if (active.state !== "inactive") { try { active.stop(); } catch { /* release tracks below */ } }
    }
    activeCapture.current = false; release();
  }, [release]);
  const discard = useCallback(() => {
    cancelCapture(); setFile(null); setCaptured(false); setRecordState("idle"); setError("");
  }, [cancelCapture, setFile]);
  useEffect(() => () => {
    cancelCapture();
    if (playbackUrl.current) URL.revokeObjectURL(playbackUrl.current);
  }, [cancelCapture]);
  const stopRecording = useCallback(() => {
    try {
      if (recorder.current?.state === "recording") { setRecordState("converting"); recorder.current.stop(); }
    } catch { cancelCapture(); setRecordState("idle"); setError("Recording could not be stopped. Please try again."); }
    finally { release(); }
  }, [cancelCapture, release]);
  const startRecording = useCallback(async () => {
    if (busy || activeCapture.current) return;
    setError(""); setSeconds(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof OfflineAudioContext === "undefined") {
      setError("Microphone recording is unsupported here. Use a current Safari/Chrome browser on localhost or HTTPS, or upload a WAV file."); return;
    }
    cancelCapture(); activeCapture.current = true;
    const ticket = generation.current;
    setRecordState("permission");
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (ticket !== generation.current) { input.getTracks().forEach(track => track.stop()); return; }
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
        release(); recorder.current = null; setRecordState("converting");
        try {
          const wav = await recordingToWav(new Blob(chunks, { type: active.mimeType }));
          if (ticket === generation.current) { setFile(wav); setCaptured(true); }
        } catch {
          if (ticket === generation.current) setError("Could not convert this recording to a supported WAV. Try a shorter recording or upload a PCM WAV file.");
        } finally {
          chunks.length = 0;
          if (ticket === generation.current) { activeCapture.current = false; setRecordState("idle"); }
        }
      };
      active.start(1000);
      meter.current = startVoiceMeter(input, ({bars}) => {
        if (ticket === generation.current && active.state === "recording") setAudioBars(previous => previous.every((value, index) => value === bars[index]) ? previous : bars);
      });
      setFile(null); setCaptured(false); setRecordState("recording");
      const began = performance.now();
      timer.current = setInterval(() => {
        const elapsed = (performance.now() - began) / 1000; setSeconds(Math.min(VOICE_MAX_SECONDS, elapsed));
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
  }, [busy, cancelCapture, release, stopRecording, setFile]);
  return { audioBars, file, setFile, error, setError, recordState, recordingBusy: recordState !== "idle", seconds,
    playback, captured, setCaptured, startRecording, stopRecording, discard };
}
