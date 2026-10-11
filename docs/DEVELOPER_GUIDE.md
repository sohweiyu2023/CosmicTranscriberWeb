# Developer Guide

## Layout
- `src/` Worker security/routing/OpenAI relay.
- `public/` static frontend; no framework/service worker/runtime CDN.
- `public/js/mp3.js` frame parser/chunker.
- `public/js/checkpoint.js` browser checkpoint integrity/identity.
- `tests/node/` dependency-light protocol/audio/security tests.
- `tests/worker/` Cloudflare-runtime unit tests.
- `tests/integration/` current `createTestHarness()` + MSW whole-Worker tests.
- `tests/e2e/` Playwright browser/UI/XSS/storage tests.
- `scripts/` audit, mutation, secret scan, build/deploy verification, checksums/package.

## Coding security rules
No generic upstream URL. Do not copy incoming headers wholesale. Do not add `innerHTML` for untrusted content. Do not add remote scripts/fonts. Do not store key/cookie/JWT in Web Storage/IndexedDB/logs. Do not convert the 24MB request to `formData()` or `arrayBuffer()`. Preserve `redirect:"error"`. New client settings require server validation and checkpoint-identity review. Decide explicitly whether a setting changes the paid transcription request or is only presentation: presentation-only settings must not invalidate paid checkpoints. Run-affecting settings and BYOK replacement stay disabled during an active job because the job uses a captured settings/key session snapshot.

## MP3 changes
Any parser/chunker change requires CBR/VBR/ID3v2/ID3v1/trailing-junk/leading-junk/resynchronization/truncated/corrupt fixtures, exact logical frame ordering and ffprobe decodability of every generated chunk. Increment `MP3_CHUNKER_REVISION` whenever the produced/accepted chunk semantics change so old checkpoints fail closed. Pay special attention to Layer III reservoir behavior and Xing/Info/VBRI carrier rewriting.

## Billing-sensitive changes
A successful response must be checkpointed before cancellation is honored. Do not automatically retry an error after upstream dispatch unless the current OpenAI API explicitly documents safe idempotency for this endpoint. No such guarantee was assumed for 1.0.15.
