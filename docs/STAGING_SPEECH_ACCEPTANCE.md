# V1.2.0 staging nine-format speech acceptance - audit candidate

This is a staging-only certification improvement. The existing `format.*` one-second
440 Hz tone fixtures remain unchanged for browser/file-container ingestion tests.
The paid nine-format acceptance instead uses `staging-speech.*` for MP3, FLAC,
MP4, MPEG, MPGA, M4A, OGG and WebM. The ninth request uses the unchanged
`staging-wav-diarization.wav` for real two-speaker diarization.

## Provenance and review

All eight speech files are 12-second transcoded excerpts from the existing,
reviewed `tests/fixtures/staging-wav-diarization.wav` (mono PCM16, 16 kHz).
No new external media or third-party recordings were introduced. The binary
files are bundled in the uncommitted audit-only candidate and covered by `SHA256SUMS.txt`; they are not yet certified by the live GitHub branch.
Their observed durations with FFprobe were MP3/MPEG/MPGA 12.096 seconds,
WebM 12.008 seconds, and all other formats 12.000 seconds. The paid metadata
uses these durations, and each file is checked against its reviewed SHA-256
before any potentially billable request.

Reproduction recipe (requires FFmpeg with libmp3lame, libvorbis and libopus):

```sh
source=tests/fixtures/staging-wav-diarization.wav
ffmpeg -hide_banner -loglevel error -nostdin -i "$source" -t 12 -c:a libmp3lame -b:a 128k -write_xing 1 -map_metadata -1 -y tests/fixtures/staging-speech.mp3
ffmpeg -hide_banner -loglevel error -nostdin -i "$source" -t 12 -c:a flac -map_metadata -1 -y tests/fixtures/staging-speech.flac
ffmpeg -hide_banner -loglevel error -nostdin -i "$source" -t 12 -c:a aac -b:a 96k -movflags +faststart -map_metadata -1 -y tests/fixtures/staging-speech.mp4
ffmpeg -hide_banner -loglevel error -nostdin -i "$source" -t 12 -c:a libmp3lame -b:a 128k -f mp3 -map_metadata -1 -y tests/fixtures/staging-speech.mpeg
ffmpeg -hide_banner -loglevel error -nostdin -i "$source" -t 12 -c:a libmp3lame -b:a 128k -f mp3 -map_metadata -1 -y tests/fixtures/staging-speech.mpga
ffmpeg -hide_banner -loglevel error -nostdin -i "$source" -t 12 -c:a aac -b:a 96k -movflags +faststart -f mp4 -map_metadata -1 -y tests/fixtures/staging-speech.m4a
ffmpeg -hide_banner -loglevel error -nostdin -i "$source" -t 12 -c:a libvorbis -q:a 3 -map_metadata -1 -y tests/fixtures/staging-speech.ogg
ffmpeg -hide_banner -loglevel error -nostdin -i "$source" -t 12 -c:a libopus -b:a 64k -map_metadata -1 -y tests/fixtures/staging-speech.webm
```

Different FFmpeg versions may produce different bytes. Never silently
regenerate these files inside CI or override reviewed hashes. Any intentional
fixture refresh requires separate code review and coherent same-SHA certification.

## CI replay and billing boundary

The staging deploy and paid nine-format jobs require a first-attempt push run
(`github.run_attempt == '1'`). The paid runner independently verifies
`GITHUB_EVENT_NAME=push`, `GITHUB_RUN_ATTEMPT=1`, a valid `GITHUB_RUN_ID`,
and the exact staging branch before contacting Cloudflare or making any paid
request. GitHub reruns and manual dispatches must fail closed, even if an
operator accidentally reruns previously failed jobs. Offline regression tests
verify that rejected attempts issue zero HTTP requests and zero paid calls.

This is defense in depth against accidental CI replay, not a global billing
ledger. A distinct new push run can still incur up to nine new calls. Before
starting any new authorized run, inspect previous sanitized receipts and
provider billing/registry state; never retry an ambiguous charge without
explicit operator reconciliation. Production deployment remains separate.

## Certification scope and limits

The staging runner still makes at most nine actual transcription requests,
with no retries after ambiguous failures. A successful non-WAV response must
contain at least three English words and twelve letters. This guards against
empty text responses for actual speech audio, but **does not prove transcript
accuracy** or establish a measured word error rate. The WAV additionally
requires meaningful text, two speaker labels, and plausible ordered timestamps.
No transcript contents or BYOK credentials are written to acceptance reports.

This candidate has only offline tests; it has not made real paid calls.
Cloudflare Access authentication and genuine native Safari remain independent
mandatory release blockers. Production V1.1.1 remains untouched.

### Pre-deployment Access verification (audit candidate v26)

The previous v25 preflight called `GET /api/session/status`, which is **not read-only**: the existing Worker calls `resolveUserAccount()` before handling any `/api/*` path, and that function can insert or update D1 rows. This also risks failing before first-time schema migration. Candidate v26 corrects the predeployment check to `GET /` (the protected app shell), which authenticates the signed-in Cloudflare Access JWT in the existing Worker **before** its registry-resolution branch. It verifies HTTP 200, HTML app markers, no-store and the Worker CSP; redirects, rejected credentials, login pages, missing security headers and oversized responses fail closed. No identity or token is logged. The request is nonbillable and cannot write the D1 registry through the inspected Worker route.

