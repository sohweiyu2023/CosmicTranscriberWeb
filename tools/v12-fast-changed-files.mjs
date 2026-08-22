#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
function arg(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}
function git(args, allowFailure = false) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (!allowFailure && r.status !== 0) fail(`git ${args.join(' ')} failed: ${r.stderr.trim() || `exit ${r.status}`}`);
  return r;
}
function isCommitish(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
}
function hasCommit(sha) {
  return git(['cat-file', '-e', `${sha}^{commit}`], true).status === 0;
}
function safePaths(text) {
  const paths = [...new Set(text.split(/\r?\n/).map((x)=>x.trim()).filter(Boolean).map((x)=>x.replaceAll('\\','/')))].sort();
  for (const p of paths) {
    if (p.startsWith('/') || p.split('/').includes('..')) fail(`Unsafe changed path from git: ${JSON.stringify(p)}`, 1);
  }
  return paths;
}

const event = arg('--event');
const head = arg('--head');
const compare = arg('--compare');
const out = arg('--out');
const json = argv.includes('--json');
if (!['push','pull_request','workflow_dispatch'].includes(event) || !isCommitish(head)) {
  fail('Usage: node tools/v12-fast-changed-files.mjs --event <push|pull_request|workflow_dispatch> --head <40-hex-sha> [--compare <40-hex-sha>] [--out <file>] [--json]');
}
if (!hasCommit(head)) fail(`Head commit is not available locally: ${head}`, 1);

let mode = 'full-tree';
let fallbackFullTree = false;
let compareResolved = null;
let text = '';

if (event !== 'workflow_dispatch' && isCommitish(compare) && !/^0{40}$/.test(compare)) {
  if (!hasCommit(compare)) {
    git(['fetch', '--no-tags', '--depth=1', 'origin', compare], true);
  }
  if (hasCommit(compare)) {
    mode = 'exact-diff';
    compareResolved = compare.toLowerCase();
    text = git(['diff', '--name-only', '--no-renames', compare, head, '--']).stdout;
  } else {
    fallbackFullTree = true;
    console.error(`Fast change detection WARNING: comparison commit ${compare} is unavailable; conservatively using all tracked files.`);
  }
}
if (mode === 'full-tree') text = git(['ls-files']).stdout;

const files = safePaths(text);
if (out) fs.writeFileSync(out, files.length ? `${files.join('\n')}\n` : '', 'utf8');
const result = { schemaVersion: 1, event, head: head.toLowerCase(), compare: compareResolved, mode, fallbackFullTree, fileCount: files.length, files };
if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`Fast change detection: ${mode}${fallbackFullTree ? ' (fallback)' : ''}; ${files.length} path(s)`);
  for (const p of files) console.log(p);
}
