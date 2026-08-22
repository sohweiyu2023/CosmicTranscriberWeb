#!/usr/bin/env bash
set -euo pipefail

ROOT=${1:?Usage: v12-reconstruct-through-batch4.sh <output-root>}
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
RUN_TEMP=${RUNNER_TEMP:-$(mktemp -d)}
WRAP="$RUN_TEMP/v111-wrapper"
WORK="$RUN_TEMP/v12-reconstruct-work"
CERT_ZIP="$WRAP/extracted/CosmicTranscriberWeb-1.1.1-source.zip"
LOCK_SHA=1eb32525cf5c4db2e976e44d348724054fe3c789a7ee535b943af16480e3674c

cd "$REPO_ROOT"
rm -rf "$WRAP" "$WORK" "$ROOT"
mkdir -p "$WRAP/extracted" "$WORK"

if [[ -n "${V111_CERTIFIED_WRAPPER_ZIP:-}" ]]; then
  cp "$V111_CERTIFIED_WRAPPER_ZIP" "$WRAP/artifact.zip"
else
  : "${GH_TOKEN:?GH_TOKEN is required when V111_CERTIFIED_WRAPPER_ZIP is not supplied}"
  : "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
  gh api \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2026-03-10' \
    "/repos/$GITHUB_REPOSITORY/actions/artifacts/9277847563/zip" \
    > "$WRAP/artifact.zip"
fi
printf '%s  %s\n' \
  '8347bb5e4bc7bf1904a0aaa26a285b07de4166e8b41be227f7af13dfc0a1fa2c' \
  "$WRAP/artifact.zip" | sha256sum -c -
unzip -q "$WRAP/artifact.zip" -d "$WRAP/extracted"
test -f "$CERT_ZIP"
printf '%s  %s\n' \
  'a241dbf4ae50dab0e83b4a65000e587a7ffb51b0b568e9017207e22be81a27df' \
  "$CERT_ZIP" | sha256sum -c -
unzip -q "$CERT_ZIP" -d "$WORK"
node tools/v12-verify-certified-base.mjs \
  --base "$WORK/CosmicTranscriberWeb-1.1.1" \
  --certified-zip "$CERT_ZIP"
mv "$WORK/CosmicTranscriberWeb-1.1.1" "$ROOT"

# Batch 1: extract the immutable reconstruction payload embedded in the reviewed workflow.
node - "$RUN_TEMP/v12-reconstruct.gz" <<'NODE'
const fs=require('node:fs');
const out=process.argv[2];
const source=fs.readFileSync('.github/workflows/reconstruct-v12-dev-source.yml','utf8');
const marker="<<'V12_RECONSTRUCTION_B64'\n";
const markerAt=source.indexOf(marker);
if(markerAt<0)throw new Error('Batch 1 reconstruction payload start marker missing');
const start=markerAt+marker.length;
const end=source.indexOf('\n          V12_RECONSTRUCTION_B64',start);
if(end<0)throw new Error('Batch 1 reconstruction payload end marker missing');
const payload=source.slice(start,end).split(/\r?\n/).map(line=>line.replace(/^ {10}/,'')).join('').trim();
if(!/^[A-Za-z0-9+/=]+$/.test(payload))throw new Error('Batch 1 payload is not canonical base64');
const decoded=Buffer.from(payload,'base64');
if(decoded.length<1024)throw new Error('Batch 1 decoded payload unexpectedly small');
fs.writeFileSync(out,decoded);
NODE
gzip -dc "$RUN_TEMP/v12-reconstruct.gz" > "$RUN_TEMP/v12-reconstruct.mjs"
node --check "$RUN_TEMP/v12-reconstruct.mjs"
node "$RUN_TEMP/v12-reconstruct.mjs" --root "$ROOT"
test "$(node -p "require('$ROOT/package.json').version")" = '1.2.0'
test "$(node -p "require('$ROOT/RELEASE_MANIFEST.json').releaseReady")" = 'false'
printf '%s  %s\n' "$LOCK_SHA" "$ROOT/package-lock.json" | sha256sum -c -

