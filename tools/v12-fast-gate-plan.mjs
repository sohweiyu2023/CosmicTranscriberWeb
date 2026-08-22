#!/usr/bin/env node

const args = process.argv.slice(2);
const files = args.filter((x) => !x.startsWith('--'));
const json = args.includes('--json');

if (!files.length) {
  console.error('Usage: node tools/v12-fast-gate-plan.mjs [--json] <changed-path>...');
  process.exit(2);
}

const RULES = [
  { tier: 'F2', area: 'billing', re: /(?:billing|paid|dispatch|retry|ambiguous|charge)/i },
  { tier: 'F2', area: 'auth-session', re: /(?:auth|access|session|byok|key|crypto|encrypt|secret)/i },
  { tier: 'F2', area: 'checkpoint', re: /(?:checkpoint|resume|cancel)/i },
  { tier: 'F2', area: 'format-dispatch', re: /(?:format|mime|multipart|transcrib|upload|audio|worker)/i },
  { tier: 'F2', area: 'deployment', re: /(?:deploy|wrangler|rollback|configure|migration|d1)/i },
  { tier: 'F3', area: 'dependency', re: /(?:^|\/)(?:package-lock\.json|package\.json)$/i },
  { tier: 'F3', area: 'shared-runtime', re: /^(?:app\.js|src\/|worker\/)/i },
  { tier: 'F1', area: 'tests-runtime', re: /^(?:tests\/|test\/)/i },
  { tier: 'F0', area: 'provenance-tooling', re: /^(?:tools\/v12-|docs\/V1\.2_|\.github\/workflows\/)/i },
  { tier: 'F0', area: 'docs', re: /\.(?:md|txt)$/i }
];

const rank = { F0: 0, F1: 1, F2: 2, F3: 3, F4: 4 };
let tier = 'F0';
const areas = new Set();
const classified = [];

for (const raw of files) {
  const path = raw.replaceAll('\\', '/');
  let hit = null;
  for (const rule of RULES) {
    if (rule.re.test(path)) {
      hit = rule;
      break;
    }
  }
  if (!hit) hit = { tier: 'F1', area: 'uncategorized-runtime-or-tooling' };
  if (rank[hit.tier] > rank[tier]) tier = hit.tier;
  areas.add(hit.area);
  classified.push({ path, tier: hit.tier, area: hit.area });
}

const broadBoundary = areas.size >= 3;
if (broadBoundary && rank[tier] < rank.F3) tier = 'F3';

const guidance = {
  F0: ['syntax/parser checks for touched executable tooling', 'focused provenance/tool self-tests'],
  F1: ['focused deterministic tests for the touched subsystem'],
  F2: ['focused subsystem tests', 'relevant static/security safeguards', 'relevant mutation checks', 'Worker/integration checks when runtime is available'],
  F3: ['all dependency-free functional/static/mutation validation', 'all available relevant Worker/integration/browser checks', 'whole-tree provenance review before candidate handoff'],
  F4: ['complete mandatory certification and staging-acceptance matrix']
};

const result = {
  schemaVersion: 1,
  mode: 'V1.2_FAST_DEVELOPMENT',
  recommendedTier: tier,
  broadBoundary,
  areas: [...areas].sort(),
  changedFiles: classified,
  checks: guidance[tier],
  invariants: [
    'production V1.1.1 untouched',
    'V1.2 releaseReady:false until full certification',
    'no lower tier substitutes for F4 release certification',
    'never weaken billing/security/provenance/release gates for speed'
  ]
};

if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`Fast-mode recommended tier: ${tier}`);
  console.log(`Areas: ${result.areas.join(', ')}`);
  if (broadBoundary) console.log('Escalation: cross-subsystem change detected.');
  console.log('Checks:');
  for (const check of result.checks) console.log(` - ${check}`);
}
