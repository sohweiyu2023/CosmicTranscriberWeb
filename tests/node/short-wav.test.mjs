import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {shortPcmWavSeconds} from '../../src/short-wav.js';
import {dispatchTranscription} from '../../src/openai.js';
import {validateTranscriptionMetadata} from '../../src/validation.js';
function wav(seconds=1){const n=seconds*32000,b=Buffer.alloc(44+n);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n,40);return b;}
test('short proof accepts complete 16kHz mono PCM16 through exactly30seconds',()=>{
 for(const seconds of [0.5,15,30])assert.equal(shortPcmWavSeconds(wav(seconds)),seconds);
 assert.equal(shortPcmWavSeconds(wav(30.5)),null);
 const b=wav(1),wrapped=Buffer.concat([Buffer.from([99]),b]);assert.equal(shortPcmWavSeconds(wrapped.subarray(1)),1);
});
test('ambiguous/truncated/unsupported WAV never earns single-block proof',()=>{
 const b=wav(1);for(const change of [x=>x.writeUInt32LE(1,4),x=>x.writeUInt16LE(3,20),x=>x.writeUInt16LE(2,22),x=>x.writeUInt32LE(48000,24),x=>x.writeUInt32LE(1,28),x=>x.writeUInt16LE(4,32),x=>x.writeUInt16LE(24,34),x=>x.writeUInt32LE(32001,40)]){const x=Buffer.from(b);change(x);assert.equal(shortPcmWavSeconds(x),null);}
 assert.equal(shortPcmWavSeconds(b.subarray(0,-1)),null);assert.equal(shortPcmWavSeconds(new Uint8Array()),null);
 for(const tag of ['data','fmt ','JUNK','LIST']){const c=Buffer.alloc(12);c.write(tag);c.writeUInt32LE(4,4);c.write('wavl',8);const x=Buffer.concat([b,c]);x.writeUInt32LE(x.length-8,4);assert.equal(shortPcmWavSeconds(x),null);}
});
test('server proof, not client duration, controls the actual upstream multipart field',async()=>{
 for(const [seconds,claimed,flag,auto] of [[15,999,true,false],[31,0.1,false,true],[15,15,false,true],[15,15,'true',true]]){
  const bytes=wav(seconds);let multipart='';let calls=0;
  const proof=shortPcmWavSeconds(bytes)!==null;
  await dispatchTranscription({requestBody:new Blob([bytes]).stream(),metadata:{model:'gpt-4o-transcribe-diarize',audioFormat:'wav',durationSeconds:claimed,declaredBytes:bytes.length,attemptId:'offline-test',languages:[],keywords:[],prompt:''},verifiedShortWav:flag===true?proof:flag,apiKey:'offline-fake',fetchImpl:async(_u,init)=>{calls++;multipart=await new Response(init.body).text();return new Response('{"text":"offline only","segments":[]}',{status:200});}});
  assert.equal(calls,1);assert.equal(multipart.includes('name="chunking_strategy"'),auto);assert.ok(multipart.includes('diarized_json'));
 }
});
test('request route derives proof from the same authenticated validated bytes sent upstream',async()=>{
 const source=await readFile(new URL('../../src/index.js',import.meta.url),'utf8');
 assert.ok(source.includes('shortPcmWavSeconds(verifiedAudio) !== null'));
 assert.ok(source.includes('requestBody: new Blob([verifiedAudio]).stream()'));
 assert.ok(source.includes('signal: request.signal, verifiedMpegLayer3, verifiedShortWav'));
 assert.ok(source.indexOf('const verifiedShortWav')>source.indexOf('await readAndValidateAudioBody(request, metadata)'));
 assert.ok(source.indexOf('const verifiedShortWav')<source.indexOf('await recordTranscriptionDispatch(env, principal, metadata)'));
});

test('untrusted client metadata cannot supply the server proof flag',()=>{
 const metadata={v:2,audioFormat:'wav',jobId:'offline-job',fileId:'offline-file',attemptId:'offline-attempt',chunkIndex:1,chunkCount:1,declaredBytes:32044,durationSeconds:1,model:'gpt-4o-transcribe-diarize',languages:[],keywords:[],prompt:'',requestKind:'transcription'};
 validateTranscriptionMetadata(metadata);
 assert.throws(()=>validateTranscriptionMetadata({...metadata,verifiedShortWav:true}),e=>e.code==='invalid_metadata');
});
