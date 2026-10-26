// Offline-only CLI integration transport. Every non-GitHub request rejects;
// no provider, Cloudflare, credential value or live run can be reached.
import {readFile} from 'node:fs/promises';
const load=async name=>JSON.parse(await readFile(new URL('../fixtures/historical-ci/'+name,import.meta.url),'utf8'));
const bundle=await load('final-mp3-lineage.json'),zero=await load('final-mp3-zero-attempt.json'),held=await load('held-final-mp3.json');
const current=Number(process.env.GITHUB_RUN_ID),sha=process.env.GITHUB_SHA,mode=process.env.COSMIC_PREFLIGHT_MOCK_MODE;
const old={id:39979683866,event:'workflow_dispatch',run_attempt:1,status:'completed',conclusion:'success'};
const now={id:current,event:'workflow_dispatch',head_branch:'main',run_attempt:1,path:'.github/workflows/staging-single-mp3-smoke.yml',head_sha:sha};
const ci={id:90000000010,path:'.github/workflows/ci.yml',head_sha:sha,head_branch:'main',event:'push',run_attempt:1,status:'completed',conclusion:'success'};
const licensing={...ci,id:90000000011,path:'.github/workflows/licensing.yml'};
const jobs={39979683866:[],[zero.run.id]:zero.jobs,[held.run.id]:held.jobs,[current]:[{id:90000000012,run_id:current,run_attempt:1}],
 [bundle.heldZero.run.id]:bundle.heldZero.jobs,[bundle.completedEight.run.id]:bundle.completedEight.jobs,
 [ci.id]:[{id:90000000013,run_id:ci.id,run_attempt:1,name:'Actual authenticated STAGING paid nine-format acceptance',status:'completed',conclusion:'skipped'}]};
jobs[90000000099]=[{id:90000000100,run_id:90000000099,run_attempt:1}];
const page=(key,items)=>({total_count:items.length,[key]:items});
globalThis.fetch=async input=>{
 const url=new URL(String(input));if(url.origin!=='https://api.github.com')throw Error('Offline preflight forbids non-GitHub requests');
 const route=url.pathname.replace('/repos/sohweiyu2023/CosmicTranscriberWeb','');let result;
 if(route==='/branches/main')result={commit:{sha}};
 else if(route==='/actions/runs')result=page('workflow_runs',[ci,licensing]);
 else if(route==='/actions/workflows/ci.yml/runs')result=page('workflow_runs',[ci]);
 else if(route==='/actions/workflows/staging-single-mp3-smoke.yml/runs')result=page('workflow_runs',[old,zero.run,held.run,now,...(mode==='extra-manual'?[{...now,id:90000000099}]:[])]);
 else if(route==='/actions/workflows/staging-remaining-eight.yml/runs')result=page('workflow_runs',[bundle.heldZero.run,bundle.completedEight.run]);
 else if(/^\/actions\/runs\/\d+\/attempts\/1\/jobs$/.test(route)){const id=Number(route.split('/')[3]);if(!Object.hasOwn(jobs,id))throw Error('Unknown offline job request');result=page('jobs',jobs[id]);}
 else if(/^\/actions\/runs\/\d+\/artifacts$/.test(route)){
  const id=Number(route.split('/')[3]);const map={[zero.run.id]:[],[held.run.id]:held.artifacts,[bundle.heldZero.run.id]:bundle.heldZero.artifacts,[bundle.completedEight.run.id]:bundle.completedEight.artifacts,40107978892:[{...zero.artifact,...(mode==='wrong-fixture'?{digest:'sha256:'+'0'.repeat(64)}:{})}]};
  if(!Object.hasOwn(map,id))throw Error('Unknown offline artifact request');result=page('artifacts',map[id]);
 }else if(route.startsWith('/contents/')){const proof=url.searchParams.get('ref')===zero.run.head_sha?zero:held;const name=route.slice('/contents/'.length);if(!Object.hasOwn(proof.workflowBlobs,name))throw Error('Unknown offline blob request');result={sha:proof.workflowBlobs[name]};}
 else throw Error('Unknown offline GitHub route');
 return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
};
