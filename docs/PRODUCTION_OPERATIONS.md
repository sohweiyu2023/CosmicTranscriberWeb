# Production Operations

Monitor aggregate Worker status/error categories and OpenAI request IDs without content. Do not enable transcript/request-body logging. Use a derived short user identifier, not email. Rate limiting is abuse control rather than exact billing.

When OpenAI model/pricing docs change, update both `src/config.js` and `public/js/models.js`, bump `MODEL_ALLOWLIST_REVISION`, update `PRICING_LAST_VERIFIED`, rerun all tests and inspect parameter compatibility. Do not add a model only because it appears in a general/realtime catalog; verify completed-file transcription semantics.

For BYOK master-key rotation follow `BYOK_SECURITY_DESIGN.md`. For incident response involving a suspected leaked user API key, instruct that user to revoke/rotate at OpenAI; Cosmic cannot revoke the user’s OpenAI credential.

## V1.1 user/registry operations

Use the in-app administrator panel for ordinary registration-mode and user-status changes. `closed` is the fast application-level control for stopping new Cosmic registrations while allowing existing active accounts to continue. For malicious users, block them in Cosmic and, when immediate Access revocation is needed, also exclude/revoke them in Cloudflare Access.

Staging and production have separate D1 `USER_DB` databases. Apply only shipped migrations through the release scripts. Do not edit production tables manually as a normal administration mechanism. D1 usage statistics are operational counters, not an OpenAI invoice reconciliation system.

## Existing-production upgrade and rollback

Use a newly verified extraction of the reviewed release ZIP. Verify the existing account, Worker/custom domain, production Access app/AUD/policy/IdPs, production D1 distinct from staging, administrator configuration, required BYOK secret, migrations and rate-limit bindings. Preserve `workers_dev:false`, disabled preview URLs and Worker-first asset authentication. A protected authenticated-Everyone Allow policy is not Bypass. Do not create new Access resources, rotate keys or bootstrap a database as a side effect of an upgrade.

Read current deployments/versions immediately before promotion using the existing secure Wrangler executor. Record the **full current version UUID**, traffic and annotation as the post-promotion rollback target; an older historical fallback is a separate identifier. `npm run deploy:production` applies shipped pending migrations before strict deploy. Never use `deploy:first:production` for an existing installation. Rollback changes code traffic, not D1 migration history: verify backward compatibility first, then use `npm run rollback:production -- <verified-version-id>` and recheck version, Access, bindings and health. Do not guess UUIDs from dashboard prefixes.

## Bounded diagnostic evidence

Worker/application diagnostics expose safe operation/request identifiers, stage/status/error categories and elapsed time where available. Browser diagnostics distinguish known pre-dispatch rejection, ambiguous post-dispatch outcome and explicit cancellation. Download only the redacted diagnostic JSON needed for support; never enable request-body, BYOK, Access assertion, audio or transcript logging. A failed workflow is not proof of zero paid execution: inspect its exact receipt, reservation and provider-attempt count before deciding whether any continuation is safe.

CI evidence is retained for the workflow's configured artifact retention period; do not treat it as permanent. Preserve required redacted receipts and hashes locally under the operator's existing access controls, and remove transient debug logs when no longer needed. No additional telemetry destination is required. For secure CLI metadata reads, `WRANGLER_WRITE_LOGS=false` prevents Wrangler disk debug logs and `WRANGLER_SEND_METRICS=false` disables metrics; use the existing OS keyring and never switch to plaintext credential storage to work around a missing native dependency.
