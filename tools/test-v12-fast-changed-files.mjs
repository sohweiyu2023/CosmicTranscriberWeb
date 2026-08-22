#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const collector = fileURLToPath(new URL('./v12-fast-changed-files.mjs', import.meta.url));
let passed = 0;
const total = 5;
function exec(cmd, args, cwd, allowFailure = false) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (!allowFailure && r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr}`);
  return r;
}
function git(cwd, ...args) { return exec('git', args, cwd).stdout.trim(); }
function expect(name, condition, detail = '') {
  if (!condition) { console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`); process.exit(1); }
  passed += 1;
  console.log(`PASS ${name}`);
}
function run(cwd, args) {
  const r = exec(process.execPath, [collector, '--json', ...args], cwd, true);
  return { ...r, parsed: r.status === 0 ? JSON.parse(r.stdout) : null };
}

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'v12-fast-changes-'));
git(repo, 'init', '-q');
git(repo, 'config', 'user.email', 'v12@example.invalid');
git(repo, 'config', 'user.name', 'V12 Fast Test');
fs.mkdirSync(path.join(repo, 'tests'));
fs.writeFileSync(path.join(repo, 'tests/checkpoint.test.js'), 'v1\n');
fs.writeFileSync(path.join(repo, 'README.md'), 'same\n');
git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base');
const base = git(repo, 'rev-parse', 'HEAD');

fs.writeFileSync(path.join(repo, 'tests/checkpoint.test.js'), 'v2\n');
git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'change checkpoint');
const head = git(repo, 'rev-parse', 'HEAD');
let r = run(repo, ['--event','push','--head',head,'--compare',base]);
expect('push uses exact diff', r.status === 0 && r.parsed.mode === 'exact-diff' && JSON.stringify(r.parsed.files) === JSON.stringify(['tests/checkpoint.test.js']));

const renameBase = head;
git(repo, 'mv', 'tests/checkpoint.test.js', 'tests/renamed.test.js');
git(repo, 'commit', '-qm', 'rename checkpoint test');
const renameHead = git(repo, 'rev-parse', 'HEAD');
r = run(repo, ['--event','pull_request','--head',renameHead,'--compare',renameBase]);
expect('rename exposes old and new paths', r.status === 0 && r.parsed.files.includes('tests/checkpoint.test.js') && r.parsed.files.includes('tests/renamed.test.js'));

r = run(repo, ['--event','push','--head',renameHead,'--compare','1111111111111111111111111111111111111111']);
expect('missing compare falls back fail-safe full tree', r.status === 0 && r.parsed.mode === 'full-tree' && r.parsed.fallbackFullTree === true && r.parsed.files.includes('README.md'));

r = run(repo, ['--event','workflow_dispatch','--head',renameHead]);
expect('manual dispatch intentionally uses full tree', r.status === 0 && r.parsed.mode === 'full-tree' && r.parsed.fallbackFullTree === false && r.parsed.fileCount === 2);

r = run(repo, ['--event','push','--head','not-a-sha','--compare',base]);
expect('invalid head fails closed', r.status !== 0 && r.stderr.includes('Usage:'));

console.log(`V1.2 fast changed-file self-test PASS: ${passed}/${total}`);
