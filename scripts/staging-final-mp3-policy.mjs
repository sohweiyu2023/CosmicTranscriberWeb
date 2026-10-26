// One explicitly approved additional MP3, bound to immutable completed evidence.
import assert from 'node:assert/strict';
import {POLICY,APPROVED_DEPLOYMENT,FIXTURES,verifyPriorSmoke,verifyHeldContinuation,verifyHistory,sha256} from './staging-remaining-eight-policy.mjs';
export const FINAL_MP3=Object.freeze({approval:'owner-approved-same-source-mp3-2026-10-25',authorization:'one-mp3-same-source-tenth',mode:'one-approved-same-source-tenth',run:40200059681,head:'cdac98f1745d7515277309bbf83465e634a33ec4',job:121189153192,evidenceArtifact:12601587812,evidenceDigest:'7ef8e928b1003e09d47fa95f0c0ea3698ddc0ae93ee588499f62d40568183e7b',reservationArtifact:12601926194,reservationDigest:'ce7d31fc41d2255d07281292a93244967ed768618e4e9b235561b96e3d1ec43a',fixtureRun:40107978892,fixtureArtifact:12565238332,fixtureDigest:'c291ab8175af70d488643ffad5f0f4c5dbaa138a168191ddd52f3cb6adb2f6a7',source:APPROVED_DEPLOYMENT.source,additionalReservationMicroUsd:4500,cumulativeReservationMicroUsd:220500});

// One immutable manual failure stopped before reservation, source, BYOK or paid
// steps. This is not a general failed-run/rerun exemption. Exact API step graph
// plus the original code/workflow blobs establish nonexecution, not a log label.
export const FINAL_MP3_ZERO=Object.freeze({run:40245143343,head:'d6d749889f9735f4c27dbdcb4164fb3656a8253a',job:121325017956,stepDigest:'d04548df503fee2ce9dfb7466499d9ce284eae7abd2ff53675ffe1398636647c',blobs:Object.freeze({'.github/workflows/staging-single-mp3-smoke.yml':'bcc1dbc233a8ad6be11bdf1042d904d0d1fbd123','scripts/staging-final-mp3-preflight.mjs':'2a0e661ab70ef4bc42e79d88c25ded8b8f86dd5b','scripts/staging-final-mp3-policy.mjs':'1c8f537e8a84ec53c2f6c41f7a6275b13bd02692'})});
export function verifyFinalZeroAttempt(run,jobs,evidence){
 const p=FINAL_MP3_ZERO;
 assert.equal(run.id,p.run);assert.equal(run.head_sha,p.head);assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');assert.equal(run.path,'.github/workflows/staging-single-mp3-smoke.yml');assert.equal(run.run_attempt,1);assert.equal(run.status,'completed');assert.equal(run.conclusion,'failure');
 assert.equal(jobs.length,1);const j=jobs[0];assert.equal(j.id,p.job);assert.equal(j.run_id,p.run);assert.equal(j.run_attempt,1);assert.equal(j.name,'smoke');assert.equal(j.status,'completed');assert.equal(j.conclusion,'failure');
 assert.ok(Array.isArray(j.steps));assert.equal(sha256(JSON.stringify(j.steps.map(s=>[s.number,s.name,s.status,s.conclusion]))),p.stepDigest);
 assert.deepEqual(evidence.artifacts,[]);assert.deepEqual(evidence.workflowBlobs,p.blobs);
 return true;
}

