# Cosmic Transcriber Web

**Secure, cross-platform audio transcription in your browser — powered by OpenAI and protected by Cloudflare.**

Cosmic Transcriber Web is the browser-based edition of Cosmic Transcriber. It is designed for high-quality audio-file transcription with optional speaker diarization, without requiring a native desktop installation.

Audio is prepared in the browser, sent through a tightly scoped Cloudflare Worker to OpenAI's Transcriptions API, and returned as downloadable TXT or Markdown. The app uses **Bring Your Own OpenAI API Key (BYOK)** — there is no deployment-owner API-key fallback.

## Highlights

- OpenAI completed-file transcription, including speaker diarization
- Cloudflare Access authentication before application/API access
- Encrypted, short-lived BYOK sessions with no plaintext API-key persistence in browser storage
- Frame-aware MP3 validation and chunking
- Resume-safe, user-scoped transcription checkpoints
- Safeguards against silent retries after billing-ambiguous failures
- TXT and Markdown transcript export
- Windows Chrome/Edge and macOS Safari/Chrome as primary browser targets
- Automated security, mutation, Worker, integration, browser, Windows, macOS and real-Safari release gates

## Status

**Pre-release certification is in progress.** Audit/source candidates remain deliberately non-deployable until the complete release test matrix passes. A user-facing release ZIP is only produced after all defined release gates are green.
