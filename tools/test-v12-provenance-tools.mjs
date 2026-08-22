#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditTool = path.join(repoRoot, 'tools', 'v12-regression-audit.mjs');
const reviewTool = path.join(repoRoot, 'tools', 'v12-critical-change-review.mjs');
const TREE_HASH_ALGORITHM = 'sha256-path-utf8-nul-filehash-ascii-lf-codeunit-sort-v1';
const CERTIFIED_BASE_TREE_SHA256 = 'a67ba4aee35bf533c122f322418ac3fd4bf68601a1ae320deecb35318ffb5300';
const CERTIFIED_ZIP_SHA256 = 'a241dbf4ae50dab0e83b4a65000e587a7ffb51b0b568e9017207e22be81a27df';
const CERTIFICATION_RUN_ID = 31997529015;
const IGNORE_ROOT_DIRS = new Set(['.git', 'node_modules', '.wrangler', 'dist', 'coverage', 'evidence']);

function compareNames(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content, 'utf8'); }
function walk(root) {
  const out = [];
  function visit(rel) {
    for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort(compareNames)) {
      if (!rel && IGNORE_ROOT_DIRS.has(ent.name)) continue;
      const child = rel ? `${rel}/${ent.name}`: ent.name;
      if (ent.isDirectory()) visit(child);
      else if (ent.isFile()) out.push(child.replaceAll('\\', '/'));
      else throw new Error(`unsupported synthetic tree entry: ${child}`);
    }
  }
  visit(''); return out;
}
function treeSha256(root, files) {
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    h.update(Buffer.from(rel, 'utf8')); h.update(Buffer.from([0]));
    h.update(Buffer.from(sha256(path.join(root, rel)), 'ascii')); h.update(Buffer.from([10]));
  }
  return h.digest('hex');
}
function run(args) { return spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env }); }
let passed = 0;
const total = 15;
function pass(label) { passed += 1; console.log(`PASS: ${label}`); }
function expectExit(result, code, label) {
  if (result.status !== code) {
    console.error(`SELF-TEST FAIL: ${label}: expected exit ${code}, got ${result.status}`);
    console.error(result.stdout); console.error(result.stderr); process.exit(1);
  }
  pass(label);
}
function expectText(label, text, needle) {
  if (!text.includes(needle)) { console.error(`SELF-TEST FAIL: ${label}: missing ${JSON.stringify(needle)}`); console.error(text); process.exit(1); }
  pass(label);
}
function expect(label, condition) { if (!condition) { console.error(`SELF-TEST FAIL: ${label}`); process.exit(1); } pass(label); }

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmic-v12-prov-'));
try {
  const base = path.join(temp, 'base');
  const candidate = path.join(temp, 'candidate');
  const evidence = path.join(temp, 'audit.json');
  const reviewPath = path.join(temp, 'review.json');

  write(path.join(base, 'package.json'), JSON.stringify({ version: '1.1.1' }));
  write(path.join(base, 'RELEASE_MANIFEST.json'), JSON.stringify({ product: 'Cosmic Transcriber Web', version: '1.1.1', releaseReady: true }));
  write(path.join(base, 'README.md'), 'synthetic base\n');

  write(path.join(candidate, 'package.json'), JSON.stringify({ version: '1.2.0' }));
  write(path.join(candidate, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }));
  write(path.join(candidate, 'app.js'), 'export const v = "1.2.0";\n');
  write(path.join(candidate, 'wrangler.toml'), 'name = "cosmic-transcriber"\n');
  write(path.join(candidate, 'RELEASE_MANIFEST.json'), JSON.stringify({ product: 'Cosmic Transcriber Web', version: '1.2.0', releaseReady: false }));
  write(path.join(candidate, 'scripts', 'validate.mjs'), 'console.log("validate");\n');
  write(path.join(candidate, 'tests', 'smoke.test.js'), 'export const ok = true;\n');
  write(path.join(candidate, 'README.md'), 'candidate snapshot\n');
  write(path.join(candidate, 'dist', 'generated.txt'), 'ignored root build output\n');
  write(path.join(candidate, 'src', 'dist', 'nested-source.txt'), 'must remain provenance-visible\n');

  expectExit(run([auditTool, '--base', base, '--candidate', candidate]), 2, 'regression audit requires explicit certified-base hash argument');
  const wrongPinned = run([auditTool, '--base', base, '--expected-base-tree-sha256', '0'.repeat(64), '--candidate', candidate]);
  expectExit(wrongPinned, 1, 'regression audit rejects any non-certified supplied base hash');
  expectText('non-certified hash rejection identifies approved hard pin', wrongPinned.stderr, CERTIFIED_BASE_TREE_SHA256);

  const syntheticAudit = run([auditTool, '--base', base, '--expected-base-tree-sha256', CERTIFIED_BASE_TREE_SHA256, '--candidate', candidate]);
  expectExit(syntheticAudit, 1, 'regression audit still rejects synthetic/unreviewed V1.2 package-lock provenance');
  expectText('dependency-lock provenance rejection is explicit', syntheticAudit.stderr, 'package-lock.json does not match the reviewed development candidate');

  const candidateFiles = walk(candidate);
  expect('tree walk ignores generated root dist but includes nested source named dist', !candidateFiles.includes('dist/generated.txt') && candidateFiles.includes('src/dist/nested-source.txt'));

  const basePackageSha = sha256(path.join(base, 'package.json'));
  const candidatePackageSha = sha256(path.join(candidate, 'package.json'));
  const report = {
    schemaVersion: 5,
    treeHashAlgorithm: TREE_HASH_ALGORITHM,
    status: 'PASS',
    certifiedBaseline: {
      version: '1.1.1', certificationRunId: CERTIFICATION_RUN_ID,
      certifiedZipSha256: CERTIFIED_ZIP_SHA256, materializedTreeSha256: CERTIFIED_BASE_TREE_SHA256
    },
    base: { root: path.resolve(base), fileCount: walk(base).length, version: '1.1.1', releaseReady: true, treeSha256: CERTIFIED_BASE_TREE_SHA256, expectedTreeSha256: CERTIFIED_BASE_TREE_SHA256, provenanceVerified: true },
    candidate: { root: path.resolve(candidate), fileCount: candidateFiles.length, version: '1.2.0', packageLockSha256: sha256(path.join(candidate, 'package-lock.json')), treeSha256: treeSha256(candidate, candidateFiles) },
    added: ['RELEASE_MANIFEST.json','app.js','package-lock.json','scripts/validate.mjs','src/dist/nested-source.txt','tests/smoke.test.js','wrangler.toml'],
    modified: [{ path: 'package.json', baseSha256: basePackageSha, candidateSha256: candidatePackageSha }]
  };
  fs.writeFileSync(evidence, JSON.stringify(report, null, 2), 'utf8');
  const review = [
    { path: 'RELEASE_MANIFEST.json', change: 'added', candidateSha256: sha256(path.join(candidate, 'RELEASE_MANIFEST.json')), baseSha256: null, reason: 'synthetic manifest review' },
    { path: 'app.js', change: 'added', candidateSha256: sha256(path.join(candidate, 'app.js')), baseSha256: null, reason: 'synthetic application review' },
    { path: 'package-lock.json', change: 'added', candidateSha256: sha256(path.join(candidate, 'package-lock.json')), baseSha256: null, reason: 'synthetic lock review' },
    { path: 'scripts/validate.mjs', change: 'added', candidateSha256: sha256(path.join(candidate, 'scripts', 'validate.mjs')), baseSha256: null, reason: 'synthetic validation review' },
    { path: 'wrangler.toml', change: 'added', candidateSha256: sha256(path.join(candidate, 'wrangler.toml')), baseSha256: null, reason: 'synthetic deployment review' },
    { path: 'package.json', change: 'modified', baseSha256: basePackageSha, candidateSha256: candidatePackageSha, reason: 'synthetic version transition review' }
  ];
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2), 'utf8');

  expectExit(run([reviewTool, '--audit', evidence, '--candidate', candidate, '--review', reviewPath]), 0, 'critical review accepts unchanged schema-v5 synthetic candidate only when anchored to hard-pinned certified evidence');

  const wrongCertification = structuredClone(report); wrongCertification.certifiedBaseline.certificationRunId = 1;
  fs.writeFileSync(evidence, JSON.stringify(wrongCertification, null, 2), 'utf8');
  expectExit(run([reviewTool, '--audit', evidence, '--candidate', candidate, '--review', reviewPath]), 1, 'critical review rejects wrong certified run identity');

  const wrongAlgorithm = structuredClone(report); wrongAlgorithm.treeHashAlgorithm = 'locale-dependent-v0';
  fs.writeFileSync(evidence, JSON.stringify(wrongAlgorithm, null, 2), 'utf8');
  expectExit(run([reviewTool, '--audit', evidence, '--candidate', candidate, '--review', reviewPath]), 1, 'critical review rejects unknown tree-hash algorithm');

  const forgedBase = structuredClone(report); forgedBase.base.provenanceVerified = false;
  fs.writeFileSync(evidence, JSON.stringify(forgedBase, null, 2), 'utf8');
  expectExit(run([reviewTool, '--audit', evidence, '--candidate', candidate, '--review', reviewPath]), 1, 'critical review rejects disabled certified-base provenance');
  fs.writeFileSync(evidence, JSON.stringify(report, null, 2), 'utf8');

  write(path.join(candidate, 'README.md'), 'non-critical file changed after audit\n');
  const stale = run([reviewTool, '--audit', evidence, '--candidate', candidate, '--review', reviewPath]);
  expectExit(stale, 1, 'critical review rejects non-critical post-audit tree mutation');
  expectText('stale whole-tree rejection is explicit', stale.stderr, 'candidate tree changed after regression audit');

  write(path.join(candidate, 'README.md'), 'candidate snapshot\n');
  const copy = path.join(temp, 'candidate-copy'); fs.cpSync(candidate, copy, { recursive: true });
  expectExit(run([reviewTool, '--audit', evidence, '--candidate', copy, '--review', reviewPath]), 1, 'critical review rejects audit replay against another candidate root');

  const badBase = path.join(temp, 'bad-base'); fs.cpSync(base, badBase, { recursive: true });
  write(path.join(badBase, 'package.json'), JSON.stringify({ version: '1.1.0' }));
  expectExit(run([auditTool, '--base', badBase, '--expected-base-tree-sha256', CERTIFIED_BASE_TREE_SHA256, '--candidate', candidate]), 1, 'regression audit rejects non-V1.1.1 comparison base identity');

  write(path.join(candidate, 'RELEASE_MANIFEST.json'), JSON.stringify({ product: 'Cosmic Transcriber Web', version: '1.2.0', releaseReady: true }));
  expectExit(run([auditTool, '--base', base, '--expected-base-tree-sha256', CERTIFIED_BASE_TREE_SHA256, '--candidate', candidate]), 1, 'regression audit rejects V1.2 development candidate with releaseReady:true');

  if (passed !== total) {
    console.error(`SELF-TEST FAIL: accounting mismatch: ${passed}/${total} checks recorded`);
    process.exit(1);
  }
  console.log(`V1.2 provenance tooling self-test: ${passed}/${total} PASS`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
