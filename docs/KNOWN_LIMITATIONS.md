# Known Limitations

- Supported inputs are MP3, FLAC, MP4, MPEG, MPGA, M4A, OGG, WAV and WebM. MP3 uses frame-aware preparation; other formats use whole-file uploads within 24,000,000 bytes. MPGA must be complete MPEG Layer III audio; an extension alone does not establish validity.
- Active transcription jobs require the tab to remain open; durable background jobs are intentionally deferred to V2.
- After browser restart the user must reselect the original source file; raw audio is not checkpointed.
- Stateless BYOK cookie deletion does not retroactively revoke a stolen copy; revoke the OpenAI key if compromise is suspected.
- No global speaker identity mapping across independently diarized parts.
- OpenAI diarization may support optional known-speaker reference inputs, but V1.1 does not collect/upload those reference recordings.
- No server-side cross-tab/device at-most-once coordinator; separate tabs/devices can intentionally submit the same paid work.
- Cost displays are dated estimates, not invoices. Administrator usage counters likewise record application attempts/declared media, not authoritative OpenAI billing.
- Cloudflare Access `Allow → Everyone` still consumes Zero Trust user seats for authenticated identities; V1.1 Cosmic registration controls do not change Cloudflare seat accounting.
- Blocking a user in Cosmic prevents application paid/BYOK operations but does not by itself revoke an already-issued Cloudflare Access session. For abuse response, also use an Access-policy exclusion and Access session revocation when appropriate.
- IndexedDB checkpoints remain inside the local browser profile; a malicious local browser-profile administrator/extension is outside the app trust boundary.
- D1 stores verified email and Access subject as account metadata. Operators requiring anonymous/pseudonymous registration should not enable the V1.1 registry without redesigning that requirement.

- Genuine desktop Safari remains FAIL/WAIVED only for the documented native-file `NotReadableError` signature. Playwright WebKit and a user-reported iPhone Safari success do not establish genuine Mac Safari acceptance. See [the platform policy](BROWSER_RELEASE_POLICY.md) and [the staging exception](SAFARI_MAC_ACCEPTANCE.md).
- OpenAI's file-transcription guide now schedules the legacy `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe-diarize` and `whisper-1` models for shutdown on 26 February 2027. Existing compatibility does not establish availability after that date; model migration requires its own schema, pricing and regression review. The current ordinary-transcription default remains `gpt-transcribe`. See [external assumptions](EXTERNAL_ASSUMPTIONS.md).