// Reuse only the one unused slot already reserved by this exact zero-provider
// Access failure. Artifact/file hashes and immutable code bind the proof.
export const FINAL_MP3_HELD=Object.freeze({run:40336352549,head:'b6bb26f698dc143468bb34c8b7133ab8ce5b4e9a',job:121618877281,stepDigest:'0e3134c490aa12ae53398092b08e64e9c5cb543a6e71209bc4f3a9ebf418f6c5',evidenceArtifact:12656454065,evidenceDigest:'c06d9457cf31ab821946369e7d0511609477460ae80c006f2081c3250154692a',reservationArtifact:12657152831,reservationDigest:'5ab4e2b96e7c5952dbac0aa6085b1b8aea3b06c39f720e2dbb08d38418f77162',blobs:Object.freeze({'.github/workflows/staging-single-mp3-smoke.yml':'bcc1dbc233a8ad6be11bdf1042d904d0d1fbd123','scripts/staging-final-mp3-preflight.mjs':'ca1d319052afa7814e694ae8268de00028da5ad0','scripts/staging-final-mp3-policy.mjs':'e08cdb92c3309291c2511dfa43092c1ef7158ba4','scripts/staging-single-mp3-smoke.mjs':'5d42f1d1b44c522991aaf522b4677946ed420038'})});
export const FINAL_HELD_FILES=Object.freeze({'budget.json':'b40b9ab8f8df4a144fe9e81335e26e45389b38833a19bbed30952798579e98d7','reservation.json':'c8f784932306acb5452d88ca765a7b3858042547876b181d94ec07873c2091c8','lineage.json':'43c2cdd5ce54965d12eaa707f2996392d95f40bb11827d6e6e3ce54971797710','receipt.json':'5f15814195d711f9b491610ce4c4782410ac6d94e138f754e1b8d62687b0d3bd','source.json':'2a43bab535c3a5882990da32fe876b83d9148a11826cdae46a4f925e28e9a272'});
function finalBudget(){return {schema:'cosmic-approved-final-mp3-budget-1',approval:FINAL_MP3.approval,previousApproval:POLICY.approval,maximumRequests:10,maximumMicroUsd:220500,ownerCumulativeMaximumMicroUsd:2000000,reservedRequests:10,reservedMicroUsd:220500};}
function eightLineage(){return {schema:'cosmic-completed-nine-request-lineage-1',priorSmokeRun:POLICY.priorRun,eightRun:FINAL_MP3.run,source:FINAL_MP3.source,eightEvidenceArtifact:FINAL_MP3.evidenceArtifact,eightEvidenceDigest:FINAL_MP3.evidenceDigest,paidRequests:9,reservedMicroUsd:216000};}
function heldSlotProof(){return {schema:'cosmic-final-mp3-held-slot-proof-1',heldRun:FINAL_MP3_HELD.run,heldHead:FINAL_MP3_HELD.head,heldJob:FINAL_MP3_HELD.job,evidenceArtifact:FINAL_MP3_HELD.evidenceArtifact,evidenceDigest:FINAL_MP3_HELD.evidenceDigest,receiptSha256:FINAL_HELD_FILES['receipt.json'],reservationSha256:FINAL_HELD_FILES['reservation.json'],paidRequests:0,reservedRequests:10,reservedMicroUsd:220500,unusedSlots:1};}
export function verifyHeldFinalFiles(files){
 assert.deepEqual(Object.keys(files).sort(),Object.keys(FINAL_HELD_FILES).sort());for(const [name,hash]of Object.entries(FINAL_HELD_FILES))assert.equal(sha256(files[name]),hash);
 const b=JSON.parse(files['budget.json']),r=JSON.parse(files['receipt.json']),reservation=JSON.parse(files['reservation.json']),source=JSON.parse(files['source.json']),lineage=JSON.parse(files['lineage.json']);
 assert.deepEqual(b,finalBudget());assert.deepEqual(lineage,eightLineage());assert.deepEqual(reservation,{...b,runId:String(FINAL_MP3_HELD.run),priorPaidRequests:9,additionalApprovedRequests:1,additionalReservationMicroUsd:4500,lineage,oneShot:true,fullAcceptance:false,releaseReady:false});
 assert.equal(r.schema,'cosmic-staging-single-mp3-smoke-1');assert.equal(r.status,'FAIL');assert.equal(r.phase,'access-status');assert.deepEqual(r.failure,{phase:'access-status',code:'access_redirect'});assert.equal(r.attempted,0);for(const key of ['attemptId','result','byokForget','access'])assert.equal(key in r,false);assert.equal(r.coordinatorCommit,FINAL_MP3_HELD.head);assert.equal(r.baseCommit,FINAL_MP3.source);assert.deepEqual(r.lineage,lineage);
 assert.equal(source.schema,'cosmic-verified-staging-source-1');assert.equal(source.verified,true);assert.equal(source.commit,FINAL_MP3.source);assert.equal(source.workerVersionId,APPROVED_DEPLOYMENT.version);assert.deepEqual(r.deployedSource,{commit:source.commit,workerVersionId:source.workerVersionId});for(const key of ['fullAcceptance','releaseReady','genuineMacSafariValidated'])assert.equal(r[key],false);
 return heldSlotProof();
}
export function verifyHeldFinalAttempt(run,jobs,evidence){
 const p=FINAL_MP3_HELD;assert.equal(run.id,p.run);assert.equal(run.head_sha,p.head);assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');assert.equal(run.path,'.github/workflows/staging-single-mp3-smoke.yml');assert.equal(run.run_attempt,1);assert.equal(run.status,'completed');assert.equal(run.conclusion,'failure');
 assert.equal(jobs.length,1);const j=jobs[0];assert.equal(j.id,p.job);assert.equal(j.run_id,p.run);assert.equal(j.run_attempt,1);assert.equal(j.name,'smoke');assert.equal(j.status,'completed');assert.equal(j.conclusion,'failure');assert.equal(sha256(JSON.stringify(j.steps.map(s=>[s.number,s.name,s.status,s.conclusion]))),p.stepDigest);
 assert.deepEqual(evidence.workflowBlobs,p.blobs);assert.equal(evidence.artifacts.length,2);
 for(const [id,name,digest,size]of [[p.evidenceArtifact,'single-mp3-redacted-evidence',p.evidenceDigest,2535],[p.reservationArtifact,'single-mp3-approved-reservation',p.reservationDigest,597]]){const matches=evidence.artifacts.filter(a=>a.id===id);assert.equal(matches.length,1);const a=matches[0];assert.equal(a.name,name);assert.equal(a.digest,'sha256:'+digest);assert.equal(a.size_in_bytes,size);assert.equal(a.expired,false);assert.equal(a.workflow_run.id,p.run);assert.equal(a.workflow_run.head_sha,p.head);}
 return verifyHeldFinalFiles(evidence.files);
}

