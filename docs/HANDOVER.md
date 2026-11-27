# Cosmic Transcriber Web — Complete System Handover

## Current review gate (2026-11-27)

The sections below preserve the November 22 application-only handover. The separate verification candidate applies those app changes and an independent upstream dependency refresh; it does not incorporate the excluded `72436580` descendant. The original app-only stage leaves the manifest and lock unchanged. The pinned refreshed graph passed local lock audit, committed graph verification, license inventory verification and frontend build, plus five focused regressions. Full Windows validation was incomplete on the local sandbox; hosted Linux, Windows and macOS browser verification is still required. Production was not changed.

For verification, use a separate offline CI branch, not the existing staging-certification ref. Neither merging to main nor any staging or production deployment, real provider calls or migration is part of this verification pass. Do not present a WebKit result as native Safari evidence.

**Handover Date:** 2026-11-22  
**Repository:** [CosmicTranscriberWeb](https://github.com/sohweiyu2023/CosmicTranscriberWeb) ([PR #57](https://github.com/sohweiyu2023/CosmicTranscriberWeb/pull/57))  
**Current Version:** `1.2.0` (Desktop behavioral baseline: `1.0.27`)  
**Public Project Hub:** [Cosmic Transcriber](https://www.awakeningtoreality.com/2026/08/cosmic-transcriber.html)  
**Scope Notice:** Web edition only. Do not modify Cosmic Desktop. No git push, merge, live provider calls, spending, or deployments were executed from this sandbox.

## 1. System Overview & Architecture

Cosmic Transcriber Web is a Cloudflare Workers + Static Assets + D1 web application that provides privacy-first, long-form OpenAI speech-to-text transcription using a **Mode B Bring-Your-Own-Key (BYOK)** security model.

### End-to-End Data Flow
1. **Authentication Boundary (Worker-First):** Cloudflare Access authenticates every request (`run_worker_first: true` in `wrangler.jsonc`). `src/access.js` cryptographically verifies the `Cf-Access-Jwt-Assertion` RS256 JWT against `<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs` (issuer, audience, `type: "app"`, `sub`, `email`, `exp`, `iat`) *before* serving any static asset or `/api/*` route.
2. **User Registry & Access Control:** `src/user-registry.js` resolves the verified Access principal against Cloudflare D1 (`USER_DB`), enforcing `open` / `approval` / `closed` registration modes and `active` / `pending` / `blocked` account states. Administrators (configured via `ADMIN_EMAILS`) manage registration mode and user statuses via `/api/admin/*`.
3. **BYOK Credential Session:** Users submit their own OpenAI API key once to `POST /api/key/session`. `src/byok.js` encrypts it with AES-256-GCM (AAD bound to `APP_SCHEMA`, `APP_ORIGIN`, `principal.sub`, and `keyVersion`) into a short-lived `__Host-cosmic_byok` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/`; 8h sliding, 12h absolute). Plaintext keys are never stored in `localStorage`, `sessionStorage`, `IndexedDB`, or D1.
4. **Client-Side Audio Inspection & Chunking:** `public/js/app.js` streams SHA-256 fingerprints (`@noble/hashes/sha2.js`), validates 9 supported audio formats (`mp3`, `flac`, `mp4`, `mpeg`, `mpga`, `m4a`, `ogg`, `wav`, `webm`), and splits long MP3s on valid MPEG frame boundaries (`public/js/mp3.js`, up to 24 MB / 5 min per chunk).
5. **Billing-Safe Dispatch & Checkpointing:**
   - Before each upload, the browser re-hashes source/chunk bytes and saves a principal-scoped IndexedDB checkpoint (`cosmic-web-checkpoint-4`).
   - `POST /api/transcribe` validates headers/metadata/audio magic bytes, records a single-use `attemptId` dispatch receipt atomically in D1 (`cosmic_jobs`, `cosmic_attempt_dispatches`, `cosmic_job_chunks`), streams the multipart request to fixed `https://api.openai.com/v1/audio/transcriptions` (`redirect: "manual"`), and records the outcome idempotently in D1 via `ctx.waitUntil`.
   - `public/js/transcript-result.js` strictly validates diarization envelopes (`requireDiarization: true` requires an explicit `segments` array; explicit silence `{ text: "", segments: [] }` is valid; plaintext-only responses fail closed as billing-ambiguous without silent retry).
   - On changed-settings reruns, one in-memory `previousRerunResult` per queued file is retained as separately labeled TXT/MD downloads (excluded from current/combined exports, dynamically refreshed when export preferences change, and discarded on row removal or reload).

## 2. Tech Stack, Environment & Dependencies

| Layer | Technology / Pin | Notes |
| :--- | :--- | :--- |
| Runtime / Package Manager | Node `26.7.0` (`.nvmrc`), npm `12.0.2` (`engines: >=26.7.0 <27`, `npm >=12.0.2 <13`) | `package-lock.json` is lockfile v4 (`strict-allow-scripts=true`). |
| Production Dependencies | `@noble/hashes@2.4.0`, `jose@6.2.17` | Zero frontend frameworks; vanilla ES modules + Web Crypto/IndexedDB. |
| Dev / Test Toolchain | `wrangler@4.161.0`, `vitest@5.1.0`, `@cloudflare/vitest-plugin@1.8.1`, `@playwright/test@1.65.0`, `msw@3.0.5` | Keep PR #57 (`1.65.0`) strictly separate from dependency-review descendant `72436580...` (`1.65.1`). |
| Database | Cloudflare D1 (`USER_DB`) | Migrations: `migrations/0001_user_registry.sql`, `migrations/0002_usage_result_receipts.sql` (`REGISTRY_SCHEMA_REVISION = "2"`). |
| Rate Limits | Cloudflare Workers Rate Limiting bindings | `RL_KEY_SESSION` (8/60s), `RL_KEY_TEST` (5/60s), `RL_TRANSCRIBE` (30/60s), `RL_ADMIN` (60/60s); fail-closed outside `development`. |
| Required Secrets | `BYOK_SESSION_MASTER_KEY_CURRENT` (32-byte base64url) | Optional rotation key: `BYOK_SESSION_MASTER_KEY_PREVIOUS` + `BYOK_KEY_VERSION_PREVIOUS`. |
| Key Env Vars (`wrangler.jsonc`) | `APP_VERSION`, `DEPLOYMENT_ENV`, `APP_ORIGIN`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUDIENCE`, `ADMIN_EMAILS`, `LOCAL_AUTH_BYPASS` (`false` in staging/prod), `REGISTRY_SCHEMA_REVISION` | Staging: `transcriber-staging.awakeningtoreality.com`; Production: `transcriber.awakeningtoreality.com`. |

## 3. Operations: Setup, Test, Apply & Merge

### Apply This Audit's Patch to PR #57 Locally (Node 26.7.0 / npm 12.0.2)
Because this sandbox has read-only GitHub access (no push/merge credentials) and runs Node `v18.20.4`, apply the delivered patch locally or in your authenticated environment:

```bash
# 1. Start from exact PR #57 head
git fetch origin main pull/57/head:pr57-review
git checkout pr57-review
git rev-parse HEAD   # must equal 209c1b19977798cb603f6827c15914d4b5f4a39d

# 2. Apply verified patch (does not touch package.json or package-lock.json)
git apply CosmicTranscriberWeb_PR57_Audit_Fixes.patch

# 3. Verify with pinned Node 26.7.0 / npm 12.0.2
npm ci
npm audit --package-lock-only --ignore-scripts --json
npm run validate:full
npm run test:e2e:core

# 4. Push PR #57 and wait for all GitHub Actions lanes (resolve-lock, linux-full, windows-release, macos-safari)
git add public/ src/ tests/ docs/
git commit -m "Fix multi-file D1 jobId collision, refine retained downloads, and polish UI/UX"
git push origin HEAD:refs/heads/<pr57-branch>

# 5. Merge to main ONLY after PR #57 CI passes cleanly on pinned toolchain
# gh pr merge 57 --merge   (or merge via GitHub UI after green checks)
```

### Key npm Scripts
- `npm run validate` — Version consistency, syntax/typecheck, module linkage, 230 static safeguards (`scripts/audit-lib.mjs`), secret scan, Node tests, mutation tests.
- `npm run test:worker` — Cloudflare Worker unit tests (`vitest.config.js`).
- `npm run test:integration` — Built-asset + Worker + MSW integration tests (`vitest.integration.config.js`).
- `npm run test:e2e:core` — Linux Playwright Chromium/Firefox/WebKit/Mobile-Safari E2E suite.
- `npm run test:e2e:branded` — Windows native Chrome/Edge E2E suite.
- `npm run test:e2e:macos` & `npm run test:safari:real` — macOS WebKit/Chrome and real SafariDriver acceptance.

## 4. Core Logic, APIs & Database Schema

### Worker API Routes (`src/index.js`)
- `GET /api/session/status` — Returns `{ ok, configured, expiresAt, principalScope, account, version, modelAllowlistRevision, pricingLastVerified }`; clears invalid/expired BYOK cookies.
- `POST /api/key/session` — Validates `{ apiKey }` (Origin + Sec-Fetch-Site checked), sets encrypted `__Host-cosmic_byok` cookie.
- `DELETE /api/key/forget` — Clears `__Host-cosmic_byok` cookie.
- `POST /api/key/test` — Requires `{ confirmMinimalUsage: true }`; sends 0.25s silent MP3 to verify OpenAI permission.
- `POST /api/transcribe` — Validates `X-Cosmic-Metadata` (v1/v2 base64url JSON) + audio bytes, records D1 dispatch receipt, streams to OpenAI, schedules idempotent result receipt.
- `GET /api/admin/overview`, `GET /api/admin/users`, `PUT /api/admin/settings/registration`, `PATCH /api/admin/users/:id` — Admin-only registry management with audit logging.

### D1 Tables (`migrations/0001_user_registry.sql`, `0002_usage_result_receipts.sql`)
- `cosmic_settings(key PK, value, updated_at)`
- `cosmic_users(id PK, access_sub UNIQUE, email UNIQUE, status, timestamps, aggregate counters)`
- `cosmic_jobs(user_id, job_id PK, model, chunk_count, status, timestamps)`
- `cosmic_job_chunks(user_id, job_id, chunk_index PK, attempts_started, successes, failures, status, updated_at)`
- `cosmic_model_usage(model PK, request_count, success_count, failure_count, bytes_requested, audio_seconds_requested, updated_at)`
- `cosmic_admin_audit(id PK, actor_user_id, action, target_user_id, detail, created_at)`
- `cosmic_attempt_dispatches(user_id, job_id, attempt_id PK, chunk_index, model, chunk_count, created_at)`
- `cosmic_attempt_results(user_id, job_id, attempt_id PK, chunk_index, success, created_at)`

## 5. Audit & Change Log (Exact Post-Change Inventory)

Base commit: `209c1b19977798cb603f6827c15914d4b5f4a39d` (PR #57 head).  
`package.json` (`ab4d1ee7...`) and `package-lock.json` (`7cedd070...` / blob `9cf47b6a...`) are **100% unchanged**.

| File | Action | Post-Change SHA-256 | Git Blob | Summary of Changes |
| :--- | :--- | :--- | :--- | :--- |
| `public/js/app.js` | Modified | `8e4db50df0879f0fcb25145386982f91d37e0a5a1b9d24145e3f067696e02b01` | `afbdd8e8ae6f0bfcd7a34413113a2930e01c098c` | Fixed critical multi-file `jobId` collision (`rid('job')` per file); integrated safeguard-safe retained prior-download fix + `syncSettingsUi` refresh on export-pref toggles + `.download-prior` styling; parameterized `#confirmDialog` title/labels + safe `#confirmNo` focus; wired `#toggleKeyVisibilityBtn` with auto-reset; fixed stale status pill after `forgetKeyBtn`. |
| `public/index.html` | Modified | `1a0f19528c7836a5db3eea280294c00fa816d309e130a217237395415e9cf3ea` | `67f6229a7272b13647dcda69da67be77a60ccf16` | Added accessible Show/Hide API key toggle button (`#toggleKeyVisibilityBtn`) inside `#keyDialog`. |
| `public/styles.css` | Modified | `b1d5063c2cb07559d6d31d8b394904f857f882016359f136013c6bd4458e1d82` | `eb62a58e674c0ba1d248f3c1a9a3c3d0687619c4` | Fixed undefined `--panel-soft` -> `--card2` on `.admin-model-row`; added missing `.pill.warn`; added `.download-prior`, `.secret-input-row`, and hover polish. |
| `src/user-registry.js` | Modified | `6b15d677e03246dff43133eb880065445f19446ee6534add5c25091ea5c408fc` | `3471032d28fdb7bfd139ba8d0fe8bf9d50e3e37d` | Hoisted `configuredAdminEmails(env)` outside `.map()` in `adminListUsers()`. |
| `tests/node/retained-download-and-multifile.test.mjs` | Created | `25e6b8934846e7985680d7cb23c9384324206c5cbb8f1f818ef5ce7f27a8538c` | `b4fec43af5dc6a071656fa9513271e28f99cd366` | 5 Node regression tests covering retained downloads, export-pref toggle refresh after failed rerun, rerun vs retry dialog labels, explicit silence, and per-file `jobId` isolation (5/5 pass). |
| `tests/e2e/retained-downloads.spec.js` | Created | `1258e2dbceca9d14be0f302f3608149dd4b862b5da83543f4523829e57373a5b` | `5549e375bea057c34987869eacbc2680559b6f90` | Playwright E2E spec covering all Gate 3 browser contract & native download acceptance scenarios. |
| `docs/AUDIT_REPORT.md` | Updated | Generated in package | — | Full independent audit report & verification evidence matrix (2026-11-22). |
| `docs/HANDOVER.md` | Created | Generated in package | — | This complete self-contained handover package + Master Handover Prompt. |

## 6. Risks, Limitations & Prioritized Next Steps

1. **Next Gate — Pinned Toolchain CI Qualification:** Push this patch to PR #57 so GitHub Actions executes `resolve-lock` (Node `26.7.0` / npm `12.0.2` clean `npm audit` + full `npm run validate` + mutation suite), `linux-full` (Worker + Integration + Playwright 1.65.0 including `retained-downloads.spec.js`), `windows-release` (branded Chrome/Edge), and `macos-safari` (WebKit + native SafariDriver / exact disclosed exception).
2. **Merge to `main`:** Merge PR #57 to `main` only after the pinned CI matrix passes cleanly. Do not merge or mix the separate dependency-review descendant (`72436580...`, Playwright 1.65.1) into PR #57.
3. **Staging vs. Production Cutover:** Production remains on CosmicTranscriberWeb `1.2.0` untouched. Any future staging deploy or paid live check requires separate explicit owner authorization, rollback target verification, and cost-ledger accounting (prior cumulative US$2 is not unspent approval).
4. **Separate Track — February 2027 OpenAI Deprecation:** Plan a dedicated post-PR #57 migration before **26 February 2027** ([OpenAI Deprecations](https://platform.openai.com/docs/deprecations)). Verify whether any successor preserves speaker labels and segment timestamps; if not, require explicit opt-in with `"Part timing only; no speaker labels or segment timing"` and never silently downgrade segmented output.

## 7. Master Handover Prompt

Copy and paste the block below to onboard the next AI agent immediately with full context:

```text
You are continuing engineering, CI qualification, and release preparation for **Cosmic Transcriber Web** (Web edition only — do not modify Cosmic Desktop).

### Exact Repository & Revision State (Snapshot 2026-11-22)
- Repo: https://github.com/sohweiyu2023/CosmicTranscriberWeb (PR #57: https://github.com/sohweiyu2023/CosmicTranscriberWeb/pull/57)
- Verified `main`: `b2e4426e8e37c92dbdca2756a11af07845a655a6`
- Verified PR #57 base head: `209c1b19977798cb603f6827c15914d4b5f4a39d` (Playwright `1.65.0`, Node `26.7.0`, npm `12.0.2`, `package-lock.json` v4 blob `9cf47b6aab3b06d192823786982e27773772d714`). Keep dependency-review descendant `72436580fe40d042caeeff3ff76ade3d8ee21628` (Playwright `1.65.1`) strictly separate.
- Live production release: **CosmicTranscriberWeb 1.2.0** (untouched; verify deployed bytes separately before any release claim).

### Completed Work in `CosmicTranscriberWeb_PR57_Audit_Fixes.patch` (Verified on Base `209c1b19...`)
1. **Critical Bug Fixed (`public/js/app.js`):** Multi-file runs previously reused `jobId = state.runId`, causing D1 HTTP 409 `usage_job_identity_mismatch` on File 2+ when chunk counts differed (and `cosmic_job_chunks` collisions when equal). Fixed to assign a unique `rid('job')` per file while keeping `state.runId` for batch diagnostics.
2. **Retained Prior-Download Fix Refined (`public/js/app.js`, `public/styles.css`):** Replaced supplied `REVIEW_ONLY.diff` with a superior implementation that (a) preserves static safeguard #183 in `scripts/audit-lib.mjs` (which `REVIEW_ONLY.diff` broke), (b) updates `syncSettingsUi()` so toggling `exportTxt`/`exportMd`/`includeTimestamps` refreshes retained prior downloads even when `status === 'error'` (preserving safeguard #153), and (c) styles retained prior downloads distinctly (`.download-prior`).
3. **UI/UX & Backend Fixes:** Fixed undefined CSS var `--panel-soft` -> `--card2` on `.admin-model-row`, added missing `.pill.warn`, parameterized `#confirmDialog` title/buttons (`Confirm rerun` / `Run again` / `Cancel` for reruns vs `Confirm retry` for ambiguous retries) with safe `#confirmNo` focus, added an accessible auto-resetting Show/Hide API key toggle (`#toggleKeyVisibilityBtn`) in `public/index.html`, updated `forgetKeyBtn` to refresh the top-bar status pill, and hoisted `configuredAdminEmails(env)` outside `.map()` in `src/user-registry.js`.
4. **Tests & Docs Added:** `tests/node/retained-download-and-multifile.test.mjs` (5/5 pass), `tests/e2e/retained-downloads.spec.js` (complete Gate 3 Playwright spec), `docs/AUDIT_REPORT.md`, and `docs/HANDOVER.md`.
5. **Verified Locally:** 230/230 static safeguards pass; 57/57 targeted + new Node tests pass; isolated no-install `npm audit --package-lock-only --ignore-scripts --json` returned 0 vulnerabilities across 204 deps (caveat: executed on Node `v18.20.4`/npm `9.2.0`, not pinned Node `26.7.0`/npm `12.0.2`).

### Immediate Next Gate & Hard Guardrails
1. Apply `CosmicTranscriberWeb_PR57_Audit_Fixes.patch` to PR #57 head `209c1b19977798cb603f6827c15914d4b5f4a39d` (confirm `package.json` and `package-lock.json` remain unchanged).
2. Run the full pinned-toolchain gate on Node `26.7.0` / npm `12.0.2`: `npm ci`, `npm audit`, `npm run validate:full`, and GitHub Actions platform lanes (`resolve-lock`, `linux-full`, `windows-release`, `macos-safari` — label Linux bundled, Windows branded Chrome/Edge, macOS WebKit, and native SafariDriver separately).
3. Once all required CI gates pass, merge PR #57 into `main` (user requested merge to `main` once done & verified).
4. Do NOT trigger paid OpenAI requests, staging/production deployments, or February 2027 legacy-model migration changes without explicit separate approval.
```
