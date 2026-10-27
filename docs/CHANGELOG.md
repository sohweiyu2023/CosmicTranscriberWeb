## 1.2.0 - current source and upgrade qualification

- Supports MP3, FLAC, MP4, MPEG, MPGA, M4A, OGG, WAV and WebM with bounded upload validation and frame-aware MP3 preparation.
- Improves browser workflow, export, cancellation/error handling and receipt-bound staging acceptance accounting, preserving no automatic paid retries and privacy-safe evidence.
- Repairs offline synthetic-smoke replay from source archives using an explicit local history repository and cleanup on checkout failure.
- Refreshes reviewed development tool minimums to the versions already exercised by main CI: Cloudflare Vitest plugin 1.4.8 and Wrangler 4.153.0; application/runtime dependency changes require separate evidence.
- Documents cross-run nine-format staging acceptance for application source `88ee4a6`, while retaining the exact genuine Safari FAIL/WAIVED qualification. The historical 18 October production installation and the pending upgrade are distinct; this entry does not announce a new production deployment.

## 1.1.1 — candidate

- Repairs the V1.1 partial deployment configuration deadlock: Access and registry helpers now validate only their own permitted post-certification edits; the final full deployment verifier runs only after both are configured.
- Validates Cloudflare Access AUD tags at the documented 64-character maximum and validates administrator email input before any remote D1 creation.
- Fixes the guided Windows deployment flow to authenticate the intended Cloudflare account, configure the D1 registry, then run final deployment verification for both staging and production.
- Hardens Access identity parsing with canonical email syntax validation and adds helper-level administrator authorization as defense in depth.
- Makes transcription outcome accounting idempotent per attempt, transactionally updates counters, retries background D1 persistence, logs terminal accounting failures without exposing sensitive content, and prevents a failed retry from downgrading an already-successful chunk/job.
- Makes each accepted transcription `attemptId` server-side single-use before the OpenAI dispatch, so duplicate delivery cannot silently become a second paid request; duplicate-attempt responses are conservatively marked billing-ambiguous.
- Commits logical job creation, the single-use attempt receipt, chunk/user/model counters and job state in one D1 batch before OpenAI; retries reconcile `jobs_started` from durable job rows so pre-dispatch accounting failure cannot leave a partially-counted paid attempt.
- Makes the mutation harness fail closed unless every baseline safeguard is green, preventing a pre-existing safeguard failure from masquerading as successful mutation detection.
- Corrects current release handoff output/documentation so existing V1.1 installations use upgrade deployment rather than the greenfield `deploy:first:*` path.
- Refreshes the 1.1.1 reviewed release runtime/toolchain to current Node 26.7.0 while retaining current npm 12.0.2; Windows x64/ARM64 archive and `node.exe` hashes are pinned to Node's published SHA-256 values.
- Excludes generated workspace `.log` files from source packaging and checksum manifests so stale certification transcripts/local runner paths cannot be shipped as release source.
- Prevents `wrangler d1 create` from auto-editing or auto-provisioning the certified Wrangler configuration by explicitly disabling config update, auto-create, and experimental provisioning during registry creation.
- Adds additive D1 migration `0002_usage_result_receipts.sql`, regression tests, static safeguards and mutation tests for the repaired paths.
- This editable candidate is **not certified**. No V1.1.1 release ZIP may be distributed until the complete release matrix passes.

## 1.1.0 — candidate

- Adds a Cloudflare Access-bound, privacy-minimal D1 user registry and administrator dashboard without introducing application passwords or storing OpenAI API keys/audio/transcript contents server-side.
- Adds `open`, `approval`, and `closed` registration modes plus `pending`, `active`, and `blocked` user states; existing active users continue when new registration is closed.
- Adds server-side administrator authorization using verified Access email identities configured through deployment-only `ADMIN_EMAILS`; configured administrators are protected from accidental UI lockout.
- Adds user, job/chunk, declared bytes/audio-duration, and per-model operational usage statistics designed for administration rather than billing reconciliation.
- Adds Access subject/email reconciliation for the documented case where Cloudflare issues a new `sub` for the same verified email, while failing closed if an existing subject is paired with a different verified email.
- Adds separate staging/production D1 registries, release-certified migrations-before-deploy, provenance-safe registry configuration helpers, dedicated admin rate limiting, Worker/integration/E2E coverage, and new static/mutation safeguards.
- Fixes the stale guided first-deploy Node check so `FIRST-DEPLOY-WINDOWS.ps1` now requires the same reviewed Node 26.5.1/npm 12.0.2 toolchain as `WINDOWS-TOOLCHAIN.ps1` and package engines.
- Full dependency-backed Linux, Windows, macOS/real-Safari and certified-ZIP release gates remain mandatory before 1.1.0 can be published.

