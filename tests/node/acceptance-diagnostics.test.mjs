import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptanceAssertion,acceptanceFailureDetails} from '../../scripts/acceptance-diagnostics.mjs';
import {assertSpeechDiarization,assertSpeechTranscription} from '../../scripts/staging-paid-audio.mjs';
const good=()=>({text:'Speaker one says hello. Speaker two responds.',segments:[{speaker:'A',text:'Hello from speaker one.',start:0,end:2},{speaker:'B',text:'Hello from speaker two.',start:3,end:5}]});
function expectCode(fn,code){assert.throws(fn,error=>{assert.equal(error.code,'ERR_ASSERTION');assert.deepEqual(acceptanceFailureDetails(error),{validationFailure:code});return true});}
test('all diarization failures retain strict criteria with finite receipt categories',()=>{
 const cases=[
 ['diarization_duration_invalid',x=>[x,NaN]],
 ['diarization_text_missing',x=>[{...x,text:'short'},30]],
 ['diarization_segments_missing',x=>[{...x,segments:[x.segments[0]]},30]],
 ['diarization_speaker_missing',x=>{x.segments[1].speaker=' ';return[x,30]}],
 ['diarization_segment_text_missing',x=>{x.segments[1].text=' ';return[x,30]}],
 ['diarization_timestamps_invalid',x=>{x.segments[1].end=32.001;return[x,30]}],
 ['diarization_order_invalid',x=>{x.segments[0].start=4;x.segments[0].end=5;return[x,30]}],
 ['diarization_speakers_insufficient',x=>{x.segments[1].speaker='A';return[x,30]}]
 ];
 for(const[code,change]of cases){const[result,duration]=change(good());expectCode(()=>assertSpeechDiarization(result,duration),code);}
 const boundary=good();boundary.segments[1].end=32;assert.deepEqual(assertSpeechDiarization(boundary,30),{speakers:2,segments:2});
 for(const[start,end]of [[-1,2],[0,0],[0,Infinity],[NaN,2],[0,'2']]){const x=good();Object.assign(x.segments[0],{start,end});expectCode(()=>assertSpeechDiarization(x,30),'diarization_timestamps_invalid');}
});
test('speech failures retain text and English-content criteria',()=>{
 expectCode(()=>assertSpeechTranscription({text:23}),'speech_text_missing');
 for(const text of ['', 'Yes', 'beep beep beep'])expectCode(()=>assertSpeechTranscription({text}),'speech_content_insufficient');
 assert.deepEqual(assertSpeechTranscription({text:'Mock transcription result.'}),{wordCount:3});
});
test('receipt details cannot be forged, copied or contaminated with untrusted content',()=>{
 const marker='PRIVATE_TRANSCRIPT_TOKEN_SENTINEL';
 const minted=acceptanceAssertion('result_missing',marker);minted.code=marker;minted.validationFailure=marker;
 assert.equal(JSON.stringify(acceptanceFailureDetails(minted)),JSON.stringify({validationFailure:'result_missing'}));
 for(const x of [null,undefined,marker,23,{},Object.assign(new Error(marker),minted),{validationFailure:'result_missing',code:'ERR_ASSERTION',message:marker},new Proxy({},{get(){throw Error(marker)}})])assert.deepEqual(acceptanceFailureDetails(x),{});
 assert.throws(()=>acceptanceAssertion(marker,marker),{name:'TypeError',message:'Unknown acceptance diagnostic'});
});
