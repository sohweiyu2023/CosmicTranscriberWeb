import {verifyHistory,POLICY} from '../../scripts/staging-remaining-eight-policy.mjs';
import {safePreflightCode} from '../../scripts/staging-remaining-eight-preflight.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyExactNeverStartedCancelledCi} from '../../scripts/staging-cancelled-ci-proof.mjs';
const original=JSON.parse(await readFile(new URL('../fixtures/historical-ci/cancelled-40169170360.json',import.meta.url)));
test('exact authenticated GitHub snapshot plus original workflow blob establishes zero job execution',()=>{
 const proof=verifyExactNeverStartedCancelledCi(structuredClone(original));
 assert.equal(proof.paidAttempts,0);assert.equal(proof.additionalReservedRequests,0);assert.equal(proof.additionalReservationMicroUsd,0);
});
test('unknown/rerun/nonterminal/wrong-branch or changed workflow cannot qualify',()=>{
 for(const mutate of [p=>p.run.id++,p=>p.run.head_sha='a'.repeat(40),p=>p.run.head_branch='ci/v1.2.0-production-readiness',p=>p.run.event='workflow_dispatch',p=>p.run.run_attempt=2,p=>p.run.status='in_progress',p=>p.run.conclusion='failure',p=>p.workflow.sha='0'.repeat(40),p=>p.workflow.content+='\n']){
  const p=structuredClone(original);mutate(p);assert.throws(()=>verifyExactNeverStartedCancelledCi(p),e=>e.code==='history_ci_cancelled_zero_invalid');
 }
});
test('started cancelled jobs, hidden setup/provider steps and ambiguous runner records fail closed',()=>{
 for(const id of [121115802392,121115801750])for(const mutate of [j=>j.id++,j=>j.run_id++,j=>j.run_attempt=2,j=>j.status='queued',j=>j.runner_id=123,j=>j.runner_name='runner',j=>delete j.runner_id,j=>j.steps=[{name:'Set up job',status:'completed',conclusion:'cancelled'}],j=>j.steps=[{name:'provider attempt',status:'completed',conclusion:'success'}],j=>j.conclusion='success']){
  const p=structuredClone(original);mutate(p.jobs.find(j=>j.id===id));assert.throws(()=>verifyExactNeverStartedCancelledCi(p));
 }
});
test('partial/duplicate/additional attempt history or changed artifact inventory fails closed',()=>{
 for(const mutate of [p=>p.jobs.pop(),p=>p.jobs.push(p.jobs[0]),p=>p.jobs[0].run_attempt=2,p=>p.jobs[0].steps.pop(),p=>p.artifacts.pop(),p=>p.artifacts[0].digest='sha256:'+'0'.repeat(64),p=>p.artifacts.push({id:1,name:'paid-receipt',digest:'sha256:unknown'})]){
  const p=structuredClone(original);mutate(p);assert.throws(()=>verifyExactNeverStartedCancelledCi(p));
 }
});


test('API ordering differences do not alter exact complete evidence',()=>{
 const p=structuredClone(original);p.jobs.reverse();p.artifacts.reverse();
 assert.equal(verifyExactNeverStartedCancelledCi(p).paidAttempts,0);
});

test('complete accounting admits only exact never-started proof and preserves rejection for other cancelled jobs',()=>{
 const current={id:90000000001,run_attempt:1};
 const smoke=[{id:POLICY.priorRun,event:'workflow_dispatch',run_attempt:1,status:'completed',conclusion:'success'}];
 const p=structuredClone(original),proof={[p.run.id]:{artifacts:p.artifacts,workflow:p.workflow}};
 const call=(run=p.run,jobs=p.jobs,evidence=proof)=>verifyHistory(smoke,[current],[run],{[run.id]:jobs},current.id,{},undefined,evidence);
 assert.equal(call(),true);
 assert.throws(()=>call(p.run,p.jobs,{}),e=>e.code==='history_ci_cancelled_zero_invalid');
 const started=structuredClone(p.jobs);started.find(j=>j.id===121115802392).runner_id=7;
 assert.throws(()=>call(p.run,started));
 const override={[p.run.id]:{...proof[p.run.id],run:p.run,jobs:p.jobs}};
 assert.throws(()=>call(p.run,started,override));
 assert.throws(()=>call({...p.run,id:40169170361},p.jobs));
 assert.throws(()=>call({...p.run,run_attempt:2},p.jobs));
 assert.throws(()=>call({...p.run,status:'in_progress'},p.jobs));
 const skipped=p.jobs.map(j=>j.id===121115802392?{...j,conclusion:'skipped'}:j);
 assert.equal(call({...p.run,id:90000000002},skipped,{}),true);
 const error=Error('Exact cancelled CI zero-execution evidence requires review');error.code='history_ci_cancelled_zero_invalid';
 assert.equal(safePreflightCode(error),'history_ci_cancelled_zero_invalid');
});
