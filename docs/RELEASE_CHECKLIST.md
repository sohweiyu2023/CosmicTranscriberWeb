# Release Checklist — Cosmic Transcriber Web 1.2.0

A checked box means only the stated evidence exists. Never promote a candidate by editing `RELEASE_MANIFEST.json`. CI produces a staging-only ZIP (`releaseReady:false`, `certificationLevel:staging`); final Windows packaging after external CI and live staging acceptance produces the production release ZIP.

The [22 October 2026 owner exception](RELEASE_EXCEPTION_2026-10-22.md) changes only the genuine Safari acceptance requirement for this 1.2.0 regression release: record the exact verified automation failure as **WAIVED**, never check its PASS box. The release browser gate must still require every other platform result. Exact-source live staging acceptance, account/configuration verification and rollback remain required before production promotion.

## Inherited 1.1.1 evidence — not current 1.2 certification

- [x] Version consistency PASS for 1.1.1 on the final candidate.
- [x] Dependency-free syntax/module validation PASS.
- [x] Static/security/release safeguards **214/214 PASS**.
- [x] Secret scan PASS.
- [x] Node/ffprobe functional suite **109/109 PASS**.
- [x] Mutation suite **308/308 PASS**.
- [x] V1.1 Access-email, registration-state, admin authorization, D1 isolation/migration and registry-provenance guards added.
- [x] Guided first-deploy Node check corrected to exact Node 26.7.0/npm 12.0.2.
- [ ] Full dependency-backed release certification — pending until CI runs on the final candidate.

## V1.2 dependency and staging certification

The final certification run must independently prove all of the following on the final candidate commit:

- [ ] Exact reviewed Node **26.7.0** and npm **12.0.2**.
- [ ] Every direct production/development dependency intentionally refreshed to registry `@latest`.
- [ ] Reviewed install-script policy PASS before lifecycle scripts execute.
- [ ] `npm audit` zero known vulnerabilities or explicit release-blocking review.
- [ ] `npm outdated --depth=0` clean after refresh.
- [ ] One exact reviewed `package.json` + `package-lock.json` dependency graph shared across platform gates after registry-`@latest` refresh.
- [ ] Full `npm run validate` PASS after dependency resolution.
- [ ] Worker runtime tests PASS, including D1 migrations and user/admin registry behavior.
- [ ] Whole-Worker integration PASS, including registration open/approval/closed and admin authorization.
- [ ] Linux Chromium/Firefox/WebKit/mobile-Safari E2E PASS.
- [ ] Windows Chromium + Firefox + installed Chrome + Edge complete E2E PASS, including all nine native formats and Unicode.
- [ ] Windows Firefox secure-key stress PASS.
- [ ] macOS Playwright WebKit + mobile emulation + installed Chrome complete E2E PASS from the exact Windows staging ZIP.
- [ ] **Real SafariDriver** native-file/preparation and mocked workflow acceptance PASS on macOS; shell-only smoke is insufficient.
- [ ] Windows .NET and macOS native ZIP extraction preserve the archive's original bytes/timestamps; native full/sliced reads and meaningful duration pass without normalization.
- [ ] Revised browser policy `2026-10-11-target-platforms-v1` independently passes; historical Windows WebKit failures remain recorded, not waived into PASS.
- [ ] Full `RELEASE-WINDOWS.ps1` replay PASS.
- [ ] Reviewed lock remains immutable during release packaging.
- [ ] Built frontend inspection PASS.
- [ ] Source ZIP canonical Unicode/path/checksum/secret audit PASS.
- [ ] Fresh ZIP extraction + `npm ci` + complete release verification PASS.
- [ ] CI ZIP internal manifest says `releaseReady:false`, `certificationLevel:staging`, and exact dependency-lock SHA matches.
- [ ] Independent final certified ZIP audit PASS.
- [ ] Final `ALL RELEASE GATES GREEN` job PASS.
- [ ] Certified ZIP SHA-256 recorded before user handoff.

## V1.2 staging upgrade — preserve existing BYOK secret

After all-platform CI succeeds, use a fresh extraction of its exact staging-certified 1.2.0 ZIP. This is an **upgrade**, not a first deployment; do not use `FIRST-DEPLOY-WINDOWS.ps1` or `deploy:first:*`.

- [ ] `npm ci` under shipped private Node/npm toolchain PASS.
- [ ] `npm run configure:access:staging` with existing staging team domain/AUD.
- [ ] `npm run configure:registry:staging` creates/resolves the private staging D1 and stores exact Access admin email(s).
- [ ] `node scripts/deploy-verify.mjs staging` says `Deployment configuration verified for staging.`
- [ ] Existing `BYOK_SESSION_MASTER_KEY_CURRENT` confirmed before deployment.
- [ ] `npm run deploy:staging` applies pending D1 migrations **before** strict Worker deploy.
- [ ] Do **not** run `deploy:first:staging` for this upgrade.
- [ ] Custom domain exactly `transcriber-staging.awakeningtoreality.com`.
- [ ] `workers.dev` disabled; Preview URLs disabled.
- [ ] Configured admin sees admin dashboard.
- [ ] Registration `open` admits a new user as active.
- [ ] Registration `approval` creates pending user; paid/BYOK operations blocked until approval.
- [ ] Registration `closed` creates no new user row; existing active user still works.
- [ ] Block/unblock works; configured admin cannot be blocked.
- [ ] User/job/chunk/model aggregate statistics update after real/mocked work without storing transcript/audio content.
- [ ] Normal transcription, diarization, A169/A170, unrelated MP3s, rerun workflow, diagnostics, downloads and checkpoint behavior remain healthy.
- [ ] Staging deployment/version ID recorded for rollback.

## V1.2 production upgrade — only after staging acceptance

Production already exists, so this is also an **upgrade**.

- [ ] External all-platform CI and live staging acceptance receipts verified against exact accepted source/lock/fixtures; local packager does not enforce these external receipts.
- [ ] Windows `npm run package:source` without candidate flags reruns local/native-ZIP verification on the same accepted source without dependency or fixture changes.
- [ ] Fresh final ZIP has `releaseReady:true`, `certificationLevel:release`; archive SHA-256 recorded and accepted application/lock/fixture identities preserved. No manual flag change.
- [ ] Fresh certified source configured with existing production Access team domain and production AUD.
- [ ] `npm run configure:registry:production` creates/resolves a **different** production D1 and exact production admin email(s).
- [ ] `node scripts/deploy-verify.mjs production` PASS.
- [ ] Existing production `BYOK_SESSION_MASTER_KEY_CURRENT` confirmed and preserved.
- [ ] `npm run deploy:production` applies production migrations then strict deploy.
- [ ] Do **not** run `deploy:first:production` for the V1.1 upgrade.
- [ ] Production Access still uses the intended policy/IdPs; current owner decision is authenticated `Allow → Everyone`, not Bypass.
- [ ] Production custom domain/TLS/Access/exposure/BYOK/admin/transcription smoke checks PASS.
- [ ] Production deployment/version ID recorded for rollback.

## Database rollback discipline

- [ ] Every migration is release-certified and applied by Wrangler/D1 migrations.
- [ ] Staging and production `USER_DB` IDs/names are distinct.
- [ ] Worker rollback compatibility with the current D1 schema is understood before production promotion.
- [ ] Future destructive/incompatible migrations require an explicit database migration/rollback plan; do not assume Worker rollback reverses D1.
