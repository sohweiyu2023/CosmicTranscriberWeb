// Reviewed one-shot final MP3 accounting/source gates; no transcription API.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectPages} from './staging-single-mp3-preflight.mjs';
import {readPreflightJson,collectRunAttemptJobs,verifySource} from './staging-remaining-eight-preflight.mjs';
import {POLICY,APPROVED_DEPLOYMENT,ZERO_PAID_ATTEMPT,RESERVED_ZERO_ATTEMPT} from './staging-remaining-eight-policy.mjs';
import {CANCELLED_CI_PIN} from './staging-cancelled-ci-proof.mjs';
import {FINAL_MP3,FINAL_MP3_ZERO,verifyFinalFixtureArtifact,verifyCompletedEight,reserveFinalMp3,verifyFinalHistory} from './staging-final-mp3-policy.mjs';
export function verifyFinalIdentity(env){
 assert.equal(env.GITHUB_REPOSITORY,POLICY.repo);assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
 assert.equal(env.GITHUB_WORKFLOW,'One approved STAGING MP3 smoke ONLY');assert.equal(env.COSMIC_SMOKE_AUTHORIZATION,FINAL_MP3.authorization);
 assert.match(env.GITHUB_RUN_ID||'',/^[1-9][0-9]{0,19}$/);assert.match(env.GITHUB_SHA||'',/^[a-f0-9]{40}$/);
 assert.equal(env.FIXTURE_RUN_ID,String(FINAL_MP3.fixtureRun));assert.equal(env.FIXTURE_ARTIFACT_ID,String(FINAL_MP3.fixtureArtifact));
}
export function verifyCoordinatorGates(runs,sha){
 for(const workflow of ['ci.yml','licensing.yml']){const matching=runs.filter(r=>r.path==='.github/workflows/'+workflow&&r.head_sha===sha&&r.head_branch==='main'&&r.event==='push');assert.ok(matching.length>0);assert.ok(matching.every(r=>r.status==='completed'&&r.conclusion==='success'));}
}
export async function readFour(dir){const files=Object.create(null);for(const e of await readdir(dir,{withFileTypes:true})){assert.equal(e.isFile(),true);files[e.name]=await readFile(path.join(dir,e.name));}return files;}
async function main(){let phase='identity';try{
 const env=process.env;verifyFinalIdentity(env);assert.ok(['prepare','source'].includes(process.argv[2]));
 const output=path.resolve(env.COSMIC_SMOKE_EVIDENCE);await mkdir(output,{recursive:true});
 const gh=route=>readPreflightJson('https://api.github.com/repos/'+POLICY.repo+route,env.GH_TOKEN);
 phase='fresh-main';const branch=await gh('/branches/main');assert.equal(branch.commit?.sha,env.GITHUB_SHA);
 phase='coordinator-gates';verifyCoordinatorGates(await collectPages(gh,'/actions/runs?head_sha='+env.GITHUB_SHA+'&event=push','workflow_runs'),env.GITHUB_SHA);
 phase='history';const smoke=await collectPages(gh,'/actions/workflows/staging-single-mp3-smoke.yml/runs','workflow_runs');
 const remaining=await collectPages(gh,'/actions/workflows/staging-remaining-eight.yml/runs','workflow_runs');
 const ci=await collectPages(gh,'/actions/workflows/ci.yml/runs?created='+encodeURIComponent('>=2026-10-22T00:00:00Z'),'workflow_runs');
 const current=smoke.filter(r=>String(r.id)===env.GITHUB_RUN_ID);assert.equal(current.length,1);assert.equal(current[0].head_sha,env.GITHUB_SHA);
 phase='attempt-jobs';const jobs={};for(const run of [...smoke,...remaining,...ci])jobs[run.id]=await collectRunAttemptJobs(gh,run);
 phase='prior-eight-proof';const eightFiles=await readFour(path.join(env.RUNNER_TEMP,'completed-eight'));
 const eightRun=remaining.find(r=>r.id===FINAL_MP3.run),eightArtifacts=await collectPages(gh,'/actions/runs/'+FINAL_MP3.run+'/artifacts','artifacts');
 const proof=verifyCompletedEight(eightRun,jobs[FINAL_MP3.run],eightArtifacts,eightFiles);
 const heldFiles=await readFour(path.join(env.RUNNER_TEMP,'prior-eight-zero'));
 const heldArtifacts=await collectPages(gh,'/actions/runs/'+RESERVED_ZERO_ATTEMPT.id+'/artifacts','artifacts');
 const zeroArtifacts={};for(const run of remaining)if(run.id===ZERO_PAID_ATTEMPT.id)zeroArtifacts[run.id]=await collectPages(gh,'/actions/runs/'+run.id+'/artifacts','artifacts');
 const cancelledEvidence={};if(ci.some(r=>r.id===CANCELLED_CI_PIN.run)){
  const blob=await gh('/contents/.github/workflows/ci.yml?ref='+CANCELLED_CI_PIN.head);assert.equal(blob.encoding,'base64');assert.equal(blob.sha,CANCELLED_CI_PIN.workflowBlob);assert.ok(typeof blob.content==='string'&&blob.content.length<100000);
  cancelledEvidence[CANCELLED_CI_PIN.run]={workflow:{sha:blob.sha,content:Buffer.from(blob.content,'base64').toString('utf8')},artifacts:await collectPages(gh,'/actions/runs/'+CANCELLED_CI_PIN.run+'/artifacts','artifacts')};
 }
 phase='final-zero-proof';const workflowBlobs={};for(const [name,sha]of Object.entries(FINAL_MP3_ZERO.blobs)){const blob=await gh('/contents/'+name+'?ref='+FINAL_MP3_ZERO.head);assert.equal(blob.sha,sha);workflowBlobs[name]=blob.sha;}
 const finalZeroEvidence={workflowBlobs,artifacts:await collectPages(gh,'/actions/runs/'+FINAL_MP3_ZERO.run+'/artifacts','artifacts')};
 phase='accounting';verifyFinalHistory(smoke,remaining,ci,jobs,env.GITHUB_RUN_ID,zeroArtifacts,{artifacts:heldArtifacts,files:heldFiles},cancelledEvidence,proof,finalZeroEvidence);
 const prior=await readFour(path.join(env.RUNNER_TEMP,'prior-mp3'));
 const planned=reserveFinalMp3(prior,proof,env.GITHUB_RUN_ID);
 if(process.argv[2]==='prepare'){
  phase='fixed-fixture-artifact';const artifacts=await collectPages(gh,'/actions/runs/'+FINAL_MP3.fixtureRun+'/artifacts','artifacts');
  verifyFinalFixtureArtifact(artifacts);
  await writeFile(path.join(output,'budget.json'),JSON.stringify(planned.budget)+'\n',{flag:'wx'});
  await writeFile(path.join(output,'reservation.json'),JSON.stringify(planned.reservation)+'\n',{flag:'wx'});
  await writeFile(path.join(output,'lineage.json'),JSON.stringify(proof)+'\n',{flag:'wx'});
 }else{
  phase='deployed-source';assert.match(env.CLOUDFLARE_ACCOUNT_ID||'',/^[a-f0-9]{32}$/i);
  const pin=APPROVED_DEPLOYMENT,run=await gh('/actions/runs/'+pin.run),deployJobs=await collectPages(gh,'/actions/runs/'+pin.run+'/jobs','jobs');
  const sourceCi=await gh('/actions/runs/'+pin.ciRun),licensing=await gh('/actions/runs/'+pin.licensingRun);
  const cf=await readPreflightJson('https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID+'/workers/scripts/'+POLICY.worker+'/deployments',env.CLOUDFLARE_API_TOKEN);assert.equal(cf.success,true);
  await writeFile(path.join(output,'source.json'),JSON.stringify(verifySource(run,deployJobs,sourceCi,licensing,cf.result?.deployments))+'\n',{flag:'wx'});
 }
 console.log(JSON.stringify({status:'PASS',phase,paidRequests:0,releaseReady:false}));
 }catch{console.log(JSON.stringify({status:'FAIL',phase,code:'final_preflight_rejected',paidRequests:0,releaseReady:false}));process.exitCode=1}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
