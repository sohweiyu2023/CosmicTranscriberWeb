import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_FORMATS, SUPPORTED_AUDIO_FORMATS, looksLikeIsoBmff, mpegFrameInfo, validateAudioSignature, validateFormatMime } from '../../src/audio-formats.js';
import { fileAudioFormat, formatSpec as browserFormatSpec, validateWholeFile } from '../../public/js/audio-formats.js';

function box(type,payload=new Uint8Array(),{extended=false}={}){
  const h=extended?16:8; const out=new Uint8Array(h+payload.length); const n=out.length;
  if(extended){out.set([0,0,0,1],0);out.set([...type].map(c=>c.charCodeAt(0)),4);let x=n;for(let i=15;i>=8;i--){out[i]=x&255;x=Math.floor(x/256)}}
  else {out[0]=(n>>>24)&255;out[1]=(n>>>16)&255;out[2]=(n>>>8)&255;out[3]=n&255;out.set([...type].map(c=>c.charCodeAt(0)),4)}
  out.set(payload,h);return out;
}
function concat(...parts){const n=parts.reduce((a,b)=>a+b.length,0),out=new Uint8Array(n);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out}
function ftyp(extended=false){return box('ftyp',Uint8Array.from([...Buffer.from('M4A '),0,0,0,0,...Buffer.from('isom')]),{extended})}
function mpegFrame(sampleByte=0x90){const out=new Uint8Array(417);out.set([0xff,0xfb,sampleByte,0x64]);return out}

test('canonical catalog is exactly the nine V1.2 formats',()=>{
  assert.deepEqual(SUPPORTED_AUDIO_FORMATS,['mp3','flac','mp4','mpeg','mpga','m4a','ogg','wav','webm']);
  assert.equal(Object.keys(AUDIO_FORMATS).length,9);
});

test('basic direct-format signatures are fail-closed',()=>{
  assert.equal(validateAudioSignature('wav',Uint8Array.from([...Buffer.from('RIFF'),0,0,0,0,...Buffer.from('WAVE')])),true);
  assert.equal(validateAudioSignature('flac',Uint8Array.from(Buffer.from('fLaC'))),true);
  assert.equal(validateAudioSignature('ogg',Uint8Array.from(Buffer.from('OggS'))),true);
  assert.equal(validateAudioSignature('webm',Uint8Array.from([0x1a,0x45,0xdf,0xa3])),true);
  for(const f of ['wav','flac','ogg','webm']) assert.equal(validateAudioSignature(f,Uint8Array.from(Buffer.from('NOPE'))),false);
});

test('MP4/M4A require a structurally valid bounded ftyp box',()=>{
  const leading=box('free',new Uint8Array(4));
  assert.equal(looksLikeIsoBmff(concat(leading,ftyp())),true);
  assert.equal(validateAudioSignature('m4a',ftyp(true)),true);
  const embedded=concat(box('free',Uint8Array.from(Buffer.from('junkftypjunk'))),new Uint8Array(8));
  assert.equal(looksLikeIsoBmff(embedded),false);
  const malformed=ftyp();malformed[0]=0x7f;
  assert.equal(looksLikeIsoBmff(malformed),false);
});

test('MPEG family rejects fake sync and a lone exact-EOF frame, but accepts corroborated frames',()=>{
  const fake=new Uint8Array(900);fake[77]=0xff;fake[78]=0xe0;
  const exactEof=mpegFrame();
  const two=concat(mpegFrame(),mpegFrame());
  for(const f of ['mp3','mpeg','mpga']){
    assert.equal(validateAudioSignature(f,fake),false);
    assert.equal(validateAudioSignature(f,exactEof),false);
    assert.equal(validateAudioSignature(f,two),true);
  }
});

