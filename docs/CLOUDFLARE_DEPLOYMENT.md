# Cloudflare Deployment — Cosmic Transcriber Web 1.2.0

## Deployment state

The 1.2.0 line is an **upgrade** to already-established staging and production Workers. Preserve the existing Cloudflare Access applications, D1 data and BYOK master secrets.

The upgrade sequence is: all CI gates pass for one exact staging ZIP, deploy that ZIP to staging, complete live staging acceptance, certify the same accepted source for production on Windows, then deploy its freshly extracted release ZIP. `FIRST-DEPLOY-WINDOWS.ps1` is not this route: its current bootstrap flow expects release-ready output after staging packaging and can create/replace secrets. Do not use it or `deploy:first:*` for an existing upgrade.

Targets:

- staging: `https://transcriber-staging.awakeningtoreality.com`
- production: `https://transcriber.awakeningtoreality.com`
- Access team domain: `https://citeledger.cloudflareaccess.com`

Both environments must keep `workers.dev` and Preview URLs disabled and use Worker-first static assets behind independently verified Cloudflare Access JWTs.

## Never mutate a certified release casually

A staging-deployable ZIP has `RELEASE_MANIFEST.json` with `releaseReady:false` and `certificationLevel:staging`. Production instead requires `releaseReady:true` and `certificationLevel:release`. Both require valid certified source checksums and lock provenance; an audit candidate is not deployable. Post-certification configuration is intentionally limited to private deployment values:

- environment Access team domain;
- environment Access audience (AUD);
- environment administrator email list;
- environment `USER_DB` D1 UUID.

The helper scripts verify release provenance before and after those edits. Other source/configuration edits invalidate certification.

## Upgrade staging first

After the final all-platform CI aggregator succeeds, use a **fresh extraction of that exact staging-certified 1.2.0 ZIP** and record its SHA-256. Do not substitute a working tree or an older candidate:

1. Activate the shipped private Node/npm toolchain and run `npm ci`.
2. Configure the existing staging Access values:

```powershell
npm run configure:access:staging
```

Enter the Access team domain exactly:

```text
https://citeledger.cloudflareaccess.com
```

Then enter the existing staging Access application AUD copied from **Zero Trust → Access controls → Applications → staging app → Configure → Additional settings → Application Audience (AUD) Tag**.

Expected success:

```text
staging Access team domain and AUD were saved. Release provenance remains valid.
Next: npm run configure:registry:staging
```

3. First verify the existing secure Wrangler session and intended account with `whoami`. Only if login is actually missing, use the separately approved official keyring login route. Do not create a new grant merely for a routine upgrade:

```powershell
node scripts/wrangler-invoke.mjs whoami
```

Confirm that the displayed account is the intended owner of the staging Worker/domain. If no session exists and the official persistent grant is already approved, use `node scripts/wrangler-invoke.mjs login --use-keyring`, then repeat `whoami`; stop on unexpected consent scope.

4. Verify and reuse the existing private staging registry and administrator configuration before running:

```powershell
npm run configure:registry:staging
```

The helper validates the administrator email input **before remote D1 side effects**, then lists existing D1 databases; it can create `cosmic-transcriber-web-staging-users` if missing. For this existing upgrade, verify its expected identity first and stop if absent or mismatched rather than permitting accidental provisioning. Enter 1–32 comma-separated administrator email addresses **exactly as they appear in the verified Cloudflare Access identity**. The helper writes only the staging `USER_DB` UUID and staging `ADMIN_EMAILS`, and rechecks release provenance. Final full deployment validation deliberately happens only after both partial configuration steps are complete.

5. Verify configuration:

```powershell
node scripts/deploy-verify.mjs staging
```

Required output:

```text
Deployment configuration verified for staging.
```

6. Verify the existing BYOK secret is still present:

```powershell
node scripts/wrangler-invoke.mjs secret list --env staging --format json
```

It must include `BYOK_SESSION_MASTER_KEY_CURRENT`. **Do not use `deploy:first:staging` for this upgrade.**

7. Deploy:

```powershell
npm run deploy:staging
```

The deploy script runs deployment verification, applies pending `USER_DB` D1 migrations remotely, rebuilds/inspects static assets and then performs strict Wrangler deployment. If Wrangler asks to confirm D1 migration application, review the named staging database/migrations and confirm only if they match this release.

