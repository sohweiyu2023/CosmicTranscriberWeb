import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {inspectAndChunkMp3,materializeChunk} from '../../public/js/mp3.js';

export const NATIVE_FIXTURES=Object.freeze([
  ['format.mp3','mp3',1,['','audio/mpeg','audio/mp3','audio/x-mp3','audio/x-mpeg']],
  ['format.flac','flac',1,['','audio/flac','audio/x-flac']],
  ['format.mp4','mp4',1,['','audio/mp4','video/mp4']],
  ['format.mpeg','mpeg',1,['','audio/mpeg','audio/x-mpeg','video/mpeg']],
  ['format.mpga','mpga',1,['','audio/mpeg','audio/x-mpeg']],
  ['format.m4a','m4a',1,['','audio/mp4','audio/x-m4a']],
  ['format.ogg','ogg',1,['','audio/ogg','application/ogg']],
  ['format.wav','wav',1,['','audio/wav','audio/x-wav','audio/wave','audio/vnd.wave']],
  ['format.webm','webm',1,['','audio/webm','video/webm']],
  ['ID3 Unicode 東京.mp3','mp3',4,['','audio/mpeg','audio/mp3','audio/x-mp3','audio/x-mpeg']]
].map(([name,format,toneSeconds,mimeTypes])=>Object.freeze({name,format,toneSeconds,mimeTypes:Object.freeze(mimeTypes)})));

