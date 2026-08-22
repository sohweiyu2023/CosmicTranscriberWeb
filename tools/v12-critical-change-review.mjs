#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
function arg(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }
const auditPath = arg('--audit');
const candidate = arg('--candidate');
const reviewArg = arg('--review');
if (!auditPath || !candidate) {
  console.error('Usage: node tools/v12-critical-change-review.mjs --audit <v12-regression-audit.json> --candidate <v1.2-dir> [--review <review.json>]');
  process.exit(2);
}

const TREE_HASH_ALGORITHM = 'sha256-path-utf8-nul-filehash-ascii-lf-codeunit-sort-v1';
const CERTIFIED_BASE_TREE_SHA256 = 'a67ba4aee35bf533c122f322418ac3fd4bf68601a1ae320deecb35318ffb5300';
const CERTIFIED_ZIP_SHA256 = 'a241dbf4ae50dab0e83b4a65000e587a7ffb51b0b568e9017207e22be81a27df';
const CERTIFICATION_RUN_ID = 31997529015;
const IGNORE_ROOT_DIRS = new Set(['.git','node_modules','.wrangler','dist','coverage','evidence']);
const CRITICAL_PATH_PATTERNS = [
  /^app\.js$/,
  /^worker(?:\/|\.|$)/i,
  /^src\/.*(?:session|checkpoint|transcrib|billing|auth|access|key)/i,
  /^scripts\/.*(?:deploy|configure|rollback|validate|certif)/i,
  /^tests\/.*(?:session|checkpoint|billing|format|mime|wrangler|deploy|auth)/i,
  /^wrangler\.toml$/,
  /^package(?:-lock)?\.json$/,
  /^RELEASE_MANIFEST\.json$/
];

function fail(message, code = 1) { console.error(message); process.exit(code); }
function compareNames(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }
function readJson(file, label) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { fail(`${label} is not valid JSON: ${e.message}`); } }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function critical(rel) { return CRITICAL_PATH_PATTERNS.some((rx) => rx.test(rel)); }
function safeRel(rel, label) {
  if (typeof rel !== 'string' || !rel || rel.includes('\\') || rel.startsWith('/') || rel.split('/').includes('..')) fail(`${label} has unsafe path: ${JSON.stringify(rel)}`);
  return rel;
}
function regular(root, rel, label) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile() || fs.lstatSync(abs).isSymbolicLink()) fail(`${label} is not a regular candidate file: ${rel}`);
  return abs;
}
function walk(root) {
  const out = [];
  function visit(rel) {
    for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort(compareNames)) {
      if (!rel && IGNORE_ROOT_DIRS.has(ent.name)) continue;
      const child = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) visit(child);
      else if (ent.isFile()) out.push(child.replaceAll('\\', '/'));
      else if (ent.isSymbolicLink()) fail(`Critical-change review BLOCKED: symbolic links are not permitted in candidate tree: ${child}`);
      else fail(`Critical-change review BLOCKED: unsupported filesystem entry: ${child}`);
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

if (!fs.existsSync(auditPath) || !fs.statSync(auditPath).isFile() || fs.lstatSync(auditPath).isSymbolicLink()) fail(`Audit JSON is not a regular file: ${auditPath}`, 2);
if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory() || fs.lstatSync(candidate).isSymbolicLink()) fail(`Candidate is not a real directory: ${candidate}`, 2);

