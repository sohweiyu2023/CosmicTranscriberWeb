import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyAccessValues, normalizeAccessAudience } from '../../scripts/configure-access.mjs';
import { applyRegistryValues } from '../../scripts/configure-registry.mjs';
import { validateDeploymentConfig } from '../../scripts/deploy-verify.mjs';

test('certified placeholder config supports Access -> registry -> final verification sequencing', async () => {
  const config = JSON.parse(await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
  applyAccessValues(config, 'staging', 'https://citeledger.cloudflareaccess.com', 'a'.repeat(64));
  const afterAccess = validateDeploymentConfig(config, 'staging', { packageVersion: '1.2.0' });
  assert.ok(afterAccess.some(x => /placeholder deployment configuration remains/.test(x)));
  assert.ok(afterAccess.some(x => /ADMIN_EMAILS/.test(x)));
  assert.ok(afterAccess.some(x => /USER_DB database_id/.test(x)));
  applyRegistryValues(config, 'staging', '11111111-1111-4111-8111-111111111111', 'admin@example.test');
  assert.deepEqual(validateDeploymentConfig(config, 'staging', { packageVersion: '1.2.0' }), []);
});

test('Access AUD respects Cloudflare documented maximum length', () => {
  assert.equal(normalizeAccessAudience('a'.repeat(64)), 'a'.repeat(64));
  assert.throws(() => normalizeAccessAudience('a'.repeat(65)));
});

test('partial configuration helpers do not invoke the final deployment validator', async () => {
  const access = await readFile(new URL('../../scripts/configure-access.mjs', import.meta.url), 'utf8');
  const registry = await readFile(new URL('../../scripts/configure-registry.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(access, /validateDeploymentConfig/);
  assert.doesNotMatch(registry, /validateDeploymentConfig/);
  assert.match(access, /Next: npm run configure:registry:\$\{envName\}/);
  assert.match(registry, /Next: node scripts\/deploy-verify\.mjs \$\{target\}/);
});
