import assert from 'node:assert/strict';

// This fixture is separate from the 1-second tone used for native browser file checks.
// Verify its disk bytes and format before any paid request, not after dispatch.
export function speechWavDuration(bytes){
  assert.ok(Buffer.isBuffer(bytes),'WAV must be read from a real disk fixture');
  assert.ok(bytes.length>=44&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE','Expected RIFF/WAVE');
  let offset=12,format=null,dataBytes=null;
  while(offset+8<=bytes.length){
    const tag=bytes.toString('ascii',offset,offset+4);
    const size=bytes.readUInt32LE(offset+4);
    const start=offset+8;
    assert.ok(start+size<=bytes.length,'Truncated WAV chunk');
    if(tag==='fmt '){
      assert.ok(size>=16,'Invalid WAV fmt chunk');
      format={codec:bytes.readUInt16LE(start),channels:bytes.readUInt16LE(start+2),rate:bytes.readUInt32LE(start+4),align:bytes.readUInt16LE(start+12),bits:bytes.readUInt16LE(start+14)};
    }
    if(tag==='data')dataBytes=size;
    offset=start+size+(size%2);
  }
  assert.deepEqual(format,{codec:1,channels:1,rate:16000,align:2,bits:16},'Acceptance WAV must be mono 16-kHz PCM16 speech');
  assert.ok(dataBytes>16000*2*12&&dataBytes<16000*2*60,'Acceptance WAV must contain 12–60 seconds of PCM audio');
  const seconds=dataBytes/(format.rate*format.align);
  assert.ok(seconds>=12&&seconds<=60,'Invalid speech WAV duration');
  return seconds;
}

export function assertSpeechDiarization(result,durationSeconds){
  // The WAV duration comes from the independently hashed on-disk fixture.
  // Provider segments may overlap; their start times should still be ordered.
  // Allow two seconds for model rounding, never unbounded timestamps.
  assert.ok(Number.isFinite(durationSeconds)&&durationSeconds>=12&&durationSeconds<=60,'Invalid independently measured WAV duration');
  assert.ok(result&&typeof result.text==='string'&&result.text.trim().length>=20,'Diarization must contain meaningful spoken text');
  assert.ok(Array.isArray(result.segments)&&result.segments.length>=2,'Diarization must return speaker-labelled segments');
  const speakers=new Set();
  let previousStart=-1;
  for(const segment of result.segments){
    assert.ok(segment&&typeof segment.speaker==='string'&&segment.speaker.trim(),'Missing diarization speaker label');
    assert.ok(typeof segment.text==='string'&&segment.text.trim(),'Missing diarization segment text');
    assert.ok(Number.isFinite(segment.start)&&Number.isFinite(segment.end)&&segment.start>=0&&
      segment.end>segment.start&&segment.end<=durationSeconds+2,'Invalid or out-of-bounds diarization timestamps');
    assert.ok(segment.start>=previousStart,'Diarization segments are not chronological');
    previousStart=segment.start;
    speakers.add(segment.speaker);
  }
  assert.ok(speakers.size>=2,'Two-speaker WAV must identify at least two speakers');
  return {speakers:speakers.size,segments:result.segments.length};
}

// These eight staging fixtures are actual speech transcodes, not the 1-second
// tone fixtures used by native file-format/browser tests. A successful HTTP
// response without recognizable words must not certify speech transcription.
// This is a minimum-content check, not a claim of word-error-rate accuracy.
export function assertSpeechTranscription(result){
  assert.ok(result&&typeof result.text==='string','Speech transcript text missing');
  const words=result.text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)||[];
  const letters=words.join('').length;
  assert.ok(words.length>=3&&letters>=12&&new Set(words.map(w=>w.toLowerCase())).size>=2,'Speech fixture must yield meaningful English words');
  return {wordCount:words.length};
}
