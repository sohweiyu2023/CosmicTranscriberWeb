import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
let lock;
try { lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8')); }
catch { throw new Error('package-lock.json is required for a release. Run npm install with the public npm registry, then rerun this gate.'); }
if (lock.lockfileVersion < 3) throw new Error('package-lock.json must use the current npm lockfile format (v3 or newer).');
const rootPkg = lock.packages?.[''];
if (!rootPkg) throw new Error('package-lock.json is missing the root package record.');
if (rootPkg.name !== pkg.name || rootPkg.version !== pkg.version) throw new Error('package.json and package-lock.json root identity/version do not match.');
for (const field of ['dependencies','devDependencies']) {
  const a = pkg[field] || {}, b = rootPkg[field] || {};
  if (!isDeepStrictEqual(a,b)) throw new Error(`${field} in package-lock.json does not exactly match package.json.`);
}
const forbidden = /(applied-caas|internal\.api\.openai\.org|localhost|127\.0\.0\.1|0\.0\.0\.0|file:|https?:\/\/[^/@\s]+:[^/@\s]+@)/i;
for (const [name, meta] of Object.entries(lock.packages || {})) {
  const resolved = meta?.resolved;
  if (!resolved) continue;
  if (forbidden.test(resolved)) throw new Error(`Non-portable or credential-bearing lock resolution at ${name}: ${resolved}`);
  if (/^https?:/i.test(resolved)) {
    const u = new URL(resolved);
    if (u.protocol !== 'https:' || u.hostname !== 'registry.npmjs.org') throw new Error(`Release lock must resolve registry packages from https://registry.npmjs.org: ${resolved}`);
  }
}
console.log('package-lock portability/identity gate PASS.');
