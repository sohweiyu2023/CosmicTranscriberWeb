#!/usr/bin/env bash
set -euo pipefail
ROOT=${1:?Usage: v12-reconstruct-through-batch5.sh <output-root>}
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_ROOT"
bash tools/v12-reconstruct-through-batch4.sh "$ROOT"
node --check tools/v12-batch5-mpeg-eof-hardening.mjs
node tools/v12-batch5-mpeg-eof-hardening.mjs --root "$ROOT"
node --check "$ROOT/src/audio-formats.js"
node --check "$ROOT/tests/node/audio-formats.test.mjs"
node --check "$ROOT/tests/integration/worker.test.js"
node --check "$ROOT/scripts/audit-lib.mjs"
node --check "$ROOT/scripts/mutation-suite.mjs"
test "$(node -p "require('$ROOT/package.json').version")" = '1.2.0'
test "$(node -p "require('$ROOT/RELEASE_MANIFEST.json').releaseReady")" = 'false'
printf '%s  %s\n' '1eb32525cf5c4db2e976e44d348724054fe3c789a7ee535b943af16480e3674c' "$ROOT/package-lock.json" | sha256sum -c -
echo "V1.2 reconstruction through Batch 5 complete at: $ROOT"
echo 'releaseReady=false; production/staging not touched.'
