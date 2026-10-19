# Automated Test Results — Cosmic Transcriber Web 1.0.15

**Evidence date:** 2026-08-10  
**Artifact:** final 1.0.15 audit-candidate source in this review.

## A. Actually executed in the audit sandbox

`node scripts/validate.mjs` completed successfully on the final modified tree:

- version consistency: **PASS**;
- JavaScript syntax/type-shape: **76 files PASS**;
- ES-module linkage: **23 modules PASS**;
- static/security/release safeguards: **167/167 PASS**;
- Node/ffprobe functional tests: **88/88 PASS**;
- mutation tests: **224/224 PASS**;
- secret scan: **PASS**;
- overall dependency-free validation: **PASS**.

No dependency-backed or Windows-PowerShell result is promoted to PASS merely because its source was reviewed.

## B. Latest user Windows evidence — 1.0.10

The 1.0.10 paste-once path successfully found/extracted the candidate and entered the shipped guided runner. The mandatory PowerShell parser + named-parameter preflight **passed**. The reviewed portable Node 24.19.0 archive downloaded, extracted and passed its pinned hash/layout/version checks. The bootstrap then installed exact npm 12.0.2 into the private prefix and verified that private installation directly.

Activation nevertheless failed because bare `npm` in the PowerShell process resolved to the `npm.ps1` bundled inside the official Node 24.19.0 ZIP, which reports npm **11.17.0**, rather than the separately installed private npm 12.0.2 command shim. The runner correctly stopped before dependency resolution, Worker/integration/browser tests or deployment.

1.0.15 removes that ambiguity. PowerShell gets a session-local `npm` function that executes the exact verified private `node.exe` with the exact private `node_modules/npm/bin/npm-cli.js`; child package scripts still receive the private npm prefix before Node/system paths. Both the direct CLI and the PowerShell binding must report 12.0.2 before certification can proceed.

## C. Additional source-audit findings and repair

The npm-command-precedence repair is regression tested against removal of the binding, replacement with ambient `npm`, and removal of exact private CLI verification. Existing private-toolchain controls still detect Node/npm version drift, hash-pin drift, missing download hash enforcement, PATH-order reversal, removal of npm prefix isolation and reintroduction of winget mutation. `.nvmrc`, package engines, Windows toolchain constants and release checks must agree.

## D. Prior dependency-backed evidence — 1.0.5

The earlier 1.0.5 Windows certification reached dependency-backed execution before stopping:

- Node 24.19.0 and npm 12.0.2;
- dependency refresh with lifecycle scripts disabled;
- lock-wide install-script review/rebuild PASS;
- Playwright browser installation PASS;
- npm audit: 0 vulnerabilities;
- Worker-runtime Vitest: **4/4 PASS**;
- whole-Worker integration: **8/9 PASS, 1 FAIL**.

The later integration repair switched outbound MSW testing to Cloudflare's direct Worker handle and exact mock-hit assertions. That repaired path still requires Windows execution on 1.0.15 before it can be called PASS.

## E. 1.0.15 safeguards added

- exact PowerShell `npm` binding to the private npm 12 CLI instead of relying on `npm.ps1`/`npm.cmd` resolution;
- dual verification of private npm 12 through absolute `node.exe + npm-cli.js` and the bound PowerShell command;
- runtime-test version consistency for Worker/integration/E2E;
- version-specific paste-once launcher consistency;
- Node unit tests proving stale runtime/launcher versions are rejected;
- static/mutation checks preventing `New-Item -LiteralPath` in the launcher;
- unique timestamped extraction folder requirement;
- mutation harness now includes the paste-once file, preventing false mutation detections from a missing snapshot file;
- existing PowerShell parser/named-parameter gate remains mandatory.

## F. Mandatory Windows certification matrix still pending

On the exact 1.0.15 source, the guided runner must still prove:

1. PowerShell parser and named-parameter preflight PASS;
2. Node >=24.19.0 <25, npm >=12.0.2 <13 and public npm registry;
3. direct dependency refresh to current registry releases with lifecycle scripts disabled;
4. portable lock and exact install-script policy review before rebuild;
5. `npm audit`, `npm outdated` and clean `npm ci` gates;
6. dependency-free validation/mutations;
7. Worker Vitest suite;
8. whole-Worker integration suite, all scenarios;
9. Playwright Chromium, Firefox, WebKit and Mobile Safari emulation;
10. branded Chrome/Edge on Windows;
11. built-frontend inspection and secret scan;
12. isolated release packaging;
13. fresh ZIP extraction, Unicode/CRC/SHA/checksum verification and full release verification again;
14. internal manifest `releaseReady:true`.

Only after all gates pass is the generated `CosmicTranscriberWeb-1.0.15-source.zip` deployable.
