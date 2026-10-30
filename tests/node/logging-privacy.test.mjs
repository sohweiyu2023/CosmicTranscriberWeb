import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDiagnosticEvent,pushDiagnostic,diagnosticCompleteness,diagnosticErrorFields,makeDiagnosticExport,preferenceFailure,browserIdentity} from '../../public/js/diagnostics.js';
import {safeOperationalLog} from '../../src/operational-log.js';
import {dispatchTranscription} from '../../src/openai.js';
import {assertPreparedDiagnostic} from '../safari/native-file-contract.mjs';

const secret='TEST_ONLY_PRIVATE_PROMPT@example.invalid';
const meta={attemptId:'attempt-'+ 'a'.repeat(24),declaredBytes:4,model:'gpt-transcribe',languages:[],keywords:[],prompt:''};
async function collect(stream){for await(const _ of stream){/* consume only synthetic upload */}}
async function dispatch(fetchImpl,extra={}){return dispatchTranscription({requestBody:new Blob([new Uint8Array(4)]).stream(),metadata:meta,apiKey:'offline-fake-only',fetchImpl:async(url,init)=>{await collect(init.body);return fetchImpl(url,init)},...extra})}

test('typed envelopes reject fake secrets in every formerly free-form field and reserved overwrite',()=>{
  const fields={time:secret,pageElapsedMs:secret,category:secret,code:secret,errorName:secret,phase:secret,model:secret,openaiRequestId:secret,requestId:secret,fileRef:secret,user:secret,random:secret,status:secret,elapsedMs:secret,providerCode:secret,providerType:secret};
  const event=makeDiagnosticEvent('chunk_failure',fields);
  assert.equal(event.category,'chunk_failure');assert.notEqual(event.time,secret);
  const text=JSON.stringify(event);assert.ok(!text.includes(secret));assert.equal(event.code,'unknown_error');
  let line;assert.equal(safeOperationalLog({...fields,route:'/api/admin/users/'+secret},value=>line=value),true);
  assert.ok(!line.includes(secret));assert.equal(JSON.parse(line).route,'/api/admin/users/:id');
});

test('cyclic/deep arrays and hostile getters are not traversed or retained',()=>{
  const cycle=[];cycle.push(cycle);let deep=[];for(let i=0;i<20000;i++)deep=[deep];
  let reads=0;const fields={code:cycle,phase:deep,anything:cycle};Object.defineProperty(fields,'model',{get(){reads++;throw Error(secret)}});
  const event=makeDiagnosticEvent('window_error',fields);assert.equal(reads,0);assert.ok(JSON.stringify(event).length<400);
  assert.doesNotThrow(()=>makeDiagnosticEvent(secret,new Proxy({},{getOwnPropertyDescriptor(){throw Error(secret)}})));
});

test('ring reports losses, unknown classification and failed writes; records are immutable',()=>{
  const events=[];for(let i=0;i<1300;i++)pushDiagnostic(events,makeDiagnosticEvent('chunk_success',{chunk:i}));
  assert.equal(events.length,1200);assert.equal(diagnosticCompleteness(events).dropped,100);
  assert.equal(diagnosticCompleteness(events).completeObservedStream,false);
  assert.throws(()=>events[0].category=secret);
  const frozen=Object.freeze([]);assert.equal(pushDiagnostic(frozen,makeDiagnosticEvent('success')),null);assert.equal(diagnosticCompleteness(frozen).writeFailures,1);
  const unknown=[];pushDiagnostic(unknown,makeDiagnosticEvent(secret));assert.equal(diagnosticCompleteness(unknown).unknown,1);
});

