# Cloudflare Access Setup — Cosmic Transcriber Web 1.1.1

The existing Zero Trust organization is **citeledger** and belongs to another application. Do not rename it, remove Google/OTP globally, delete its existing application or alter unrelated policies.

## Staging — already created, verify only
1. Open Cloudflare Dashboard → **Zero Trust** → **Access controls** → **Applications**.
2. Open the existing `transcriber-staging` self-hosted application.
3. Verify its public hostname is exactly `transcriber-staging.awakeningtoreality.com`.
4. Verify the intended Allow policy names only the tester email address(es) you actually want. Access is deny-by-default outside matching Allow policies. Do not use an unrestricted OTP Include rule: OTP authenticates identity, while the explicit email Allow rule limits who is authorized.
5. Verify One-time PIN is an allowed login method for this application. Do not remove the globally configured Google provider.
6. Open the application's configuration, then **Additional settings**, and copy its **Application Audience (AUD) Tag** locally. Keep the existing Access team domain locally too; do not paste either into support chats unless needed.
7. From the **certified prepared deploy folder**, run `npm run configure:access:staging`. Paste the full origin `https://<your-team>.cloudflareaccess.com` and the exact staging AUD when prompted. The helper changes only the two permitted staging Access fields and rechecks release provenance. Then authenticate/verify the intended Cloudflare account, run `npm run configure:registry:staging`, and only after both partial configuration steps run `node scripts/deploy-verify.mjs staging`.

The Worker does not trust `Cf-Access-Authenticated-User-Email`. It verifies `Cf-Access-Jwt-Assertion` with Cloudflare's JWKS, issuer, audience, expiry, `type:"app"` and `sub`. `assets.run_worker_first:true` is enabled so this verification occurs before the application shell and matching static assets are served, not only before `/api/*`.

## Production — create only when ready
Create a **separate** self-hosted Access application for `transcriber.awakeningtoreality.com`: Dashboard → **Zero Trust** → **Access controls** → **Applications** → **Create new application** → **Self-hosted and private** → **Add public hostname**. Keep the CiteLedger application and global identity providers untouched. Give the production Cosmic application its own explicit Allow policy, copy its own AUD, then run `npm run configure:access:production` in the certified prepared deploy folder.

## Required deployment tests
Use a private/incognito browser: unauthenticated access to both `/` and a known static asset should be intercepted by Access, an allowed OTP should authenticate, and an unlisted identity should not reach the app. Worker tests/staging should also reject forged/missing/wrong-audience/wrong-issuer/expired assertions.

Official reference rechecked 2026-08-10: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
