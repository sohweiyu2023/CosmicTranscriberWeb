import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '');
if (!root || !fs.existsSync(root)) throw new Error('candidate root argument is required');

const expectedRejects = new Map([
  ['scripts/audit-lib.mjs.rej', 3],
  ['scripts/configure-registry.mjs.rej', 2],
  ['scripts/mutation-suite.mjs.rej', 3],
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.rej')) out.push(full);
  }
  return out;
}

const rejectFiles = walk(root).map(p => path.relative(root, p).replaceAll('\\', '/')).sort();
const expectedFiles = [...expectedRejects.keys()].sort();
if (JSON.stringify(rejectFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(`unexpected staging-boundary rejects: ${JSON.stringify(rejectFiles)}`);
}
for (const rel of rejectFiles) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const hunks = (text.match(/^@@ /gm) || []).length;
  if (hunks !== expectedRejects.get(rel)) throw new Error(`${rel}: expected ${expectedRejects.get(rel)} rejected hunks, got ${hunks}`);
}

function replaceOnce(rel, from, to) {
  const file = path.join(root, rel);
  const text = fs.readFileSync(file, 'utf8');
  const first = text.indexOf(from);
  if (first < 0) throw new Error(`${rel}: reviewed conflict source not found: ${from}`);
  if (text.indexOf(from, first + from.length) >= 0) throw new Error(`${rel}: reviewed conflict source is not unique: ${from}`);
  fs.writeFileSync(file, text.slice(0, first) + to + text.slice(first + from.length), 'utf8');
}

replaceOnce(
  'scripts/configure-registry.mjs',
  'const beforeErrors=await verifyReleaseProvenance(root,{packageVersion:pkg.version});',
  'const beforeErrors=await verifyReleaseProvenance(root,{packageVersion:pkg.version,targetEnv:target});',
);
replaceOnce(
  'scripts/configure-registry.mjs',
  'const afterErrors=await verifyReleaseProvenance(root,{packageVersion:pkg.version});',
  'const afterErrors=await verifyReleaseProvenance(root,{packageVersion:pkg.version,targetEnv:target});',
);

replaceOnce(
  'scripts/mutation-suite.mjs',
  String.raw`["allow deployment from non-release-certified audit candidate", "scripts/deploy-provenance.mjs", /manifest\.releaseReady!==true/g, "false"]`,
  String.raw`["allow production deployment from non-final candidate", "scripts/deploy-provenance.mjs", /const finalCertified=manifest\.releaseReady===true&&manifest\.certificationLevel==='release';/g, "const finalCertified=true;"]`,
);
replaceOnce(
  'scripts/mutation-suite.mjs',
  String.raw`/const provenanceErrors=await verifyReleaseProvenance\(root,\{packageVersion:pkg\.version\}\);/g`,
  String.raw`/const provenanceErrors=await verifyReleaseProvenance\(root,\{packageVersion:pkg\.version,targetEnv:envName\}\);/g`,
);
replaceOnce(
  'scripts/mutation-suite.mjs',
  String.raw`/const provenanceBefore = await verifyReleaseProvenance\(root, \{ packageVersion: pkg\.version \}\);/g`,
  String.raw`/const provenanceBefore = await verifyReleaseProvenance\(root, \{ packageVersion: pkg\.version, targetEnv: envName \}\);/g`,
);
replaceOnce(
  'scripts/mutation-suite.mjs',
  String.raw`/const beforeErrors=await verifyReleaseProvenance\(root,\{packageVersion:pkg\.version\}\);/g`,
  String.raw`/const beforeErrors=await verifyReleaseProvenance\(root,\{packageVersion:pkg\.version,targetEnv:target\}\);/g`,
);

replaceOnce(
  'scripts/audit-lib.mjs',
  String.raw`/releaseReady!==true/.test(s("scripts/deploy-provenance.mjs"))`,
  String.raw`/const stagingCertified=targetEnv==='staging'&&manifest\.releaseReady===false&&manifest\.certificationLevel==='staging'/.test(s("scripts/deploy-provenance.mjs")) && /const finalCertified=manifest\.releaseReady===true&&manifest\.certificationLevel==='release'/.test(s("scripts/deploy-provenance.mjs"))`,
);
replaceOnce(
  'scripts/audit-lib.mjs',
  String.raw`/npm run package:source/.test(s("RELEASE-WINDOWS.ps1"))`,
  String.raw`/package-source\.mjs --staging-candidate/.test(s("RELEASE-WINDOWS.ps1"))`,
);
replaceOnce(
  'scripts/audit-lib.mjs',
  String.raw`/const beforeErrors=await verifyReleaseProvenance\(root,\{packageVersion:pkg\.version\}\);/.test(s("scripts/configure-registry.mjs"))`,
  String.raw`/const beforeErrors=await verifyReleaseProvenance\(root,\{packageVersion:pkg\.version,targetEnv:target\}\);/.test(s("scripts/configure-registry.mjs"))`,
);

for (const rel of rejectFiles) fs.unlinkSync(path.join(root, rel));
if (walk(root).length) throw new Error('unexpected reject file remained after reviewed conflict resolution');
console.log('Resolved exactly 8 reviewed staging-boundary patch conflicts; no unexpected rejects remain.');
