# Research Notes — verified 2026-08-10

These notes record changeable external assumptions used by Cosmic Transcriber Web 1.0.15. Recheck them at each release; source code/tests, not these prose notes, remain the enforced contract.

## OpenAI file transcription

Current official File transcription documentation says the Transcriptions API accepts files up to **25 MB** and recommends splitting larger recordings into chunks. Cosmic keeps its own smaller hard application ceiling and frame-aware MP3 splitting.

The completed-file allowlist is `gpt-transcribe`, `gpt-4o-transcribe-diarize`, `gpt-4o-transcribe`, and `gpt-4o-mini-transcribe`; realtime/live-only models are intentionally not exposed as completed-file choices. The diarization workflow uses `gpt-4o-transcribe-diarize` with `diarized_json`; current OpenAI material documents automatic/VAD chunking for longer diarization input and speaker-labelled segments.

The specialized File transcription guide documents language/context behavior more specifically than some generic parameter summaries. Cosmic follows the current model-specific guide plus the Windows 1.0.27 behavior, while letting OpenAI explicitly reject a syntactically valid language value it does not actually support.

Pricing shown by Cosmic is dated guidance, not a guarantee. The dedicated diarization model page currently publishes audio-token rates (input $2.50 / output $10.00 per 1M audio tokens), so Cosmic keeps any per-minute diarization figure labelled **Approx./derived** rather than presenting it as a directly published billing rate.

Primary sources retrieved 2026-08-10:
- https://developers.openai.com/api/docs/guides/speech-to-text
- https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize
- https://developers.openai.com/api/docs/pricing

No OpenAI transcription idempotency guarantee is assumed by Cosmic. Ambiguous post-dispatch failures therefore require explicit user confirmation before another paid attempt.

## Cloudflare Workers / Access / testing

Current Cloudflare static-assets documentation says `assets.run_worker_first` can be used when authentication must run before assets. Cosmic sets it to `true`, so Worker Access verification occurs before the application shell/assets.

Current Workers testing guidance distinguishes runtime-focused Vitest tests from whole-Worker integration using `createTestHarness()` against the production Wrangler build. The current lifecycle uses `server.listen()`, `server.reset()` when reusing a harness, and `server.close()` after the suite. Cosmic keeps both layers.

Cloudflare supports required Wrangler secrets. Current Wrangler documentation states `wrangler secret put` creates/deploys a Worker version, while `wrangler deploy --secrets-file` uploads secrets with a deployment. Cosmic's first-deploy helper uses the latter and deletes its temporary secret file in `finally`. All deployments use `--strict` to fail defensively on conflicting remote settings. Wrangler OAuth storage is also treated as a local-security concern: current Wrangler supports `login --use-keyring`, which on Windows keeps the encryption key in Windows Credential Manager instead of leaving the default OAuth credential file plaintext.

Rate-limit namespaces can share counters when the same `namespace_id` is reused, so staging/production Cosmic bindings use distinct IDs and deployment documentation requires a collision check against other Workers rather than modifying CiteLedger.

Primary sources retrieved 2026-08-10:
- https://developers.cloudflare.com/workers/testing/test-harness/get-started/
- https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
- https://developers.cloudflare.com/workers/configuration/compatibility-flags/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/workers/wrangler/commands/
- https://developers.cloudflare.com/changelog/post/2026-06-03-wrangler-keyring-credential-storage/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- https://developers.cloudflare.com/workers/platform/limits/

## Node / npm

Official Node release information retrieved 2026-08-10 lists **Node 24.19.0 as Latest LTS** and Node 26 as Current. Cosmic release certification therefore uses the reviewed floor `>=24.19.0 <25`: it stays on the LTS major while preventing certification with the older 24.14.1 patch seen in the latest Windows log.

Primary sources:
- https://nodejs.org/en/about/previous-releases
- https://nodejs.org/en/blog/release/v24.19.0
- https://nodejs.org/download/release/latest-v24.x/
- https://docs.npmjs.com/cli/v12/using-npm/changelog/
- https://docs.npmjs.com/cli/v12/using-npm/config/

