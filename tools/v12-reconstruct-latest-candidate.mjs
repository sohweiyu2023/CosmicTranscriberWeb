#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { applyUnifiedPatch, treeFingerprint } from './v12-reconstruct-candidate.mjs';

const EXPECTED = Object.freeze({
  batch4Base64Sha256: 'c7526cb04b28b252a446e70ac3373561b440246a1965f34fe44c71f4e9864082',
  batch4GzipSha256: 'b4aef2bfa7c84e8fb06470b6e907fcf8cbbfe74380a14ded19cebf40f6247d56',
  batch4PatchSha256: '1db1bf82af027129e77a03a633e0696c59e9fab3d41187689279767ece904fbe',
  packageLockSha256: '1eb32525cf5c4db2e976e44d348724054fe3c789a7ee535b943af16480e3674c',
  fileCount: 169,
});

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--') || i + 1 >= argv.length) throw new Error(`invalid argument: ${key}`);
    args[key.slice(2)] = argv[++i];
  }
  for (const required of ['certified-source-zip', 'repo', 'out']) {
    if (!args[required]) throw new Error(`missing --${required}`);
  }
  return args;
}

function runBatch3Reconstruction(args) {
  const script = resolve(args.repo, 'tools', 'v12-reconstruct-candidate.mjs');
  const result = spawnSync(process.execPath, [
    script,
    '--certified-source-zip', resolve(args['certified-source-zip']),
    '--repo', resolve(args.repo),
    '--out', resolve(args.out),
  ], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`Batch 3 canonical reconstruction failed${detail ? `:\n${detail}` : ''}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const repo = resolve(args.repo);
  const out = resolve(args.out);

  // Fail closed by first materializing and verifying the exact canonical Batch 3 tree.
  runBatch3Reconstruction(args);

  const payloadPath = resolve(repo, 'tools', 'v12-batch4-mpeg-trust-boundary.patch.gz.b64');
  const base64Text = await readFile(payloadPath, 'utf8');
  if (sha256(Buffer.from(base64Text, 'utf8')) !== EXPECTED.batch4Base64Sha256) {
    throw new Error('Batch 4 base64 payload SHA-256 mismatch');
  }

  const compressedPatch = Buffer.from(base64Text, 'base64');
  if (sha256(compressedPatch) !== EXPECTED.batch4GzipSha256) {
    throw new Error('Batch 4 gzip payload SHA-256 mismatch');
  }

  const patchBytes = gunzipSync(compressedPatch);
  if (sha256(patchBytes) !== EXPECTED.batch4PatchSha256) {
    throw new Error('Batch 4 patch SHA-256 mismatch');
  }
  await applyUnifiedPatch(out, patchBytes.toString('utf8'));

  const pkg = JSON.parse(await readFile(resolve(out, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(out, 'RELEASE_MANIFEST.json'), 'utf8'));
  if (pkg.version !== '1.2.0') throw new Error(`candidate package version is ${pkg.version}, expected 1.2.0`);
  if (manifest.releaseReady !== false) throw new Error('candidate RELEASE_MANIFEST.json must keep releaseReady:false');
  if (sha256(await readFile(resolve(out, 'package-lock.json'))) !== EXPECTED.packageLockSha256) {
    throw new Error('candidate package-lock.json SHA-256 mismatch after Batch 4');
  }

  const fp = await treeFingerprint(out);
  if (fp.fileCount !== EXPECTED.fileCount) throw new Error(`candidate file count mismatch after Batch 4: ${fp.fileCount}`);

  console.log(JSON.stringify({
    status: 'PASS',
    version: pkg.version,
    releaseReady: false,
    latestAppliedBatch: 4,
    fileCount: fp.fileCount,
    treeSha256: fp.treeSha256,
  }, null, 2));
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exitCode = 1;
});
