// Read-only receipt/accounting/source gates; never calls a transcription API.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectPages} from './staging-single-mp3-preflight.mjs';
import {POLICY,APPROVED_DEPLOYMENT,ZERO_PAID_ATTEMPT,RESERVED_ZERO_ATTEMPT,requireReviewedDeployment,verifyPriorSmoke,reconcileHeldEight,verifyReservedZeroAttempt,verifyHistory} from './staging-remaining-eight-policy.mjs';
const READ_CODES=new Set(['read_timeout','read_network','read_http','read_media_type','read_stream','read_oversized','read_json']);
const HISTORY_CODES=new Set(['history_attempt_jobs_invalid','history_zero_attempt_invalid','history_reserved_zero_invalid','history_reserved_zero_missing','history_smoke_dispatch_count','history_smoke_attempt','history_smoke_status','history_smoke_identity','history_smoke_result','history_smoke_unreviewed_manual','history_smoke_validation','history_smoke_validation_jobs','history_smoke_missing','history_current_run','history_remaining_attempt','history_remaining_unreviewed_manual','history_remaining_status','history_remaining_validation','history_remaining_validation_jobs','history_ci_active','history_ci_attempts','history_ci_paid_count','history_ci_paid_attempt','history_ci_paid_status','history_ci_paid_executed']);
export function safePreflightCode(error){const first=typeof error?.message==='string'?error.message.split('\n',1)[0]:'';return READ_CODES.has(error?.code)||HISTORY_CODES.has(error?.code)?error.code:HISTORY_CODES.has(first)?first:'preflight_rejected'}
function rejectRead(code,httpStatus){const error=Error('Preflight read rejected');error.code=code;if(Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599)error.httpStatus=httpStatus;throw error}
export async function readPreflightJson(url,token,fetchImpl=fetch){
 const allowed=new Set(['api.github.com','api.cloudflare.com']);const target=new URL(url);assert.equal(target.protocol,'https:');assert.ok(allowed.has(target.hostname));assert.ok(token);
 let response;try{response=await fetchImpl(target,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json','User-Agent':'Cosmic-staging-smoke-preflight'},redirect:'error',signal:AbortSignal.timeout(30000)})}catch(error){rejectRead(['TimeoutError','AbortError'].includes(error?.name)?'read_timeout':'read_network')}
 if(!response.ok)rejectRead('read_http',response.status);
 if(response.headers.get('content-type')?.split(';')[0].trim()!=='application/json')rejectRead('read_media_type');
 if(!response.body?.getReader)rejectRead('read_stream');
 const reader=response.body.getReader(),parts=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4_000_000)rejectRead('read_oversized');parts.push(Buffer.from(value))}}
 catch(error){if(READ_CODES.has(error?.code))throw error;rejectRead(['TimeoutError','AbortError'].includes(error?.name)?'read_timeout':'read_stream')}
 finally{try{await reader.cancel()}catch{}reader.releaseLock()}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{rejectRead('read_json')}
}
// Read every exact attempt, including zero-job validation attempts. Never fall
// back to latest-only jobs, skip an unreadable run, or retry provider requests.
export async function collectRunAttemptJobs(get,run){
 let activeAttempt=0;try{
  assert.ok(Number.isSafeInteger(run.id)&&run.id>0);assert.ok(Number.isSafeInteger(run.run_attempt)&&run.run_attempt>=1&&run.run_attempt<=20);
  const jobs=[],ids=new Set();
  for(let attempt=1;attempt<=run.run_attempt;attempt++){
   activeAttempt=attempt;
   const rows=await collectPages(get,'/actions/runs/'+run.id+'/attempts/'+attempt+'/jobs','jobs');
   for(const job of rows){assert.equal(job.run_id,run.id);assert.equal(job.run_attempt,attempt);assert.ok(Number.isSafeInteger(job.id)&&job.id>0&&!ids.has(job.id));ids.add(job.id);jobs.push(job)}
  }
  return jobs;
 }catch(error){
  const safe=Error('Attempt history requires review');safe.code=READ_CODES.has(error?.code)?error.code:'history_attempt_jobs_invalid';
  if(Number.isSafeInteger(run?.id)&&run.id>0)safe.historyRunId=run.id;
  if(activeAttempt>0&&activeAttempt<=20)safe.historyAttempt=activeAttempt;
  if(Number.isInteger(error?.httpStatus))safe.httpStatus=error.httpStatus;
  throw safe;
 }
}

