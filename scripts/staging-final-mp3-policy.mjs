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
export function verifyFinalFixtureArtifact(artifacts){
 const p=FINAL_MP3,a=artifacts.filter(a=>a.id===p.fixtureArtifact);assert.equal(a.length,1);assert.equal(a[0].name,'cosmic-approved-single-mp3-fixture');assert.equal(a[0].digest,'sha256:'+p.fixtureDigest);assert.equal(a[0].expired,false);assert.equal(a[0].size_in_bytes,133819);assert.equal(a[0].workflow_run.id,p.fixtureRun);assert.equal(a[0].workflow_run.head_sha,'a4f25ce6534baa7144317c4ac09ba30143937aa6');
 return true;
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
export function reserveFinalMp3(priorFiles,eightProof,currentRun){
 const prior=verifyPriorSmoke(priorFiles);assert.equal(prior.reservedRequests,1);assert.equal(prior.reservedMicroUsd,4500);
 assert.deepEqual(eightProof,{schema:'cosmic-completed-nine-request-lineage-1',priorSmokeRun:POLICY.priorRun,eightRun:FINAL_MP3.run,source:FINAL_MP3.source,eightEvidenceArtifact:FINAL_MP3.evidenceArtifact,eightEvidenceDigest:FINAL_MP3.evidenceDigest,paidRequests:9,reservedMicroUsd:216000});
 assert.match(String(currentRun),/^[1-9][0-9]{0,19}$/);for(const id of [POLICY.priorRun,FINAL_MP3.run,40161696792,40113556242,FINAL_MP3_ZERO.run])assert.notEqual(String(currentRun),String(id));
 const budget={schema:'cosmic-approved-final-mp3-budget-1',approval:FINAL_MP3.approval,previousApproval:POLICY.approval,maximumRequests:10,maximumMicroUsd:220500,ownerCumulativeMaximumMicroUsd:2000000,reservedRequests:10,reservedMicroUsd:220500};
 return {budget,reservation:{...budget,runId:String(currentRun),priorPaidRequests:9,additionalApprovedRequests:1,additionalReservationMicroUsd:4500,lineage:eightProof,oneShot:true,fullAcceptance:false,releaseReady:false}};
}
export function verifyFinalReservation(budget,reservation,currentRun,priorFiles,eightProof){const expected=reserveFinalMp3(priorFiles,eightProof,currentRun);assert.deepEqual(budget,expected.budget);assert.deepEqual(reservation,expected.reservation);return expected;}
export function verifyFinalHistory(smokeRuns,remainingRuns,ciRuns,jobLists,currentRun,zeroArtifacts,heldEvidence,cancelledCiEvidence,eightProof,finalZeroEvidence){
 assert.deepEqual(eightProof,{schema:'cosmic-completed-nine-request-lineage-1',priorSmokeRun:POLICY.priorRun,eightRun:FINAL_MP3.run,source:FINAL_MP3.source,eightEvidenceArtifact:FINAL_MP3.evidenceArtifact,eightEvidenceDigest:FINAL_MP3.evidenceDigest,paidRequests:9,reservedMicroUsd:216000});
 const current=smokeRuns.filter(r=>String(r.id)===String(currentRun));assert.equal(current.length,1);assert.equal(current[0].event,'workflow_dispatch');assert.equal(current[0].head_branch,'main');assert.equal(current[0].run_attempt,1);assert.equal(current[0].path,'.github/workflows/staging-single-mp3-smoke.yml');
 // Reuse strict original history, with the now-completed exact eight run taking
 // its already-proved current-run role. Every other manual continuation rejects.
 const zero=smokeRuns.filter(r=>r.id===FINAL_MP3_ZERO.run);assert.equal(zero.length,1,'Exact zero-attempt history missing');verifyFinalZeroAttempt(zero[0],jobLists[FINAL_MP3_ZERO.run],finalZeroEvidence);
 return verifyHistory(smokeRuns.filter(r=>String(r.id)!==String(currentRun)&&r.id!==FINAL_MP3_ZERO.run),remainingRuns,ciRuns,jobLists,String(FINAL_MP3.run),zeroArtifacts,heldEvidence,cancelledCiEvidence);
}
