/** PCM encoder shared by browser conversion and offline contract tests. */
export const VOICE_RATE = 16000;
export const VOICE_CAPTURE_RATE = 24000;
export const VOICE_MAX_SECONDS = 600;
export const VOICE_MAX_BYTES = 25 * 1024 * 1024;

export function encodeVoiceWav(channels: Float32Array[], rate = VOICE_RATE): ArrayBuffer {
  if(rate!==16000&&rate!==24000)throw new Error("Unsupported recording sample rate.");
  const length = channels[0]?.length || 0;
  if (!length || channels.some(c => c.length !== length)) throw new Error("Recording contains no valid audio samples.");
  if (length > rate * VOICE_MAX_SECONDS) throw new Error("Recording exceeds 10 minutes. Record a shorter clip.");
  const bytes = 44 + length * 2;
  if (bytes > VOICE_MAX_BYTES) throw new Error("Recording exceeds 25 MiB.");
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, bytes - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, length * 2, true);

  // Downmix to mono and measure peak amplitude
  const mono = new Float32Array(length);
  let maxPeak = 0;
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const channel of channels) {
      const val = channel[i];
      if (!Number.isFinite(val)) throw new Error("Recording contains invalid audio samples.");
      sum += val;
    }
    const sample = sum / channels.length;
    mono[i] = sample;
    const abs = Math.abs(sample);
    if (abs > maxPeak) maxPeak = abs;
  }

  // Automatic gain normalization:
  // If the recording is quiet (peak < 0.70) but above noise floor (peak >= 0.005),
  // boost the signal up to 0.85 peak so the ASR model detects speech reliably.
  const gain = maxPeak >= 0.005 && maxPeak < 0.70 ? Math.min(10.0, 0.85 / maxPeak) : 1.0;

  for (let i = 0; i < length; i++) {
    const amplified = Math.max(-1, Math.min(1, mono[i] * gain));
    view.setInt16(44 + i * 2, Math.round(amplified * (amplified < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

export async function recordingToWav(blob: Blob): Promise<File> {
  // decodeAudioData resamples to the context's sample rate. Offline context has
  // no live audio device, open tracks, or close() lifecycle to manage.
  const context = new OfflineAudioContext(1, 1, VOICE_CAPTURE_RATE);
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  if (decoded.sampleRate !== VOICE_CAPTURE_RATE) throw new Error("Browser could not resample audio to 24 kHz.");
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  let energy=0,mean=0,count=0;
  for(const channel of channels)for(const sample of channel){if(!Number.isFinite(sample))throw new Error('The recording contains invalid samples. Try another microphone.');mean+=sample;count++;}
  mean/=count||1;
  for(const channel of channels)for(const sample of channel)energy+=(sample-mean)**2;
  if(!count||Math.sqrt(energy/count)<0.00001)throw new Error('No microphone signal was captured. Check the selected microphone, mute switch and system input volume, then record again.');
  return new File([encodeVoiceWav(channels, VOICE_CAPTURE_RATE)], "microphone-recording.wav", { type: "audio/wav" });
}
