# Owner-approved Safari automation exception for the 1.2.0 regression release

On 22 October 2026 at 05:16 UTC, the owner requested investigation of the Safari failure and authorized a documented exception if a supported fix could not be established. This decision covers the 1.2.0 regression release based on main `a1846e5ee8e5c15af9c18d3e103b7496ddc5470d`. It supersedes the Safari-only blocking decision for this release; all unrelated release requirements remain mandatory.

## Investigation and unresolved limitation

In [run 39717593401](https://github.com/sohweiyu2023/CosmicTranscriberWeb/actions/runs/39717593401), genuine Safari 26.6.2 failed reading the first native MP3 with `NotReadableError: The I/O read operation failed.` The sliced `arrayBuffer` and `FileReader` reads also failed; blob URL fetch returned `TypeError: Load failed`. Shell, HTTPS and mocked BYOK checks passed. Original fixture bytes and timestamps were unchanged. Provider calls and recorded requests were zero. Transcription and download acceptance after preparation were **NOT RUN**.

The minimal-input diagnostic in [run 38190596056](https://github.com/sohweiyu2023/CosmicTranscriberWeb/actions/runs/38190596056), job 114622330515, reproduced the error without Cosmic application JavaScript at four disk locations with a recent timestamp (2026-10-12T01:06:37.252Z). This contradicts an old ZIP timestamp as the complete cause. The harness already keeps the native input visible during reads and stages world-readable files. The later paired fresh-timestamp probe exists in source, but no executed receipt for that extra candidate was established during this review.

No supported fixture or harness repair was established. A SafariDriver/host file-access problem is supported by the minimal reproduction; its precise root cause is unresolved. A sandbox-grant regression remains a hypothesis. The separate [WebKit network-upload bug 319985](https://bugs.webkit.org/show_bug.cgi?id=319985) allows page-level reads and therefore does not explain this signature. [BiDi input.setFiles support](https://bugs.webkit.org/show_bug.cgi?id=287926) was still unresolved when checked. Do not replace native files with synthetic objects, alter fixture bytes/timestamps, change browser permissions, or label this as a fixed application crash.

**Genuine Mac Safari not validated.** The owner's successful iPhone Safari upload, processing and Markdown download is separate user-reported evidence. It does not certify desktop Safari, all formats, cancellation, retry or billing behavior.

## Exact permitted exception

`scripts/safari-release-exception.mjs` accepts only package version 1.2.0 and the existing reviewed SafariDriver 26.6.2 first-MP3 signature. It requires the exact bundled 16,941-byte MP3 digest, original before/after identity, native `safaridriver-sendkeys` selection with no picker workaround, the three initial passing checks, preparation FAIL, workflow NOT RUN, canonical reader errors, zero provider calls, zero recorded requests and preserved fixtures. Missing evidence, different versions/files/errors, synthetic selection, cleanup, driver, server or integrity failures are rejected.

CI continues to execute the genuine Safari test and preserves its failed report. A separate exception step records **WAIVED**, with `genuineMacSafariValidated:false`. The release browser gate requires successful Linux, Windows and macOS jobs plus either genuine native Safari success or this separately verified exception. A green eligibility gate with the exception is **not** a passing Safari certification and is not complete production certification. Unknown, cancelled, skipped and unrelated failures remain blocking.

The existing staging-only waiver is unchanged in scope. CI still produces staging ZIPs with `releaseReady:false`. No deployment triggers, security/authentication assertions, dependency gates, billing safeguards, source/lock checks, database migration or rollback requirements are relaxed. Runtime, fixtures, lockfile and production configuration are unchanged by this exception.

## Deployment requirements retained

The supported production target remains the existing Access-protected `https://transcriber.awakeningtoreality.com`. Source-only public promotion remains the policy; this decision does not create a hosted public trial. Final packaging and deployment still require exact-source external CI and live staging acceptance, the existing authenticated Cloudflare account, preserved access controls and BYOK secret, verified production configuration and a recorded rollback version. Older receipts for different source/lock bytes are not transferred to this release.

This decision does not authorize new credentials, permission or security changes, paid API tests, public releases or billing changes. Where one of these is mandatory, stop that step and report the requirement. Keep the native Safari failed receipt and this disclosure with any eventual release; repeat genuine desktop Safari acceptance when supported validation is available, and retire the exception when the native test can pass.
