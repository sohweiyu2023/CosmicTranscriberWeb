# Mutation Test Report — Cosmic Transcriber Web 1.1.1

## 1.1.1 candidate result

The current dependency-free candidate run detected **308/308** deliberate safeguard removals. New registry mutations prove detection of verified-email removal, active-account bypass, admin authorization bypass, administrator lockout, closed-registration bypass, staging/production D1 reuse, migration-before-deploy removal, unrestricted/unsafe registry configuration changes, single-use paid-dispatch receipt removal, idempotent accounting removal, completed-chunk downgrade, helper-level admin-authorization removal, orphan outcome acceptance, and mutation-harness baseline-guard removal. Full release certification remains pending.


Historical 1.0.15 audit-source result: **224/224 deliberate safeguard removals detected**. This is retained only as historical evidence; the current 1.1.1 candidate result is the 308/308 figure above.

The mutation suite does not claim mathematical completeness. Its purpose is to prove that important release/security/correctness assertions actually fail when corresponding protections are deliberately removed or weakened.

Coverage includes Access JWT claims, BYOK cookie/AAD/rotation, fixed OpenAI upstream and server-owned Authorization, redirect blocking, model/request limits, origin/CSP/CORS/DOM boundaries, source/chunk hashes, checkpoint schema/principal/billing semantics, MP3/ID3/VBR behavior, queue/output/resource limits, Unicode/bidi safety, Worker/MSW lifecycle, browser isolation, dependency/install-script policy, PowerShell/release certification, canonical UTF-8 packaging, exact provenance, asset rebuild/inspection and Wrangler strict mode.

New 1.0.15 mutations specifically prove detection of:

- disabling PowerShell cmdlet named-parameter validation;
- removing the guided runner's named-parameter preflight;
- reintroducing deployed or Worker/integration/E2E runtime-test `APP_VERSION` drift;
- removing the mandatory version-consistency release gate;
- the exact invalid `New-Item -LiteralPath` class through validator self-test coverage;
- regressing the paste-once launcher to invalid `New-Item -LiteralPath`;
- regressing the paste-once launcher to a reusable/non-unique work directory;
- drifting `.nvmrc` or the private Windows Node version;
- weakening the official Node archive SHA-256 pin or removing download hash enforcement;
- putting machine Node ahead of the private toolchain on PATH;
- removing the private npm prefix;
- reintroducing machine-wide winget Node mutation;
- removing the exact private npm PowerShell binding;
- making the binding call ambient `npm` instead of the verified private CLI;
- skipping absolute private npm CLI verification.

The prior direct-Worker/MSW mock-hit, certification-failure, install-script, keyring, fresh-deploy-copy and provenance mutations remain active.
