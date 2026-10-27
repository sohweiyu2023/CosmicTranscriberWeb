# Architecture

## Baselines
- Functional/behavioral control: Cosmic Transcriber for Windows 1.0.27.
- Structural reference only: wake-call-cloudflare-v5.4.19.
- Web version: independent semantic version `1.2.0`; diagnostics expose both Web version and desktop behavioral baseline.

## Data path

```text
Browser
  streaming source SHA-256
  MP3: frame-safe bounded chunk materialization
  FLAC/MP4/MPEG/MPGA/M4A/OGG/WAV/WebM: validated whole-file body
    ↓ same-origin HTTPS
Cloudflare Access edge gate
    ↓
Worker verifies Access JWT
  decrypts identity-bound BYOK cookie
  validates bounded metadata + actual body bytes
  constructs multipart stream
    ↓ fixed upstream
OpenAI POST /v1/audio/transcriptions
    ↓ bounded response
Worker (safe diagnostics only)
    ↓
Browser validates result
  checkpoint in IndexedDB
  lazy TXT / Markdown / complete-only combined download
```

## Desktop-to-Web mapping
| Windows behavior | Web implementation |
|---|---|
| DPAPI API-key storage | AES-GCM encrypted short-lived HttpOnly cookie, Access-sub bound |
| Open Output Folder | TXT/Markdown/combined downloads |
| Local checkpoint file | IndexedDB integrity-checked checkpoint |
| Work lock | UI single-run gate + D1 single-use attempt receipts before upstream dispatch; separate tabs/devices may create distinct paid attempts |
| MP3 frame parser | Browser Blob-slice parser port preserving frame/VBR invariants |
| Desktop dialogs | Native `<dialog>`/accessible status UI |
| Desktop dropdowns | Native HTML `<select>` controls |

## Pipeline invariants carried from Windows
1. Re-SHA256 the full source immediately before any billable request.
2. Never split a valid MP3 frame.
3. Keep first metadata carrier where Layer III bit-reservoir safety requires it; rewrite VBR counters for chunk-local media.
4. Diarization uses no preroll and speakers remain part-scoped.
5. A successful paid chunk is checkpointed before cancellation can discard it.
6. Previous-context checkpoint reuse is chain-sensitive.
7. Redirects are not followed for credential-bearing OpenAI calls.
8. OpenAI response is bounded and protocol-validated.
9. Logs/diagnostics exclude audio, transcript, prompt, API key, cookies and Access tokens.

## Storage
Server-side V1: no R2/D1/KV/DO audio or transcript persistence. Browser: non-secret preferences + completed checkpoint data only. Every checkpoint is bound to a pseudonymous Worker-derived Access-principal scope, so an authenticated user cannot reuse another Access user's cached transcript merely by selecting identical source/settings in the same browser profile. Presentation-only download options are excluded from paid-work identity.

## Resource budget
Application audio ceiling: 24,000,000 bytes per source body, under OpenAI's documented 25 MB file maximum. Worker uses Streams rather than full-body `formData()`/`arrayBuffer()`. OpenAI response ceiling: 4 MiB. Browser aggregate transcript ceiling: 25,000,000 characters per file; queue ceiling: 10,000 files; complete combined export ceiling: 1,000 files. Export strings are generated lazily on click instead of retained as duplicate transcript copies. Cloudflare Workers memory is currently documented as 128 MB; production concurrency/CPU measurements remain a deployment acceptance gate because they cannot be honestly inferred from source alone.

## External assumptions

See [the dated verification register](EXTERNAL_ASSUMPTIONS.md). Historical reference links below do not imply every assumption has been reverified for this checkout.
- OpenAI file transcription guide and fixed endpoint behavior: https://developers.openai.com/api/docs/guides/speech-to-text
- OpenAI Audio Transcriptions API reference: https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create
- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- OpenAI diarization model pricing basis: https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize
- OpenAI API-key guidance: https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety
- Cloudflare Access JWT validation: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- Cloudflare Worker Streams: https://developers.cloudflare.com/workers/runtime-apis/streams/
- Wrangler config/secrets: https://developers.cloudflare.com/workers/wrangler/configuration/ and https://developers.cloudflare.com/workers/configuration/secrets/
- Worker-first Static Assets authentication: https://developers.cloudflare.com/workers/static-assets/binding/
- Workers rate limiting: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Workers testing: https://developers.cloudflare.com/workers/testing/
- Preview URLs: https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/
- Rollbacks: https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- Playwright browsers: https://playwright.dev/docs/browsers

## V1.1 authenticated user registry

V1.1 adds a privacy-minimal authorization/administration layer after Cloudflare Access and before BYOK or paid transcription routes:

```text
Cloudflare Access JWT
  ↓ independent signature/issuer/audience/claim verification
verified subject + verified email
  ↓
D1 USER_DB account resolution
  ↓ active/admin authorization
BYOK/session/transcription APIs
```

Static assets remain Access-gated without a D1 read for each asset. API requests resolve the Cosmic account. BYOK setup, key testing and transcription require an active account; administrator endpoints require a configured administrator identity. `DELETE /api/key/forget` remains available to authenticated users so an inactive user can clear their browser credential session.

Staging and production have different `USER_DB` databases. The registry stores user/status/timestamp and aggregate operational usage metadata only; source audio, transcript bodies, filenames, prompts and OpenAI keys remain outside D1. See `ADMIN_USER_MANAGEMENT.md`.
