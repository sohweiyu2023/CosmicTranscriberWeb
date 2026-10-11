import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAccessValues, normalizeAccessAudience, normalizeAccessTeamDomain } from '../../scripts/configure-access.mjs';

test('Access team domain normalization accepts canonical Cloudflare team domains', () => {
  assert.equal(normalizeAccessTeamDomain('citeledger.cloudflareaccess.com'), 'https://citeledger.cloudflareaccess.com');
  assert.equal(normalizeAccessTeamDomain(' HTTPS://CITELEDGER.CLOUDFLAREACCESS.COM/ '), 'https://citeledger.cloudflareaccess.com');
});

test('Access team domain normalization rejects paths, ports, credentials and non-Cloudflare hosts', () => {
  for (const value of [
    'http://citeledger.cloudflareaccess.com',
    'https://citeledger.cloudflareaccess.com/path',
    'https://citeledger.cloudflareaccess.com:8443',
    'https://user:pass@citeledger.cloudflareaccess.com',
    'https://example.com'
  ]) assert.throws(() => normalizeAccessTeamDomain(value));
});

test('Access AUD normalization is bounded and rejects whitespace/control characters', () => {
  assert.equal(normalizeAccessAudience(' abcDEF_123-xyz '), 'abcDEF_123-xyz');
  assert.throws(() => normalizeAccessAudience('short'));
  assert.throws(() => normalizeAccessAudience('abc defgh'));
});

test('Access configuration changes only the selected environment Access fields', () => {
  const config = {
    env: {
      staging: { vars: { ACCESS_TEAM_DOMAIN: 'old', ACCESS_AUDIENCE: 'old-aud', OTHER: 'keep' } },
      production: { vars: { ACCESS_TEAM_DOMAIN: 'prod', ACCESS_AUDIENCE: 'prod-aud', OTHER: 'keep-prod' } }
    }
  };
  const beforeProd = structuredClone(config.env.production);
  applyAccessValues(config, 'staging', 'citeledger.cloudflareaccess.com', 'staging_audience_123');
  assert.equal(config.env.staging.vars.ACCESS_TEAM_DOMAIN, 'https://citeledger.cloudflareaccess.com');
  assert.equal(config.env.staging.vars.ACCESS_AUDIENCE, 'staging_audience_123');
  assert.equal(config.env.staging.vars.OTHER, 'keep');
  assert.deepEqual(config.env.production, beforeProd);
});
