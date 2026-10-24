import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyProbe} from '../../scripts/prepare-remaining-eight-fixtures.mjs';
import {FIXTURES} from '../../scripts/staging-remaining-eight-policy.mjs';
const wav=FIXTURES.find(f=>f.format==='wav');
const valid=()=>({format:{size:String(wav.bytes),duration:'15.009938'},streams:[{codec_type:'audio',codec_name:'pcm_s16le',sample_rate:'16000',channels:1,bits_per_sample:16}]});
test('fixed WAV probe agrees with actual-byte duration and preserves the pinned identity',()=>{
 const row=verifyProbe(wav,valid());assert.equal(row.sha256,wav.sha256);assert.equal(row.durationSeconds,15.009938);assert.equal(row.decode,'PASS');
});
test('wrong duration, size, codec, layout and extra streams cannot earn readiness',()=>{
 for(const change of [p=>p.format.duration='12',p=>p.format.size='1',p=>p.streams[0].codec_name='aac',p=>p.streams[0].channels=2,p=>p.streams[0].sample_rate='48000',p=>p.streams[0].bits_per_sample=24,p=>p.streams.push({...p.streams[0]})]){const p=valid();change(p);assert.throws(()=>verifyProbe(wav,p));}
});