const fixtureFailures=new WeakMap();
export function finalFixtureFailureDiagnostic(error){const value=error&&typeof error==='object'?fixtureFailures.get(error):undefined;return value?structuredClone(value):undefined;}
export function finalFixtureArtifactDiagnostic(artifacts){
 const p=FINAL_MP3,candidates=Array.isArray(artifacts)?artifacts.filter(a=>a?.id===p.fixtureArtifact):[];
 const integer=value=>Number.isSafeInteger(value)&&value>=0?value:null;
 const digest=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value)?value:null;
 const head=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value)?value:null;
 return {expected:{id:p.fixtureArtifact,digest:'sha256:'+p.fixtureDigest,bytes:133819,run:p.fixtureRun,head:'a4f25ce6534baa7144317c4ac09ba30143937aa6'},candidateCount:candidates.length,
  actual:candidates.slice(0,2).map(a=>({id:integer(a.id),digest:digest(a.digest),bytes:integer(a.size_in_bytes),run:integer(a.workflow_run?.id),head:head(a.workflow_run?.head_sha),nameMatches:a.name==='cosmic-approved-single-mp3-fixture',unexpired:a.expired===false}))};
}
export function verifyFinalFixtureArtifact(artifacts){
 try{
  const p=FINAL_MP3,a=artifacts.filter(a=>a.id===p.fixtureArtifact);assert.equal(a.length,1);assert.equal(a[0].name,'cosmic-approved-single-mp3-fixture');assert.equal(a[0].digest,'sha256:'+p.fixtureDigest);assert.equal(a[0].expired,false);assert.equal(a[0].size_in_bytes,133819);assert.equal(a[0].workflow_run.id,p.fixtureRun);assert.equal(a[0].workflow_run.head_sha,'a4f25ce6534baa7144317c4ac09ba30143937aa6');
  return true;
 }catch{const error=Error('Fixed fixture artifact rejected');error.code='final_fixture_artifact_mismatch';fixtureFailures.set(error,finalFixtureArtifactDiagnostic(artifacts));throw error;}
}

