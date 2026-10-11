# Known Limitations

- V1.1 accepts MP3 only; broader WAV/M4A/FLAC/OGG/WebM/MP4 support remains planned V1.x work.
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
