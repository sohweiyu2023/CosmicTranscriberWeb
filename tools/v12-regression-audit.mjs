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

const IGNORE_DIRS = new Set(['.git', 'node_modules', '.wrangler', 'dist', 'coverage', 'evidence']);
const REQUIRED_CANDIDATE = ['package.json','package-lock.json','app.js','wrangler.toml','RELEASE_MANIFEST.json','scripts/validate.mjs','tests'];
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

const missing = REQUIRED_CANDIDATE.filter((p)=>!fs.existsSync(path.join(candidate,p)));
if (missing.length) fail(`V1.2 audit BLOCKED: candidate source is incomplete. Missing: ${missing.join(', ')}`);

const pkg = readJson(path.join(candidate,'package.json'), 'candidate package.json');
const manifest = readJson(path.join(candidate,'RELEASE_MANIFEST.json'), 'candidate RELEASE_MANIFEST.json');
const identityFailures = [];
if (pkg.version !== '1.2.0') identityFailures.push(`package.json version=${JSON.stringify(pkg.version)}`);
if (manifest.product !== 'Cosmic Transcriber Web') identityFailures.push(`manifest product=${JSON.stringify(manifest.product)}`);
if (manifest.version !== '1.2.0') identityFailures.push(`manifest version=${JSON.stringify(manifest.version)}`);
if (manifest.releaseReady !== false) identityFailures.push(`manifest releaseReady=${JSON.stringify(manifest.releaseReady)} (must be false during development)`);
if (identityFailures.length) fail(`V1.2 audit BLOCKED: unsafe/stale candidate identity:\n - ${identityFailures.join('\n - ')}`);

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
    if (!item || typeof item.path !== 'string' || typeof item.reason !== 'string' || !item.reason.trim()) {
      fail('Each V1.2 deletion allowlist entry requires non-empty path and reason strings');
    }
    allow.set(item.path, item.reason.trim());
  }
}

const unexplainedDeleted = deleted.filter((p)=>!allow.has(p));
const staleAllowlist = [...allow.keys()].filter((p)=>!deleted.includes(p));
const criticalDeleted = deleted.filter(critical);
const criticalModified = modified.map((x)=>x.path).filter(critical);

const report = {
  schemaVersion: 1,
  status: unexplainedDeleted.length || staleAllowlist.length ? 'BLOCKED' : 'PASS',
  releaseReady: manifest.releaseReady,
  base: { root:path.resolve(base), fileCount:baseFiles.length },
  candidate: { root:path.resolve(candidate), fileCount:candFiles.length, version:pkg.version },
  counts: { added:added.length, modified:modified.length, deleted:deleted.length, unchanged:unchanged.length, unexplainedDeleted:unexplainedDeleted.length, staleAllowlist:staleAllowlist.length, criticalDeleted:criticalDeleted.length, criticalModified:criticalModified.length },
  added,
  modified,
  deleted: deleted.map((p)=>({path:p, allowed:allow.has(p), reason:allow.get(p) ?? null, critical:critical(p)})),
  unexplainedDeleted,
  staleAllowlist,
  criticalDeleted,
  criticalModified,
  note: 'PASS means only that file-level deletion provenance and candidate identity passed. It is NOT V1.2 release certification.'
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
