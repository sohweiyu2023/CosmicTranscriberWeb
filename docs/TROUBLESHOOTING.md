# Troubleshooting

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

## The `deploy\CosmicTranscriberWeb-1.0.15` folder does not exist
A deploy folder is created only after every local release gate passes and the certified ZIP proves `releaseReady:true`. In 1.0.15 `RELEASE-WINDOWS.ps1` extracts that ZIP automatically and prints the exact `Prepared deployment folder:` path. If certification failed, the absence of that folder is expected. Do not guess a path or manually continue from the candidate.

## `npm ci` says `package-lock.json` is missing
You are almost certainly still in the audit-candidate tree. That tree deliberately has no fabricated lock and is marked `releaseReady:false`. Run certification successfully first, then change to the **prepared deployment folder printed by `RELEASE-WINDOWS.ps1`** and run `npm ci` there.

## Wrangler says it is not installed
This normally follows the previous problem: `npm ci` never succeeded in the certified deployment copy, so `node_modules` does not contain Wrangler. Do not install Wrangler globally to bypass the project gate. Enter the prepared certified deployment folder and run its clean `npm ci`.

## `deploy-verify` says `releaseReady` is false or Access placeholders remain
`releaseReady:false` means you are using the audit candidate, not the certified release. Placeholder Access values are separately intentional until you configure a certified deployment copy. After successful certification run `npm run configure:access:staging` (or `:production`) in the prepared deploy folder; the helper changes only the permitted team-domain/AUD fields and restores the original config if provenance validation fails. Complete registry configuration next, then run the final `deploy-verify` gate.

## Audit candidate has no package-lock.json
Do not deploy it as a certified release. On a clean Windows/public-registry checkout, create/update the real lock with the reviewed dependency workflow, prove `npm ci`, then run all release gates and create the release-mode ZIP. Never copy the unrelated Wake Call lock into Cosmic Transcriber.
## A transcription appears stuck for a long time (1.0.15)

The browser now shows an elapsed `Uploading / waiting for OpenAI` phase rather than a fake percentage while an in-flight request is awaiting a definitive response. Diarization can take materially longer than ordinary transcription. Avoid refreshing or cancelling merely because the request is slow. If a browser/network interruption occurs after dispatch, the app preserves the attempt as billing-ambiguous and asks for explicit confirmation before a potentially duplicate paid retry. Download the detailed diagnostics JSON before changing site data when possible.

## Browser/network interruption versus Cancel (1.0.15)

Only an explicit user cancellation is reported as **Cancelled**. A browser transport/network interruption is classified separately (for example `browser_transport_abort`, `browser_network_error`, `browser_offline` or `browser_transport_error`) and remains conservative about possible OpenAI billing after dispatch.

