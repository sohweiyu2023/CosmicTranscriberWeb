# Cosmic Transcriber Web 1.2.0

Start with the [beginner setup and user guide](docs/BEGINNERS_GUIDE.md). Production 1.2.0 was deployed on 18 October 2026 with the [disclosed owner-accepted desktop Safari verification exception](docs/RELEASE_EXCEPTION_2026-10-18.md). Strict desktop Safari remains FAIL/unverified. This editable source is an audit candidate, not a certified deployment ZIP; the archived production package and deployment have their own provenance.

**Secure, cross-platform audio transcription in your browser — powered by OpenAI and protected by Cloudflare.**

Cosmic Transcriber Web is the browser-based edition of Cosmic Transcriber. It is designed for people who want high-quality file transcription and optional speaker diarization without installing a native desktop app. Audio is prepared in the browser, sent through a tightly scoped Cloudflare Worker to OpenAI's Transcriptions API, then returned to the browser as downloadable TXT or Markdown.

**Bring your own OpenAI API key (BYOK).** There is no deployment-owner API-key fallback.

> **Release status:** pre-release certification. Audit candidates are non-deployable. A verified staging candidate has `releaseReady:false` with `certificationLevel:staging` and can deploy only to staging. Production requires a separately certified release ZIP after all platform and live staging gates pass.

## Highlights

- **Cross-platform web UI** for Windows, macOS, Linux and modern tablet/desktop browsers.
- **OpenAI completed-file transcription** with the current supported transcription models, including speaker diarization.
- **Cloudflare Access authentication** before the application and API routes are served.
- **V1.1 user/admin controls:** Cloudflare Access-backed registration modes, pending/active/blocked accounts, a privacy-minimal D1 registry, administrator controls and aggregate usage statistics.
- **BYOK session protection:** the Worker encrypts the user's OpenAI key into a short-lived `__Host-` HttpOnly/Secure/SameSite=Strict cookie; plaintext keys are not persisted in browser storage.
- **Tolerant frame-aware MP3 processing** for ID3/Xing/Info/VBRI, CBR/VBR and real-world recoverable files, including non-audio trailers, embedded junk and decoder-tolerable terminal partial frames.
- **Resume-safe checkpoints** in IndexedDB, bound to authenticated user, source fingerprint, settings and per-chunk SHA-256 identity.
- **Duplicate-charge safeguards:** ambiguous post-dispatch failures are not silently retried.
- **TXT and Markdown output**, including speaker-aware diarized transcripts.
- **No V1 server-side audio archive:** source audio and transcript contents are not intentionally persisted in R2, D1 or KV. V1.1 uses D1 only for privacy-minimal user/admin and aggregate usage metadata.
- **Release-grade testing:** static/adversarial checks, mutation tests, Worker runtime tests, whole-Worker integration tests, Playwright, branded Chrome/Edge, macOS WebKit and real Safari WebDriver acceptance.

## Audio formats

V1.2 accepts MP3, FLAC, MP4, MPEG, MPGA, M4A, OGG, WAV and WebM. MP3 uses frame-aware preparation and chunking; the other formats use whole-file uploads within the application upload limit.

**MPGA requires complete MPEG Layer III audio.** The Worker checks every frame before recording a dispatch attempt. MPEG 1, 2 and 2.5, CBR/VBR, a bounded leading ID3v2 tag and an optional final ID3v1 tag are supported. Layer I/II, mixed-layer streams, changing MPEG version/sample rate, truncated frames and leading or trailing junk are rejected before upstream dispatch. This stricter rule applies specifically to MPGA.

For accepted MPGA, the Worker uses `audio.mp3` as the upstream multipart filename with `audio/mpeg` MIME. The audio bytes, original MPGA format metadata, checkpoints and billing-attempt identity are preserved; the filename alias does not transcode the audio or create another attempt.

## Architecture

```text
Browser
  │
  │  local validation / MP3 frame-safe preparation / SHA-256
  ▼
Cloudflare Access
  ▼
Cloudflare Worker
  │
  │  fixed upstream + server-owned Authorization
  ▼
OpenAI Transcriptions API
  │
  ▼
Cloudflare Worker
  ▼
Browser checkpoints / merge / TXT or Markdown download
```

The Worker is deliberately **not** a generic proxy: the OpenAI upstream is fixed to `https://api.openai.com/v1/audio/transcriptions`, redirects are rejected, allowed models and request shapes are enforced server-side, and the browser cannot choose arbitrary upstream hosts or paths.

## Security and privacy design