test('MPEG family rejects malformed/truncated ID3 and ID3 plus only one frame',()=>{
  const short=Uint8Array.from(Buffer.from('ID3'));
  const badSize=new Uint8Array(10);badSize.set(Buffer.from('ID3'),0);badSize[3]=4;badSize[6]=0x80;
  const id3=new Uint8Array(10);id3.set(Buffer.from('ID3'),0);id3[3]=4;
  for(const f of ['mp3','mpeg','mpga']){
    assert.equal(validateAudioSignature(f,short),false);
    assert.equal(validateAudioSignature(f,badSize),false);
    assert.equal(validateAudioSignature(f,concat(id3,mpegFrame())),false);
    assert.equal(validateAudioSignature(f,concat(id3,mpegFrame(),mpegFrame())),true);
  }
});

function encodedFrame(header){
  const buffer=new Uint8Array(2048);buffer.set(header);
  const info=mpegFrameInfo(buffer,0);
  assert.ok(info,'test frame header must be valid');
  return buffer.slice(0,info.frameLength);
}

test('MPGA accepts complete MPEG 1, 2 and 2.5 Layer III streams including VBR and ID3 tags',()=>{
  for(const versionByte of [0xfb,0xf3,0xe3]){
    const frames=concat(encodedFrame([0xff,versionByte,0x90,0x64]),encodedFrame([0xff,versionByte,0xa2,0x64]));
    const tag=new Uint8Array(10);tag.set(Buffer.from('ID3'));tag[3]=4;
    const trailer=new Uint8Array(128);trailer.set(Buffer.from('TAG'));
    assert.equal(validateAudioSignature('mpga',frames),true);
    assert.equal(validateAudioSignature('mpga',concat(tag,frames,trailer)),true);
  }
});

test('MPGA rejects other MPEG layers, mixed streams, junk and truncated tails',()=>{
  const layer3=mpegFrame();
  for(const layerByte of [0xff,0xfd]){
    const other=encodedFrame([0xff,layerByte,0x90,0x64]);
    assert.equal(validateAudioSignature('mpeg',concat(other,other)),true,'generic MPEG support remains unchanged');
    assert.equal(validateAudioSignature('mpga',concat(other,other)),false);
    assert.equal(validateAudioSignature('mpga',concat(layer3,layer3,other)),false);
    assert.equal(validateAudioSignature('mpga',concat(other,layer3,layer3)),false);
  }
  const pair=concat(layer3,layer3);
  for(const invalid of [concat(pair,layer3.subarray(0,-1)),concat(pair,new Uint8Array(1)),concat(new Uint8Array(1),pair),concat(pair,encodedFrame([0xff,0xf3,0x90,0x64])),concat(pair,encodedFrame([0xff,0xfb,0x94,0x64]))]){
    assert.equal(validateAudioSignature('mpga',invalid),false);
  }
});

import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const fixtureDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../fixtures');

test('all nine committed format fixtures pass application sniff and ffprobe readability',()=>{
  for(const format of SUPPORTED_AUDIO_FORMATS){
    const file=path.join(fixtureDir,`format.${format}`);
    const all=new Uint8Array(readFileSync(file));
    assert.equal(validateAudioSignature(format,all),true,`${format} application validation`);
    const probe=spawnSync(process.env.FFPROBE||'ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file],{encoding:'utf8'});
    assert.equal(probe.status,0,`${format} ffprobe: ${probe.stderr||''}`);
    assert.ok(Number(probe.stdout.trim())>0,`${format} positive decoder duration`);
  }
});

test('MPGA Layer III alias accepts real ID3/VBR and CBR audio and rejects its truncated version',()=>{
  for(const name of ['ID3 Unicode 東京.mp3','vbr-190s.mp3','cbr-128k-370s.mp3']){
    const bytes=new Uint8Array(readFileSync(path.join(fixtureDir,name)));
    assert.equal(validateAudioSignature('mpga',bytes),true,name);
    assert.equal(validateAudioSignature('mpga',bytes.subarray(0,-1)),false,`${name} truncated`);
  }
});

test('Windows video/mpeg browser hint accepts raw MPEG audio without changing upload MIME or bytes',async()=>{
  const bytes=readFileSync(path.join(fixtureDir,'format.mpeg'));
  for(const mime of ['video/mpeg','video/mpeg; codecs="mp3"','audio/mpeg','audio/x-mpeg','']){
    const file=new File([bytes],'native.mpeg',{type:mime});
    assert.equal(fileAudioFormat(file),'mpeg');
    assert.equal(await validateWholeFile(file,'mpeg'),true);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()),new Uint8Array(bytes));
  }
  assert.equal(browserFormatSpec('mpeg').mime,'audio/mpeg');
  assert.equal(validateFormatMime('mpeg','audio/mpeg').mime,'audio/mpeg');
  assert.throws(()=>validateFormatMime('mpeg','video/mpeg'),error=>error.status===415,'browser hint does not widen the Worker API');
  for(const extension of ['mp3','mpga','mp4','wav']){
    assert.throws(()=>fileAudioFormat(new File([bytes],`wrong.${extension}`,{type:'video/mpeg'})),/does not match/);
  }
  assert.throws(()=>fileAudioFormat(new File([bytes],'wrong.mpeg',{type:'audio/wav'})),/does not match/);
});

