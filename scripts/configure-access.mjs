import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { verifyReleaseProvenance } from './deploy-provenance.mjs';

const root = path.resolve(import.meta.dirname, '..');

export function normalizeAccessTeamDomain(raw) {
  let value = String(raw ?? '').trim();
  if (value && !/^https?:\/\//i.test(value)) value = `https://${value}`;
  let url;
  try { url = new URL(value); } catch { throw new Error('Access team domain must look like https://<team>.cloudflareaccess.com'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.cloudflareaccess.com') || url.hostname === '.cloudflareaccess.com' ||
      url.username || url.password || url.port || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('Access team domain must be exactly https://<team>.cloudflareaccess.com with no path, port, query, or credentials.');
  }
  return `https://${url.hostname.toLowerCase()}`;
}

export function normalizeAccessAudience(raw) {
  const value = String(raw ?? '').trim();
  if (value.length < 8 || value.length > 64 || /[\s\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Access AUD tag must be 8-64 non-whitespace characters. Paste the AUD tag shown by the Access application.');
  }
  return value;
}

export function applyAccessValues(config, envName, teamDomain, audience) {
  if (envName !== 'staging' && envName !== 'production') throw new Error('Environment must be staging or production.');
  const vars = config?.env?.[envName]?.vars;
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) throw new Error(`wrangler.jsonc is missing env.${envName}.vars.`);
  vars.ACCESS_TEAM_DOMAIN = normalizeAccessTeamDomain(teamDomain);
  vars.ACCESS_AUDIENCE = normalizeAccessAudience(audience);
  return config;
}

async function main() {
  const envName = process.argv[2];
  if (envName !== 'staging' && envName !== 'production') {
    console.error('Usage: node scripts/configure-access.mjs <staging|production>');
    process.exit(2);
  }

  const packagePath = path.join(root, 'package.json');
  const wranglerPath = path.join(root, 'wrangler.jsonc');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  const provenanceBefore = await verifyReleaseProvenance(root, { packageVersion: pkg.version, targetEnv: envName });
  if (provenanceBefore.length) {
    console.error(`ACCESS CONFIGURATION BLOCKED:\n- ${provenanceBefore.join('\n- ')}`);
    console.error('Use a staging-certified or final-certified deployment copy, not the audit-candidate source tree.');
    process.exit(1);
  }

  const original = await readFile(wranglerPath, 'utf8');
  const config = JSON.parse(original);
  const rl = createInterface({ input, output });
  try {
    const team = await rl.question(`Paste the ${envName} Access team domain (for example https://yourteam.cloudflareaccess.com): `);
    const aud = await rl.question(`Paste the ${envName} Access application AUD tag: `);
    applyAccessValues(config, envName, team, aud);
  } finally {
    rl.close();
  }

  const updated = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(wranglerPath, updated, 'utf8');
  try {
    const provenanceAfter = await verifyReleaseProvenance(root, { packageVersion: pkg.version, targetEnv: envName });
    if (provenanceAfter.length) throw new Error(`Release provenance failed after Access edit:\n- ${provenanceAfter.join('\n- ')}`);
  } catch (error) {
    await writeFile(wranglerPath, original, 'utf8');
    throw error;
  }

  console.log(`${envName} Access team domain and AUD were saved. Release provenance remains valid.`);
  console.log(`Next: npm run configure:registry:${envName}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => { console.error(error?.message || error); process.exit(1); });
}
