import test from 'node:test';import assert from 'node:assert/strict';
import {dispatchTranscription} from '../../src/openai.js';
function meta(model='gpt-transcribe',audioFormat='mp3'){return {attemptId:'a-123',declaredBytes:4,durationSeconds:1,model,audioFormat,languages:model==='gpt-transcribe'||model.includes('diarize')?['en']:[],keywords:model==='gpt-transcribe'?['Cosmic']:[],prompt:model.includes('diarize')?'':'faithful'}}
function body(bytes=[1,2,3,4]){return new Blob([Uint8Array.from(bytes)]).stream()}
async function collect(stream){const r=stream.getReader();const a=[];while(true){const x=await r.read();if(x.done)break;a.push(x.value)}return Buffer.concat(a.map(x=>Buffer.from(x)))}

test('upstream is hard-coded, auth is server-created, redirect fails',async()=>{let seen;const fetchImpl=async(url,init)=>{seen={url,init,bytes:await collect(init.body)};return new Response(JSON.stringify({text:'ok'}),{status:200,headers:{'x-request-id':'req-test'}})};const r=await dispatchTranscription({requestBody:body(),metadata:meta(),apiKey:'secret-test',fetchImpl});assert.equal(seen.url,'https://api.openai.com/v1/audio/transcriptions');assert.equal(seen.init.redirect,'manual');assert.equal(seen.init.headers.Authorization,'Bearer secret-test');assert.equal(r.diagnostics.openaiRequestId,'req-test');const txt=seen.bytes.toString('utf8');assert.match(txt,/name="model"\r\n\r\ngpt-transcribe/);assert.match(txt,/name="languages\[\]"/);assert.match(txt,/name="keywords\[\]"/);assert.match(txt,/filename="audio.mp3"/)});
test('diarization uses diarized_json and auto chunking without prompt',async()=>{let txt='';const fetchImpl=async(_u,i)=>{txt=(await collect(i.body)).toString('utf8');return new Response(JSON.stringify({text:'ok',segments:[]}),{status:200})};await dispatchTranscription({requestBody:body(),metadata:meta('gpt-4o-transcribe-diarize'),apiKey:'k',fetchImpl});assert.match(txt,/diarized_json/);assert.match(txt,/chunking_strategy/);assert.match(txt,/name="language"\r\n\r\nen/);assert.doesNotMatch(txt,/name="prompt"/);assert.doesNotMatch(txt,/name="keywords\[\]"/)});
test('explicit 429 and ambiguous 5xx have distinct billing state',async()=>{await assert.rejects(()=>dispatchTranscription({requestBody:body(),metadata:meta(),apiKey:'k',fetchImpl:async(_u,i)=>{await collect(i.body);return new Response('{"error":{"code":"rate_limit_exceeded"}}',{status:429})}}),e=>e.code==='openai_rate_limited'&&e.details.billingState==='explicit_rejection');await assert.rejects(()=>dispatchTranscription({requestBody:body(),metadata:meta(),apiKey:'k',fetchImpl:async(_u,i)=>{await collect(i.body);return new Response('{"error":{}}',{status:500})}}),e=>e.code==='openai_server_error'&&e.details.billingState==='ambiguous_after_dispatch')});
test('actual streamed byte ceiling detects mismatch after dispatch',async()=>{await assert.rejects(()=>dispatchTranscription({requestBody:body([1,2,3,4,5]),metadata:meta(),apiKey:'k',fetchImpl:async(_u,i)=>{await collect(i.body);return new Response('{}',{status:200})}}),e=>e.code==='audio_stream_limit'&&e.details.billingState==='ambiguous_after_dispatch')});

test('response stream loss after OpenAI starts responding is billing-ambiguous',async()=>{
  const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"text":"partial'));c.error(new Error('socket reset'))}});
  await assert.rejects(()=>dispatchTranscription({requestBody:body(),metadata:meta(),apiKey:'k',fetchImpl:async(_u,i)=>{await collect(i.body);return new Response(stream,{status:200,headers:{'x-request-id':'req-partial'}})}}),e=>e.code==='upstream_ambiguous'&&e.details.billingState==='completed_or_ambiguous'&&e.details.openaiRequestId==='req-partial');
});

