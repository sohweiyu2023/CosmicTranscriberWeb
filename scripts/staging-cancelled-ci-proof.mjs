// Exact historical zero-execution proof; no blanket cancelled-job exception.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const CANCELLED_CI_PIN=Object.freeze({run:40169170360,head:'e88e30389e2c1f2ee3b08c72485989fa88e6bf17',paidJob:121115802392,deployJob:121115801750,workflowBlob:'220e4918806539097710909431f4353620504fa1',snapshotSha256:'4304ceeeb03d79fde0a631def06e94d0612281bd7bd1dd3931147f60e66c940a'});
function project(p){
 return {run:Object.fromEntries(['id','head_sha','head_branch','event','path','run_attempt','status','conclusion'].map(k=>[k,p.run[k]])),
 jobs:p.jobs.toSorted((a,b)=>a.id-b.id).map(j=>Object.fromEntries(['id','run_id','run_attempt','name','status','conclusion','runner_id','runner_name','steps'].map(k=>[k,j[k]]))),
 artifacts:p.artifacts.toSorted((a,b)=>a.id-b.id).map(a=>({...Object.fromEntries(['id','name','digest','size_in_bytes'].map(k=>[k,a[k]])),workflow_run:Object.fromEntries(['id','repository_id','head_repository_id','head_branch','head_sha'].map(k=>[k,a.workflow_run?.[k]]))}))};
}
export function verifyExactNeverStartedCancelledCi(p){
 try{
  const pin=CANCELLED_CI_PIN,run=p.run;
  assert.deepEqual(project(p).run,{id:pin.run,head_sha:pin.head,head_branch:'main',event:'push',path:'.github/workflows/ci.yml',run_attempt:1,status:'completed',conclusion:'cancelled'});
  const bytes=Buffer.from(p.workflow.content,'utf8');
  const gitBlob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  assert.equal(p.workflow.sha,pin.workflowBlob);assert.equal(gitBlob,pin.workflowBlob);
  assert.equal(createHash('sha256').update(JSON.stringify(project(p))).digest('hex'),pin.snapshotSha256);
  assert.equal(p.jobs.length,8);assert.equal(new Set(p.jobs.map(j=>j.id)).size,8);
  for(const job of p.jobs){assert.equal(job.run_id,pin.run);assert.equal(job.run_attempt,1);assert.equal(job.status,'completed');}
  for(const [id,name] of [[pin.paidJob,'Actual authenticated STAGING paid nine-format acceptance'],[pin.deployJob,'Deploy exact staging-verified 1.2 ZIP to STAGING ONLY']]){
   const job=p.jobs.find(j=>j.id===id);assert.equal(job.name,name);assert.equal(job.conclusion,'cancelled');
   assert.equal(job.runner_id,null);assert.equal(job.runner_name,null);assert.deepEqual(job.steps,[]);
  }
  // Original workflow blob is content-bound above. Both job conditions require
  // a different branch, and paid execution additionally requires deploy success.
  return {schema:'cosmic-exact-cancelled-ci-zero-execution-1',runId:pin.run,attempt:1,source:pin.head,paidJobId:pin.paidJob,workflowBlob:pin.workflowBlob,paidAttempts:0,additionalReservedRequests:0,additionalReservationMicroUsd:0};
 }catch{const e=Error('Exact cancelled CI zero-execution evidence requires review');e.code='history_ci_cancelled_zero_invalid';throw e;}
}
