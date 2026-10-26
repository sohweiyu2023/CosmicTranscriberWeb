import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {FINAL_MP3,FINAL_MP3_ZERO,FINAL_MP3_HELD,verifyHeldFinalFiles,verifyHeldFinalAttempt,verifyFinalZeroAttempt,finalFixtureArtifactDiagnostic,verifyFinalFixtureArtifact,verifyCompletedEight,verifyEightFiles,reserveFinalMp3,verifyFinalReservation,verifyFinalHistory} from '../../scripts/staging-final-mp3-policy.mjs';
import {verifyFinalIdentity,verifyCoordinatorGates,finalPreflightFailure} from '../../scripts/staging-final-mp3-preflight.mjs';
import {verifyFinalRunnerIdentity,stagingRedirectCategory} from '../../scripts/staging-single-mp3-smoke.mjs';
const bundle=JSON.parse(await readFile(new URL('../fixtures/historical-ci/final-mp3-lineage.json',import.meta.url),'utf8'));
const zero=JSON.parse(await readFile(new URL('../fixtures/historical-ci/final-mp3-zero-attempt.json',import.meta.url),'utf8'));
const heldFinal=JSON.parse(await readFile(new URL('../fixtures/historical-ci/held-final-mp3.json',import.meta.url),'utf8'));
const heldProof=()=>verifyHeldFinalFiles(heldFinal.files);
const clone=x=>structuredClone(x),eight=bundle.completedEight,current='90000000001';
const proof=()=>verifyCompletedEight(eight.run,eight.jobs,eight.artifacts,eight.files);
const env={GITHUB_REPOSITORY:'sohweiyu2023/CosmicTranscriberWeb',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW:'One approved STAGING MP3 smoke ONLY',COSMIC_SMOKE_AUTHORIZATION:FINAL_MP3.authorization,GITHUB_RUN_ID:current,GITHUB_SHA:'a'.repeat(40),FIXTURE_RUN_ID:String(FINAL_MP3.fixtureRun),FIXTURE_ARTIFACT_ID:String(FINAL_MP3.fixtureArtifact)};
test('immutable nine-request lineage allows only separately approved tenth reservation',()=>{
 const x=reserveFinalMp3(bundle.priorSmokeFiles,proof(),current,heldProof());
 assert.equal(x.budget.reservedRequests,10);assert.equal(x.budget.reservedMicroUsd,220500);assert.equal(x.reservation.priorPaidRequests,9);assert.equal(x.reservation.additionalApprovedRequests,1);assert.equal(x.reservation.additionalReservationMicroUsd,0);assert.equal(x.reservation.continuation.additionalReservationMicroUsd,0);assert.equal(x.reservation.continuation.unusedSlots,1);assert.equal(x.reservation.oneShot,true);
 assert.deepEqual(verifyFinalReservation(x.budget,x.reservation,current,bundle.priorSmokeFiles,proof(),heldProof()),x);
 assert.equal(JSON.parse(bundle.priorSmokeFiles['budget.json']).reservedRequests,1);
 assert.equal(JSON.parse(eight.files['budget.json']).reservedRequests,9);
});
test('completed eight proof rejects wrong run, source, branch, event, attempt and terminal result',()=>{
 for(const change of [{id:1},{head_sha:'0'.repeat(40)},{head_branch:'other'},{event:'push'},{run_attempt:2},{status:'in_progress'},{conclusion:'failure'}])assert.throws(()=>verifyCompletedEight({...eight.run,...change},eight.jobs,eight.artifacts,eight.files));
 for(const change of [{id:1},{run_id:1},{run_attempt:2},{name:'other'},{status:'queued'},{conclusion:'failure'}])assert.throws(()=>verifyCompletedEight(eight.run,[{...eight.jobs[0],...change}],eight.artifacts,eight.files));
 assert.throws(()=>verifyCompletedEight(eight.run,[],eight.artifacts,eight.files));assert.throws(()=>verifyCompletedEight(eight.run,[...eight.jobs,...eight.jobs],eight.artifacts,eight.files));
 for(const step of eight.jobs[0].steps.filter(s=>s.name.startsWith('Reconcile')||s.name.startsWith('At most'))){const j=clone(eight.jobs);j[0].steps.find(s=>s.name===step.name).conclusion='skipped';assert.throws(()=>verifyCompletedEight(eight.run,j,eight.artifacts,eight.files));}
});
test('all evidence and metadata hashes are exact, without trusting a success label alone',()=>{
 for(const name of Object.keys(eight.files))assert.throws(()=>verifyEightFiles({...eight.files,[name]:eight.files[name]+' '}));
 assert.throws(()=>verifyEightFiles({...eight.files,'extra.json':'{}'}));
 for(const change of [{id:1},{name:'other'},{digest:'sha256:'+'0'.repeat(64)},{expired:true},{size_in_bytes:1},{workflow_run:{id:1,head_sha:FINAL_MP3.head}}]){const a=clone(eight.artifacts);Object.assign(a[0],change);assert.throws(()=>verifyCompletedEight(eight.run,eight.jobs,a,eight.files));}
 assert.throws(()=>verifyCompletedEight(eight.run,eight.jobs,eight.artifacts.slice(1),eight.files));
});
test('reset, expanded cap, mutated lineage, reused identity and double reservation all reject',()=>{
 const x=reserveFinalMp3(bundle.priorSmokeFiles,proof(),current,heldProof());
 for(const change of [{reservedRequests:9},{maximumRequests:11},{reservedMicroUsd:216000},{maximumMicroUsd:2000000},{approval:'other'}])assert.throws(()=>verifyFinalReservation({...x.budget,...change},x.reservation,current,bundle.priorSmokeFiles,proof(),heldProof()));
 for(const change of [{runId:'1'},{priorPaidRequests:8},{additionalApprovedRequests:2},{additionalReservationMicroUsd:9000},{oneShot:false},{lineage:{...proof(),paidRequests:8}}])assert.throws(()=>verifyFinalReservation(x.budget,{...x.reservation,...change},current,bundle.priorSmokeFiles,proof(),heldProof()));
 for(const id of ['0','-1','abc',39979683866,40200059681,40161696792,40113556242,FINAL_MP3_ZERO.run,FINAL_MP3_HELD.run])assert.throws(()=>reserveFinalMp3(bundle.priorSmokeFiles,proof(),id,heldProof()));
 assert.throws(()=>reserveFinalMp3({...bundle.priorSmokeFiles,'budget.json':'{}'},proof(),current,heldProof()));
 assert.throws(()=>reserveFinalMp3(bundle.priorSmokeFiles,{...proof(),paidRequests:8},current,heldProof()));
});
test('final workflow and runner identities reject refusal, reruns, wrong repository/branch/fixture',()=>{
 verifyFinalIdentity(env);verifyFinalRunnerIdentity(env);
 for(const change of [{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/other'},{GITHUB_EVENT_NAME:'push'},{GITHUB_RUN_ATTEMPT:'2'},{COSMIC_SMOKE_AUTHORIZATION:'refuse'},{GITHUB_RUN_ID:'0'},{GITHUB_SHA:'a'},{GITHUB_WORKFLOW:'other'}]){assert.throws(()=>verifyFinalIdentity({...env,...change}));assert.throws(()=>verifyFinalRunnerIdentity({...env,...change}));}
 for(const change of [{FIXTURE_RUN_ID:'1'},{FIXTURE_ARTIFACT_ID:'1'}])assert.throws(()=>verifyFinalIdentity({...env,...change}));
});
test('coordinator main must have actual successful exact-head CI and licensing',()=>{
 const runs=['ci.yml','licensing.yml'].map(path=>({path:'.github/workflows/'+path,head_sha:env.GITHUB_SHA,head_branch:'main',event:'push',status:'completed',conclusion:'success'}));verifyCoordinatorGates(runs,env.GITHUB_SHA);
 for(const change of [{head_sha:'b'.repeat(40)},{head_branch:'other'},{event:'pull_request'},{status:'in_progress'},{conclusion:'failure'}])assert.throws(()=>verifyCoordinatorGates([{...runs[0],...change},runs[1]],env.GITHUB_SHA));assert.throws(()=>verifyCoordinatorGates(runs.slice(1),env.GITHUB_SHA));
});
test('complete history admits one final run and rejects duplicate, partial and active paid history',()=>{
 const old={id:39979683866,event:'workflow_dispatch',run_attempt:1,status:'completed',conclusion:'success'};
 const now={id:Number(current),event:'workflow_dispatch',head_branch:'main',run_attempt:1,path:'.github/workflows/staging-single-mp3-smoke.yml'};
 const held=bundle.heldZero;const remaining=[held.run,eight.run],jobs={[held.run.id]:held.jobs,[eight.run.id]:eight.jobs,[zero.run.id]:zero.jobs,[heldFinal.run.id]:heldFinal.jobs};const heldProof={artifacts:held.artifacts,files:held.files};
 const verify=(s=[old,zero.run,heldFinal.run,now],r=remaining,c=[],j=jobs)=>verifyFinalHistory(s,r,c,j,current,{},heldProof,{},proof(),zero,heldFinal);
 assert.equal(verify(),true);assert.throws(()=>verify([old,zero.run,now]));assert.throws(()=>verify([old,zero.run,heldFinal.run,heldFinal.run,now]));assert.throws(()=>verify([old,now]));assert.throws(()=>verify([old,zero.run,zero.run,heldFinal.run,now]));
 assert.throws(()=>verify([old,zero.run,heldFinal.run,now,{...now,id:90000000002}]));assert.throws(()=>verify([zero.run,heldFinal.run,now]));assert.throws(()=>verify([old,zero.run,heldFinal.run,{...now,run_attempt:2}]));assert.throws(()=>verify([old,zero.run,heldFinal.run,now],[...remaining,{...eight.run,id:90000000003}]));assert.throws(()=>verify([old,zero.run,heldFinal.run,now],[eight.run]));
 assert.throws(()=>verify([old,zero.run,heldFinal.run,now],remaining,[{id:4,status:'in_progress',run_attempt:1}],{...jobs,4:[]}));
 for(const conclusion of ['success','failure','cancelled'])assert.throws(()=>verify([old,zero.run,heldFinal.run,now],remaining,[{id:4,status:'completed',run_attempt:1}],{...jobs,4:[{name:'Actual authenticated STAGING paid nine-format acceptance',run_attempt:1,status:'completed',conclusion}]}));
});

test('real artifact capture rejects the original mistyped pin and all changed identity/hash metadata',()=>{
 assert.equal(zero.verifiedArchive.sha256,'c291ab8175af70d488643ffad5f0f4c5dbaa138a168191ddd52f3cb6adb2f6a7');
 assert.equal(FINAL_MP3.fixtureDigest,zero.verifiedArchive.sha256);assert.equal(verifyFinalFixtureArtifact([zero.artifact]),true);
 for(const change of [{id:1},{name:'other'},{digest:'sha256:c291ab8175af70d488643ffad5f0c4c5dbaa138a168191ddd52f3cb6adb2f6a7'},{expired:true},{size_in_bytes:1},{workflow_run:{id:1,head_sha:zero.artifact.workflow_run.head_sha}},{workflow_run:{...zero.artifact.workflow_run,head_sha:'0'.repeat(40)}}])assert.throws(()=>verifyFinalFixtureArtifact([{...zero.artifact,...change}]));
 assert.throws(()=>verifyFinalFixtureArtifact([]));assert.throws(()=>verifyFinalFixtureArtifact([zero.artifact,zero.artifact]));
});

test('artifact failure diagnostics are bounded, public-identity-only and distinguish pre-reservation zero execution',()=>{
 const secret='DO-NOT-LOG-PRIVATE-CONTENT';
 const candidate={...zero.artifact,name:secret,digest:secret,workflow_run:{...zero.artifact.workflow_run,head_sha:secret}};
 const diagnostic=finalFixtureArtifactDiagnostic(Array(100).fill(candidate));assert.equal(diagnostic.actual.length,2);assert.equal(diagnostic.candidateCount,100);assert.equal(JSON.stringify(diagnostic).includes(secret),false);assert.equal(diagnostic.actual[0].digest,null);assert.equal(diagnostic.actual[0].head,null);assert.equal(diagnostic.actual[0].nameMatches,false);
 let error;try{verifyFinalFixtureArtifact([{...zero.artifact,digest:'sha256:'+'0'.repeat(64)}])}catch(e){error=e}
 const report=finalPreflightFailure('fixed-fixture-artifact',error,'not-written');assert.equal(report.code,'final_fixture_artifact_mismatch');assert.equal(report.artifact.expected.digest,zero.artifact.digest);assert.equal(report.artifact.actual[0].digest,'sha256:'+'0'.repeat(64));assert.equal(report.paidRequests,0);assert.equal(report.reservationState,'not-written');assert.equal(report.byokState,'not-started');assert.equal(report.cleanup,'not-required');
 for(const state of ['budget-write-started','budget-written','reservation-write-started','reservation-written','lineage-write-started','complete'])assert.equal(finalPreflightFailure('fixed-fixture-artifact',error,state).reservationState,state);
 const unrelated=finalPreflightFailure('fixed-fixture-artifact',{message:secret,code:'final_fixture_artifact_mismatch',artifactDiagnostic:{secret}},'existing-not-modified');assert.equal(JSON.stringify(unrelated).includes(secret),false);assert.equal(unrelated.code,'final_preflight_rejected');assert.equal(unrelated.reservationState,'existing-not-modified');assert.equal('artifact' in unrelated,false);
});

test('only exact immutable zero-execution graph is reconciled; changed or started evidence rejects',()=>{
 assert.equal(verifyFinalZeroAttempt(zero.run,zero.jobs,zero),true);
 for(const change of [{id:1},{head_sha:'0'.repeat(40)},{head_branch:'other'},{event:'push'},{path:'other'},{run_attempt:2},{status:'queued'},{conclusion:'success'}])assert.throws(()=>verifyFinalZeroAttempt({...zero.run,...change},zero.jobs,zero));
 for(const change of [{id:1},{run_id:1},{run_attempt:2},{name:'other'},{status:'in_progress'},{conclusion:'cancelled'}])assert.throws(()=>verifyFinalZeroAttempt(zero.run,[{...zero.jobs[0],...change}],zero));
 assert.throws(()=>verifyFinalZeroAttempt(zero.run,[],zero));assert.throws(()=>verifyFinalZeroAttempt(zero.run,[...zero.jobs,...zero.jobs],zero));
 for(let i=0;i<zero.jobs[0].steps.length;i++){for(const field of ['name','number','status','conclusion']){const j=clone(zero.jobs);j[0].steps[i][field]=field==='number'?999:'changed';assert.throws(()=>verifyFinalZeroAttempt(zero.run,j,zero));}}
 const removed=clone(zero.jobs);removed[0].steps.pop();assert.throws(()=>verifyFinalZeroAttempt(zero.run,removed,zero));
 for(const name of Object.keys(zero.workflowBlobs))assert.throws(()=>verifyFinalZeroAttempt(zero.run,zero.jobs,{...zero,workflowBlobs:{...zero.workflowBlobs,[name]:'0'.repeat(40)}}));
 assert.throws(()=>verifyFinalZeroAttempt(zero.run,zero.jobs,{...zero,artifacts:[{id:1}]}));assert.throws(()=>verifyFinalZeroAttempt(zero.run,zero.jobs,{}));
 const started=clone(zero.jobs);started[0].steps.find(s=>s.name.startsWith('One fixed MP3')).conclusion='success';assert.throws(()=>verifyFinalZeroAttempt(zero.run,started,zero));
});


test('redirect diagnostics expose only fixed categories, never location/token/query contents',()=>{
 const privateText='DO-NOT-LOG-TOKEN';
 assert.equal(stagingRedirectCategory('https://team.cloudflareaccess.com/cdn-cgi/access/login?token='+privateText),'access-login');assert.equal(stagingRedirectCategory('/cdn-cgi/access/login?token='+privateText),'access-login');assert.equal(stagingRedirectCategory('/other?token='+privateText),'same-origin');assert.equal(stagingRedirectCategory('https://other.example/?token='+privateText),'external-other');assert.equal(stagingRedirectCategory('https://team.cloudflareaccess.com.evil.example/'),'external-other');assert.equal(stagingRedirectCategory(null),'missing');assert.equal(stagingRedirectCategory('x'.repeat(4097)),'invalid');
});

test('held tenth-slot proof binds exact run, step graph, immutable artifacts/code and five zero-provider files',()=>{
 assert.deepEqual(verifyHeldFinalAttempt(heldFinal.run,heldFinal.jobs,heldFinal),heldProof());
 for(const change of [{id:1},{head_sha:'0'.repeat(40)},{head_branch:'other'},{event:'push'},{path:'other'},{run_attempt:2},{status:'in_progress'},{conclusion:'success'}])assert.throws(()=>verifyHeldFinalAttempt({...heldFinal.run,...change},heldFinal.jobs,heldFinal));
 for(const change of [{id:1},{run_id:1},{run_attempt:2},{name:'other'},{status:'queued'},{conclusion:'cancelled'}])assert.throws(()=>verifyHeldFinalAttempt(heldFinal.run,[{...heldFinal.jobs[0],...change}],heldFinal));
 assert.throws(()=>verifyHeldFinalAttempt(heldFinal.run,[],heldFinal));assert.throws(()=>verifyHeldFinalAttempt(heldFinal.run,[...heldFinal.jobs,...heldFinal.jobs],heldFinal));
 for(let i=0;i<heldFinal.jobs[0].steps.length;i++){for(const field of ['name','number','status','conclusion']){const j=clone(heldFinal.jobs);j[0].steps[i][field]=field==='number'?999:'changed';assert.throws(()=>verifyHeldFinalAttempt(heldFinal.run,j,heldFinal));}}
 for(const key of Object.keys(heldFinal.files))assert.throws(()=>verifyHeldFinalFiles({...heldFinal.files,[key]:heldFinal.files[key]+' '}));
 for(const change of [{attempted:1},{attemptId:'paid-attempt'},{byokForget:'FAIL'},{status:'PASS'},{failure:{phase:'paid-mp3',code:'unknown'}}]){const files=clone(heldFinal.files);files['receipt.json']=JSON.stringify({...JSON.parse(files['receipt.json']),...change});assert.throws(()=>verifyHeldFinalFiles(files));}
 assert.throws(()=>verifyHeldFinalFiles({...heldFinal.files,'extra.json':'{}'}));
 for(const change of [{id:1},{name:'other'},{digest:'sha256:'+'0'.repeat(64)},{expired:true},{size_in_bytes:1},{workflow_run:{id:1,head_sha:heldFinal.run.head_sha}}]){const e=clone(heldFinal);Object.assign(e.artifacts[0],change);assert.throws(()=>verifyHeldFinalAttempt(heldFinal.run,heldFinal.jobs,e));}
 assert.throws(()=>verifyHeldFinalAttempt(heldFinal.run,heldFinal.jobs,{...heldFinal,artifacts:heldFinal.artifacts.slice(1)}));
 for(const name of Object.keys(heldFinal.workflowBlobs))assert.throws(()=>verifyHeldFinalAttempt(heldFinal.run,heldFinal.jobs,{...heldFinal,workflowBlobs:{...heldFinal.workflowBlobs,[name]:'0'.repeat(40)}}));
});
test('held continuation preserves the full reservation and cannot reset or add an eleventh slot',()=>{
 const before=JSON.stringify(heldFinal.files),x=reserveFinalMp3(bundle.priorSmokeFiles,proof(),current,heldProof());
 assert.deepEqual(x.budget,JSON.parse(heldFinal.files['budget.json']));assert.equal(x.reservation.additionalReservationMicroUsd,0);assert.equal(x.reservation.continuation.heldRun,40336352549);assert.equal(x.reservation.continuation.unusedSlots,1);assert.equal(JSON.stringify(heldFinal.files),before);
 assert.throws(()=>reserveFinalMp3(bundle.priorSmokeFiles,proof(),current));
 for(const change of [{heldRun:1},{paidRequests:1},{reservedRequests:9},{reservedMicroUsd:225000},{unusedSlots:2}])assert.throws(()=>reserveFinalMp3(bundle.priorSmokeFiles,proof(),current,{...heldProof(),...change}));
 for(const change of [{additionalReservationMicroUsd:4500},{heldRun:1},{continuationRunId:'other'},{unusedSlots:2},{oneShot:false}])assert.throws(()=>verifyFinalReservation(x.budget,{...x.reservation,continuation:{...x.reservation.continuation,...change}},current,bundle.priorSmokeFiles,proof(),heldProof()));
});

test('workflow keeps one request, shared serialization, proof downloads and no deploy successor',async()=>{
 const y=await readFile(new URL('../../.github/workflows/staging-single-mp3-smoke.yml',import.meta.url),'utf8');
 for(const text of ['options: [refuse, one-mp3-same-source-tenth]','github.run_attempt == \'1\'','cancel-in-progress: false','group: cosmic-approved-paid-staging','artifact-ids: 12601587812','artifact-ids: 12656454065','artifact-ids: 12586114319','artifact-ids: 12512662440','ref: '+FINAL_MP3.source,'COSMIC_SINGLE_MP3_MODE: '+FINAL_MP3.mode,'staging-final-mp3-preflight.mjs prepare','staging-final-mp3-preflight.mjs source'])assert.ok(y.includes(text),text);
 assert.equal((y.match(/STAGING_OPENAI_API_KEY:/g)||[]).length,1);for(const text of ['workflow_run:','deploy:production','--retry','one-mp3-with-existing-staging-secrets'])assert.equal(y.includes(text),false);
 const runner=await readFile(new URL('../../scripts/staging-single-mp3-smoke.mjs',import.meta.url),'utf8');assert.equal((runner.match(/api\('\/api\/transcribe'/g)||[]).length,1);assert.ok(runner.indexOf("open(ledgerPath+'.lock','wx')")<runner.indexOf("api('/api/transcribe'"));assert.ok(runner.includes('if(!finalMode)await writeFile(ledgerPath'));
});
// Real clean source checkout, immutable synthetic file and fake HTTP transport.
// This is offline evidence only: the synthetic run ID never admits a live call.
const sourceCheckout=process.env.COSMIC_FINAL_MP3_TEST_SOURCE;
const runtimeTest={skip:sourceCheckout?false:'Set COSMIC_FINAL_MP3_TEST_SOURCE to the isolated clean deployed-source checkout'};
const root=fileURLToPath(new URL('../../',import.meta.url));
async function scenario(name,change={}){
 const directory=await mkdtemp(path.join(tmpdir(),'cosmic-final-mp3-'));
 try{
  for(const [folder,files] of [['prior-mp3',bundle.priorSmokeFiles],['completed-eight',eight.files],['held-final-mp3',heldFinal.files]]){await mkdir(path.join(directory,folder));for(const [name,text] of Object.entries(files))await writeFile(path.join(directory,folder,name),text);}
  if(change.heldReceipt)await writeFile(path.join(directory,'held-final-mp3','receipt.json'),JSON.stringify({...JSON.parse(heldFinal.files['receipt.json']),...change.heldReceipt}));
  const planned=reserveFinalMp3(bundle.priorSmokeFiles,proof(),current,heldProof());
  const budget=path.join(directory,'budget.json'),reservation=path.join(directory,'reservation.json'),receipt=path.join(directory,'receipt.json'),source=path.join(directory,'source.json'),log=path.join(directory,'mock.json');
  await writeFile(budget,JSON.stringify({...planned.budget,...change.budget}));await writeFile(reservation,JSON.stringify(planned.reservation));
  await writeFile(source,JSON.stringify({schema:'cosmic-verified-staging-source-1',origin:'https://transcriber-staging.awakeningtoreality.com',commit:FINAL_MP3.source,workerVersionId:'e1c94498-bfb2-4cbd-8488-e75cdec32877',verified:true,checkedAtUtc:new Date().toISOString(),...change.source}));
  if(change.existing)await writeFile(receipt,'existing receipt must survive');
  const childEnv={...process.env,...env,RUNNER_TEMP:directory,COSMIC_SINGLE_MP3_MODE:FINAL_MP3.mode,COSMIC_SMOKE_SOURCE_ROOT:sourceCheckout,COSMIC_STAGING_SOURCE_RECEIPT:source,STAGING_CF_AUTHORIZATION:'aaa.bbb.ccc',STAGING_OPENAI_API_KEY:'offline-fake-key',COSMIC_MOCK_SCENARIO:name,COSMIC_MOCK_LOG:log,...change.env};
  const result=spawnSync(process.execPath,['--import','./tests/node/staging-live-mock-fetch.mjs','./scripts/staging-single-mp3-smoke.mjs','./tests/fixtures/approved-single-mp3/staging-speech.mp3',receipt,budget],{cwd:root,env:childEnv,encoding:'utf8',timeout:15000});
  return {result,receipt:await readFile(receipt,'utf8'),budget:JSON.parse(await readFile(budget,'utf8')),mock:JSON.parse(await readFile(log,'utf8'))};
 }finally{assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('cosmic-final-mp3-'));await rm(directory,{recursive:true,force:true});}
}

test('offline prepare CLI reuses the held ledger and rejects altered receipt/history/fixture before writing',async()=>{
 for(const mode of ['all-pass','paid-receipt','extra-manual','wrong-fixture']){
  const directory=await mkdtemp(path.join(tmpdir(),'cosmic-held-prepare-'));
  try{
   for(const [folder,files]of [['prior-mp3',bundle.priorSmokeFiles],['prior-eight-zero',bundle.heldZero.files],['completed-eight',eight.files],['held-final-mp3',heldFinal.files]]){await mkdir(path.join(directory,folder));for(const [name,text]of Object.entries(files))await writeFile(path.join(directory,folder,name),text);}
   if(mode==='paid-receipt')await writeFile(path.join(directory,'held-final-mp3','receipt.json'),JSON.stringify({...JSON.parse(heldFinal.files['receipt.json']),attempted:1}));
   const output=path.join(directory,'output');
   const child=spawnSync(process.execPath,['--import','./tests/node/final-mp3-preflight-mock.mjs','./scripts/staging-final-mp3-preflight.mjs','prepare'],{cwd:root,env:{...process.env,...env,RUNNER_TEMP:directory,COSMIC_SMOKE_EVIDENCE:output,GH_TOKEN:'offline-fake-token',COSMIC_PREFLIGHT_MOCK_MODE:mode},encoding:'utf8',timeout:10000});
   if(mode==='all-pass'){assert.equal(child.status,0,child.stdout+child.stderr);assert.deepEqual(JSON.parse(await readFile(path.join(output,'budget.json'),'utf8')),JSON.parse(heldFinal.files['budget.json']));assert.equal(JSON.parse(await readFile(path.join(output,'reservation.json'),'utf8')).continuation.additionalReservationMicroUsd,0);}
   else{assert.equal(child.status,1,child.stdout+child.stderr);await assert.rejects(access(path.join(output,'reservation.json')));assert.ok(child.stdout.includes('"paidRequests":0'));assert.equal(child.stdout.includes('offline-fake-token'),false);}
  }finally{assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('cosmic-held-prepare-'));await rm(directory,{recursive:true,force:true});}
 }
});

test('offline final runner sends exactly one mock request, retains cumulative budget and clears BYOK',runtimeTest,async()=>{
 const x=await scenario('all-pass');assert.equal(x.result.status,0,x.result.stderr);assert.equal(x.mock.paid,1);const receipt=JSON.parse(x.receipt);assert.equal(receipt.baseCommit,FINAL_MP3.source);assert.equal(receipt.approval,FINAL_MP3.approval);assert.equal(receipt.attempted,1);assert.equal(receipt.byokForget,'PASS');assert.equal(receipt.fullAcceptance,false);assert.equal(receipt.releaseReady,false);assert.equal(x.budget.reservedRequests,10);assert.equal(x.budget.reservedMicroUsd,220500);assert.equal(x.receipt.includes('offline-fake-key'),false);
});
test('offline final runner rejects stale identity/source/reset ledger before HTTP and preserves existing receipt',runtimeTest,async()=>{
 for(const change of [{heldReceipt:{attempted:1}},{budget:{reservedRequests:9}},{source:{commit:'0'.repeat(40)}},{source:{workerVersionId:'11111111-2222-4333-8444-555555555555'}},{source:{checkedAtUtc:'2000-01-01T00:00:00Z'}},{env:{GITHUB_RUN_ATTEMPT:'2'}},{env:{STAGING_OPENAI_API_KEY:''}}]){const x=await scenario('all-pass',change);assert.equal(x.result.status,1);assert.equal(x.mock.paid,0);assert.equal(x.mock.calls.length,0);}
 const existing=await scenario('all-pass',{existing:true});assert.equal(existing.result.status,1);assert.equal(existing.receipt,'existing receipt must survive');assert.equal(existing.mock.calls.length,0);
});
test('offline final runner never retries ambiguous paid responses or falsely passes failed cleanup',runtimeTest,async()=>{
 for(const name of ['nonwav-empty-transcript','all-pass-no-expiry']){const x=await scenario(name);assert.equal(x.result.status,1);assert.equal(x.mock.paid,1);assert.equal(x.budget.reservedRequests,10);assert.equal(x.budget.reservedMicroUsd,220500);}
 const redirect=await scenario('redirect');assert.equal(redirect.result.status,1);assert.equal(redirect.mock.paid,0);assert.equal(redirect.mock.redirectCancelled,true);assert.equal(JSON.parse(redirect.receipt).phase,'access-status');assert.equal(JSON.parse(redirect.receipt).failure.httpStatus,302);assert.equal(redirect.budget.reservedRequests,10);
});
