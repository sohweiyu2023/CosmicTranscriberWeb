import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyRegistryValues,normalizeAdminEmails,parseD1ListOutput} from '../../scripts/configure-registry.mjs';

test('registry admin emails are normalized, bounded and unique',()=>{
  assert.equal(normalizeAdminEmails(' Admin@Example.COM , second@example.com '),'admin@example.com,second@example.com');
  assert.throws(()=>normalizeAdminEmails('bad'));
  assert.throws(()=>normalizeAdminEmails('a@example.com,A@example.com'));
});

test('D1 list parser accepts clean or prefixed JSON arrays and rejects malformed output',()=>{
  const rows=[{name:'cosmic-transcriber-web-staging-users',uuid:'11111111-1111-4111-8111-111111111111'}];
  assert.deepEqual(parseD1ListOutput(JSON.stringify(rows)),rows);
  assert.deepEqual(parseD1ListOutput(`notice\n${JSON.stringify(rows)}`),rows);
  assert.throws(()=>parseD1ListOutput('not-json'));
});

test('registry configuration changes only selected environment private registry fields',()=>{
  const config={env:{staging:{vars:{ADMIN_EMAILS:'old',KEEP:'x'},d1_databases:[{binding:'USER_DB',database_name:'cosmic-transcriber-web-staging-users',database_id:'old',migrations_dir:'migrations'}]},production:{vars:{ADMIN_EMAILS:'prod',KEEP:'y'},d1_databases:[{binding:'USER_DB',database_name:'cosmic-transcriber-web-production-users',database_id:'prod',migrations_dir:'migrations'}]}}};
  const before=structuredClone(config.env.production);
  applyRegistryValues(config,'staging','11111111-1111-4111-8111-111111111111','ADMIN@example.com');
  assert.equal(config.env.staging.vars.ADMIN_EMAILS,'admin@example.com');
  assert.equal(config.env.staging.d1_databases[0].database_id,'11111111-1111-4111-8111-111111111111');
  assert.equal(config.env.staging.vars.KEEP,'x');
  assert.deepEqual(config.env.production,before);
});

test('registry creation explicitly disables Wrangler config auto-mutation', async () => {
  const source = await readFile(new URL('../../scripts/configure-registry.mjs', import.meta.url), 'utf8');
  assert.match(source, /d1','create',databaseName,'--update-config=false','--experimental-auto-create=false','--experimental-provision=false'/);
});
