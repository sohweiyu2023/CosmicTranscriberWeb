import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PLAN} from '../../scripts/staging-source-admission.mjs';
import {readOfficialManualHistoryComponent,verifyPlannedManualClosureComponent,readOfficialCiHistoryComponent,verifyAccountingHistoryComponents} from '../../scripts/staging-source-history.mjs';
const head='a'.repeat(40),secret='synthetic-private-github-token';
const json=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
function fixture({change}={}){
 const rows=Array.from({length:PLAN.closedHistoryCount+1},(_,i)=>({id:i+1,path:'.github/workflows/'+(i===PLAN.closedHistoryCount?'staging-source-acceptance':'staging-access-diagnostic')+'.yml',head_sha:head,event:'workflow_dispatch',run_attempt:i===0?2:1,head_branch:'main',status:i===PLAN.closedHistoryCount?'in_progress':'completed',conclusion:i===PLAN.closedHistoryCount?null:'success'}));
 const calls=[];let lists=0;
 const fetchImpl=async(url,options)=>{
  calls.push(url);assert.ok(url.startsWith('https://api.github.com/repos/sohweiyu2023/CosmicTranscriberWeb/'));assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+secret);
  const u=new URL(url);let out;
  if(u.pathname.endsWith('/actions/runs')){lists++;out={total_count:rows.length,workflow_runs:rows.map(r=>({...r}))}}
  else{const match=u.pathname.match(/\/runs\/(\d+)(?:\/attempts\/(\d+))?(\/jobs)?$/);assert.ok(match);const row=rows.find(r=>r.id===Number(match[1]));assert.ok(row);const attempt=Number(match[2]||row.run_attempt);
   out=match[3]?{total_count:1,jobs:[{id:row.id*100+attempt,run_id:row.id,run_attempt:attempt,runner_id:1,status:row.status,conclusion:row.conclusion,name:secret,steps:[{name:secret,number:1,status:row.status,conclusion:row.conclusion,started_at:'2026-10-31T00:00:00Z',completed_at:row.status==='completed'?'2026-10-31T00:00:01Z':null}]}]}:{...row,run_attempt:attempt};
  }
  return change?.({url,out,lists,rows})||json(out);
 };
 return {calls,fetchImpl};
}
const read=f=>readOfficialManualHistoryComponent({token:secret,currentRunId:PLAN.closedHistoryCount+1,coordinatorHead:head,fetchImpl:f.fetchImpl});
test('read-only snapshot binds every manual run/attempt/job and omits arbitrary names and credentials',async()=>{
 const f=fixture(),s=await read(f);assert.equal(s.totalCount,22);assert.equal(s.runs[0].attempts.length,2);assert.equal(s.completeManualAttemptMetadata,true);assert.equal(s.ciPaidHistoryVerified,false);assert.equal(s.admission,false);assert.equal(JSON.stringify(s).includes(secret),false);assert.equal(s.requests,f.calls.length);assert.ok(Object.isFrozen(s.runs[0].attempts[0].jobs[0].steps));
 assert.throws(()=>verifyPlannedManualClosureComponent(s),{code:'history_plan_changed'});assert.throws(()=>verifyPlannedManualClosureComponent({...s}),{code:'history_official_snapshot_required'});
});
test('partial pagination, new runs, duplicate rows and a concurrent change fail closed',async()=>{
 for(const change of [({out})=>{if(out.workflow_runs)out.workflow_runs.pop();return json(out)},({out})=>{if(out.workflow_runs)out.total_count++;return json(out)},({out})=>{if(out.workflow_runs)out.workflow_runs[1]=out.workflow_runs[0];return json(out)},({out,lists})=>{if(out.workflow_runs&&lists===2)out.workflow_runs[0].conclusion='failure';return json(out)}])await assert.rejects(read(fixture({change})));
});
test('every-attempt metadata rejects missing, active, foreign or wrong job/step evidence',async()=>{
 for(const change of [({url,out})=>{if(url.endsWith('/attempts/1'))out.id=999;return json(out)},({out})=>{if(out.jobs)out.jobs[0].run_attempt=999;return json(out)},({out})=>{if(out.jobs)delete out.jobs[0].steps;return json(out)},({out})=>{if(out.jobs)out.jobs[0].steps.push(out.jobs[0].steps[0]);return json(out)},({url,out})=>{if(url.endsWith('/attempts/1')){out.status='in_progress';out.conclusion=null}return json(out)}])await assert.rejects(read(fixture({change})));
});
test('HTTP, malformed/HTML, interrupted and oversized responses retain only fixed error codes',async()=>{
 for(const response of [()=>new Response(secret,{status:403}),()=>new Response('<html>'+secret+'</html>',{headers:{'content-type':'text/html'}}),()=>new Response(secret,{headers:{'content-type':'application/json'}}),()=>new Response(new ReadableStream({start(c){c.error(Error(secret))}}),{headers:{'content-type':'application/json'}}),()=>new Response(' '.repeat(2000001),{headers:{'content-type':'application/json'}})])await assert.rejects(readOfficialManualHistoryComponent({token:secret,currentRunId:22,coordinatorHead:head,fetchImpl:async()=>response()}),e=>e.code.startsWith('history_')&&!e.message.includes(secret));
 await assert.rejects(readOfficialManualHistoryComponent({token:secret,currentRunId:22,coordinatorHead:head,fetchImpl:async()=>{throw Error(secret)}}),{code:'history_network_failed'});
});