**Certification boundary:** The app-shell check proves that the currently deployed Worker accepted the JWT and served its protected UI, **not** that the user's registry account is active or an administrator. After staging migration and deployment, the independent paid-acceptance runner must call `/api/session/status` and require an active/admin account **before any paid call**. That postdeployment call may legitimately update the registry. Administrative/D1/billing reconciliation remains separate. Credential expiry between checks remains possible. Both bare JWT (`Cf-Access-Token`) and explicit `CF_Authorization` cookie formats remain supported.

The preflight checks the currently deployed staging service. If unavailable or incompatible, an authorized operator must diagnose it rather than bypass Access. This is an audit-only change until separately reviewed and certified at an exact GitHub SHA.

# Proposed manual single-MP3 diagnostic (review required before merge/dispatch)

`staging-single-mp3-smoke.yml` is a separate one-request diagnostic. It never
produces the nine-format certification receipt or enables production. It uses
the previously approved cumulative ceiling of nine requests / US$0.25, reserves
US$0.0045 for one fixed 12.096-second `gpt-transcribe` MP3, and leaves eight
request slots. This reservation is based on published US$0.0045/minute pricing,
not a provider-enforced dollar cap. Recheck pricing before approval to run.

The manual workflow defaults to refusal and permits only main/first attempt.
It inspects complete bounded GitHub run/job history, refuses prior manual smoke runs
(even failures/cancellations), refuses previous non-skipped paid acceptance or
concurrent CI, and saves a reservation artifact before a paid-capable step.
An ambiguous request remains reserved: do not rerun, delete history to reset
the allowance, or interpret a failure as proof nothing was charged. The local
ledger/receipt also uses exclusive files and a retained one-shot lock.
Historical CI retries are accepted only when every attempt has exactly one
completed, explicitly skipped paid-job record; missing or ambiguous records block.
GitHub's non-manual invalid-workflow records are exempt only after their full
job lists prove zero jobs and their event/status show completed push/PR validation
failure. A manual attempt is never exempt, even if its job list is empty.

The operator must supply an existing same-repository fixture run/artifact named
`cosmic-approved-single-mp3-fixture`, containing `staging-speech.mp3` only.
The runner requires exactly 194156 bytes and SHA-256
`9a89f3860a66d1d1e0fba139b51fded9a5e0e2f6f19d687616b2efaad1c2f78a`.
This synthetic SAPI fixture is not committed publicly: its public redistribution
rights remain unverified. A secure, authorized fixture artifact must be prepared
before dispatch; this change neither uploads it nor invents an artifact ID.

Existing staging environment secrets are injected only into their required
steps. Cloudflare access is GET-only for the live deployed version/source
annotation; no deployment, credential mutation, policy change or new grant.
The pinned successful deployment is run39945096462/source82392336; current
Worker version must remain `fdbfa10f-d2bb-4c22-bb32-90e6bb522ab7`, at100%.
Its fresh receipt expires after five minutes. An exact source checkout is
checked for tracked edits. No generic API key substitution or key-test call.

Only the final runner can send one `/api/transcribe` request. Other requests
perform protected session checks and encrypted BYOK setup/forget; they may
write normal staging account/usage records. No provider request is retried.
Evidence excludes tokens, identities, transcripts and raw error bodies.
Run-history and the saved reservation cover this Actions path; manual or other
external spending must still be reconciled before any later paid procedure.
One smoke plus a subsequent nine-request suite would total ten and requires
changed request authorization. Existing full-acceptance gates are unchanged.
Safari remains FAIL/WAIVED; genuine Mac Safari is unvalidated.

## Approved single-MP3 artifact publication - 23 October 2026

The separate manual smoke uses `tests/fixtures/approved-single-mp3/staging-speech.mp3`,
not the older nine-format speech MP3. It is exactly 194156 bytes, SHA-256
`9a89f3860a66d1d1e0fba139b51fded9a5e0e2f6f19d687616b2efaad1c2f78a`,
12.096 seconds, mono 16 kHz MP3 at 128 kbit/s. It was generated offline with
FFmpeg 7.1.1/libmp3lame from the first 12 seconds of a preserved synthetic WAV
(SHA-256 `3e6cf6e1fc99bb17e46734c50b5c7fcd3cbc78c9673c5473dafcb3395bad46d3`,
15.0099375 seconds), using Windows SAPI David Desktop and Zira Desktop voices
and original neutral test dialogue. It contains no private recording. The
preserved source differs from the older repository two-speaker WAV; do not
claim this new sample derives from that older recording.

The owner explicitly approved public publication of this exact synthetic MP3
and its CI packaging step on 23 October 2026. This is publication authorization,
not a new MIT grant over binary audio, Microsoft voices, synthesis engines or
other third-party assets. The root third-party media exclusion remains in force.
The source WAV, voice assets and synthesis engine are not added by this change.

