# Testing Guide — Cosmic Transcriber Web 1.2.0

## Logging failure-path coverage

These offline regressions use synthetic values and mocked provider responses. They do not certify live-provider behavior or genuine Safari.

| Boundary | Regression coverage |
|---|---|
| Provider response | `tests/node/logging-privacy.test.mjs`: known/unknown nested errors, malformed JSON, HTML, oversized/interrupted bodies, safe transport codes and correlation; unchanged billing ambiguity and one mock dispatch |
| Worker sink/accounting | Mandatory dependency-backed `tests/integration/logging-worker-flow.test.js`: throwing sink at dispatch, success, rejection and failed result persistence; preserve HTTP result, one mock dispatch and accounting; correlated auth rejection without dispatch. Keep it out of the dependency-free pre-install archive suite because importing the Worker requires `jose`. No conditional skip is introduced. |
| Typed privacy envelope | `logging-privacy.test.mjs`: secrets under allowed fields, reserved-key overwrite, getters, cyclic/deep arrays, finite enums, bounded retention and mutation/appending outside the ring; incomplete exports remain explicit |
| Preference storage | Unit tests plus `tests/e2e/diagnostics-storage.spec.js`: denied reads, malformed saved JSON and quota failures; no stored prompt or raw exception message in downloads |
| Caught UI errors | `diagnostics-storage.spec.js`: key setup/forget, admin failures and failed diagnostic export remain correlated without private messages, emails or API-key input |
| Existing guarantees | Existing retry, transport, checkpoint, Worker/integration, static/mutation and browser tests; logging cannot reset a durable receipt or authorize automatic replay |

Unknown classifications, eviction and failed writes are incomplete evidence. Browser exports are page-local; Worker logs still depend on existing platform sampling, delivery and retention. Neither is a complete billing ledger. See [troubleshooting](TROUBLESHOOTING.md) for collection and disclosure limits.

## Evidence discipline

Never call a release gate PASS unless it actually ran successfully on the named artifact. The editable 1.2.0 candidate is **not release-certified**. Historical 1.1.1 receipts listed 214 static safeguards, 109 Node/ffprobe tests and 308 mutations; those counts are historical, not the current source's results. Current run receipts must establish the Node 26.7.0 dependency-backed Worker, integration, browser, Windows release, macOS real-Safari and native fresh-ZIP gates independently.

The 1.0.15 release immediately preceding this candidate completed the full Linux + macOS WebKit/real Safari + Windows branded-browser/full-release + independent certified-ZIP matrix. V1.1 must independently repeat that matrix after resolving the current registry-latest dependency graph; prior 1.0.15 evidence is advisory only.

## Windows existing-upgrade certification

From the extracted audit-candidate project root in PowerShell 7 run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\RELEASE-WINDOWS.ps1
```

This certification-only process activates the shipped private toolchain and fails on any required Windows gate. It performs no deployment. Do not use `FIRST-DEPLOY-WINDOWS.ps1` or `deploy:first:*` for the existing staging/production upgrade; the bootstrap route expects release-ready output and can create or replace BYOK secrets.

The script validates PowerShell, exact Node 26.7.0/npm 12.0.2 and registry/install policy, checks the reviewed dependency graph, performs clean `npm ci`, installs browsers and packages with `--staging-candidate`. Packaging runs Windows verification before ZIP creation and again after actual .NET extraction. The result stays `releaseReady:false`, `certificationLevel:staging`. CI must also finish Linux and macOS acceptance on the same inputs/artifact. Only then follow [the upgrade runbook](CLOUDFLARE_DEPLOYMENT.md) for staging deployment, live acceptance and final Windows `npm run package:source` without candidate flags on the same accepted source. The local packager does not independently check external CI/live receipts.

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

`test:integration` builds first and uses Cloudflare `createTestHarness()` against the Wrangler production build/config. The suite starts the harness, resets it between tests, closes it after tests, uses signed test Access JWTs and an MSW JWKS/OpenAI network layer with unhandled requests rejected. Current whole-Worker integration covers Access/BYOK/upstream, registration/account/admin behavior and local D1 migration setup. Use the exact test report for scenario counts; a fixed historical count is not a certification guarantee.

`test:e2e:core` covers Chromium, Firefox, WebKit and Mobile Safari emulation and remains mandatory on Linux. Windows release verification runs `test:e2e:windows` (Chromium/Firefox), Firefox stress and `test:e2e:branded` (installed Chrome/Edge). macOS runs `test:e2e:macos` (WebKit/mobile emulation/installed Chrome) and `test:safari:real` against an untouched extraction of the exact Windows staging ZIP. See [the prospective platform policy](BROWSER_RELEASE_POLICY.md): the old Windows WebKit failure remains a failure, and none of these changes constitute a new PASS. The local web server uses a randomized port and authenticated health probe with no existing-server reuse.

## Dependency maintenance

`npm run deps:latest` deliberately upgrades all direct dependencies to registry `@latest` with lifecycle scripts disabled, verifies the resulting lock-wide install-script policy, runs `npm rebuild` only after that review passes, then installs the **installed project's** Playwright core browsers, audits npm and runs the full non-branded validation path. It does not use interactive `npx playwright` package download.

Release certification additionally checks `npm outdated`; a stale but passing direct dependency graph is not certifiable.

The reviewed npm install-script policy uses exact-version positive approvals and explicit denial for the known optional macOS `fsevents` lock-metadata anomaly. Release certification requires npm 12. `.npmrc` sets `strict-allow-scripts=true`, so an unreviewed dependency install script is a hard install error instead of npm 12's default blocked-with-warning behavior; `strict-npmrc=true` also makes unknown project npm configuration fatal.

## Package round trip

A release ZIP is built in an isolated staging tree; the editable tree remains `releaseReady:false`. Verification requires:

- canonical ZIP root `CosmicTranscriberWeb-1.2.0/`;
- UTF-8 filename flag for every entry;
- exact `tests/fixtures/ID3 Unicode 東京.mp3`;
- CRC and SHA-256 verification;
- no node_modules/dist/test artifacts/secrets;
- fresh-extraction secret scan and dependency-free validation;
- portable lock + `npm ci` for release mode;
- complete dependency-backed release verification again after extraction.

If any release round-trip step fails, the failed release ZIP is deleted.

## Deployment is also a test boundary

A staging-deployable tree must have `releaseReady:false` with `certificationLevel:staging`; production requires `releaseReady:true` with `certificationLevel:release`. Both require exact certified source-file membership, verified lock provenance and matching checksums. Only the eight explicitly certified private Access team/AUD, administrator-email and D1 UUID Wrangler fields may differ from certification. Extra source files fail provenance. Each deploy rebuilds and inspects `dist/public` immediately before Wrangler and uses `--strict`.

## Safari statement

Playwright WebKit is automated engine coverage, not branded Safari. Actual SafariDriver must exercise native disk files in all nine formats plus Unicode, byte/slice identity, meaningful preparation duration and mocked workflow safeguards. The authenticated real macOS Safari acceptance checklist remains separate; CI mock coverage cannot pass a live provider or final manual acceptance gate.
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
