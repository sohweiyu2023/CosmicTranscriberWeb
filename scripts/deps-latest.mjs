import { readFile } from 'node:fs/promises';
import { invokeNpm } from './npm-invoke.mjs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
function run(args) {
  console.log(`> npm ${args.join(' ')}`);
  const r = invokeNpm(args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const prod = Object.keys(pkg.dependencies || {}).map(name => `${name}@latest`);
const dev = Object.keys(pkg.devDependencies || {}).map(name => `${name}@latest`);
if (prod.length) run(['install', '--ignore-scripts', '--save', ...prod]);
if (dev.length) run(['install', '--ignore-scripts', '--save-dev', ...dev]);
console.log('Direct dependencies moved to registry @latest releases with dependency lifecycle scripts disabled during resolution. The calling workflow now verifies the lock-wide allowScripts policy, rebuilds only after that review passes, then reinstalls browsers, audits, and validates.');
