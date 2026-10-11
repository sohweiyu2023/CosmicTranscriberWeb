# Testing Guide — Cosmic Transcriber Web 1.1.1

## Evidence discipline

Never call a release gate PASS unless it actually ran successfully on the named artifact. The editable 1.1.1 candidate is **not release-certified**. During candidate authoring, the dependency-free validator has passed version consistency, syntax/module checks, **214 static/security/release safeguards**, secret scanning, **109 Node/ffprobe functional tests**, and **308/308 mutation safeguards**. These local checks do not substitute for the required Node 26.7.0 dependency-backed Worker, integration, browser, Windows release, macOS real-Safari and fresh-certified-ZIP gates.

The 1.0.15 release immediately preceding this candidate completed the full Linux + macOS WebKit/real Safari + Windows branded-browser/full-release + independent certified-ZIP matrix. V1.1 must independently repeat that matrix after resolving the current registry-latest dependency graph; prior 1.0.15 evidence is advisory only.

## Windows first release — preferred one-command path

From the extracted audit-candidate project root in PowerShell 7 run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\FIRST-DEPLOY-WINDOWS.ps1
```

This is intentionally a **real script process**, not a long interactive paste. It activates the private reviewed Node/npm toolchain, calls the certification-only `RELEASE-WINDOWS.ps1`, and does not enter Access/Cloudflare deployment stages unless that child process really exits 0. A failure exits the guided script 1 and prints `STOPPED — DO NOT CONTINUE TO A LATER STAGE`.

The script first validates the PowerShell deployment/toolchain scripts, activates the private exact Node 26.7.0/npm 12.0.2 toolchain and enforces public-registry/strict install-script prerequisites, then performs scripts-disabled dependency resolution, lock-wide install-script review/rebuild, clean `npm ci`, browser installation and `npm run package:source`. Normal package creation itself runs complete release verification before ZIP creation and again after fresh extraction. On success the PowerShell script also extracts the certified ZIP into a fresh `deploy\CosmicTranscriberWeb-1.1.1` directory and prints its exact path, so you should not invent or pre-create the deployment path.

## Individual gates for debugging only

If the one-command runner fails and you need to isolate the failing layer:

```powershell
npm run validate
npm run test:worker
npm run test:integration
npm run test:e2e:core
npm run test:e2e:branded
npm run build:inspect
npm run audit:secrets
npm run release:verify
```

`test:integration` builds first and uses Cloudflare `createTestHarness()` against the Wrangler production build/config. The suite starts the harness, resets it between tests, closes it after tests, uses signed test Access JWTs and an MSW JWKS/OpenAI network layer with unhandled requests rejected. The 1.1.1 whole-Worker integration source currently includes 12 scenarios, extending the established Access/BYOK/upstream coverage with registration/account/admin behaviors and D1 migration setup.

`test:e2e:core` covers Chromium, Firefox, WebKit and Mobile Safari emulation. `test:e2e:branded` covers installed Chrome and Edge on Windows. The local web server uses a randomized port and authenticated health probe with no existing-server reuse.

## Dependency maintenance

`npm run deps:latest` deliberately upgrades all direct dependencies to registry `@latest` with lifecycle scripts disabled, verifies the resulting lock-wide install-script policy, runs `npm rebuild` only after that review passes, then installs the **installed project's** Playwright core browsers, audits npm and runs the full non-branded validation path. It does not use interactive `npx playwright` package download.

Release certification additionally checks `npm outdated`; a stale but passing direct dependency graph is not certifiable.

The reviewed npm install-script policy uses exact-version positive approvals and explicit denial for the known optional macOS `fsevents` lock-metadata anomaly. Release certification requires npm 12. `.npmrc` sets `strict-allow-scripts=true`, so an unreviewed dependency install script is a hard install error instead of npm 12's default blocked-with-warning behavior; `strict-npmrc=true` also makes unknown project npm configuration fatal.

## Package round trip

A release ZIP is built in an isolated staging tree; the editable tree remains `releaseReady:false`. Verification requires:

- canonical ZIP root `CosmicTranscriberWeb-1.1.1/`;
- UTF-8 filename flag for every entry;
- exact `tests/fixtures/ID3 Unicode 東京.mp3`;
- CRC and SHA-256 verification;
- no node_modules/dist/test artifacts/secrets;
- fresh-extraction secret scan and dependency-free validation;
- portable lock + `npm ci` for release mode;
- complete dependency-backed release verification again after extraction.

If any release round-trip step fails, the failed release ZIP is deleted.

## Deployment is also a test boundary

A deployable tree must have `releaseReady:true`, exact certified source-file membership and matching checksums. Only the eight explicitly certified private Access team/AUD, administrator-email and D1 UUID Wrangler fields may differ from certification. Extra source files fail provenance. Each deploy rebuilds and inspects `dist/public` immediately before Wrangler and uses `--strict`.

## Safari statement

Playwright WebKit is valuable automated engine coverage but is not branded Safari. A short real macOS Safari acceptance remains a separate final gate.
## Inherited 1.0.15 staging acceptance additions

- Simulate a browser transport abort and verify it is not labeled user cancellation; retry requires explicit billing-risk confirmation.
- Verify slow transcription shows a live elapsed OpenAI-wait phase.
- Complete a file, rerun with identical settings and verify valid completed checkpoint reuse; then change model and verify an explicit confirmation and a distinct request.
- Export detailed diagnostics and verify sensitive fields are absent while correlation/timing fields are present.
- In staging Observability, verify custom structured Worker logs and traces can correlate a request/attempt/chunk without exposing authorization, cookies, API keys, audio or transcript content.


## V1.1 registry/admin test additions

Certification must additionally prove:

- Access JWTs without a verified email are rejected;
- open/approval/closed registration modes behave exactly as documented;
- closing registration does not create a new user row;
- an Access subject change can reconcile by the same verified email without losing status/usage;
- the same Access subject paired with a different email fails closed;
- pending/blocked accounts cannot create/test BYOK sessions or transcribe;
- administrator APIs reject normal users and configured administrators cannot be blocked;
- staging and production D1 databases are distinct;
- registry configuration may mutate only certified deployment-private admin-email/database-ID fields;
- D1 migrations run before Worker deployment;
- admin UI and status controls work in Chromium, Firefox/WebKit/mobile coverage, branded Windows browsers and real Safari smoke where applicable;
- registry schema and diagnostics/logging contain no OpenAI keys, raw audio, transcript bodies, prompt text, filenames or fingerprints;
- mutation tests detect removal of registry/admin authorization and environment-isolation controls.
