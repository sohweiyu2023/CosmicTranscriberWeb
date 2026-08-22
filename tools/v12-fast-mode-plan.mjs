#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
function arg(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

const filesArg = arg('--files');
const filesFrom = arg('--files-from');
const jsonOut = arg('--json');
if ((filesArg && filesFrom) || (!filesArg && !filesFrom)) {
  fail('Usage: node tools/v12-fast-mode-plan.mjs (--files <comma-separated-paths> | --files-from <newline-file>) [--json <output.json>]');
}

let raw = '';
if (filesArg) raw = filesArg.split(',').join('\n');
else {
  if (!fs.existsSync(filesFrom) || !fs.statSync(filesFrom).isFile()) fail(`Changed-file list is not a file: ${filesFrom}`);
  raw = fs.readFileSync(filesFrom, 'utf8');
}

const files = [...new Set(raw.split(/\r?\n/).map((x)=>x.trim()).filter(Boolean).map((p)=>p.replaceAll('\\','/')))].sort();
if (!files.length) fail('No changed files were supplied.');
for (const p of files) {
  if (p.startsWith('/') || p.split('/').includes('..')) fail(`Unsafe changed path: ${JSON.stringify(p)}`);
}

const rules = {
  billingCheckpointAuth: [
    /^app\.js$/i,
    /^worker(?:\/|\.|$)/i,
    /^src\/.*(?:billing|checkpoint|transcrib|session|auth|access|key)/i,
    /^tests\/.*(?:billing|checkpoint|transcrib|session|auth|access|key)/i,
  ],
  formats: [
    /^app\.js$/i,
    /(?:^|\/)(?:audio|format|mime|media|upload|parser|probe)(?:\.|\/|$)/i,
    /(?:mp3|wav|m4a|mp4|ogg|flac|webm|aac)/i,
    /^tests\/.*(?:format|mime|audio|upload)/i,
  ],
  deployment: [
    /^wrangler\.toml$/i,
    /^scripts\/.*(?:deploy|configure|rollback|wrangler|migration|d1)/i,
    /^\.github\/workflows\//i,
  ],
  dependencies: [
    /^package\.json$/i,
    /^package-lock\.json$/i,
  ],
  uiBrowser: [
    /^app\.js$/i,
    /^(?:public|static|web|ui)\//i,
    /^src\/.*(?:ui|view|dom|queue|progress|download)/i,
    /(?:\.html|\.css)$/i,
    /^tests\/.*(?:browser|playwright|ui|queue|progress)/i,
  ],
  releaseProvenance: [
    /^RELEASE_MANIFEST\.json$/i,
    /^tools\/v12-/i,
    /^docs\/V1\.2_/i,
    /^\.github\/workflows\/certify\.yml$/i,
  ],
};

function matches(group, p) { return rules[group].some((r)=>r.test(p)); }
const categories = Object.fromEntries(Object.keys(rules).map((k)=>[k, files.filter((p)=>matches(k,p))]));
const active = Object.fromEntries(Object.entries(categories).map(([k,v])=>[k, v.length > 0]));
const docsOnly = files.every((p)=>/^docs\//i.test(p) || /^README(?:\.md)?$/i.test(p));
const releaseToolingOnly = files.every((p)=>/^docs\//i.test(p) || /^README(?:\.md)?$/i.test(p) || /^tools\/v12-/i.test(p) || /^\.github\/workflows\/certify\.yml$/i.test(p) || /^\.github\/workflows\/dev-fast\.yml$/i.test(p));

const gates = [];
function gate(id, why, blocking = true) {
  if (!gates.some((g)=>g.id===id)) gates.push({id, why, blocking});
}

gate('provenance-syntax', 'Always syntax-check changed release/provenance tooling and preserve fail-closed source identity.');
gate('release-ready-false', 'V1.2 development candidate must remain releaseReady:false until full certification.');

if (active.dependencies) {
  gate('dependency-lock-provenance', 'Dependency metadata changed; exact lock provenance must be reviewed.');
  gate('exact-toolchain-npm-ci', 'Dependency changes require clean installation with the reviewed Node/npm toolchain before checkpointing.');
}
if (active.billingCheckpointAuth) {
  gate('billing-checkpoint-targeted', 'Run targeted billing/checkpoint/session/auth functional tests, including no duplicate paid dispatch invariants.');
  gate('billing-static-security', 'Run focused static/security safeguards for paid-dispatch, BYOK/session and checkpoint paths.');
  gate('billing-mutation', 'Run focused mutation tests covering billing/checkpoint decision logic.');
  gate('worker-integration-affected', 'Run affected Worker and whole-Worker integration tests because request dispatch or identity may have changed.');
}
if (active.formats) {
  gate('nine-format-targeted', 'Run all nine-format parser/MIME/signature fixtures, not only the edited format.');
  gate('format-negative-no-dispatch', 'Malformed, mismatched and oversized inputs must fail before any paid upstream dispatch.');
  gate('format-checkpoint-identity', 'Verify non-MP3 format settings do not corrupt checkpoint identity or billing reuse.');
}
if (active.uiBrowser) {
  gate('browser-affected-smoke', 'Run affected browser smoke tests for queue/progress/upload/download behavior.');
}
if (active.deployment) {
  gate('deployment-helper-static', 'Validate deployment/configuration/rollback helper syntax and fail-closed environment targeting.');
  gate('no-production-deploy', 'Fast mode must not deploy V1.2 to production; staging remains gated.');
}
if (active.releaseProvenance) {
  gate('provenance-self-test', 'Run dependency-free V1.2 provenance self-tests after release-engineering changes.');
}
if (!releaseToolingOnly && !docsOnly) {
  gate('coherent-batch-checkpoint', 'Before starting the next feature batch, run the complete locally available functional/static/mutation checkpoint suites.');
}

const escalation = active.billingCheckpointAuth || active.formats || active.dependencies || active.deployment ? 'HIGH' : (active.uiBrowser || active.releaseProvenance ? 'MEDIUM' : 'LOW');
const mode = docsOnly ? 'DOCS_FAST' : releaseToolingOnly ? 'RELEASE_TOOLING_FAST' : 'PRODUCT_FAST';

const report = {
  schemaVersion: 1,
  mode,
  escalation,
  changedFiles: files,
  categories,
  gates,
  fullCertificationDeferred: true,
  releaseRules: {
    productionV111Untouched: true,
    v2NotStarted: true,
    releaseReadyMustRemainFalse: true,
    certifiedZipForbiddenUntilAllReleaseGatesPass: true,
  },
  note: 'Fast development changes test cadence, not release criteria. Full clean certification remains mandatory before releaseReady:true or a certified ZIP.'
};
const text = JSON.stringify(report, null, 2) + '\n';
if (jsonOut) {
  fs.mkdirSync(path.dirname(path.resolve(jsonOut)), {recursive:true});
  fs.writeFileSync(jsonOut, text, 'utf8');
}
process.stdout.write(text);