## 1.0.15 — candidate

- Distinguishes explicit user cancellation from browser/network transport interruption so transport failures no longer falsely appear as user cancellation, while preserving conservative ambiguous-billing protection after dispatch.
- Adds explicit, confirmation-gated reruns for completed files under the current model/settings. Exact completed checkpoints can be reused safely; changed model/settings create a distinct paid-work identity.
- Adds live elapsed `Uploading / waiting for OpenAI` status for long transcription/diarization operations and explicit retry status after an ambiguous request is accepted.
- Upgrades downloaded diagnostics to privacy-safe schema v2 with bounded event history, page/run/file references, phase timing, checkpoint/retry state, transport classifications, MP3 recovery counters, user confirmation decisions, Worker/OpenAI request IDs, browser connectivity/visibility state, and server-version metadata while excluding filenames, credentials, prompts, transcripts, audio contents, source fingerprints and principal identifiers.
- Adds pre-dispatch structured Worker correlation logs with app request ID, pseudonymous user, job/attempt/chunk identifiers, model, declared bytes and elapsed time; staging uses full custom-log and trace sampling for debugging while automatic invocation logs remain disabled, and production remains sampled.
- Adds regression tests and mutation guards for transport-vs-cancel classification, ambiguous retry, slow-request progress, safe completed-file reruns, diagnostics privacy/bounds, structured correlation logs, and environment-bounded observability.

## 1.0.14 — candidate

- Replaces overly strict MP3 byte-for-byte rejection with decoder-tolerant frame recovery: leading/trailing non-audio bytes are ignored, trustworthy MPEG frame runs are resynchronized after embedded junk, and a bounded partial terminal frame can be retained in the final chunk for tolerant decoders.
- Adds regression coverage modeled on real staging failures: an otherwise valid recording with a 1,600-byte `0xFF` trailer and a recording whose final MPEG frame is 128 bytes short. The original private user recordings are not committed.
- Keeps empty/no-audio inputs rejected, preserves frame ordering, keeps diarization overlap-free, retains Xing/Info/VBRI rewriting, increments the chunker revision so old checkpoints cannot cross the changed chunk semantics, and requires decoder-backed verification of generated chunks.
- Refreshes every direct dependency to registry `@latest` during certification and reruns the complete Linux, macOS/WebKit/real-Safari, Windows private-toolchain/branded-browser, Worker, integration, mutation, package and independent ZIP gates.

## 1.0.13 — candidate

- Refreshes every direct production and development dependency from registry `@latest` before certification; `package.json` stays upgrade-friendly while the resulting `package-lock.json` is frozen only as evidence for this release.
- Moves the reviewed release runtime to Node 26.5.1 Current with npm 12.0.2 and refreshes the private Windows x64/ARM64 hash-pinned toolchain.
- Makes guided deployment confirmation tokens case-insensitive and whitespace-tolerant while still requiring the explicit token.
- Requires full Linux browser/Worker/integration, macOS WebKit + real Safari, and Windows private-toolchain + branded-browser + release-package gates before promotion.

# Changelog

## Web 1.0.13 — 2026-08-10 deterministic npm PowerShell binding repair

### Repairs driven by the user's 1.0.10 Windows evidence
- The 1.0.10 paste-once launcher and PowerShell parser/named-parameter preflight passed. Portable Node 24.19.0 downloaded/extracted and the private npm 12.0.2 prefix installation completed, but bare PowerShell `npm` resolved Node's bundled `npm.ps1` and therefore reported npm 11.17.0. Certification stopped safely before dependency, Worker, browser or deployment stages.
- Retained the non-invasive official-hash-pinned portable Node 24.19.0 + private npm 12.0.2 design, but removed PowerShell command-name ambiguity. `Install-CosmicNpmCommandBinding` now binds session-local `npm` to the exact private `node.exe` + `node_modules/npm/bin/npm-cli.js`.
- Child npm scripts still receive the private npm prefix first on PATH, preserving correct `cmd.exe` resolution without modifying global Node/npm.
- Added dual npm verification: the absolute private CLI and the bound PowerShell `npm` must both report 12.0.2, and the PowerShell command must be the intended Function.
- Added a dedicated Node functional test, static safeguard, and adversarial mutations for removing the binding, falling back to ambient npm, and skipping exact CLI verification.