Official npm documentation retrieved 2026-08-10 lists **npm 12.0.2 as Latest**. npm 12 supports Node `^24.15.0`, so it is compatible with Cosmic's Node 26.5.1 Current floor. Release certification therefore requires npm `>=12.0.2 <13`. npm 12 blocks dependency lifecycle scripts by default unless covered by the root `allowScripts` policy; `strict-allow-scripts=true` upgrades an unreviewed entry from blocked-with-warning to a hard install failure. npm 12 also makes unknown CLI flags fatal and offers `strict-npmrc`; Cosmic enables `strict-npmrc=true`. Direct dependencies are refreshed to registry `@latest` with scripts disabled, the exact lock is reviewed, and only approved lifecycle scripts are then run through `npm rebuild`.

## Playwright / Safari

Playwright browser binaries must match the installed Playwright version. Cosmic resolves the installed `@playwright/test` CLI directly instead of allowing an `npx` fallback to download another package. The release browser matrix covers Chromium, Firefox, WebKit, Mobile Safari emulation, installed Chrome and installed Edge on Windows.

Playwright WebKit is not branded Safari. A small real-macOS Safari acceptance remains a separate final gate.

Primary source retrieved 2026-08-10:
- https://playwright.dev/docs/browsers

## GitHub Actions

At review time, the current exact first-party releases used by CI are `actions/checkout@v7.0.1` and `actions/setup-node@v7.0.0`. Recheck on future releases rather than intentionally pinning an older major forever.

## Windows Node toolchain isolation — 2026-08-10

The latest 1.0.10 Windows evidence proved the portable Node 24.19.0/private npm 12.0.2 bootstrap itself works, but also exposed PowerShell command precedence: Node 24.19.0 bundles npm 11.17.0 and its `npm.ps1` was selected instead of the private npm 12 `npm.cmd`. Microsoft documents command precedence as significant when multiple commands share a name. 1.0.15 therefore keeps the isolated private toolchain but binds PowerShell `npm` explicitly to the exact private npm CLI rather than relying on filename-extension resolution.

The reviewed Windows release path downloads the official Node 24.19.0 portable ZIP and verifies Node's published SHA-256 before extraction:

- win-x64 ZIP: `57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73`
- win-x64 `node.exe`: `3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237`
- win-arm64 ZIP: `8502f4a50b458d4cc38ed8f2001556c2cd239d464920f74017926ccb1e1c157f`
- win-arm64 `node.exe`: `3958e4bb3f2d4ef37c938215dfc65a9d3c9d839b5060fec103bd2345fa78e951`

Primary sources:
- https://nodejs.org/en/blog/release/v24.19.0
- https://learn.microsoft.com/windows/dev-environment/javascript/nodejs-on-windows
- https://docs.npmjs.com/downloading-and-installing-node-js-and-npm

Node's v24 archive metadata lists npm **11.17.0** as bundled with Node 24.19.0, while npm's package page lists **12.0.2** as the current npm release. Cosmic intentionally tests with npm 12.0.2, so PowerShell activation must bypass the bundled npm 11 wrapper deterministically.

Additional primary sources:
- https://nodejs.org/en/download/archive/v24
- https://www.npmjs.com/package/npm?activeTab=versions
- https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_command_precedence?view=powershell-7.6
## workerd 1.20260811.1 lifecycle-script review (2026-08-12)

The fresh 1.0.15 registry resolution introduced `workerd@1.20260811.1`, so the release gate stopped before executing its lifecycle hook. The exact Cloudflare tag `v1.20260811.1` was independently reviewed before approval. Its wrapper package retains the `postinstall: node install.js` lifecycle. Cloudflare's release workflow generates `install.js` from `npm/lib/node-install.ts`; that routine selects the official platform-specific `@cloudflare/workerd-*` package, can fall back to installing/downloading the exact same Workerd version from the npm registry if the optional platform package is absent, optionally replaces the JavaScript shim with the binary on supported non-Windows installs, and validates the resulting binary version. Approval therefore remains exact-version and fail-closed: `workerd@1.20260811.1: true`; the superseded `workerd@1.20260804.1` decision and its version-specific audit/mutation expectations are replaced rather than wildcarded. The separately required `workerd@1.20260801.1` approval remains exact because that version is still present elsewhere in the resolved graph.

