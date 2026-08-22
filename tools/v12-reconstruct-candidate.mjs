#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const EXPECTED = Object.freeze({
  certifiedSourceZipSha256: 'a241dbf4ae50dab0e83b4a65000e587a7ffb51b0b568e9017207e22be81a27df',
  certifiedTreeSha256: 'a67ba4aee35bf533c122f322418ac3fd4bf68601a1ae320deecb35318ffb5300',
  batch2Base64Sha256: '14fd386b383a3e3f59eae4e912be864ce6c6b566057d1b8139ace04601c53d93',
  batch2TarGzSha256: '32c3f00a7cc5268f9f82b1e6b259347ece54e5a3273b56555974363f2e4ce05c',
  batch3Base64Sha256: '8c013b23ac596ffc593fbd97b7c69d62b35ef6a696878ed68c5032b5458d5c7c',
  batch3TarGzSha256: '4b39b2534983df947b33ed155f73691115630ef0bce48104a61e05535d7835aa',
  candidateTreeSha256: 'badaa131abbd50a1346654787852809423cfe0c4545373ef276e35a5173424a2',
  candidateFileCount: 169,
  packageLockSha256: '1eb32525cf5c4db2e976e44d348724054fe3c789a7ee535b943af16480e3674c',
});

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
async function hashFile(path) { return sha256(await readFile(path)); }

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (r.error || r.status !== 0) {
    const detail = [r.error?.message, r.stderr, r.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`command failed: ${cmd} ${args.join(' ')}${detail ? `\n${detail}` : ''}`);
  }
}

async function extractZip(zipPath, outDir) {
  await mkdir(outDir, { recursive: true });
  if (process.platform === 'win32') {
    const escapedZip = resolve(zipPath).replaceAll("'", "''");
    const escapedOut = resolve(outDir).replaceAll("'", "''");
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedOut}' -Force`]);
  } else {
    run('unzip', ['-q', zipPath, '-d', outDir]);
  }
}

async function extractTarGz(tarGzPath, outDir) {
  await mkdir(outDir, { recursive: true });
  run('tar', ['-xzf', tarGzPath, '-C', outDir]);
}

