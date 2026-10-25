// Bounded remaining-eight acceptance policy; no provider calls in this module.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CANCELLED_CI_PIN,verifyExactNeverStartedCancelledCi} from './staging-cancelled-ci-proof.mjs';
import {shortPcmWavSeconds} from '../src/short-wav.js';
export const POLICY=Object.freeze({repo:'sohweiyu2023/CosmicTranscriberWeb',origin:'https://transcriber-staging.awakeningtoreality.com',worker:'cosmic-transcriber-web-staging',workflow:'staging-remaining-eight.yml',approval:'Sentinel_c2c095975b008191b6e4af85864f70eb',priorRun:39979683866,priorArtifact:12512662440,maximumRequests:9,maximumMicroUsd:250000});
// Old-source automatic chunking is ineligible for this bounded eight-request plan.
// Local pins come from verified deployment evidence; runtime must revalidate actual current state.
export const APPROVED_DEPLOYMENT=Object.freeze({"source":"88ee4a683c8c277885f0737db53226e658390fae","version":"e1c94498-bfb2-4cbd-8488-e75cdec32877","run":40063452013,"head":"728b42283b4252f2a125e4c4b5bf56c22989e3ae","ciRun":40056803923,"licensingRun":40056803922,"artifact":12546575744});
export const FIXTURES=Object.freeze([{"format":"flac","model":"gpt-transcribe","bytes":196069,"sha256":"510e61c3296b67cab2fc5caaf6a1a849e3c84a14a3d8e1313c9ec8403e653901","dispatchDurationSeconds":12.0,"name":"staging-speech.flac","mime":"audio/flac","reservationMicroUsd":4500},{"format":"mp4","model":"gpt-transcribe","bytes":100621,"sha256":"a3bc3ef3c33926b8ab626ee01dcd6626070e9d1d9f1c48a736a69704b55a8276","dispatchDurationSeconds":12.0,"name":"staging-speech.mp4","mime":"audio/mp4","reservationMicroUsd":4500},{"format":"mpeg","model":"gpt-transcribe","bytes":194156,"sha256":"9a89f3860a66d1d1e0fba139b51fded9a5e0e2f6f19d687616b2efaad1c2f78a","dispatchDurationSeconds":12.096,"name":"staging-speech.mpeg","mime":"audio/mpeg","reservationMicroUsd":4500},{"format":"mpga","model":"gpt-transcribe","bytes":194156,"sha256":"9a89f3860a66d1d1e0fba139b51fded9a5e0e2f6f19d687616b2efaad1c2f78a","dispatchDurationSeconds":12.096,"name":"staging-speech.mpga","mime":"audio/mpeg","reservationMicroUsd":4500},{"format":"m4a","model":"gpt-transcribe","bytes":100621,"sha256":"a3bc3ef3c33926b8ab626ee01dcd6626070e9d1d9f1c48a736a69704b55a8276","dispatchDurationSeconds":12.0,"name":"staging-speech.m4a","mime":"audio/mp4","reservationMicroUsd":4500},{"format":"ogg","model":"gpt-transcribe","bytes":51197,"sha256":"6e1eae6e0002faf64d745d3f1c8a598f3c2fe9914de2afdb35e575ba93357dcd","dispatchDurationSeconds":12.0,"name":"staging-speech.ogg","mime":"audio/ogg","reservationMicroUsd":4500},{"format":"wav","model":"gpt-4o-transcribe-diarize","bytes":480396,"sha256":"3e6cf6e1fc99bb17e46734c50b5c7fcd3cbc78c9673c5473dafcb3395bad46d3","dispatchDurationSeconds":15.0099375,"name":"staging-wav-diarization.wav","mime":"audio/wav","reservationMicroUsd":180000},{"format":"webm","model":"gpt-transcribe","bytes":112266,"sha256":"0853722ad4b4f7dd68e226b4a803775c9bb8aa95e745d0dcd6386babcd416ea8","dispatchDurationSeconds":12.008,"name":"staging-speech.webm","mime":"audio/webm","reservationMicroUsd":4500}].map(Object.freeze));
export const PRIOR_FILES=Object.freeze({"budget.json":"2b47f1e6088e8863eae7b6aec7f4bdfe9190088246f09675f0bebca40d81b2a0","receipt.json":"6825dc9cc89774992a12d06e733547f7e425d65a12f31979b698f9e6467e5973","reservation.json":"0febf8dcaf82c90dfdc42b10dee1c15c979c9fac81a87399e44ed42e2e5b4a08","source.json":"857444d217e762de84d957927e6b2861fb41d3d678bfdda652e39f6f10f05f3c"});
export const SOURCE_FEATURES=Object.freeze({"src/index.js":"af1e74a08e6b06550129ebe920571e374e8b5ddb383a62afc3c30c2ecc32c55d","src/openai.js":"78f346ec60f134a81d4bdc3409953bec55d94799ff65d73c7ec8e3daf033f80e","src/short-wav.js":"822786914fd5bcc36619b9301c72045764c75f7e253a826da6e224c8fb278f30"});
export const sha256=b=>createHash('sha256').update(b).digest('hex');
export function requireReviewedDeployment(pin=APPROVED_DEPLOYMENT){
 assert.match(pin.source||'',/^[a-f0-9]{40}$/);assert.notEqual(pin.source,'82392336cfea5bc417098a2c6e3066dafca97b5b');
 assert.match(pin.version||'',/^[a-f0-9-]{36}$/);assert.match(pin.head||'',/^[a-f0-9]{40}$/);
 for(const key of ['run','ciRun','licensingRun','artifact'])assert.ok(Number.isSafeInteger(pin[key])&&pin[key]>0);
 return pin;
}
export function verifyPriorSmoke(files){
 assert.deepEqual(Object.keys(files).sort(),Object.keys(PRIOR_FILES).sort());
 for(const [name,hash] of Object.entries(PRIOR_FILES))assert.equal(sha256(files[name]),hash,'Prior receipt changed');
 const receipt=JSON.parse(files['receipt.json']),ledger=JSON.parse(files['budget.json']);
 assert.equal(receipt.status,'PASS');assert.equal(receipt.attempted,1);assert.equal(receipt.byokForget,'PASS');assert.equal(receipt.fullAcceptance,false);assert.equal(receipt.releaseReady,false);
 assert.equal(ledger.approval,POLICY.approval);assert.equal(ledger.reservedRequests,1);assert.equal(ledger.reservedMicroUsd,4500);
 return ledger;
}
export function reserveRemaining(ledger){
 assert.equal(ledger.schema,'cosmic-approved-paid-budget-1');assert.equal(ledger.approval,POLICY.approval);
 assert.equal(ledger.maximumRequests,9);assert.equal(ledger.maximumMicroUsd,250000);
 assert.equal(ledger.reservedRequests,1);assert.equal(ledger.reservedMicroUsd,4500);
 assert.equal(FIXTURES.length,8);assert.equal(FIXTURES.some(x=>x.format==='mp3'),false);
 const total=ledger.reservedMicroUsd+FIXTURES.reduce((n,x)=>n+x.reservationMicroUsd,0);
 assert.equal(total,216000);assert.ok(total<=250000);
 return {...ledger,reservedRequests:9,reservedMicroUsd:total};
}
export function verifyFixtures(files){
 assert.deepEqual(Object.keys(files).sort(),FIXTURES.map(x=>x.name).sort());
 for(const f of FIXTURES){const b=files[f.name];assert.equal(b.length,f.bytes);assert.equal(sha256(b),f.sha256);
  if(f.format==='wav')assert.equal(shortPcmWavSeconds(b),f.dispatchDurationSeconds);
  else assert.ok(f.dispatchDurationSeconds>0&&f.dispatchDurationSeconds<60&&f.model==='gpt-transcribe');
 }
 return FIXTURES;
}
// This exact reviewed attempt failed before reservation or provider steps.
// Never exempt arbitrary failed manual runs or GitHub reruns.
export const ZERO_PAID_ATTEMPT=Object.freeze({id:40113556242,head:'da0acbc46e4973488887bebc9dd49972376c34da',job:120930077359});
export function verifyZeroPaidAttempt(run,jobs,artifacts){
 try{
  assert.equal(run.id,ZERO_PAID_ATTEMPT.id);assert.equal(run.head_sha,ZERO_PAID_ATTEMPT.head);
  assert.equal(run.path,'.github/workflows/'+POLICY.workflow);assert.equal(run.event,'workflow_dispatch');
  assert.equal(run.run_attempt,1);assert.equal(run.status,'completed');assert.equal(run.conclusion,'failure');
  assert.ok(Array.isArray(jobs)&&jobs.length===1);const job=jobs[0];
  assert.equal(job.id,ZERO_PAID_ATTEMPT.job);assert.equal(job.run_id,run.id);assert.equal(job.run_attempt,1);
  assert.equal(job.name,'remaining');assert.equal(job.status,'completed');assert.equal(job.conclusion,'failure');
  assert.ok(Array.isArray(job.steps)&&job.steps.every(s=>s.status==='completed'));
  const step=(name,conclusion)=>{const found=job.steps.filter(s=>s.name===name);assert.equal(found.length,1);assert.equal(found[0].conclusion,conclusion)};
  step('Refuse until reviewed deployment pins replace the intentionally empty draft','success');
  step('Read only the pinned successful MP3 evidence','success');
  step('Account every previous attempt and reserve the final eight slots','failure');
  for(const name of ['Persist cumulative reservation before any paid request','Download only the reviewed synthetic eight-format artifact','Fresh exact-source staging proof using existing read access','At most eight fixed requests, stop on first failure, never retry'])step(name,'skipped');
  assert.deepEqual(artifacts,[]);
  return {runId:run.id,paidRequests:0,reservationMade:false};
 }catch{const error=Error('Prior attempt requires accounting review');error.code='history_zero_attempt_invalid';throw error}
}
// Receipt-bound recovery of ONE reviewed failure before BYOK/provider execution.
// Its reservation already exists: reuse it, never release or reserve it again.
export const RESERVED_ZERO_ATTEMPT=Object.freeze({id:40161696792,head:'813e66aea0a334c62d3dba0f634fc9ff70ca4310',job:121074434504,
 evidenceArtifact:12586114319,evidenceDigest:'4940a85d98c2e1a7bf847c8fe50e39b723e5cda0b3007b0797a7ecc2abcdc961',
 reservationArtifact:12585919515,reservationDigest:'2056065a1b992f6c2642d38309f5d528c1bb47655a8b7475060f688d28228427',
 runnerSha256:'1be2fdbedd4d4e75bec04a750fb2c3abdbf1511b312c68f4c4011cedd7ab5afc'});
