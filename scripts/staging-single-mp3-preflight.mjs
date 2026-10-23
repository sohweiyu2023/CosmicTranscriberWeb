// Read-only remote checks and conservative reservation for ONE approved smoke.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {reserveBudget} from './staging-single-mp3-smoke.mjs';
export const PIN=Object.freeze({repo:'sohweiyu2023/CosmicTranscriberWeb',source:'82392336cfea5bc417098a2c6e3066dafca97b5b',deployRun:39945096462,deployHead:'77f6eae267c14ceaf2343807bb7adcafcc89d421',version:'fdbfa10f-d2bb-4c22-bb32-90e6bb522ab7',worker:'cosmic-transcriber-web-staging',origin:'https://transcriber-staging.awakeningtoreality.com',workflow:'staging-single-mp3-smoke.yml',approval:'Sentinel_c2c095975b008191b6e4af85864f70eb',since:'2026-10-22T00:00:00Z'});
const MESSAGE='Source82392336cfea5bc417098a2c6e3066dafca97b5b CI39872658149 artifact12468047768';
export function verifyIdentity(env){
 assert.equal(env.GITHUB_REPOSITORY,PIN.repo);assert.equal(env.GITHUB_REF,'refs/heads/main');
 assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
 assert.equal(env.GITHUB_WORKFLOW,'One approved STAGING MP3 smoke ONLY');
 assert.equal(env.COSMIC_SMOKE_AUTHORIZATION,'one-mp3-with-existing-staging-secrets');
 for(const key of ['GITHUB_RUN_ID','FIXTURE_RUN_ID','FIXTURE_ARTIFACT_ID'])assert.match(env[key]||'',/^[1-9][0-9]{0,19}$/);
}
export function verifyHistory(smokeRuns,ciRuns,jobs,currentRun){
 assert.ok(smokeRuns.some(x=>String(x.id)===String(currentRun)),'Current reservation run missing');
 // Even a prior cancelled/preflight-failed run consumes this smoke permission.
 // Do not infer zero billing from failure or erase an ambiguous reservation.
 assert.equal(smokeRuns.filter(x=>String(x.id)!==String(currentRun)).length,0,'Prior smoke run requires accounting review');
 for(const run of smokeRuns)assert.equal(run.run_attempt,1,'Rerun reservation is forbidden');
 for(const run of ciRuns){assert.equal(run.status,'completed','Concurrent CI could contain paid work');assert.equal(run.run_attempt,1,'Prior CI rerun requires accounting review')}
 for(const run of ciRuns){
  const paid=jobs.filter(job=>job.run_id===run.id&&job.name==='Actual authenticated STAGING paid nine-format acceptance');
  assert.equal(paid.length,1,'Missing/duplicate paid-job accounting requires review');
  assert.equal(paid[0].conclusion,'skipped','Earlier paid-capable job requires accounting review');
 }
 return {schema:'cosmic-approved-paid-budget-1',approval:PIN.approval,maximumRequests:9,maximumMicroUsd:250000,reservedRequests:0,reservedMicroUsd:0};
}
export function verifyDeployment(run,jobs,deployments){
 assert.equal(run.id,PIN.deployRun);assert.equal(run.head_sha,PIN.deployHead);assert.equal(run.event,'workflow_dispatch');assert.equal(run.head_branch,'main');assert.equal(run.run_attempt,1);assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
 const job=jobs.find(x=>x.name==='deploy');assert.equal(job?.conclusion,'success');
 for(const name of ['Verify exact successful CI/licensing and certified artifact','Record newly deployed staging version','Recheck authenticated Access protection after deployment'])assert.equal(job.steps?.find(x=>x.name===name)?.conclusion,'success');
 assert.ok(Array.isArray(deployments)&&deployments.length>0);
 for(const d of deployments)assert.ok(Number.isFinite(Date.parse(d.created_on)));
 const latest=deployments.toSorted((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on))[0];
 assert.equal(latest.versions?.length,1);assert.equal(latest.versions[0].percentage,100);assert.equal(latest.versions[0].version_id,PIN.version);
 assert.equal(latest.annotations?.['workers/message'],MESSAGE);
 return {schema:'cosmic-verified-staging-source-1',origin:PIN.origin,commit:PIN.source,workerVersionId:PIN.version,deploymentRun:PIN.deployRun,verified:true,checkedAtUtc:new Date().toISOString(),verification:'GitHub successful pinned deployment and current Cloudflare deployment GET',releaseReady:false};
}
async function getJson(url,token,fetchImpl=fetch){
 const allowed=new Set(['api.github.com','api.cloudflare.com']);const target=new URL(url);assert.equal(target.protocol,'https:');assert.ok(allowed.has(target.hostname));assert.ok(token);
 const response=await fetchImpl(target,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json','User-Agent':'Cosmic-staging-smoke-preflight'},redirect:'error',signal:AbortSignal.timeout(30000)});
 assert.equal(response.ok,true);assert.equal(response.headers.get('content-type')?.split(';')[0].trim(),'application/json');
 const reader=response.body.getReader();const parts=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;assert.ok(bytes<=4_000_000);parts.push(Buffer.from(value))}}finally{try{await reader.cancel()}catch{}reader.releaseLock()}
 return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
