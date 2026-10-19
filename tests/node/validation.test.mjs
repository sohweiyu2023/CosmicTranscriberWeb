import test from 'node:test';import assert from 'node:assert/strict';
import {validateApiKey,validateOrigin,validateTranscriptionMetadata,normalizeLanguages,normalizeKeywords,readSmallJson,validateAudioRequestHeaders} from '../../src/validation.js';

test('API keys do not require an sk prefix and any whitespace is rejected',()=>{assert.equal(validateApiKey('opaque_credential_123'),'opaque_credential_123');for(const bad of ['bad key',' key','key ','key\n'])assert.throws(()=>validateApiKey(bad))});
test('origin is exact same-origin',()=>{const env={APP_ORIGIN:'https://t.example'};validateOrigin(new Request('https://t.example/api',{headers:{Origin:'https://t.example','Sec-Fetch-Site':'same-origin'}}),env);assert.throws(()=>validateOrigin(new Request('https://t.example/api',{headers:{Origin:'https://evil.example'}}),env))});
test('server model allowlist rejects realtime and unknown fields',()=>{const base={v:1,jobId:'j-1',fileId:'f-1',chunkIndex:1,chunkCount:1,attemptId:'a-1',declaredBytes:100,durationSeconds:1,model:'gpt-transcribe',languages:[],keywords:[],prompt:'',requestKind:'transcription'};assert.equal(validateTranscriptionMetadata(base).model,'gpt-transcribe');assert.throws(()=>validateTranscriptionMetadata({...base,model:'gpt-live-transcribe'}));assert.throws(()=>validateTranscriptionMetadata({...base,url:'https://evil.example'}))});
test('request kind is strict rather than silently normalized',()=>{const base={v:1,jobId:'j-1',fileId:'f-1',chunkIndex:1,chunkCount:1,attemptId:'a-1',declaredBytes:100,durationSeconds:1,model:'gpt-transcribe',languages:[],keywords:[],prompt:'',requestKind:'transcription'};assert.equal(validateTranscriptionMetadata(base).requestKind,'transcription');assert.throws(()=>validateTranscriptionMetadata({...base,requestKind:'proxy'}));assert.throws(()=>validateTranscriptionMetadata({...base,requestKind:undefined}))});
test('diarization accepts one ISO-639-1 language but rejects prompt and keywords',()=>{const b={v:1,jobId:'j',fileId:'f',chunkIndex:1,chunkCount:1,attemptId:'a',declaredBytes:100,durationSeconds:1,model:'gpt-4o-transcribe-diarize',languages:['en'],keywords:[],prompt:'',requestKind:'transcription'};assert.deepEqual(validateTranscriptionMetadata(b).languages,['en']);for(const patch of [{prompt:'x'},{languages:['en','zh']},{languages:['eng']},{keywords:['x']}])assert.throws(()=>validateTranscriptionMetadata({...b,...patch}))});
test('language/keyword limits follow current model-specific contracts',()=>{assert.deepEqual(normalizeLanguages(['EN','zh','en','cmn','YUE','deu','zh-tw'],'gpt-transcribe'),['en','zh','cmn','yue','deu','zh-tw']);for(const bad of ['abcd','zh-sg','en-us'])assert.throws(()=>normalizeLanguages([bad],'gpt-transcribe'));assert.throws(()=>normalizeLanguages(['eng'],'gpt-4o-transcribe'));assert.deepEqual(normalizeKeywords(['Name','name'],'gpt-transcribe'),['Name']);assert.throws(()=>normalizeKeywords(['<script>'],'gpt-transcribe'))});

test('transcription metadata uses strict JSON types instead of coercion/defaults',()=>{const base={v:1,jobId:'j-1',fileId:'f-1',chunkIndex:1,chunkCount:1,attemptId:'a-1',declaredBytes:100,durationSeconds:1,model:'gpt-transcribe',languages:[],keywords:[],prompt:'',requestKind:'transcription'};for(const patch of [{chunkIndex:'1'},{chunkCount:'1'},{declaredBytes:'100'},{durationSeconds:'1'},{model:undefined},{languages:''},{keywords:null},{prompt:null}])assert.throws(()=>validateTranscriptionMetadata({...base,...patch}))});


