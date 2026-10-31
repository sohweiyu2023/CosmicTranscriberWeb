// Preparation-only policy. No network, credential access, writes or provider calls.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const requireTrue=(condition,code)=>{if(!condition)fail(code);};
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export const PLAN=freeze({schema:'cosmic-new-source-staging-plan-1',campaign:'logging-main-2026-10-31',
 source:'d34edd9ef4cccf648d65c71a3b016d78fd76d7bf',tree:'b8934a8e9b3131a4fda613ac6dcdddb9f522df36',ci:41165444076,artifact:13029840169,
 outerSha256:'191ff4bbd47aa072cad1e48591317ec4f34ddde7e24ae2ebb7ecb1478e82f4a8',
 innerSha256:'65a57e43bbaac1369c187a86f3ac8679c4326233affda69228769fcd2f6e4bdd',
 lockSha256:'775d8d63cc1a4a3f1bcd91baa58a19c208cb1c5b0d09e6f1030a71d3ab4fe362',
 origin:'https://transcriber-staging.awakeningtoreality.com',worker:'cosmic-transcriber-web-staging',
 previousRequests:10,previousReservedMicroUsd:220500,additionalRequests:9,additionalMicroUsd:216000,
 maximumRequests:19,maximumMicroUsd:436500,ownerCeilingMicroUsd:2000000,automaticRetries:0,
 concurrencyGroup:'cosmic-approved-paid-staging',
 closedHistoryCount:21,closedHistorySha256:'2b9c0a75f9bcbcc6159fe397c1b92c3ce3faf189c92ebf8e062535c4fe6b2dd7'});
// MUST be filled from independently verified actual deployment/guard/workflow
// evidence in a reviewed change. Context cannot override these authority pins.
const EXECUTION_PINS=Object.freeze({deploymentVersion:null,deploymentReceiptSha256:null,guardReceiptSha256:null,coordinatorHead:null,workflowBlob:null});
export const EXECUTION_READINESS=Object.freeze({enabled:false,missing:Object.freeze(Object.keys(EXECUTION_PINS))});
export const FIXTURES=freeze([{"format":"mp3","name":"staging-speech.mp3","sha256":"9a89f3860a66d1d1e0fba139b51fded9a5e0e2f6f19d687616b2efaad1c2f78a","bytes":194156,"model":"gpt-transcribe","durationSeconds":12.096,"reservationMicroUsd":4500},{"format":"flac","name":"staging-speech.flac","sha256":"510e61c3296b67cab2fc5caaf6a1a849e3c84a14a3d8e1313c9ec8403e653901","bytes":196069,"model":"gpt-transcribe","durationSeconds":12.0,"reservationMicroUsd":4500},{"format":"mp4","name":"staging-speech.mp4","sha256":"a3bc3ef3c33926b8ab626ee01dcd6626070e9d1d9f1c48a736a69704b55a8276","bytes":100621,"model":"gpt-transcribe","durationSeconds":12.0,"reservationMicroUsd":4500},{"format":"mpeg","name":"staging-speech.mpeg","sha256":"9a89f3860a66d1d1e0fba139b51fded9a5e0e2f6f19d687616b2efaad1c2f78a","bytes":194156,"model":"gpt-transcribe","durationSeconds":12.096,"reservationMicroUsd":4500},{"format":"mpga","name":"staging-speech.mpga","sha256":"9a89f3860a66d1d1e0fba139b51fded9a5e0e2f6f19d687616b2efaad1c2f78a","bytes":194156,"model":"gpt-transcribe","durationSeconds":12.096,"reservationMicroUsd":4500},{"format":"m4a","name":"staging-speech.m4a","sha256":"a3bc3ef3c33926b8ab626ee01dcd6626070e9d1d9f1c48a736a69704b55a8276","bytes":100621,"model":"gpt-transcribe","durationSeconds":12.0,"reservationMicroUsd":4500},{"format":"ogg","name":"staging-speech.ogg","sha256":"6e1eae6e0002faf64d745d3f1c8a598f3c2fe9914de2afdb35e575ba93357dcd","bytes":51197,"model":"gpt-transcribe","durationSeconds":12.0,"reservationMicroUsd":4500},{"format":"wav","name":"staging-wav-diarization.wav","sha256":"3e6cf6e1fc99bb17e46734c50b5c7fcd3cbc78c9673c5473dafcb3395bad46d3","bytes":480396,"model":"gpt-4o-transcribe-diarize","durationSeconds":15.0099375,"reservationMicroUsd":180000},{"format":"webm","name":"staging-speech.webm","sha256":"0853722ad4b4f7dd68e226b4a803775c9bb8aa95e745d0dcd6386babcd416ea8","bytes":112266,"model":"gpt-transcribe","durationSeconds":12.008,"reservationMicroUsd":4500}]);
const PRIOR_FILES=freeze({'budget.json':'b40b9ab8f8df4a144fe9e81335e26e45389b38833a19bbed30952798579e98d7',
 'lineage.json':'43c2cdd5ce54965d12eaa707f2996392d95f40bb11827d6e6e3ce54971797710',
 'receipt.json':'94844f59a443c0dcb43ad71758cc13cbf2c0e313b81611a8895ea431722e3838',
 'reservation.json':'d10afb6eae6d198ff3c37a6e8848dd3e9f432b856b83a51a432bc32e139b83b2',
 'source.json':'5672880aedc357bb5afa5aac9486e5c25e9cf17fa2c1fc502511fb81587de890'});
