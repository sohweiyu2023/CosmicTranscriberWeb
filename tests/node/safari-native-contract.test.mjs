import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_FIXTURES,expectedNativeLastModified,assertDuration,assertNativeObservation,assertPreparedDiagnostic,assertDispatch} from '../safari/native-file-contract.mjs';

// Synthetic observations exercise the validator only; they are not Safari evidence.
const hash='a'.repeat(64);
const fixture={name:'format.wav',format:'wav',mimeTypes:['','audio/wav','audio/x-wav'],expectedDuration:1,before:{size:96078,sha256:hash,mtimeNs:'315504000000000000'},expectedDispatch:{bytes:96078,sha256:hash},slices:[{start:0,end:96078,size:96078,sha256:hash}]};
const observed=()=>({isFile:true,name:fixture.name,size:96078,type:'audio/wav',lastModified:315504000000,sha256:hash,slices:structuredClone(fixture.slices),duration:1});
const prepared=()=>({schema:'cosmic-web-diagnostics-2',queue:[{ref:'file-ref',size:96078,status:'ready',chunks:1,errorCode:null,duration:1}],events:[{category:'file_prepared',fileRef:'file-ref',audioFormat:'wav',duration:1}]});
const dispatched=()=>({bytes:96078,sha256:hash,contentType:'audio/wav',metadata:{v:2,audioFormat:'wav',chunkIndex:1,chunkCount:1,model:'gpt-transcribe',requestKind:'transcription',declaredBytes:96078,durationSeconds:1,attemptId:`attempt-${'a'.repeat(24)}`,jobId:`run-${'b'.repeat(24)}`,fileId:`file-${'c'.repeat(24)}`}});

test('Linux WebKit native timestamp requires the exact whole-second value, not a tolerance',()=>{
  const host={browserName:'webkit',platform:'linux'};
  assert.equal(expectedNativeLastModified(1791698653912,host),1791698653000);
  assert.equal(expectedNativeLastModified(1791698653999.75,host),1791698653000);
  assert.equal(expectedNativeLastModified(1791698654000,host),1791698654000);
  const expected=expectedNativeLastModified(1791698653912,host);
  for(const wrong of [1791698652999,1791698653001,1791698653912,1791698654000])assert.throws(()=>assert.equal(wrong,expected));
});

test('native timestamp seconds precision applies only to Linux WebKit, independent of project labels',()=>{
  for(const platform of ['linux','darwin','win32'])for(const browserName of ['chromium','firefox','webkit']){
    if(platform==='linux'&&browserName==='webkit')continue;
    assert.equal(expectedNativeLastModified(1791698653912.75,{browserName,platform}),1791698653912,`${browserName} on ${platform}`);
  }
});

test('native timestamp expectation fails closed for invalid times and unknown engine or platform',()=>{
  const host={browserName:'webkit',platform:'linux'};
  for(const invalid of [NaN,Infinity,-1,Number.MAX_SAFE_INTEGER+1,'1791698653912'])assert.throws(()=>expectedNativeLastModified(invalid,host));
  assert.throws(()=>expectedNativeLastModified(1791698653912,{browserName:'mobile-safari',platform:'linux'}));
  assert.throws(()=>expectedNativeLastModified(1791698653912,{browserName:'webkit',platform:'unknown'}));
});

test('real Safari fixture contract includes every format and exact Unicode native-file name',()=>{
  assert.deepEqual(NATIVE_FIXTURES.map(item=>item.name),['format.mp3','format.flac','format.mp4','format.mpeg','format.mpga','format.m4a','format.ogg','format.wav','format.webm','ID3 Unicode 東京.mp3']);
  assert.deepEqual(new Set(NATIVE_FIXTURES.map(item=>item.format)),new Set(['mp3','flac','mp4','mpeg','mpga','m4a','ogg','wav','webm']));
  assert.ok(NATIVE_FIXTURES.every(item=>item.toneSeconds===(item.name.startsWith('ID3')?4:1)));
});

test('duration oracle rejects preparation fallback, nonfinite values and wrong fixture durations',()=>{
  assertDuration(1.024,1,'encoder padding');assertDuration(4.048,4,'MP3 encoder padding');
  for(const value of [0,0.001,NaN,Infinity,4,0.5,1.2])assert.throws(()=>assertDuration(value,1,'test'));
  assert.throws(()=>assertDuration(1,0.001,'invalid oracle'));
});

test('native observation rejects changed full bytes, sliced bytes, MIME/name and timestamp',()=>{
  assertNativeObservation(observed(),fixture);
  for(const change of [{sha256:'b'.repeat(64)},{slices:[{...fixture.slices[0],sha256:'b'.repeat(64)}]},{name:'relabeled.mp3'},{type:'video/mp4'},{size:96077},{lastModified:315503999000},{isFile:false},{error:'NotFoundError'},{duration:0.001}]){
    assert.throws(()=>assertNativeObservation({...observed(),...change},fixture),JSON.stringify(change));
  }
});

test('Ready queue label cannot substitute for actual application preparation duration and format',()=>{
  assertPreparedDiagnostic(prepared(),fixture);
  const fallback=prepared();fallback.queue[0].duration=0.001;assert.throws(()=>assertPreparedDiagnostic(fallback,fixture));
  const wrongEvent=prepared();wrongEvent.events[0].audioFormat='mp3';assert.throws(()=>assertPreparedDiagnostic(wrongEvent,fixture));
  const eventFallback=prepared();eventFallback.events[0].duration=0.001;assert.throws(()=>assertPreparedDiagnostic(eventFallback,fixture));
  const absentEvent=prepared();absentEvent.events=[];assert.throws(()=>assertPreparedDiagnostic(absentEvent,fixture));
});

test('mocked dispatch must preserve canonical format, whole audio bytes and independently meaningful duration',()=>{
  assertDispatch(dispatched(),fixture);
  for(const change of [{contentType:'video/mp4'},{sha256:'b'.repeat(64)},{bytes:12}])assert.throws(()=>assertDispatch({...dispatched(),...change},fixture));
  for(const change of [{audioFormat:'mp3'},{declaredBytes:12},{durationSeconds:0.001},{chunkCount:2},{v:1},{attemptId:undefined},{jobId:''},{fileId:'unbound'}]){
    const record=dispatched();Object.assign(record.metadata,change);assert.throws(()=>assertDispatch(record,fixture));
  }
});

test('MP3 dispatch hash must equal the separate prepared-chunk oracle, not merely its own checkpoint',()=>{
  const mp3={...fixture,name:'format.mp3',format:'mp3',expectedDispatch:{bytes:16000,sha256:'b'.repeat(64)}};
  const record={...dispatched(),bytes:16000,sha256:'b'.repeat(64),contentType:'audio/mpeg'};
  Object.assign(record.metadata,{audioFormat:'mp3',declaredBytes:16000});assertDispatch(record,mp3);
  assert.throws(()=>assertDispatch({...record,sha256:hash},mp3));
  assert.throws(()=>assertDispatch({...record,bytes:15999,metadata:{...record.metadata,declaredBytes:15999}},mp3));
});
