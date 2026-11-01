/** PCM encoder shared by browser conversion and offline contract tests. */
export const VOICE_RATE = 16000;
export const VOICE_MAX_SECONDS = 600;
export const VOICE_MAX_BYTES = 25 * 1024 * 1024;

export function encodeVoiceWav(channels: Float32Array[]): ArrayBuffer {
  const length = channels[0]?.length || 0;
  if (!length || channels.some(c => c.length !== length)) throw new Error("Recording contains no valid audio samples.");
  if (length > VOICE_RATE * VOICE_MAX_SECONDS) throw new Error("Recording exceeds 10 minutes. Record a shorter clip.");
  const bytes = 44 + length * 2;
  if (bytes > VOICE_MAX_BYTES) throw new Error("Recording exceeds 25 MiB.");
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, bytes - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_RATE, true); view.setUint32(28, VOICE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    let sample = 0;
    for (const channel of channels) {
      if (!Number.isFinite(channel[i])) throw new Error("Recording contains invalid audio samples.");
      sample += channel[i] / channels.length;
    }
    sample = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

export async function recordingToWav(blob: Blob): Promise<File> {
  // decodeAudioData resamples to the context's sample rate. Offline context has
  // no live audio device, open tracks, or close() lifecycle to manage.
  const context = new OfflineAudioContext(1, 1, VOICE_RATE);
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  if (decoded.sampleRate !== VOICE_RATE) throw new Error("Browser could not resample audio to 16 kHz.");
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  return new File([encodeVoiceWav(channels)], "microphone-recording.wav", { type: "audio/wav" });
}