### Whole-system re-audit
- Rechecked Access JWT verification, BYOK AES-GCM cookie/AAD/rotation, fixed OpenAI upstream and server-owned Authorization, redirect blocking, model/parameter contracts, response/request bounds, billing-ambiguity policy, rate-limit fail-closed behavior, authenticated static assets, CSP/CORS/DOM boundaries, checkpoint/source/chunk identity, MP3/ID3/VBR continuity, queue/output/resource ceilings, Unicode/Markdown/bidi hardening, dependency lifecycle-script controls, release provenance, Cloudflare exposure settings and Wrangler strict deployment. No additional core transcription/security blocker was found.
- Rechecked current Node/npm, OpenAI transcription and Cloudflare Access/Wrangler assumptions against current primary sources.

### Audit evidence actually run on final 1.0.13 audit source
- Version consistency PASS.
- 76 syntax/type-shape files PASS.
- 23 local module links PASS.
- 167/167 static/security/release safeguards PASS.
- 88/88 Node/ffprobe functional tests PASS.
- 224/224 mutations PASS.
- Secret scan PASS.
- Dependency-backed PowerShell/Worker/integration/Playwright/npm-audit/release-certification gates remain intentionally unclaimed until the user's Windows run.

## Web 1.0.10 — 2026-08-10 deterministic private Windows release toolchain

### Repairs driven by the user's 1.0.9 Windows evidence
- The shipped PowerShell parser/named-parameter preflight passed, proving the 1.0.6/1.0.7 launcher classes were closed. Certification then stopped before dependency tests because the machine still resolved `node` to v25.6.1 after winget installed Node 24.19.0. This is a PATH/multiple-install conflict, not a Cloudflare/OpenAI failure.
- Removed system Node/npm mutation from the guided release flow. `FIRST-DEPLOY-WINDOWS.ps1` and `RELEASE-WINDOWS.ps1` now activate a private per-user release toolchain from `WINDOWS-TOOLCHAIN.ps1`.
- The toolchain downloads the official Node 24.19.0 portable Windows x64/ARM64 ZIP directly from nodejs.org, verifies the release-published SHA-256 before extraction, installs npm 12.0.2 only into a private prefix, prepends both paths for the release process tree, and leaves global Node/npm/PATH untouched.
- Added exact `.nvmrc` 24.19.0 alignment and cross-platform static/mutation safeguards for the official URLs, x64/ARM64 hashes, no-winget policy, private npm prefix and PATH-prepend activation.
- Unified audit/certified `RELEASE_MANIFEST.json` dependency-lock metadata into a structured schema; certified manifests are now bound to the exact lock SHA-256 and public npm registry, and ZIP round-trip verification checks those claims.

### Whole-system re-audit
- Rechecked Access JWT validation, BYOK AES-GCM session binding/rotation, OpenAI upstream ownership and redirect blocking, model/parameter allowlists, billing-ambiguity retry policy, rate limits, authenticated static assets, CSP/CORS/DOM sinks, checkpoint/source/chunk integrity, MP3 continuity, output/Markdown/bidi hardening, resource ceilings, deployment provenance, dependency lifecycle-script policy and Cloudflare exposure controls. No new core transcription/security blocker was found in this pass.
- Rechecked current official Node/OpenAI/Cloudflare assumptions and direct dependency releases used by the candidate.

### Audit evidence actually run on final 1.0.10 audit source
- Dependency-free/source validation and final ZIP round-trip are recorded in `AUTOMATED_TEST_RESULTS.md`.
- Windows-only private-toolchain bootstrap, Worker/integration/Playwright/npm-audit/release-certification gates remain intentionally unclaimed until the user's Windows run.

## Web 1.0.9 — 2026-08-10 paste-once workflow and runtime-version fidelity

### Repairs driven by the user's 1.0.8 Windows evidence
- The user first tried to `cd` into the ZIP path, then accidentally reused an obsolete chat launcher containing invalid `New-Item -LiteralPath`. The actual 1.0.8 guided runner was never executed.
- Added a version-specific `PASTE-ONCE-WINDOWS.ps1` template that auto-finds the audit ZIP, extracts into a fresh timestamped directory with valid `New-Item -Path`, and delegates only to the shipped fail-closed guided runner.
- Added static/mutation protections against `New-Item -LiteralPath` and non-unique run directories in that launcher.

