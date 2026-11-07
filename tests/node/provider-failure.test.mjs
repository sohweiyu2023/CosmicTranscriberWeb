import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {captureProviderFailure,attachProviderFailure,providerFailureFor,admittedProviderFailure} from '../../src/provider-failure.js';
import {safeOperationalLog} from '../../src/operational-log.js';
import {dispatchTranscription} from '../../src/openai.js';
import {errorToSafeJson} from '../../src/errors.js';
import {makeDiagnosticEvent,pushDiagnostic} from '../../public/js/diagnostics.js';
import {writeFileSync} from 'node:fs';
const CANARY='fuchsiaCanary42',KEY='sk-EXAMPLE-synthetic-key-canary';
const capture=(value,bodyKind='json')=>captureProviderFailure(value,{bodyKind});
function row(evidence){let text;assert.equal(safeOperationalLog({route:'/api/transcribe',category:'request_failed',status:400,openaiRequestId:'req_abcdef123',providerExplanation:evidence},s=>text=s),true);return text}
function absent(text,values=[CANARY,KEY,'RAW_PRIVATE','Someone@example.invalid','/Users/private']){for(const value of values)assert.equal(text.includes(value),false,value)}
const has=(e,field,value)=>e.facts.some(f=>f.field===field&&f.value===value);
const body=()=>new Blob([new Uint8Array([1,2,3,4])]).stream();
const metadata={model:'gpt-transcribe',attemptId:'attempt-'+'a'.repeat(24),audioFormat:'mp3',declaredBytes:4,prompt:CANARY,keywords:['privatekeyword'],languages:[]};
async function rejectResponse(text,status=400){let calls=0;const error=await dispatchTranscription({requestBody:body(),metadata,apiKey:KEY,fetchImpl:async(_url,init)=>{calls++;for await(const _ of init.body){}return new Response(text,{status,headers:{'x-request-id':'req_abcdef123'}})}}).then(()=>null,e=>e);assert.equal(calls,1);return error}