test('explicit null runners are preserved for queued/skipped metadata without zero-execution authority',async()=>{
 const f=fixture({change:({out})=>{if(out.jobs){const j=out.jobs[0];j.runner_id=null;j.steps=[];if(j.status==='completed')j.conclusion='skipped';else{j.status='queued';j.conclusion=null}}return json(out)}});const s=await read(f);assert.equal(s.runs[0].attempts[0].jobs[0].runnerId,null);assert.equal(s.runs.at(-1).attempts[0].jobs[0].status,'queued');assert.equal(s.providerExecutionSemanticsVerified,false);assert.equal(s.admission,false);
 await assert.rejects(read(fixture({change:({out})=>{if(out.jobs)delete out.jobs[0].runner_id;return json(out)}})),{code:'history_job_metadata_missing'});
 await assert.rejects(read(fixture({change:({out})=>{if(out.jobs&&out.jobs[0].run_id===1){out.jobs[0].status='in_progress';out.jobs[0].conclusion=null}return json(out)}})),{code:'history_job_active'});
});

test('rejected HTTP bodies are cancelled without reading and explicit status survives safely',async()=>{
 let cancelled=0;const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('synthetic-private-error-body'))},cancel(){cancelled++}});await assert.rejects(readOfficialManualHistoryComponent({token:secret,currentRunId:22,coordinatorHead:head,fetchImpl:async()=>new Response(stream,{status:403})}),e=>e.code==='history_http_rejected'&&e.httpStatus===403&&!e.message.includes('private'));assert.equal(cancelled,1);
});

