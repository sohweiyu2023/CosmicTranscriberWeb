# Owner-accepted desktop Safari verification exception

Decision recorded 18 October 2026, 14:07:22 UTC. The owner requested production promotion after reporting successful staging upload, processing and Markdown download in iPhone Safari, and explicitly accepted proceeding if the remaining macOS failure is an environment limitation. This exception is confined to that native Safari verification gap. Security, configuration, database, rollback and other platform checks remain required.

The strict genuine SafariDriver 26.6.2 test remains **FAIL**, not PASS. Full/sliced reads of a genuine world-readable disk MP3 return `NotReadableError` before provider dispatch. In CI run `39110749560`, job `117630641130`, the app shell and mocked BYOK checks passed, the original fixture remained unchanged, and provider calls were zero. The native workflow and download checks after the failing preparation were **NOT RUN**. The strict final-release aggregator failed as designed.

Independent minimal-input reproduction without Cosmic application JavaScript failed at four disk locations in diagnostic run `38190596056`, job `114622330515`. That failure also used a recent disk timestamp, weighing against the ZIP's old timestamp as a complete explanation. This localizes the observed problem to the browser/driver/host file-selection/read path rather than Cosmic's transcription logic. A sandbox-grant regression is a hypothesis, not a proven root cause. Ordinary desktop Safari user-picker behavior was not established by the hosted GUI probe. Issue: https://github.com/sohweiyu2023/CosmicTranscriberWeb/issues/6

The user's iPhone success provides actual mobile Safari happy-path evidence; it does not certify desktop Safari, all formats, cancellation, billing safeguards or every model. A separate service-worker network upload regression is not the same symptom: here page-level byte reads fail before network upload. Do not substitute synthetic Files, rewrite fixture bytes/timestamps, report a fake Safari pass or remove security assertions.

This release uses the existing Windows package verification and fresh native ZIP replay, with external Linux/Windows/macOS non-native platform receipts from CI run `39110749560`. Final packaging changes only generated release metadata/checksums and this disclosure; runtime, lock and fixture bytes must match the tested CI artifact. The artifact's `certificationLevel:release` indicates the packager completed under this owner-accepted exception, not that strict desktop Safari passed. Retain this disclosure with the release and its operational evidence.

Accepted source commit: `af4c082cd9d91578c886dddcdfc134e3e13a0704`.
Accepted staging source ZIP SHA-256: `7d97ecf9a611f210b092afb3faaf3d90e4ec84c42fd7a38e4b27af802047f18a`.
Accepted lock SHA-256: `f9c4680fe445085acbb1d0495b80dee0b0e744a3184396919e1fc1237215c24e`.

Residual risk: ordinary macOS Safari remains unverified. Complete genuine desktop Safari acceptance when a supported host is available, keep the original failed receipts, and investigate failures without weakening byte identity or authorization/billing checks. No new paid acceptance calls are authorized by this exception.
