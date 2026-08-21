#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
function arg(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const base = arg('--base');
const candidate = arg('--candidate');
const jsonOut = arg('--json');
if (!base || !candidate) {
  console.error('Usage: node tools/v12-regression-audit.mjs --base <certified-v1.1.1-dir> --candidate <v1.2-dir> [--json <output.json>]');
  process.exit(2);
}

const EXPECTED_CANDIDATE_LOCK_SHA256 = '1eb32525cf5c4db2e976e44d348724054fe3c789a7ee535b943af16480e3674c';
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.wrangler', 'dist', 'coverage', 'evidence']);
const REQUIRED_BASE_FILES = ['package.json','RELEASE_MANIFEST.json'];
const REQUIRED_CANDIDATE_FILES = ['package.json','package-lock.json','app.js','wrangler.toml','RELEASE_MANIFEST.json','scripts/validate.mjs'];
const REQUIRED_CANDIDATE_DIRS = ['tests'];
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
function ensureDir(p, label) {
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) fail(`${label} is not a directory: ${p}`, 2);
}
function requireFiles(root, required, label) {
  const invalid = required.filter((p)=>{
    const abs = path.join(root,p);
    return !fs.existsSync(abs) || !fs.statSync(abs).isFile();
  });
  if (invalid.length) fail(`${label} is incomplete. Missing/non-file: ${invalid.join(', ')}`);
}
function requireDirs(root, required, label) {
  const invalid = required.filter((p)=>{
    const abs = path.join(root,p);
    return !fs.existsSync(abs) || !fs.statSync(abs).isDirectory();
  });
  if (invalid.length) fail(`${label} is incomplete. Missing/non-directory: ${invalid.join(', ')}`);
}

function walk(root) {
  const out = [];
  function visit(rel) {
    const abs = path.join(root, rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) visit(childRel);
      else if (ent.isFile()) out.push(childRel.replaceAll('\\','/'));
      else if (ent.isSymbolicLink()) fail(`V1.2 audit BLOCKED: symbolic links are not permitted in compared source trees: ${childRel}`);
    }
  }
  visit('');
  return out;
}
function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}
function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { fail(`${label} is not valid JSON: ${e.message}`); }
}
function critical(rel) { return CRITICAL_PATH_PATTERNS.some((r)=>r.test(rel)); }

ensureDir(base, 'Base');
ensureDir(candidate, 'Candidate');
requireFiles(base, REQUIRED_BASE_FILES, 'V1.1.1 audit base');
requireFiles(candidate, REQUIRED_CANDIDATE_FILES, 'V1.2 audit candidate');
requireDirs(candidate, REQUIRED_CANDIDATE_DIRS, 'V1.2 audit candidate');

const basePkg = readJson(path.join(base,'package.json'), 'base package.json');
const baseManifest = readJson(path.join(base,'RELEASE_MANIFEST.json'), 'base RELEASE_MANIFEST.json');
const baseIdentityFailures = [];
if (basePkg.version !== '1.1.1') baseIdentityFailures.push(`package.json version=${JSON.stringify(basePkg.version)}`);
if (baseManifest.product !== 'Cosmic Transcriber Web') baseIdentityFailures.push(`manifest product=${JSON.stringify(baseManifest.product)}`);
if (baseManifest.version !== '1.1.1') baseIdentityFailures.push(`manifest version=${JSON.stringify(baseManifest.version)}`);
if (baseManifest.releaseReady !== true) baseIdentityFailures.push(`manifest releaseReady=${JSON.stringify(baseManifest.releaseReady)} (certified comparison base must be true)`);
if (baseIdentityFailures.length) fail(`V1.2 audit BLOCKED: comparison base is not the certified V1.1.1 identity:\n - ${baseIdentityFailures.join('\n - ')}`);

const pkg = readJson(path.join(candidate,'package.json'), 'candidate package.json');
const manifest = readJson(path.join(candidate,'RELEASE_MANIFEST.json'), 'candidate RELEASE_MANIFEST.json');
const identityFailures = [];
if (pkg.version !== '1.2.0') identityFailures.push(`package.json version=${JSON.stringify(pkg.version)}`);
if (manifest.product !== 'Cosmic Transcriber Web') identityFailures.push(`manifest product=${JSON.stringify(manifest.product)}`);
if (manifest.version !== '1.2.0') identityFailures.push(`manifest version=${JSON.stringify(manifest.version)}`);
if (manifest.releaseReady !== false) identityFailures.push(`manifest releaseReady=${JSON.stringify(manifest.releaseReady)} (must be false during development)`);
if (identityFailures.length) fail(`V1.2 audit BLOCKED: unsafe/stale candidate identity:\n - ${identityFailures.join('\n - ')}`);

