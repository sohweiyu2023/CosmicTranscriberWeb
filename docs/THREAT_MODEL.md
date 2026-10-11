# Threat Model

| Threat | Asset / attacker / path | Primary control | Test/evidence | Residual risk |
|---|---|---|---|---|
| Unauthenticated abuse | Worker/OpenAI relay; Internet visitor | Access edge + Worker JWT validation | invalid/missing JWT suites | stolen valid Access session |
| Malicious authenticated proxy abuse | BYOK relay; authenticated user | fixed upstream/path, strict method/schema/model allowlists, Origin | generic-proxy/header/model mutations | user can spend their own key within allowed endpoint |
| Stolen BYOK cookie | user API key capability | AES-GCM, Access-sub AAD, short lifetime, host-only HttpOnly cookie | tamper/identity/expiry/rotation tests | copied Access+BYOK pair remains valid until expiry |
| XSS | key capability/transcripts | no key JS cookie, no inline/eval/CDNs, CSP, `textContent`, no `innerHTML` | static mutation + E2E payload | browser/extension compromise outside app |
| CSRF | key session / paid call | SameSite=Strict, exact Origin, Access auth, Fetch Metadata supplement | Origin tests | browser bug/compromised same origin |
| SSRF/generic proxy | Cloudflare egress + key | constant OpenAI URL, client cannot choose host/path/protocol | unit/mutation tests | OpenAI infrastructure itself |
| Redirect credential theft | Authorization | `redirect:"error"` | mock redirect integration source | runtime regression if fetch semantics change |
| Header abuse | upstream request | narrow generated header set | unit tests/static review | platform proxy headers outside code |
| Oversized-body DoS | Worker memory | metadata limits, Content-Length check, streaming actual-byte ceiling, 24MB app max | node/Worker tests | concurrency still needs staging measurement |
| Memory exhaustion | Worker | Streams, 4MiB response max, no full request buffer | static mutation + staging measurement gate | platform overhead |
| Key/source-map/log leak | OpenAI key | no persistence, redaction, secret scan, HttpOnly cookie | seeded secret scan/E2E storage tests | browser extension/end-device compromise |
| Transcript injection | browser DOM/download | safe text APIs; no transcript HTML execution | XSS tests | downstream consumer of downloaded text |
| Checkpoint tampering/staleness/cross-user reuse | correctness/billing/privacy | integrity hash + exact source/settings/chunk/principal identity | checkpoint/principal-scope tests | local browser-profile compromise can still delete/copy local data |
| Duplicate billing | user money | prebill source rehash, checkpoint-before-cancel, chain rules, UI run lock, no ambiguous auto-retry | node/static/mutation tests | two independent tabs/devices can still submit same user audio; no DO in V1 |
| Stale model assumptions | correctness/cost | dated versioned allowlist/pricing docs + release review | deployment checklist | OpenAI can change after release |
| Dependency compromise | source/bundle | two runtime deps; lock required; npm audit/license review plus version-pinned npm install-script policy | dependency report/CI policy | ecosystem compromise |
| Preview/static-shell exposure | staging/private testers | `workers_dev=false`, `preview_urls=false`, `assets.run_worker_first=true`, Worker Access verification before assets, deployment verifier | integration/mutation/deploy verifier | dashboard/account config drift |
| Configuration error | all | required secret names; deploy verifier; separate env vars | script tests | account-side Access/routing misconfiguration |
| Malicious filename | UI/header/download | filename never upstream header; DOM text; sanitized download name | output/XSS tests | confusing Unicode retained for display |
| Malicious transcript | UI | DOM text only; CSP | mocked script payload test source | downstream copying into unsafe tools |

## V1.1 user/admin additions

| Threat | Primary V1.1 control | Residual risk |
|---|---|---|
| Untrusted browser claims administrator role | Admin derives only from independently verified Access email + server-side `ADMIN_EMAILS`; every `/api/admin/*` route rechecks authorization | Compromise of the configured administrator Access identity |
| User changes Access identity metadata | Existing subject with a different verified email fails closed; same verified email may reconcile a newly issued Access subject | Operator/IdP account recovery can still change who controls an email |
| Accidental administrator lockout | Configured administrators are forced active and cannot be blocked through the ordinary admin status endpoint | Losing every configured Access admin identity requires a deployment configuration change |
| Public `Allow Everyone` attracts too many users | Cosmic registration mode can switch to approval/closed independently of Access; dedicated admin controls and rate limits | Existing active accounts continue when registration is closed by design |
| D1 privacy creep | Schema excludes API keys, audio, transcripts, prompts, filenames and fingerprints; static audit/mutation guards inspect the schema | Future migrations must preserve this discipline |
| Usage-stat double counting / false completion | Distinct per-job/per-chunk attempt state separates attempts from logical completion | Metrics are operational counters, not billing invoices |
| Staging data crosses into production | Separate release-verified D1 names/IDs and verifier checks | Cloudflare-account administrator can still misconfigure resources outside source control |
