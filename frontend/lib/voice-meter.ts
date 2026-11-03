/** Local-only microphone metering. No recording, upload, inference or playback. */
export const VOICE_METER_BARS = 10;
export const VOICE_NOISE_FLOOR = 0.0015;

export function measureVoiceAudio(samples: Float32Array, spectrum: Uint8Array, sampleRate: number) {
  if (!samples.length) return {level: 0, bars: Array<number>(VOICE_METER_BARS).fill(0)};
  // Remove DC offset so a nonzero constant signal is still treated as silence.
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length);
  if (!Number.isFinite(rms) || rms < VOICE_NOISE_FLOOR) {
    return {level: 0, bars: Array<number>(VOICE_METER_BARS).fill(0)};
  }
  const level = Math.min(1, Math.max(0, Math.log10(rms / VOICE_NOISE_FLOOR) / 2));
  // Log-spaced frequency bands, constrained to the actual available spectrum.
  const bars = Array.from({length: VOICE_METER_BARS}, (_, i) => {
    const low = 100 * (40 ** (i / VOICE_METER_BARS));
    const high = 100 * (40 ** ((i + 1) / VOICE_METER_BARS));
    const start = Math.max(0, Math.floor(low * spectrum.length * 2 / sampleRate));
    const end = Math.min(spectrum.length, Math.max(start + 1, Math.ceil(high * spectrum.length * 2 / sampleRate)));
    let peak = 0;
    for (let bin = start; bin < end; bin++) peak = Math.max(peak, spectrum[bin] / 255);
    return Math.min(1, peak * Math.min(1, level * 4));
  });
  return {level, bars};
}

/** Meter the existing stream; failures never prevent recording or invent activity. */
export function startVoiceMeter(stream: MediaStream, onChange: (value: ReturnType<typeof measureVoiceAudio>) => void, onAvailability: (available:boolean)=>void = ()=>{}, existingContext?:AudioContext): () => void {
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let frame: number | null = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true; onAvailability(false);
    if (frame !== null) cancelAnimationFrame(frame);
    source?.disconnect(); analyser?.disconnect();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  };
  try {
    const Audio = window.AudioContext || (window as Window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!Audio && !existingContext) {onAvailability(false);return stop;}
    context = existingContext || new Audio();
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.25;
    source.connect(analyser); // Deliberately no connection to speakers.
    const samples = new Float32Array(analyser.fftSize);
    const spectrum = new Uint8Array(analyser.frequencyBinCount);
    let last = -Infinity;
    const sample = (now: number) => {
      if (stopped) return;
      if (now - last >= 50 && context?.state === 'running' && analyser) {
        last = now;
        analyser.getFloatTimeDomainData(samples);
        analyser.getByteFrequencyData(spectrum);
        onChange(measureVoiceAudio(samples, spectrum, context.sampleRate));
      }
      frame = requestAnimationFrame(sample);
    };
    // Resume may be needed after the microphone permission prompt in Safari.
    onAvailability(context.state==='running');
    void context.resume().then(()=>{if(!stopped)onAvailability(context?.state==='running');}).catch(() => stop());
    frame = requestAnimationFrame(sample);
  } catch { stop(); }
  return stop;
}
