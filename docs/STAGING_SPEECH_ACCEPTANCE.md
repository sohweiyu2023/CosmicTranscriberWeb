# V1.2.0 staging nine-format speech acceptance — audit candidate

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

## Approved single-MP3 artifact publication — 23 October 2026

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

## Remaining eight request candidate — 23 October 2026

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