async function walkFiles(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symbolic link rejected: ${relative(root, full)}`);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(full);
      else throw new Error(`unsupported filesystem entry: ${relative(root, full)}`);
    }
  }
  await walk(root);
  return out;
}

function normalizedRel(root, full) { return relative(root, full).split(sep).join('/'); }

export async function treeFingerprint(root) {
  const files = await walkFiles(root);
  const entries = [];
  for (const full of files) entries.push([normalizedRel(root, full), await hashFile(full)]);
  entries.sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'variant' }));
  const body = entries.map(([path, hash]) => `${path}\0${hash}\n`).join('');
  return { fileCount: entries.length, treeSha256: sha256(Buffer.from(body, 'utf8')), entries };
}

async function copyTree(src, dst) {
  await mkdir(dst, { recursive: true });
  for (const full of await walkFiles(src)) {
    const rel = relative(src, full);
    const target = join(dst, rel);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(full, target);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--') || i + 1 >= argv.length) throw new Error(`invalid argument: ${key}`);
    args[key.slice(2)] = argv[++i];
  }
  for (const required of ['certified-source-zip', 'repo', 'out']) if (!args[required]) throw new Error(`missing --${required}`);
  return args;
}

function safePatchPath(raw) {
  if (raw === '/dev/null') return null;
  let p = raw.split('\t')[0].trim();
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  if (!p || p.startsWith('/') || p.includes('..') || p.includes('\\') || /^[A-Za-z]:/.test(p)) throw new Error(`unsafe patch path: ${raw}`);
  return p;
}

export function applyUnifiedPatchToText(original, patchText, expectedPath) {
  const lines = patchText.replaceAll('\r\n', '\n').split('\n');
  let oldPath;
  let newPath;
  const hunks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('--- ')) oldPath = safePatchPath(lines[i].slice(4));
    else if (lines[i].startsWith('+++ ')) newPath = safePatchPath(lines[i].slice(4));
    else if (lines[i].startsWith('@@ ')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);
      if (!m) throw new Error(`unsupported hunk header: ${lines[i]}`);
      const h = { oldStart: Number(m[1]), oldCount: Number(m[2] ?? '1'), newStart: Number(m[3]), newCount: Number(m[4] ?? '1'), body: [] };
      for (i += 1; i < lines.length && !lines[i].startsWith('@@ ') && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('--- '); i += 1) {
        if (lines[i] === '') break;
        if (lines[i] === '\\ No newline at end of file') continue;
        if (!/^[ +\-]/.test(lines[i])) throw new Error(`unsupported patch line: ${lines[i]}`);
        h.body.push(lines[i]);
      }
      i -= 1;
      hunks.push(h);
    }
  }
  const effective = newPath ?? oldPath;
  if (expectedPath && effective !== expectedPath) throw new Error(`patch path mismatch: expected ${expectedPath}, got ${effective}`);
  const source = original.replaceAll('\r\n', '\n').split('\n');
  if (source.at(-1) === '') source.pop();
  const result = [];
  let srcIndex = 0;
  for (const h of hunks) {
    const targetIndex = h.oldStart === 0 ? 0 : h.oldStart - 1;
    if (targetIndex < srcIndex || targetIndex > source.length) throw new Error(`invalid hunk location for ${effective}`);
    result.push(...source.slice(srcIndex, targetIndex));
    let consumed = 0;
    let produced = 0;
    srcIndex = targetIndex;
    for (const line of h.body) {
      const marker = line[0];
      const text = line.slice(1);
      if (marker === ' ') {
        if (source[srcIndex] !== text) throw new Error(`context mismatch for ${effective} at source line ${srcIndex + 1}`);
        result.push(text); srcIndex++; consumed++; produced++;
      } else if (marker === '-') {
        if (source[srcIndex] !== text) throw new Error(`deletion mismatch for ${effective} at source line ${srcIndex + 1}`);
        srcIndex++; consumed++;
      } else if (marker === '+') { result.push(text); produced++; }
    }
    if (consumed !== h.oldCount || produced !== h.newCount) throw new Error(`hunk count mismatch for ${effective}`);
  }
  result.push(...source.slice(srcIndex));
  return `${result.join('\n')}\n`;
}

export async function applyUnifiedPatch(root, patchText) {
  const normalized = patchText.replaceAll('\r\n', '\n');
  const chunks = normalized.split(/(?=^diff --git )/m).filter((x) => x.trim());
  if (!chunks.length) throw new Error('no diff chunks found');
  for (const chunk of chunks) {
    if (/^Binary files /m.test(chunk) || /^GIT binary patch$/m.test(chunk)) throw new Error('binary patches are not supported');
    const oldLine = chunk.match(/^--- (.+)$/m)?.[1];
    const newLine = chunk.match(/^\+\+\+ (.+)$/m)?.[1];
    if (!oldLine || !newLine) throw new Error('patch chunk missing ---/+++ paths');
    const oldPath = safePatchPath(oldLine);
    const newPath = safePatchPath(newLine);
    const rel = newPath ?? oldPath;
    const full = resolve(root, rel);
    const rootResolved = `${resolve(root)}${sep}`;
    if (!`${full}${full.endsWith(sep) ? '' : sep}`.startsWith(rootResolved) && full !== resolve(root)) throw new Error(`patch escapes root: ${rel}`);
    if (newPath === null) {
      await rm(full);
      continue;
    }
    let original = '';
    if (oldPath !== null) original = await readFile(resolve(root, oldPath), 'utf8');
    const next = applyUnifiedPatchToText(original, chunk, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, next, 'utf8');
  }
}

async function resolveInnerSourceZip(inputZip, temp) {
  const h = await hashFile(inputZip);
  if (h === EXPECTED.certifiedSourceZipSha256) return inputZip;
  const wrapper = join(temp, 'wrapper');
  await extractZip(inputZip, wrapper);
  const zips = (await walkFiles(wrapper)).filter((p) => p.toLowerCase().endsWith('.zip'));
  if (zips.length !== 1) throw new Error(`expected exactly one inner source ZIP, found ${zips.length}`);
  if (await hashFile(zips[0]) !== EXPECTED.certifiedSourceZipSha256) throw new Error('certified V1.1.1 source ZIP SHA-256 mismatch');
  return zips[0];
}

async function main() {
  const args = parseArgs(process.argv);
  const repo = resolve(args.repo);
  const out = resolve(args.out);
  const temp = await mkdtemp(join(tmpdir(), 'cosmic-v12-reconstruct-'));
  try {
    const innerZip = await resolveInnerSourceZip(resolve(args['certified-source-zip']), temp);
    const base = join(temp, 'base');
    await extractZip(innerZip, base);
    const baseFp = await treeFingerprint(base);
    if (baseFp.treeSha256 !== EXPECTED.certifiedTreeSha256) throw new Error(`certified V1.1.1 materialized tree mismatch: ${baseFp.treeSha256}`);

    const partDir = join(repo, 'tools', 'v12-batch2-prebilling-overlay.b64');
    const partNames = (await readdir(partDir)).filter((n) => /^part-\d+$/.test(n)).sort();
    if (!partNames.length) throw new Error('Batch 2 overlay parts not found');
    const base64Text = (await Promise.all(partNames.map((n) => readFile(join(partDir, n), 'utf8')))).join('');
    if (sha256(Buffer.from(base64Text, 'utf8')) !== EXPECTED.batch2Base64Sha256) throw new Error('Batch 2 base64 payload SHA-256 mismatch');
    const batch2Bytes = Buffer.from(base64Text, 'base64');
    if (sha256(batch2Bytes) !== EXPECTED.batch2TarGzSha256) throw new Error('Batch 2 tar.gz SHA-256 mismatch');
    const batch2Tar = join(temp, 'batch2.tar.gz');
    await writeFile(batch2Tar, batch2Bytes);

    await rm(out, { recursive: true, force: true });
    await copyTree(base, out);
    await extractTarGz(batch2Tar, out);

    const batch3B64Path = join(repo, 'tools', 'v12-batch3-multiformat.patch.gz.b64');
    const batch3B64 = await readFile(batch3B64Path, 'utf8');
    if (sha256(Buffer.from(batch3B64, 'utf8')) !== EXPECTED.batch3Base64Sha256) throw new Error('Batch 3 base64 payload SHA-256 mismatch');
    const compressedPatch = Buffer.from(batch3B64, 'base64');
    if (sha256(compressedPatch) !== EXPECTED.batch3TarGzSha256) throw new Error('Batch 3 compressed patch SHA-256 mismatch');
    const { gunzipSync } = await import('node:zlib');
    const patchText = gunzipSync(compressedPatch).toString('utf8');
    await applyUnifiedPatch(out, patchText);

    const pkg = JSON.parse(await readFile(join(out, 'package.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(join(out, 'RELEASE_MANIFEST.json'), 'utf8'));
    if (pkg.version !== '1.2.0') throw new Error(`candidate package version is ${pkg.version}, expected 1.2.0`);
    if (manifest.releaseReady !== false) throw new Error('candidate RELEASE_MANIFEST.json must keep releaseReady:false');
    if (await hashFile(join(out, 'package-lock.json')) !== EXPECTED.packageLockSha256) throw new Error('candidate package-lock.json SHA-256 mismatch');
    const candidateFp = await treeFingerprint(out);
    if (candidateFp.fileCount !== EXPECTED.candidateFileCount) throw new Error(`candidate file count mismatch: ${candidateFp.fileCount}`);
    if (candidateFp.treeSha256 !== EXPECTED.candidateTreeSha256) throw new Error(`candidate tree SHA-256 mismatch: ${candidateFp.treeSha256}`);
    console.log(JSON.stringify({ status: 'PASS', version: pkg.version, releaseReady: false, fileCount: candidateFp.fileCount, treeSha256: candidateFp.treeSha256 }, null, 2));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) main().catch((err) => { console.error(`FAIL: ${err.message}`); process.exitCode = 1; });
