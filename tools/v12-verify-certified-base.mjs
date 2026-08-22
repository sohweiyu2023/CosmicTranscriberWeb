#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
function arg(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }
function fail(message, code = 1) { console.error(message); process.exit(code); }

const base = arg('--base');
const certifiedZip = arg('--certified-zip');
const jsonOut = arg('--json');
if (!base) {
  console.error('Usage: node tools/v12-verify-certified-base.mjs --base <materialized-v1.1.1-dir> [--certified-zip <CosmicTranscriberWeb-1.1.1-source.zip>] [--json <output.json>]');
  process.exit(2);
}

const EXPECTED = Object.freeze({
  version: '1.1.1',
  product: 'Cosmic Transcriber Web',
  certificationRunId: 31997529015,
  certificationHeadSha: '725327e6af5f15ebf7ba3da39674d8ff12b85229',
  certifiedArtifactId: 9277847563,
  githubArtifactDigestSha256: '8347bb5e4bc7bf1904a0aaa26a285b07de4166e8b41be227f7af13dfc0a1fa2c',
  certifiedZipSha256: 'a241dbf4ae50dab0e83b4a65000e587a7ffb51b0b568e9017207e22be81a27df',
  materializedFileCount: 154,
  materializedTreeSha256: 'a67ba4aee35bf533c122f322418ac3fd4bf68601a1ae320deecb35318ffb5300'
});
const TREE_HASH_ALGORITHM = 'sha256-path-utf8-nul-filehash-ascii-lf-codeunit-sort-v1';
const IGNORE_ROOT_DIRS = new Set(['.git','node_modules','.wrangler','dist','coverage','evidence']);

function ensureRealDir(p, label) {
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory() || fs.lstatSync(p).isSymbolicLink()) fail(`${label} is not a real directory: ${p}`, 2);
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function compareNames(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }
function walk(root) {
  const out = [];
  function visit(rel) {
    for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort(compareNames)) {
      if (!rel && IGNORE_ROOT_DIRS.has(ent.name)) continue;
      const child = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) visit(child);
      else if (ent.isFile()) out.push(child.replaceAll('\\', '/'));
      else if (ent.isSymbolicLink()) fail(`Certified-base verification BLOCKED: symbolic links are not permitted: ${child}`);
      else fail(`Certified-base verification BLOCKED: unsupported filesystem entry: ${child}`);
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
function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { fail(`${label} is not valid JSON: ${e.message}`); }
}

const root = path.resolve(base);
ensureRealDir(root, 'Certified V1.1.1 base');
for (const rel of ['package.json', 'RELEASE_MANIFEST.json', 'SHA256SUMS.txt']) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile() || fs.lstatSync(p).isSymbolicLink()) fail(`Certified-base verification BLOCKED: missing/non-regular file: ${rel}`);
}

const pkg = readJson(path.join(root, 'package.json'), 'package.json');
const manifest = readJson(path.join(root, 'RELEASE_MANIFEST.json'), 'RELEASE_MANIFEST.json');
const identityFailures = [];
if (pkg.version !== EXPECTED.version) identityFailures.push(`package.json version=${JSON.stringify(pkg.version)}`);
if (manifest.product !== EXPECTED.product) identityFailures.push(`manifest product=${JSON.stringify(manifest.product)}`);
if (manifest.version !== EXPECTED.version) identityFailures.push(`manifest version=${JSON.stringify(manifest.version)}`);
if (manifest.releaseReady !== true) identityFailures.push(`manifest releaseReady=${JSON.stringify(manifest.releaseReady)} (certified base must be true)`);
if (identityFailures.length) fail(`Certified-base verification BLOCKED: identity mismatch:\n - ${identityFailures.join('\n - ')}`);

let certifiedZipSha256 = null;
if (certifiedZip) {
  const zipPath = path.resolve(certifiedZip);
  if (!fs.existsSync(zipPath) || !fs.statSync(zipPath).isFile() || fs.lstatSync(zipPath).isSymbolicLink()) fail(`Certified ZIP is not a regular file: ${zipPath}`, 2);
  certifiedZipSha256 = sha256(zipPath);
  if (certifiedZipSha256 !== EXPECTED.certifiedZipSha256) fail(`Certified-base verification BLOCKED: certified ZIP SHA-256 mismatch.\n expected: ${EXPECTED.certifiedZipSha256}\n actual:   ${certifiedZipSha256}`);
}

const files = walk(root);
const materializedTreeSha256 = treeSha256(root, files);
if (files.length !== EXPECTED.materializedFileCount) fail(`Certified-base verification BLOCKED: materialized file count mismatch. expected ${EXPECTED.materializedFileCount}, actual ${files.length}`);
if (materializedTreeSha256 !== EXPECTED.materializedTreeSha256) fail(`Certified-base verification BLOCKED: materialized tree SHA-256 mismatch.\n expected: ${EXPECTED.materializedTreeSha256}\n actual:   ${materializedTreeSha256}\n algorithm: ${TREE_HASH_ALGORITHM}`);

const result = {
  schemaVersion: 1,
  status: 'CERTIFIED_V1_1_1_BASE_VERIFIED',
  v12Certified: false,
  productionChanged: false,
  base: { root, version: pkg.version, releaseReady: manifest.releaseReady, fileCount: files.length, treeHashAlgorithm: TREE_HASH_ALGORITHM, treeSha256: materializedTreeSha256 },
  certifiedZip: certifiedZip ? { path: path.resolve(certifiedZip), sha256: certifiedZipSha256 } : null,
  expected: EXPECTED,
  next: 'Use this exact materialized tree as the --base input to v12-regression-audit.mjs once the complete V1.2 candidate source is synchronized.'
};
const text = JSON.stringify(result, null, 2) + '\n';
if (jsonOut) { fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true }); fs.writeFileSync(jsonOut, text, 'utf8'); }
console.log(text.trimEnd());
console.error('Certified V1.1.1 regression base verification PASS (this does not certify V1.2).');
