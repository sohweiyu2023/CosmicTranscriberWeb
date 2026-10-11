import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_TRANSCRIPT_CHARACTERS_PER_FILE,addTranscriptCharacters,combinedTranscriptWithinLimit} from '../../public/js/transcript-limits.js';

test('per-file transcript aggregation enforces the Windows 25M-character safety limit',()=>{
  assert.equal(MAX_TRANSCRIPT_CHARACTERS_PER_FILE,25_000_000);
  assert.equal(addTranscriptCharacters(24_999_998,'ab'),25_000_000);
  assert.throws(()=>addTranscriptCharacters(24_999_999,'ab',{label:'The transcript for example.mp3'}),/25,000,000-character/);
});

test('combined export checks aggregate raw transcript characters before construction',()=>{
  assert.equal(combinedTranscriptWithinLimit([{parts:[{text:'a'},{text:'b'}]}]),true);
  assert.equal(combinedTranscriptWithinLimit([{parts:[{text:'x'.repeat(12_500_001)}]},{parts:[{text:'y'.repeat(12_500_000)}]}]),false);
});
