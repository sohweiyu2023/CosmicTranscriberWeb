import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {POLICY,FIXTURES,PRIOR_FILES,requireReviewedDeployment,verifyPriorSmoke,reserveRemaining,verifyFixtures,verifyHistory} from '../../scripts/staging-remaining-eight-policy.mjs';
import {runFixedBatch} from '../../scripts/staging-remaining-eight-runner.mjs';
import {verifyIdentity,verifySource} from '../../scripts/staging-remaining-eight-preflight.mjs';
const fixtureRoot=process.env.COSMIC_EIGHT_FIXTURE_ROOT,priorRoot=process.env.COSMIC_PRIOR_SMOKE_EVIDENCE;
const dataTest={skip:fixtureRoot&&priorRoot?false:'Set the two explicitly documented offline fixture/evidence paths'};
async function filesAt(root){const out=Object.create(null);for(const e of await readdir(root,{withFileTypes:true}))if(e.isFile())out[e.name]=await readFile(path.join(root,e.name));return out;}
async function fixedFiles(){const files={};for(const f of FIXTURES)files[f.name]=await readFile(path.join(fixtureRoot,f.name));return files;}
const ledger=()=>({schema:'cosmic-approved-paid-budget-1',approval:POLICY.approval,maximumRequests:9,maximumMicroUsd:250000,reservedRequests:1,reservedMicroUsd:4500});
test('eight fixed formats exclude MP3 and cumulative reservation cannot reset previous spending',()=>{
 assert.equal(FIXTURES.length,8);assert.equal(new Set(FIXTURES.map(x=>x.format)).size,8);assert.equal(FIXTURES.some(x=>x.format==='mp3'),false);
 assert.equal(FIXTURES.filter(x=>x.model==='gpt-transcribe').length,7);
 assert.equal(FIXTURES.find(x=>x.format==='wav').reservationMicroUsd,180000);
 assert.deepEqual(reserveRemaining(ledger()),{...ledger(),reservedRequests:9,reservedMicroUsd:216000});
 for(const change of [{reservedRequests:0},{reservedRequests:2},{reservedMicroUsd:0},{maximumRequests:10},{maximumMicroUsd:250001},{approval:'other'}])assert.throws(()=>reserveRemaining({...ledger(),...change}));
 assert.throws(()=>requireReviewedDeployment());assert.throws(()=>requireReviewedDeployment({source:'82392336cfea5bc417098a2c6e3066dafca97b5b'}));
});
test('pinned prior receipt and every binary input are verified before spending',dataTest,async()=>{
 const prior=await filesAt(priorRoot);assert.deepEqual(verifyPriorSmoke(prior),ledger());
 const changed={...prior,'receipt.json':Buffer.from(prior['receipt.json'].toString().replace('PASS','FAIL'))};assert.throws(()=>verifyPriorSmoke(changed));
 const files=await fixedFiles();assert.equal(verifyFixtures(files).length,8);
 const extra={...files,'staging-speech.mp3':Buffer.alloc(1)};assert.throws(()=>verifyFixtures(extra));
 const special=Object.assign(Object.create(null),files);special.__proto__=Buffer.alloc(1);assert.throws(()=>verifyFixtures(special));
 const specialPrior=Object.assign(Object.create(null),prior);specialPrior.__proto__=Buffer.alloc(1);assert.throws(()=>verifyPriorSmoke(specialPrior));
 const broken={...files,[FIXTURES[0].name]:Buffer.alloc(FIXTURES[0].bytes)};assert.throws(()=>verifyFixtures(broken));
 assert.equal(Object.keys(PRIOR_FILES).length,4);
});
test('complete history permits only the one known successful smoke and current first remaining run',()=>{
 const smoke=[{id:POLICY.priorRun,event:'workflow_dispatch',run_attempt:1,status:'completed',conclusion:'success'},{id:3,event:'push',run_attempt:1,status:'completed',conclusion:'failure'}];
 const remaining=[{id:77,run_attempt:1}],ci=[{id:4,status:'completed',run_attempt:2}];
 const jobs={3:[],4:[1,2].map(run_attempt=>({name:'Actual authenticated STAGING paid nine-format acceptance',run_attempt,status:'completed',conclusion:'skipped'}))};
 assert.equal(verifyHistory(smoke,remaining,ci,jobs,77),true);
 assert.throws(()=>verifyHistory([...smoke,{id:6,event:'workflow_dispatch',run_attempt:1,status:'completed',conclusion:'failure'}],remaining,ci,jobs,77));
 assert.throws(()=>verifyHistory(smoke,[...remaining,{id:88,event:'workflow_dispatch',run_attempt:1,status:'completed',conclusion:'failure'}],ci,jobs,77));
 assert.throws(()=>verifyHistory(smoke,remaining,[{...ci[0],status:'in_progress'}],jobs,77));
 assert.throws(()=>verifyHistory(smoke,remaining,ci,{...jobs,4:[jobs[4][0]]},77));
 assert.throws(()=>verifyHistory(smoke,remaining,ci,{...jobs,4:jobs[4].map(x=>({...x,conclusion:'success'}))},77));
});
test('identity rejects reruns, wrong repository, branch and authorization',()=>{
 const env={GITHUB_REPOSITORY:POLICY.repo,GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW:'Remaining EIGHT approved STAGING formats ONLY',COSMIC_REMAINING_EIGHT_MODE:'remaining-eight-existing-approval',GITHUB_RUN_ID:'77',FIXTURE_RUN_ID:'88',FIXTURE_ARTIFACT_ID:'99'};
 verifyIdentity(env);for(const bad of [{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/other'},{COSMIC_REMAINING_EIGHT_MODE:'refuse'}])assert.throws(()=>verifyIdentity({...env,...bad}));
});
test('fresh deployment proof requires reviewed CI/licensing, exact source annotation and 100percent version',()=>{
 const pin={source:'a'.repeat(40),head:'b'.repeat(40),version:'11111111-2222-4333-8444-555555555555',run:1,ciRun:2,licensingRun:3,artifact:4};
 const run={id:1,head_sha:pin.head,event:'workflow_dispatch',head_branch:'main',run_attempt:1,status:'completed',conclusion:'success'};
 const jobs=[{name:'deploy',conclusion:'success',steps:['Verify exact successful CI/licensing and certified artifact','Record newly deployed staging version','Recheck authenticated Access protection after deployment'].map(name=>({name,conclusion:'success'}))}];
 const ci={id:2,status:'completed',conclusion:'success',head_sha:pin.source},licensing={...ci,id:3};
 const cf=[{created_on:new Date().toISOString(),versions:[{version_id:pin.version,percentage:100}],annotations:{'workers/message':'Source'+pin.source+' CI2 artifact4'}}];
 assert.equal(verifySource(run,jobs,ci,licensing,cf,pin).verified,true);
 assert.throws(()=>verifySource(run,jobs,{...ci,head_sha:pin.head},licensing,cf,pin));
 assert.throws(()=>verifySource(run,jobs,ci,licensing,[{...cf[0],versions:[{version_id:pin.version,percentage:99}]}],pin));
 assert.throws(()=>verifySource({...run,run_attempt:2},jobs,ci,licensing,cf,pin));
});
test('mocked successful batch sends exactly eight, preserves before-send evidence and never certifies release',dataTest,async()=>{
 const files=await fixedFiles(),report={attempted:0,formats:[],releaseReady:false,fullAcceptance:false};let calls=0,persisted=0;
 await runFixedBatch(files,report,async()=>{persisted=report.attempted;},async(route,method,body,headers)=>{
  calls++;assert.equal(persisted,calls);assert.equal(route,'/api/transcribe');assert.equal(method,'POST');
  const metadata=JSON.parse(Buffer.from(headers['x-cosmic-metadata'],'base64url'));assert.notEqual(metadata.audioFormat,'mp3');assert.equal(metadata.chunkCount,1);assert.equal(metadata.declaredBytes,body.length);
  return {j:{result:{text:'Alpha beta gamma delta epsilon.',segments:[{speaker:'A',text:'Alpha beta.',start:0,end:7},{speaker:'B',text:'Gamma delta.',start:7,end:14}]},diagnostics:{openaiRequestId:'offline-only'}}};
 });
 assert.equal(calls,8);assert.equal(report.formats.filter(x=>x.status==='PASS').length,8);assert.equal(report.releaseReady,false);assert.equal(report.fullAcceptance,false);assert.equal(JSON.stringify(report).includes('Alpha beta'),false);
});
test('ambiguous failure and evidence-write failure stop without retry or later paid sends',dataTest,async()=>{
 for(const failedPersist of [false,true]){const files=await fixedFiles(),report={attempted:0,formats:[]};let calls=0;
  await assert.rejects(()=>runFixedBatch(files,report,async()=>{if(failedPersist&&report.attempted===2)throw Error('offline disk failure');},async()=>{calls++;if(!failedPersist&&calls===2)throw Error('offline ambiguous response');return {j:{result:{text:'Alpha beta gamma.'}}};}));
  assert.equal(calls,failedPersist?1:2);assert.equal(report.attempted,2);
 }
});
test('manual workflow is main-only, context-valid, reserved before paid, shared-lock and no successor',async()=>{
 const y=await readFile(new URL('../../.github/workflows/staging-remaining-eight.yml',import.meta.url),'utf8');
 assert.match(y,/workflow_dispatch:/);assert.doesNotMatch(y,/^  (push|pull_request):/m);assert.match(y,/default: refuse/);assert.match(y,/github.run_attempt == '1'/);
 assert.match(y,/group: cosmic-approved-paid-staging/);assert.match(y,/cancel-in-progress: false/);
 const env=y.split('    env:')[1].split('    steps:')[0];assert.doesNotMatch(env,/runner\./);
 assert.ok(y.indexOf('Persist cumulative reservation')<y.indexOf('At most eight fixed requests'));
 assert.ok(y.includes("run-id: '39979683866'"));assert.ok(y.includes("artifact-ids: '12512662440'"));assert.ok(y.includes('requireReviewedDeployment()'));
 assert.doesNotMatch(y,/contents: write|actions: write|deploy-staging|staging-live-acceptance\.mjs|production-readiness/);
});
