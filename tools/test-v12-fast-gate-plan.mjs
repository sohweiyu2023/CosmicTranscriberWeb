#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const planner = new URL('./v12-fast-gate-plan.mjs', import.meta.url);
let passed = 0;
const total = 14;

function run(args) {
  return spawnSync(process.execPath, [planner.pathname, ...args], { encoding: 'utf8' });
}
function expect(name, condition, detail = '') {
  if (!condition) {
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`PASS ${name}`);
}
function parsed(args) {
  const r = run(['--json', ...args]);
  if (r.status !== 0) throw new Error(r.stderr || `planner exited ${r.status}`);
  return JSON.parse(r.stdout);
}

let p = parsed(['docs/V1.2_FAST_DEVELOPMENT_MODE.md']);
expect('docs stay F0', p.recommendedTier === 'F0');

p = parsed(['docs/V1.2_BILLING_CHECKPOINT_FORMAT_DEPLOYMENT.md']);
expect('critical-word docs stay F0', p.recommendedTier === 'F0' && !p.areas.includes('billing') && !p.requiredChecks.some((x)=>x.id === 'billing-checkpoint-targeted'));

p = parsed(['tools/v12-fast-billing-notes.mjs']);
expect('fast release tooling stays F0 despite critical words', p.recommendedTier === 'F0' && p.areas.includes('provenance-tooling'));

p = parsed(['tests/checkpoint-billing.test.js']);
expect('billing/checkpoint escalates F2', p.recommendedTier === 'F2' && p.requiredChecks.some((x)=>x.id === 'billing-checkpoint-targeted'));

p = parsed(['src/audio/m4a-parser.js']);
expect('local format runtime stays focused F2', p.recommendedTier === 'F2' && p.requiredChecks.some((x)=>x.id === 'nine-format-targeted'));

p = parsed(['package-lock.json']);
expect('dependency change escalates F3', p.recommendedTier === 'F3' && p.requiredChecks.some((x)=>x.id === 'dependency-lock-provenance'));

p = parsed(['scripts/deploy-production.mjs', 'tests/checkpoint.test.js', 'tests/auth-session.test.js']);
expect('cross-subsystem change escalates F3', p.recommendedTier === 'F3' && p.broadBoundary === true);

p = parsed(['.github/workflows/deploy-production.yml']);
expect('deployment workflow is not hidden by workflow F0 rule', p.recommendedTier === 'F2' && p.areas.includes('deployment'));

p = parsed(['.github/workflows/certify.yml']);
expect('certification workflow is release-control F3', p.recommendedTier === 'F3' && p.areas.includes('release-gate-control') && p.requiredChecks.some((x)=>x.id === 'mandatory-release-gates-preserved'));

p = parsed(['RELEASE_MANIFEST.json']);
expect('release manifest is release-integrity F3', p.recommendedTier === 'F3' && p.areas.includes('release-manifest') && p.requiredChecks.some((x)=>x.id === 'release-manifest-invariants'));

p = parsed(['.github/workflows/dev-fast.yml']);
expect('ordinary fast-feedback workflow stays F0', p.recommendedTier === 'F0' && p.areas.includes('provenance-tooling'));

p = parsed(['app.js']);
expect('monolithic shared runtime is F3', p.recommendedTier === 'F3' && p.certificationEligible === false);

const unsafe = run(['--json', '../escape.js']);
expect('unsafe changed path fails closed', unsafe.status !== 0 && unsafe.stderr.includes('Unsafe changed path'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v12-fast-plan-'));
const list = path.join(tmp, 'changed.txt');
fs.writeFileSync(list, 'docs/readme.md\ntests/auth-session.test.js\n');
p = parsed(['--files-from', list]);
expect('files-from input works', p.recommendedTier === 'F2' && p.areas.includes('auth-session'));

console.log(`V1.2 fast-gate planner self-test PASS: ${passed}/${total}`);
