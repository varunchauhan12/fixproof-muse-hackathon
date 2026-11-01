# Voice Intelligence Step 2A — controlled live smoke test

Historical test result, recorded for the voice checkpoint. No request was repeated
during commit validation.

One explicitly authorized request was sent through MetaVoiceProvider.transcribe to
the configured Meta ASR endpoint. Local speech tools produced a non-sensitive
7.997-second mono 16-bit PCM WAV at 16 kHz (259,994 bytes). Credentials were available
and were not printed. Temporary audio was cleaned up.

HTTP result: 200. Structured parsing succeeded. Provider: muse. Model:
muse-voice-transcribe-1.0. Request latency: 3.955 seconds. Exactly one request,
no retries. No database, incident, email, environment or application changes.

Spoken sentence:

> This is a FixProof voice transcription test. Investigate the suspicious sports footage and summarize the matching timestamps.

Returned transcript:

> This is a fixproof voice transcription test. Investigate the suspicious spots footage and summarize the matching time stamps..

The result was close, not exact: sports became spots, timestamps was split, and
capitalization/punctuation differed. No compatibility or entitlement error occurred.
This demonstrates one successful request, not general transcription accuracy.
