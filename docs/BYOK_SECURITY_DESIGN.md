# BYOK Security Design

## Credential bootstrap
1. Cloudflare Access authenticates the browser.
2. Worker independently verifies `Cf-Access-Jwt-Assertion` using the team JWKS and checks issuer, audience, expiry/validity, RS256, `type=app`, and a non-empty `sub`.
3. `POST /api/key/session` requires exact configured Origin and bounded JSON.
4. Key syntax is bounded (512 chars) and rejects whitespace/control characters but does **not** require an `sk-` prefix.
5. Worker encrypts immediately; response contains no plaintext key.

## Envelope
AES-256-GCM, fresh 96-bit nonce per encryption. Master material is a base64url-encoded 32-byte random Cloudflare Secret. AAD binds schema, immutable configured `APP_ORIGIN`, verified Access `sub`, and encryption-key version. Incoming Host is not the trust anchor.

Cookie: `__Host-cosmic_byok`; HttpOnly; Secure; SameSite=Strict; Path=/; no Domain. Malformed/oversized/tampered/expired/cross-identity cookies fail closed.

Default rolling lifetime: 8 hours. Absolute maximum: 12 hours. Renewal begins in the final hour of rolling life but never exceeds absolute expiry. This supports multi-hour files without creating permanent browser credentials.

## Rotation
Set a new `BYOK_SESSION_MASTER_KEY_CURRENT` and increment `BYOK_KEY_VERSION_CURRENT`. Temporarily provide `BYOK_SESSION_MASTER_KEY_PREVIOUS` and `BYOK_KEY_VERSION_PREVIOUS`. Old valid cookies decrypt with previous key and are re-issued with current key. Verify migration before removing the previous secret. Never reuse a human password as a master key.

Generate a key, for example, using a trusted local cryptographic tool that produces exactly 32 random bytes and base64url-encodes them. Do not paste real values into source/docs.

## Forget semantics
Forget clears the local cookie. Stateless tokens copied elsewhere cannot be retroactively revoked. Short lifetimes limit exposure; users who suspect compromise must revoke/rotate their OpenAI key.

## Key test
No undocumented validation endpoint is assumed. The application uses a disclosed tiny actual transcription so a restricted key is tested against the permission Cosmic actually needs. Authentication, permission, quota/billing, rate-limit, model-unavailable and ambiguous network/server failures remain distinct.
