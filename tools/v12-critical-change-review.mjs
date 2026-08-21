#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
function arg(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const auditPath = arg('--audit');
const candidate = arg('--candidate');
const reviewArg = arg('--review');
if (!auditPath || !candidate) {
  console.error('Usage: node tools/v12-critical-change-review.mjs --audit <v12-regression-audit.json> --candidate <v1.2-dir> [--review <review.json>]');
  process.exit(2);
}

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

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}
function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { fail(`${label} is not valid JSON: ${e.message}`); }
}
function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}
function critical(rel) { return CRITICAL_PATH_PATTERNS.some((r)=>r.test(rel)); }
function safeRel(rel, label) {
  if (typeof rel !== 'string' || !rel || rel.includes('\\') || rel.startsWith('/') || rel.split('/').includes('..')) {
    fail(`${label} has unsafe path: ${JSON.stringify(rel)}`);
  }
  return rel;
}
function requireRegularCandidateFile(root, rel, label) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    fail(`${label} is not a regular candidate file: ${rel}`);
  }
  return abs;
}

if (!fs.existsSync(auditPath) || !fs.statSync(auditPath).isFile()) fail(`Audit JSON is not a file: ${auditPath}`, 2);
if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) fail(`Candidate is not a directory: ${candidate}`, 2);

const audit = readJson(auditPath, 'V1.2 regression audit');
if (audit.schemaVersion !== 2) fail(`Unsupported V1.2 regression-audit schemaVersion: ${JSON.stringify(audit.schemaVersion)}`);
if (audit.status !== 'PASS') fail(`Critical-change review BLOCKED: regression audit status is ${JSON.stringify(audit.status)}, expected PASS`);
if (!audit.candidate || audit.candidate.version !== '1.2.0') fail('Critical-change review BLOCKED: audit candidate is not V1.2.0');
if (!Array.isArray(audit.added) || !Array.isArray(audit.modified)) fail('Critical-change review BLOCKED: audit added/modified collections are missing');

const resolvedCandidate = path.resolve(candidate);
if (typeof audit.candidate.root !== 'string' || path.resolve(audit.candidate.root) !== resolvedCandidate) {
  fail(`Critical-change review BLOCKED: audit candidate root does not match the candidate being reviewed.\n audit: ${JSON.stringify(audit.candidate.root)}\n current: ${resolvedCandidate}`);
}

const expected = new Map();
for (const item of audit.modified) {
  if (!item || typeof item.path !== 'string' || typeof item.baseSha256 !== 'string' || typeof item.candidateSha256 !== 'string') {
    fail('Critical-change review BLOCKED: malformed modified entry in regression audit');
  }
  if (!critical(item.path)) continue;
  const rel = safeRel(item.path, 'Regression audit modified entry');
  const abs = requireRegularCandidateFile(candidate, rel, 'Critical-change review BLOCKED: critical modified path');
  const currentCandidateSha256 = sha256(abs);
  if (currentCandidateSha256 !== item.candidateSha256) {
    fail(`Critical-change review BLOCKED: stale regression audit for modified critical file ${rel}.\n audit candidateSha256: ${item.candidateSha256}\n current candidateSha256: ${currentCandidateSha256}`);
  }
  expected.set(`modified:${rel}`, {
    path: rel,
    change: 'modified',
    baseSha256: item.baseSha256,
    candidateSha256: currentCandidateSha256
  });
}
for (const raw of audit.added) {
  const rel = safeRel(raw, 'Regression audit added entry');
  if (!critical(rel)) continue;
  const abs = requireRegularCandidateFile(candidate, rel, 'Critical-change review BLOCKED: critical added path');
  expected.set(`added:${rel}`, {
    path: rel,
    change: 'added',
    baseSha256: null,
    candidateSha256: sha256(abs)
  });
}

const reviewPath = reviewArg ?? path.join(candidate, 'docs', 'V1.2_CRITICAL_CHANGE_REVIEW.json');
let review = [];
if (fs.existsSync(reviewPath)) {
  if (!fs.statSync(reviewPath).isFile()) fail(`Critical-change review path is not a regular file: ${reviewPath}`);
  review = readJson(reviewPath, 'V1.2 critical-change review');
  if (!Array.isArray(review)) fail('V1.2 critical-change review must be a JSON array');
} else if (expected.size) {
  fail(`Critical-change review BLOCKED: ${expected.size} critical added/modified file(s) require ${reviewPath}`);
}

const seen = new Set();
const stale = [];
const mismatched = [];
for (const item of review) {
  if (!item || !['added','modified'].includes(item.change) || typeof item.reason !== 'string' || !item.reason.trim()) {
    fail('Each critical-change review entry requires change=added|modified and a non-empty reason');
  }
  const rel = safeRel(item.path, 'Critical-change review entry');
  const key = `${item.change}:${rel}`;
  if (seen.has(key)) fail(`Duplicate critical-change review entry: ${key}`);
  seen.add(key);
  const exp = expected.get(key);
  if (!exp) {
    stale.push(key);
    continue;
  }
  if (item.candidateSha256 !== exp.candidateSha256) mismatched.push(`${key} candidateSha256`);
  if (item.change === 'modified') {
    if (item.baseSha256 !== exp.baseSha256) mismatched.push(`${key} baseSha256`);
  } else if (item.baseSha256 !== null && item.baseSha256 !== undefined) {
    mismatched.push(`${key} baseSha256 must be null/omitted for added files`);
  }
}

const unreviewed = [...expected.keys()].filter((key)=>!seen.has(key));
if (stale.length) fail(`Critical-change review BLOCKED: stale/non-critical review entries: ${stale.join(', ')}`);
if (mismatched.length) fail(`Critical-change review BLOCKED: hash mismatch: ${mismatched.join(', ')}`);
if (unreviewed.length) fail(`Critical-change review BLOCKED: unreviewed critical changes: ${unreviewed.join(', ')}`);

const summary = {
  schemaVersion: 2,
  status: 'PASS',
  candidateRoot: resolvedCandidate,
  criticalAddedOrModified: expected.size,
  reviewed: seen.size,
  staleAuditReplayProtection: true,
  note: 'PASS means critical added/modified file provenance is explicitly reviewed against exact current candidate hashes. It is NOT V1.2 release certification.'
};
console.log(JSON.stringify(summary, null, 2));
console.error('V1.2 critical-change provenance review PASS (not release certification).');
