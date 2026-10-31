import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {crc32} from '../../scripts/zip-utils.mjs';
import {PLAN,FIXTURES,proposal,EXECUTION_READINESS} from '../../scripts/staging-source-admission.mjs';
import {createJournalEngine} from '../../scripts/staging-source-journal.mjs';
import {readSingleAdmissionZip,readOfficialEscrow,executeEscrowProtocolComponent,runSourceCampaign} from '../../scripts/staging-source-protocol.mjs';
import {assertSourceWorkflowIdentity} from '../../scripts/staging-source-coordinator.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),head='a'.repeat(40),blob='b'.repeat(40),version='11111111-2222-3333-4444-555555555555';
const proposed=()=>proposal({paidRequests:10,reservedMicroUsd:220500,completedRun:40413365240});
function zip(value,{name='admission.json',method=0}={}){
 const n=Buffer.from(name),raw=Buffer.from(value),packed=method===8?deflateRawSync(raw):raw,crc=crc32(raw),l=Buffer.alloc(30),c=Buffer.alloc(46),e=Buffer.alloc(22);
 l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(0x800,6);l.writeUInt16LE(method,8);l.writeUInt32LE(crc,14);l.writeUInt32LE(packed.length,18);l.writeUInt32LE(raw.length,22);l.writeUInt16LE(n.length,26);
 c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(method,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE((0o100644<<16)>>>0,38);
 e.writeUInt32LE(0x06054b50);e.writeUInt16LE(1,8);e.writeUInt16LE(1,10);e.writeUInt32LE(46+n.length,12);e.writeUInt32LE(30+n.length+packed.length,16);return Buffer.concat([l,n,packed,c,n,e]);
}
async function temporary(run){const root=await fs.mkdtemp(path.join(tmpdir(),'cosmic-protocol-test-'));try{return await run(root)}finally{await fs.rm(root,{recursive:true,force:true})}}
async function fixtureFiles(){const base=path.resolve(import.meta.dirname,'../fixtures'),out={};for(const f of FIXTURES)out[f.name]=await fs.readFile(path.join(base,f.format==='mp3'?'approved-single-mp3':'approved-remaining-eight',f.name));return out}
async function scenario(root,{mutate,redirect=false}={}){
 const producer=path.join(root,'producer');await fs.mkdir(producer);const engine=createJournalEngine();await engine.createLocalReservation(producer,proposed(),'123',1);const admission=await fs.readFile(path.join(producer,'admission.json')),archive=zip(admission);
 const run={id:123,run_attempt:1,event:'workflow_dispatch',head_branch:'main',head_sha:head,path:'.github/workflows/staging-source-acceptance.yml',status:'in_progress'};
 const artifact={id:456,name:'source-verification-reservation-'+PLAN.campaign,expired:false,digest:'sha256:'+hash(archive),workflow_run:{id:123,head_sha:head}};
 const data={run,artifact,main:{object:{sha:head}},definition:{sha:blob}};mutate?.(data);const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});if(url.startsWith('https://synthetic.blob.core.windows.net/')){assert.deepEqual(options.headers,{});return new Response(archive)}
  assert.ok(url.startsWith('https://api.github.com/repos/sohweiyu2023/CosmicTranscriberWeb/'));assert.equal(options.headers.Authorization,'Bearer synthetic-private-token');
  if(url.endsWith('/zip'))return redirect?new Response(null,{status:302,headers:{location:'https://synthetic.blob.core.windows.net/escrow?synthetic-read-capability'}}):new Response(archive);
  const value=url.includes('/contents/')?data.definition:url.endsWith('/git/ref/heads/main')?data.main:url.endsWith('/actions/runs/123')?data.run:data.artifact;
  return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
 };
 return {admission,archive,data,calls,fetchImpl,read:()=>readOfficialEscrow({runId:'123',artifactId:456,coordinatorHead:head,workflowBlob:blob,token:'synthetic-private-token',fetchImpl})};
}
test('one-entry ZIP handles stored/deflated bytes and rejects path/CRC/count/trailing/size attacks',()=>{
 const bytes=Buffer.from('{"synthetic":"escrow"}\n');for(const method of [0,8])assert.deepEqual(readSingleAdmissionZip(zip(bytes,{method})),bytes);
 const corrupt=zip(bytes);corrupt[30+'admission.json'.length]^=1;const multiple=zip(bytes);multiple.writeUInt16LE(2,multiple.length-12);
 for(const raw of [zip(bytes,{name:'../admission.json'}),corrupt,multiple,Buffer.concat([zip(bytes),Buffer.from('x')]),zip(Buffer.alloc(17000),{method:8}),Buffer.alloc(100)])assert.throws(()=>readSingleAdmissionZip(raw),{code:'escrow_archive_invalid'});
});
test('official witness is current run/main/workflow/digest bound; storage gets no API authorization',async()=>temporary(async root=>{
 const s=await scenario(root,{redirect:true}),w=await s.read();assert.deepEqual(w.admissionBytes,s.admission);const exposed=w.admissionBytes;exposed.fill(0);assert.deepEqual(w.admissionBytes,s.admission);assert.equal(w.artifact.runId,'123');assert.equal(w.archiveSha256,hash(s.archive));assert.equal(JSON.stringify({...w,admissionBytes:undefined}).includes('synthetic-private-token'),false);assert.equal(s.calls.length,6);
}));
test('expired/foreign/rerun/completed/main-drift/digest evidence never becomes an official witness',async()=>{
 for(const mutate of [d=>d.artifact.expired=true,d=>d.artifact.workflow_run.id=999,d=>d.run.run_attempt=2,d=>d.run.status='completed',d=>d.main.object.sha='c'.repeat(40),d=>d.definition.sha='c'.repeat(40),d=>d.artifact.digest='sha256:'+'c'.repeat(64)])await temporary(async root=>{const s=await scenario(root,{mutate});await assert.rejects(s.read())});
});
test('untrusted download redirect and malformed API bodies are rejected without token disclosure',async()=>{
 const options={runId:'123',artifactId:456,coordinatorHead:head,workflowBlob:blob,token:'synthetic-private-token'};
 for(const response of [()=>new Response('synthetic-private-token',{status:403}),()=>new Response('synthetic-private-token',{headers:{'content-type':'text/html'}})])await assert.rejects(readOfficialEscrow({...options,fetchImpl:async()=>response()}),e=>!e.message.includes('synthetic-private-token'));
 await temporary(async root=>{const s=await scenario(root);await assert.rejects(readOfficialEscrow({...options,fetchImpl:(url,o)=>url.endsWith('/zip')?new Response(null,{status:302,headers:{location:'https://evil.example/secret'}}):s.fetchImpl(url,o)}),{code:'escrow_download_location'})});
});
test('mock protocol owns all nine exact claims, retains complete budget and cannot repeat fixed directory',async()=>temporary(async root=>{
 const s=await scenario(root),witness=await s.read(),files=await fixtureFiles();let calls=0,forgot=0;
 const options={workspace:root,witness,proposalValue:proposed(),fixtureFiles:files,expectedDeploymentVersion:version,guard:async()=>({source:PLAN.source,artifact:PLAN.artifact,version,byokConfigured:true,principalActive:true}),prepareSession:async()=>({configured:true,principalActive:true}),dispatch:async({claim,fixture,bytes})=>{assert.equal(claim.slot,11+calls++);assert.equal(hash(bytes),fixture.sha256);return {accepted:true,requestIdPresent:true}},forgetSession:async()=>{forgot++;return {forgotten:true}}};
 const result=await executeEscrowProtocolComponent(options);assert.equal(result.status,'PROTOCOL_COMPLETED_NOT_ADMISSION');assert.equal(calls,9);assert.equal(forgot,1);assert.equal(result.journal.reservedRequests,19);assert.equal(result.journal.reservedMicroUsd,436500);assert.equal(result.journal.successes,9);assert.equal(result.fullAcceptance,false);assert.equal(result.releaseReady,false);assert.equal((await fs.readFile(path.join(result.directory,'protocol-outcome.json'),'utf8')).includes(root),false);
 await assert.rejects(executeEscrowProtocolComponent(options),{code:'execution_directory_exists'});assert.equal(calls,9);
}));
test('uncertain mock dispatch stops once, retains all remaining slots and forgets session',async()=>temporary(async root=>{
 const s=await scenario(root);let calls=0,forgot=0;const result=await executeEscrowProtocolComponent({workspace:root,witness:await s.read(),proposalValue:proposed(),fixtureFiles:await fixtureFiles(),expectedDeploymentVersion:version,guard:async()=>({source:PLAN.source,artifact:PLAN.artifact,version,byokConfigured:true,principalActive:true}),prepareSession:async()=>({configured:true,principalActive:true}),dispatch:async()=>{if(++calls===2)throw Error('synthetic-private-provider-body');return {accepted:true,requestIdPresent:true}},forgetSession:async()=>{forgot++;return {forgotten:true}}});
 assert.equal(calls,2);assert.equal(forgot,1);assert.equal(result.status,'STOPPED');assert.equal(result.code,'dispatch_outcome_unknown');assert.equal(result.journal.successes,1);assert.equal(result.journal.reservedMicroUsd,436500);assert.equal(result.reservationReleased,false);assert.equal(JSON.stringify(result).includes('synthetic-private-provider-body'),false);
}));
test('forged witness and caller ready flags cannot activate production path',async()=>{
 await assert.rejects(executeEscrowProtocolComponent({witness:{verified:true}}),{code:'official_escrow_required'});
 let touched=0;await assert.rejects(runSourceCampaign({ready:true,verified:true,pins:{everything:true}},{dispatch:()=>{touched++}}),{code:'execution_evidence_unpinned'});assert.equal(touched,0);assert.equal(EXECUTION_READINESS.enabled,false);
});
test('preparation CLI stays blocked before network/reservation; workflow has one execute and late provider secrets',async()=>temporary(async directory=>{
 const env={...process.env,GITHUB_REPOSITORY:'sohweiyu2023/CosmicTranscriberWeb',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW:'Bounded exact-source staging verification',GITHUB_SHA:head,GITHUB_RUN_ID:'123',SOURCE_AUTHORIZATION:'nine-new-source-existing-approval',RUNNER_TEMP:directory,STAGING_OPENAI_API_KEY:'synthetic-private-key',GH_TOKEN:'synthetic-private-token'};
 assertSourceWorkflowIdentity(env);assert.throws(()=>assertSourceWorkflowIdentity({...env,GITHUB_RUN_ATTEMPT:'2'}));
 const cli=fileURLToPath(new URL('../../scripts/staging-source-coordinator.mjs',import.meta.url));const result=spawnSync(process.execPath,[cli,'preflight'],{cwd:directory,env,encoding:'utf8',timeout:10000});assert.equal(result.status,1);assert.match(result.stderr,/execution_evidence_unpinned/);assert.equal(result.stderr.includes('synthetic-private-key'),false);assert.equal((await fs.readdir(directory)).some(n=>n.includes('-provider')||n.includes('-producer')),false);
 const y=await fs.readFile(new URL('../../.github/workflows/staging-source-acceptance.yml',import.meta.url),'utf8');assert.equal((y.match(/staging-source-coordinator.mjs execute/g)||[]).length,1);assert.ok(y.indexOf('STAGING_OPENAI_API_KEY')>y.indexOf('id: escrow'));assert.match(y,/cancel-in-progress: false/);assert.doesNotMatch(y,/deploy:production|configure-access|api\/key\/test/);
}));