test('structured facts and omission indicators survive actual JSONL persistence and safe support serialization',async()=>{
 const e=capture({message:`Unsupported payload ${CANARY}`,code:'invalid_value',type:'invalid_request_error',param:'response_format',status:400,cause:{code:'ECONNRESET'}});
 const dir=await mkdtemp(path.join(tmpdir(),'cosmic-facts-'));
 try{const file=path.join(dir,'operations.jsonl');await writeFile(file,row(e)+'\n');const saved=JSON.parse(await readFile(file,'utf8'));const exported=JSON.stringify(saved);absent(exported);assert.equal(saved.providerExplanation.schema,'cosmic-provider-explanation-2');assert.ok(has(saved.providerExplanation,'code','invalid_value'));assert.ok(has(saved.providerExplanation,'code','ECONNRESET'));assert.equal(saved.providerExplanation.proseFieldsObserved,1);assert.equal(saved.providerExplanation.prosePolicy,'omitted-unconditionally');assert.equal(saved.providerExplanation.completeProviderExplanation,false);assert.equal(saved.providerExplanation.completeSelectedDetails,false);assert.equal(saved.openaiRequestId,'req_abcdef123');assert.ok(saved.ts)}finally{await rm(dir,{recursive:true,force:true})}
});
test('unknown unquoted and quoted prose never persists even with absent or deliberately incomplete context',()=>{
 for(const message of [CANARY,`Rejected content concerning ${CANARY}.`,`Rejected "${CANARY}".`,`plain explanation Someone@example.invalid ${KEY} /Users/private/a`])for(const context of [undefined,{apiKey:KEY,privateValues:[]},{apiKey:'other',privateValues:['unrelated']}]){const e=captureProviderFailure({message,detail:message,description:message,reason:message},{bodyKind:'json',context});absent(row(e));assert.equal(e.facts.length,0);assert.equal(e.proseFieldsObserved,4);assert.equal(e.missing,true)}
});
test('nested strings arrays sensitive properties and arbitrary field names cannot retain payloads',()=>{
 const e=capture({errors:[{message:CANARY,cause:{detail:CANARY,code:'invalid_value'}},CANARY],details:{reason:CANARY,transcript:'RAW_PRIVATE',audio:'RAW_PRIVATE'},[CANARY]:CANARY,input:CANARY,output:CANARY});absent(row(e));assert.ok(has(e,'code','invalid_value'));assert.equal(e.proseFieldsObserved,4);assert.equal(e.otherProperties,'not-inspected-or-retained')
});
test('fake secrets in every allowed structured field are omitted rather than scrubbed or coerced',()=>{
 let coercions=0;const hostile={toString(){coercions++;return CANARY},valueOf(){coercions++;return 400}};
 for(const v of [CANARY,KEY,'req_secret',hostile,400000,NaN]){const e=capture({code:v,type:v,param:v,name:v,status:v,statusCode:v});absent(row(e));assert.equal(e.facts.length,0);assert.equal(e.unknownStructuredFields,6)}assert.equal(coercions,0)
});
test('only exact finite codes types protocol parameter names error names and HTTP statuses are admitted',()=>{
 const e=capture({code:'rate_limit_exceeded',type:'rate_limit_error',param:'file',name:'TypeError',status:429,statusCode:503});assert.equal(e.facts.length,6);assert.ok(has(e,'status',429));assert.ok(has(e,'param','file'));
 for(const code of ['RATE_LIMIT_EXCEEDED','rate_limit_exceeded '+CANARY,'ECONNRESET\n'+KEY]){const e=capture({code});absent(row(e));assert.equal(e.facts.length,0)}
});
test('reserved envelope keys and caller-created or JSON-cloned envelopes cannot overwrite trusted values',()=>{
 const e=capture({schema:CANARY,component:CANARY,endpoint:CANARY,facts:[{value:CANARY}],privacyScope:CANARY,code:'invalid_value'});absent(row(e));assert.equal(e.component,'openai-transcription');assert.equal(e.endpoint,'https://api.openai.com/v1/audio/transcriptions');assert.equal(e.privacyScope,'fixed-vocabulary-structured-facts-only');
 for(const forged of [{facts:[{value:CANARY}]},JSON.parse(JSON.stringify(e))])assert.equal(row(forged).includes('providerExplanation'),false)
});
test('getters inherited values coercions and arbitrary-key enumeration are never invoked',()=>{
 let calls=0;const object=Object.create({code:'invalid_value',message:CANARY});Object.defineProperty(object,'message',{get(){calls++;throw Error(CANARY)}});const e=capture(object);assert.equal(calls,0);assert.equal(e.unavailable,true);assert.equal(e.facts.length,0);
 const proxy=new Proxy({code:'invalid_value'},{ownKeys(){calls++;throw Error(CANARY)},get(){calls++;throw Error(CANARY)}});assert.ok(has(capture(proxy),'code','invalid_value'));assert.equal(calls,0);
 const bad=new Proxy({},{getOwnPropertyDescriptor(){throw Error(CANARY)}});assert.doesNotThrow(()=>capture(bad));assert.equal(capture(bad).unavailable,true);
 const options={};Object.defineProperty(options,'bodyKind',{get(){calls++;throw Error(CANARY)}});assert.doesNotThrow(()=>captureProviderFailure({},options));assert.equal(calls,0)
});
test('cycles deep arrays revoked proxies and output size remain bounded with explicit truncation',()=>{
 const cycle={code:'invalid_value'};cycle.cause=cycle;assert.equal(capture(cycle).cycleDetected,true);
 let deep={code:'invalid_value'};for(let i=0;i<10000;i++)deep={cause:deep};assert.equal(capture(deep).truncated,true);
 const e=capture({errors:Array.from({length:100},()=>({code:'invalid_value',type:'invalid_request_error',param:'model',status:400,message:CANARY.repeat(10000)}))});assert.ok(e.facts.length<=16);assert.equal(e.truncated,true);assert.ok(Buffer.byteLength(row(e),'utf8')<8192);absent(row(e));
 const revoked=Proxy.revocable({},{});revoked.revoke();assert.doesNotThrow(()=>capture(revoked.proxy));assert.equal(capture(revoked.proxy).unavailable,true)
});
test('an acyclic shared detail object is not falsely reported as a cycle or truncation',()=>{
 const shared={code:'invalid_value'},e=capture({errors:[shared,shared]});assert.equal(e.cycleDetected,false);assert.equal(e.truncated,false);assert.equal(e.facts.filter(f=>f.value==='invalid_value').length,2);assert.equal(e.completeProviderExplanation,false)
});
test('HTML plain text malformed unknown and missing bodies explicitly omit explanations',()=>{
 for(const kind of ['plain_text','html','interrupted','oversize','malformed',CANARY]){const e=capture(CANARY,kind);absent(row(e));assert.equal(e.facts.length,0);assert.equal(e.completeProviderExplanation,false);if(['html','interrupted','oversize'].includes(kind))assert.equal(e.unavailable,true)}assert.equal(capture(undefined).missing,true)
});
test('error evidence remains immutable server-only and excluded from client JSON',async()=>{
 const error=await rejectResponse(JSON.stringify({error:{message:CANARY,code:'invalid_value',type:'invalid_request_error'}}));const e=providerFailureFor(error);assert.ok(has(e,'code','invalid_value'));absent(row(e));assert.throws(()=>e.facts[0].value=CANARY);assert.throws(()=>e.facts.push({value:CANARY}));assert.equal(JSON.stringify(error).includes('providerExplanation'),false);const client=JSON.stringify(errorToSafeJson(error,'req-123'));absent(client);assert.equal(client.includes('providerExplanation'),false);assert.equal(error.details.billingState,'explicit_rejection')
});
test('real rejection integration preserves nested fixed codes and one mocked dispatch without provider prose',async()=>{
 const error=await rejectResponse(JSON.stringify({error:{message:CANARY,code:'invalid_value',details:{code:'unsupported_parameter',message:KEY}}}),500);const e=providerFailureFor(error);absent(row(e));assert.ok(has(e,'code','unsupported_parameter'));assert.equal(error.details.billingState,'ambiguous_after_dispatch')
});
test('transport nested known causes are retained while message text and unknown codes are withheld',async()=>{
 const cause=Object.assign(new Error(CANARY),{code:'ERR_TLS_CERT_ALTNAME_INVALID'});const error=await dispatchTranscription({requestBody:body(),metadata,apiKey:KEY,fetchImpl:async()=>{throw new TypeError(CANARY,{cause})}}).then(()=>null,e=>e);const e=providerFailureFor(error);assert.ok(has(e,'code','ERR_TLS_CERT_ALTNAME_INVALID'));assert.ok(has(e,'name','TypeError'));absent(row(e));assert.equal(error.details.billingState,'ambiguous_after_dispatch')
});
test('interrupted and oversized bodies are unavailable, correlation survives, and there is no retry',async()=>{
 for(const oversized of [false,true]){let calls=0;const error=await dispatchTranscription({requestBody:body(),metadata,apiKey:KEY,fetchImpl:async()=>{calls++;return new Response(new ReadableStream({start(c){if(oversized){c.enqueue(new Uint8Array(5*1024*1024));c.close()}else c.error(new Error(CANARY))}}),{status:200,headers:{'x-request-id':'req_abcdef123'}})}}).then(()=>null,e=>e);assert.equal(calls,1);assert.equal(error.details.billingState,'completed_or_ambiguous');const e=providerFailureFor(error);assert.equal(e.unavailable,true);assert.equal(e.facts.length,0);assert.equal(error.details.openaiRequestId,'req_abcdef123');absent(row(e))}
});
test('timeout caller cancellation and every failed sink preserve uncertain billing without replay',async()=>{
 for(const cancel of [false,true]){const controller=new AbortController();let calls=0;const error=await dispatchTranscription({requestBody:body(),metadata,apiKey:KEY,signal:controller.signal,timeoutMs:5,fetchImpl:async(_url,{signal})=>{calls++;if(cancel)controller.abort(new DOMException(CANARY,'AbortError'));return new Promise((_resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true})})}}).then(()=>null,e=>e);assert.equal(calls,1);assert.equal(error.details.billingState,'ambiguous_after_dispatch');assert.ok(providerFailureFor(error));for(const category of ['dispatch_start','success','request_failed','usage_result_persist_failed'])assert.equal(safeOperationalLog({category,providerExplanation:providerFailureFor(error)},()=>{throw Error(CANARY)}),false);absent(row(providerFailureFor(error)))}
});
test('forged attachment and restart cannot resurrect or admit old evidence',async()=>{
 const e=capture({code:'invalid_value'}),error=new Error(CANARY);attachProviderFailure(error,{facts:[{value:CANARY}]});assert.equal(providerFailureFor(error),undefined);attachProviderFailure(error,e);assert.equal(providerFailureFor(error),e);const fresh=await import('../../src/provider-failure.js?synthetic-restart-safe');assert.equal(fresh.providerFailureFor(error),undefined);assert.equal(fresh.admittedProviderFailure(e),undefined);assert.equal(admittedProviderFailure(e),e)
});
test('non-JSON and HTML rejection integration never retains the raw body or labels it complete',async()=>{
 for(const text of [CANARY,`<html><body>${CANARY}</body></html>`]){const error=await rejectResponse(text,502);const e=providerFailureFor(error);absent(row(e));assert.equal(e.facts.length,0);assert.equal(e.completeSelectedDetails,false);assert.equal(error.details.billingState,'ambiguous_after_dispatch')}
});
test('mocked error reaches disk and support export safely; disk failure and browser export cannot leak or change billing',async()=>{
 const error=await rejectResponse(JSON.stringify({error:{message:`Unquoted ${CANARY} and "${KEY}"`,code:'invalid_value',cause:{message:CANARY,code:'ECONNRESET'}}}),500);
 const dir=await mkdtemp(path.join(tmpdir(),'cosmic-persist-error-'));
 try{
  const e=providerFailureFor(error),event={route:'/api/transcribe',category:'request_failed',status:500,openaiRequestId:'req_abcdef123',providerExplanation:e};
  assert.equal(safeOperationalLog(event,line=>writeFileSync(path.join(dir,'missing-parent','failed.jsonl'),line)),false);
  const file=path.join(dir,'actual-error.jsonl');assert.equal(safeOperationalLog(event,line=>writeFileSync(file,line+'\n')),true);
  const persisted=JSON.parse(await readFile(file,'utf8'));absent(JSON.stringify(persisted));assert.ok(persisted.droppedBefore>=1);assert.ok(has(persisted.providerExplanation,'code','ECONNRESET'));
  const support=JSON.parse(JSON.stringify({events:[persisted]}));absent(JSON.stringify(support));assert.equal(support.events[0].providerExplanation.completeProviderExplanation,false);
  const events=[];pushDiagnostic(events,makeDiagnosticEvent('request_failed',{...event,message:CANARY}));const browserExport=JSON.stringify({events});absent(browserExport);assert.equal(browserExport.includes('providerExplanation'),false);
  absent(JSON.stringify(errorToSafeJson(error,'req-123')));assert.equal(error.details.billingState,'ambiguous_after_dispatch');
 }finally{await rm(dir,{recursive:true,force:true})}
});
