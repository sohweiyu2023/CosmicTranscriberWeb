#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyUnifiedPatch, applyUnifiedPatchToText, treeFingerprint } from './v12-reconstruct-candidate.mjs';

let pass = 0;
const test = async (name, fn) => { await fn(); pass++; console.log(`ok ${pass} - ${name}`); };

await test('applies replacement/addition hunk with exact context', async () => {
  const patch = `diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,4 @@\n one\n-two\n+TWO\n three\n+four\n`;
  assert.equal(applyUnifiedPatchToText('one\ntwo\nthree\n', patch, 'a.txt'), 'one\nTWO\nthree\nfour\n');
});

await test('fails closed on context mismatch', async () => {
  const patch = `diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n`;
  assert.throws(() => applyUnifiedPatchToText('different\n', patch, 'a.txt'), /deletion mismatch/);
});

await test('rejects unsafe traversal path', async () => {
  const patch = `diff --git a/x b/x\n--- a/../x\n+++ b/../x\n@@ -1 +1 @@\n-a\n+b\n`;
  assert.throws(() => applyUnifiedPatchToText('a\n', patch), /unsafe patch path/);
});

await test('applies add/modify/delete chunks to a tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v12-reconstruct-test-'));
  try {
    await writeFile(join(root, 'a.txt'), 'alpha\nbeta\n');
    await writeFile(join(root, 'delete.txt'), 'bye\n');
    const patch = `diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+BETA\ndiff --git a/new.txt b/new.txt\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+one\n+two\ndiff --git a/delete.txt b/delete.txt\n--- a/delete.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n`;
    await applyUnifiedPatch(root, patch);
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'alpha\nBETA\n');
    assert.equal(await readFile(join(root, 'new.txt'), 'utf8'), 'one\ntwo\n');
    await assert.rejects(readFile(join(root, 'delete.txt'), 'utf8'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

await test('tree fingerprint is deterministic and symlink-free input hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v12-fingerprint-test-'));
  try {
    await mkdir(join(root, 'z'));
    await writeFile(join(root, 'z', 'b.txt'), 'b');
    await writeFile(join(root, 'a.txt'), 'a');
    const first = await treeFingerprint(root);
    const second = await treeFingerprint(root);
    assert.deepEqual(first, second);
    assert.equal(first.fileCount, 2);
    assert.match(first.treeSha256, /^[0-9a-f]{64}$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

console.log(`PASS ${pass}/${pass}`);
