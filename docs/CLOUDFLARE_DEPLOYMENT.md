# Cloudflare Deployment — Cosmic Transcriber Web 1.1.1

## Deployment state

The 1.1.1 line is an **upgrade** to already-established staging and production Workers. It adds the V1.1 D1 user/admin registry while preserving the existing Cloudflare Access applications and BYOK master secrets.

Targets:

- staging: `https://transcriber-staging.awakeningtoreality.com`
- production: `https://transcriber.awakeningtoreality.com`
- Access team domain: `https://citeledger.cloudflareaccess.com`

Both environments must keep `workers.dev` and Preview URLs disabled and use Worker-first static assets behind independently verified Cloudflare Access JWTs.

## Never mutate a certified release casually

A deployable release has `RELEASE_MANIFEST.json` with `releaseReady:true`. Post-certification configuration is intentionally limited to private deployment values:

- environment Access team domain;
- environment Access audience (AUD);
- environment administrator email list;
- environment `USER_DB` D1 UUID.

The helper scripts verify release provenance before and after those edits. Other source/configuration edits invalidate certification.

## Upgrade staging first

From a **fresh extraction of the certified 1.1.1 ZIP**:

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

3. Authenticate Wrangler and verify the Cloudflare account **before any D1 creation**:

```powershell
node scripts/wrangler-invoke.mjs login --use-keyring
node scripts/wrangler-invoke.mjs whoami
```

Confirm that the displayed account is the intended owner of the staging Worker/domain.

4. Configure the new private staging registry:

```powershell
npm run configure:registry:staging
```

The helper validates the administrator email input **before remote D1 side effects**, then lists existing D1 databases and creates `cosmic-transcriber-web-staging-users` if it does not already exist. Enter 1–32 comma-separated administrator email addresses **exactly as they appear in the verified Cloudflare Access identity**. The helper writes only the staging `USER_DB` UUID and staging `ADMIN_EMAILS`, and rechecks release provenance. Final full deployment validation deliberately happens only after both partial configuration steps are complete.

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

Repeat the same process using the existing production Access application and a **different production D1 database**:

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

Because production already exists by the time 1.1.1 is deployed, use **`npm run deploy:production`**, not `deploy:first:production`. The existing production `BYOK_SESSION_MASTER_KEY_CURRENT` must remain intact during an ordinary upgrade.

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
