# Package Hygiene — Cosmic Transcriber Web 1.2.0

## Source-package contents
The source ZIP includes source, docs, tests, synthetic fixtures, Wrangler/test/Playwright/CI configuration, `package.json`, the audited `package-lock.json` when release-certified, `.npmrc`, safe `.dev.vars.example`, release/checksum metadata and maintenance scripts.

It excludes `node_modules`, `dist`, `.wrangler`, `.git`, Playwright reports/test-results, personal logs, recordings/user transcripts, real `.dev.vars`, real `.env`, API keys, Access tokens, Cloudflare tokens and BYOK master keys.

## Audit, staging and production packages
An editable audit candidate produced by `npm run package:source:candidate` has `releaseReady:false` and cannot be deployed. `RELEASE-WINDOWS.ps1` instead runs local Windows certification and produces a staging-certified ZIP with `releaseReady:false`, `certificationLevel:staging`. Required external Linux/macOS and platform browser checks must also pass before staging deployment.

Production requires the separate supported Windows `npm run package:source` path on reviewed source, using the shipped toolchain and immutable reviewed lock. The local packager runs local release verification and fresh-extraction replay; it does **not** validate external CI or live staging receipts. Operators must separately bind those receipts to the exact application bytes, dependency graph, configuration and fixtures. A documentation, harness or dependency change creates a new source identity and needs review and recertification; do not insert files into a certified ZIP or manually edit its manifest flags.

Windows verification covers Chromium/Firefox, Firefox stress and installed Chrome/Edge. Linux and macOS have their own required browser/native archive checks. Genuine Safari must pass or match the exact disclosed exception; an accepted FAIL/WAIVED result is not a physical Safari PASS.

## Release-mode contract
A normal release package requires:

```powershell
npm run deps:lock:verify
npm run deps:check
npm run deps:install-scripts:verify
npm audit
npm run release:verify
npm run package:source
```

`release:verify` includes dependency-free validation, Worker runtime tests, whole-Worker integration, core Playwright browsers, Windows Chrome/Edge, build inspection and secret scan. `package:source` then:

1. stamps `releaseReady:true` only after those gates pass;
2. stores SHA-256 for every packaged source file;
3. stores a normalized Wrangler security fingerprint in which only the environment Access team/AUD, administrator-email list, and `USER_DB` database UUID are designated post-release mutable fields;
4. creates a UTF-8 ZIP with filename bit 11 set;
5. fresh-extracts it;
6. verifies CRC, SHA-256 and exact `tests/fixtures/ID3 Unicode 東京.mp3`;
7. secret-scans the extracted tree;
8. runs `npm ci` in the extracted tree;
9. reruns the **complete** release verification from that extracted copy;
10. deletes the release ZIP if post-extraction verification fails.

For production this means the actual deployment must start from the successful release ZIP, not from the earlier working directory or audit candidate. `RELEASE-WINDOWS.ps1` extracts its staging-certified ZIP into a fresh deploy directory automatically and prints its exact path.

## Deployment provenance
After release packaging, private Access values must still be inserted locally. Only these eight paths are allowed to change without invalidating the release fingerprint:

- `env.staging.vars.ACCESS_TEAM_DOMAIN`
- `env.staging.vars.ACCESS_AUDIENCE`
- `env.staging.vars.ADMIN_EMAILS`
- `env.staging.d1_databases.USER_DB.database_id`
- `env.production.vars.ACCESS_TEAM_DOMAIN`
- `env.production.vars.ACCESS_AUDIENCE`
- `env.production.vars.ADMIN_EMAILS`
- `env.production.d1_databases.USER_DB.database_id`

Every other packaged source file is SHA-256 checked, and every other Wrangler field is included in the normalized release fingerprint. `deploy-verify` runs this provenance check before Wrangler is invoked. Use the provenance-safe `npm run configure:access:staging` / `configure:access:production` helpers rather than hand-editing unrelated configuration.