- Cloudflare Access JWTs are independently verified for signature, issuer, audience, algorithm, expiry and required claims.
- `/api/key/session` accepts the user's OpenAI key once over HTTPS and immediately protects it with AES-256-GCM.
- The BYOK cookie is bound by authenticated subject, configured application origin and key version.
- Source and prepared-chunk hashes are rechecked immediately before paid dispatch.
- Completed paid work is checkpointed before later cancellation can discard it.
- Only explicitly safe retry cases are automated; uncertain post-dispatch states are surfaced to the user instead of risking a duplicate transcription charge.
- Staging and production disable `workers.dev`, Preview URLs and local authentication bypass.
- Automatic Cloudflare invocation logs are disabled by configuration; custom operational logging is sampled/redacted.

See [`docs/BYOK_SECURITY_DESIGN.md`](docs/BYOK_SECURITY_DESIGN.md), [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md), and [`docs/PRIVACY_DATA_FLOW.md`](docs/PRIVACY_DATA_FLOW.md) for the detailed model.

## Relationship to Cosmic Transcriber for Windows

The mature Windows desktop application remains a separate product and behavioral reference. Cosmic Transcriber Web does **not** replace the native Windows edition and is not a native macOS port. Its goal is to provide the same core transcription workflow through standards-based browsers, with Windows Chrome/Edge and macOS Safari/Chrome as primary targets.

The prospective [browser release policy](docs/BROWSER_RELEASE_POLICY.md) requires Windows Chromium/Firefox/Chrome/Edge, all Linux engines, and macOS WebKit/mobile emulation/Chrome plus actual Safari native-file acceptance. Previous Windows Playwright WebKit native-file failures remain recorded failures; the revised policy must independently pass and does not change deployment eligibility.

## Release and deployment model

The repository deliberately separates editable/audit source from certified deployable source.

- Audit candidates remain `releaseReady:false`.
- Certification resolves and reviews one dependency lock graph, verifies dependency lifecycle-script policy, audits dependencies, executes the complete test matrix, builds the frontend, packages an isolated source ZIP, freshly extracts it, performs `npm ci`, and reruns release verification.
- Staging accepts a verified ZIP with `releaseReady:false` and `certificationLevel:staging`; production requires `releaseReady:true` and `certificationLevel:release`. Audit candidates satisfy neither condition.
- Deployment provenance permits only the environment-specific Access team-domain/AUD, configured admin-email list, and private D1 database identifier to change after certification.

For this existing deployment upgrade, use the certification-only [`RELEASE-WINDOWS.ps1`](RELEASE-WINDOWS.ps1), then follow [the staging and production upgrade sequence](docs/CLOUDFLARE_DEPLOYMENT.md). Use the shipped private Node/npm toolchain. Do not use `FIRST-DEPLOY-WINDOWS.ps1` or `deploy:first:*`: those bootstrap paths are not the existing-upgrade route and may replace BYOK secrets.

## Cloudflare deployment targets

- **Staging:** `transcriber-staging.awakeningtoreality.com`
- **Production:** `transcriber.awakeningtoreality.com`

Both environments are intended to sit behind separate Cloudflare Access applications/AUD values. Production deployment is gated behind successful staging validation and an explicit operator confirmation.

See [`docs/CLOUDFLARE_DEPLOYMENT.md`](docs/CLOUDFLARE_DEPLOYMENT.md) and [`docs/CLOUDFLARE_ACCESS_SETUP.md`](docs/CLOUDFLARE_ACCESS_SETUP.md).

## Documentation

Useful starting points:

- [`docs/QUICK_START.md`](docs/QUICK_START.md) — quick start
- [`docs/USER_MANUAL.md`](docs/USER_MANUAL.md) — user workflow
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture
- [`docs/BYOK_SECURITY_DESIGN.md`](docs/BYOK_SECURITY_DESIGN.md) — API-key/session security
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) — threat model
- [`docs/TESTING_GUIDE.md`](docs/TESTING_GUIDE.md) — test strategy
- [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) — release gates
- [`docs/CLOUDFLARE_DEPLOYMENT.md`](docs/CLOUDFLARE_DEPLOYMENT.md) — staging/production deployment
- [`docs/SAFARI_MAC_ACCEPTANCE.md`](docs/SAFARI_MAC_ACCEPTANCE.md) — Safari acceptance criteria

## Current development release

The active development/certification line is **1.2.0**. The project is being held to an all-green rule: no user-facing release ZIP is published until every defined release gate that can validate it has actually executed and passed.