const candidateLockSha256 = sha256(path.join(candidate,'package-lock.json'));
if (candidateLockSha256 !== EXPECTED_CANDIDATE_LOCK_SHA256) {
  fail(`V1.2 audit BLOCKED: candidate package-lock.json does not match the reviewed development candidate.\n expected: ${EXPECTED_CANDIDATE_LOCK_SHA256}\n actual:   ${candidateLockSha256}`);
}

const baseFiles = walk(base);
const candFiles = walk(candidate);
const baseSet = new Set(baseFiles);
const candSet = new Set(candFiles);
const added = candFiles.filter((f)=>!baseSet.has(f));
const deleted = baseFiles.filter((f)=>!candSet.has(f));
const common = baseFiles.filter((f)=>candSet.has(f));
const modified = [];
const unchanged = [];
for (const rel of common) {
  const a = sha256(path.join(base,rel));
  const b = sha256(path.join(candidate,rel));
  (a === b ? unchanged : modified).push({path: rel, baseSha256:a, candidateSha256:b});
}

const deletionAllowlistPath = path.join(candidate,'docs','V1.2_DELETION_ALLOWLIST.json');
let allow = new Map();
if (fs.existsSync(deletionAllowlistPath)) {
  const parsed = readJson(deletionAllowlistPath, 'V1.2 deletion allowlist');
  if (!Array.isArray(parsed)) fail('V1.2 deletion allowlist must be a JSON array');
  for (const item of parsed) {
    if (!item || typeof item.path !== 'string' || typeof item.reason !== 'string' || !item.reason.trim() || typeof item.baseSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.baseSha256)) {
      fail('Each V1.2 deletion allowlist entry requires non-empty path/reason strings and a lowercase 64-hex baseSha256');
    }
    const normalizedPath = item.path.replaceAll('\\','/');
    if (normalizedPath !== item.path || normalizedPath.startsWith('/') || normalizedPath.split('/').includes('..') || normalizedPath === '') {
      fail(`Unsafe V1.2 deletion allowlist path: ${JSON.stringify(item.path)}`);
    }
    if (allow.has(normalizedPath)) fail(`Duplicate V1.2 deletion allowlist path: ${normalizedPath}`);
    const baseFile = path.join(base, normalizedPath);
    if (!fs.existsSync(baseFile) || !fs.statSync(baseFile).isFile()) fail(`Deletion allowlist path is not a regular file in the V1.1.1 base: ${normalizedPath}`);
    const actualBaseSha256 = sha256(baseFile);
    if (actualBaseSha256 !== item.baseSha256) {
      fail(`Deletion allowlist baseSha256 mismatch for ${normalizedPath}: expected ${item.baseSha256}, actual ${actualBaseSha256}`);
    }
    allow.set(normalizedPath, {reason:item.reason.trim(), baseSha256:item.baseSha256});
  }
}

const unexplainedDeleted = deleted.filter((p)=>!allow.has(p));
const staleAllowlist = [...allow.keys()].filter((p)=>!deleted.includes(p));
const criticalDeleted = deleted.filter(critical);
const criticalModified = modified.map((x)=>x.path).filter(critical);

const report = {
  schemaVersion: 2,
  status: unexplainedDeleted.length || staleAllowlist.length ? 'BLOCKED' : 'PASS',
  releaseReady: manifest.releaseReady,
  base: { root:path.resolve(base), fileCount:baseFiles.length, version:basePkg.version, releaseReady:baseManifest.releaseReady },
  candidate: { root:path.resolve(candidate), fileCount:candFiles.length, version:pkg.version, packageLockSha256:candidateLockSha256 },
  counts: { added:added.length, modified:modified.length, deleted:deleted.length, unchanged:unchanged.length, unexplainedDeleted:unexplainedDeleted.length, staleAllowlist:staleAllowlist.length, criticalDeleted:criticalDeleted.length, criticalModified:criticalModified.length },
  added,
  modified,
  deleted: deleted.map((p)=>({path:p, allowed:allow.has(p), reason:allow.get(p)?.reason ?? null, baseSha256:allow.get(p)?.baseSha256 ?? null, critical:critical(p)})),
  unexplainedDeleted,
  staleAllowlist,
  criticalDeleted,
  criticalModified,
  note: 'PASS means only that base/candidate identity, candidate dependency-lock provenance, and file-level deletion provenance passed. It is NOT V1.2 release certification.'
};

const text = JSON.stringify(report,null,2) + '\n';
if (jsonOut) {
  fs.mkdirSync(path.dirname(path.resolve(jsonOut)), {recursive:true});
  fs.writeFileSync(jsonOut,text,'utf8');
}
console.log(text.trimEnd());

if (staleAllowlist.length) {
  console.error(`V1.2 audit BLOCKED: stale deletion allowlist entries: ${staleAllowlist.join(', ')}`);
  process.exit(1);
}
if (unexplainedDeleted.length) {
  console.error(`V1.2 audit BLOCKED: unexplained deletions: ${unexplainedDeleted.join(', ')}`);
  process.exit(1);
}
console.error('V1.2 file-level regression audit PASS (not release certification).');
