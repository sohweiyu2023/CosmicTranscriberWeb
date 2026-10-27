import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {MP3,verifyFixedMp3,reserveBudget} from '../../scripts/staging-single-mp3-smoke.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const fixture=process.env.COSMIC_SMOKE_TEST_FIXTURE;
// Release archives exclude .git. An external local history repository keeps
// fixture-enabled replay available during fresh-archive certification.
const sourceRepository=process.env.COSMIC_SMOKE_TEST_SOURCE_REPO||root;
const needsFixture={skip:!fixture?'Set COSMIC_SMOKE_TEST_FIXTURE to the separately preserved synthetic MP3':false};
// Match Actions: edited diagnostic code runs against a separate clean checkout
// of the exact deployed source. Clone local objects only; no remote fetch/auth.
let sourceCheckout;
if(fixture){
 sourceCheckout=await mkdtemp(path.join(tmpdir(),'cosmic-smoke-source-'));
 const cleanup=async()=>{
  assert.equal(path.dirname(path.resolve(sourceCheckout)),path.resolve(tmpdir()));assert.ok(path.basename(sourceCheckout).startsWith('cosmic-smoke-source-'));
  await rm(sourceCheckout,{recursive:true,force:true});
 };
 try{
  const clone=spawnSync('git',['clone','--local','--no-hardlinks','--quiet',sourceRepository,sourceCheckout],{encoding:'utf8'});assert.equal(clone.status,0,clone.stderr);
  const checkout=spawnSync('git',['checkout','--detach','82392336cfea5bc417098a2c6e3066dafca97b5b'],{cwd:sourceCheckout,encoding:'utf8'});assert.equal(checkout.status,0,checkout.stderr);
 }catch(error){await cleanup();throw error}
 test.after(cleanup);
}
const ledger=()=>({schema:'cosmic-approved-paid-budget-1',maximumRequests:9,maximumMicroUsd:250000,reservedRequests:0,reservedMicroUsd:0});
test('fixed synthetic MP3 pins bytes/hash and single-model/minute reservation',needsFixture,async()=>{
 const bytes=await readFile(fixture);assert.deepEqual(verifyFixedMp3(bytes),MP3);
 const changed=Buffer.from(bytes);changed[100]^=1;assert.throws(()=>verifyFixedMp3(changed));
 assert.throws(()=>verifyFixedMp3(bytes.subarray(1)));
 assert.equal(MP3.model,'gpt-transcribe');assert.equal(MP3.reservationMicroUsd,4500);
});
test('cumulative budget reserves one attempt conservatively and rejects exhausted/invalid ledgers',()=>{
 assert.deepEqual(reserveBudget(ledger()),{...ledger(),reservedRequests:1,reservedMicroUsd:4500});
 for(const change of [{reservedRequests:9},{reservedRequests:-1},{reservedMicroUsd:246000},{maximumRequests:10},{maximumMicroUsd:250001},{reservedMicroUsd:NaN}])assert.throws(()=>reserveBudget({...ledger(),...change}));
});
async function scenario(name,overrides={}){
 const dir=await mkdtemp(path.join(tmpdir(),'cosmic-single-mp3-'));
 const receipt=path.join(dir,'receipt.json'),budget=path.join(dir,'budget.json'),source=path.join(dir,'source.json'),log=path.join(dir,'mock.json');
 await writeFile(budget,JSON.stringify({...ledger(),...overrides.budget}));
 await writeFile(source,JSON.stringify({schema:'cosmic-verified-staging-source-1',origin:'https://transcriber-staging.awakeningtoreality.com',commit:'82392336cfea5bc417098a2c6e3066dafca97b5b',workerVersionId:'11111111-2222-4333-8444-555555555555',verified:true,checkedAtUtc:new Date().toISOString(),...overrides.source}));
 if(overrides.existing)await writeFile(receipt,'prior receipt must survive');
 const env={...process.env,COSMIC_SINGLE_MP3_MODE:'one-approved-staging-diagnostic',STAGING_CF_AUTHORIZATION:'aaa.bbb.ccc',STAGING_OPENAI_API_KEY:'offline-fake-key',COSMIC_SMOKE_SOURCE_ROOT:sourceCheckout,COSMIC_STAGING_SOURCE_RECEIPT:source,COSMIC_MOCK_SCENARIO:name,COSMIC_MOCK_LOG:log,...overrides.env};
 const result=spawnSync(process.execPath,['--import','./tests/node/staging-live-mock-fetch.mjs','./scripts/staging-single-mp3-smoke.mjs',fixture,receipt,budget],{cwd:root,env,encoding:'utf8'});
 return {result,receipt:await readFile(receipt,'utf8'),budget:JSON.parse(await readFile(budget,'utf8')),mock:JSON.parse(await readFile(log,'utf8'))};
}
test('offline successful smoke issues exactly one paid call, cleans BYOK, never certifies release',needsFixture,async()=>{
 const x=await scenario('all-pass');assert.equal(x.result.status,0,x.result.stderr);assert.equal(x.mock.paid,1);
 const r=JSON.parse(x.receipt);assert.equal(r.attempted,1);assert.equal(r.fullAcceptance,false);assert.equal(r.releaseReady,false);assert.equal(r.byokForget,'PASS');
 assert.equal(x.budget.reservedRequests,1);assert.equal(x.budget.reservedMicroUsd,4500);
 assert.equal(x.receipt.includes('offline-fake-key'),false);assert.equal(x.receipt.includes('Mock transcription'),false);
});
test('ambiguous/invalid paid result has no retry and retains reservation',needsFixture,async()=>{
 const x=await scenario('nonwav-empty-transcript');assert.equal(x.result.status,1);assert.equal(x.mock.paid,1);assert.equal(x.budget.reservedRequests,1);assert.equal(JSON.parse(x.receipt).byokForget,'PASS');
});
test('missing staging identity, dedicated billing key, deployed-source receipt or consent yields zero requests',needsFixture,async()=>{
 for(const env of [{STAGING_CF_AUTHORIZATION:''},{STAGING_OPENAI_API_KEY:''},{COSMIC_STAGING_SOURCE_RECEIPT:''},{COSMIC_SINGLE_MP3_MODE:''}]){
  const x=await scenario('all-pass',{env});assert.equal(x.result.status,1);assert.equal(x.mock.calls.length,0);assert.equal(x.mock.paid,0);
 }
});
test('exhausted ledger never dispatches paid call; existing receipt cannot be overwritten',needsFixture,async()=>{
 const x=await scenario('all-pass',{budget:{reservedRequests:9}});assert.equal(x.result.status,1);assert.equal(x.mock.paid,0);
 const previous=await scenario('all-pass',{existing:true});assert.equal(previous.result.status,1);assert.equal(previous.receipt,'prior receipt must survive');assert.equal(previous.mock.calls.length,0);
});

test('wrong/stale deployed source and cleanup failure cannot pass the diagnostic',needsFixture,async()=>{
 for(const source of [{commit:'0'.repeat(40)},{verified:false},{checkedAtUtc:'2000-01-01T00:00:00.000Z'}]){const x=await scenario('all-pass',{source});assert.equal(x.result.status,1);assert.equal(x.mock.calls.length,0)}
 const failed=await scenario('all-pass-no-expiry');assert.equal(failed.result.status,1);assert.equal(failed.mock.paid,1);assert.equal(JSON.parse(failed.receipt).byokForget,'FAIL');
});
