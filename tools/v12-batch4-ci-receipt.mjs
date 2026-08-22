#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EXPECTED_LOCK_SHA256 = '1eb32525cf5c4db2e976e44d348724054fe3c789a7ee535b943af16480e3674c';
const EXPECTED_NODE = 'v26.7.0';
const EXPECTED_NPM = '12.0.2';

function fail(message) {
  console.error(`Batch 4 CI receipt refused: ${message}`);
  process.exitCode = 1;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const root = path.resolve(process.argv[2] ?? process.cwd());
const output = path.resolve(process.argv[3] ?? path.join(root, 'evidence', 'V1.2_BATCH4_CI_RECEIPT.json'));

const requiredEnv = ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_REF_NAME', 'GITHUB_WORKFLOW'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    fail(`missing ${key}`);
  }
}
if (process.exitCode) process.exit();

const [manifestRaw, lockBytes, packageRaw] = await Promise.all([
  readFile(path.join(root, 'RELEASE_MANIFEST.json'), 'utf8'),
  readFile(path.join(root, 'package-lock.json')),
  readFile(path.join(root, 'package.json'), 'utf8'),
]);

const manifest = JSON.parse(manifestRaw);
const pkg = JSON.parse(packageRaw);
const lockSha256 = sha256(lockBytes);
const npmVersion = process.env.npm_config_user_agent?.match(/\bnpm\/(\d+\.\d+\.\d+)\b/)?.[1] ?? null;

if (manifest.releaseReady !== false) fail('RELEASE_MANIFEST.json must remain releaseReady:false');
if (pkg.version !== '1.2.0') fail(`expected package version 1.2.0, got ${pkg.version}`);
if (process.version !== EXPECTED_NODE) fail(`expected Node ${EXPECTED_NODE}, got ${process.version}`);
if (npmVersion !== EXPECTED_NPM) fail(`expected npm ${EXPECTED_NPM}, got ${npmVersion ?? 'unknown'}`);
if (lockSha256 !== EXPECTED_LOCK_SHA256) fail(`package-lock SHA-256 mismatch: ${lockSha256}`);
if (process.exitCode) process.exit();

const receipt = {
  schema: 'cosmic-v12-batch4-ci-receipt-1',
  candidate: {
    version: pkg.version,
    releaseReady: false,
    packageLockSha256: lockSha256,
  },
  runtime: {
    node: process.version,
    npm: npmVersion,
  },
  github: {
    workflow: process.env.GITHUB_WORKFLOW,
    runId: Number(process.env.GITHUB_RUN_ID),
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    sha: process.env.GITHUB_SHA,
    refName: process.env.GITHUB_REF_NAME,
  },
  gates: {
    focusedMpegAndNineFormat: 'passed-before-receipt-step',
    dependencyFreeAggregate: 'passed-before-receipt-step',
    exactReviewedDependencyInstall: 'passed-before-receipt-step',
    dependencyPolicyAndAudit: 'passed-before-receipt-step',
    workerVitest: 'passed-before-receipt-step',
    wholeWorkerIntegration: 'passed-before-receipt-step',
    buildInspection: 'passed-before-receipt-step',
    chromiumCheckpointNoSecondDispatch: 'passed-before-receipt-step',
  },
  certification: {
    v12Certified: false,
    fullF4MatrixComplete: false,
    productionV111Touched: false,
    stagingTouched: false,
  },
};

await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(output), { recursive: true }));
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(`Wrote non-certifying Batch 4 CI receipt: ${output}`);