// Bounded pagination fails closed rather than silently ignoring older attempts.
export async function collectPages(get,route,key){
 const all=[];for(let page=1;page<=20;page++){
  const data=await get(route+(route.includes('?')?'&':'?')+'per_page=100&page='+page);assert.ok(Number.isSafeInteger(data.total_count)&&data.total_count>=0);
  const items=data[key];assert.ok(Array.isArray(items)&&items.length<=100);all.push(...items);
  if(all.length===data.total_count)return all;
  assert.ok(all.length<data.total_count&&items.length===100,'Incomplete accounting history');
 }assert.fail('Accounting history exceeds bounded pagination');
}
async function main(){
 let phase='identity';try{
  const env=process.env;verifyIdentity(env);assert.ok(['prepare','source'].includes(process.argv[2]));
  const output=path.resolve(env.COSMIC_SMOKE_EVIDENCE);await mkdir(output,{recursive:true});
  const gh=route=>getJson('https://api.github.com/repos/'+PIN.repo+route,env.GH_TOKEN);
  phase='history';
  const smoke=await collectPages(gh,'/actions/workflows/'+PIN.workflow+'/runs','workflow_runs');
  const ci=await collectPages(gh,'/actions/workflows/ci.yml/runs?created='+encodeURIComponent('>='+PIN.since),'workflow_runs');
  const jobs=[];for(const run of ci)jobs.push(...await collectPages(gh,'/actions/runs/'+run.id+'/jobs?filter=all','jobs'));
  const ledger=verifyHistory(smoke,ci,jobs,env.GITHUB_RUN_ID);
  if(process.argv[2]==='prepare'){
   phase='fixture-artifact';const artifacts=await collectPages(gh,'/actions/runs/'+env.FIXTURE_RUN_ID+'/artifacts','artifacts');
   const artifact=artifacts.find(x=>String(x.id)===env.FIXTURE_ARTIFACT_ID);
   assert.equal(artifact?.name,'cosmic-approved-single-mp3-fixture');assert.equal(artifact.expired,false);assert.ok(artifact.size_in_bytes>0&&artifact.size_in_bytes<300000);
   await writeFile(path.join(output,'budget.json'),JSON.stringify(ledger)+'\n',{flag:'wx'});
   await writeFile(path.join(output,'reservation.json'),JSON.stringify({...reserveBudget(ledger),runId:env.GITHUB_RUN_ID,remainingRequests:8,fullAcceptance:false,releaseReady:false})+'\n',{flag:'wx'});
  }else{
   phase='deployed-source';assert.match(env.CLOUDFLARE_ACCOUNT_ID||'',/^[a-f0-9]{32}$/i);
   const run=await gh('/actions/runs/'+PIN.deployRun),deployJobs=await collectPages(gh,'/actions/runs/'+PIN.deployRun+'/jobs','jobs');
   const cf=await getJson('https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID+'/workers/scripts/'+PIN.worker+'/deployments',env.CLOUDFLARE_API_TOKEN);
   assert.equal(cf.success,true);const receipt=verifyDeployment(run,deployJobs,cf.result?.deployments);
   await writeFile(path.join(output,'source.json'),JSON.stringify(receipt)+'\n',{flag:'wx'});
  }
  console.log(JSON.stringify({status:'PASS',phase,paidRequests:0,releaseReady:false}));
 }catch{console.log(JSON.stringify({status:'FAIL',phase,code:'preflight_rejected',paidRequests:0,releaseReady:false}));process.exitCode=1}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
