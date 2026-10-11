# Whole-System Adversarial Audit Report — Cosmic Transcriber Web 1.0.15

**Audit date:** 2026-08-10  
**Disposition:** **repaired audit candidate**. The dependency-free/source gate passes in the audit environment. Release/deployment certification remains deliberately withheld until the exact 1.0.15 source passes the Windows PowerShell, lock-backed Worker/integration/browser, clean-install and fresh-package gates.

## Review basis

- Latest artifact: `CosmicTranscriberWeb-1.0.15`, repaired from the exact 1.0.10 audit candidate after reviewing the user's latest Windows transcript.
- Functional authority: Cosmic Transcriber for Windows 1.0.27 behavioral baseline.
- Current external assumptions: official OpenAI file-transcription/diarization behavior, Cloudflare Workers tooling/testing, Node 26 Current and current direct dependency release lines were rechecked on 2026-08-10.
- Latest user runtime evidence: the 1.0.10 paste-once launcher and shipped PowerShell preflight passed; the verified portable Node 24.19.0 + private npm 12.0.2 bootstrap succeeded, but PowerShell resolved Node's bundled npm 11.17.0 `npm.ps1` instead of the private npm 12 command.

## What the latest supplied PowerShell log actually proves

1. The 1.0.10 paste-once ZIP discovery/extraction path worked and entered the shipped guided runner.
2. PowerShell parser + named-parameter validation passed.
3. The official portable Node 24.19.0 archive downloaded/extracted and passed the pinned layout/version/hash checks.
4. The private npm 12.0.2 installation completed and its private command was verified directly before activation.
5. Bare PowerShell `npm` then resolved `...node-v24.19.0-win-x64\npm.ps1`, which reports npm 11.17.0 because that is the npm version bundled by Node 24.19.0.
6. The runner correctly stopped before dependency refresh, Worker/integration/browser tests, Cloudflare login or deployment.
7. The evidence demonstrates PowerShell command-precedence ambiguity between `npm.ps1` and `npm.cmd`; it does not demonstrate a transcription, OpenAI or Cloudflare application failure.

## New 1.0.15 toolchain repair

- Retains the non-invasive private portable Node 24.19.0 + npm 12.0.2 toolchain from 1.0.10; machine-wide Node/npm remain untouched.
- Keeps exact architecture-specific Node archive and `node.exe` SHA-256 verification plus fresh re-extraction on every activation.
- Keeps npm 12 in a separately recreated private prefix installed from the official npm registry with lifecycle scripts disabled during bootstrap.
- **New:** PowerShell no longer discovers `npm` by filename/extension. `Install-CosmicNpmCommandBinding` installs a session-local `npm` function that executes the exact verified private `node.exe` with the exact private `node_modules/npm/bin/npm-cli.js`.
- Child npm package scripts still receive the private npm prefix before the Node/system PATH, so Windows `cmd.exe` resolves the private npm 12 `npm.cmd`.
- Certification requires both absolute `node.exe + npm-cli.js --version` and the bound PowerShell `npm --version` to report 12.0.2, and verifies that the PowerShell command type is the intended Function.
- Added a dedicated functional test, static safeguard and three adversarial mutations for removal of the binding, fallback to ambient npm and removal of exact CLI verification.
- Existing release-manifest lock SHA/registry binding, direct-Worker/MSW interception proof, Access/BYOK/checkpoint/MP3/billing/deployment safeguards remain in place.

## Core production/security review

Fresh inspection found no additional core transcription/security blocker. The enforced design still includes:

- cryptographic Cloudflare Access validation before app shell/static assets;
- Mode-B-only BYOK with AES-256-GCM encrypted `__Host-` HttpOnly/Secure/SameSite=Strict cookie and origin/Access-subject/key-version AAD;
- fixed OpenAI `/v1/audio/transcriptions` upstream, server-created Authorization and redirect rejection;
- strict server/client model and request allowlists;
- bounded request/response streaming and fail-closed production rate-limit bindings;
- explicit billing-ambiguous post-dispatch state with no silent duplicate-charge retry;
- principal-scoped, schema-validated checkpoints with source/chunk SHA-256 identity and pre-dispatch rehash;
- frame-safe MP3 splitting/continuity and ID3/VBR/Xing/Info/VBRI decoder-backed tests;
- queue/transcript resource ceilings, safe Markdown/filename/bidi handling and lazy output construction;
- certified-source provenance, no extra source files, worker-first Access boundary, `workers.dev:false`, preview URLs disabled and Wrangler strict mode.

## Actually executed on final 1.0.15 audit tree

- version consistency: **PASS**;
- JavaScript syntax/type-shape: **76 files PASS**;
- local ES-module linkage: **23 modules PASS**;
- static/security/release safeguards: **167/167 PASS**;
- secret scan: **PASS**;
- Node/ffprobe functional tests: **88/88 PASS**;
- mutation tests: **224/224 PASS**;
- dependency-free validation overall: **PASS**.

## Deliberately unclaimed

The audit container does not provide the user's Windows PowerShell 7 plus current public-registry dependency/browser environment. Therefore this report does **not** claim 1.0.15 PowerShell named-parameter execution, Worker Vitest, whole-Worker integration, Playwright Chromium/Firefox/WebKit/Mobile Safari, branded Chrome/Edge, `npm audit`, clean `npm ci`, or `releaseReady:true` fresh-ZIP certification PASS. Those remain mandatory inside the Windows first-deploy flow. Real macOS Safari acceptance remains a separate final portability gate.

## Disposition

1.0.15 supersedes 1.0.10. The returned ZIP remains intentionally `releaseReady:false`. Use the version-specific paste-once block supplied with the release; do not reuse command blocks from an older version. If any gate fails, do not manually skip ahead to staging/production.