export function verifyFileHashes(files,expected){
 requireTrue(files&&typeof files==='object'&&!Array.isArray(files),'file_set_invalid');
 assert.deepEqual(Object.keys(files).sort(),Object.keys(expected).sort());
 for(const [name,digest]of Object.entries(expected)){
  requireTrue(Buffer.isBuffer(files[name])||files[name] instanceof Uint8Array,'file_bytes_required');
  requireTrue(hash(files[name])===digest,'file_digest_mismatch');
 }
 return true;
}
export function verifyCompletedPrior(files){
 verifyFileHashes(files,PRIOR_FILES);
 const budget=JSON.parse(files['budget.json']),receipt=JSON.parse(files['receipt.json']),reservation=JSON.parse(files['reservation.json']),lineage=JSON.parse(files['lineage.json']);
 requireTrue(receipt.status==='PASS'&&receipt.attempted===1,'prior_not_completed_once');
 requireTrue(lineage.paidRequests===9&&lineage.reservedMicroUsd===216000,'prior_lineage_mismatch');
 requireTrue(budget.reservedRequests===10&&budget.reservedMicroUsd===220500&&budget.ownerCumulativeMaximumMicroUsd===2000000,'prior_budget_mismatch');
 requireTrue(reservation.runId==='40413365240'&&reservation.priorPaidRequests===9&&reservation.oneShot===true,'prior_reservation_mismatch');
 return Object.freeze({paidRequests:10,reservedMicroUsd:220500,completedRun:40413365240});
}
export function verifyFixtures(files){
 const expected=Object.fromEntries(FIXTURES.map(f=>[f.name,f.sha256]));verifyFileHashes(files,expected);
 for(const f of FIXTURES)requireTrue(files[f.name].byteLength===f.bytes,'fixture_size_mismatch');
 requireTrue(FIXTURES.length===9&&new Set(FIXTURES.map(f=>f.format)).size===9,'fixture_case_count');
 return true;
}
export function verifyClosedHistory({runs,totalCount,observedAt,activeCiPaidJobs},now=Date.now()){
 requireTrue(Number.isSafeInteger(now)&&Number.isSafeInteger(observedAt)&&now>=observedAt&&now-observedAt<=60000,'history_stale');
 requireTrue(totalCount===PLAN.closedHistoryCount&&Array.isArray(runs)&&runs.length===totalCount,'history_incomplete_or_new_run');
 requireTrue(Array.isArray(activeCiPaidJobs)&&activeCiPaidJobs.length===0,'ci_paid_state_ambiguous');
 const rows=runs.map(r=>({id:r.id,path:r.path,head:r.head_sha,event:r.event,attempt:r.run_attempt,status:r.status,conclusion:r.conclusion})).sort((a,b)=>a.id-b.id);
 requireTrue(new Set(rows.map(r=>r.id)).size===rows.length&&rows.every(r=>r.status==='completed'&&r.event==='workflow_dispatch'),'history_active_or_duplicate');
 requireTrue(hash(JSON.stringify(rows))===PLAN.closedHistorySha256,'history_changed');return true;
}
export function proposal(priorProof){
 assert.deepEqual(priorProof,{paidRequests:10,reservedMicroUsd:220500,completedRun:40413365240});
 requireTrue(FIXTURES.reduce((total,f)=>total+f.reservationMicroUsd,0)===PLAN.additionalMicroUsd,'cost_sum_mismatch');
 requireTrue(PLAN.previousRequests+PLAN.additionalRequests===PLAN.maximumRequests,'request_sum_mismatch');
 requireTrue(PLAN.previousReservedMicroUsd+PLAN.additionalMicroUsd===PLAN.maximumMicroUsd&&PLAN.maximumMicroUsd<=PLAN.ownerCeilingMicroUsd,'spend_ceiling_exceeded');
 return Object.freeze({schema:'cosmic-request-admission-proposal-1',campaign:PLAN.campaign,state:'PROPOSAL_NOT_RESERVED',
  previousRequests:10,additionalRequests:9,maximumRequests:19,previousReservedMicroUsd:220500,
  additionalMicroUsd:216000,maximumMicroUsd:436500,ownerCeilingMicroUsd:2000000,automaticRetries:0,
  slots:Object.freeze(FIXTURES.map((f,index)=>Object.freeze({slot:index+11,format:f.format,model:f.model,maximumMicroUsd:f.reservationMicroUsd}))),
  fullAcceptance:false,releaseReady:false,genuineMacSafariValidated:false});
}
// Deliberately non-executable until actual staging pins + durable accounting
// integration are reviewed. A proposal is NEVER a reservation or paid permit.
// No injected `ready`, `verified`, `pins`, changed max, or fake run can enable it.
export function admitExecution(_context){
 requireTrue(Object.values(EXECUTION_PINS).every(value=>typeof value==='string'&&value.length>0),'execution_evidence_unpinned');
 fail('durable_admission_workflow_not_integrated');
}