async function ciFixture({change}={}){
 const historical=JSON.parse(await readFile(new URL('../fixtures/historical-ci/cancelled-40169170360.json',import.meta.url),'utf8'));
 const main={id:900000001,path:'.github/workflows/ci.yml',head_sha:head,head_branch:'main',event:'push',run_attempt:1,status:'completed',conclusion:'success'};
 const older={...main,id:900000002,head_sha:'b'.repeat(40),head_branch:'synthetic-review',event:'pull_request',run_attempt:2};
 const license={...main,id:900000003,path:'.github/workflows/licensing.yml'};const rows=[main,older,license,historical.run];let lists=0;
 const fetchImpl=async(url,options)=>{
  assert.ok(url.startsWith('https://api.github.com/repos/sohweiyu2023/CosmicTranscriberWeb/'));assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+secret);let out;
  if(url.includes('/actions/runs?created=')){lists++;out={total_count:rows.length,workflow_runs:structuredClone(rows)}}
  else if(url.includes('/git/blobs/'))out={sha:historical.workflow.sha,encoding:'base64',content:Buffer.from(historical.workflow.content).toString('base64')};
  else if(url.includes('/artifacts?'))out={total_count:historical.artifacts.length,artifacts:structuredClone(historical.artifacts)};
  else{
   const m=url.match(/\/runs\/(\d+)\/attempts\/(\d+)(\/jobs)?/);assert.ok(m);const r=rows.find(r=>r.id===Number(m[1]));assert.ok(r);const attempt=Number(m[2]);
   if(m[3]){const jobs=r.id===historical.run.id?structuredClone(historical.jobs):[{id:r.id*10+attempt,run_id:r.id,run_attempt:attempt,head_sha:r.head_sha,name:'Actual authenticated STAGING paid nine-format acceptance',status:'completed',conclusion:'skipped',runner_id:null,runner_name:null,steps:[]}];out={total_count:jobs.length,jobs}}
   else out={...r,run_attempt:attempt,conclusion:r.id===older.id&&attempt===1?'failure':r.conclusion};
  }
  return change?.({url,out,lists,historical})||json(out);
 };
 return {fetchImpl};
}
async function pinnedManualSnapshot(){
 const current={id:99999999999,path:'.github/workflows/staging-source-acceptance.yml',head_sha:head,event:'workflow_dispatch',run_attempt:1,status:'in_progress',conclusion:null};
 const rows=[...pinnedManualRows,current];
 return readOfficialManualHistoryComponent({token:secret,currentRunId:current.id,coordinatorHead:head,fetchImpl:async(url)=>{
  if(url.includes('/actions/runs?'))return json({total_count:rows.length,workflow_runs:rows});
  const m=url.match(/\/runs\/(\d+)(?:\/attempts\/(\d+))?(\/jobs)?/);assert.ok(m);const row=rows.find(r=>r.id===Number(m[1]));assert.ok(row);
  if(m[3])return json({total_count:0,jobs:[]});return json({...row,head_branch:'main',run_attempt:Number(m[2]||row.run_attempt)});
 }});
}
test('complete CI attempt history and the exact cancelled proof combine with the pinned manual closure',async()=>{
 const f=await ciFixture(),ci=await readOfficialCiHistoryComponent({token:secret,coordinatorHead:head,fetchImpl:f.fetchImpl});assert.equal(ci.ciRunCount,3);assert.equal(ci.attemptCount,4);assert.equal(ci.exactCancelledZeroProof.paidAttempts,0);assert.equal(ci.additionalCiPaidAttempts,0);assert.equal(JSON.stringify(ci).includes(secret),false);
 const manual=await pinnedManualSnapshot(),combined=verifyAccountingHistoryComponents(manual,ci);assert.equal(combined.manualRuns,21);assert.equal(combined.ciPaidHistoryVerified,true);assert.equal(combined.admission,false);assert.equal(combined.reservationCreated,false);
 assert.throws(()=>verifyAccountingHistoryComponents(manual,{...ci}),{code:'history_official_ci_snapshot_required'});
});
test('CI verification rejects missing jobs, unreviewed cancellations, altered exact proofs and main-gate failures',async()=>{
 for(const change of [({out})=>{if(out.jobs&&out.jobs.length===1){out.jobs=[];out.total_count=0}return json(out)},({out})=>{if(out.jobs&&out.jobs.length===1)out.jobs[0].conclusion='cancelled';return json(out)},({out})=>{if(out.jobs&&out.jobs.length>1)out.jobs.find(j=>j.id===121115802392).runner_id=0;return json(out)},({url,out})=>{if(url.includes('/artifacts?')){out.artifacts.pop();out.total_count--}return json(out)},({out})=>{if(out.encoding)out.sha='f'.repeat(40);return json(out)},({out})=>{if(out.workflow_runs)out.workflow_runs.find(r=>r.path.endsWith('licensing.yml')).conclusion='failure';return json(out)}]){
  const f=await ciFixture({change});await assert.rejects(readOfficialCiHistoryComponent({token:secret,coordinatorHead:head,fetchImpl:f.fetchImpl}));
 }
});
test('future timestamps and spoofed history-prefixed stream errors cannot weaken freshness or leak messages',async t=>{
 const manual=await pinnedManualSnapshot();t.mock.method(Date,'now',()=>manual.observedAt-1);assert.throws(()=>verifyPlannedManualClosureComponent(manual),{code:'history_stale'});t.mock.restoreAll();
 const error=Object.assign(Error('synthetic-private-message'),{code:'history_synthetic_private_code'});
 await assert.rejects(readOfficialManualHistoryComponent({token:secret,currentRunId:22,coordinatorHead:head,fetchImpl:async()=>new Response(new ReadableStream({start(c){c.error(error)}}),{headers:{'content-type':'application/json'}})}),e=>e.code==='history_read_failed'&&!e.message.includes('private'));
});