test('video/mpeg hint still rejects malformed audio and MPEG video/program containers',async()=>{
  const frames=concat(mpegFrame(),mpegFrame());
  const id3=new Uint8Array(10);id3.set(Buffer.from('ID3'));id3[3]=4;
  assert.equal(await validateWholeFile(new File([id3,frames],'tagged.mpeg',{type:'video/mpeg'}),'mpeg'),true);
  const invalid=[
    {name:'fake sync',bytes:Uint8Array.from([0xff,0xe0,0,0,0,0,0,0])},
    {name:'single frame',bytes:mpegFrame()},
    {name:'truncated second frame',bytes:frames.subarray(0,-1)},
    {name:'truncated ID3',bytes:Uint8Array.from(Buffer.from('ID3'))},
    {name:'MPEG video sequence',bytes:Uint8Array.from([0,0,1,0xb3,0x16,0,0xf0,0x13,0,0,1,0xb7])},
    {name:'MPEG program header with embedded audio',bytes:concat(Uint8Array.from([0,0,1,0xba,0x21,0,1,0,1,0x80,0,1]),frames)},
    {name:'MP4 container',bytes:readFileSync(path.join(fixtureDir,'format.mp4'))}
  ];
  for(const sample of invalid){
    const file=new File([sample.bytes],'video.mpeg',{type:'video/mpeg'});
    assert.equal(fileAudioFormat(file),'mpeg','browser MIME alone never proves content');
    await assert.rejects(()=>validateWholeFile(file,'mpeg'),/signature\/container is invalid/,sample.name);
  }
});

import {probeOggVorbisDuration} from '../../public/js/ogg-duration.js';

test('Ogg Vorbis duration uses native file granules when browser decoding is unavailable',async()=>{
  const bytes=new Uint8Array(readFileSync(path.join(fixtureDir,'format.ogg')));
  const duration=await probeOggVorbisDuration(new File([bytes],'format.ogg',{type:'audio/ogg'}));
  assert.ok(Number.isFinite(duration)&&Math.abs(duration-1)<0.15,'independent Ogg Vorbis granules must report the actual one-second fixture');
  const invalid=[
    bytes.subarray(0,bytes.length-1),
    concat(Uint8Array.from([0x4a]),bytes),
    concat(bytes,Uint8Array.from([0x4a])),
  ];
  for(const altered of invalid) assert.equal(await probeOggVorbisDuration(new Blob([altered])),null,'invalid terminal Ogg structure must not receive an invented duration');
  // The serial/CRC fields vary across ffmpeg runs and can contain 0x76 before
  // the actual 'vorbis' identifier. Corrupt the verified identification packet.
  const codecOffset=27+bytes[26]+1;
  assert.equal(Buffer.from(bytes.subarray(codecOffset,codecOffset+6)).toString('ascii'),'vorbis','test fixture must identify Vorbis at the first Ogg page payload');
  const badCodec=bytes.slice();badCodec[codecOffset]=0;
  assert.equal(await probeOggVorbisDuration(new Blob([badCodec])),null,'non-Vorbis header must fail closed');
  assert.equal(await probeOggVorbisDuration(new Blob([Uint8Array.from([79,103,103,83])])),null,'truncated Ogg header must fail closed');
});
