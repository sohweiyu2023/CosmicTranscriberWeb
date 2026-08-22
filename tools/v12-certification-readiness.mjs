#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
function arg(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }
const root = path.resolve(arg('--root') ?? process.cwd());
const json = argv.includes('--json');

const CERTIFIED_BASE = Object.freeze({
  version: '1.1.1',
  certificationRunId: 31997529015,
  certifiedZipSha256: 'a241dbf4ae50dab0e83b4a65000e587a7ffb51b0b568e9017207e22be81a27df',
  materializedTreeSha256: 'a67ba4aee35bf533c122f322418ac3fd4bf68601a1ae320deecb35318ffb5300'
});
const EXPECTED_CANDIDATE_LOCK_SHA256 = '1eb32525cf5c4db2e976e44d348724054fe3c789a7ee535b943af16480e3674c';
const REQUIRED = ['package.json','package-lock.json','app.js','wrangler.toml','RELEASE_MANIFEST.json','scripts/validate.mjs','tests'];

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { __error: e.message }; } }
function existsAsExpected(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p) || fs.lstatSync(p).isSymbolicLink()) return false;
  return rel === 'tests' ? fs.statSync(p).isDirectory() : fs.statSync(p).isFile();
}

const missing = REQUIRED.filter((rel) => !existsAsExpected(rel));
const failures = [];
let pkg = null, manifest = null, lockSha256 = null;

if (!missing.includes('package.json')) {
  pkg = readJson(path.join(root, 'package.json'));
  if (pkg.__error) failures.push(`package.json invalid JSON: ${pkg.__error}`);
  else if (pkg.version !== '1.2.0') failures.push(`package.json version=${JSON.stringify(pkg.version)} (expected "1.2.0")`);
}
if (!missing.includes('RELEASE_MANIFEST.json')) {
  manifest = readJson(path.join(root, 'RELEASE_MANIFEST.json'));
  if (manifest.__error) failures.push(`RELEASE_MANIFEST.json invalid JSON: ${manifest.__error}`);
  else {
    if (manifest.product !== 'Cosmic Transcriber Web') failures.push(`manifest product=${JSON.stringify(manifest.product)}`);
    if (manifest.version !== '1.2.0') failures.push(`manifest version=${JSON.stringify(manifest.version)}`);
    if (manifest.releaseReady !== false) failures.push(`manifest releaseReady=${JSON.stringify(manifest.releaseReady)} (must remain false before F4 + staging acceptance)`);
  }
}
if (!missing.includes('package-lock.json')) {
  lockSha256 = sha256(path.join(root, 'package-lock.json'));
  if (lockSha256 !== EXPECTED_CANDIDATE_LOCK_SHA256) failures.push(`package-lock.json SHA-256 mismatch: ${lockSha256}`);
}

const sourceReady = missing.length === 0 && failures.length === 0;
const result = {
  schemaVersion: 1,
  status: sourceReady ? 'SOURCE_READY_FOR_F4_EXECUTION' : 'BLOCKED',
  releaseCertified: false,
  releaseReadyMayChange: false,
  root,
  missing,
  failures,
  candidate: { version: pkg && !pkg.__error ? pkg.version ?? null : null, packageLockSha256: lockSha256 },
  certifiedBaseline: CERTIFIED_BASE,
  nextRequiredGate: sourceReady
    ? 'Run schema-v5 regression audit against the exact recovered V1.1.1 materialized baseline, then critical-change review and the complete mandatory F4 matrix.'
    : 'Synchronize the exact V1.2 application source without changing the reviewed dependency lock or releaseReady:false.',
  note: 'This readiness check never certifies or deploys V1.2. Production V1.1.1 remains untouched.'
};

if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`V1.2 certification readiness: ${result.status}`);
  for (const rel of missing) console.error(`MISSING: ${rel}`);
  for (const failure of failures) console.error(`BLOCKER: ${failure}`);
  console.log(`Next: ${result.nextRequiredGate}`);
}
process.exit(sourceReady ? 0 : 1);
