import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');

test('Workers Vitest config uses current package-root API and preserves D1 test setup',async()=>{
  const text=await readFile(path.join(root,'vitest.config.js'),'utf8');
  assert.match(text,/from ['"]@cloudflare\/vitest-plugin['"]/);
  assert.doesNotMatch(text,/@cloudflare\/vitest-plugin\/config/);
  assert.match(text,/\bcloudflareTest\s*\(/);
  assert.match(text,/\breadD1Migrations\b/);
  assert.match(text,/from ['"]vitest\/config['"]/);
  assert.match(text,/tests\/worker\/wrangler\.test\.jsonc/);
  assert.match(text,/BYOK_SESSION_MASTER_KEY_CURRENT:TEST_BYOK_MASTER_KEY/);
  assert.match(text,/TEST_MIGRATIONS:await readD1Migrations/);
  assert.match(text,/setupFiles\s*:/);
  const setup=await readFile(path.resolve(root,'./tests/worker/apply-migrations.js'),'utf8');
  assert.match(setup,/applyD1Migrations/);
  assert.match(setup,/USER_DB/);
  assert.match(setup,/TEST_MIGRATIONS/);
});

test('byte-sensitive audited generated sources are canonical UTF-8 LF on every platform',async()=>{
  for(const rel of ['public/js/app.js','scripts/first-deploy.mjs']){
    const bytes=await readFile(path.join(root,rel));
    assert.equal(bytes.includes(13),false,`${rel} contains a carriage return`);
  }
  const app=await readFile(path.join(root,'public/js/app.js'),'utf8');
  assert.ok(app.includes('import {checkpointResultReusable} from "./retry-policy.js"; // CTW_CHECKPOINT_REUSE_BINDING\n// CTW_RESTORED_PROMPT_BOUND'));
  const first=await readFile(path.join(root,'scripts/first-deploy.mjs'),'utf8');
  assert.ok(first.includes('try {\n  await writeFile(secretsFile'));
  assert.ok(first.includes('finally {\n  await rm(tempDir'));
});