8. Test staging user/admin behavior before production:

- configured admin sees the administrator panel;
- registration `open`, `approval` and `closed` each behave correctly;
- a pending account cannot configure/test BYOK or transcribe until activated;
- a blocked account cannot perform paid/BYOK operations;
- existing active users continue when registration is closed;
- admin account cannot be blocked through the UI;
- aggregate usage/model statistics update after transcription;
- normal/diarized transcription, rerun, diagnostics, downloads and existing 1.0.15 regression cases still work.

Record the new staging deployment/version ID for rollback.

## Upgrade production only after staging acceptance

Before final packaging, verify the external Linux/macOS/Windows CI receipts, exact source/lock/fixture identities and live staging acceptance receipts. The Windows packager reruns local and native fresh-ZIP gates but does not itself verify external CI or live acceptance evidence; successful local packaging alone is insufficient.

On Windows, activate the shipped private toolchain and run `npm run package:source` **without either candidate flag** from the exact accepted staging source. Preserve the accepted source and dependency graph; do not refresh dependencies or regenerate fixtures between acceptance and this step. The isolated packager produces the final `releaseReady:true`, `certificationLevel:release` ZIP only after its required verification. Never edit the manifest flag manually. Record the new archive SHA-256 and prove application source, lock and fixture bytes match the accepted staging source; only generated certification metadata/checksums change.

Freshly extract that final ZIP, run `npm ci`, and repeat the environment configuration using the existing production Access application and a **different production D1 database**:

```powershell
npm run configure:access:production
npm run configure:registry:production
node scripts/deploy-verify.mjs production
node scripts/wrangler-invoke.mjs secret list --env production --format json
npm run deploy:production
node scripts/wrangler-invoke.mjs deployments list --env production
```

When `configure:access:production` asks for the team domain, enter exactly:

```text
https://citeledger.cloudflareaccess.com
```

For the AUD, copy the production application's own AUD from Cloudflare. Never reuse the staging AUD.

When `configure:registry:production` asks for administrator email(s), use the exact Access email identity/identities that should administer production.

Because production already exists, use **`npm run deploy:production`**, not `deploy:first:production`. The existing production `BYOK_SESSION_MASTER_KEY_CURRENT` must remain intact during an ordinary upgrade. Existing user authorization to promote after successful verification remains valid; these checks do not replace the required verification or require requesting the same authorization again.

## D1 migration and rollback notes

- Migration SQL lives under `migrations/` and is release-certified.
- Staging and production database names are fixed and distinct.
- Only their UUIDs are private post-certification values.
- Do not use manual table edits as the normal upgrade mechanism.
- A Worker rollback does not automatically reverse a D1 schema/data migration. V1.1's initial migration is additive; future schema-changing releases must document backward compatibility or a database rollback/migration plan explicitly.
- Record known-good Worker deployment IDs before each production upgrade.

Worker rollback commands:

```powershell
npm run rollback:staging
npm run rollback:production
```

Choose the known-good deployment shown by Wrangler. If an incident involves D1 state rather than Worker code, stop and diagnose before attempting database changes.

## Exposure checks after every deployment

Cloudflare Dashboard → Workers & Pages → relevant Worker → Settings → Domains & Routes:

- correct custom domain only;
- `workers.dev` disabled;
- Preview URLs disabled.

Open a fresh Incognito/InPrivate browser and verify Cloudflare Access intercepts the hostname before the Cosmic UI appears.

## Existing-resource and rollback checkpoint

Before either upgrade, compare the verified account, exact Worker, Access audience, administrator configuration and existing D1 UUID against the intended environment. Production and staging databases must differ. The configuration helper's ability to create a missing database is not permission to do so during an upgrade. Preserve the existing BYOK master secret; do not use first-deploy helpers.

Immediately before production promotion, record the full currently active version UUID, traffic and annotation using supported `deployments list` / `versions list` metadata. Use that current version as the post-promotion rollback target, not a guessed dashboard prefix or an unrelated older version. See [production operations](PRODUCTION_OPERATIONS.md) for code-versus-migration rollback limits and bounded diagnostic logging.