# Official Batch 2 overlay.
printf '%s  %s\n' 'd54a1d66f24253990d68fc5403ce5d4151b16e20027fc9eeaf96a26d96da70b6' 'tools/v12-batch2-prebilling-overlay.b64/part-00' | sha256sum -c -
printf '%s  %s\n' '7d89ff720501e35061f286193620d256884cf4b30b2ff5cf990a0b999fef8222' 'tools/v12-batch2-prebilling-overlay.b64/part-01' | sha256sum -c -
printf '%s  %s\n' '7f3e13e4d166a08e57f87f72e5beeff1a074701bdf32eb775810842028a2b360' 'tools/v12-batch2-prebilling-overlay.b64/part-02' | sha256sum -c -
printf '%s  %s\n' 'c458a6f0ada0493970425ef0e14f1bcf9e266d40d006e93863d1e26fce371067' 'tools/v12-batch2-prebilling-overlay.b64/part-03' | sha256sum -c -
printf '%s  %s\n' 'c05568e26440a1d2fcfcea7157f4b8617bc6d44851ed7ffd52d5f52d3260f8fc' 'tools/v12-batch2-prebilling-overlay.b64/part-04' | sha256sum -c -
printf '%s  %s\n' '445ff76bfbb682a9a54793c67d7c03a53b9491b5b84da745acaf0529fa144107' 'tools/v12-batch2-prebilling-overlay.b64/part-05' | sha256sum -c -
cat tools/v12-batch2-prebilling-overlay.b64/part-* > "$RUN_TEMP/v12-batch2-overlay.b64"
printf '%s  %s\n' '14fd386b383a3e3f59eae4e912be864ce6c6b566057d1b8139ace04601c53d93' "$RUN_TEMP/v12-batch2-overlay.b64" | sha256sum -c -
base64 -d "$RUN_TEMP/v12-batch2-overlay.b64" > "$RUN_TEMP/v12-batch2-overlay.tar.gz"
printf '%s  %s\n' '32c3f00a7cc5268f9f82b1e6b259347ece54e5a3273b56555974363f2e4ce05c' "$RUN_TEMP/v12-batch2-overlay.tar.gz" | sha256sum -c -
tar -xzf "$RUN_TEMP/v12-batch2-overlay.tar.gz" -C "$ROOT" --no-same-owner --no-same-permissions

# Batch 3 multiformat/checkpoint patch.
printf '%s  %s\n' 'f8c7c17180964d12692ba01d2ea57f57af3ac129a8c985bebd986b30332927bd' 'tools/v12-batch3-multiformat.patch.gz.b64' | sha256sum -c -
base64 -d tools/v12-batch3-multiformat.patch.gz.b64 > "$RUN_TEMP/v12-batch3.patch.gz"
printf '%s  %s\n' 'c661993dc410684d7ca9bbe6c591fc3801308e6a0b0d5a77311c3ee2632f466c' "$RUN_TEMP/v12-batch3.patch.gz" | sha256sum -c -
gzip -dc "$RUN_TEMP/v12-batch3.patch.gz" > "$RUN_TEMP/v12-batch3.patch"
printf '%s  %s\n' 'abdb0e1040bef4ef7e87f615b14d90840c3c2fdfa68c296170346742617352dd' "$RUN_TEMP/v12-batch3.patch" | sha256sum -c -
(
  cd "$ROOT"
  git apply --check "$RUN_TEMP/v12-batch3.patch"
  git apply "$RUN_TEMP/v12-batch3.patch"
  node scripts/generate-test-fixtures.mjs
)

# Additive Batch 3 prebilling hardening. Self-test first; run twice to prove idempotence.
node --check tools/v12-batch3-prebilling-hardening.mjs
node --check tools/test-v12-batch3-prebilling-hardening.mjs
node tools/test-v12-batch3-prebilling-hardening.mjs --root "$ROOT"
node tools/v12-batch3-prebilling-hardening.mjs --root "$ROOT"
node tools/v12-batch3-prebilling-hardening.mjs --root "$ROOT"

# Batch 4 Worker MPEG-family trust-boundary hardening.
printf '%s  %s\n' 'c7526cb04b28b252a446e70ac3373561b440246a1965f34fe44c71f4e9864082' 'tools/v12-batch4-mpeg-trust-boundary.patch.gz.b64' | sha256sum -c -
base64 -d tools/v12-batch4-mpeg-trust-boundary.patch.gz.b64 > "$RUN_TEMP/v12-batch4.patch.gz"
printf '%s  %s\n' 'b4aef2bfa7c84e8fb06470b6e907fcf8cbbfe74380a14ded19cebf40f6247d56' "$RUN_TEMP/v12-batch4.patch.gz" | sha256sum -c -
gzip -dc "$RUN_TEMP/v12-batch4.patch.gz" > "$RUN_TEMP/v12-batch4.patch"
printf '%s  %s\n' '1db1bf82af027129e77a03a633e0696c59e9fab3d41187689279767ece904fbe' "$RUN_TEMP/v12-batch4.patch" | sha256sum -c -
(
  cd "$ROOT"
  git apply --check "$RUN_TEMP/v12-batch4.patch"
  git apply "$RUN_TEMP/v12-batch4.patch"
  node --check src/audio-formats.js
  node --check tests/node/audio-formats.test.mjs
  node --check scripts/audit-lib.mjs
  node --check scripts/mutation-suite.mjs
)

test "$(node -p "require('$ROOT/RELEASE_MANIFEST.json').releaseReady")" = 'false'
printf '%s  %s\n' "$LOCK_SHA" "$ROOT/package-lock.json" | sha256sum -c -
echo "V1.2 reconstruction through Batch 4 complete at: $ROOT"
echo 'releaseReady=false; production/staging not touched.'