export const EIGHT_FILES=Object.freeze({'budget.json':'fcd4374ad089cc29724324dec581b879216499610b5955d4cbb6110156bb8661','receipt.json':'9228c56a732ee93016f63f7311c3c07abc4d0e7823aa02299eadeec8e60777a9','reservation.json':'280149fa73a1bd41cce15e557ea35d1ba189e3d614deb93c12b11db3bcec88ae','source.json':'3b38dd6922cdb9dbf855de54e1e046c691b90f10012fcd3eab6d1eeb8b36fa6b'});
export function verifyCompletedEight(run,jobs,artifacts,files){
 const p=FINAL_MP3;
 assert.equal(run.id,p.run);assert.equal(run.head_sha,p.head);assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');assert.equal(run.path,'.github/workflows/'+POLICY.workflow);assert.equal(run.run_attempt,1);assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
 assert.equal(jobs.length,1);const job=jobs[0];assert.equal(job.id,p.job);assert.equal(job.run_id,p.run);assert.equal(job.run_attempt,1);assert.equal(job.name,'remaining');assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');
 for(const name of ['Reconcile complete history and reuse only the eight held unused slots','Persist cumulative reservation before any paid request','Download only the reviewed synthetic eight-format artifact','Fresh exact-source staging proof using existing read access','At most eight fixed requests, stop on first failure, never retry','Preserve only redacted evidence with no release or production successor']){const s=job.steps.filter(s=>s.name===name);assert.equal(s.length,1);assert.equal(s[0].status,'completed');assert.equal(s[0].conclusion,'success');}
 assert.equal(artifacts.length,2);
 for(const [id,name,digest,size]of [[p.evidenceArtifact,'remaining-eight-redacted-evidence',p.evidenceDigest,2282],[p.reservationArtifact,'remaining-eight-approved-reservation',p.reservationDigest,526]]){const a=artifacts.filter(a=>a.id===id);assert.equal(a.length,1);assert.equal(a[0].name,name);assert.equal(a[0].digest,'sha256:'+digest);assert.equal(a[0].size_in_bytes,size);assert.equal(a[0].expired,false);assert.equal(a[0].workflow_run.id,p.run);assert.equal(a[0].workflow_run.head_sha,p.head);}
 return verifyEightFiles(files);
}
export function verifyEightFiles(files){
 const p=FINAL_MP3;
 assert.deepEqual(Object.keys(files).sort(),Object.keys(EIGHT_FILES).sort());for(const [name,hash]of Object.entries(EIGHT_FILES))assert.equal(sha256(files[name]),hash);
 const r=JSON.parse(files['receipt.json']),b=JSON.parse(files['budget.json']),reservation=JSON.parse(files['reservation.json']),s=JSON.parse(files['source.json']);
 assert.equal(r.status,'PASS');assert.equal(r.phase,'complete');assert.equal(r.attempted,8);assert.equal(r.access,'PASS');assert.equal(r.byokForget,'PASS');
 assert.deepEqual(r.formats.map(f=>f.format),FIXTURES.map(f=>f.format));assert.equal(new Set(r.formats.map(f=>f.attemptId)).size,8);
 for(const [i,f]of r.formats.entries()){assert.equal(f.status,'PASS');assert.equal(f.model,FIXTURES[i].model);assert.equal(f.requestIdPresent,true);}
 assert.deepEqual(r.continuation,verifyHeldContinuation(b,reservation,String(p.run)));
 assert.equal(s.verified,true);assert.equal(s.commit,p.source);assert.equal(s.workerVersionId,APPROVED_DEPLOYMENT.version);assert.deepEqual(r.deployedSource,{commit:p.source,workerVersionId:APPROVED_DEPLOYMENT.version});
 for(const key of ['fullAcceptance','releaseReady','genuineMacSafariValidated'])assert.equal(r[key],false);
 return {schema:'cosmic-completed-nine-request-lineage-1',priorSmokeRun:POLICY.priorRun,eightRun:p.run,source:p.source,eightEvidenceArtifact:p.evidenceArtifact,eightEvidenceDigest:p.evidenceDigest,paidRequests:9,reservedMicroUsd:216000};
}
export function reserveFinalMp3(priorFiles,eightProof,currentRun,heldProof){
 const prior=verifyPriorSmoke(priorFiles);assert.equal(prior.reservedRequests,1);assert.equal(prior.reservedMicroUsd,4500);assert.deepEqual(eightProof,eightLineage());assert.deepEqual(heldProof,heldSlotProof());
 assert.match(String(currentRun),/^[1-9][0-9]{0,19}$/);for(const id of [POLICY.priorRun,FINAL_MP3.run,40161696792,40113556242,FINAL_MP3_ZERO.run,FINAL_MP3_HELD.run])assert.notEqual(String(currentRun),String(id));
 // The budget is copied unchanged from the exact held proof, never incremented.
 const budget=finalBudget();return {budget,reservation:{...budget,runId:String(currentRun),priorPaidRequests:9,additionalApprovedRequests:1,additionalReservationMicroUsd:0,lineage:eightProof,oneShot:true,fullAcceptance:false,releaseReady:false,continuation:{...heldProof,continuationRunId:String(currentRun),additionalReservationMicroUsd:0,oneShot:true}}};
}
export function verifyFinalReservation(budget,reservation,currentRun,priorFiles,eightProof,heldProof){const expected=reserveFinalMp3(priorFiles,eightProof,currentRun,heldProof);assert.deepEqual(budget,expected.budget);assert.deepEqual(reservation,expected.reservation);return expected;}

