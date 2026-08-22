#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const auditTool = path.join(repoRoot, 'tools', 'v12-regression-audit.mjs');
const reviewTool = path.join(repoRoot, 'tools', 'v12-critical-change-review.mjs');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}
function run(args, env = {}) {
  return spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}
function expectExit(result, code, label) {
  if (result.status !== code) {
    console.error(`SELF-TEST FAIL: ${label}: expected exit ${code}, got ${result.status}`);
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmic-v12-prov-'));
try {
  const base = path.join(temp, 'base');
  const candidate = path.join(temp, 'candidate');
  const evidence = path.join(temp, 'evidence', 'audit.json');
  const reviewPath = path.join(temp, 'review.json');

  write(path.join(base, 'package.json'), JSON.stringify({ version: '1.1.1' }));
  write(path.join(base, 'RELEASE_MANIFEST.json'), JSON.stringify({ product: 'Cosmic Transcriber Web', version: '1.1.1', releaseReady: true }));
  write(path.join(base, 'README.md'), 'certified base\n');

  write(path.join(candidate, 'package.json'), JSON.stringify({ version: '1.2.0' }));
  write(path.join(candidate, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }));
  write(path.join(candidate, 'app.js'), 'export const v = "1.2.0";\n');
  write(path.join(candidate, 'wrangler.toml'), 'name = "cosmic-transcriber"\n');
  write(path.join(candidate, 'RELEASE_MANIFEST.json'), JSON.stringify({ product: 'Cosmic Transcriber Web', version: '1.2.0', releaseReady: false }));
  write(path.join(candidate, 'scripts', 'validate.mjs'), 'console.log("validate");\n');
  write(path.join(candidate, 'tests', 'smoke.test.js'), 'export const ok = true;\n');
  write(path.join(candidate, 'README.md'), 'candidate snapshot\n');

  const expectedLock = sha256(path.join(candidate, 'package-lock.json'));
  const audit = run([auditTool, '--base', base, '--candidate', candidate, '--json', evidence], {
    V12_EXPECTED_LOCK_SHA256: expectedLock
  });
  expectExit(audit, 0, 'regression audit accepts valid synthetic base/candidate snapshots');

  const report = JSON.parse(fs.readFileSync(evidence, 'utf8'));
  if (report.schemaVersion !== 3 || !report.candidate?.treeSha256 || !report.base?.treeSha256) {
    console.error('SELF-TEST FAIL: regression audit did not emit schema v3 whole-tree fingerprints');
    process.exit(1);
  }
  console.log('PASS: regression audit emits schema v3 whole-tree fingerprints');

  const review = [];
  for (const rel of report.added) {
    if (/^(app\.js|wrangler\.toml|RELEASE_MANIFEST\.json|package-lock\.json|scripts\/)/.test(rel)) {
      review.push({ path: rel, change: 'added', candidateSha256: sha256(path.join(candidate, rel)), baseSha256: null, reason: 'synthetic provenance self-test' });
    }
  }
  for (const item of report.modified) {
    if (item.path === 'package.json') {
      review.push({ path: item.path, change: 'modified', baseSha256: item.baseSha256, candidateSha256: item.candidateSha256, reason: 'synthetic version transition' });
    }
  }
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2), 'utf8');

  const reviewPass = run([reviewTool, '--audit', evidence, '--candidate', candidate, '--review', reviewPath]);
  expectExit(reviewPass, 0, 'critical-change review accepts unchanged audited candidate');

  write(path.join(candidate, 'README.md'), 'non-critical file changed after audit\n');
  const staleWholeTree = run([reviewTool, '--audit', evidence, '--candidate', candidate, '--review', reviewPath]);
  expectExit(staleWholeTree, 1, 'critical-change review rejects non-critical post-audit tree mutation');
  if (!staleWholeTree.stderr.includes('candidate tree changed after regression audit')) {
    console.error('SELF-TEST FAIL: stale whole-tree rejection did not identify the expected cause');
    console.error(staleWholeTree.stderr);
    process.exit(1);
  }
  console.log('PASS: stale whole-tree rejection is explicit');

  write(path.join(candidate, 'README.md'), 'candidate snapshot\n');
  const wrongRoot = path.join(temp, 'candidate-copy');
  fs.cpSync(candidate, wrongRoot, { recursive: true });
  const copiedAudit = run([reviewTool, '--audit', evidence, '--candidate', wrongRoot, '--review', reviewPath]);
  expectExit(copiedAudit, 1, 'critical-change review rejects audit replay against another candidate root');

  const badBase = path.join(temp, 'bad-base');
  fs.cpSync(base, badBase, { recursive: true });
  write(path.join(badBase, 'package.json'), JSON.stringify({ version: '1.1.0' }));
  const wrongBase = run([auditTool, '--base', badBase, '--candidate', candidate], { V12_EXPECTED_LOCK_SHA256: expectedLock });
  expectExit(wrongBase, 1, 'regression audit rejects non-certified-version comparison base');

  write(path.join(candidate, 'RELEASE_MANIFEST.json'), JSON.stringify({ product: 'Cosmic Transcriber Web', version: '1.2.0', releaseReady: true }));
  const unsafeReady = run([auditTool, '--base', base, '--candidate', candidate], { V12_EXPECTED_LOCK_SHA256: expectedLock });
  expectExit(unsafeReady, 1, 'regression audit rejects development candidate with releaseReady:true');

  console.log('V1.2 provenance tooling self-test: 8/8 PASS');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
