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

## Development mode

V1.2 uses **Fast Development Mode**: risk-based F0–F3 feedback during iteration, followed by an unchanged full F4 release-certification boundary. Fast mode reduces redundant test work but never weakens billing, security, provenance, browser/platform, staging, or fresh-ZIP release requirements.

The non-certifying fast-feedback workflow is `.github/workflows/dev-fast.yml`; the deliberately fail-closed release guard is `.github/workflows/certify.yml`. See `docs/V1.2_FAST_DEVELOPMENT_MODE.md` for the operating rules.

## Status

**Pre-release certification is in progress.** Audit/source candidates remain deliberately non-deployable until the complete release test matrix passes. V1.2 remains `releaseReady:false`, production V1.1.1 remains untouched, and a user-facing certified release ZIP is only produced after all defined F4 release gates are green.