test('storage read/parse/write/repair failures expose only finite category, not stored contents',()=>{
  const events=[];
  for(const [operation,name] of [['read','SecurityError'],['parse','SyntaxError'],['write','QuotaExceededError'],['repair','Error']]){
    preferenceFailure(operation,{name,message:secret,code:secret},(category,fields)=>pushDiagnostic(events,makeDiagnosticEvent(category,fields)));
  }
  assert.deepEqual(events.map(x=>x.storageCategory),['unavailable','malformed','quota','unknown']);assert.ok(!JSON.stringify(events).includes(secret));
  assert.doesNotThrow(()=>preferenceFailure('write',{name:'Error'},()=>{throw Error(secret)}));
});

test('export removes arbitrary browser/server strings and raw queue/checkpoint content',()=>{
  const result=makeDiagnosticExport({appVersion:secret,runtime:{pageSessionId:secret},browser:{userAgent:secret,language:secret},session:{serverVersion:secret},settings:{prompt:secret},queue:[{ref:secret,status:secret,text:secret}],events:[]});
  assert.ok(!JSON.stringify(result).includes(secret));assert.equal(result.eventCompleteness.fullApplicationCoverage,false);
  assert.equal(diagnosticErrorFields({name:secret,code:secret,message:secret}).code,'unknown_error');
  const forged=makeDiagnosticExport({events:[{category:'chunk_failure',code:secret}]});
  assert.equal(forged.eventCompleteness.completeObservedStream,false);assert.equal(forged.eventCompleteness.tracked,false);
  assert.equal(forged.events[0].category,'unknown_event');
  assert.equal(diagnosticErrorFields({code:'user_cancelled',name:'AbortError'}).code,'user_cancelled');
  assert.equal(makeDiagnosticExport({queue:[{status:'ready',errorCode:null,completedModel:null}]}).queue[0].errorCode,null);
  for(const mutate of [rows=>rows[0]={category:secret},rows=>rows.push(makeDiagnosticEvent('success')),rows=>rows.push({category:secret})]){
    const rows=[];pushDiagnostic(rows,makeDiagnosticEvent('success'));mutate(rows);
    const exported=makeDiagnosticExport({events:rows});assert.equal(exported.eventCompleteness.completeObservedStream,false);assert.equal(exported.eventCompleteness.integrity,false);assert.ok(!JSON.stringify(exported).includes(secret));
  }
});

test('throwing sinks never escape at dispatch/success/failure/accounting stages',()=>{
  for(const category of ['dispatch_start','success','request_failed','usage_result_persist_failed'])assert.equal(safeOperationalLog({category,route:'/api/transcribe'},()=>{throw Error(secret)}),false);
  let row;safeOperationalLog({category:'success'},line=>row=JSON.parse(line));assert.ok(row.droppedBefore>=4);
  safeOperationalLog({category:'success'},line=>row=JSON.parse(line));assert.equal(row.droppedBefore,0);
});

for(const [name,status,body,expected] of [
  ['nested quota',429,JSON.stringify({error:{code:'insufficient_quota',type:'insufficient_quota',message:secret,param:secret}}),'provider_rejection'],
  ['malformed',502,'{'+secret,'malformed_json'],['HTML',502,'<html>'+secret+'</html>','html_response'],
  ['unknown nested',400,JSON.stringify({error:{code:{secret},type:secret,message:secret}}),'provider_rejection']
])test('provider '+name+' preserves billing classification without retaining body',async()=>{
  const error=await dispatch(()=>new Response(body,{status,headers:{'x-request-id':'req_abc123'}})).then(()=>null,error=>error);
  assert.ok(error);assert.equal(error.details.causeCategory,expected);assert.equal(error.details.openaiRequestId,'req_abc123');
  assert.ok(!JSON.stringify(error.details).includes(secret));assert.equal(error.details.billingState,[400,429].includes(status)?'explicit_rejection':'ambiguous_after_dispatch');
  if(status===429)assert.equal(error.code,'openai_quota_or_billing');
});

