# User Registry and Administrator Controls — V1.1

Cosmic Transcriber Web continues to use **Cloudflare Access as the authentication authority**. V1.1 does not introduce passwords or a second authentication system. The Worker independently validates the Access JWT and then maps the verified Access identity into a privacy-minimal Cosmic user registry stored in Cloudflare D1.

## Identity model

- The Access JWT `sub` is the primary current identity handle.
- A normalized verified Access email is stored so an account can be reconciled if Cloudflare later issues a different `sub` for the same verified email.
- A request presenting an existing `sub` with a different verified email fails closed instead of silently renaming the Cosmic account.
- Administrator authority comes from the deployment-only `ADMIN_EMAILS` list and is checked against the **verified Access email** on every administrator API request.
- Administrator accounts are forced active and cannot be blocked through the normal admin UI, preventing accidental administrator lockout.

The registry never treats a browser-supplied email as authoritative.

## Registration modes

The administrator dashboard exposes three modes:

- **Open** — a newly authenticated Access identity becomes an active Cosmic user immediately.
- **Approval required** — a new identity is created as `pending`; transcription and BYOK setup remain disabled until an administrator activates it.
- **Closed** — no new Cosmic user row is created. Existing active users continue to work. This is the recommended emergency switch when a public `Allow → Everyone` Access policy attracts more registrations than desired.

Changing the mode is a server-authorized administrator operation and is recorded in the administrator audit table.

## User states

- `pending` — authenticated, but paid/API-key operations are unavailable.
- `active` — normal application access.
- `blocked` — paid/API-key operations are denied and the browser BYOK cookie is cleared when session status refreshes.

Static application assets remain behind Cloudflare Access. Blocking is an application authorization control, not a replacement for Access session revocation. For an abuse incident, an operator may additionally add an Access-policy `Exclude` rule for the user and revoke their Cloudflare Access session.

## Stored metadata

D1 stores only operational/account metadata required for administration and aggregate statistics:

- internal numeric user ID;
- current Access subject;
- verified email;
- status and timestamps;
- aggregate jobs/chunks/bytes/audio-duration counters;
- per-model aggregate request/success/failure/bytes/duration counters;
- job/chunk attempt state needed to avoid falsely marking retried work complete;
- administrator action records by internal user ID.

The V1.1 registry is deliberately not designed to store:

- OpenAI API keys;
- BYOK cookie contents;
- raw audio;
- transcript contents;
- prompts or glossary/keyword text;
- source filenames;
- source fingerprints.

## Administrator dashboard

An authenticated configured administrator can:

- see total/active/pending/blocked/new/recent users;
- see aggregate jobs, chunks, bytes and audio duration;
- see aggregate model usage;
- list users and their privacy-minimal usage counters;
- change registration mode;
- set non-administrator users to pending, active or blocked.

All admin API routes independently require administrator authorization server-side and have a dedicated Worker rate-limit binding.

## Environment isolation

Staging and production use separate D1 databases:

- `cosmic-transcriber-web-staging-users`
- `cosmic-transcriber-web-production-users`

Their private database UUIDs are deployment-specific mutable fields; names, binding names and migration directory remain release-certified. Database migrations are applied before every Worker deployment and are tracked by Wrangler/D1 migrations.