const audit = readJson(auditPath, 'V1.2 regression audit');
if (audit.schemaVersion !== 5) fail(`Unsupported V1.2 regression-audit schemaVersion: ${JSON.stringify(audit.schemaVersion)}`);
if (audit.treeHashAlgorithm !== TREE_HASH_ALGORITHM) fail(`Critical-change review BLOCKED: unsupported/missing treeHashAlgorithm: ${JSON.stringify(audit.treeHashAlgorithm)}`);
if (audit.status !== 'PASS') fail(`Critical-change review BLOCKED: regression audit status is ${JSON.stringify(audit.status)}, expected PASS`);
if (!audit.certifiedBaseline || audit.certifiedBaseline.version !== '1.1.1' || audit.certifiedBaseline.certificationRunId !== CERTIFICATION_RUN_ID || audit.certifiedBaseline.certifiedZipSha256 !== CERTIFIED_ZIP_SHA256 || audit.certifiedBaseline.materializedTreeSha256 !== CERTIFIED_BASE_TREE_SHA256) fail('Critical-change review BLOCKED: regression audit certifiedBaseline does not match the hard-pinned recovered V1.1.1 certification evidence');
if (!audit.base || audit.base.version !== '1.1.1' || audit.base.provenanceVerified !== true || audit.base.treeSha256 !== CERTIFIED_BASE_TREE_SHA256 || audit.base.expectedTreeSha256 !== CERTIFIED_BASE_TREE_SHA256) fail('Critical-change review BLOCKED: regression-audit base provenance does not match the hard-pinned certified V1.1.1 tree');
if (!audit.candidate || audit.candidate.version !== '1.2.0') fail('Critical-change review BLOCKED: audit candidate is not V1.2.0');
if (!Array.isArray(audit.added) || !Array.isArray(audit.modified) || !Array.isArray(audit.deleted)) fail('Critical-change review BLOCKED: audit added/modified/deleted collections are missing');

const resolved = path.resolve(candidate);
if (typeof audit.candidate.root !== 'string' || path.resolve(audit.candidate.root) !== resolved) fail(`Critical-change review BLOCKED: audit candidate root does not match the candidate being reviewed.\n audit: ${JSON.stringify(audit.candidate.root)}\n current: ${resolved}`);
if (typeof audit.candidate.treeSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(audit.candidate.treeSha256)) fail('Critical-change review BLOCKED: audit candidate treeSha256 is missing or malformed');
const currentFiles = walk(candidate);
const currentTree = treeSha256(candidate, currentFiles);
if (currentFiles.length !== audit.candidate.fileCount || currentTree !== audit.candidate.treeSha256) fail(`Critical-change review BLOCKED: candidate tree changed after regression audit.\n audit fileCount/treeSha256: ${audit.candidate.fileCount} / ${audit.candidate.treeSha256}\n current fileCount/treeSha256: ${currentFiles.length} / ${currentTree}`);

const expected = new Map();
for (const item of audit.modified) {
  if (!item || typeof item.path !== 'string' || typeof item.baseSha256 !== 'string' || typeof item.candidateSha256 !== 'string') fail('Critical-change review BLOCKED: malformed modified entry in regression audit');
  if (!critical(item.path)) continue;
  const rel = safeRel(item.path, 'Regression audit modified entry');
  const cur = sha256(regular(candidate, rel, 'Critical-change review BLOCKED: critical modified path'));
  if (cur !== item.candidateSha256) fail(`Critical-change review BLOCKED: stale regression audit for modified critical file ${rel}`);
  expected.set(`modified:${rel}`, { path: rel, change: 'modified', baseSha256: item.baseSha256, candidateSha256: cur });
}
for (const raw of audit.added) {
  const rel = safeRel(raw, 'Regression audit added entry');
  if (!critical(rel)) continue;
  expected.set(`added:${rel}`, { path: rel, change: 'added', baseSha256: null, candidateSha256: sha256(regular(candidate, rel, 'Critical-change review BLOCKED: critical added path')) });
}
for (const item of audit.deleted) {
  if (!item || typeof item.path !== 'string' || item.allowed !== true || typeof item.reason !== 'string' || !item.reason.trim() || typeof item.baseSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.baseSha256)) fail('Critical-change review BLOCKED: malformed or unapproved deleted entry in regression audit');
  const rel = safeRel(item.path, 'Regression audit deleted entry');
  if (!critical(rel)) continue;
  if (fs.existsSync(path.join(candidate, rel))) fail(`Critical-change review BLOCKED: deleted critical path unexpectedly exists in candidate: ${rel}`);
  expected.set(`deleted:${rel}`, { path: rel, change: 'deleted', baseSha256: item.baseSha256, candidateSha256: null });
}

