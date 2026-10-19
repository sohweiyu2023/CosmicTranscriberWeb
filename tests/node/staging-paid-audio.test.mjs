import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {speechWavDuration,assertSpeechDiarization,assertSpeechTranscription} from '../../scripts/staging-paid-audio.mjs';

test('separate speech-bearing staging WAV has 12–60 seconds of valid disk PCM audio',()=>{
  const bytes=readFileSync(new URL('../fixtures/staging-wav-diarization.wav',import.meta.url));
  const seconds=speechWavDuration(bytes);
  assert.ok(seconds>25&&seconds<35);
});
test('diarization acceptance requires genuine text, timestamped segments, two speakers',()=>{
  const good={text:'Speaker one says hello. Speaker two responds.',segments:[
    {speaker:'A',text:'Speaker one says hello.',start:0,end:2},
    {speaker:'B',text:'Speaker two responds.',start:3,end:5}
  ]};
  assert.deepEqual(assertSpeechDiarization(good,30),{speakers:2,segments:2});
  for(const bad of [
    {...good,text:''},
    {...good,segments:[]},
    {...good,segments:[good.segments[0],{...good.segments[1],speaker:'A'}]},
    {...good,segments:[good.segments[0],{...good.segments[1],text:''}]},
    {...good,segments:[good.segments[0],{...good.segments[1],end:2}]}
  ])assert.throws(()=>assertSpeechDiarization(bad,30));
});
test('diarization must have plausible ordered timestamps within the actual disk WAV duration',()=>{
  const duration=30;
  const good={text:'Speaker one says hello. Speaker two responds.',segments:[
    {speaker:'A',text:'Speaker one says hello.',start:0,end:2},
    {speaker:'B',text:'Speaker two responds.',start:3,end:5}
  ]};
  assert.deepEqual(assertSpeechDiarization(good,duration),{speakers:2,segments:2});
  for(const segments of [
    [{...good.segments[0],start:-1},good.segments[1]],
    [good.segments[0],{...good.segments[1],end:300}],
    [{...good.segments[0],start:4,end:5},{...good.segments[1],start:3,end:6}]
  ])assert.throws(()=>assertSpeechDiarization({...good,segments},duration));
  assert.throws(()=>assertSpeechDiarization(good,NaN));
});
test('staging paid acceptance chooses distinct speech WAV rather than tone',()=>{
  const source=readFileSync(new URL('../../scripts/staging-live-acceptance.mjs',import.meta.url),'utf8');
  assert.match(source,/format==='wav'\?'tests\/fixtures\/staging-wav-diarization\.wav'/);
  assert.match(source,/assertSpeechDiarization\(j\.result,durationSeconds\)/);
});

test('non-WAV staging speech must contain several English words, not merely a successful response',()=>{
  assert.deepEqual(assertSpeechTranscription({text:'Mock transcription result.'}),{wordCount:3});
  for(const bad of [null,{}, {text:''},{text:'Yes'},{text:'beep beep beep'},{text:23}]){
    // The three short words case is intentionally rejected by the 12-letter floor.
    assert.throws(()=>assertSpeechTranscription(bad));
  }
});
test('paid format fixtures are separate speech audio, preserving the browser tone fixtures',()=>{
  const source=readFileSync(new URL('../../scripts/staging-live-acceptance.mjs',import.meta.url),'utf8');
  assert.match(source,/tests\/fixtures\/staging-speech\.'/);
  assert.match(source,/assertSpeechTranscription\(j\.result\)/);
  for(const ext of ['mp3','flac','mp4','mpeg','mpga','m4a','ogg','webm']){
    const bytes=readFileSync(new URL(`../fixtures/staging-speech.${ext}`,import.meta.url));
    assert.ok(bytes.length>40000,`${ext} reviewed speech fixture unexpectedly small`);
  }
});
