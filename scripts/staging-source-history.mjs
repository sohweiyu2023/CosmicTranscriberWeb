// Read-only metadata component. Never an admission, billing or retry permit.
import {createHash} from 'node:crypto';
import {PLAN} from './staging-source-admission.mjs';
import {CANCELLED_CI_PIN,verifyExactNeverStartedCancelledCi} from './staging-cancelled-ci-proof.mjs';
const ownedFailures=new WeakSet();
const official=new WeakSet();
const officialCi=new WeakSet();
const repo='https://api.github.com/repos/sohweiyu2023/CosmicTranscriberWeb';
const currentPath='.github/workflows/staging-source-acceptance.yml';
const states=new Set(['queued','in_progress','completed','waiting','pending','requested']);
const conclusions=new Set(['success','failure','neutral','cancelled','skipped','timed_out','action_required','stale','startup_failure']);
const deny=(code,httpStatus=null)=>{const e=Error('Read-only history rejected');e.code=code;if(Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599)e.httpStatus=httpStatus;ownedFailures.add(e);throw e};
const need=(v,c)=>{if(!v)deny(c)};
const positive=n=>Number.isSafeInteger(n)&&n>0;
const sha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const frozen=v=>{if(v&&typeof v==='object'){for(const item of Object.values(v))frozen(item);Object.freeze(v)}return v};
function state(row){
 need(states.has(row?.status),'history_status_invalid');
 need(row.status==='completed'?conclusions.has(row.conclusion):row.conclusion===null,'history_conclusion_invalid');
 return {status:row.status,conclusion:row.conclusion};
}
function workflow(row){
 need(positive(row?.id)&&sha(row.head_sha)&&positive(row.run_attempt)&&row.run_attempt<=50,'history_run_invalid');
 need(typeof row.path==='string'&&/^\.github\/workflows\/[a-z0-9-]+\.ya?ml$/.test(row.path),'history_path_invalid');
 need(row.event==='workflow_dispatch','history_event_invalid');
 return {id:row.id,path:row.path,head_sha:row.head_sha,event:row.event,run_attempt:row.run_attempt,...state(row)};
}
function timestamp(value){if(value===null)return null;need(typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value)),'history_timestamp_invalid');return new Date(value).toISOString()}
function job(row,runId,attempt){
 need(positive(row?.id)&&row.run_id===runId&&row.run_attempt===attempt,'history_job_binding_invalid');
 need((row.runner_id===null||Number.isSafeInteger(row.runner_id)&&row.runner_id>=0)&&Array.isArray(row.steps)&&row.steps.length<=1000,'history_job_metadata_missing');
 const steps=row.steps.map(s=>{need(positive(s.number),'history_step_invalid');return {number:s.number,...state(s),startedAt:timestamp(s.started_at),completedAt:timestamp(s.completed_at)}});
 need(new Set(steps.map(s=>s.number)).size===steps.length,'history_step_duplicate');
 return {id:row.id,runId,attempt,...state(row),runnerId:row.runner_id,stepCount:steps.length,steps};
}
async function body(response){
 if(response.status!==200){try{await response.body?.cancel()}catch{};deny('history_http_rejected',response.status)}
 if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||'')){try{await response.body?.cancel()}catch{};deny('history_not_json',response.status)}
 const reader=response.body?.getReader();need(reader,'history_stream_missing');const chunks=[];let size=0,done=false;
 try{while(true){const item=await reader.read();if(item.done){done=true;break}need(item.value instanceof Uint8Array,'history_stream_invalid');size+=item.value.byteLength;need(size<=2000000,'history_response_oversized');chunks.push(Buffer.from(item.value))}}
 catch(error){if(ownedFailures.has(error))throw error;deny('history_read_failed')}
 finally{if(!done)try{await reader.cancel()}catch{};try{reader.releaseLock()}catch{}}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))}catch{deny('history_invalid_json')}
}
export async function readOfficialManualHistoryComponent({token,currentRunId,coordinatorHead,fetchImpl=fetch}){
 need(typeof token==='string'&&token.length>0&&positive(currentRunId)&&sha(coordinatorHead),'history_invocation_invalid');
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 const deadline=AbortSignal.timeout(120000);let requests=0;
 const get=async route=>{need(++requests<=1000,'history_request_limit');let response;try{response=await fetchImpl(repo+route,{method:'GET',headers,redirect:'error',signal:AbortSignal.any([deadline,AbortSignal.timeout(20000)])})}catch{deny('history_network_failed')}return body(response)};
 async function pages(route,key,maximum){
  const result=[];let total=null;
  for(let page=1;page<=100;page++){
   const value=await get(route+(route.includes('?')?'&':'?')+'per_page=100&page='+page);
   need(Number.isSafeInteger(value.total_count)&&value.total_count>=0&&value.total_count<=maximum&&Array.isArray(value[key])&&value[key].length<=100,'history_page_invalid');
   if(total===null)total=value.total_count;need(value.total_count===total,'history_page_drift');
   const remaining=total-result.length;need(value[key].length===Math.min(100,remaining),'history_page_incomplete');result.push(...value[key]);
   if(result.length===total){need(new Set(result.map(v=>v.id)).size===total,'history_page_duplicate');return result}
  }
  deny('history_page_limit');
 }
 const first=(await pages('/actions/runs?event=workflow_dispatch','workflow_runs',PLAN.closedHistoryCount+1)).map(workflow);
 need(first.length===PLAN.closedHistoryCount+1,'history_current_run_missing');
 const active=first.find(r=>r.id===currentRunId);need(active&&active.path===currentPath&&active.head_sha===coordinatorHead&&active.run_attempt===1&&active.status==='in_progress','history_current_run_invalid');
 const evidence=[];
 for(const run of first){
  const detail=await get('/actions/runs/'+run.id);need(detail.head_branch==='main'||run.id!==currentRunId,'history_current_branch_invalid');need(JSON.stringify(workflow(detail))===JSON.stringify(run),'history_run_drift');
  const attempts=[];
  for(let attempt=1;attempt<=run.run_attempt;attempt++){
   const raw=await get('/actions/runs/'+run.id+'/attempts/'+attempt),a=workflow(raw);
   need(a.id===run.id&&a.run_attempt===attempt&&a.path===run.path&&a.head_sha===run.head_sha,'history_attempt_binding_invalid');
   if(run.id!==currentRunId)need(a.status==='completed','history_attempt_active');
   const jobs=(await pages('/actions/runs/'+run.id+'/attempts/'+attempt+'/jobs','jobs',10000)).map(v=>job(v,run.id,attempt));
   if(run.id!==currentRunId)need(jobs.every(j=>j.status==='completed'&&j.steps.every(step=>step.status==='completed')),'history_job_active');
   attempts.push({attempt,...state(a),jobs});
  }
  evidence.push({...run,attempts});
 }
 // Re-list after all attempts so a concurrent submission or rerun fails closed.
 const final=(await pages('/actions/runs?event=workflow_dispatch','workflow_runs',PLAN.closedHistoryCount+1)).map(workflow);
 const canonical=rows=>JSON.stringify(rows.toSorted((a,b)=>a.id-b.id));need(canonical(first)===canonical(final),'history_changed_during_read');
 const result=frozen({schema:'cosmic-official-manual-history-component-1',observedAt:Date.now(),currentRunId,coordinatorHead,totalCount:first.length,requests,runs:evidence,completeManualAttemptMetadata:true,ciPaidHistoryVerified:false,providerExecutionSemanticsVerified:false,admission:false,automaticRetry:false,releaseReady:false});official.add(result);return result;
}
export function verifyPlannedManualClosureComponent(snapshot){
 need(official.has(snapshot),'history_official_snapshot_required');const age=Date.now()-snapshot.observedAt;need(age>=0&&age<=60000,'history_stale');
 const rows=snapshot.runs.filter(r=>r.id!==snapshot.currentRunId).map(r=>({id:r.id,path:r.path,head:r.head_sha,event:r.event,attempt:r.run_attempt,status:r.status,conclusion:r.conclusion})).toSorted((a,b)=>a.id-b.id);
 need(rows.length===PLAN.closedHistoryCount&&rows.every(r=>r.status==='completed'),'history_unclosed');
 need(createHash('sha256').update(JSON.stringify(rows)).digest('hex')===PLAN.closedHistorySha256,'history_plan_changed');
 return frozen({status:'MANUAL_CLOSURE_ONLY_NOT_ADMISSION',completeManualAttemptMetadata:true,ciPaidHistoryVerified:false,providerExecutionSemanticsVerified:false,admission:false,releaseReady:false});
}

