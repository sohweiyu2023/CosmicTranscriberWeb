#!/usr/bin/env node
import fs from 'node:fs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const filesFromIndex = args.indexOf('--files-from');
let filesFrom = null;
if (filesFromIndex >= 0) {
  filesFrom = args[filesFromIndex + 1];
  if (!filesFrom || filesFrom.startsWith('--')) {
    console.error('Usage: node tools/v12-fast-gate-plan.mjs [--json] [--files-from <newline-file>] <changed-path>...');
    process.exit(2);
  }
}

const positional = args.filter((x, i) => {
  if (x === '--json' || x === '--files-from') return false;
  if (filesFromIndex >= 0 && i === filesFromIndex + 1) return false;
  return !x.startsWith('--');
});

let files = [...positional];
if (filesFrom) {
  if (!fs.existsSync(filesFrom) || !fs.statSync(filesFrom).isFile()) {
    console.error(`Changed-file list is not a regular file: ${filesFrom}`);
    process.exit(2);
  }
  files.push(...fs.readFileSync(filesFrom, 'utf8').split(/\r?\n/));
}
files = [...new Set(files.map((x) => x.trim()).filter(Boolean).map((x) => x.replaceAll('\\', '/')))].sort();

if (!files.length) {
  console.error('Usage: node tools/v12-fast-gate-plan.mjs [--json] [--files-from <newline-file>] <changed-path>...');
  process.exit(2);
}
for (const p of files) {
  if (p.startsWith('/') || p.split('/').includes('..')) {
    console.error(`Unsafe changed path: ${JSON.stringify(p)}`);
    process.exit(2);
  }
}

const RULES = [
  { tier: 'F2', area: 'billing', re: /(?:billing|paid|dispatch|retry|ambiguous|charge)/i },
  { tier: 'F2', area: 'auth-session', re: /(?:auth|access|session|byok|key|crypto|encrypt|secret)/i },
  { tier: 'F2', area: 'checkpoint', re: /(?:checkpoint|resume|cancel)/i },
  { tier: 'F2', area: 'format-dispatch', re: /(?:format|mime|multipart|transcrib|upload|audio|worker|mp3|wav|m4a|mp4|ogg|flac|webm|aac)/i },
  { tier: 'F2', area: 'deployment', re: /(?:deploy|wrangler|rollback|configure|migration|d1)/i },
  { tier: 'F3', area: 'dependency', re: /(?:^|\/)(?:package-lock\.json|package\.json)$/i },
  { tier: 'F3', area: 'shared-runtime', re: /^(?:app\.js|src\/|worker\/)/i },
  { tier: 'F1', area: 'tests-runtime', re: /^(?:tests\/|test\/)/i },
  { tier: 'F1', area: 'browser-ui', re: /(?:playwright|browser|queue|progress|download|\.html$|\.css$)/i },
  { tier: 'F0', area: 'provenance-tooling', re: /^(?:tools\/v12-|docs\/V1\.2_|\.github\/workflows\/)/i },
  { tier: 'F0', area: 'docs', re: /\.(?:md|txt)$/i }
];

const rank = { F0: 0, F1: 1, F2: 2, F3: 3, F4: 4 };
let tier = 'F0';
const areas = new Set();
const classified = [];

for (const changedPath of files) {
  const hits = RULES.filter((rule) => rule.re.test(changedPath));
  if (!hits.length) hits.push({ tier: 'F1', area: 'uncategorized-runtime-or-tooling' });
  let fileTier = 'F0';
  const fileAreas = [];
  for (const hit of hits) {
    if (rank[hit.tier] > rank[fileTier]) fileTier = hit.tier;
    if (rank[hit.tier] > rank[tier]) tier = hit.tier;
    areas.add(hit.area);
    fileAreas.push(hit.area);
  }
  classified.push({ path: changedPath, tier: fileTier, areas: [...new Set(fileAreas)].sort() });
}

const boundaryAreas = [...areas].filter((area) => !['tests-runtime','browser-ui','provenance-tooling','docs'].includes(area));
const broadBoundary = boundaryAreas.length >= 3;
if (broadBoundary && rank[tier] < rank.F3) tier = 'F3';

