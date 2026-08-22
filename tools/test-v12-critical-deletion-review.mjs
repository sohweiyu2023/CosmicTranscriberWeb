#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reviewTool = path.join(repoRoot, 'tools', 'v12-critical-change-review.mjs');
const TREE_HASH_ALGORITHM = 'sha256-path-utf8-nul-filehash-ascii-lf-codeunit-sort-v1';
const CERTIFIED_BASE_TREE_SHA256 = 'a67ba4aee35bf533c122f322418ac3fd4bf68601a1ae320deecb35318ffb5300';
const CERTIFIED_ZIP_SHA256 = 'a241dbf4ae50dab0e83b4a65000e587a7ffb51b0b568e9017207e22be81a27df';
const CERTIFICATION_RUN_ID = 31997529015;

function shaText(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function shaFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function walk(root) {
  const out = [];
  function visit(rel) {
    for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const child = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) visit(child);
      else if (ent.isFile()) out.push(child);
    }
  }
  visit('');
  return out;
}
function treeSha256(root) {
  const h = crypto.createHash('sha256');
  for (const rel of walk(root)) {
    h.update(Buffer.from(rel, 'utf8'));
    h.update(Buffer.from([0]));
    h.update(Buffer.from(shaFile(path.join(root, rel)), 'ascii'));
    h.update(Buffer.from([10]));
  }
  return h.digest('hex');
}
function run(args) { return spawnSync(process.execPath, args, { encoding: 'utf8' }); }
function check(condition, label, result) {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    if (result) { console.error(result.stdout); console.error(result.stderr); }
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmic-v12-critical-deletion-'));
try {
  const candidate = path.join(temp, 'candidate');
  fs.mkdirSync(candidate);
  fs.writeFileSync(path.join(candidate, 'README.md'), 'candidate\n', 'utf8');
  const deletedBaseSha256 = shaText('old auth worker\n');
  const audit = {
    schemaVersion: 5,
    treeHashAlgorithm: TREE_HASH_ALGORITHM,
    status: 'PASS',
    certifiedBaseline: {
      version: '1.1.1', certificationRunId: CERTIFICATION_RUN_ID,
      certifiedZipSha256: CERTIFIED_ZIP_SHA256, materializedTreeSha256: CERTIFIED_BASE_TREE_SHA256
    },
    base: {
      version: '1.1.1', provenanceVerified: true,
      treeSha256: CERTIFIED_BASE_TREE_SHA256, expectedTreeSha256: CERTIFIED_BASE_TREE_SHA256
    },
    candidate: {
      root: path.resolve(candidate), fileCount: walk(candidate).length,
      version: '1.2.0', treeSha256: treeSha256(candidate)
    },
    added: [],
    modified: [],
    deleted: [{
      path: 'worker/auth.js', allowed: true, reason: 'intentional replacement',
      baseSha256: deletedBaseSha256, critical: true
    }]
  };
  const auditPath = path.join(temp, 'audit.json');
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf8');

  let result = run([reviewTool, '--audit', auditPath, '--candidate', candidate, '--review', path.join(temp, 'missing.json')]);
  check(result.status === 1 && result.stderr.includes('critical added/modified/deleted'), 'missing explicit review for critical deletion blocks', result);

  const reviewPath = path.join(temp, 'review.json');
  fs.writeFileSync(reviewPath, JSON.stringify([{
    path: 'worker/auth.js', change: 'deleted', baseSha256: deletedBaseSha256,
    candidateSha256: null, reason: 'explicitly reviewed critical deletion'
  }], null, 2), 'utf8');
  result = run([reviewTool, '--audit', auditPath, '--candidate', candidate, '--review', reviewPath]);
  const parsed = result.status === 0 ? JSON.parse(result.stdout) : null;
  check(result.status === 0 && parsed.criticalDeleted === 1 && parsed.reviewed === 1, 'reviewed critical deletion passes and is counted', result);

  fs.writeFileSync(reviewPath, JSON.stringify([{
    path: 'worker/auth.js', change: 'deleted', baseSha256: '0'.repeat(64),
    candidateSha256: null, reason: 'forged base identity'
  }], null, 2), 'utf8');
  result = run([reviewTool, '--audit', auditPath, '--candidate', candidate, '--review', reviewPath]);
  check(result.status === 1 && result.stderr.includes('baseSha256'), 'forged critical-deletion base hash blocks', result);

  console.log('V1.2 critical-deletion trust-boundary self-test: 3/3 PASS');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
