#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tool = path.join(here, 'v12-certification-readiness.mjs');
let passed = 0;
function run(root) { return spawnSync(process.execPath, [tool, '--root', root, '--json'], { encoding: 'utf8' }); }
function expect(label, condition) { if (!condition) { console.error(`FAIL: ${label}`); process.exit(1); } passed++; console.log(`PASS: ${label}`); }
function write(root, rel, content) { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); }

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmic-v12-ready-'));
try {
  let r = run(temp);
  expect('missing application source blocks readiness', r.status === 1 && JSON.parse(r.stdout).missing.includes('app.js'));

  write(temp, 'package.json', JSON.stringify({ version: '1.2.0' }));
  write(temp, 'package-lock.json', '{}');
  write(temp, 'app.js', '');
  write(temp, 'wrangler.toml', '');
  write(temp, 'RELEASE_MANIFEST.json', JSON.stringify({ product: 'Cosmic Transcriber Web', version: '1.2.0', releaseReady: false }));
  write(temp, 'scripts/validate.mjs', '');
  fs.mkdirSync(path.join(temp, 'tests'));
  r = run(temp);
  expect('unreviewed dependency lock blocks readiness', r.status === 1 && JSON.parse(r.stdout).failures.some(x => x.includes('package-lock.json SHA-256 mismatch')));

  write(temp, 'RELEASE_MANIFEST.json', JSON.stringify({ product: 'Cosmic Transcriber Web', version: '1.2.0', releaseReady: true }));
  r = run(temp);
  expect('releaseReady true is rejected before certification', r.status === 1 && JSON.parse(r.stdout).failures.some(x => x.includes('releaseReady=true')));

  write(temp, 'RELEASE_MANIFEST.json', '{bad');
  r = run(temp);
  expect('invalid manifest JSON fails closed', r.status === 1 && JSON.parse(r.stdout).failures.some(x => x.includes('invalid JSON')));

  const parsed = JSON.parse(r.stdout);
  expect('recovered V1.1.1 baseline identity is emitted', parsed.certifiedBaseline.materializedTreeSha256 === 'a67ba4aee35bf533c122f322418ac3fd4bf68601a1ae320deecb35318ffb5300');
  expect('tool never claims certification', parsed.releaseCertified === false && parsed.releaseReadyMayChange === false);

  console.log(`V1.2 certification-readiness self-test: ${passed}/6 PASS`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