test('oversized upstream response is billing-ambiguous rather than silently retryable',async()=>{
  const big=new Uint8Array(1024*1024);
  const stream=new ReadableStream({start(c){for(let i=0;i<5;i++)c.enqueue(big);c.close()}});
  await assert.rejects(()=>dispatchTranscription({requestBody:body(),metadata:meta(),apiKey:'k',fetchImpl:async(_u,i)=>{await collect(i.body);return new Response(stream,{status:200})}}),e=>e.code==='upstream_response_too_large'&&e.details.billingState==='completed_or_ambiguous');
});

test('upstream timeout after dispatch is billing-ambiguous',async()=>{
  await assert.rejects(()=>dispatchTranscription({requestBody:body(),metadata:meta(),apiKey:'k',timeoutMs:5,fetchImpl:async(_u,i)=>{await collect(i.body);return await new Promise((resolve,reject)=>{i.signal.addEventListener('abort',()=>reject(i.signal.reason),{once:true})})}}),e=>e.code==='upstream_ambiguous'&&e.status===504&&e.details.billingState==='ambiguous_after_dispatch');
});


test('timeout-like HTTP 408 remains billing-ambiguous after dispatch',async()=>{
  await assert.rejects(()=>dispatchTranscription({requestBody:body(),metadata:meta(),apiKey:'k',fetchImpl:async(_u,i)=>{await collect(i.body);return new Response('{"error":{"code":"request_timeout"}}',{status:408})}}),e=>e.status===408&&e.details.billingState==='ambiguous_after_dispatch');
});


test('upstream correlation headers are bounded and control-safe before returning to client',async()=>{
  const huge='r'.repeat(300);
  const err=await dispatchTranscription({requestBody:body(),metadata:meta(),apiKey:'k',fetchImpl:async(_u,i)=>{await collect(i.body);return new Response('{}',{status:429,headers:{'x-request-id':huge,'retry-after':'2'}})}}).then(()=>null,e=>e);
  assert.equal(err.code,'openai_rate_limited');
  assert.equal(err.details.openaiRequestId.length,160);
  assert.equal(err.details.retryAfter,'2');
  const bidi=await dispatchTranscription({requestBody:body(),metadata:meta(),apiKey:'k',fetchImpl:async(_u,i)=>{await collect(i.body);const base=new Response('{"text":"ok"}',{status:200});return {status:200,ok:true,body:base.body,headers:{get(name){return String(name).toLowerCase()==='x-request-id'?'req-safe\u202Espoof':null}}}}});
  assert.equal(bidi.diagnostics.openaiRequestId,null);
});


test('upstream multipart filename and MIME are derived from validated audioFormat',async()=>{
  for(const [format,extension,mime] of [['wav','wav','audio/wav'],['m4a','m4a','audio/mp4'],['ogg','ogg','audio/ogg']]){
    let txt='';const fetchImpl=async(_u,i)=>{txt=(await collect(i.body)).toString('latin1');return new Response('{"text":"ok"}',{status:200})};
    await dispatchTranscription({requestBody:body(),metadata:meta('gpt-transcribe',format),apiKey:'k',fetchImpl});
    assert.match(txt,new RegExp(`filename="audio\.${extension}"`));
    assert.match(txt,new RegExp(`Content-Type: ${mime.replace('/','\/')}\r\n`));
  }
});

test('validated MPGA uses the MP3 upstream filename without rewriting audio or job identity',async()=>{
  const frame=new Uint8Array(417);frame.set([0xff,0xfb,0x90,0x64]);
  const audio=new Uint8Array(834);audio.set(frame);audio.set(frame,417);
  const metadata=Object.freeze({...meta('gpt-transcribe','mpga'),declaredBytes:audio.length});
  let file,requestId;
  await dispatchTranscription({requestBody:body(audio),metadata,apiKey:'test-only',fetchImpl:async(url,init)=>{
    const request=new Request(url,{method:'POST',headers:init.headers,body:await collect(init.body)});
    file=(await request.formData()).get('file');requestId=init.headers['X-Client-Request-Id'];
    return new Response('{"text":"ok"}',{status:200});
  }});
  assert.equal(file.name,'audio.mp3');assert.equal(file.type,'audio/mpeg');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()),audio);
  assert.equal(metadata.audioFormat,'mpga');assert.equal(requestId,`ctw-${metadata.attemptId}`);
});
