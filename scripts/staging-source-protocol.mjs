// Protocol component, not an admission permit. The CLI entry point always uses
// admitExecution first; it remains disabled. Adapters below are trusted code/test
// seams, never workflow-input switches or user-asserted verification flags.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {PLAN,FIXTURES,verifyFixtures,admitExecution} from './staging-source-admission.mjs';
import {createJournalEngine,writeExclusiveSynced} from './staging-source-journal.mjs';
import {crc32} from './zip-utils.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{const e=Error('Source protocol rejected');e.code=code;throw e};
const need=(v,c)=>{if(!v)fail(c)};
const repo='sohweiyu2023/CosmicTranscriberWeb',workflow='.github/workflows/staging-source-acceptance.yml';
const officialWitnesses=new WeakMap();
export function readSingleAdmissionZip(input){
 try{
  const b=Buffer.from(input);need(b.length>=100&&b.length<=65536,'escrow_archive_invalid');
  const e=b.length-22;need(b.readUInt32LE(e)===0x06054b50&&b.readUInt16LE(e+4)===0&&b.readUInt16LE(e+6)===0&&b.readUInt16LE(e+8)===1&&b.readUInt16LE(e+10)===1&&b.readUInt16LE(e+20)===0,'escrow_archive_invalid');
  const size=b.readUInt32LE(e+12),c=b.readUInt32LE(e+16);need(c+size===e&&size>=46&&c>=30&&b.readUInt32LE(c)===0x02014b50,'escrow_archive_invalid');
  const flags=b.readUInt16LE(c+8),method=b.readUInt16LE(c+10),crc=b.readUInt32LE(c+16),packed=b.readUInt32LE(c+20),plain=b.readUInt32LE(c+24),n=b.readUInt16LE(c+28),extra=b.readUInt16LE(c+30),comment=b.readUInt16LE(c+32),local=b.readUInt32LE(c+42);
  need((flags&~0x808)===0&&[0,8].includes(method)&&plain<=16384&&packed<=65536&&local===0&&46+n+extra+comment===size,'escrow_archive_invalid');
  need(b.subarray(c+46,c+46+n).toString('utf8')==='admission.json'&&b.readUInt32LE(0)===0x04034b50&&b.readUInt16LE(6)===flags&&b.readUInt16LE(8)===method,'escrow_archive_invalid');
  need(((b.readUInt32LE(c+38)>>>16)&0o170000)!==0o120000,'escrow_archive_invalid');
  const ln=b.readUInt16LE(26),le=b.readUInt16LE(28),start=30+ln+le,end=start+packed;need(b.subarray(30,30+ln).toString('utf8')==='admission.json'&&end<=c,'escrow_archive_invalid');
  if(flags&8){const gap=c-end;need(gap===12||gap===16,'escrow_archive_invalid');const d=end+(gap===16?4:0);if(gap===16)need(b.readUInt32LE(end)===0x08074b50,'escrow_archive_invalid');need(b.readUInt32LE(d)===crc&&b.readUInt32LE(d+4)===packed&&b.readUInt32LE(d+8)===plain,'escrow_archive_invalid')}
  else need(end===c&&b.readUInt32LE(14)===crc&&b.readUInt32LE(18)===packed&&b.readUInt32LE(22)===plain,'escrow_archive_invalid');
  const value=method===0?b.subarray(start,end):inflateRawSync(b.subarray(start,end),{maxOutputLength:16384});
  need(value.length===plain&&crc32(value)===crc,'escrow_archive_invalid');return Buffer.from(value);
 }catch{fail('escrow_archive_invalid')}
}
async function bounded(response,maximum){
 const reader=response.body?.getReader();need(reader,'evidence_stream_missing');const parts=[];let bytes=0,done=false;
 try{while(true){const r=await reader.read();if(r.done){done=true;break}need(r.value instanceof Uint8Array,'evidence_stream_invalid');bytes+=r.value.byteLength;need(bytes<=maximum,'evidence_oversized');parts.push(Buffer.from(r.value))}}catch{fail('evidence_read_failed')}
 finally{if(!done)try{await reader.cancel()}catch{};try{reader.releaseLock()}catch{}}
 return Buffer.concat(parts);
}
export async function readOfficialEscrow({runId,artifactId,coordinatorHead,workflowBlob,token,fetchImpl=fetch}){
 need(typeof runId==='string'&&/^[1-9][0-9]{0,19}$/.test(runId)&&Number.isSafeInteger(artifactId)&&artifactId>0,'escrow_identity_invalid');
 need(typeof coordinatorHead==='string'&&typeof workflowBlob==='string'&&/^[a-f0-9]{40}$/.test(coordinatorHead)&&/^[a-f0-9]{40}$/.test(workflowBlob)&&typeof token==='string'&&token.length>0,'escrow_identity_invalid');
 const base='https://api.github.com/repos/'+repo,headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 const get=async route=>{let r;try{r=await fetchImpl(base+route,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(20000)})}catch{fail('evidence_network_failed')}need(r.status===200,'evidence_http_rejected');try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded(r,1000000)))}catch{fail('evidence_invalid_json')}};
 const run=await get('/actions/runs/'+runId),artifact=await get('/actions/artifacts/'+artifactId),main=await get('/git/ref/heads/main'),definition=await get('/contents/'+workflow+'?ref='+coordinatorHead);
 need(String(run.id)===runId&&run.run_attempt===1&&run.event==='workflow_dispatch'&&run.head_branch==='main'&&run.head_sha===coordinatorHead&&run.path===workflow&&run.status==='in_progress','escrow_run_mismatch');
 need(main.object?.sha===coordinatorHead&&definition.sha===workflowBlob,'escrow_source_mismatch');
 need(artifact.id===artifactId&&artifact.name==='source-verification-reservation-'+PLAN.campaign&&artifact.expired===false&&String(artifact.workflow_run?.id)===runId&&artifact.workflow_run?.head_sha===coordinatorHead&&/^sha256:[a-f0-9]{64}$/.test(artifact.digest||''),'escrow_artifact_mismatch');
 let response;try{response=await fetchImpl(base+'/actions/artifacts/'+artifactId+'/zip',{method:'GET',headers,redirect:'manual',signal:AbortSignal.timeout(20000)})}catch{fail('evidence_network_failed')}
 if(response.status===302){
  let url;try{url=new URL(response.headers.get('location'))}catch{fail('escrow_download_location')}
  need(url.protocol==='https:'&&!url.username&&!url.password&&['.blob.core.windows.net','.githubusercontent.com'].some(s=>url.hostname.endsWith(s)),'escrow_download_location');
  // No GitHub authorization header is ever forwarded to artifact storage.
  try{response=await fetchImpl(url.href,{method:'GET',headers:{},redirect:'error',signal:AbortSignal.timeout(20000)})}catch{fail('evidence_network_failed')}
 }
 need(response.status===200,'evidence_http_rejected');const archive=await bounded(response,65536),digest=hash(archive);need(artifact.digest==='sha256:'+digest,'escrow_digest_mismatch');
 const admissionBytes=readSingleAdmissionZip(archive),witness=Object.freeze({runId,coordinatorHead,workflowBlob,artifact:Object.freeze({repository:repo,runId,id:artifact.id,name:artifact.name,expired:false,digest:artifact.digest}),archiveSha256:digest,get admissionBytes(){return Buffer.from(admissionBytes)}});officialWitnesses.set(witness,Buffer.from(admissionBytes));return witness;
}
export async function executeEscrowProtocolComponent({workspace,witness,proposalValue,fixtureFiles,expectedDeploymentVersion,guard,prepareSession,dispatch,forgetSession,diagnostics}){
 need(officialWitnesses.has(witness),'official_escrow_required');const admissionBytes=officialWitnesses.get(witness);need(typeof expectedDeploymentVersion==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(expectedDeploymentVersion),'deployment_version_unpinned');
 need([guard,prepareSession,dispatch,forgetSession].every(f=>typeof f==='function'),'protocol_adapter_missing');verifyFixtures(fixtureFiles);
 // Private verified snapshots are established before setup/guard awaits.
 const privateFixtures=Object.fromEntries(FIXTURES.map(f=>[f.name,Buffer.from(fixtureFiles[f.name])]));verifyFixtures(privateFixtures);
 const root=await fs.realpath(workspace),directory=path.join(root,'.cosmic-source-'+PLAN.campaign+'-'+witness.runId+'-provider');
 // Fixed per-run directory. Never delete/recreate it to retry or recover execution.
 try{await fs.mkdir(directory,{mode:0o700})}catch{fail('execution_directory_exists')}
 const engine=createJournalEngine();let setupStarted=false,attempted=0,cleanup='not-required',status='BLOCKED',code='unknown';
 const event=(phase,result,errorCategory='none')=>{try{diagnostics?.record({operation:'source-acceptance',phase,result,errorCategory,reconciliationRequired:result!=='success'})}catch{}};
 try{
  const mirror=await engine.createLocalReservation(directory,proposalValue,witness.runId,1);need(mirror.sha256===hash(admissionBytes),'escrow_content_mismatch');
  await engine.bindRemotePersistence(directory,{artifact:witness.artifact,archiveSha256:witness.archiveSha256,files:{'admission.json':admissionBytes}});event('reserve','success');
  setupStarted=true;let session;try{session=await prepareSession()}catch{fail('session_setup_unknown')}need(session?.configured===true&&session?.principalActive===true,'session_not_ready');
  for(let i=0;i<FIXTURES.length;i++){
   const f=FIXTURES[i],slot=i+11;const verifyGuard=async phase=>{let state;try{state=await guard({slot,phase})}catch{fail('runtime_guard_failed')}need(state?.source===PLAN.source&&state?.artifact===PLAN.artifact&&state?.version===expectedDeploymentVersion&&state?.byokConfigured===true&&state?.principalActive===true,'runtime_guard_mismatch')};await verifyGuard('before');
   const claim=await engine.claimSlot(directory,slot);event('dispatch','started');attempted++;
   let outcome;try{outcome=await dispatch({claim,fixture:f,bytes:privateFixtures[f.name]})}catch{await engine.recordOutcome(directory,slot,{status:'uncertain',requestIdPresent:false});fail('dispatch_outcome_unknown')}
   if(outcome?.accepted!==true||outcome?.requestIdPresent!==true){const definitive=outcome?.definitiveDenial===true&&outcome?.accepted===false&&typeof outcome?.requestIdPresent==='boolean';await engine.recordOutcome(directory,slot,{status:definitive?'denied':'uncertain',requestIdPresent:outcome?.requestIdPresent===true});fail(definitive?'dispatch_not_accepted':'dispatch_outcome_unknown')}
   // A result is not accepted for this source if deployment/account changes during the call.
   try{await verifyGuard('after')}catch(error){await engine.recordOutcome(directory,slot,{status:'uncertain',requestIdPresent:true});throw error}
   await engine.recordOutcome(directory,slot,{status:'success',requestIdPresent:true});event('dispatch','success');
  }
  status='PROTOCOL_COMPLETED_NOT_ADMISSION';code='none';
 }catch(error){status='STOPPED';code=['escrow_content_mismatch','session_not_ready','session_setup_unknown','runtime_guard_failed','runtime_guard_mismatch','dispatch_outcome_unknown','dispatch_not_accepted','journal_persistence_uncertain'].includes(error?.code)?error.code:'protocol_failed';event('finish','failure',code)}
 finally{if(setupStarted){try{const result=await forgetSession();cleanup=result?.forgotten===true?'confirmed':'unknown'}catch{cleanup='unknown'}if(cleanup!=='confirmed'){status='STOPPED';code='session_cleanup_unknown'}event('cleanup',cleanup==='confirmed'?'success':'unknown','unknown')}}
 const journal=await engine.summarizeJournal(directory).catch(()=>null);
 const report={schema:'cosmic-source-protocol-component-1',status,code,runId:witness.runId,attempted,cleanup,journal,directory,automaticRetry:false,reservationReleased:false,fullAcceptance:false,releaseReady:false,genuineMacSafariValidated:false};
 const persisted={...report};delete persisted.directory;
 try{await writeExclusiveSynced(path.join(directory,'protocol-outcome.json'),Buffer.from(JSON.stringify(persisted)+'\n'))}catch{event('finish','unknown','protocol_outcome_persistence_uncertain');fail('protocol_outcome_persistence_uncertain')}
 return report;
}
export async function runSourceCampaign(context,ports){
 // No caller ready/verified flag or adapter can override the fixed disabled gate.
 const permit=admitExecution(context);assert.ok(permit);
 return executeEscrowProtocolComponent(ports);
}