test('runtime guard change after a mock request preserves uncertain billing and stops before another claim',async()=>temporary(async root=>{
 const s=await scenario(root);let calls=0,forgot=0;const result=await executeEscrowProtocolComponent({workspace:root,witness:await s.read(),proposalValue:proposed(),fixtureFiles:await fixtureFiles(),expectedDeploymentVersion:version,guard:async({phase})=>({source:phase==='after'?'f'.repeat(40):PLAN.source,artifact:PLAN.artifact,version,byokConfigured:true,principalActive:true}),prepareSession:async()=>({configured:true,principalActive:true}),dispatch:async()=>{calls++;return {accepted:true,requestIdPresent:true}},forgetSession:async()=>{forgot++;return {forgotten:true}}});
 assert.equal(calls,1);assert.equal(forgot,1);assert.equal(result.code,'runtime_guard_mismatch');assert.equal(result.journal.successes,0);assert.equal(result.journal.reservedMicroUsd,436500);assert.equal(result.reservationReleased,false);assert.equal(result.automaticRetry,false);
 const outcome=JSON.parse(await fs.readFile(path.join(result.directory,'slot-11-outcome.json'),'utf8'));assert.equal(outcome.status,'uncertain');assert.equal(outcome.requestIdPresent,true);
}));

test('missing or malformed mock outcomes are uncertain unless definitive denial is explicit',async()=>{
 for(const outcome of [undefined,null,{},false,{accepted:true,requestIdPresent:false},{accepted:false,requestIdPresent:true},{accepted:false,requestIdPresent:false,definitiveDenial:true}])await temporary(async root=>{
  const s=await scenario(root);let calls=0;const result=await executeEscrowProtocolComponent({workspace:root,witness:await s.read(),proposalValue:proposed(),fixtureFiles:await fixtureFiles(),expectedDeploymentVersion:version,guard:async()=>({source:PLAN.source,artifact:PLAN.artifact,version,byokConfigured:true,principalActive:true}),prepareSession:async()=>({configured:true,principalActive:true}),dispatch:async()=>{calls++;return outcome},forgetSession:async()=>({forgotten:true})});
  const definitive=outcome?.definitiveDenial===true;assert.equal(calls,1);assert.equal(result.code,definitive?'dispatch_not_accepted':'dispatch_outcome_unknown');const recorded=JSON.parse(await fs.readFile(path.join(result.directory,'slot-11-outcome.json'),'utf8'));assert.equal(recorded.status,definitive?'denied':'uncertain');assert.equal(result.journal.reservedMicroUsd,436500);assert.equal(result.reservationReleased,false);
 });
});
test('awaited setup cannot mutate or replace the private verified fixture snapshots',async()=>temporary(async root=>{
 const s=await scenario(root),files=await fixtureFiles();let calls=0;const result=await executeEscrowProtocolComponent({workspace:root,witness:await s.read(),proposalValue:proposed(),fixtureFiles:files,expectedDeploymentVersion:version,prepareSession:async()=>{for(const f of FIXTURES){files[f.name].fill(0);files[f.name]=Buffer.from('synthetic-mutated-caller-payload')}return {configured:true,principalActive:true}},guard:async()=>({source:PLAN.source,artifact:PLAN.artifact,version,byokConfigured:true,principalActive:true}),dispatch:async({fixture,bytes})=>{assert.equal(hash(bytes),fixture.sha256);assert.equal(bytes.length,fixture.bytes);calls++;return {accepted:true,requestIdPresent:true}},forgetSession:async()=>({forgotten:true})});assert.equal(calls,9);assert.equal(result.journal.successes,9);assert.equal(result.releaseReady,false);
}));
