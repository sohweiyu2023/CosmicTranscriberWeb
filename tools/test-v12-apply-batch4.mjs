import test from 'node:test';
import assert from 'node:assert/strict';
import { patchPaths } from './v12-apply-batch4.mjs';

test('extracts exact same-path unified diff targets deterministically', () => {
  const patch = [
    'diff --git a/src/audio-formats.js b/src/audio-formats.js',
    '--- a/src/audio-formats.js',
    '+++ b/src/audio-formats.js',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    'diff --git a/tests/node/audio-formats.test.mjs b/tests/node/audio-formats.test.mjs',
    '--- a/tests/node/audio-formats.test.mjs',
    '+++ b/tests/node/audio-formats.test.mjs',
    '@@ -1 +1 @@',
    '-a',
    '+b',
  ].join('\n');
  assert.deepEqual(patchPaths(patch), ['src/audio-formats.js', 'tests/node/audio-formats.test.mjs']);
});

test('rejects rename/copy style patch headers', () => {
  assert.throws(() => patchPaths('diff --git a/a.js b/b.js\n'), /rename\/copy patch rejected/);
});

test('rejects traversal paths', () => {
  assert.throws(() => patchPaths('diff --git a/../a.js b/../a.js\n'), /unsafe patch path/);
});