### Fresh whole-tree audit repairs
- Found incomplete 1.0.8 version consistency: Worker/integration runtime test configs and E2E mock responses still identified 1.0.6. Extended the version gate to production **and runtime-test** surfaces plus the paste-once launcher.
- Added three Node regression tests covering current coherence, stale Worker runtime metadata, stale E2E runtime responses and stale launcher version.
- Corrected the mutation harness so the new paste-once script is included in mutation snapshots; this prevents unrelated mutations from receiving false-positive detection due to a missing file.

### Audit evidence actually run on final 1.0.9 audit source
- Version consistency PASS.
- 75 syntax/type-shape files PASS.
- 23 local module links PASS.
- 162/162 static/security/release safeguards PASS.
- 83/83 Node/ffprobe functional tests PASS.
- 206/206 mutations PASS.
- Secret scan PASS.
- Dependency-backed 1.0.9 PowerShell/Worker/integration/Playwright/npm-audit/release-certification gates remain a Windows certification step and are **not** claimed PASS here.

## Web 1.0.8 — 2026-08-10 launcher-parameter and version-consistency hardening

### Repairs driven by the user's 1.0.7 Windows evidence
- Retired the chat-provided outer launcher after it failed twice on invalid `New-Item -LiteralPath`; the supported first-release entry is now the shipped `FIRST-DEPLOY-WINDOWS.ps1` after normal ZIP extraction.
- Upgraded PowerShell validation from AST parsing alone to parser **plus named-parameter binding** validation for release scripts. The validator self-tests by deliberately feeding `New-Item -LiteralPath` and must reject it.
- Added the same syntax/parameter preflight inside the guided runner before certification/deployment work.
- Fresh whole-tree inspection also found 1.0.7 version drift: package/manifest were 1.0.7 while Wrangler/browser/UI version metadata remained 1.0.6. Added mandatory cross-file version-consistency validation to normal validation, release verification and Windows certification.
- Added regression mutations for named-parameter validation, guided preflight, `APP_VERSION` drift and removal of the version gate.

### Audit evidence actually run on final 1.0.8 audit source
- Version consistency PASS.
- 74 syntax/type-shape files PASS.
- 23 local module links PASS.
- 160/160 static/security/release safeguards PASS.
- 80/80 Node/ffprobe functional tests PASS.
- 201/201 mutations PASS.
- Secret scan PASS.
- Dependency-backed 1.0.8 PowerShell/Worker/integration/Playwright/npm-audit/release-certification gates remain a Windows certification step and are **not** claimed PASS here.

## Web 1.0.7 — 2026-08-10 PowerShell parser and retry-launcher repair

### Repairs driven by the user's 1.0.6 Windows evidence
- Fixed the parse-blocking `"$Environment:"` interpolation in `FIRST-DEPLOY-WINDOWS.ps1`; the runner now uses `${Environment}:`.
- Added `scripts/validate-powershell.mjs`, which invokes PowerShell's AST parser over packaged `.ps1` files. Windows release verification now requires this parser gate, and the guided runner also preflights its deployment scripts.
- Hardened the recommended one-paste launcher: it first moves PowerShell outside old work trees and creates a fresh uniquely named run directory, so retries cannot fail by trying to delete the shell's current directory.
- Added regression safeguards and mutations for invalid variable-colon interpolation, skipped PowerShell parser preflight, and removal of the parser release gate.

### Audit evidence actually run on final 1.0.7 audit source
- 73 syntax/type-shape files PASS.
- 23 local module links PASS.
- 157/157 static/security/release safeguards PASS.
- 80/80 Node/ffprobe functional tests PASS.
- 197/197 mutations PASS.
- Secret scan PASS.
- Dependency-backed 1.0.7 PowerShell-parser/Worker/integration/Playwright/npm-audit/release-certification gates remain a Windows certification step and are **not** claimed PASS here.

## Web 1.0.6 — 2026-08-09 integration-harness and guided-runner repair

