# Cloudflare Access Setup — Cosmic Transcriber Web 1.2.0

The existing Zero Trust organization is **citeledger** and belongs to another application. Do not rename it, remove Google/OTP globally, delete its existing application or alter unrelated policies.

## Staging — already created, verify only
1. Open Cloudflare Dashboard → **Zero Trust** → **Access controls** → **Applications**.
2. Open the existing `transcriber-staging` self-hosted application.
3. Verify its public hostname is exactly `transcriber-staging.awakeningtoreality.com`.
4. Verify the existing approved Allow policy and its intended tester scope; do not broaden it during an upgrade. Access is deny-by-default outside matching Allow policies. OTP authenticates identity; it does not by itself restrict authorization to a particular email.
5. Verify One-time PIN is an allowed login method for this application. Do not remove the globally configured Google provider.
6. Open the application's configuration, then **Additional settings**, and copy its **Application Audience (AUD) Tag** locally. Keep the existing Access team domain locally too; do not paste either into support chats unless needed.
7. From the **certified prepared deploy folder**, run `npm run configure:access:staging`. Paste the full origin `https://<your-team>.cloudflareaccess.com` and the exact staging AUD when prompted. The helper changes only the two permitted staging Access fields and rechecks release provenance. Then authenticate/verify the intended Cloudflare account, run `npm run configure:registry:staging`, and only after both partial configuration steps run `node scripts/deploy-verify.mjs staging`.

The Worker does not trust `Cf-Access-Authenticated-User-Email`. It verifies `Cf-Access-Jwt-Assertion` with Cloudflare's JWKS, issuer, audience, expiry, `type:"app"` and `sub`. `assets.run_worker_first:true` is enabled so this verification occurs before the application shell and matching static assets are served, not only before `/api/*`.

## Production - existing installation, verify and reuse
Production already has its own self-hosted Access application for `transcriber.awakeningtoreality.com`. Open that existing application and verify its hostname, production AUD, team domain, approved policy and identity providers. Preserve unrelated applications and global identity providers. Do not create a replacement application, reuse the staging AUD, or change authorization policy as part of an ordinary upgrade.

In the certified prepared production folder, use `npm run configure:access:production` with the existing production values. Verify and reuse the existing production D1 database and administrator configuration before running registry configuration; a missing or mismatched resource needs investigation rather than bootstrap provisioning.

An approved `Allow` policy including `Everyone` still requires authentication; it is not an Access `Bypass` policy. It does grant broad eligibility to authenticated identities. Cosmic's separate account registration/status checks determine who may perform application paid operations. Do not silently tighten or broaden either control during deployment.

## Required deployment tests
Use a private/incognito browser: unauthenticated `/` and a known static asset must be intercepted by Access. Verify an identity allowed by the actual approved policy, and a nonmatching identity where that policy has an exclusion. An email absent from an explicit list is not an appropriate negative test for an approved authenticated-Everyone policy. Worker tests must reject forged, missing, wrong-audience, wrong-issuer and expired assertions independently of the edge gate.

Official JWT validation reference: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