export function verifyIdentity(env){
 assert.equal(env.GITHUB_REPOSITORY,POLICY.repo);assert.equal(env.GITHUB_REF,'refs/heads/main');
 assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
 assert.equal(env.GITHUB_WORKFLOW,'Remaining EIGHT approved STAGING formats ONLY');
 assert.equal(env.COSMIC_REMAINING_EIGHT_MODE,'remaining-eight-existing-approval');
 for(const k of ['GITHUB_RUN_ID','FIXTURE_RUN_ID','FIXTURE_ARTIFACT_ID'])assert.match(env[k]||'',/^[1-9][0-9]{0,19}$/);
}
export function verifySource(run,jobs,ci,licensing,deployments,pin=APPROVED_DEPLOYMENT){
 requireReviewedDeployment(pin);assert.equal(run.id,pin.run);assert.equal(run.head_sha,pin.head);
 assert.equal(run.event,'workflow_dispatch');assert.equal(run.head_branch,'main');assert.equal(run.run_attempt,1);
 assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
 const job=jobs.find(x=>x.name==='deploy');assert.equal(job?.conclusion,'success');
 for(const name of ['Verify exact successful CI/licensing and certified artifact','Record newly deployed staging version','Recheck authenticated Access protection after deployment'])assert.equal(job.steps?.find(x=>x.name===name)?.conclusion,'success');
 for(const proof of [ci,licensing]){assert.equal(proof.status,'completed');assert.equal(proof.conclusion,'success');assert.equal(proof.head_sha,pin.source);}
 assert.equal(ci.id,pin.ciRun);assert.equal(licensing.id,pin.licensingRun);
 assert.ok(Array.isArray(deployments)&&deployments.length>0);for(const x of deployments)assert.ok(Number.isFinite(Date.parse(x.created_on)));
 const latest=deployments.toSorted((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on))[0];
 assert.equal(latest.versions?.length,1);assert.equal(latest.versions[0].percentage,100);assert.equal(latest.versions[0].version_id,pin.version);
 assert.equal(latest.annotations?.['workers/message'],'Source'+pin.source+' CI'+pin.ciRun+' artifact'+pin.artifact);
 return {schema:'cosmic-verified-staging-source-1',origin:POLICY.origin,commit:pin.source,workerVersionId:pin.version,deploymentRun:pin.run,verified:true,checkedAtUtc:new Date().toISOString(),releaseReady:false};
}
async function main(){let phase='identity';try{
 const env=process.env;verifyIdentity(env);requireReviewedDeployment();
 assert.ok(['prepare','source'].includes(process.argv[2]));const output=path.resolve(env.COSMIC_EIGHT_EVIDENCE);await mkdir(output,{recursive:true});
 const gh=route=>readPreflightJson('https://api.github.com/repos/'+POLICY.repo+route,env.GH_TOKEN);
 phase='accounting';
 const smoke=await collectPages(gh,'/actions/workflows/staging-single-mp3-smoke.yml/runs','workflow_runs');
 const remaining=await collectPages(gh,'/actions/workflows/'+POLICY.workflow+'/runs','workflow_runs');
 const ci=await collectPages(gh,'/actions/workflows/ci.yml/runs?created='+encodeURIComponent('>=2026-10-22T00:00:00Z'),'workflow_runs');
 phase='accounting-jobs';
 const lists={};for(const run of [...smoke,...remaining,...ci])lists[run.id]=await collectRunAttemptJobs(gh,run);
 phase='accounting-zero-proof';const zeroArtifacts={};
 for(const run of remaining)if(run.id===ZERO_PAID_ATTEMPT.id&&String(run.id)!==env.GITHUB_RUN_ID)zeroArtifacts[run.id]=await collectPages(gh,'/actions/runs/'+run.id+'/artifacts','artifacts');
 phase='accounting-held-proof';const heldFiles=Object.create(null);
 for(const e of await readdir(path.join(env.RUNNER_TEMP,'prior-eight'),{withFileTypes:true})){assert.equal(e.isFile(),true);heldFiles[e.name]=await readFile(path.join(env.RUNNER_TEMP,'prior-eight',e.name));}
 const heldArtifacts=await collectPages(gh,'/actions/runs/'+RESERVED_ZERO_ATTEMPT.id+'/artifacts','artifacts');
 const heldRun=remaining.find(r=>r.id===RESERVED_ZERO_ATTEMPT.id);
 const heldProof=verifyReservedZeroAttempt(heldRun,lists[RESERVED_ZERO_ATTEMPT.id],heldArtifacts,heldFiles);
 phase='accounting-verify';verifyHistory(smoke,remaining,ci,lists,env.GITHUB_RUN_ID,zeroArtifacts,{artifacts:heldArtifacts,files:heldFiles});
 if(process.argv[2]==='prepare'){
  phase='prior-smoke';const files=Object.create(null);for(const e of await readdir(path.join(env.RUNNER_TEMP,'prior-mp3'),{withFileTypes:true})){assert.equal(e.isFile(),true);files[e.name]=await readFile(path.join(env.RUNNER_TEMP,'prior-mp3',e.name));}
  const {budget:ledger,reservation}=reconcileHeldEight(verifyPriorSmoke(files),heldProof,env.GITHUB_RUN_ID);
  phase='fixture-artifact';const artifacts=await collectPages(gh,'/actions/runs/'+env.FIXTURE_RUN_ID+'/artifacts','artifacts');
  const artifact=artifacts.find(x=>String(x.id)===env.FIXTURE_ARTIFACT_ID);assert.equal(artifact?.name,'cosmic-approved-remaining-eight-fixtures');assert.equal(artifact.expired,false);assert.ok(artifact.size_in_bytes>0&&artifact.size_in_bytes<2000000);
  await writeFile(path.join(output,'budget.json'),JSON.stringify(ledger)+'\n',{flag:'wx'});
  await writeFile(path.join(output,'reservation.json'),JSON.stringify(reservation)+'\n',{flag:'wx'});
 }else{
  phase='deployed-source';assert.match(env.CLOUDFLARE_ACCOUNT_ID||'',/^[a-f0-9]{32}$/i);
  const pin=APPROVED_DEPLOYMENT,run=await gh('/actions/runs/'+pin.run),jobs=await collectPages(gh,'/actions/runs/'+pin.run+'/jobs','jobs');
  const ci=await gh('/actions/runs/'+pin.ciRun),licensing=await gh('/actions/runs/'+pin.licensingRun);
  const cf=await readPreflightJson('https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID+'/workers/scripts/'+POLICY.worker+'/deployments',env.CLOUDFLARE_API_TOKEN);assert.equal(cf.success,true);
  await writeFile(path.join(output,'source.json'),JSON.stringify(verifySource(run,jobs,ci,licensing,cf.result?.deployments))+'\n',{flag:'wx'});
 }
 console.log(JSON.stringify({status:'PASS',phase,paidRequests:0,releaseReady:false}));
 }catch(error){
 const detail={};for(const key of ['historyRunId','historyAttempt','httpStatus'])if(Number.isSafeInteger(error?.[key]))detail[key]=error[key];
 console.log(JSON.stringify({status:'FAIL',phase,code:safePreflightCode(error),...detail,paidRequests:0,releaseReady:false}));process.exitCode=1}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
