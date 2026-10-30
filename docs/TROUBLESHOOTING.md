# Troubleshooting

## Privacy-safe diagnostics and their limits

Download detailed diagnostics before reloading or clearing site data. Revision `typed-bounded-detail-3` retains at most 1,200 typed events in the current page's memory. The export includes observed, retained, dropped, unknown-classification and failed-write counts; `completeObservedStream` applies only to that page's observed stream, never all browser, Worker, Cloudflare or provider activity. A reload discards these events. The downloaded JSON remains wherever your browser saves downloads until you remove it; there is no new telemetry destination or automatic upload. Preference read/parse/write/repair failures are classified without including stored preference contents. Existing preferences/checkpoints are separate storage and are not erased by downloading diagnostics.

Worker operational events use schema `cosmic-worker-operational-2`, finite routes/stages/error categories, bounded numeric measurements and format-checked correlation IDs. Correlate app request IDs with provider request IDs when present. Unknown identifiers/categories are omitted or labelled unknown; messages, stacks, arbitrary provider bodies, path parameters, email addresses, API keys, cookies, Access assertions, audio, transcript text and prompt contents are not retained by these logging functions. Provider error code/type and transport code are retained only from finite allowlists. Browser exports retain only a coarse family/major-version hint, not the raw user-agent string; that hint cannot establish genuine Safari validation. Typed server version/account state is retained without identity details. An oversized or interrupted response can still have a useful provider request ID; its billing status remains ambiguous. Logs do not authorize an automatic paid replay.

The sink is best effort: a console failure cannot turn a successful provider response into a failed transcription or prevent result accounting. `droppedBefore` counts failed writes since the previous successful write in the same Worker isolate, not a global or durable delivery receipt. Existing production Cloudflare sampling/retention settings still apply; a missing log is not proof of zero execution. Review the Cloudflare dashboard's actual retention for your account rather than assuming a fixed retention period. Browser export and server logs are complementary, not a complete audit ledger. Durable dispatch/result receipts remain authoritative for attempt accounting; diagnostic loss never resets them.

If a report says unknown, incomplete, dropped or failed writes, preserve it and the relevant app/provider request IDs. Do not paste raw provider response bodies, recordings, transcripts, keys or cookies into a bug report. A secret deliberately disguised as a syntactically valid correlation identifier cannot be distinguished solely by its format: callers must continue using generated random IDs, not user content. Do not infer a resolved network cause or a safe retry from an unknown category.

## API key rejected
Authentication failure means OpenAI did not accept the credential. Permission denied can mean a valid Restricted key lacks transcription permission. Quota/billing and model availability are reported separately. Use the disclosed tiny **Test key** request when appropriate.

## Session expired
Re-enter your API key. Local transcript checkpoints remain independent of the BYOK credential cookie.

## MP3 rejected
The parser is deliberately tolerant of common real-world MP3 irregularities: it can skip leading/trailing non-audio bytes, resynchronize after embedded junk, and retain a bounded partial terminal frame for tolerant decoders. It still rejects an empty file or a file in which no trustworthy MPEG audio frame run can be recovered. If such a file plays elsewhere but is still rejected, keep the original and report it as a compatibility sample rather than merely renaming or re-encoding it.

## Resume refused
You must reselect the exact same source content and use identical settings/chunking. Filename alone is not enough. A changed model, language, prompt, keywords, chunk size/duration or context setting intentionally creates a different work identity.

## Ambiguous retry warning
The previous upload may have reached OpenAI. The app cannot prove that no charge occurred after a connection/timeout failure. Retry only if you accept possible duplicate usage.

## Diarization speakers change between parts
Expected. Each independently uploaded part can restart speaker labels. Cosmic deliberately preserves `Part N · Speaker X` rather than claiming global identity.

## Safari issue
Capture browser version, steps and scrubbed diagnostics. Do not include an API key or sensitive transcript/audio. Follow `SAFARI_MAC_ACCEPTANCE.md`.


