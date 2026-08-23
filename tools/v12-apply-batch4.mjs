#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { applyUnifiedPatch, treeFingerprint } from './v12-reconstruct-candidate.mjs';

const EXPECTED = Object.freeze({
  preTreeSha256: 'badaa131abbd50a1346654787852809423cfe0c4545373ef276e35a5173424a2',
  preFileCount: 169,
  packageLockSha256: '1eb32525cf5c4db2e976e44d348724054fe3c789a7ee535b943af16480e3674c',
  patchSha256: '1db1bf82af027129e77a03a633e0696c59e9fab3d41187689279767ece904fbe',
  gzipSha256: 'b4aef2bfa7c84e8fb06470b6e907fcf8cbbfe74380a14ded19cebf40f6247d56',
  base64Sha256: 'c7526cb04b28b252a446e70ac3373561b440246a1965f34fe44c71f4e9864082',
  changedPaths: Object.freeze([
    'scripts/audit-lib.mjs',
    'scripts/mutation-suite.mjs',
    'src/audio-formats.js',
    'tests/node/audio-formats.test.mjs',
  ]),
});

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hashFile = async (path) => sha256(await readFile(path));

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--') || i + 1 >= argv.length) throw new Error(`invalid argument: ${key}`);
    out[key.slice(2)] = argv[++i];
  }
  for (const required of ['candidate', 'repo']) if (!out[required]) throw new Error(`missing --${required}`);
  return out;
}

export function patchPaths(patchText) {
  const paths = [];
  for (const match of patchText.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    if (match[1] !== match[2]) throw new Error(`rename/copy patch rejected: ${match[1]} -> ${match[2]}`);
    const path = match[2];
    if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\')) throw new Error(`unsafe patch path: ${path}`);
    paths.push(path);
  }
  return [...new Set(paths)].sort();
}

function assertExactChangedPaths(patchText) {
  const actual = patchPaths(patchText);
  const expected = [...EXPECTED.changedPaths].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Batch 4 changed-path set mismatch: ${JSON.stringify(actual)}`);
  }
}

export function decodeVerifiedPatch(base64Text) {
  if (sha256(Buffer.from(base64Text, 'utf8')) !== EXPECTED.base64Sha256) throw new Error('Batch 4 base64 SHA-256 mismatch');
  const gzip = Buffer.from(base64Text, 'base64');
  if (sha256(gzip) !== EXPECTED.gzipSha256) throw new Error('Batch 4 gzip SHA-256 mismatch');
  const patch = gunzipSync(gzip);
  if (sha256(patch) !== EXPECTED.patchSha256) throw new Error('Batch 4 patch SHA-256 mismatch');
  const text = patch.toString('utf8');
  assertExactChangedPaths(text);
  return text;
}

async function main() {
  const args = parseArgs(process.argv);
  const candidate = resolve(args.candidate);
  const repo = resolve(args.repo);

  const before = await treeFingerprint(candidate);
  if (before.fileCount !== EXPECTED.preFileCount || before.treeSha256 !== EXPECTED.preTreeSha256) {
    throw new Error(`candidate is not canonical Batch 3: ${before.fileCount} files / ${before.treeSha256}`);
  }
  if (await hashFile(resolve(candidate, 'package-lock.json')) !== EXPECTED.packageLockSha256) throw new Error('pre-apply package-lock SHA-256 mismatch');

  const pkg = JSON.parse(await readFile(resolve(candidate, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(candidate, 'RELEASE_MANIFEST.json'), 'utf8'));
  if (pkg.version !== '1.2.0') throw new Error(`candidate package version is ${pkg.version}, expected 1.2.0`);
  if (manifest.releaseReady !== false) throw new Error('candidate must remain releaseReady:false');

  const b64 = await readFile(resolve(repo, 'tools/v12-batch4-mpeg-trust-boundary.patch.gz.b64'), 'utf8');
  const patchText = decodeVerifiedPatch(b64);
  await applyUnifiedPatch(candidate, patchText);

  if (await hashFile(resolve(candidate, 'package-lock.json')) !== EXPECTED.packageLockSha256) throw new Error('Batch 4 unexpectedly changed package-lock.json');
  const afterManifest = JSON.parse(await readFile(resolve(candidate, 'RELEASE_MANIFEST.json'), 'utf8'));
  if (afterManifest.releaseReady !== false) throw new Error('Batch 4 unexpectedly changed releaseReady');
  const after = await treeFingerprint(candidate);

  console.log(JSON.stringify({
    status: 'PASS',
    appliedBatch: 4,
    version: '1.2.0',
    releaseReady: false,
    changedPaths: [...EXPECTED.changedPaths],
    before: { fileCount: before.fileCount, treeSha256: before.treeSha256 },
    after: { fileCount: after.fileCount, treeSha256: after.treeSha256 },
    certification: 'NOT RUN',
  }, null, 2));
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) main().catch((err) => { console.error(`FAIL: ${err.message}`); process.exitCode = 1; });
