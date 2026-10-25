import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyProbe,verifyDecodedSamples,DECODED_SAMPLES,safePreparationFailure,prepareFixtures} from '../../scripts/prepare-remaining-eight-fixtures.mjs';
import {FIXTURES} from '../../scripts/staging-remaining-eight-policy.mjs';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const wav=FIXTURES.find(f=>f.format==='wav');
const valid=()=>({format:{size:String(wav.bytes),duration:'15.009938'},streams:[{codec_type:'audio',codec_name:'pcm_s16le',sample_rate:'16000',channels:1,bits_per_sample:16}]});
test('fixed WAV probe agrees with actual-byte duration and preserves the pinned identity',()=>{
 const row=verifyProbe(wav,valid());assert.equal(row.sha256,wav.sha256);assert.equal(row.durationSeconds,15.009938);assert.equal(row.decode,'PASS');
});
test('wrong duration, size, codec, layout and extra streams cannot earn readiness',()=>{
 for(const change of [p=>p.format.duration='12',p=>p.format.size='1',p=>p.streams[0].codec_name='aac',p=>p.streams[0].channels=2,p=>p.streams[0].sample_rate='48000',p=>p.streams[0].bits_per_sample=24,p=>p.streams.push({...p.streams[0]})]){const p=valid();change(p);assert.throws(()=>verifyProbe(wav,p));}
});

const probeFor=f=>({format:{size:String(f.bytes),duration:String(f.dispatchDurationSeconds)},streams:[{codec_type:'audio',codec_name:({flac:'flac',mp4:'aac',mpeg:'mp3',mpga:'mp3',m4a:'aac',ogg:'vorbis',wav:'pcm_s16le',webm:'opus'})[f.format],sample_rate:f.format==='webm'?'48000':'16000',channels:1,bits_per_sample:f.format==='wav'?16:0}]});
test('only the two fixed MP3 filename cases allow both observed probe duration representations',()=>{
 for(const format of ['mpeg','mpga']){
  const f=FIXTURES.find(x=>x.format===format);
  for(const duration of [12,12.096]){const p=probeFor(f);p.format.duration=String(duration);verifyProbe(f,p);}
  for(const duration of [0,11.9,12.01,12.05,12.2,60,NaN]){const p=probeFor(f);p.format.duration=String(duration);assert.throws(()=>verifyProbe(f,p),e=>e.code==='probe_duration');}
 }
 const flac=FIXTURES.find(x=>x.format==='flac'),p=probeFor(flac);p.format.duration='12.096';assert.throws(()=>verifyProbe(flac,p));
});

test('every hash-pinned format requires its exact decoded sample count',()=>{
 for(const f of FIXTURES){
  const bytes=DECODED_SAMPLES[f.format]*2;
  assert.equal(verifyDecodedSamples(f,Buffer.alloc(bytes)),bytes/2);
  for(const length of [0,bytes-2,bytes-1,bytes+2])assert.throws(()=>verifyDecodedSamples(f,Buffer.alloc(length)),e=>e.code==='decoded_samples');
  assert.throws(()=>verifyDecodedSamples(f,String(bytes)),e=>e.code==='decoded_samples');
 }
});

test('fixture diagnostics export fixed categories only, never command output or exceptions',()=>{
 const secret='secret-cookie-or-path';
 assert.deepEqual(safePreparationFailure({code:'media_command',format:'mpeg',message:secret,stdout:secret}),{status:'FAIL',code:'media_command',format:'mpeg',paidRequests:0});
 for(const error of [new Error(secret),{code:secret,format:secret},{code:'__proto__',format:'__proto__'}])assert.equal(JSON.stringify(safePreparationFailure(error)).includes(secret),false);
 assert.deepEqual(safePreparationFailure({code:secret,format:secret}),{status:'FAIL',code:'fixture_identity_or_preparation',paidRequests:0});
});

test('whole producer validates all eight probes and decoded streams before copying unchanged bytes',async()=>{
 const source=new URL('../fixtures/approved-remaining-eight/',import.meta.url),temp=await mkdtemp(path.join(tmpdir(),'cosmic-eight-pipeline-'));
 try{
  let probes=0,decodes=0;
  const run=(_exe,args,options)=>{
   if(args[0]==='-version')return {status:0,stdout:'reviewed test tool version\n'};
   const f=FIXTURES.find(x=>args.some(a=>String(a).endsWith(x.name)));assert.ok(f);
   if(args.includes('-show_entries')){probes++;const p=probeFor(f);if(['mpeg','mpga'].includes(f.format))p.format.duration='12';return {status:0,stdout:JSON.stringify(p)};}
   decodes++;assert.equal(options.encoding,null);assert.equal(options.maxBuffer,524288);assert.ok(args.includes('s16le'));return {status:0,stdout:Buffer.alloc(DECODED_SAMPLES[f.format]*2)};
  };
  const output=path.join(temp,'result'),receipt=await prepareFixtures(fileURLToPath(source),output,{run});
  assert.equal(probes,8);assert.equal(decodes,8);assert.equal(receipt.files.length,8);assert.equal(receipt.paidRequests,0);
  assert.equal((await readdir(path.join(output,'files'))).length,8);
  for(const f of FIXTURES)assert.deepEqual(await readFile(path.join(output,'files',f.name)),await readFile(new URL(f.name,source)));
  let sends=0;await assert.rejects(prepareFixtures(fileURLToPath(source),path.join(temp,'rejected'),{run:(exe,args,options)=>{
   if(args.includes('-show_entries'))return run(exe,args,options);
   if(args[0]==='-version')return run(exe,args,options);
   sends++;return {status:0,stdout:Buffer.alloc(0)};
  }}),e=>e.code==='decoded_samples');assert.equal(sends,1);
  await assert.rejects(readdir(path.join(temp,'rejected')),{code:'ENOENT'});
 }finally{await rm(temp,{recursive:true,force:true});}
});