Existing CI verifies the exact fixture bytes after its dependency-free gate,
then uploads only this MP3 as `cosmic-approved-single-mp3-fixture`, retained
for seven days. Uploading the single file gives one flattened artifact entry
`staging-speech.mp3`, as required by the manual runner. No new workflow, secret,
paid request or deployment is introduced by packaging. Select the resulting
artifact/run IDs only after checking the run and artifact metadata; do not use
the older `reviewed-release-inputs` MP3 (SHA-256 starts `4752db5e`).

The paid workflow still requires main/first attempt, explicit mode selection,
complete prior-run accounting, a fresh current Cloudflare deployment/source
receipt, protected Access/BYOK checks and the unchanged one-request/no-retry
reservation under the cumulative nine-request/US$0.25 approval. Artifact upload
alone is not paid acceptance or production readiness.

CI setup remains fail-closed: Linux provisioning first checks actual ffmpeg and
ffprobe versions plus all required encoder/decoder capabilities. If unavailable,
APT update/install run with bounded network retries/timeouts and subprocess
deadlines; provisioning has a 10-minute step ceiling, and the dependency job
a 20-minute ceiling. Package signatures, generated-media checks, exact fixture
hash verification and all platform/release gates remain mandatory. These APT
retries do not enable retries of paid transcription. Actual tool versions are
preserved in provisioning output; runner image documentation alone is not proof
that required codecs are present.

## Remaining eight request candidate - 23 October 2026

Main CI 39974134871 attempt 2 and MP3 smoke 39979683866 passed on main
`4c5fe43fa3ab0d61da021080a497146b122d0e56`. The smoke receipt records one
provider attempt, Access PASS and BYOK cleanup PASS. Its expected model charge
is US$0.0009072; the conservative reservation is US$0.0045. This is not invoice
verification. Eight request slots and US$0.2455 remain under the original
nine-request/US$0.25 approval. **Do not invoke the legacy nine-call workflow.**

### Conditional diarization bound

Deployed source `82392336cfea5bc417098a2c6e3066dafca97b5b` always requests
`chunking_strategy:auto`. The published per-block model limits cannot establish
a whole-request bound when internal chunk count is unspecified.

This candidate proves short PCM16 mono 16-kHz WAV duration from the complete
server-validated bytes. Unknown, ambiguous, other-format or longer files retain
the existing automatic path. Client duration cannot opt into the short path.
For a proven WAV of at most 30 seconds, omit optional chunking and use the
API's documented single-block default. This is a source change: it needs review,
certification and a separately verified protected-staging deployment before use.

For that single block, reserve US$0.18: the documented 16,000-token context plus
2,000 maximum output tokens, both priced at the higher US$10/million rate.
The published input rate is lower, US$2.50/million. Seven fixed approximately
12-second `gpt-transcribe` files each reserve a full minute at US$0.0045.
The planned additional reservation is US$0.2115; with the previous US$0.0045,
the cumulative reservation would be US$0.216, below US$0.25.

There is no provider-enforced dollar cap. This bound depends on the fixed bytes,
documented single-block behavior, model limits and prices, one request per
format and no retry. Sources fetched on 23 October; recheck if they change:

- https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize
- https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create/

### Prepared manual workflow

File: `.github/workflows/staging-remaining-eight.yml`.

- Ref: `main`.
- Authorization: `remaining-eight-existing-approval` (default is `refuse`).
- `fixture_run_id` and `fixture_artifact_id`: a reviewed same-repository producer
  artifact named `cosmic-approved-remaining-eight-fixtures`.
- Exactly eight pinned FLAC, MP4, MPEG, MPGA, M4A, OGG, WAV and WebM files; no MP3.
  See `scripts/staging-remaining-eight-policy.mjs` for byte counts and hashes.

These inputs are preserved offline Windows SAPI David/Zira synthetic speech,
not private recordings. They remain outside the root MIT grant. The earlier
exact-MP3 publication approval is not an additional voice/engine license, and
this candidate publishes no new binary inputs. A producer must upload the eight
files themselves; a ZIP containing another ZIP will fail the flat-file check.

The workflow is deliberately inert until `APPROVED_DEPLOYMENT` is populated by
a subsequent reviewed change with the newly certified source, successful CI and
licensing runs, certified artifact, staging deployment run/head and Worker
version. It rejects the old source. Required guards include source feature
hashes, a fresh 100%-traffic version/source annotation, a source receipt at most
300 seconds old, authenticated Access/account readiness and secure BYOK
issuance/status/forget contracts. The prior successful MP3 receipt is hash-pinned.

Inspect every CI attempt and paid-job record. Concurrent CI, an additional
manual smoke or any prior remaining-eight attempt blocks execution. A failed or
ambiguous attempt is never automatically replayed. Persist the reservation for
all final eight slots before any paid send, then send sequentially and stop on
the first failure. Evidence omits credentials, transcript bodies and identities.
Shared concurrency matches the existing smoke. No production/release successor
exists; `fullAcceptance:false` and `releaseReady:false` remain mandatory.

### Remaining review and execution steps