test('a skipped label cannot conceal allocated runners, executed steps or active historical steps',async()=>{
 for(const [patch,code] of [[j=>{j.runner_id=123},'history_ci_skipped_execution_ambiguous'],[j=>{j.steps=[{number:1,name:'synthetic dispatch',status:'completed',conclusion:'success',started_at:'2026-10-31T00:00:00Z',completed_at:'2026-10-31T00:00:01Z'}]},'history_ci_skipped_execution_ambiguous'],[j=>{j.steps=[{number:1,name:'synthetic pending',status:'in_progress',conclusion:null,started_at:'2026-10-31T00:00:00Z',completed_at:null}]},'history_job_active']]){
  const f=await ciFixture({change:({out})=>{if(out.jobs?.length===1)patch(out.jobs[0]);return json(out)}});await assert.rejects(readOfficialCiHistoryComponent({token:secret,coordinatorHead:head,fetchImpl:f.fetchImpl}),{code});
 }
});

// Public historical metadata matching the compiled closure; all HTTP below is mocked.
const pinnedManualRows=[{"id":40413365240,"path":".github/workflows/staging-single-mp3-smoke.yml","head_sha":"0046d0eb33ac5b1eafd41b0df4985148011e436e","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"success"},{"id":40359451856,"path":".github/workflows/staging-access-diagnostic.yml","head_sha":"b6bb26f698dc143468bb34c8b7133ab8ce5b4e9a","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"success"},{"id":40346887705,"path":".github/workflows/staging-access-diagnostic.yml","head_sha":"b6bb26f698dc143468bb34c8b7133ab8ce5b4e9a","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"failure"},{"id":40336352549,"path":".github/workflows/staging-single-mp3-smoke.yml","head_sha":"b6bb26f698dc143468bb34c8b7133ab8ce5b4e9a","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"failure"},{"id":40245143343,"path":".github/workflows/staging-single-mp3-smoke.yml","head_sha":"d6d749889f9735f4c27dbdcb4164fb3656a8253a","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"failure"},{"id":40244805708,"path":".github/workflows/staging-access-diagnostic.yml","head_sha":"d6d749889f9735f4c27dbdcb4164fb3656a8253a","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"success"},{"id":40200059681,"path":".github/workflows/staging-remaining-eight.yml","head_sha":"cdac98f1745d7515277309bbf83465e634a33ec4","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"success"},{"id":40165437742,"path":".github/workflows/staging-access-diagnostic.yml","head_sha":"813e66aea0a334c62d3dba0f634fc9ff70ca4310","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"success"},{"id":40162223424,"path":".github/workflows/staging-access-diagnostic.yml","head_sha":"813e66aea0a334c62d3dba0f634fc9ff70ca4310","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"failure"},{"id":40161696792,"path":".github/workflows/staging-remaining-eight.yml","head_sha":"813e66aea0a334c62d3dba0f634fc9ff70ca4310","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"failure"},{"id":40113556242,"path":".github/workflows/staging-remaining-eight.yml","head_sha":"da0acbc46e4973488887bebc9dd49972376c34da","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"failure"},{"id":40063452013,"path":".github/workflows/staging-deploy-only.yml","head_sha":"728b42283b4252f2a125e4c4b5bf56c22989e3ae","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"success"},{"id":39979683866,"path":".github/workflows/staging-single-mp3-smoke.yml","head_sha":"4c5fe43fa3ab0d61da021080a497146b122d0e56","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"success"},{"id":39945096462,"path":".github/workflows/staging-deploy-only.yml","head_sha":"77f6eae267c14ceaf2343807bb7adcafcc89d421","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"success"},{"id":39944542795,"path":".github/workflows/staging-access-diagnostic.yml","head_sha":"77f6eae267c14ceaf2343807bb7adcafcc89d421","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"success"},{"id":39942504565,"path":".github/workflows/staging-access-diagnostic.yml","head_sha":"77f6eae267c14ceaf2343807bb7adcafcc89d421","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"failure"},{"id":39940783139,"path":".github/workflows/staging-access-diagnostic.yml","head_sha":"77f6eae267c14ceaf2343807bb7adcafcc89d421","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"failure"},{"id":39902562182,"path":".github/workflows/staging-access-diagnostic.yml","head_sha":"77f6eae267c14ceaf2343807bb7adcafcc89d421","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"failure"},{"id":39891678701,"path":".github/workflows/staging-deploy-only.yml","head_sha":"ab961dce46ce9fd85dbe80730f7063365aff1b3a","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"failure"},{"id":31360694914,"path":".github/workflows/certify.yml","head_sha":"cb2251b0647ed711c4f87d2324609b8e20b5fec6","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"failure"},{"id":31359129934,"path":".github/workflows/certify.yml","head_sha":"4bbd8614499bca220b8a68e6d59cc8fbc5d0601d","event":"workflow_dispatch","run_attempt":1,"status":"completed","conclusion":"failure"}];