### Repairs driven by the user's 1.0.5 Windows evidence
- Preserved the successful Node/npm modernization: the actual certification process correctly saw Node 24.19.0 and npm 12.0.2, refreshed dependencies, reported zero npm-audit vulnerabilities, passed the source/Node gate and passed Worker runtime tests.
- Repaired the one remaining whole-Worker integration path after the Windows run reached 8/9: integration requests now use the direct Worker returned by `createTestHarness().getWorker()` for the MSW-integrated path, matching Cloudflare's documented pattern.
- Added exact mock-hit counters for both the successful OpenAI transcription mock and redirect mock. A generic post-dispatch network failure can no longer accidentally satisfy the redirect test or hide a missed success mock.
- Added `FIRST-DEPLOY-WINDOWS.ps1`, a true one-process certification + first-deployment runner. It re-detects Node after `winget`, refuses to leave certification on a non-zero exit, guides Access configuration, uses Wrangler keyring login, requires staging acceptance, and requires a separate explicit production confirmation.
- Retired the long chat-style interactive mega-paste as the preferred workflow. The 1.0.5 transcript demonstrated that queued interactive statements can continue after `throw`, producing misleading later PASS text even though the underlying candidate/deployment guards still fail closed.

### Audit evidence actually run on final 1.0.6 audit source
- 72 syntax/type-shape files PASS.
- 23 local module links PASS.
- 154/154 static/security/release safeguards PASS.
- 80/80 Node/ffprobe functional tests PASS.
- 194/194 mutations PASS.
- Secret scan PASS.
- Dependency-backed 1.0.6 Worker/integration/Playwright/npm-audit/release-certification gates remain a Windows certification step and are **not** claimed PASS here.

## Web 1.0.5 — 2026-08-09 release-flow and supply-chain hardening

### Repairs driven by the user's 1.0.4 PowerShell transcript
- Kept the reviewed Node floor at `>=24.19.0 <25` after rechecking the official Node 26 Current release; the user's Node 24.14.1 was legitimately below that gate.
- Made the release boundary operationally obvious: successful `RELEASE-WINDOWS.ps1` now extracts the certified ZIP into a fresh same-version `deploy` directory, verifies its lock/`releaseReady:true` manifest, prints the exact path and prints the safe next commands.
- Added a provenance-safe `configure-access.mjs` helper plus `configure:access:staging` / `configure:access:production`; it refuses an audit candidate, changes only the permitted Access team-domain/AUD fields, re-verifies provenance/configuration and restores the original file on failure.
- Updated Wrangler login guidance to opt into `--use-keyring`, which uses Windows Credential Manager for the key protecting Wrangler OAuth credentials.
- Rewrote troubleshooting/deployment instructions so a failed release gate explicitly means **stop**; missing deploy folder, lockfile and Wrangler after that failure are documented as cascade effects rather than separate fixes.

### npm install-script hardening
- Moved the release toolchain to **npm >=12.0.2 <13**, the current stable npm major compatible with Node 24.19. npm 12 blocks unreviewed dependency lifecycle scripts by default; project `.npmrc` keeps `strict-allow-scripts=true` so any unreviewed script is a hard install error rather than a blocked-with-warning condition.
- Dependency refresh now resolves/updates with `--ignore-scripts`, verifies every lockfile package with an install script against the reviewed allow/deny policy, and only then runs `npm rebuild`; this prevents newly resolved lifecycle code from executing before review.
- Added `strict-npmrc=true` so unknown project npm configuration is a hard error, plus static/mutation coverage proving the npm 12 floor, install-script enforcement, and npmrc typo protection cannot be silently removed.

### Audit evidence actually run on final 1.0.5 audit source
- 72 syntax/type-shape files PASS.
- 23 local module links PASS.
- 152/152 static/security/release safeguards PASS.
- 80/80 Node/ffprobe functional tests PASS.
- 188/188 mutations PASS.
- Secret scan PASS.
- Dependency-backed 1.0.5 Worker/integration/Playwright/npm-audit/release-certification gates remain a Windows certification step and are **not** claimed PASS here.

## Web 1.0.4 — 2026-08-09 adversarial audit candidate

### Repairs driven by the latest Windows 1.0.3 run
- Fixed release verification to invoke project scripts through `npm run`; 1.0.3 incorrectly ran `npm deps:lock:verify`.
- Reworked the whole-Worker success mock so resolver assertions cannot be translated by production code into a misleading 502 billing-ambiguous network failure. Multipart request parsing/Authorization assertions now happen after a deterministic mock response.
- Replaced interactive `npx playwright install` maintenance with the already-installed `@playwright/test` CLI.
- Added `RELEASE-WINDOWS.ps1`, a true one-process fail-fast certification runner; it validates the certified ZIP's own manifest rather than trusting the editable tree.
- Raised release Node floor to `>=24.19.0 <25`, the current reviewed Node 26.5.1 Current floor.

