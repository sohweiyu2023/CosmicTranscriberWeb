# Quick Start User Guide

1. Open the production Cosmic Transcriber Web URL and complete Cloudflare Access authentication.
2. Choose **Configure API key** and paste a dedicated OpenAI API key. The plaintext key is sent once over HTTPS to the Worker; it is not saved in browser storage or returned to page JavaScript.
3. Add one or more supported MP3, FLAC, MP4, MPEG, MPGA, M4A, OGG, WAV or WebM files by drag-and-drop or **Add files**.
4. Select a completed-file model. `GPT Transcribe` is the default general model. Choose the diarization model only when speaker labels are needed.
5. Optionally provide supported language hints, prompt/context and keywords. `GPT Transcribe` accepts multiple two-/three-letter language-code hints plus the documented regional Chinese forms; the other file models use a single two-letter language hint. Unsupported fields are disabled and also rejected by the server.
6. Review the dated cost estimate. You pay OpenAI directly through your own API account. Diarization is marked **Approx.** because its displayed per-minute figure is derived from currently published audio-token pricing rather than an OpenAI-published per-minute estimate.
7. Select TXT and/or Markdown, then start transcription. **Keep the tab open while an active V1 job is running.** Run-affecting settings and API-key replacement are intentionally locked until the job stops; Cancel remains available.
8. Download the per-file or combined output when complete.

If the browser closes, reopen the site, select the same source file, and use the same settings. The source is re-fingerprinted before compatible completed chunks are reused, and checkpoint reuse is also scoped to the currently authenticated Access user. The API key session may have expired and can be reconfigured without affecting transcript checkpoints.