## Worker/Vitest says the compatibility date is newer than workerd
Web 1.0.15 pins the release compatibility date to `2026-08-08`, the newest date supported by the reviewed `workerd` line in the supplied Windows dependency graph. If this error appears after a future dependency update, do not blindly advance the date: update the current Cloudflare tooling/workerd first, verify its supported date, then intentionally change the release date and rerun Worker/integration/mutation gates.

## Worker tests ask for the real production BYOK secret
That is a regression. Normal 1.0.15 unit tests inject a clearly synthetic test-only master key through the Workers Vitest test binding. Do not export or reuse a staging/production master key for unit tests.

## `npm run deps:latest` returns immediately with no child-command output
Web 1.0.1 could silently hit a Windows `spawnSync("npm.cmd")` failure. Web 1.0.15 invokes npm through `process.env.npm_execpath` and treats spawn errors/non-zero exits as failures. On 1.0.15 you should see the dependency-update/install/audit/validation child commands; an unexpectedly silent return is not a successful dependency upgrade.

## E2E cannot find the old heading/theme/Cancel selector
Web 1.0.1 had stale Playwright locators. Web 1.0.15 asserts the actual accessibility contract (`Your API key, your usage`, theme accessible name `Switch theme`) and scopes the key-dialog Cancel button uniquely. Do not change accessible UI names merely to satisfy an old test log.


## Toolchain reports the wrong machine Node version
Cosmic Transcriber Web 1.1.1 does not require you to uninstall, downgrade or switch the machine-wide Node installation. The guided runner downloads an official portable Node 26.7.0 archive into the per-user Cosmic toolchain cache, verifies its architecture-specific published SHA-256, and installs private npm 12.0.2. For PowerShell it binds `npm` to the exact private `node.exe + npm-cli.js` pair so Node's bundled npm 11 `npm.ps1` cannot win command resolution; child package scripts receive the private npm prefix first on PATH. If either exact verification reports a different version, stop and send the complete log; do not modify global PATH or continue to deployment manually.


## Private npm activation says npm 11.17.0
That was the 1.0.10 PowerShell-command-precedence defect. Node 24.19.0 legitimately bundles npm 11.17.0, but Cosmic certifies with npm 12.0.2. 1.0.15 no longer trusts bare `npm.ps1`/`npm.cmd` discovery: it binds PowerShell `npm` to the exact private npm 12 CLI and verifies both the absolute CLI and bound command before any dependency work. Do not manually delete Node's bundled npm files or alter global PATH.

## Portable Node download/hash verification fails
Do not bypass the check or substitute an unofficial archive. Confirm internet access to the official Node distribution and rerun. A cached archive whose SHA-256 does not match the pinned official release checksum is deleted and downloaded again; a repeated mismatch is a hard stop.

## The prepared deployment folder does not exist
`RELEASE-WINDOWS.ps1` creates and extracts a staging-certified ZIP only after its local gates pass, then prints the exact `Prepared deployment folder:` path. Its manifest correctly remains `releaseReady:false` with `certificationLevel:staging`. If certification failed, no deployable folder is promised. Do not guess a path or continue from an audit candidate; external Linux/macOS CI must also pass before staging deployment.

## `npm ci` says `package-lock.json` is missing
A release-certified ZIP includes its audited `package-lock.json`. Check the exact checkout/extraction and manifest before continuing. Restore the lock only from that matching certified source artifact; do not copy a foreign lock or resolve fresh dependencies inside a certified deployment extraction. A clean development checkout may require the reviewed lock-generation workflow and a newly certified artifact. The prepared staging folder is the exact path printed by successful `RELEASE-WINDOWS.ps1`, not a guessed audit folder.

## Wrangler says it is not installed
This normally follows the previous problem: `npm ci` never succeeded in the certified deployment copy, so `node_modules` does not contain Wrangler. Do not install Wrangler globally to bypass the project gate. Enter the prepared certified deployment folder and run its clean `npm ci`.

