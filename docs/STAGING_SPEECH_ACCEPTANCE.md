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
