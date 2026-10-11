import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {inspectAndChunkMp3,materializeChunk,parseFrameHeader} from '../../public/js/mp3.js';
const F=new URL('../fixtures/',import.meta.url);
async function blob(name){return new Blob([await readFile(new URL(name,F))],{type:'audio/mpeg'})}
function ffprobeDuration(path){const ff=spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',path],{encoding:'utf8'});assert.equal(ff.status,0,ff.stderr);return Number(ff.stdout.trim())}

async function decodeAllChunks(b,r,prefix='ctw-mp3-'){
 const dir=await mkdtemp(join(tmpdir(),prefix));try{for(const c of r.chunks){const bytes=new Uint8Array(await materializeChunk(b,c).arrayBuffer());assert.equal(bytes.length,c.bytes);const p=join(dir,`part-${c.index}.mp3`);await writeFile(p,bytes);assert.ok(ffprobeDuration(p)>0)}}finally{await rm(dir,{recursive:true,force:true})}
}

test('parses common MPEG frame header',()=>{const h=Uint8Array.from([0xff,0xfb,0x90,0x64]);const f=parseFrameHeader(h);assert.equal(f.version,1);assert.equal(f.layer,3);assert.equal(f.bitrate,128000);assert.equal(f.sampleRate,44100);assert.equal(f.frameLength,417)});

test('CBR chunks preserve exact logical frame continuity and decoder-visible duration',async()=>{
 const b=await blob('cbr-128k-370s.mp3');const r=await inspectAndChunkMp3(b,{targetBytes:5_000_000,maxMinutes:3,diarize:false});assert.ok(r.chunks.length>=3);assert.ok(r.duration>369&&r.duration<371);assert.equal(r.metadataCarrier,true);assert.deepEqual(r.recoveries.gaps,[]);
 for(let i=0;i<r.chunks.length;i++){const c=r.chunks[i];assert.equal(c.sourceEnd-c.sourceStart,c.bytes);assert.ok(c.bytes<=24_000_000);if(i>0)assert.equal(r.chunks[i-1].logicalSourceEnd,c.logicalSourceStart)}
 const dir=await mkdtemp(join(tmpdir(),'ctw-mp3-'));try{for(const c of r.chunks){const bytes=new Uint8Array(await materializeChunk(b,c).arrayBuffer());assert.equal(bytes.length,c.bytes);const p=join(dir,`part-${c.index}.mp3`);await writeFile(p,bytes);const actual=ffprobeDuration(p);const expected=c.duration+c.prerollDuration;assert.ok(Math.abs(actual-expected)<1.6,`chunk ${c.index}: ffprobe=${actual}, expected=${expected}`)}}finally{await rm(dir,{recursive:true,force:true})}
});

test('diarization chunks have no overlap and exact source continuity for clean MP3',async()=>{const b=await blob('cbr-128k-370s.mp3');const r=await inspectAndChunkMp3(b,{targetBytes:5_000_000,maxMinutes:3,diarize:true});for(let i=1;i<r.chunks.length;i++){assert.equal(r.chunks[i].prerollDuration,0);assert.equal(r.chunks[i].sourceStart,r.chunks[i-1].sourceEnd);assert.equal(r.chunks[i].logicalSourceStart,r.chunks[i-1].logicalSourceEnd)}});

test('VBR and ID3-tagged MP3 validate and split chunks decode',async()=>{for(const n of ['vbr-190s.mp3','ID3 Unicode 東京.mp3']){const b=await blob(n);const r=await inspectAndChunkMp3(b,{targetBytes:5_000_000,maxMinutes:3});assert.ok(r.frameCount>0);assert.ok(r.duration>1);await decodeAllChunks(b,r,'ctw-vbr-')}});

test('empty and wholly corrupt inputs still fail when there is no usable MPEG audio',async()=>{for(const n of ['zero-byte.mp3','corrupt.mp3'])await assert.rejects(async()=>inspectAndChunkMp3(await blob(n),{}),/empty|No valid|No usable/)});

test('terminally truncated MP3 is recovered and remains decoder-readable',async()=>{const b=await blob('truncated.mp3');const r=await inspectAndChunkMp3(b,{targetBytes:5_000_000,maxMinutes:3});assert.ok(r.frameCount>0);assert.ok(r.recoveries.terminalPartialBytes>0||r.recoveries.trailingBytes>0);await decodeAllChunks(b,r,'ctw-trunc-')});

test('standard ID3v1 and arbitrary decoder-tolerable trailing bytes do not reject otherwise valid MP3',async()=>{
 const source=new Uint8Array(await (await blob('vbr-190s.mp3')).arrayBuffer());
 const tag=new Uint8Array(128);tag.set([0x54,0x41,0x47]);tag.set(new TextEncoder().encode('Cosmic ID3v1 test').slice(0,30),3);
 const tagged=new Blob([source,tag],{type:'audio/mpeg'});const rt=await inspectAndChunkMp3(tagged,{targetBytes:5_000_000,maxMinutes:3});assert.ok(rt.frameCount>0);
 const ffTail=new Uint8Array(1600);ffTail.fill(0xff);const padded=new Blob([source,ffTail],{type:'audio/mpeg'});const rp=await inspectAndChunkMp3(padded,{targetBytes:5_000_000,maxMinutes:3});assert.ok(rp.frameCount>0);assert.ok(rp.recoveries.trailingBytes>=1600);await decodeAllChunks(padded,rp,'ctw-tail-');
 const arbitrary=new Uint8Array(333);for(let i=0;i<arbitrary.length;i++)arbitrary[i]=(i*29+17)&255;const ra=await inspectAndChunkMp3(new Blob([source,arbitrary],{type:'audio/mpeg'}),{targetBytes:5_000_000,maxMinutes:3});assert.ok(ra.frameCount>0);assert.ok(ra.recoveries.trailingBytes>=333);
});

test('leading junk and recoverable mid-stream junk are skipped instead of rejecting the whole recording',async()=>{
 const source=new Uint8Array(await (await blob('vbr-190s.mp3')).arrayBuffer());const lead=new Uint8Array(73);lead.fill(0x55);const leading=new Blob([lead,source],{type:'audio/mpeg'});const rl=await inspectAndChunkMp3(leading,{targetBytes:5_000_000,maxMinutes:3});assert.ok(rl.recoveries.leadingBytes>=73);await decodeAllChunks(leading,rl,'ctw-lead-');
 const cut=Math.floor(source.length/2);const junk=new TextEncoder().encode('NOT-AUDIO-METADATA-BLOCK'.repeat(17));const middle=new Blob([source.subarray(0,cut),junk,source.subarray(cut)],{type:'audio/mpeg'});const rm=await inspectAndChunkMp3(middle,{targetBytes:5_000_000,maxMinutes:3});assert.ok(rm.frameCount>0);assert.ok(rm.recoveries.gaps.length>=1||rm.recoveries.trailingBytes>0);
});