test('small JSON route parser rejects arrays, null and primitives instead of normalizing them', async()=>{
  for(const value of ['[]','null','"x"','1']){
    const req=new Request('https://t.example/api',{method:'POST',headers:{'Content-Type':'application/json'},body:value});
    await assert.rejects(()=>readSmallJson(req),e=>e?.code==='invalid_json');
  }
  const ok=new Request('https://t.example/api',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"confirm":true}'});
  assert.deepEqual(await readSmallJson(ok),{confirm:true});
});


test('server accepts bounded final prompt after previous-context assembly',()=>{
  const base={v:1,jobId:'j',fileId:'f',chunkIndex:2,chunkCount:2,attemptId:'a',declaredBytes:100,durationSeconds:1,model:'gpt-transcribe',languages:[],keywords:[],prompt:'x'.repeat(15_000),requestKind:'transcription'};
  assert.equal(validateTranscriptionMetadata(base).prompt.length,15_000);
  assert.throws(()=>validateTranscriptionMetadata({...base,prompt:'x'.repeat(16_001)}),e=>e?.code==='invalid_prompt');
});

test('small JSON content type is exact application/json with optional parameters',async()=>{
  const ok=new Request('https://t.example/api',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:'{}'});
  assert.deepEqual(await readSmallJson(ok),{});
  for(const bad of ['application/jsonp','application/json-patch+json','text/json']){
    await assert.rejects(()=>readSmallJson(new Request('https://t.example/api',{method:'POST',headers:{'Content-Type':bad},body:'{}'})),e=>e?.status===415);
  }
});


test('unknown metadata field names are not reflected in server errors',()=>{
  const base={v:1,jobId:'j',fileId:'f',chunkIndex:1,chunkCount:1,attemptId:'a',declaredBytes:100,durationSeconds:1,model:'gpt-transcribe',languages:[],keywords:[],prompt:'',requestKind:'transcription'};
  const sentinel='PRIVATE-SENTINEL-FIELD';
  assert.throws(()=>validateTranscriptionMetadata({...base,[sentinel]:1}),e=>e?.code==='invalid_metadata'&&!String(e.message).includes(sentinel));
});

test('metadata V2 binds a supported audio format while V1 remains legacy MP3 only',()=>{
  const base={jobId:'j',fileId:'f',chunkIndex:1,chunkCount:1,attemptId:'a',declaredBytes:100,durationSeconds:1,model:'gpt-transcribe',languages:[],keywords:[],prompt:'',requestKind:'transcription'};
  assert.equal(validateTranscriptionMetadata({v:1,...base}).audioFormat,'mp3');
  assert.equal(validateTranscriptionMetadata({v:2,audioFormat:'wav',...base}).audioFormat,'wav');
  assert.throws(()=>validateTranscriptionMetadata({v:2,...base}),e=>e?.code==='invalid_metadata');
  assert.throws(()=>validateTranscriptionMetadata({v:2,audioFormat:'exe',...base}),e=>e?.code==='unsupported_audio_format');
  assert.throws(()=>validateTranscriptionMetadata({v:1,audioFormat:'wav',...base}),e=>e?.code==='invalid_metadata');
});


test('audio request headers are bound to metadata format and declared size',()=>{
  const meta={audioFormat:'wav',declaredBytes:12};
  validateAudioRequestHeaders(new Request('https://t.example/api',{method:'POST',headers:{'Content-Type':'audio/wav','Content-Length':'12'},body:new Uint8Array(12)}),meta);
  assert.throws(()=>validateAudioRequestHeaders(new Request('https://t.example/api',{method:'POST',headers:{'Content-Type':'audio/ogg','Content-Length':'12'},body:new Uint8Array(12)}),meta),e=>e?.status===415);
  assert.throws(()=>validateAudioRequestHeaders(new Request('https://t.example/api',{method:'POST',headers:{'Content-Type':'audio/wav','Content-Length':'11'},body:new Uint8Array(11)}),meta),e=>e?.code==='size_mismatch');
});
