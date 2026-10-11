# Comprehensive User Manual

## Product scope
Cosmic Transcriber Web 1.1.1 is an MP3 completed-file transcription application. It preserves the applicable behavior of Windows 1.0.27 while using browser-native downloads and IndexedDB checkpoints instead of desktop output folders and DPAPI.

## API-key status
The header shows whether a short-lived secure key session is configured and its expiry. **Replace API key** overwrites the browser’s credential session only while no transcription job is active; credential replacement is locked during a run so one job cannot silently switch billing credentials between chunks. **Forget API key** clears the cookie on this browser; with a stateless cookie this cannot retroactively invalidate a copied token. If compromise is suspected, revoke/rotate the OpenAI key at OpenAI.

**Test key** performs a disclosed tiny 0.25-second transcription request because unrelated OpenAI endpoints can be denied to an otherwise valid Restricted transcription key. It may incur minimal API usage and requires explicit confirmation.

## Files
V1 accepts MP3 and uses tolerant frame recovery for real-world files: leading/trailing non-audio bytes, embedded junk between recoverable frame runs, standard ID3 metadata, and a decoder-tolerable partial terminal frame no longer make an otherwise usable recording fail import. Files with no recoverable MPEG audio frames still fail. Queue duplicate prevention uses content fingerprint + size, not filename alone, including when the existing prepared row previously failed. Same filename with different content remains allowed. Files are sorted naturally. The queue ceiling is 10,000 files, matching the desktop safety invariant.

## Models
- GPT Transcribe: recommended general completed-file option; multiple expected-language hints, keyword hints and prompt/context. Language hints accept syntactically valid two- or three-letter lower-case codes plus `zh-cn`, `zh-tw`, and `zh-hk`; OpenAI remains authoritative for which three-letter codes the current service actually supports.
- GPT-4o Transcribe Diarize: speaker labels; one optional two-letter ISO-639-1 language hint; no prompt/keyword fields.
- GPT-4o Transcribe: high-quality file transcription; one two-letter ISO-639-1 language hint.
- GPT-4o Mini Transcribe: lower-cost option; one two-letter ISO-639-1 language hint.

The model list is versioned server-side. Live/realtime-only models do not appear as file choices. The UI marks per-minute prices as dated estimates rather than invoice guarantees. The main OpenAI pricing table publishes per-minute estimates for the ordinary file models; the dedicated diarization model page publishes its audio-token rates, while OpenAI’s generated developer reference also reports an estimated $0.006/minute for diarization. Cosmic keeps that diarization display labelled **Approx.** because the primary pricing table currently omits it.

## Local settings privacy
Prompt/context, keywords/glossary text, model selection, language hints and other non-secret preferences auto-save in this browser profile so the UI restores them on the next visit. The OpenAI API key is **not** saved there, but prompt/keyword text can still be sensitive. On a shared device, avoid sensitive context or clear this site's browser data afterward.

## Chunking
Audio is scanned frame by frame and resynchronizes after non-audio regions when a trustworthy subsequent MPEG frame run is found. Complete frames are never split; a bounded partial terminal frame may be retained only in the final chunk so tolerant decoders can recover it. Non-diarized jobs can include a short preroll from the previous part to help continuity; logical output time excludes preroll. Diarized jobs use no overlap, avoiding duplicate speaker-labelled content. Xing/Info/VBRI carrier metadata is retained where decoder safety requires it and its whole-file counters are rewritten for generated chunks.

## Context chain
With previous-part context enabled, later checkpoint chunks are reused only while the chain is intact. After a missing chunk, later cached chunks are recomputed because they could have been prompted using a different preceding transcript.

## Diarization
Speaker identifiers from independently uploaded parts are not assumed globally stable. Output deliberately labels them as `Part N · Speaker X`.

## Retry/cancel
Only explicit safe rejections such as a rate-limit rejection are eligible for configured automatic retry. If the request may have reached OpenAI but the response was lost, the UI warns that retrying could cause a second charge and asks explicitly. Cancel stops new parts and aborts the current browser request where possible; it cannot guarantee avoidance of charges after OpenAI started processing.

## Checkpoints
Checkpoints contain safe metadata, settings identity, a strong source hash, per-chunk hashes/boundaries, successful transcript results, and a pseudonymous scope derived by the Worker from the verified Cloudflare Access subject plus configured origin. They do not contain raw audio, OpenAI keys, Access JWTs, email addresses, raw Access subjects or credential cookies. A different authenticated Access user cannot reuse another user's checkpoint in the same browser profile. Corrupt/stale/wrong-source/wrong-user checkpoints fail closed.

Presentation-only choices such as including timestamps in downloaded output do **not** change paid-work identity, so changing an export presentation toggle does not by itself force retranscription.

## Downloads
TXT and Markdown are generated using text-only data. Transcript contents are never executed as HTML. Filenames are sanitized against controls, paths and Windows reserved device names. Export strings are generated lazily only when a download is clicked, avoiding duplicate in-memory transcript copies. Presentation-only changes (TXT/Markdown/timestamps) regenerate available output locally and never require a paid retranscription. Combined export is limited to 1,000 files and is withheld unless every prepared file has completed **under the same transcription-settings identity**, so a partial or mixed-model/mixed-prompt combined transcript cannot look complete. Per-file downloads remain available when completed files came from different request settings. Per-file aggregate transcript text is capped at 25,000,000 characters, matching the desktop safety invariant.

## Browser lifecycle
Keep the tab open during active V1 processing. Navigation is warned. Run-affecting settings and BYOK replacement are locked while a job is active so the visible controls cannot imply that the already-snapshotted job changed mid-run; Cancel remains available. Offline transitions preserve completed local checkpoints. V1 does not claim to continue after the tab/browser closes.
## Re-running completed audio with another model (1.0.15)

After a file completes, change the model/settings if desired and use **Run completed again**. Cosmic Transcriber shows an explicit paid-run confirmation. If the exact same completed settings checkpoint is still valid, it can be reused without sending another paid request; changed model/settings use a distinct checkpoint identity and may create new OpenAI charges. Download any result you want to keep before rerunning because the row's download result will be replaced.

## Detailed diagnostics (1.0.15)

Use **Download detailed diagnostics** when reporting a problem. The JSON includes bounded timing/correlation information, checkpoint and retry state, transport classification, MP3 recovery counters, browser online/visibility state, and Worker/OpenAI request IDs where available. It intentionally excludes filenames, API keys, cookies, authorization headers, prompts, transcripts, audio contents, source fingerprints and authenticated principal identifiers.


## Cosmic account status and registration (V1.1)

Cloudflare Access remains the login screen. After successful Access authentication, Cosmic resolves a lightweight application account:

- **Active** — normal BYOK and transcription controls are available.
- **Pending** — the site is visible, but API-key setup and transcription are disabled until an administrator approves the account.
- **Blocked** — paid/API-key operations are disabled. Session status also clears the browser's Cosmic BYOK cookie.
- **Registration closed** — the administrator has paused creation of new Cosmic accounts; no account row is created for a new Access identity.

Existing active users continue when registration is closed.

## Administrator panel (V1.1)

Configured administrators see an administrator panel containing registration mode, user counts, recent/new users, aggregate jobs/chunks/audio usage, model usage and a user table. Administrators can change registration mode and set non-administrator users to Pending, Active or Blocked. Administrator identities are deployment-configured and cannot be blocked from this panel.

The administrator statistics are operational estimates/counters. They are not OpenAI invoices and do not contain transcript text or audio.
