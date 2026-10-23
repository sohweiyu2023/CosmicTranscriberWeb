// Read-only receipt/accounting/source gates; never calls a transcription API.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectPages} from './staging-single-mp3-preflight.mjs';
import {POLICY,APPROVED_DEPLOYMENT,requireReviewedDeployment,verifyPriorSmoke,reserveRemaining,verifyHistory} from './staging-remaining-eight-policy.mjs';
async function getJson(url,token,fetchImpl=fetch){
 const allowed=new Set(['api.github.com','api.cloudflare.com']);const target=new URL(url);assert.equal(target.protocol,'https:');assert.ok(allowed.has(target.hostname));assert.ok(token);
 const response=await fetchImpl(target,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json','User-Agent':'Cosmic-staging-smoke-preflight'},redirect:'error',signal:AbortSignal.timeout(30000)});
 assert.equal(response.ok,true);assert.equal(response.headers.get('content-type')?.split(';')[0].trim(),'application/json');
 const reader=response.body.getReader();const parts=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;assert.ok(bytes<=4_000_000);parts.push(Buffer.from(value))}}finally{try{await reader.cancel()}catch{}reader.releaseLock()}
 return JSON.parse(Buffer.concat(parts).toString('utf8'));
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
 const gh=route=>getJson('https://api.github.com/repos/'+POLICY.repo+route,env.GH_TOKEN);
 phase='accounting';
 const smoke=await collectPages(gh,'/actions/workflows/staging-single-mp3-smoke.yml/runs','workflow_runs');
 const remaining=await collectPages(gh,'/actions/workflows/'+POLICY.workflow+'/runs','workflow_runs');
 const ci=await collectPages(gh,'/actions/workflows/ci.yml/runs?created='+encodeURIComponent('>=2026-10-22T00:00:00Z'),'workflow_runs');
 const lists={};for(const run of [...smoke,...remaining,...ci])lists[run.id]=await collectPages(gh,'/actions/runs/'+run.id+'/jobs?filter=all','jobs');
 verifyHistory(smoke,remaining,ci,lists,env.GITHUB_RUN_ID);
 if(process.argv[2]==='prepare'){
  phase='prior-smoke';const files=Object.create(null);for(const e of await readdir(path.join(env.RUNNER_TEMP,'prior-mp3'),{withFileTypes:true})){assert.equal(e.isFile(),true);files[e.name]=await readFile(path.join(env.RUNNER_TEMP,'prior-mp3',e.name));}
  const ledger=reserveRemaining(verifyPriorSmoke(files));
  phase='fixture-artifact';const artifacts=await collectPages(gh,'/actions/runs/'+env.FIXTURE_RUN_ID+'/artifacts','artifacts');
  const artifact=artifacts.find(x=>String(x.id)===env.FIXTURE_ARTIFACT_ID);assert.equal(artifact?.name,'cosmic-approved-remaining-eight-fixtures');assert.equal(artifact.expired,false);assert.ok(artifact.size_in_bytes>0&&artifact.size_in_bytes<2000000);
  await writeFile(path.join(output,'budget.json'),JSON.stringify(ledger)+'\n',{flag:'wx'});
  await writeFile(path.join(output,'reservation.json'),JSON.stringify({...ledger,runId:env.GITHUB_RUN_ID,remainingRequests:0,priorSmokeRun:POLICY.priorRun,fullAcceptance:false,releaseReady:false})+'\n',{flag:'wx'});
 }else{
  phase='deployed-source';assert.match(env.CLOUDFLARE_ACCOUNT_ID||'',/^[a-f0-9]{32}$/i);
  const pin=APPROVED_DEPLOYMENT,run=await gh('/actions/runs/'+pin.run),jobs=await collectPages(gh,'/actions/runs/'+pin.run+'/jobs','jobs');
  const ci=await gh('/actions/runs/'+pin.ciRun),licensing=await gh('/actions/runs/'+pin.licensingRun);
  const cf=await getJson('https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID+'/workers/scripts/'+POLICY.worker+'/deployments',env.CLOUDFLARE_API_TOKEN);assert.equal(cf.success,true);
  await writeFile(path.join(output,'source.json'),JSON.stringify(verifySource(run,jobs,ci,licensing,cf.result?.deployments))+'\n',{flag:'wx'});
 }
 console.log(JSON.stringify({status:'PASS',phase,paidRequests:0,releaseReady:false}));
 }catch{console.log(JSON.stringify({status:'FAIL',phase,code:'preflight_rejected',paidRequests:0,releaseReady:false}));process.exitCode=1}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
