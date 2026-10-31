import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PLAN,FIXTURES,EXECUTION_READINESS,verifyFileHashes,verifyCompletedPrior,verifyClosedHistory,proposal,admitExecution} from '../../scripts/staging-source-admission.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('exact proposal adds nine slots without clearing ten consumed slots',()=>{
 const p=proposal({paidRequests:10,reservedMicroUsd:220500,completedRun:40413365240});
 assert.equal(p.state,'PROPOSAL_NOT_RESERVED');assert.equal(p.maximumRequests,19);assert.equal(p.maximumMicroUsd,436500);
 assert.deepEqual(p.slots.map(s=>s.slot),[11,12,13,14,15,16,17,18,19]);assert.equal(p.automaticRetries,0);
 assert.equal(p.fullAcceptance,false);assert.equal(p.releaseReady,false);assert.equal(p.genuineMacSafariValidated,false);
});
for(const [name,patch]of Object.entries({reset:{paidRequests:0},wrongCount:{paidRequests:9},missingSpend:{reservedMicroUsd:0},increasedCeiling:{ownerCeilingMicroUsd:9000000},unknownCompletion:{completedRun:1}})){
 test('prior proposal rejects '+name,()=>assert.throws(()=>proposal({...{paidRequests:10,reservedMicroUsd:220500,completedRun:40413365240},...patch})));
}
test('plan and exact nine fixture entries are immutable',()=>{
 assert.equal(FIXTURES.length,9);assert.equal(FIXTURES.filter(f=>f.model==='gpt-transcribe').length,8);assert.equal(FIXTURES.filter(f=>f.model==='gpt-4o-transcribe-diarize').length,1);
 assert.throws(()=>{PLAN.additionalRequests=10;});assert.throws(()=>{FIXTURES[0].reservationMicroUsd=0;});
 assert.equal(FIXTURES.reduce((sum,f)=>sum+f.reservationMicroUsd,0),216000);
});
test('generic byte proof accepts only exact keys, bytes and digest',()=>{
 const b=Buffer.from('synthetic harmless proof'),expected={'proof.json':sha(b)};
 assert.equal(verifyFileHashes({'proof.json':b},expected),true);
 for(const input of [{},{'proof.json':b,extra:b},{'proof.json':Buffer.from('tampered')},{'proof.json':'not bytes'}])assert.throws(()=>verifyFileHashes(input,expected));
});
test('prior admission rejects user asserted success, raw JSON and incomplete evidence',()=>{
 for(const input of [{status:'PASS',paidRequests:10},{'receipt.json':Buffer.from('{"status":"PASS","attempted":0}')},null])assert.throws(()=>verifyCompletedPrior(input));
});
test('partial/new/duplicate/active/stale/unknown history never permits admission',()=>{
 const validShape={runs:[],totalCount:21,observedAt:1000,activeCiPaidJobs:[]};
 for(const patch of [{},{totalCount:0},{totalCount:22},{observedAt:1001},{observedAt:-60000},{activeCiPaidJobs:[{status:'queued'}]},{activeCiPaidJobs:null},
  {runs:Array.from({length:21},()=>({id:1,status:'completed',event:'workflow_dispatch'}))},
  {runs:Array.from({length:21},(_,id)=>({id,status:'in_progress',event:'workflow_dispatch'}))},
  {runs:Array.from({length:21},(_,id)=>({id,status:'completed',event:'workflow_dispatch',head_sha:'f'.repeat(40)}))}])assert.throws(()=>verifyClosedHistory({...validShape,...patch},1000));
});
test('execution remains blocked even with forged guard/ready/pin/approval input',()=>{
 assert.equal(EXECUTION_READINESS.enabled,false);assert.equal(EXECUTION_READINESS.missing.length,5);
 for(const c of [undefined,{}, {ready:true,verified:true,approval:true,pins:{deploymentVersion:'fake'},maximumRequests:999,paidRequests:0}, {history:{complete:true},guardReceipt:{status:'PASS'},deploymentReceipt:{source:PLAN.source}}]){
  assert.throws(()=>admitExecution(c),e=>e.code==='execution_evidence_unpinned');
 }
});