## `deploy-verify` says `releaseReady` is false or Access placeholders remain
Inspect `certificationLevel` and checksum/lock provenance as well as the flag. A verified `releaseReady:false`, `certificationLevel:staging` ZIP is valid only for staging; an audit candidate is blocked everywhere. Production requires the separate final `releaseReady:true`, `certificationLevel:release` ZIP produced by Windows `npm run package:source` on accepted source after all-platform CI and live staging acceptance. Never flip the flag manually. Placeholder Access values remain intentional until environment configuration; use the corresponding `configure:access:*`, then registry configuration and `deploy-verify` in the correct certified extraction. Existing upgrades must not use `FIRST-DEPLOY-WINDOWS.ps1` or `deploy:first:*`.

## Audit candidate has no package-lock.json
Do not deploy it as a certified release. On a clean Windows/public-registry checkout, create/update the real lock with the reviewed dependency workflow, prove `npm ci`, then run all release gates and create the release-mode ZIP. Never copy the unrelated Wake Call lock into Cosmic Transcriber.
## A transcription appears stuck for a long time (1.0.15)

The browser now shows an elapsed `Uploading / waiting for OpenAI` phase rather than a fake percentage while an in-flight request is awaiting a definitive response. Diarization can take materially longer than ordinary transcription. Avoid refreshing or cancelling merely because the request is slow. If a browser/network interruption occurs after dispatch, the app preserves the attempt as billing-ambiguous and asks for explicit confirmation before a potentially duplicate paid retry. Download the detailed diagnostics JSON before changing site data when possible.

## Browser/network interruption versus Cancel (1.0.15)

Only an explicit user cancellation is reported as **Cancelled**. A browser transport/network interruption is classified separately (for example `browser_transport_abort`, `browser_network_error`, `browser_offline` or `browser_transport_error`) and remains conservative about possible OpenAI billing after dispatch.


### Bounded paid continuation after a successful smoke

One MP3 smoke consumes one of the nine approved request slots, leaving eight.
A full nine-call runner would exceed that authorization. Preserve the receipt
and conservative reservation; do not reset spending from an estimated charge.
Inspect all CI attempts, including failures and reruns. A failed response is not
proof that processing was unbilled.

Per-block model limits cannot bound a request with an unspecified number of
automatic internal chunks. The short-WAV candidate proves PCM duration from
server-validated bytes before omitting optional chunking. Never trust client
duration, invent a transcription `max_output_tokens` parameter, or apply this
bound to source that still requests `auto`. A changed source also prevents an
old-source MP3 receipt from becoming new-source full certification.
## Hosted Linux media provisioning: slow Ubuntu Azure mirror

PR20 CI 40003319903 attempt 2 reached the unchanged 240-second ffmpeg install deadline while the official Azure mirror trickled an 8998 kB package over more than three minutes. Worker/integration/browser tests had not begun. Windows whole-Worker integration 24/24 passed on that same source, including the new WAV route tests; macOS certification also passed, retaining the disclosed Safari waiver.

GitHub's [runner image source](https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt-sources.sh) already lists https://archive.ubuntu.com/ubuntu/ as its official fallback. Its [tracked slow-transfer issue](https://github.com/actions/runner-images/issues/14823) explains why idle timeouts do not cover a transfer that continues slowly. When installation is required on an identified GitHub-hosted Linux runner, the provisioner validates that exact existing three-mirror list and gives the existing HTTPS Ubuntu archive first priority. Unknown lists fail closed; other hosts and ready toolchains are untouched. No additional mirror, package source, keyring or trust option is added. APT authentication, finite update/install deadlines and post-install ffmpeg/ffprobe codec verification remain mandatory. This is a new reviewed-head repair, not another unchanged CI retry or a skipped test gate.

