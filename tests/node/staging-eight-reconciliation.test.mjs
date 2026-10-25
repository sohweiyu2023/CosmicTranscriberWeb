import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {POLICY,RESERVED_ZERO_ATTEMPT,verifyReservedZeroAttempt,reconcileHeldEight,verifyHeldContinuation,verifyHistory} from '../../scripts/staging-remaining-eight-policy.mjs';
// Exact public redacted artifact12586114319; no identity, credential or audio.
const recordedFiles={"budget.json": "{\"schema\":\"cosmic-approved-paid-budget-1\",\"approval\":\"Sentinel_c2c095975b008191b6e4af85864f70eb\",\"maximumRequests\":9,\"maximumMicroUsd\":250000,\"reservedRequests\":9,\"reservedMicroUsd\":216000}\n", "receipt.json": "{\n  \"schema\": \"cosmic-staging-remaining-eight-1\",\n  \"formats\": [],\n  \"baseCommit\": \"88ee4a683c8c277885f0737db53226e658390fae\",\n  \"status\": \"FAIL\",\n  \"phase\": \"access-status\",\n  \"attempted\": 0,\n  \"releaseReady\": false,\n  \"fullAcceptance\": false,\n  \"genuineMacSafariValidated\": false,\n  \"startedAt\": \"2026-10-25T04:24:28.990Z\",\n  \"runnerSha256\": \"1be2fdbedd4d4e75bec04a750fb2c3abdbf1511b312c68f4c4011cedd7ab5afc\",\n  \"pricing\": {\n    \"currency\": \"USD\",\n    \"gptMinuteMicroUsd\": 4500,\n    \"diarizationContextTokens\": 16000,\n    \"diarizationOutputTokens\": 2000,\n    \"conservativeBothTokenRateUsdPerMillion\": 10,\n    \"diarizationReservationMicroUsd\": 180000,\n    \"cumulativeReservationMicroUsd\": 216000,\n    \"invoiceVerified\": false\n  },\n  \"deployedSource\": {\n    \"commit\": \"88ee4a683c8c277885f0737db53226e658390fae\",\n    \"workerVersionId\": \"e1c94498-bfb2-4cbd-8488-e75cdec32877\"\n  },\n  \"failure\": {\n    \"phase\": \"access-status\",\n    \"code\": \"access_redirect\"\n  },\n  \"finishedAt\": \"2026-10-25T04:24:29.162Z\"\n}\n", "reservation.json": "{\"schema\":\"cosmic-approved-paid-budget-1\",\"approval\":\"Sentinel_c2c095975b008191b6e4af85864f70eb\",\"maximumRequests\":9,\"maximumMicroUsd\":250000,\"reservedRequests\":9,\"reservedMicroUsd\":216000,\"runId\":\"40161696792\",\"remainingRequests\":0,\"priorSmokeRun\":39979683866,\"fullAcceptance\":false,\"releaseReady\":false}\n", "source.json": "{\"schema\":\"cosmic-verified-staging-source-1\",\"origin\":\"https://transcriber-staging.awakeningtoreality.com\",\"commit\":\"88ee4a683c8c277885f0737db53226e658390fae\",\"workerVersionId\":\"e1c94498-bfb2-4cbd-8488-e75cdec32877\",\"deploymentRun\":40063452013,\"verified\":true,\"checkedAtUtc\":\"2026-10-25T04:24:28.927Z\",\"releaseReady\":false}\n"};
const original=()=>structuredClone(recordedFiles);
const ledger=()=>({schema:'cosmic-approved-paid-budget-1',approval:POLICY.approval,maximumRequests:9,maximumMicroUsd:250000,reservedRequests:1,reservedMicroUsd:4500});
function evidence(){
 const p=RESERVED_ZERO_ATTEMPT;
 const run={id:p.id,head_sha:p.head,head_branch:'main',path:'.github/workflows/'+POLICY.workflow,event:'workflow_dispatch',run_attempt:1,status:'completed',conclusion:'failure'};
 const names=['Refuse until reviewed deployment pins replace the intentionally empty draft','Read only the pinned successful MP3 evidence','Account every previous attempt and reserve the final eight slots','Persist cumulative reservation before any paid request','Download only the reviewed synthetic eight-format artifact','Fresh exact-source staging proof using existing read access','Preserve only redacted evidence with no release or production successor'];
 const steps=names.map(name=>({name,status:'completed',conclusion:'success'}));steps.push({name:'At most eight fixed requests, stop on first failure, never retry',status:'completed',conclusion:'failure'});
 const jobs=[{id:p.job,run_id:p.id,run_attempt:1,name:'remaining',status:'completed',conclusion:'failure',steps}];
 const artifacts=[[p.evidenceArtifact,'remaining-eight-redacted-evidence',p.evidenceDigest,1608],[p.reservationArtifact,'remaining-eight-approved-reservation',p.reservationDigest,356]].map(([id,name,digest,size_in_bytes])=>({id,name,digest:'sha256:'+digest,size_in_bytes,expired:false,workflow_run:{id:p.id,head_sha:p.head}}));
 return {run,jobs,artifacts,files:original()};
}
const verify=p=>verifyReservedZeroAttempt(p.run,p.jobs,p.artifacts,p.files);
test('exact reviewed zero-attempt artifact reconciles the existing hold, adding zero slots or dollars',()=>{
 const proof=verify(evidence());assert.equal(proof.paidAttempts,0);
 const result=reconcileHeldEight(ledger(),proof,'90000000001');
 assert.equal(result.budget.reservedRequests,9);assert.equal(result.budget.reservedMicroUsd,216000);
 assert.equal(result.reservation.continuation.unusedSlots,8);assert.equal(result.reservation.continuation.additionalReservationMicroUsd,0);
 assert.equal(verifyHeldContinuation(result.budget,result.reservation,'90000000001').sourceRunId,RESERVED_ZERO_ATTEMPT.id);
 assert.deepEqual(ledger().reservedRequests,1);
});
test('rerun, partial job history, wrong source and changed artifact identity cannot reconcile',()=>{
 const mutations=[p=>p.run.id++,p=>p.run.head_sha='a'.repeat(40),p=>p.run.head_branch='other',p=>p.run.run_attempt=2,p=>p.run.event='push',p=>p.run.status='in_progress',p=>p.jobs=[],p=>p.jobs.push(p.jobs[0]),p=>p.jobs[0].id++,p=>p.jobs[0].run_attempt=2,p=>p.jobs[0].steps.pop(),p=>p.jobs[0].steps[2].conclusion='failure',p=>p.jobs[0].steps[3].conclusion='skipped',p=>p.jobs[0].steps[7].conclusion='success',p=>p.artifacts.pop(),p=>p.artifacts.push(p.artifacts[0]),p=>p.artifacts[0].id++,p=>p.artifacts[0].digest='sha256:'+'0'.repeat(64),p=>p.artifacts[1].expired=true,p=>p.artifacts[0].workflow_run.head_sha='a'.repeat(40)];
 for(const mutate of mutations){const p=evidence();mutate(p);assert.throws(()=>verify(p),e=>e.code==='history_reserved_zero_invalid');}
});
test('all four exact receipt bytes are required; attempted, BYOK, phase or ledger mutations reject',()=>{
 for(const name of Object.keys(recordedFiles)){
  const missing=evidence();delete missing.files[name];assert.throws(()=>verify(missing));
  const changed=evidence();changed.files[name]+=' ';assert.throws(()=>verify(changed));
 }
 for(const mutate of [r=>r.attempted=1,r=>r.formats=[{format:'flac',status:'ATTEMPTED'}],r=>r.phase='paid-flac',r=>r.failure.code='TimeoutError',r=>r.byokForget='PASS',r=>r.access='PASS',r=>r.releaseReady=true,r=>r.runnerSha256='0'.repeat(64)]){
  const p=evidence(),r=JSON.parse(p.files['receipt.json']);mutate(r);p.files['receipt.json']=JSON.stringify(r,null,2)+'\n';assert.throws(()=>verify(p));
 }
 const p=evidence();p.files.extra='unreviewed';assert.throws(()=>verify(p));
});
test('continuation is bound to a new run and cannot reset, add requests, erase lineage or lower reservation',()=>{
 const proof=verify(evidence());
 for(const run of [RESERVED_ZERO_ATTEMPT.id,40113556242,POLICY.priorRun,0,'invalid'])assert.throws(()=>reconcileHeldEight(ledger(),proof,run));
 for(const change of [{reservedRequests:0},{reservedRequests:9},{reservedMicroUsd:0},{maximumRequests:10},{maximumMicroUsd:2000000}])assert.throws(()=>reconcileHeldEight({...ledger(),...change},proof,'90000000001'));
 const good=reconcileHeldEight(ledger(),proof,'90000000001');
 const mutations=[r=>r.budget.reservedRequests=1,r=>r.budget.reservedMicroUsd=4500,r=>delete r.reservation.continuation,r=>r.reservation.continuation.sourceRunId++,r=>r.reservation.continuation.continuationRunId='90000000002',r=>r.reservation.continuation.unusedSlots=9,r=>r.reservation.continuation.additionalReservationMicroUsd=1,r=>r.reservation.continuation.oneShot=false];
 for(const mutate of mutations){const r=structuredClone(good);mutate(r);assert.throws(()=>verifyHeldContinuation(r.budget,r.reservation,'90000000001'));}
 assert.throws(()=>verifyHeldContinuation(good.budget,good.reservation,'90000000002'));
});
test('full history permits one continuation, then rejects a second manual admission or missing prior proof',()=>{
 const p=evidence(),smoke=[{id:POLICY.priorRun,event:'workflow_dispatch',run_attempt:1,status:'completed',conclusion:'success'}],current={id:90000000001,run_attempt:1},lists={[p.run.id]:p.jobs};
 const held={artifacts:p.artifacts,files:p.files};
 assert.equal(verifyHistory(smoke,[p.run,current],[],lists,current.id,{},held),true);
 assert.throws(()=>verifyHistory(smoke,[p.run,current],[],lists,current.id),e=>e.code==='history_reserved_zero_invalid');
 assert.throws(()=>verifyHistory(smoke,[current],[],lists,current.id,{},held));
 assert.throws(()=>verifyHistory(smoke,[p.run,p.run,current],[],lists,current.id,{},held));
 const second={id:90000000002,run_attempt:1};
 for(const conclusion of ['success','failure'])assert.throws(()=>verifyHistory(smoke,[p.run,{...current,event:'workflow_dispatch',status:'completed',conclusion},second],[],lists,second.id,{},held));
});
test('workflow pins prior evidence; unchanged reservation and runner proof precede Access/BYOK/provider calls',async()=>{
 const y=await readFile(new URL('../../.github/workflows/staging-remaining-eight.yml',import.meta.url),'utf8');
 assert.match(y,/artifact-ids: '12586114319'/);assert.match(y,/run-id: '40161696792'/);assert.match(y,/group: cosmic-approved-paid-staging/);assert.match(y,/cancel-in-progress: false/);
 assert.ok(y.indexOf('Read only exact zero-attempt evidence')<y.indexOf('Reconcile complete history'));
 assert.ok(y.indexOf('Persist cumulative reservation')<y.indexOf('At most eight fixed requests'));
 const runner=await readFile(new URL('../../scripts/staging-remaining-eight-runner.mjs',import.meta.url),'utf8');
 assert.ok(runner.indexOf('verifyHeldContinuation(continuedBudget')<runner.indexOf("report.phase='access-status'"));
 assert.ok(runner.indexOf('verifyHeldContinuation(continuedBudget')<runner.indexOf("report.phase='byok-create'"));
 const preflight=await readFile(new URL('../../scripts/staging-remaining-eight-preflight.mjs',import.meta.url),'utf8');
 assert.ok(preflight.includes('reconcileHeldEight(verifyPriorSmoke(files),heldProof,env.GITHUB_RUN_ID)'));assert.equal(preflight.includes('reserveRemaining('),false);
});
