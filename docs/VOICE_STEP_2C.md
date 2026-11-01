# Voice Intelligence Step 2C — microphone capture

Changed files: frontend/app/voice-test/page.tsx, frontend/lib/voice-audio.ts (new),
frontend/tests/test_voice_audio.mjs (new), docs/VOICE_STEP_2C.md (new).
Earlier uncommitted work is preserved. No backend, environment, dependency or
database changes were needed.

The existing /voice-test page now has Start/Stop, permission/recording/conversion
states, elapsed time, discard/retry, audio playback, WAV upload and separate explicit
Transcribe action. Start alone requests microphone access. Nothing uploads when
recording stops. All tracks are stopped and timers cleared after stopping, errors,
discard or unmount. Pending permission/decode results are invalidated by generation
tokens so discarded/unmounted recordings cannot reappear. Playback URLs are revoked
on replacement/unmount. Permission denied, missing-device and unsupported-browser
failures have actionable messages. Compressed capture is bounded to 25 MiB; a timer
stops capture at ten minutes, and conversion independently rejects oversized duration.

MediaRecorder selects a runtime-supported MP4 or WebM/Opus container, or the browser
default. That container is never renamed to WAV. Native OfflineAudioContext at
16 kHz decodes the complete recording and resamples it. Channels are averaged;
samples are clipped and quantized into signed 16-bit little-endian PCM. A new
RIFF/WAVE header and actual audio data are encoded into a File of type audio/wav.
Output is mono, exactly 16000 Hz, two bytes/sample, with a 44-byte header. Maximum
10-minute PCM output is 19,200,044 bytes, within the backend's 25 MiB limit.

Compatibility references inspected:
- https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static
- https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData
- https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext

These APIs support modern Safari/Chromium usage, with runtime format detection.
Localhost or HTTPS and microphone permission are required. Codec availability and
decode success still depend on the browser/device. No claim of physical Safari
microphone testing is made. No AudioWorklet, external recorder or new dependency.

Verification:
- Explicit Node audio test file: 6 passed, zero failures/skips. Checks header,
  format fields, sample mixing/clipping, duration, bounds, native-decoder target
  configuration and output MIME. Browser decoder is mocked in the conversion test.
- Actual generated WAV was passed to MetaVoiceProvider validation in a Python
  subprocess with its transport blocked by a mock. Validation reached the blocked
  client, proving the format was accepted without inference.
- Full isolated backend: 358 run, 351 passed, 7 skipped, zero failures/errors.
- Production webpack build including TypeScript: passed.
- Browser page inspection confirmed initial mic-off state, Start enabled,
  Stop/Discard/Transcribe disabled without audio. No controls were clicked.
- Backend /health and frontend /voice-test returned HTTP 200; transcription CORS
  preflight allowed http://127.0.0.1:3000. No transcription request was submitted.

Both pre-existing local processes were preserved: backend 8000, frontend webpack
development server 3000. Page: http://127.0.0.1:3000/voice-test .

Limitations for manual testing: physical recording, permission flow, device removal,
playback and live transcription remain for the owner. Browser background throttling
can delay the stop timer; decoded audio exceeding ten minutes is rejected, never
submitted. Codec padding can also push a recording at the exact boundary over the
limit; use a shorter clip if that occurs. Long recordings consume browser memory.
No background or automatic Meta requests, TTS, chatbot, incident tools or emails.
No credentials were printed, no .env edits, no deployment, commit or push.

Owner acceptance, November 1, 2026: the owner subsequently confirmed that manual
microphone recording, playback, WAV conversion and the live transcription flow
work. This confirmation supersedes the pending manual-test status above; device
removal and exact-duration/background-throttling edge cases are not claimed tested.
No additional live request was made for commit validation.
