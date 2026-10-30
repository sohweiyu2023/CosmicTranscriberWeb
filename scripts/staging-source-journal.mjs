// Journal component only: no HTTP/provider requests and no execution permit.
// Full-batch reservation must be uploaded and independently downloaded/verified
// before any slot is claimed. Private acknowledgments cannot be restored from
// parseable files: any lost process or failed persistence requires reconciliation.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PLAN,FIXTURES} from './staging-source-admission.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const reject=code=>{const e=new Error(code);e.code=code;throw e;};
const need=(condition,code)=>{if(!condition)reject(code);};
const bytes=value=>Buffer.from(JSON.stringify(value)+'\n');
const file=(directory,name)=>path.join(directory,name);
export async function writeExclusiveSynced(target,data,openFile=fs.open){
 const handle=await openFile(target,'wx',0o600);
 try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
}
async function read(directory,name){return JSON.parse(await fs.readFile(file(directory,name),'utf8'));}
async function exists(target){try{await fs.stat(target);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function validRun(runId){need(typeof runId==='string'&&/^[1-9][0-9]{0,19}$/.test(runId),'run_id_invalid');}
function exactProposal(p){
 need(p?.schema==='cosmic-request-admission-proposal-1'&&p.state==='PROPOSAL_NOT_RESERVED','proposal_invalid');
 need(p.campaign===PLAN.campaign&&p.previousRequests===10&&p.additionalRequests===9&&p.maximumRequests===19,'request_cap_mismatch');
 need(p.previousReservedMicroUsd===220500&&p.additionalMicroUsd===216000&&p.maximumMicroUsd===436500&&p.ownerCeilingMicroUsd===2000000,'spend_cap_mismatch');
 need(p.automaticRetries===0&&p.fullAcceptance===false&&p.releaseReady===false&&p.genuineMacSafariValidated===false,'qualification_mismatch');
 assert.deepEqual(p.slots,FIXTURES.map((f,index)=>({slot:index+11,format:f.format,model:f.model,maximumMicroUsd:f.reservationMicroUsd})));
}
function expectedAdmission(runId){return {schema:'cosmic-source-reserved-intent-batch-1',campaign:PLAN.campaign,runId,attempt:1,
 source:PLAN.source,artifact:PLAN.artifact,innerSha256:PLAN.innerSha256,lockSha256:PLAN.lockSha256,
 priorRequests:10,reservedRequests:19,priorReservedMicroUsd:220500,reservedMicroUsd:436500,
 additionalRequests:9,additionalMicroUsd:216000,ownerCeilingMicroUsd:2000000,automaticRetries:0,
 state:'RESERVED_ALL_NINE_UNKNOWN_UNTIL_PROVEN',
 slots:FIXTURES.map((f,index)=>({slot:index+11,format:f.format,model:f.model,fixtureSha256:f.sha256,
  maximumMicroUsd:f.reservationMicroUsd,attemptId:'attempt-'+sha(PLAN.campaign+'|'+runId+'|'+(index+11)+'|'+f.sha256).slice(0,24),state:'RESERVED_NO_EXECUTION_PROOF'})),
 fullAcceptance:false,releaseReady:false,genuineMacSafariValidated:false};}
function expectedIntent(a,slot){return {schema:'cosmic-source-slot-intent-1',campaign:PLAN.campaign,runId:a.runId,...a.slots[slot-11],state:'DISPATCH_INTENT_PERSISTED_OUTCOME_UNKNOWN'};}
function verifyOutcome(a,slot,out){
 need(['success','denied','uncertain'].includes(out?.status)&&typeof out.requestIdPresent==='boolean','outcome_invalid');
 assert.deepEqual(out,{schema:'cosmic-source-slot-outcome-1',campaign:PLAN.campaign,runId:a.runId,slot,status:out.status,
  requestIdPresent:out.requestIdPresent,reservationReleased:false,automaticRetry:false});
 need(out.status!=='success'||out.requestIdPresent===true,'success_request_id_missing');return out;
}
// An injected opener is a unit-test seam, not workflow/user configuration.
// No engine can adopt another process's acknowledged state from disk alone.
export function createJournalEngine({openFile=fs.open}={}){
 const contexts=new Map(),queues=new Map();
 const write=(target,data)=>writeExclusiveSynced(target,data,openFile);
 async function serial(directory,operation,allowPoison=false){
  const d=await fs.realpath(directory),previous=queues.get(d)||Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
   const ctx=contexts.get(d);
   need(allowPoison||!ctx?.poisoned,'journal_persistence_uncertain');
   try{return await operation(d);}catch(e){const current=contexts.get(d);if(current)current.poisoned=true;throw e;}
  });
  queues.set(d,task.then(()=>{},()=>{}));return task;
 }
 async function admission(d){
  const a=await read(d,'admission.json');validRun(a.runId);assert.deepEqual(a,expectedAdmission(a.runId));
  assert.deepEqual(await read(d,'campaign.lock'),{campaign:PLAN.campaign,runId:a.runId,attempt:1});return a;
 }
 async function owned(d,allowPoison=false){
  const ctx=contexts.get(d);need(ctx?.localAcknowledged&&ctx.boundAcknowledged,'journal_owner_unacknowledged');
  need(allowPoison||!ctx.poisoned,'journal_persistence_uncertain');
  const a=await admission(d),w=await read(d,'remote-witness.json');
  need(a.runId===ctx.runId,'local_owner_changed');assert.deepEqual(w,ctx.witness);
  need(w.admissionSha256===sha(await fs.readFile(file(d,'admission.json'))),'durability_content_changed');return {a,ctx};
 }
 return Object.freeze({
  async createLocalReservation(directory,p,runId,attempt){return serial(directory,async d=>{
   exactProposal(p);validRun(runId);need(attempt===1,'attempt_not_one');need(!contexts.has(d),'local_owner_exists');
   // Establish ownership before writes; failures poison even a partial journal.
   const ctx={runId,localAcknowledged:false,boundAcknowledged:false,poisoned:false,committed:new Set()};contexts.set(d,ctx);
   await write(file(d,'campaign.lock'),bytes({campaign:PLAN.campaign,runId,attempt:1}));
   const a=expectedAdmission(runId),encoded=bytes(a);await write(file(d,'admission.json'),encoded);
   ctx.localAcknowledged=true;need(!ctx.poisoned,'journal_persistence_uncertain');
   return Object.freeze({runId,sha256:sha(encoded),file:'admission.json',state:'LOCAL_ONLY_REMOTE_PERSISTENCE_REQUIRED'});
  });},
  async bindRemotePersistence(directory,{artifact,archiveSha256,files}){return serial(directory,async d=>{
   const ctx=contexts.get(d);need(ctx?.localAcknowledged&&!ctx.boundAcknowledged,'local_owner_unacknowledged');
   const a=await admission(d),local=await fs.readFile(file(d,'admission.json'));
   need(artifact?.repository==='sohweiyu2023/CosmicTranscriberWeb'&&artifact.runId===a.runId,'artifact_owner_mismatch');
   need(Number.isSafeInteger(artifact.id)&&artifact.id>0&&artifact.expired===false,'artifact_identity_invalid');
   need(artifact.name==='source-verification-reservation-'+PLAN.campaign,'artifact_name_mismatch');
   need(typeof archiveSha256==='string'&&/^[a-f0-9]{64}$/.test(archiveSha256)&&artifact.digest==='sha256:'+archiveSha256,'artifact_archive_digest_mismatch');
   need(files&&Object.keys(files).length===1&&Object.hasOwn(files,'admission.json')&&Buffer.isBuffer(files['admission.json']),'artifact_entries_invalid');
   need(sha(files['admission.json'])===sha(local),'artifact_content_mismatch');
   const w={schema:'cosmic-remote-reservation-witness-1',campaign:PLAN.campaign,runId:a.runId,artifactId:artifact.id,archiveSha256,admissionSha256:sha(local)};
   await write(file(d,'remote-witness.json'),bytes(w));
   ctx.witness=Object.freeze(w);ctx.boundAcknowledged=true;need(!ctx.poisoned,'journal_persistence_uncertain');return ctx.witness;
  });},
  async claimSlot(directory,slot){return serial(directory,async d=>{
   const {a,ctx}=await owned(d);need(Number.isSafeInteger(slot)&&slot>=11&&slot<=19,'slot_out_of_range');
   need(!await exists(file(d,'STOP.json')),'campaign_stopped');
   for(let previous=11;previous<slot;previous++){
    need(ctx.committed.has(previous),'prior_dispatch_unacknowledged');
    assert.deepEqual(await read(d,'slot-'+previous+'-intent.json'),expectedIntent(a,previous));
    need(verifyOutcome(a,previous,await read(d,'slot-'+previous+'-outcome.json')).status==='success','prior_dispatch_not_success');
   }
   const intent=expectedIntent(a,slot);await write(file(d,'slot-'+slot+'-intent.json'),bytes(intent));
   need(!ctx.poisoned,'journal_persistence_uncertain');
   return Object.freeze({slot,attemptId:intent.attemptId,format:intent.format,model:intent.model,maximumMicroUsd:intent.maximumMicroUsd});
  });},
  async recordOutcome(directory,slot,{status,requestIdPresent=false}){return serial(directory,async d=>{
   const {a,ctx}=await owned(d);need(Number.isSafeInteger(slot)&&slot>=11&&slot<=19,'slot_out_of_range');
   const out={schema:'cosmic-source-slot-outcome-1',campaign:PLAN.campaign,runId:a.runId,slot,status,requestIdPresent,reservationReleased:false,automaticRetry:false};
   verifyOutcome(a,slot,out);assert.deepEqual(await read(d,'slot-'+slot+'-intent.json'),expectedIntent(a,slot));
   await write(file(d,'slot-'+slot+'-outcome.json'),bytes(out));
   if(status!=='success')await write(file(d,'STOP.json'),bytes({schema:'cosmic-source-stop-1',campaign:PLAN.campaign,runId:a.runId,slot,reason:status,reservationReleased:false}));
   // Parseable bytes are insufficient: sync AND close must have returned first.
   need(!ctx.poisoned,'journal_persistence_uncertain');ctx.committed.add(slot);return Object.freeze(out);
  });},
  async summarizeJournal(directory){return serial(directory,async d=>{
   const {a,ctx}=await owned(d,true),results=[];
   for(let slot=11;slot<=19;slot++)if(await exists(file(d,'slot-'+slot+'-outcome.json')))results.push(verifyOutcome(a,slot,await read(d,'slot-'+slot+'-outcome.json')));
   const successes=results.filter(r=>r.status==='success'&&ctx.committed.has(r.slot)).length;
   return Object.freeze({campaign:a.campaign,runId:a.runId,reservedRequests:19,reservedMicroUsd:436500,
    observedOutcomes:results.length,successes,unresolvedOrUnusedSlots:9-successes,
    stopped:ctx.poisoned||await exists(file(d,'STOP.json')),reservationReleased:false,automaticRetry:false,
    fullAcceptance:false,releaseReady:false,genuineMacSafariValidated:false});
  },true);}
 });
}
const engine=createJournalEngine();
export const {createLocalReservation,bindRemotePersistence,claimSlot,recordOutcome,summarizeJournal}=engine;
