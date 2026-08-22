#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const auditTool = path.join(repoRoot, 'tools', 'v12-regression-audit.mjs');
const reviewTool = path.join(repoRoot, 'tools', 'v12-critical-change-review.mjs');
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.wrangler', 'dist', 'coverage', 'evidence']);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}
function walk(root) {
  const out = [];
  function visit(rel) {
    const abs = path.join(root, rel);
    for (const ent of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      const child = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) visit(child);
      else if (ent.isFile()) out.push(child.replaceAll('\\', '/'));
      else throw new Error(`unsupported synthetic tree entry: ${child}`);
    }
  }
  visit('');
  return out;
}
function treeSha256(root, files) {
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    h.update(Buffer.from(rel, 'utf8'));
    h.update(Buffer.from([0]));
    h.update(Buffer.from(sha256(path.join(root, rel)), 'ascii'));
    h.update(Buffer.from([10]));
  }
  return h.digest('hex');
}
function run(args) {
  return spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env });
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
  const evidence = path.join(temp, 'audit.json');
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

  // The real regression auditor intentionally pins the reviewed V1.2 lock SHA.
  // A synthetic candidate must therefore fail before it can claim PASS; there is
  // deliberately no self-test escape hatch for dependency-lock provenance.
  const syntheticAudit = run([auditTool, '--base', base, '--candidate', candidate]);
  expectExit(syntheticAudit, 1, 'regression audit rejects synthetic/unreviewed package-lock provenance');
  if (!syntheticAudit.stderr.includes('package-lock.json does not match the reviewed development candidate')) {
    console.error('SELF-TEST FAIL: synthetic lock rejection did not identify dependency provenance');
    console.error(syntheticAudit.stderr);
    process.exit(1);
  }
  console.log('PASS: dependency-lock provenance rejection is explicit');

  const candidateFiles = walk(candidate);
  const basePackageSha = sha256(path.join(base, 'package.json'));
  const candidatePackageSha = sha256(path.join(candidate, 'package.json'));
  const added = [
    'RELEASE_MANIFEST.json',
    'app.js',
    'package-lock.json',
    'scripts/validate.mjs',
    'tests/smoke.test.js',
    'wrangler.toml'
  ];
  const report = {
    schemaVersion: 3,
    status: 'PASS',
    base: { root: path.resolve(base), fileCount: walk(base).length, version: '1.1.1', releaseReady: true, treeSha256: treeSha256(base, walk(base)) },
    candidate: { root: path.resolve(candidate), fileCount: candidateFiles.length, version: '1.2.0', packageLockSha256: sha256(path.join(candidate, 'package-lock.json')), treeSha256: treeSha256(candidate, candidateFiles) },
    added,
    modified: [{ path: 'package.json', baseSha256: basePackageSha, candidateSha256: candidatePackageSha }]
  };
  fs.writeFileSync(evidence, JSON.stringify(report, null, 2), 'utf8');

  const review = [
    { path: 'RELEASE_MANIFEST.json', change: 'added', candidateSha256: sha256(path.join(candidate, 'RELEASE_MANIFEST.json')), baseSha256: null, reason: 'synthetic manifest provenance review' },
    { path: 'app.js', change: 'added', candidateSha256: sha256(path.join(candidate, 'app.js')), baseSha256: null, reason: 'synthetic application provenance review' },
    { path: 'package-lock.json', change: 'added', candidateSha256: sha256(path.join(candidate, 'package-lock.json')), baseSha256: null, reason: 'synthetic lock provenance review' },
    { path: 'scripts/validate.mjs', change: 'added', candidateSha256: sha256(path.join(candidate, 'scripts', 'validate.mjs')), baseSha256: null, reason: 'synthetic validation provenance review' },
    { path: 'wrangler.toml', change: 'added', candidateSha256: sha256(path.join(candidate, 'wrangler.toml')), baseSha256: null, reason: 'synthetic deployment provenance review' },
    { path: 'package.json', change: 'modified', baseSha256: basePackageSha, candidateSha256: candidatePackageSha, reason: 'synthetic version-transition provenance review' }
  ];
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2), 'utf8');

  const reviewPass = run([reviewTool, '--audit', evidence, '--candidate', candidate, '--review', reviewPath]);
  expectExit(reviewPass, 0, 'critical-change review accepts unchanged schema-v3 audited candidate');

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
  const wrongBase = run([auditTool, '--base', badBase, '--candidate', candidate]);
  expectExit(wrongBase, 1, 'regression audit rejects non-certified-version comparison base');

  write(path.join(candidate, 'RELEASE_MANIFEST.json'), JSON.stringify({ product: 'Cosmic Transcriber Web', version: '1.2.0', releaseReady: true }));
  const unsafeReady = run([auditTool, '--base', base, '--candidate', candidate]);
  expectExit(unsafeReady, 1, 'regression audit rejects development candidate with releaseReady:true');

  console.log('V1.2 provenance tooling self-test: 7/7 PASS');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