// The same Oct22 boundary used by the accepted earlier accounting workflow.
// No skipped-attempt or general cancelled-job exception is added here.
export async function readOfficialCiHistoryComponent({token,coordinatorHead,fetchImpl=fetch}){
 need(typeof token==='string'&&token.length>0&&sha(coordinatorHead),'history_invocation_invalid');
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},deadline=AbortSignal.timeout(180000);let requests=0;
 const get=async route=>{need(++requests<=1500,'history_request_limit');let response;try{response=await fetchImpl(repo+route,{method:'GET',headers,redirect:'error',signal:AbortSignal.any([deadline,AbortSignal.timeout(20000)])})}catch{deny('history_network_failed')}return body(response)};
 async function pages(route,key,maximum=1000){
  const all=[];let total=null;
  for(let page=1;page<=100;page++){
   const value=await get(route+(route.includes('?')?'&':'?')+'per_page=100&page='+page);
   need(Number.isSafeInteger(value.total_count)&&value.total_count>=0&&value.total_count<=maximum&&Array.isArray(value[key])&&value[key].length<=100,'history_page_invalid');
   if(total===null)total=value.total_count;need(value.total_count===total,'history_page_drift');need(value[key].length===Math.min(100,total-all.length),'history_page_incomplete');all.push(...value[key]);
   if(all.length===total){need(new Set(all.map(v=>v.id)).size===total,'history_page_duplicate');return all}
  }
  deny('history_page_limit');
 }
 const route='/actions/runs?created='+encodeURIComponent('>=2026-10-22T00:00:00Z');
 const first=await pages(route,'workflow_runs');
 const ciRun=r=>{need(positive(r?.id)&&sha(r.head_sha)&&['push','pull_request','workflow_dispatch'].includes(r.event)&&positive(r.run_attempt)&&r.run_attempt<=20,'history_ci_run_invalid');need(r.path==='.github/workflows/ci.yml','history_ci_path_invalid');need(r.status==='completed','history_ci_active');return {id:r.id,head_sha:r.head_sha,head_branch:r.head_branch,event:r.event,path:r.path,run_attempt:r.run_attempt,...state(r)}};
 const runs=first.filter(r=>r.path==='.github/workflows/ci.yml').map(ciRun);need(runs.length>0,'history_ci_missing');
 for(const name of ['ci.yml','licensing.yml']){
  const matching=first.filter(r=>r.path==='.github/workflows/'+name&&r.head_sha===coordinatorHead&&r.head_branch==='main'&&r.event==='push');
  need(matching.length>0&&matching.every(r=>r.status==='completed'&&r.conclusion==='success'),'history_coordinator_gates_missing');
 }
 const work=runs.flatMap(run=>Array.from({length:run.run_attempt},(_,i)=>({run,attempt:i+1})));need(work.length*2+10<=1500,'history_request_limit');
 const checks=[];let zeroProof=null;
 for(let offset=0;offset<work.length;offset+=6){
  const settled=await Promise.allSettled(work.slice(offset,offset+6).map(async({run,attempt})=>{
   const base='/actions/runs/'+run.id+'/attempts/'+attempt;
   const [detail,jobs]=await Promise.all([get(base),pages(base+'/jobs','jobs',10000)]);
   const normalized=ciRun(detail);need(normalized.id===run.id&&normalized.head_sha===run.head_sha&&normalized.head_branch===run.head_branch&&normalized.event===run.event&&normalized.run_attempt===attempt,'history_attempt_binding_invalid');
   for(const raw of jobs){job(raw,run.id,attempt);need(raw.status==='completed'&&raw.steps.every(step=>step.status==='completed'),'history_job_active')}
   const paid=jobs.filter(j=>j.name==='Actual authenticated STAGING paid nine-format acceptance');need(paid.length===1,'history_ci_paid_job_missing');
   let proof=null;
   if(paid[0].conclusion==='skipped'){
    need((paid[0].runner_id===null||paid[0].runner_id===0)&&paid[0].steps.length===0,'history_ci_skipped_execution_ambiguous');
   }else{
    need(run.id===CANCELLED_CI_PIN.run&&attempt===1&&paid[0].conclusion==='cancelled','history_ci_paid_execution_or_uncertainty');
    const [blob,artifacts]=await Promise.all([get('/git/blobs/'+CANCELLED_CI_PIN.workflowBlob),pages('/actions/runs/'+run.id+'/artifacts','artifacts')]);
    need(blob.sha===CANCELLED_CI_PIN.workflowBlob&&blob.encoding==='base64'&&typeof blob.content==='string'&&blob.content.length<100000,'history_ci_zero_workflow_invalid');
    try{proof=verifyExactNeverStartedCancelledCi({run:detail,jobs,artifacts,workflow:{sha:blob.sha,content:Buffer.from(blob.content,'base64').toString('utf8')}})}catch{deny('history_ci_zero_invalid')}
   }
   return {runId:run.id,attempt,head:run.head_sha,jobCount:jobs.length,paidJobId:paid[0].id,paidConclusion:paid[0].conclusion,exactZeroProof:proof};
  }));
  // Inspect all results; never return a partially successful history witness.
  const rejected=settled.find(r=>r.status==='rejected');if(rejected)throw rejected.reason;
  for(const row of settled){checks.push(row.value);if(row.value.exactZeroProof){need(zeroProof===null,'history_ci_zero_duplicate');zeroProof=row.value.exactZeroProof}}
 }
 const confirmedAt=Date.now(),final=await pages(route,'workflow_runs');
 const project=rows=>JSON.stringify(rows.map(r=>({id:r.id,path:r.path,head:r.head_sha,branch:r.head_branch,event:r.event,attempt:r.run_attempt,status:r.status,conclusion:r.conclusion})).toSorted((a,b)=>a.id-b.id));
 need(project(first)===project(final),'history_changed_during_read');
 const result=frozen({schema:'cosmic-official-ci-paid-history-component-1',observedAt:confirmedAt,coordinatorHead,createdSince:'2026-10-22T00:00:00Z',repositoryRunCount:first.length,ciRunCount:runs.length,attemptCount:checks.length,requests,checks,exactCancelledZeroProof:zeroProof,additionalCiPaidAttempts:0,ciPaidHistoryVerified:true,admission:false,automaticRetry:false,releaseReady:false});officialCi.add(result);return result;
}
export function verifyAccountingHistoryComponents(manual,ci){
 verifyPlannedManualClosureComponent(manual);need(officialCi.has(ci),'history_official_ci_snapshot_required');const age=Date.now()-ci.observedAt;
 need(age>=0&&age<=60000&&ci.coordinatorHead===manual.coordinatorHead,'history_ci_stale_or_foreign');
 return frozen({status:'ACCOUNTING_COMPONENTS_ONLY_NOT_ADMISSION',manualRuns:manual.totalCount-1,ciRuns:ci.ciRunCount,ciAttempts:ci.attemptCount,additionalCiPaidAttempts:0,ciPaidHistoryVerified:true,admission:false,reservationCreated:false,automaticRetry:false,releaseReady:false});
}