1. Review and run required CI for the source and test workflow.
2. Certify and deploy the changed source to protected staging with rollback.
3. Review and populate immutable deployment pins.
4. Review and supply the eight-file artifact through a supported producer.
5. Recheck cumulative accounting and prices; parent coordinates browser dispatch.

The original MP3 and the future changed-source eight-format run have different
source identities. Combining them does **not** prove strict nine-format
acceptance of one exact source. Do not relabel the old receipt, weaken that gate,
or spend a tenth request without a new specific allowance. Native Safari remains
FAIL with its exact reviewed waiver; genuine Mac Safari remains unvalidated.
This preparation sends no paid requests and accepts no new grants or agreements.
### Dependency security recertification and production boundary

A dependency graph repair changes the release source and lock. The previously certified source `2d9b6bddc20cd8b0444611e3cdd3995cb5c8a653` and artifact `12527898809` do not contain the patched graph and must not be relabelled as patched. First merge the reviewed dependency repair after clean required CI, then certify the new exact main source and inspect its new artifact, archive digests and manifest. Only afterward update the separate staging deployer's pins, with fresh current-version rollback proof, review/CI and one parent-coordinated staging-only dispatch. Preserve existing Access protection, private bindings, BYOK and all source/artifact/rollback guards.

Production remains unchanged because staging deployment and live acceptance for this exact new source have not passed; `releaseReady:false` and `fullAcceptance:false` remain in force. The local eight-file producer has not uploaded anything, and the recent staging approval does not authorize fixture uploads or credential changes. Fixed synthetic inputs require their reviewed supported artifact route and fresh accounting, source, Access and BYOK checks before any paid send.

The completed MP3 used older deployed source. Eight further formats on a new source cannot prove nine-format single-source acceptance. One additional MP3 on that same new source would be a tenth cumulative provider request and needs separate explicit request-count approval, even if its reservation fits the existing dollar cap. Do not rerun a nine-call batch or silently add that request. Keep production blocked until the required exact-source live acceptance and all other release gates are satisfied. The narrow Safari automation waiver remains distinct from genuine Mac validation, which is still unclaimed.



### Remaining-eight integration candidate (24 October)

Pins identify deployed app88ee4a683c8c277885f0737db53226e658390fae, Worker
e1c94498-bfb2-4cbd-8488-e75cdec32877, deploy40063452013, coordinator728b42283b4252f2a125e4c4b5bf56c22989e3ae,
sourceCI40056803923/licensing40056803922/artifact12546575744. Runtime must
freshly revalidate source/version, history, Access/account and BYOK.

User Sentinel_e6b51de7beb08191962da6e3685b91d6 approved eight synthetic files as an
Actions artifact and one eight-request run, with cumulative spending up to US$2
if needed. The workflow retains its tighter nine-request/US$0.25 ledger and
US$0.216 cumulative reservation. No retries or additional request count.
Old-source MP3 plus eight new-source tests remain mixed-source coverage;
a new MP3 is a tenth cumulative request requiring separate count approval.

