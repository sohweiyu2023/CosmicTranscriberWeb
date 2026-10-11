# Privacy and Data Flow

V1 intentionally does not permanently store source audio or transcripts on Cosmic Transcriber server-side storage.

```text
local source file → bounded browser slice/chunk → Cloudflare Worker → OpenAI → Worker → browser → local IndexedDB result checkpoint/download
```

The user supplies their own OpenAI API key. It is sent over HTTPS to the Worker during secure-session setup, decrypted server-side only when required for OpenAI requests, and not returned to frontend JavaScript. Cloudflare relays audio; OpenAI receives/processes it. Therefore it would be false to claim that audio never leaves the device.

IndexedDB can retain source fingerprints, transcription settings identity, chunk boundaries, completed transcript results and a pseudonymous checkpoint scope derived from verified Access subject + configured origin. It does not retain raw audio, OpenAI keys, Access JWTs, email addresses or raw Access subjects by design. Browser preferences are in localStorage. This includes non-secret transcription settings and the user-entered prompt/context and keyword/glossary text, which can itself be sensitive even though it is not a credential. On a shared browser profile, avoid sensitive prompt/keyword context or clear this site's browser data afterward. Checkpoints from one Access subject are not reusable by another subject in the same browser profile.

Automatic Cloudflare invocation logs are disabled in Wrangler because those logs can include request/response metadata. Sampled custom Worker logs remain enabled and are designed to contain only safe request/version/status/timing identifiers and an origin-scoped pseudonymous user identifier. They must not contain audio, transcript, prompt/glossary, filenames, OpenAI keys, encrypted credential cookies, Authorization headers, Access JWTs or email addresses.

OpenAI data handling is governed by the user’s applicable API account terms and data-control configuration. Users should review OpenAI’s current API data controls before processing sensitive material.

## V1.1 user/admin metadata

V1.1 adds a small Cloudflare D1 registry. This does **not** change the audio/transcript content path shown above. D1 receives verified Access identity metadata (current subject and email), Cosmic account status/timestamps and aggregate operational counters such as jobs, chunk attempts, declared bytes/audio duration and model-level success/failure counts. Administrator actions are recorded by internal user IDs.

D1 is not used to store OpenAI API keys, raw audio, transcript contents, prompt/glossary text, filenames or source fingerprints. Staging and production use different private D1 databases. Closing registration prevents creation of a new Cosmic user row; blocking an existing user prevents BYOK/paid operations.