test('interrupted response retains request ID/cause with ambiguous billing, no transport message',async()=>{
  const error=await dispatch(()=>new Response(new ReadableStream({start(c){c.error(Error(secret))}}),{headers:{'x-request-id':'req_abc123'}})).then(()=>null,error=>error);
  assert.equal(error.details.causeCategory,'body_read');assert.equal(error.details.openaiRequestId,'req_abc123');assert.equal(error.details.billingState,'completed_or_ambiguous');assert.ok(!JSON.stringify(error).includes(secret));
});
test('oversized response retains request ID/cause and remains nonretryable',async()=>{
  const error=await dispatch(()=>new Response(new ReadableStream({start(c){for(let i=0;i<5;i++)c.enqueue(new Uint8Array(1024*1024));c.close()}}),{headers:{'x-request-id':'req_abc123'}})).then(()=>null,error=>error);
  assert.equal(error.details.causeCategory,'response_limit');assert.equal(error.details.openaiRequestId,'req_abc123');assert.equal(error.details.billingState,'completed_or_ambiguous');
});
test('transport, redirect and malformed success have bounded cause and no retry',async()=>{
  for(const [mock,cause] of [[()=>{throw Error(secret)},'transport'],[()=>new Response(null,{status:302}),'redirect'],[()=>new Response('<html>'+secret),'html_response']]){
    let calls=0;const error=await dispatch((...args)=>{calls++;return mock(...args)}).then(()=>null,e=>e);
    assert.equal(calls,1);assert.equal(error.details.causeCategory,cause);assert.match(error.details.billingState,/ambiguous/);assert.ok(!JSON.stringify(error).includes(secret));
  }
});

test('transport causes retain only finite codes from a single cause link',async()=>{
  for(const [code,expected] of [['ECONNRESET','ECONNRESET'],[secret,'unknown']]){
    const error=await dispatch(()=>{throw new TypeError(secret,{cause:{code,message:secret}})}).then(()=>null,e=>e);
    assert.equal(error.details.transportCode,expected);assert.equal(error.details.errorName,'TypeError');assert.ok(!JSON.stringify(error).includes(secret));
  }
});

test('browser/server context retains only useful typed hints, never the raw user agent',()=>{
  assert.deepEqual(browserIdentity('Mozilla private data Chrome/145.0.0.0'),{family:'Chromium',major:145});
  assert.deepEqual(browserIdentity(secret),{family:'unknown',major:null});
  const exported=makeDiagnosticExport({browser:{userAgent:'private Chrome/145.0.0.0 '+secret},session:{serverVersion:'1.2.0',accountStatus:'active',registrationMode:'open'}});
  assert.deepEqual(exported.browser.identityHint,{family:'Chromium',major:145});assert.equal(exported.session.serverVersion,'1.2.0');assert.equal(exported.session.accountStatus,'active');assert.ok(!JSON.stringify(exported).includes(secret));
});

test('export preserves fractional duration and nullable fields required by the existing native-file contract; synthetic only',()=>{
  const ref='f-'+ 'a'.repeat(24),events=[];
  pushDiagnostic(events,makeDiagnosticEvent('file_prepared',{fileRef:ref,size:4,chunks:1,duration:.75,audioFormat:'wav'}));
  const report=makeDiagnosticExport({queue:[{ref,size:4,chunks:1,status:'ready',errorCode:null,completedModel:null,duration:.75}],events});
  assert.equal(report.queue[0].duration,.75);assert.equal(report.events[0].duration,.75);assert.equal(report.queue[0].errorCode,null);
  // The independent native acceptance contract intentionally excludes <0.5s
  // oracles. Keep that threshold intact; this is a synthetic schema test only.
  assertPreparedDiagnostic(report,{name:'synthetic.wav',format:'wav',before:{size:4},expectedDuration:.75});
  assert.equal(makeDiagnosticExport({queue:[{status:'ready',duration:.25}]}).queue[0].duration,.25);
  assert.equal(makeDiagnosticEvent('chunk_dispatch_started',{durationSeconds:.125}).durationSeconds,.125);
});