The producer prepare-remaining-eight-fixtures.mjs validates exactly eight fixed
hashes/bytes, measured codecs/durations/layout and offline decoding with bounded
subprocesses before copying flat files/*; receipt stays outside upload. No
synthesis, reencoding, provider request or extra voice/media licence is inferred.
Future artifact: cosmic-approved-remaining-eight-fixtures, no MP3 or nested ZIP.

Owner Sentinel_071f066042048191823edaf64745925a explicitly approved public Git history for the exact eight synthetic inputs and the diagnostic delta. The fixed files now live in tests/fixtures/approved-remaining-eight/, retaining a distinct provenance/rights notice outside the root MIT grant. Existing CI validates them with the offline producer and uploads only the eight flat files as cosmic-approved-remaining-eight-fixtures. No provider call, extra secret or production successor is added. Artifact IDs must be taken from successful reviewed CI; never guessed.

Token exposure relationship and remediation remain unknown. Existing-secret
staging use was approved, not declared remediated. Working credentials do not
prove they differ from an exposed token. Owner token-record confirmation and
nonsecret audit/secret-update metadata can support remediation review; timestamps
alone cannot prove identity. No credential change or production readiness claim.


### Firefox containment failure diagnostics

PR23 first Windows certification timed out in the unchanged account-card containment poll after resize; local five-repeat reproduction passed. The cause is unresolved. The test now logs only on failure: last completed numeric bounding boxes/viewport/scroll dimensions, overflow modes, font-size/font-ready/document-ready state, completed measurement count and in-flight flag. It never reads email text, HTML, URLs, cookies, storage or input values; reporting uses the last original-poll sample and starts no fresh browser-protocol call after timeout. The same containment inequalities, expect.poll timeout and CI zero-retry policy remain. A passing run does not establish the earlier timeout was harmless or fixed. No production code or layout styles change.

Conditional production/main request Sentinel_07718b23b2608191ac0bb0fd57b404ce is subject to all review/CI/exact-source acceptance/security/rollback gates. Mixed-source MP3 plus eight new-source formats is not all-format same-source acceptance; no tenth request is silently authorized. Credential changes are excluded.

Specific approval Sentinel_d6b70f6ef1948191a7a70a4b65f5f477 explicitly includes the MP3-encoded .mpeg and .mpga filename cases. They remain two of the fixed eight, not an additional MP3 file or ninth batch request.


### Accounting-read failure40113556242 (24 October)

The first remaining-eight attempt failed before reservation, source/Access/BYOK or provider steps. Exactly one earlier old-source MP3 request remains reserved at US$0.0045; this zero-call attempt does not reset or consume provider spending. Complete public history (47 relevant runs, all attempts/jobs) satisfies the original assertions on offline replay. Repeated aggregate job-list reads for historical run39872879681 timed out, while its exact attempt1 endpoint returned complete evidence. The old generic catch cannot prove this was the failing call or identify an assertion, so the original precise cause remains unknown; do not label it an application/provider failure.

Accounting now reads every attempt1 through run_attempt using GitHub's documented GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs. Complete bounded pagination, run/attempt binding, unique job IDs and per-attempt skipped paid-job checks remain mandatory. No latest-only fallback, unreadable-run skip or automatic read/provider retry is added. Fixed reason identifiers and public numeric run/attempt/HTTP status identify future read versus verification failures without logging tokens, URLs, exception text or response bodies. Official reference: https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt .

Only reviewed run40113556242, immutable headda0acbc46e4973488887bebc9dd49972376c34da, job120930077359 and attempt1 can be treated as zero-call, with freshly read completed failure metadata, successful pin/prior-receipt steps, failed accounting step, skipped reservation/artifact-download/source/provider steps and no artifacts. Missing, changed, ambiguous, executed, rerun or unlisted manual evidence rejects. This is not a blanket failed-run exemption. The ledger still starts with one reserved request/US$0.0045 and reserves the final eight to cumulative9/US$0.216 within the tighterUS$0.25 workflow limit; the user's US$2 ceiling does not authorize extra requests or retries.

A fresh dispatch is not part of this repair. Review and exact-head checks/main integration, fresh complete accounting/source/Access/account/BYOK gates, explicit zero-execution confirmation and one parent-coordinated executor precede any new manual attempt. Do not rerun the failed GitHub run; attempt2 is rejected. Production, credentials, fixture bytes, spending and paid-retry protections are unchanged.

### Preserve the reviewed browser MP3 during fixture generation

Main CI40154446897 (Ubuntu26.04.1, FFmpeg8.0.1-3ubuntu2) generated `format.mp3` as16940bytes, but the reviewed native-Safari fixture is exactly16941bytes/SHA256 `e799ee1a44f73c9a4b146e76cce9deae6390ebc2aad3f51da13ce9dda2182b55`. Both existing integrity assertions correctly failed before platform jobs. The generated file was not retained, so its full digest and exact differing fields cannot be established from logs. This is generator/toolchain output drift, not a Firefox layout failure or evidence that Safari passed.

`generate-test-fixtures.mjs` now verifies the canonical checked-in MP3 before any cleanup or encoder invocation, excludes that file from regeneration, and verifies it again afterward. Missing, shortened or same-size substituted bytes fail closed. Other codec fixtures still generate normally; no size/hash allowance, Safari exception expansion, assertion/timeout relaxation or tool-validation skip is introduced. Regression tests model arbitrary alternate encoder output and prove the canonical file is preserved and changed evidence prevents all writes/tool calls. Keep immutable reviewed inputs separate from reproducible-by-contract generated media; an encoder command is not a cross-version byte-identity guarantee.

The next PR25 CI run40155082379 passed the full adversarial gate but stopped in the eight-fixture producer with its generic error. Offline replay of the original producer with the existing newer portable FFprobe reproduced the duration assertion: exact pinned MPEG/MPGA bytes report12.000seconds, whereas the preserved FFprobe7.1.1 receipt records12.096. The hosted catch does not prove its precise original assertion; fixed safe failure identifiers now distinguish probe/decode failures without raw output or paths.

Only these two fixed filename cases accept their two observed probe-duration representations with the existing0.001-second tolerance. Readiness additionally requires exact decoded PCM16/mono/16kHz sample counts for EVERY hash-pinned input: FLAC/MPEG/MPGA/OGG/WebM192000, MP4/M4A192512, WAV240159. Decoding is bounded to30seconds and524288capturedbytes, with no network protocols or output-file persistence. Wrong codec/rate/layout/bytes/hash, other durations, truncated/extra/odd PCM output and decode errors still fail before any artifact output. Fixture bytes, paid dispatch duration and reservation/request guards do not change. Full offline fixture generation plus all eight actual probe/decode/copy stages must be exercised after media-toolchain changes; narrow waiver tests alone missed this downstream contract.

### Receipt-bound continuation of eight unused held slots (25 October 2026)

Run40161696792 on813e66a reserved9cumulative slots/US$0.216, then failed ataccess-status/access_redirect beforeBYOK/provider execution. Its exact runnerhash and receipt attempted0/formats[] are bound to artifact12586114319 and reservation12585919515. The subsequent read-only diagnostic40165437742 passed after the user refreshed the existing secret. No additional provider request has occurred; the original old-sourceMP3 remains the sole paid attempt. The existing reservation must remain held, not reset or reserved twice.

Continuation is limited to that reviewed original run/head/job/attempt1, both artifact IDs/digests/sizes/source identities, four exact redacted file hashes, complete failed job steps, zero-attempt Access failure, unchanged old MP3 ledger and deployed-source lineage. Partial, modified, rerun, ambiguous or other manual evidence rejects. Preparation downloads only the pinned old redacted artifact and writes an unchanged9/216000microUSD budget plus an explicit continuation-run binding for8unused slots and0additional reservation. The runner validates this binding beforeAccess/BYOK; existing exclusive receipt creation, ledger lock, shared workflow concurrency, per-attempt evidence before provider dispatch and stop-on-first-failure rules remain. Fresh complete history admits only one new continuation: any later manual run, even another pre-provider failure, requires separate review. No generic failed-run exception or automatic retry.

After reviewed integration/main CI and fresh source/Access/BYOK/accounting guards, the single coordinated browser executor uses the existing manual workflow staging-remaining-eight.yml on main, authorization remaining-eight-existing-approval, fixture_run_id40107978892, fixture_artifact_id12565627031. Do NOT rerun40161696792. No extra MP3 or tenth request; unchanged tighter workflowUS$0.25 bound stillcovers cumulativeUS$0.216, within the ownerUS$2ceiling. Completion of these eight on source88ee4a6 plus older-sourceMP3 remains mixed-source coverage, not same-source nine-format release certification. Production does not follow automatically.

Validation must include actual archived failed-run metadata/files and prior smoke replay, adversarial artifact/step/receipt/run/ledger mutations, rejection of second admission, fake-provider batch counting exactly8 and stopping on ambiguous response or persistence failure, independent code review and current-head CI. The public embedded test receipt contains only existing redacted workflow metadata, no credential, personal identity or audio.


### Exact cancelled historical CI proof (40169170360)

The superseded push-to-main run40169170360 at e88e30389e2c1f2ee3b08c72485989fa88e6bf17 was cancelled after Windows validation stalled. GitHub labelled dependent jobs cancelled rather than skipped. This does not allow cancelled jobs generally. Its paid job121115802392 and prerequisite deploy job121115801750 both have no runner assignment and zero steps. The original workflow blob220e4918806539097710909431f4353620504fa1 requires the different branch ci/v1.2.0-production-readiness and successful deployment before paid acceptance; this run was main.

Preflight retrieves the exact original content-addressed workflow and complete artifact/attempt-job metadata. Accounting requires the pinned run/head/event/branch/attempt, original Git blob, both job identities with runner null/steps empty, and exact canonical eight-job/three-artifact snapshot SHA2564304ceeeb03d79fde0a631def06e94d0612281bd7bd1dd3931147f60e66c940a. Sorting API rows only removes irrelevant ordering; missing, additional, duplicate, altered or started job evidence rejects. Every other cancelled/ambiguous paid job still rejects. The public test fixture contains metadata and workflow source only, no credential values, private payloads or audio.

This is authenticated GitHub execution evidence bound by hashes, not a GitHub-signed attestation. Synthetic started_at values on runner-less jobs are not execution proof. This reconciliation does not turn the cancelled certification into a pass, reset or add reservation, allow reruns, add provider retries, or waive any release check. The original9-slot/US$0.216 hold and one-shot eight-unused-slot continuation remain unchanged.


## One separately approved same-source MP3 confirmation (2026-10-25)

The completed remaining-eight run 40200059681 used app source
88ee4a683c8c277885f0737db53226e658390fae. The earlier MP3 run 39979683866
used source 82392336cfea5bc417098a2c6e3066dafca97b5b, so those original nine
requests do not establish nine-format coverage at one source.

The owner separately approved exactly one additional MP3 request, with no retry,
against the same deployed source as the successful eight. The existing manual
single-MP3 workflow now requires `one-mp3-same-source-tenth`, fixture producer
40107978892 and artifact 12565238332. It retains the existing staging-only
credentials and shared paid-workflow concurrency group. No new login, credential,
Access policy, production deployment or fixture publication is part of this change.

Before admission it verifies complete history, the immutable earlier MP3 evidence,
exact successful eight-run/job/artifact identities and every receipt byte, the
original zero-attempt reservation and the narrowly pinned never-started cancelled
CI proof. It rejects any other manual attempt, rerun, active/ambiguous paid history,
partial history or modified proof. Current coordinator main must have successful
exact-head CI and licensing; the application checkout and fresh runtime deployment
must independently identify source 88ee4a6 and version
e1c94498-bfb2-4cbd-8488-e75cdec32877. Coordinator source is not application source.

The original nine-slot ledger remains unchanged. A new approval-specific reservation
records nine prior requests and one extra request, adding 4,500 microUSD to the
216,000 microUSD reservation: ten total requests / US$0.2205. The tighter workflow
ceiling remains below the owner's US$2 cumulative authorization. Reservations are
conservative accounting, not verified invoices. An ambiguous fetch consumes the
single attempt; it must never be retried automatically. Exclusive receipt and lock
files preserve this rule inside a run, while complete history blocks a second run.

The fixed synthetic MP3 is 194,156 bytes / 12.096 seconds, SHA-256
9a89f3860a66d1d1e0fba139b51fded9a5e0e2f6f19d687616b2efaad1c2f78a.
No private audio is used. Local fake-fetch replay uses an explicitly synthetic run
ID and is not a live reservation, provider request or acceptance receipt.

Even a successful final confirmation does not create the legacy same-run nine-format
receipt or automatically set releaseReady/fullAcceptance. Coverage can be reviewed
across the two actual same-source runs; production promotion requires its own
supported evidence/rollback/access checks. The disclosed native Safari failure
remains FAIL/WAIVED, and genuine Mac Safari validation is still unavailable.


### Fixed fixture pin and exact pre-reservation zero-attempt reconciliation

The first final-MP3 manual run, `40245143343` at source `d6d749889f9735f4c27dbdcb4164fb3656a8253a`, failed before reservation upload, BYOK or transcription. Its fixture ZIP digest pin had a one-character transcription error. The actual artifact `12565238332` was downloaded independently: ZIP SHA-256 `c291ab8175af70d488643ffad5f0f4c5dbaa138a168191ddd52f3cb6adb2f6a7`, 133819 bytes, containing only the unchanged approved 194156-byte MP3. The payload SHA-256 remains `9a89f3860a66d1d1e0fba139b51fded9a5e0e2f6f19d687616b2efaad1c2f78a`.

Only that exact failed run/attempt/head/job is reconciled. Fresh GitHub metadata must show its exact completed step graph: preparation failed, reservation/source/BYOK/provider steps skipped, no artifacts, and the three original workflow/preflight/policy blob IDs. A changed, missing, duplicate, rerun, started, ambiguous or unknown manual attempt still fails closed. This admits no paid retry and changes neither the original nine-request evidence nor the separately approved tenth request/reservation. A new live submission is not made by this repair or its CI.

Validation lesson: mock metadata constructed from the same pin under test cannot detect a typo in that pin. Keep an independently captured real artifact record and archive verification, and explicitly test rejection of the original incorrect digest. The exact-zero proof relies on the immutable job graph and code, not a self-asserted `paidRequests:0` label. Runtime history/source/Access/account/BYOK gates, no automatic retries, and the US$0.0045 additional / US$0.2205 cumulative reservation remain required. Same-source MP3 acceptance and production readiness remain pending.


Preflight failure logs now distinguish public expected/actual artifact ID, SHA-256, byte size and source IDs; candidate output is capped at two and arbitrary names/invalid strings are never serialized. Only a locally minted artifact-verification error may supply this diagnostic, so an unrelated error cannot inject a response body or credential through an error property. Logs also state zero paid requests, reservation-write state, BYOK not started and cleanup not required for this preflight. No telemetry or new network request is added. These bounded diagnostic fields do not weaken any validation check or turn a failure into an automatic retry.


### Held unused tenth-slot continuation after protected Access redirect

Run40336352549 reserved the approved tenth slot and verified the exact fixture/current staging source, then failed at access-status/access_redirect with attempted0 before BYOK or transcription. Its two immutable artifact ZIPs and all five extracted JSON hashes bind the held ledger, original nine-call lineage, source, and zero-provider receipt. The exact run/head/attempt/job, full18-step graph and four original code/workflow blobs must match. No other failed/manual/rerun/changed/ambiguous evidence is exempt.

The continuation copies the existing10-slot/USD0.2205 ledger unchanged. Its declaration records unusedSlots1 and additionalReservationMicroUsd0; it does not reset the original nine-call evidence or reserve another USD0.0045. Both complete-history preflight and the runner under its durable one-shot lock revalidate the held proof. Only a separately coordinated future manual request may consume the already-approved unused slot after all fresh source/Access/account/BYOK gates pass; there is no automatic paid retry or production successor.

Authentication diagnosis is separate. The run proves an HTTPredirect at the correct staging API, not expiry, account or audience as its cause. The saved Actions STAGING_CF_AUTHORIZATION is independent of dashboard/browser login and deployment OAuth/API tokens. Check it with the existing no-provider Access diagnostic; refresh only the existing staging-environment secret through authorized secure entry if needed, preserving account/audience/policy. Do not replace the deployment token, weaken Access or paste credentials into chat. Future runner failures record only bounded numeric HTTPstatus and fixed redirect-category labels, never Location, tokens, headers or response bodies. Mock302 tests are offline evidence, not the unknown actual response status of this run.

## Verified staging evidence - 26 October 2026

Manual run [40413365240](https://github.com/sohweiyu2023/CosmicTranscriberWeb/actions/runs/40413365240) completed the one-shot MP3 continuation: one provider attempt, no retry, meaningful English content accepted and BYOK cleanup PASS. Coordinator source was `0046d0eb33ac5b1eafd41b0df4985148011e436e`; the verified deployed application remained `88ee4a683c8c277885f0737db53226e658390fae`, Worker version `e1c94498-bfb2-4cbd-8488-e75cdec32877`.

Together with the eight-format receipt from run [40200059681](https://github.com/sohweiyu2023/CosmicTranscriberWeb/actions/runs/40200059681), this establishes nine-format coverage on that same deployed application across two runs. It is not a same-run nine-format receipt, an accuracy benchmark, or genuine Mac Safari validation. Preserve original receipt flags (`fullAcceptance:false`, `releaseReady:false`) rather than rewriting evidence to infer production certification.

The final run's reservation artifact is `12694028647` (SHA-256 `12236c816772799ed40c6f0b4212b829e86e1123c0cc954ec58acdeabd5301ad`); redacted evidence artifact is `12693578664` (SHA-256 `fbb7d8b06a85f640e6bcfda53c7fc59d6d2944740f809f21d1a8b4d30983fc68`). Global accounting includes the earlier old-source MP3: ten approved provider attempts, cumulative conservative reservation US$0.2205 within US$2. No unused request authority follows from the remaining dollar balance; actual provider invoices were not verified.

## Offline replay from a source archive

Source ZIPs exclude `.git`. Set `COSMIC_SMOKE_TEST_FIXTURE` to the preserved approved synthetic MP3 and `COSMIC_SMOKE_TEST_SOURCE_REPO` to an existing local Git repository containing the test's pinned historical commit. The test clones local objects only with `--no-hardlinks`, checks out the exact commit, and removes its temporary clone after success or setup failure. A missing history commit fails closed. These HTTP-mocked tests do not consume live provider slots or prove live staging acceptance; never substitute private audio or publish local paths.


## Prepared new-source campaign - not admitted or executed (30 October 2026)

Main `9a1eb484` and artifact `12982522359` have new logging code and CI-resolved jose 6.2.14. Historical appsource88 receipts remain compatibility evidence only. The prior ten provider slots are consumed; never reset or reuse them. A separate proposed nine-format campaign reserves at most USD0.216 additional, cumulative USD0.4365 and19 calls under the existing USD2 ceiling. All nine existing synthetic files are unchanged; no new content or private recording is needed. No automatic retry is permitted.

`scripts/staging-source-admission.mjs` currently validates only the exact prior completed evidence, historical closure, fixture identities and a non-reserving budget proposal. `admitExecution` is deliberately blocked: actual new staging version/deployment receipt, fresh guard receipt, reviewed coordinator head/workflow identity and durable accounting integration are not yet verified or pinned. User-supplied ready/verified booleans cannot enable it. A local fsync/exclusive-write journal component is now included, but no runnable provider workflow or remote reservation was added. Local test journals and synthetic persistence witnesses are not live admission. No provider dispatch is possible from this candidate.

Before execution, independently verify and pin actual staging evidence; integrate fresh official complete Actions history reads, all-attempt completeness and a shared non-cancelling `cosmic-approved-paid-staging` mutex for every eligible provider path (including the separate automatic CI paid job if retained). Verify current run attempt1/main/exact coordinator and no competing or previous campaign admission. Persist one immutable reservation/dispatch-intent receipt durably before each provider request; after uncertain execution retain its slot and stop. Do not treat a local proposal, forged guard JSON, stale API snapshot or runner test replay as an actual reservation. New workflow integration requires its own review and CI.

No production deployment, credential/grant/policy change or paid call is authorized by this draft. Native Safari remains FAIL/WAIVED, not validated. The existing13 local prerequisite skips remain skips.

### Durable journal integration component (review candidate only)

`staging-source-journal.mjs` writes an exclusive ownership marker and fsyncs a full nine-slot reservation/intent batch. It requires the downloaded exact reservation artifact witness before returning any per-slot descriptor, then fsyncs each local dispatch intent before returning it. Every slot remains reserved if progress is lost. A denial, uncertain outcome, duplicate claim, interrupted write, changed receipt or exhausted slot fails closed; outcomes never automatically release budget or certify the release. The local component performs no network request.

The workflow integration still must acquire the common non-cancelling paid mutex, authenticate fresh official history/metadata, upload and re-download the complete reservation before any provider call, and reject every later campaign run/attempt. A same-run local journal is not a cross-run global lock, and a caller-supplied artifact object is not proof of an authenticated GitHub API read. The separately gated `admitExecution` remains disabled until actual reviewed staging evidence exists. Current tests use only synthetic run/artifact witnesses and temporary files; no paid reservation is created.

Independent review found and corrected two draft defects before publication: a parseable outcome could survive failed fsync/close and incorrectly allow the next slot; and the draft attempt ID did not match the existing diagnostic grammar. The journal now requires private in-process acknowledgments after write, fsync and close all return, serializes mutations, poisons ownership after persistence uncertainty, and never adopts files after a restart. Post-write sync/close failure and concurrent-claim regression cases cover this boundary. Attempt IDs use the existing attempt-plus-24-hex grammar. File fsync alone does not guarantee parent-directory-entry survival on every platform: the immutable remotely reserved full batch and prohibition on automatic process/journal adoption remain mandatory. This is not a restart-recoverable global ledger.
