# Production Operations

Monitor aggregate Worker status/error categories and OpenAI request IDs without content. Do not enable transcript/request-body logging. Use a derived short user identifier, not email. Rate limiting is abuse control rather than exact billing.

When OpenAI model/pricing docs change, update both `src/config.js` and `public/js/models.js`, bump `MODEL_ALLOWLIST_REVISION`, update `PRICING_LAST_VERIFIED`, rerun all tests and inspect parameter compatibility. Do not add a model only because it appears in a general/realtime catalog; verify completed-file transcription semantics.

For BYOK master-key rotation follow `BYOK_SECURITY_DESIGN.md`. For incident response involving a suspected leaked user API key, instruct that user to revoke/rotate at OpenAI; Cosmic cannot revoke the user’s OpenAI credential.

## V1.1 user/registry operations

Use the in-app administrator panel for ordinary registration-mode and user-status changes. `closed` is the fast application-level control for stopping new Cosmic registrations while allowing existing active accounts to continue. For malicious users, block them in Cosmic and, when immediate Access revocation is needed, also exclude/revoke them in Cloudflare Access.

Staging and production have separate D1 `USER_DB` databases. Apply only shipped migrations through the release scripts. Do not edit production tables manually as a normal administration mechanism. D1 usage statistics are operational counters, not an OpenAI invoice reconciliation system.
