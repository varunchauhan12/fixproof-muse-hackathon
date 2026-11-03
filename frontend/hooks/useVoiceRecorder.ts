"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startVoiceMeter, VOICE_METER_BARS } from "@/lib/voice-meter";
import { requestVoiceInput, microphoneError } from "@/lib/voice-input";
import { recordingToWav, VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from "@/lib/voice-audio";

/** Shared click-to-record recorder. Recording/conversion never submits audio or chat. */
export function useVoiceRecorder(busy = false, maxSeconds = VOICE_MAX_SECONDS) {
  const [file, setRecordingFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [recordState, setRecordState] = useState<"idle" | "permission" | "recording" | "converting">("idle");
  const [seconds, setSeconds] = useState(0);
  const [playback, setPlayback] = useState("");
  const [captured, setCaptured] = useState(false);
  const [audioBars, setAudioBars] = useState<number[]>(Array(VOICE_METER_BARS).fill(0));
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState("");
  const [inputLabel, setInputLabel] = useState("");
  const [signalLevel, setSignalLevel] = useState(0);
  const [meterAvailable, setMeterAvailable] = useState(false);
  const [inputMuted, setInputMuted] = useState(false);
  const audioContext = useRef<AudioContext | null>(null);
  const refreshMicrophones = useCallback(async () => {
    try {const devices=await navigator.mediaDevices?.enumerateDevices?.(); if(devices)setMicrophones(devices.filter(device=>device.kind==='audioinput'));}
    catch { /* Recording still works if device enumeration is restricted. */ }
  }, []);
  useEffect(()=>{const devices=navigator.mediaDevices;devices?.addEventListener?.('devicechange',refreshMicrophones);return()=>devices?.removeEventListener?.('devicechange',refreshMicrophones);},[refreshMicrophones]);
  const meter = useRef<(() => void) | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const permissionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    setSignalLevel(0); setMeterAvailable(false); setInputMuted(false);
    const context=audioContext.current; audioContext.current=null;
    if(context&&context.state!=='closed')void context.close().catch(()=>{});
    stream.current?.getTracks().forEach(track => {track.onmute=null;track.onunmute=null;track.onended=null;track.stop();}); stream.current = null;
    if (timer.current) clearInterval(timer.current); timer.current = null;
    if(permissionTimer.current)clearTimeout(permissionTimer.current);permissionTimer.current=null;
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
      if (recorder.current && recorder.current.state === "recording") {
        setRecordState("converting");
        try {
          if (typeof recorder.current.requestData === "function") {
            recorder.current.requestData();
          }
        } catch { /* requestData fallback */ }
        recorder.current.stop();
      }
    } catch {
      cancelCapture();
      setRecordState("idle");
      setError("Recording could not be stopped. Please try again.");
    }
  }, [cancelCapture]);
  const startRecording = useCallback(async () => {
    if (busy || activeCapture.current) return;
    setError(""); setSeconds(0); setSignalLevel(0); setInputLabel("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof OfflineAudioContext === "undefined") {
      setError("Microphone recording is unsupported here. Use a current Safari/Chrome browser on localhost or HTTPS, or upload a WAV file."); return;
    }
    cancelCapture(); activeCapture.current = true;
    const ticket = generation.current;
    setRecordState("permission");
    permissionTimer.current=setTimeout(()=>{
      if(ticket!==generation.current)return;
      cancelCapture();setRecordState('idle');
      setError('Still waiting for microphone permission. Click Allow in the browser prompt. If no prompt appears, open this page in Chrome or Safari and allow Microphone in the site settings, then try again.');
    },20000);
    try {
      // Resume from the click gesture, before awaiting the permission prompt.
      try {
        const Audio=window.AudioContext||(window as Window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
        if(Audio){audioContext.current=new Audio();void audioContext.current.resume().catch(()=>{});}
      } catch { /* Meter failure must not prevent recording. */ }
      const input=await requestVoiceInput(selectedMic);
      if (ticket !== generation.current) { input.getTracks().forEach(track => track.stop()); return; }
      if(permissionTimer.current)clearTimeout(permissionTimer.current);permissionTimer.current=null;
      stream.current = input;
      const track=input.getAudioTracks()[0];
      if(!track||track.readyState==='ended')throw new DOMException('No live microphone','NotReadableError');
      setInputLabel(track.label||'Default microphone');setInputMuted(track.muted);
      track.onmute=()=>{if(ticket===generation.current)setInputMuted(true);};
      track.onunmute=()=>{if(ticket===generation.current)setInputMuted(false);};
      track.onended=()=>{if(ticket===generation.current){cancelCapture();setRecordState('idle');setError('The microphone disconnected. Reconnect it or choose another input.');}};
      void refreshMicrophones();
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(t => MediaRecorder.isTypeSupported(t));
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
          if (chunks.length === 0) {
            setError("No audio data was captured. Please speak into your microphone and try again.");
            return;
          }
          const wav = await recordingToWav(new Blob(chunks, { type: active.mimeType }));
          if (ticket === generation.current) { setFile(wav); setCaptured(true); }
        } catch (failure) {
          if (ticket === generation.current) setError(failure instanceof Error ? failure.message : "Could not convert this recording to WAV. Try another microphone or a shorter recording.");
        } finally {
          chunks.length = 0;
          if (ticket === generation.current) { activeCapture.current = false; setRecordState("idle"); }
        }
      };
      active.start(250);
      meter.current = startVoiceMeter(input, ({bars,level}) => {
        if (ticket === generation.current && active.state === "recording") {setSignalLevel(level);setAudioBars(previous => previous.every((value, index) => value === bars[index]) ? previous : bars);}
      }, available=>{if(ticket===generation.current)setMeterAvailable(available);}, audioContext.current || undefined);
      setFile(null); setCaptured(false); setRecordState("recording");
      const began = performance.now();
      timer.current = setInterval(() => {
        const elapsed = (performance.now() - began) / 1000; setSeconds(Math.min(maxSeconds, elapsed));
        if (elapsed >= maxSeconds) stopRecording();
      }, 200);
    } catch (e) {
      if (ticket !== generation.current) return;
      cancelCapture(); setRecordState("idle");
      setError(microphoneError(e));
    }
  }, [busy, cancelCapture, release, stopRecording, setFile, selectedMic, refreshMicrophones, maxSeconds]);
  return { microphones, selectedMic, setSelectedMic, inputLabel, signalLevel, meterAvailable, inputMuted, refreshMicrophones, audioBars, file, setFile, error, setError, recordState, recordingBusy: recordState !== "idle", seconds,
    playback, captured, setCaptured, startRecording, stopRecording, discard };
}
