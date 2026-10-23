import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PIN,verifyIdentity,verifyHistory,verifyDeployment,collectPages} from '../../scripts/staging-single-mp3-preflight.mjs';
const identity=()=>({GITHUB_REPOSITORY:PIN.repo,GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW:'One approved STAGING MP3 smoke ONLY',COSMIC_SMOKE_AUTHORIZATION:'one-mp3-with-existing-staging-secrets',GITHUB_RUN_ID:'100',FIXTURE_RUN_ID:'50',FIXTURE_ARTIFACT_ID:'60'});
const jobName='Actual authenticated STAGING paid nine-format acceptance';
const deployment=()=>[{created_on:'2026-10-23T11:18:34Z',versions:[{percentage:100,version_id:PIN.version}],annotations:{'workers/message':'Source82392336cfea5bc417098a2c6e3066dafca97b5b CI39872658149 artifact12468047768'}}];
const run=()=>({id:PIN.deployRun,head_sha:PIN.deployHead,event:'workflow_dispatch',head_branch:'main',run_attempt:1,status:'completed',conclusion:'success'});
const jobs=()=>[{name:'deploy',conclusion:'success',steps:['Verify exact successful CI/licensing and certified artifact','Record newly deployed staging version','Recheck authenticated Access protection after deployment'].map(name=>({name,conclusion:'success'}))}];
test('manual identity refuses reruns, branch dispatch, other repository and injected input',()=>{
 assert.doesNotThrow(()=>verifyIdentity(identity()));
 for(const change of [{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_REF:'refs/heads/review/test'},{GITHUB_EVENT_NAME:'push'},{GITHUB_REPOSITORY:'other/repo'},{COSMIC_SMOKE_AUTHORIZATION:'refuse'},{FIXTURE_RUN_ID:'1;echo secret'}])assert.throws(()=>verifyIdentity({...identity(),...change}));
});
test('durable run-history accounting refuses prior/ambiguous paid attempts and concurrent CI',()=>{
 const smoke=[{id:100,run_attempt:1}],ci=[{id:20,status:'completed',run_attempt:1}],j=[{run_id:20,run_attempt:1,name:jobName,status:'completed',conclusion:'skipped'}];
 const ledger=verifyHistory(smoke,ci,j,100);assert.equal(ledger.maximumRequests,9);assert.equal(ledger.maximumMicroUsd,250000);assert.equal(ledger.reservedRequests,0);
 assert.throws(()=>verifyHistory([...smoke,{id:99,run_attempt:1}],ci,j,100));
 assert.throws(()=>verifyHistory([{id:100,run_attempt:2}],ci,j,100));
 assert.throws(()=>verifyHistory(smoke,[{...ci[0],status:'in_progress'}],j,100));
 assert.throws(()=>verifyHistory(smoke,ci,[],100));
 assert.throws(()=>verifyHistory(smoke,ci,[...j,...j],100));
 for(const conclusion of ['success','failure','cancelled',null])assert.throws(()=>verifyHistory(smoke,ci,[{...j[0],conclusion}],100));
});
test('historical CI reruns require an explicit skipped paid-job record for every attempt',()=>{
 const smoke=[{id:100,run_attempt:1}],ci=[{id:20,status:'completed',run_attempt:2}],j=[1,2].map(run_attempt=>({run_id:20,run_attempt,name:jobName,status:'completed',conclusion:'skipped'}));
 assert.equal(verifyHistory(smoke,ci,j,100).reservedRequests,0);
 assert.throws(()=>verifyHistory(smoke,ci,j.slice(1),100));
 assert.throws(()=>verifyHistory(smoke,ci,[j[0],j[0]],100));
 assert.throws(()=>verifyHistory(smoke,ci,[j[0],{...j[1],conclusion:'failure'}],100));
 assert.throws(()=>verifyHistory(smoke,ci,[j[0],{...j[1],status:'in_progress'}],100));
});
test('only completed non-manual validation failures with fully inspected zero-job history are exempt',()=>{
 const current={id:100,run_attempt:1};const old={id:99,run_attempt:1,event:'push',path:'.github/workflows/'+PIN.workflow,status:'completed',conclusion:'failure'};
 assert.equal(verifyHistory([old,current],[],[],100,{'99':[]}).reservedRequests,0);
 assert.throws(()=>verifyHistory([old,current],[],[],100));
 assert.throws(()=>verifyHistory([old,current],[],[],100,{'99':[{conclusion:'skipped'}]}));
 for(const change of [{event:'workflow_dispatch'},{conclusion:'success'},{status:'queued'},{path:'.github/workflows/other.yml'}])assert.throws(()=>verifyHistory([{...old,...change},current],[],[],100,{'99':[]}));
});
test('live source requires successful exact deployment, full traffic and matching source annotation',()=>{
 const receipt=verifyDeployment(run(),jobs(),deployment());assert.equal(receipt.commit,PIN.source);assert.equal(receipt.workerVersionId,PIN.version);assert.equal(receipt.verified,true);assert.ok(Date.now()-Date.parse(receipt.checkedAtUtc)<5000);
 for(const change of [{head_sha:'0'.repeat(40)},{run_attempt:2},{conclusion:'failure'}])assert.throws(()=>verifyDeployment({...run(),...change},jobs(),deployment()));
 const failed=jobs();failed[0].steps[2].conclusion='failure';assert.throws(()=>verifyDeployment(run(),failed,deployment()));
 for(const edit of [d=>d[0].versions[0].percentage=99,d=>d[0].versions[0].version_id='31808bae-7ca6-4a38-b13f-042959a192de',d=>d[0].annotations['workers/message']='Wrong source',d=>d[0].created_on='invalid',d=>d.push({...d[0],created_on:'2026-10-24T00:00:00Z',versions:[{percentage:100,version_id:'other'}]})]){const d=deployment();edit(d);assert.throws(()=>verifyDeployment(run(),jobs(),d))}
});
test('history pagination follows all pages and refuses missing or excessive history',async()=>{
 const calls=[];const all=await collectPages(async route=>{calls.push(route);return {total_count:101,jobs:Array.from({length:calls.length===1?100:1},(_,id)=>({id}))}},'/jobs?filter=all','jobs');assert.equal(all.length,101);assert.match(calls[1],/filter=all&per_page=100&page=2$/);
 await assert.rejects(()=>collectPages(async()=>({total_count:101,jobs:[{}]}),'/jobs','jobs'));
 let count=0;await assert.rejects(()=>collectPages(async()=>{count++;return {total_count:2001,jobs:Array(100).fill({})}},'/jobs','jobs'));assert.equal(count,20);
});
test('manual workflow has read-only permissions, pre-dispatch reservation, scoped secrets and no release successor',async()=>{
 const y=await readFile(new URL('../../.github/workflows/staging-single-mp3-smoke.yml',import.meta.url),'utf8');
 assert.match(y,/contents: read\n  actions: read/);assert.match(y,/cancel-in-progress: false/);
 const jobEnv=y.slice(y.indexOf('    env:\n'),y.indexOf('    steps:\n'));
 assert.equal(jobEnv.includes('${{ runner.'),false,'GitHub forbids runner context in job-level env');
 assert.match(jobEnv,/COSMIC_SMOKE_EVIDENCE: \$\{\{ github.workspace \}\}\/single-mp3-evidence/);
 assert.equal(y.includes('${{ runner.temp }}/single-mp3-evidence'),false,'All receipt paths must match job env');
 assert.ok(y.indexOf('reservation.json')<y.indexOf('One fixed MP3 request'));
 assert.ok(y.indexOf('verifyFixedMp3(await readFile')<y.indexOf('CLOUDFLARE_API_TOKEN:'));assert.match(y,/assert.equal\(entries.length,1\)/);
 assert.match(y,/COSMIC_SMOKE_SOURCE_ROOT:.*certified-source/);assert.match(y,/ref: 82392336cfea5bc417098a2c6e3066dafca97b5b/);
 assert.equal((y.match(/STAGING_OPENAI_API_KEY:/g)||[]).length,1);assert.match(y,/if-no-files-found: error/);
 for(const forbidden of ['deploy:','deploy:production','staging-live-acceptance.mjs','workflow_run:','pull_request:','push:','--retry','always-success'])assert.equal(y.includes(forbidden),false,forbidden);
});