export const RESERVED_ZERO_FILES=Object.freeze({'budget.json':'fcd4374ad089cc29724324dec581b879216499610b5955d4cbb6110156bb8661','receipt.json':'cc40c8a42a1d6debbb189c3e38496f0da4bd61254eb725f6837071eb68b1e811','reservation.json':'d9a281db993c51bf94f7a8e8e7b5db2df81a075dd08f13c4b07664d7efb72ee1','source.json':'5c64182558066ef3114d7fe20228ebe5308c8e856fb02a9078c4f22322200f8e'});
const heldLedger=()=>({schema:'cosmic-approved-paid-budget-1',approval:POLICY.approval,maximumRequests:9,maximumMicroUsd:250000,reservedRequests:9,reservedMicroUsd:216000});
export function verifyReservedZeroAttempt(run,jobs,artifacts,files){
 try{
  const pin=RESERVED_ZERO_ATTEMPT;
  assert.equal(run.id,pin.id);assert.equal(run.head_sha,pin.head);assert.equal(run.head_branch,'main');
  assert.equal(run.path,'.github/workflows/'+POLICY.workflow);assert.equal(run.event,'workflow_dispatch');
  assert.equal(run.run_attempt,1);assert.equal(run.status,'completed');assert.equal(run.conclusion,'failure');
  assert.ok(Array.isArray(jobs)&&jobs.length===1);const job=jobs[0];
  assert.equal(job.id,pin.job);assert.equal(job.run_id,pin.id);assert.equal(job.run_attempt,1);assert.equal(job.name,'remaining');
  assert.equal(job.status,'completed');assert.equal(job.conclusion,'failure');
  assert.ok(Array.isArray(job.steps)&&job.steps.every(s=>s.status==='completed'));
  const step=(name,result)=>{const found=job.steps.filter(s=>s.name===name);assert.equal(found.length,1);assert.equal(found[0].conclusion,result)};
  for(const name of ['Refuse until reviewed deployment pins replace the intentionally empty draft','Read only the pinned successful MP3 evidence','Account every previous attempt and reserve the final eight slots','Persist cumulative reservation before any paid request','Download only the reviewed synthetic eight-format artifact','Fresh exact-source staging proof using existing read access','Preserve only redacted evidence with no release or production successor'])step(name,'success');
  step('At most eight fixed requests, stop on first failure, never retry','failure');
  assert.ok(Array.isArray(artifacts)&&artifacts.length===2);
  for(const [id,name,digest,size] of [[pin.evidenceArtifact,'remaining-eight-redacted-evidence',pin.evidenceDigest,1608],[pin.reservationArtifact,'remaining-eight-approved-reservation',pin.reservationDigest,356]]){
   const found=artifacts.filter(a=>a.id===id);assert.equal(found.length,1);const a=found[0];
   assert.equal(a.name,name);assert.equal(a.digest,'sha256:'+digest);assert.equal(a.size_in_bytes,size);assert.equal(a.expired,false);
   assert.equal(a.workflow_run?.id,pin.id);assert.equal(a.workflow_run?.head_sha,pin.head);
  }
  assert.deepEqual(Object.keys(files).sort(),Object.keys(RESERVED_ZERO_FILES).sort());
  for(const [name,digest] of Object.entries(RESERVED_ZERO_FILES))assert.equal(sha256(files[name]),digest);
  const receipt=JSON.parse(files['receipt.json']),budget=JSON.parse(files['budget.json']),reservation=JSON.parse(files['reservation.json']),source=JSON.parse(files['source.json']);
  assert.deepEqual(budget,heldLedger());
  assert.deepEqual(reservation,{...budget,runId:String(pin.id),remainingRequests:0,priorSmokeRun:POLICY.priorRun,fullAcceptance:false,releaseReady:false});
  assert.equal(receipt.schema,'cosmic-staging-remaining-eight-1');assert.equal(receipt.status,'FAIL');assert.equal(receipt.phase,'access-status');
  assert.deepEqual(receipt.failure,{phase:'access-status',code:'access_redirect'});assert.equal(receipt.attempted,0);assert.deepEqual(receipt.formats,[]);
  assert.equal(receipt.runnerSha256,pin.runnerSha256);assert.equal(receipt.baseCommit,APPROVED_DEPLOYMENT.source);
  assert.deepEqual(receipt.deployedSource,{commit:APPROVED_DEPLOYMENT.source,workerVersionId:APPROVED_DEPLOYMENT.version});
  for(const key of ['access','byokForget','budget'])assert.equal(Object.hasOwn(receipt,key),false);
  for(const key of ['fullAcceptance','releaseReady','genuineMacSafariValidated'])assert.equal(receipt[key],false);
  assert.ok(Number.isFinite(Date.parse(receipt.startedAt))&&Date.parse(receipt.finishedAt)>=Date.parse(receipt.startedAt));
  assert.equal(source.schema,'cosmic-verified-staging-source-1');assert.equal(source.verified,true);assert.equal(source.origin,POLICY.origin);
  assert.equal(source.commit,APPROVED_DEPLOYMENT.source);assert.equal(source.workerVersionId,APPROVED_DEPLOYMENT.version);
  return {sourceRunId:pin.id,paidAttempts:0,evidenceArtifact:pin.evidenceArtifact,evidenceDigest:pin.evidenceDigest,reservedRequests:9,reservedMicroUsd:216000};
 }catch{const error=Error('Reserved zero-attempt evidence requires review');error.code='history_reserved_zero_invalid';throw error;}
}
export function reconcileHeldEight(priorSmokeLedger,proof,currentRun){
 assert.deepEqual(priorSmokeLedger,{...heldLedger(),reservedRequests:1,reservedMicroUsd:4500});
 const pin=RESERVED_ZERO_ATTEMPT;
 assert.deepEqual(proof,{sourceRunId:pin.id,paidAttempts:0,evidenceArtifact:pin.evidenceArtifact,evidenceDigest:pin.evidenceDigest,reservedRequests:9,reservedMicroUsd:216000});
 assert.match(String(currentRun),/^[1-9][0-9]{0,19}$/);assert.notEqual(String(currentRun),String(pin.id));assert.notEqual(String(currentRun),String(ZERO_PAID_ATTEMPT.id));assert.notEqual(String(currentRun),String(POLICY.priorRun));
 const budget=heldLedger();
 return {budget,reservation:{...budget,runId:String(currentRun),remainingRequests:0,priorSmokeRun:POLICY.priorRun,fullAcceptance:false,releaseReady:false,
  continuation:{schema:'cosmic-eight-held-reservation-continuation-1',...proof,continuationRunId:String(currentRun),unusedSlots:8,additionalReservationMicroUsd:0,oneShot:true}}};
}
export function verifyHeldContinuation(budget,reservation,currentRun){
 const pin=RESERVED_ZERO_ATTEMPT,proof={sourceRunId:pin.id,paidAttempts:0,evidenceArtifact:pin.evidenceArtifact,evidenceDigest:pin.evidenceDigest,reservedRequests:9,reservedMicroUsd:216000};
 const expected=reconcileHeldEight({...heldLedger(),reservedRequests:1,reservedMicroUsd:4500},proof,currentRun);
 assert.deepEqual(budget,expected.budget);assert.deepEqual(reservation,expected.reservation);
 return expected.reservation.continuation;
}
export function verifyHistory(smokeRuns,remainingRuns,ciRuns,jobLists,currentRun,zeroPaidArtifacts={},reservedZeroEvidence,cancelledCiEvidence={}){
 assert.equal(smokeRuns.filter(x=>x.event==='workflow_dispatch').length,1,'history_smoke_dispatch_count');
 for(const run of smokeRuns){assert.equal(run.run_attempt,1,'history_smoke_attempt');assert.equal(run.status,'completed','history_smoke_status');
  if(run.id===POLICY.priorRun){assert.equal(run.event,'workflow_dispatch','history_smoke_identity');assert.equal(run.conclusion,'success','history_smoke_result');}
  else {assert.ok(['push','pull_request'].includes(run.event),'history_smoke_unreviewed_manual');assert.equal(run.conclusion,'failure','history_smoke_validation');assert.deepEqual(jobLists[run.id],[],'history_smoke_validation_jobs');}
 }
 assert.ok(smokeRuns.some(x=>x.id===POLICY.priorRun),'history_smoke_missing');
 assert.equal(remainingRuns.filter(x=>String(x.id)===String(currentRun)).length,1,'history_current_run');
 for(const run of remainingRuns){assert.equal(run.run_attempt,1,'history_remaining_attempt');if(String(run.id)===String(currentRun))continue;
  if(run.id===ZERO_PAID_ATTEMPT.id){verifyZeroPaidAttempt(run,jobLists[run.id],zeroPaidArtifacts[run.id]);continue;}
  if(run.id===RESERVED_ZERO_ATTEMPT.id){verifyReservedZeroAttempt(run,jobLists[run.id],reservedZeroEvidence?.artifacts,reservedZeroEvidence?.files);continue;}
  assert.ok(['push','pull_request'].includes(run.event),'history_remaining_unreviewed_manual');assert.equal(run.status,'completed','history_remaining_status');assert.equal(run.conclusion,'failure','history_remaining_validation');assert.deepEqual(jobLists[run.id],[],'history_remaining_validation_jobs');
 }
 if(reservedZeroEvidence)assert.equal(remainingRuns.filter(x=>x.id===RESERVED_ZERO_ATTEMPT.id).length,1,'history_reserved_zero_missing');
 for(const run of ciRuns){assert.equal(run.status,'completed','history_ci_active');assert.ok(Number.isSafeInteger(run.run_attempt)&&run.run_attempt>=1&&run.run_attempt<=20,'history_ci_attempts');
  const paid=jobLists[run.id]?.filter(x=>x.name==='Actual authenticated STAGING paid nine-format acceptance');assert.equal(paid?.length,run.run_attempt,'history_ci_paid_count');
  for(let a=1;a<=run.run_attempt;a++){const p=paid.filter(x=>x.run_attempt===a);assert.equal(p.length,1,'history_ci_paid_attempt');assert.equal(p[0].status,'completed','history_ci_paid_status');if(run.id===CANCELLED_CI_PIN.run&&p[0].conclusion==='cancelled')verifyExactNeverStartedCancelledCi({...cancelledCiEvidence[run.id],run,jobs:jobLists[run.id]});else assert.equal(p[0].conclusion,'skipped','history_ci_paid_executed');}
 }
 return true;
}