export function verifyFinalHistory(smokeRuns,remainingRuns,ciRuns,jobLists,currentRun,zeroArtifacts,heldEvidence,cancelledCiEvidence,eightProof,finalZeroEvidence,finalHeldEvidence){
 assert.deepEqual(eightProof,{schema:'cosmic-completed-nine-request-lineage-1',priorSmokeRun:POLICY.priorRun,eightRun:FINAL_MP3.run,source:FINAL_MP3.source,eightEvidenceArtifact:FINAL_MP3.evidenceArtifact,eightEvidenceDigest:FINAL_MP3.evidenceDigest,paidRequests:9,reservedMicroUsd:216000});
 const current=smokeRuns.filter(r=>String(r.id)===String(currentRun));assert.equal(current.length,1);assert.equal(current[0].event,'workflow_dispatch');assert.equal(current[0].head_branch,'main');assert.equal(current[0].run_attempt,1);assert.equal(current[0].path,'.github/workflows/staging-single-mp3-smoke.yml');
 // Reuse strict original history, with the now-completed exact eight run taking
 // its already-proved current-run role. Every other manual continuation rejects.
 const zero=smokeRuns.filter(r=>r.id===FINAL_MP3_ZERO.run);assert.equal(zero.length,1,'Exact zero-attempt history missing');verifyFinalZeroAttempt(zero[0],jobLists[FINAL_MP3_ZERO.run],finalZeroEvidence);
 const held=smokeRuns.filter(r=>r.id===FINAL_MP3_HELD.run);assert.equal(held.length,1,'Exact held-slot history missing');verifyHeldFinalAttempt(held[0],jobLists[FINAL_MP3_HELD.run],finalHeldEvidence);
 return verifyHistory(smokeRuns.filter(r=>String(r.id)!==String(currentRun)&&r.id!==FINAL_MP3_ZERO.run&&r.id!==FINAL_MP3_HELD.run),remainingRuns,ciRuns,jobLists,String(FINAL_MP3.run),zeroArtifacts,heldEvidence,cancelledCiEvidence);
}