const reviewPath = reviewArg ?? path.join(candidate, 'docs', 'V1.2_CRITICAL_CHANGE_REVIEW.json');
let review = [];
if (fs.existsSync(reviewPath)) {
  if (!fs.statSync(reviewPath).isFile() || fs.lstatSync(reviewPath).isSymbolicLink()) fail(`Critical-change review path is not a regular file: ${reviewPath}`);
  review = readJson(reviewPath, 'V1.2 critical-change review');
  if (!Array.isArray(review)) fail('V1.2 critical-change review must be a JSON array');
} else if (expected.size) {
  fail(`Critical-change review BLOCKED: ${expected.size} critical added/modified/deleted file(s) require ${reviewPath}`);
}

const seen = new Set();
const stale = [];
const mismatch = [];
for (const item of review) {
  if (!item || !['added','modified','deleted'].includes(item.change) || typeof item.reason !== 'string' || !item.reason.trim()) fail('Each critical-change review entry requires change=added|modified|deleted and a non-empty reason');
  const rel = safeRel(item.path, 'Critical-change review entry');
  const key = `${item.change}:${rel}`;
  if (seen.has(key)) fail(`Duplicate critical-change review entry: ${key}`);
  seen.add(key);
  const exp = expected.get(key);
  if (!exp) { stale.push(key); continue; }
  if (item.baseSha256 !== exp.baseSha256) mismatch.push(`${key} baseSha256`);
  if (item.change === 'deleted') {
    if (item.candidateSha256 !== null && item.candidateSha256 !== undefined) mismatch.push(`${key} candidateSha256 must be null/omitted for deleted files`);
  } else if (item.candidateSha256 !== exp.candidateSha256) mismatch.push(`${key} candidateSha256`);
  if (item.change === 'added' && item.baseSha256 !== null && item.baseSha256 !== undefined) mismatch.push(`${key} baseSha256 must be null/omitted for added files`);
}
const unreviewed = [...expected.keys()].filter((key) => !seen.has(key));
if (stale.length) fail(`Critical-change review BLOCKED: stale/non-critical review entries: ${stale.join(', ')}`);
if (mismatch.length) fail(`Critical-change review BLOCKED: hash mismatch: ${mismatch.join(', ')}`);
if (unreviewed.length) fail(`Critical-change review BLOCKED: unreviewed critical changes: ${unreviewed.join(', ')}`);

const counts = { added: 0, modified: 0, deleted: 0 };
for (const item of expected.values()) counts[item.change] += 1;
console.log(JSON.stringify({
  schemaVersion: 5,
  status: 'PASS',
  treeHashAlgorithm: TREE_HASH_ALGORITHM,
  certificationRunId: CERTIFICATION_RUN_ID,
  certifiedZipSha256: CERTIFIED_ZIP_SHA256,
  certifiedBaseTreeSha256: CERTIFIED_BASE_TREE_SHA256,
  certifiedBaseProvenanceVerified: true,
  candidateRoot: resolved,
  candidateFileCount: currentFiles.length,
  candidateTreeSha256: currentTree,
  criticalChanges: expected.size,
  criticalAdded: counts.added,
  criticalModified: counts.modified,
  criticalDeleted: counts.deleted,
  reviewed: seen.size,
  staleAuditReplayProtection: 'whole-candidate-tree',
  note: 'PASS means the audit is anchored to the hard-pinned recovered all-green V1.1.1 certification evidence, the exact candidate snapshot is unchanged, and every critical added, modified, or deleted file is explicitly reviewed. It is NOT V1.2 release certification.'
}, null, 2));
console.error('V1.2 critical-change provenance review PASS against hard-pinned certified V1.1.1 baseline (not release certification).');