const checks = [];
function add(id, reason) {
  if (!checks.some((x) => x.id === id)) checks.push({ id, reason });
}
add('changed-file-review', 'Review the exact changed paths before continuing.');
add('release-ready-false', 'Preserve V1.2 releaseReady:false; fast-mode PASS is never release certification.');

if (areas.has('provenance-tooling')) add('provenance-self-tests', 'Syntax-check and execute dependency-free V1.2 provenance/fast-mode tooling self-tests.');
if (areas.has('billing') || areas.has('checkpoint')) {
  add('billing-checkpoint-targeted', 'Run targeted paid-dispatch/checkpoint/retry tests, including exact checkpoint reuse and no unnecessary second paid transcription.');
  add('billing-static-security', 'Run relevant billing/checkpoint static-security safeguards.');
  add('billing-mutation', 'Run focused mutation checks over billing/checkpoint decision logic.');
}
if (areas.has('auth-session')) {
  add('byok-session-targeted', 'Run BYOK/session/auth/key lifecycle tests, including forget/expiry/encryption boundaries.');
  add('auth-static-security', 'Run relevant authentication/session/secret-handling safeguards.');
}
if (areas.has('format-dispatch')) {
  add('nine-format-targeted', 'Run all nine-format MIME/extension/signature/parser fixtures rather than only the edited format.');
  add('format-negative-no-dispatch', 'Malformed, MIME-mismatched, unsupported and oversized inputs must fail before paid upstream dispatch.');
  add('format-checkpoint-identity', 'Verify format-specific and MP3-only settings cannot corrupt checkpoint identity/reuse for non-MP3 input.');
}
if (areas.has('deployment')) {
  add('deployment-helper-validation', 'Validate deployment/configuration/rollback helpers and fail-closed environment targeting.');
  add('production-block', 'Do not deploy V1.2 to production in fast mode.');
}
if (areas.has('dependency')) {
  add('dependency-lock-provenance', 'Review package-lock provenance; never bless a dependency refresh implicitly.');
  add('exact-toolchain-clean-install', 'Run clean npm ci under the reviewed Node/npm toolchain before checkpointing the dependency change.');
}
if (areas.has('browser-ui')) add('browser-affected-smoke', 'Run affected browser smoke coverage for user-critical flows.');
if (rank[tier] >= rank.F3) {
  add('coherent-batch-functional', 'Run all locally available functional validation for the coherent batch and record exact counts.');
  add('coherent-batch-static-mutation', 'Run all locally available static/security and mutation validation for the coherent batch and record exact counts.');
  add('available-worker-integration-browser', 'Run all available relevant Worker/integration/browser checks before handing off the coherent batch.');
}

const guidance = {
  F0: 'Syntax/provenance smoke only.',
  F1: 'Focused deterministic subsystem loop.',
  F2: 'Critical-path targeted regression with security/mutation escalation.',
  F3: 'Cross-subsystem coherent-batch checkpoint.',
  F4: 'Full release-candidate certification; never inferred automatically by this planner.'
};

const result = {
  schemaVersion: 2,
  mode: 'V1.2_FAST_DEVELOPMENT',
  recommendedTier: tier,
  guidance: guidance[tier],
  broadBoundary,
  areas: [...areas].sort(),
  changedFiles: classified,
  requiredChecks: checks,
  certificationEligible: false,
  fullCertificationDeferred: true,
  invariants: [
    'production V1.1.1 untouched',
    'do not begin V2 while V1.2 is unfinished',
    'V1.2 releaseReady:false until full certification',
    'no lower tier substitutes for F4 release certification',
    'never weaken billing/security/provenance/release gates for speed',
    'never fabricate execution evidence or convert NOT RUN into PASS'
  ]
};

if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`Fast-mode recommended tier: ${tier}`);
  console.log(`Areas: ${result.areas.join(', ')}`);
  if (broadBoundary) console.log('Escalation: cross-subsystem change detected.');
  console.log('Required checks:');
  for (const check of result.requiredChecks) console.log(` - ${check.id}: ${check.reason}`);
  console.log('Release certification: NOT GRANTED by fast mode.');
}
