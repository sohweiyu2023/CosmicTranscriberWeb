// Operational diagnostics only. Never a reservation, retry permit or authority record.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
let ownCodeHash=null;try{ownCodeHash=createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex')}catch{}

export const TOOL_LOG_POLICY=Object.freeze({schema:'cosmic-tool-event-1',buildIdentity:'cosmic-web-1.2.0/tooling-v1',maximumFileBytes:65536,maximumFiles:3,maximumMemoryEvents:128,retentionDays:7});
const components=new Set(['wrangler-auth','staging-deploy','source-admission','artifact-verifier','source-packager','e2e-launcher','unknown']);
const operations=new Set(['wrangler-whoami','wrangler-deployments-read','wrangler-device-login','package-verification','artifact-download','source-acceptance','staging-deploy','unknown']);
const phases=new Set(['start','preflight','spawn','wait','handoff','status','download','verify','reserve','dispatch','cleanup','finish','recovery','certification','settings','rollback','access','unknown']);
const results=new Set(['started','running','success','failure','denied','blocked','timeout','cancelled','unknown']);
export const TOOL_ERROR_CATEGORIES=Object.freeze(['none','invocation_scope_rejected','auth_not_authenticated','auth_account_mismatch','auth_device_expired','auth_consent_denied','auth_pending','auth_authenticated','secure_storage_unavailable','authorization_rejected','dns_failure','tls_failure','dependency_missing','native_dependency_failure','network_failure','process_failure','spawn_failure','output_oversized','malformed_response','timeout','cancelled','unknown','preflight_rejected','settings_identity_invalid','settings_network_failed','settings_timeout','settings_http_rejected','settings_not_json','settings_oversized','settings_stream_missing','settings_stream_invalid','settings_interrupted','settings_invalid_json','settings_unrecognized','settings_binding_invalid','settings_output_invalid','access_credential_missing','access_credential_format','access_redirect','access_http_rejected','access_not_app_html','access_missing_no_store','access_missing_app_csp','access_response_oversized','access_response_stream_missing','access_response_stream_invalid','access_invalid_html','access_unrecognized_app','access_timeout','access_network_failed','execution_evidence_unpinned','escrow_content_mismatch','session_not_ready','session_setup_unknown','runtime_guard_failed','runtime_guard_mismatch','dispatch_outcome_unknown','dispatch_not_accepted','journal_persistence_uncertain','protocol_failed','session_cleanup_unknown','protocol_outcome_persistence_uncertain']);
const categories=new Set(TOOL_ERROR_CATEGORIES);
const exceptions=new Set(['Error','TypeError','SyntaxError','RangeError','AbortError','TimeoutError','AssertionError','unknown']);
const signals=new Set(['SIGINT','SIGTERM','SIGKILL','unknown']);
const get=(v,k)=>{try{return v?.[k]}catch{return undefined}};
const runtimeVersion=v=>typeof v==='string'&&/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)?v:null;
const number=(v,max=1e9)=>Number.isSafeInteger(v)&&v>=0&&v<=max?v:null;
const choice=(v,values,fallback='unknown')=>values.has(v)?v:fallback;
function outputSummary(value){
 const labels=get(value,'categories'),selected=[];let categoriesTruncated=get(value,'categoriesTruncated')===true;try{categoriesTruncated=categoriesTruncated||Array.isArray(labels)&&number(get(labels,'length'))>8}catch{categoriesTruncated=true}
 try{if(Array.isArray(labels))for(let i=0;i<8;i++){const label=get(labels,i);if(categories.has(label)&&!selected.includes(label))selected.push(label)}}catch{}
 return {bytes:number(get(value,'bytes')),truncated:get(value,'truncated')===true,categoriesTruncated,categories:selected};
}
function eventFrom(fields,identity){
 const result=choice(get(fields,'result'),results),exit=get(fields,'exitCode'),status=get(fields,'httpStatus'),matched=get(fields,'accountMatched');
 const event={schema:TOOL_LOG_POLICY.schema,buildIdentity:TOOL_LOG_POLICY.buildIdentity,operationId:identity.operationId,sequence:identity.sequence,atUtc:identity.atUtc,component:identity.component,operation:choice(get(fields,'operation'),operations),diagnosticsCodeSha256:identity.codeHash??null,nodeVersion:identity.restored===true?runtimeVersion(identity.nodeVersion):runtimeVersion(process.versions.node),
  phase:choice(get(fields,'phase'),phases),result,durationMs:identity.durationMs,
  errorCategory:choice(get(fields,'errorCategory'),categories),exceptionType:choice(get(fields,'exceptionType'),exceptions),
  exitCode:Number.isInteger(exit)&&Math.abs(exit)<=32768?exit:null,
  httpStatus:Number.isInteger(status)&&status>=100&&status<=599?status:null,
  signal:choice(get(fields,'signal'),signals),accountMatched:typeof matched==='boolean'?matched:null,stdout:outputSummary(get(fields,'stdout')),stderr:outputSummary(get(fields,'stderr')),
  reconciliationRequired:get(fields,'reconciliationRequired')===true||['unknown','timeout','cancelled'].includes(result)};
 Object.freeze(event.stdout.categories);Object.freeze(event.stderr.categories);Object.freeze(event.stdout);Object.freeze(event.stderr);return Object.freeze(event);
}
function restore(value){
 const id=get(value,'operationId');if(get(value,'schema')!==TOOL_LOG_POLICY.schema||get(value,'buildIdentity')!==TOOL_LOG_POLICY.buildIdentity||typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))return null;
 const at=get(value,'atUtc');if(typeof at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at)||!Number.isFinite(Date.parse(at)))return null;
 return eventFrom(value,{operationId:value.operationId,sequence:number(value.sequence)||0,atUtc:at,component:choice(get(value,'component'),components),durationMs:number(value.durationMs),restored:true,nodeVersion:get(value,'nodeVersion'),codeHash:typeof value.diagnosticsCodeSha256==='string'&&/^[a-f0-9]{64}$/.test(value.diagnosticsCodeSha256)?value.diagnosticsCodeSha256:null});
}
export function createToolDiagnostics({component='unknown',directory=null,fsImpl=fs,now=()=>new Date(),clock=()=>performance.now(),sink=()=>{},maximumFileBytes=65536}={}){
 const operationId=randomUUID(),events=[];let sequence=0,dropped=0,diskDropped=0,categoryLosses=0,writeFailures=0,parseFailures=0,pendingSinks=0,lockContentions=0,restarted=false,priorOutcomeUnverified=false,complete=ownCodeHash!==null;
 const limit=Number.isInteger(maximumFileBytes)?Math.min(65536,Math.max(2048,maximumFileBytes)):65536;
 const folder=directory===null?null:path.resolve(directory),file=i=>path.join(folder,'operations-'+i+'.jsonl');
 let started;try{started=clock()}catch{started=null;complete=false}
 const fresh=e=>Date.now()-Date.parse(e.atUtc)<=7*86400000&&Date.parse(e.atUtc)-Date.now()<=3600000;
 const remember=e=>{if(!fresh(e)){dropped++;complete=false;return}if(events.length>=128){events.shift();dropped++;complete=false}events.push(e)};
 const lost=()=>{writeFailures++;complete=false};
 async function exclusive(action){
  const lock=path.join(folder,'operations.writer.lock');let handle;
  try{handle=await fsImpl.open(lock,'wx',0o600)}catch{lockContentions++;priorOutcomeUnverified=true;lost();return}
  try{await handle.writeFile(JSON.stringify({operationId,pid:process.pid,atUtc:new Date().toISOString()})+'\n');return await action()}
  finally{try{await handle.close()}catch{lost()}try{await fsImpl.unlink(lock)}catch{lost()}}
 }
 async function replaceCanonical(target,text){
  const temp=path.join(folder,'operations.rewrite.tmp');let handle,owned=false;
  try{handle=await fsImpl.open(temp,'wx',0o600);owned=true;await handle.writeFile(text);await handle.sync();await handle.close();handle=null;await fsImpl.rename(temp,target);owned=false}
  finally{if(handle)try{await handle.close()}catch{lost()};if(owned)try{await fsImpl.unlink(temp)}catch{lost()}}
 }
 async function canonicalize(i,load){
  let st;try{st=await fsImpl.lstat(file(i))}catch(e){if(e.code==='ENOENT')return 0;throw e}
  if(st.isSymbolicLink()||!st.isFile()||st.size>65536)throw Error('Unsafe diagnostic segment');
  if(load){restarted=true;priorOutcomeUnverified=true;complete=false}
  const text=await fsImpl.readFile(file(i),'utf8'),kept=[];let rewrite=false;
  for(const line of text.split('\n').filter(Boolean)){
   let item;try{item=restore(JSON.parse(line))}catch{}
   if(!item){parseFailures++;complete=false;rewrite=true;continue}
   if(!fresh(item)){diskDropped++;complete=false;rewrite=true;continue}
   if(item.stdout.categoriesTruncated||item.stderr.categoriesTruncated){categoryLosses++;complete=false}
   kept.push(JSON.stringify(item));if(load)remember(item);
  }
  const canonical=kept.join('\n')+(kept.length?'\n':'');
  if(rewrite){if(kept.length)await replaceCanonical(file(i),canonical);else await fsImpl.unlink(file(i));return Buffer.byteLength(canonical)}
  return st.size;
 }
 const ready=(async()=>{if(!folder)return;try{await fsImpl.mkdir(folder,{recursive:true,mode:0o700});await exclusive(async()=>{for(let i=2;i>=0;i--)await canonicalize(i,true)})}catch{lost()}})();
 let queue=ready;
 async function append(event){
  if(!folder)return;
  return exclusive(async()=>{
   const line=JSON.stringify(event)+'\n';if(Buffer.byteLength(line)>limit)throw Error('Diagnostic event too large');
   for(let i=2;i>=1;i--)await canonicalize(i,false);
   const size=await canonicalize(0,false);
   if(size+Buffer.byteLength(line)>limit){
    try{const st=await fsImpl.lstat(file(2));if(st.isSymbolicLink()||!st.isFile()||st.size>65536)throw Error();const old=await fsImpl.readFile(file(2),'utf8');diskDropped+=old.split('\n').filter(Boolean).length;await fsImpl.unlink(file(2))}catch(e){if(e.code!=='ENOENT')throw e}
    try{await fsImpl.rename(file(1),file(2))}catch(e){if(e.code!=='ENOENT')throw e}
    await fsImpl.rename(file(0),file(1));complete=false;
   }
   const handle=await fsImpl.open(file(0),'a',0o600);try{await handle.writeFile(line)}finally{await handle.close()}
  });
 }
 function record(fields={}){
  let atUtc,durationMs;try{atUtc=now().toISOString();if(typeof atUtc!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(atUtc))throw Error()}catch{atUtc=new Date().toISOString();complete=false}
  try{durationMs=started===null?null:number(Math.round(clock()-started))}catch{durationMs=null;complete=false}
  const event=eventFrom(fields,{operationId,sequence:++sequence,atUtc,component:choice(component,components),durationMs,codeHash:ownCodeHash});
  if(event.stdout.categoriesTruncated||event.stderr.categoriesTruncated){categoryLosses++;complete=false}
  try{const pending=sink(event);if(pending&&typeof pending.then==='function'){pendingSinks++;Promise.resolve(pending).then(()=>{pendingSinks--},()=>{pendingSinks--;lost()})}}catch{lost()}
  queue=queue.then(()=>{remember(event);if(fresh(event))return append(event)}).catch(()=>lost());
  return event;
 }
 const summary=()=>({schema:'cosmic-tool-log-summary-1',operationId,eventsRetained:events.length,droppedEventsAtLeast:Math.max(dropped,diskDropped,parseFailures),categoryLossEvents:categoryLosses,memoryEvictions:dropped,diskRecordsExpiredOrRotated:diskDropped,lossCountsMayOverlap:true,writeFailures,parseFailures,pendingSinks,lockContentions,restarted,priorOutcomeUnverified,complete:complete&&dropped===0&&writeFailures===0&&parseFailures===0&&pendingSinks===0});
 async function finish(){await queue;for(let i=events.length-1;i>=0;i--)if(!fresh(events[i])){events.splice(i,1);dropped++;complete=false}return summary()}
 return Object.freeze({operationId,record,flush:finish,async exportSupport(){await finish();return {schema:'cosmic-tool-support-1',policy:TOOL_LOG_POLICY,summary:summary(),events:events.map(e=>restore(e)).filter(Boolean)}}});
}