export const CANONICAL_MIME=Object.freeze({mp3:'audio/mpeg',flac:'audio/flac',mp4:'audio/mp4',mpeg:'audio/mpeg',mpga:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',wav:'audio/wav',webm:'audio/webm'});
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export function assertDuration(actual,expected,label){
  assert.ok(Number.isFinite(expected)&&expected>=0.5,`${label}: invalid independent duration oracle`);
  assert.ok(Number.isFinite(actual)&&actual>=0.5,`${label}: missing/invalid decoded duration (${actual}); 0.001 fallback is not acceptance`);
  const tolerance=Math.max(0.15,expected*0.03);
  assert.ok(Math.abs(actual-expected)<=tolerance,`${label}: ${actual}s differs from independently decoded ${expected}s (tolerance ${tolerance}s)`);
}

export async function fixtureIdentity(file){
  const [bytes,info]=await Promise.all([readFile(file),stat(file,{bigint:true})]);
  return {size:bytes.length,sha256:sha256(bytes),mtimeNs:info.mtimeNs.toString()};
}

export async function describeFixture(root,spec){
  const file=path.join(root,'tests','fixtures',spec.name);
  const [bytes,before]=await Promise.all([readFile(file),fixtureIdentity(file)]);
  const probe=spawnSync(process.env.FFPROBE||'ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(probe.status,0,`${spec.name}: independent ffprobe failed: ${probe.error?.message||probe.stderr}`);
  const expectedDuration=Number(probe.stdout.trim());
  assertDuration(expectedDuration,spec.toneSeconds,`${spec.name}: committed tone duration`);
  const middle=Math.floor(bytes.length/2);
  const ranges=[[0,bytes.length],[0,Math.min(1024,bytes.length)],[middle,Math.min(middle+257,bytes.length)],[Math.max(0,bytes.length-333),bytes.length]];
  let expectedDispatch={bytes:before.size,sha256:before.sha256};
  if(spec.format==='mp3'){
    // Separate Node-side oracle for the reviewed MP3 frame transformation.
    // This buffer is never supplied to Safari; Safari still selects the disk path.
    const nodeFile=new File([bytes],spec.name,{type:'audio/mpeg'});
    const inspection=await inspectAndChunkMp3(nodeFile,{targetBytes:20_000_000,maxMinutes:5,diarize:false});
    assert.equal(inspection.chunks.length,1,`${spec.name}: expected exactly one Node-reference MP3 chunk`);
    assertDuration(inspection.duration,expectedDuration,`${spec.name}: Node-side MP3 preparation`);
    const prepared=Buffer.from(await materializeChunk(nodeFile,inspection.chunks[0]).arrayBuffer());
    expectedDispatch={bytes:prepared.length,sha256:sha256(prepared)};
  }
  return {...spec,file,before,expectedDuration,expectedDispatch,slices:ranges.map(([start,end])=>({start,end,size:end-start,sha256:sha256(bytes.subarray(start,end))}))};
}

export function assertNativeObservation(actual,fixture){
  assert.equal(actual.error,undefined,`${fixture.name}: native File read failed: ${actual.error}`);
  assert.equal(actual.isFile,true,`${fixture.name}: input must supply a native File`);
  assert.equal(actual.name,fixture.name,'Native file name must be preserved exactly');
  assert.equal(actual.size,fixture.before.size,`${fixture.name}: native file size`);
  assert.equal(actual.sha256,fixture.before.sha256,`${fixture.name}: full native read identity`);
  assert.ok(fixture.mimeTypes.includes(actual.type),`${fixture.name}: unexpected native MIME hint ${JSON.stringify(actual.type)}`);
  const expectedModified=Number(BigInt(fixture.before.mtimeNs)/1_000_000n);
  assert.ok(Number.isInteger(actual.lastModified)&&Math.abs(actual.lastModified-expectedModified)<=1,`${fixture.name}: native lastModified differs from unchanged on-disk time`);
  assert.deepEqual(actual.slices,fixture.slices,`${fixture.name}: sliced native read identities`);
  assertDuration(actual.duration,fixture.expectedDuration,`${fixture.name}: Safari media metadata`);
}

export function assertPreparedDiagnostic(diagnostic,fixture){
  assert.equal(diagnostic.schema,'cosmic-web-diagnostics-2');
  assert.equal(diagnostic.queue.length,1,`${fixture.name}: exactly one prepared queue item`);
  const item=diagnostic.queue[0];
  assert.equal(item.size,fixture.before.size);
  assert.equal(item.status,'ready');
  assert.equal(item.chunks,1);
  assert.equal(item.errorCode,null);
  assertDuration(item.duration,fixture.expectedDuration,`${fixture.name}: actual application preparation`);
  const prepared=diagnostic.events.filter(event=>event.category==='file_prepared'&&event.fileRef===item.ref).at(-1);
  assert.ok(prepared,`${fixture.name}: missing successful preparation diagnostic`);
  assert.equal(prepared.audioFormat,fixture.format);
  assertDuration(prepared.duration,fixture.expectedDuration,`${fixture.name}: preparation event`);
}

export function assertDispatch(record,fixture){
  const meta=record.metadata;
  assert.ok(meta,`${fixture.name}: missing app metadata`);
  assert.equal(meta.v,2);
  assert.equal(meta.audioFormat,fixture.format);
  assert.equal(meta.chunkIndex,1);
  assert.equal(meta.chunkCount,1);
  assert.equal(meta.model,'gpt-transcribe');
  assert.equal(meta.requestKind,'transcription');
  assert.match(meta.attemptId,/^attempt-[0-9a-f]{24}$/);
  assert.match(meta.jobId,/^(?:run|job)-[0-9a-f]{24}$/);
  assert.match(meta.fileId,/^file-[0-9a-f]{24}$/);
  assert.equal(meta.declaredBytes,record.bytes);
  assert.equal(record.contentType,CANONICAL_MIME[fixture.format]);
  assertDuration(meta.durationSeconds,fixture.expectedDuration,`${fixture.name}: dispatched duration`);
  assert.ok(record.bytes>0&&record.bytes<=fixture.before.size);
  assert.match(record.sha256,/^[0-9a-f]{64}$/);
  assert.equal(record.bytes,fixture.expectedDispatch.bytes,`${fixture.name}: expected prepared dispatch size`);
  assert.equal(record.sha256,fixture.expectedDispatch.sha256,`${fixture.name}: expected prepared dispatch identity`);
  if(fixture.format!=='mp3'){
    assert.equal(record.bytes,fixture.before.size,`${fixture.name}: whole-file bytes must be preserved`);
    assert.equal(record.sha256,fixture.before.sha256,`${fixture.name}: whole-file dispatch identity`);
  }
}