### Paid-work / checkpoint / queue safety
- Checkpoints are source/settings/chunk/principal scoped; presentation-only export toggles do not invalidate paid work.
- Added per-chunk SHA-256 and immediate pre-dispatch chunk/source rehash.
- All billing-critical IndexedDB failures hard-stop; DB abort/error paths close handles.
- Completed rows cannot silently re-enter a paid run; failed prepared rows are safely rerunnable but remain duplicate-protected.
- Combined export requires a complete homogeneous transcription-settings set; partial/mixed-settings queues never produce a misleading combined artifact.
- 429 retry uses bounded `Retry-After` + jitter and is cancellable; ambiguous post-dispatch failures remain explicit-confirmation only.

### MP3 / output / UI / resources
- Added exact ID3v1 trailer support while arbitrary trailing garbage still fails.
- Ported desktop-safe surrogate-pair prompt/context truncation.
- Added Windows-parity 25M transcript-char/file, 10k queue-file and 1k combined-file ceilings.
- Bounded FileList ingestion before copy/sort, strictly validates numeric run controls, and sanitizes bidi/format controls in filenames/log-safe values.
- Clear/remove/cancel/presentation-only changes keep completed downloads/counters correct; export strings are generated lazily.
- Markdown transcript output neutralizes active Markdown/HTML syntax; TXT preserves transcript text.
- API-key replacement and run-affecting controls lock during active work.

### Access / API / privacy
- Worker-first Access protects the static app shell/assets. Access validation requires RS256/issuer/audience/app type/sub/exp/sane iat and a canonical Cloudflare Access team domain.
- BYOK remains AES-256-GCM in a `__Host-` HttpOnly/Secure/Strict cookie with origin/subject/key-version AAD and rotation.
- `/api/key/test` rejects unknown JSON fields before upstream work.
- Upstream correlation values are bounded/control-safe; automatic Cloudflare invocation logs are disabled while sampled redacted custom logs remain.

### Release / supply chain / deployment
- Current-direct-dependency check is release blocking; dependency refresh resolves with lifecycle scripts disabled until the lock-wide policy passes; npm install-script positive approvals are exact-version pinned and optional `fsevents` anomaly is explicitly denied.
- CI uses exact reviewed `actions/checkout@v7.0.1` and `actions/setup-node@v7.0.0`; Playwright CI workers serialize.
- Release packaging occurs in an isolated staging tree; the editable candidate is never stamped release-ready.
- ZIP root is canonical `CosmicTranscriberWeb-1.0.4/`; UTF-8 filename/Unicode/CRC/SHA/secret checks run after fresh extraction.
- Release mode runs `npm ci` and the complete release gate again after extraction; failed release archives are deleted.
- Deployment requires `releaseReady:true`, exact certified source-file membership/checksums and a normalized Wrangler fingerprint; only the four private Access team/AUD values may differ.
- Every deployment rebuilds and inspects `dist/public` from certified source before Wrangler runs.
- First deployment generates a separate environment master secret inside `try/finally`, uploads it atomically with code, and all deploys use installed Wrangler with `--strict`.

### Audit evidence actually run in the audit sandbox
- 70 syntax/type-shape files PASS.
- 23 local module links PASS.
- 147 static/security/release safeguards PASS.
- 76/76 Node/ffprobe functional tests PASS.
- 182/182 mutations PASS.
- Secret scan PASS.
- Dependency-backed 1.0.4 Worker/integration/Playwright/npm-audit gates remain a Windows certification step and are not claimed PASS here.

## Web 1.0.1 — 2026-08-09 audit candidate
First repaired Web candidate: Unicode-safe package writer, initial Worker/integration modernization, stronger checkpoint/retry/model tests and Cloudflare deployment preparation. Windows execution subsequently exposed the compatibility-date and stale E2E test-contract failures corrected in 1.0.4.

## Web 1.0.0 — 2026-08-08 source candidate
Initial Cloudflare/Mode-B Web architecture, frame-safe MP3 pipeline, IndexedDB checkpoints, diarization, bounded streaming, static/mutation tests and deployment documentation.

- Corrected diarization cost provenance: the UI now labels its per-minute figure as **Approx. derived** because OpenAI currently publishes audio-token rates for the diarization model rather than a direct per-minute estimate.
