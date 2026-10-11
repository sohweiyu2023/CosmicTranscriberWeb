import test from 'node:test';
import assert from 'node:assert/strict';
import {effectivePaidSettings} from '../../public/js/checkpoint-effective-settings.js';

const base={model:'gpt-transcribe',languages:['en'],keywords:['Cosmic'],prompt:'faithful',chunkMb:20,maxMinutes:5,previousContext:true};
test('whole-file paid settings ignore MP3-only chunk controls',()=>{
  const a=effectivePaidSettings(base,'wav');
  const b=effectivePaidSettings({...base,chunkMb:5,maxMinutes:3,previousContext:false},'wav');
  assert.deepEqual(a,b);
  assert.deepEqual(Object.keys(a).sort(),['keywords','languages','model','prompt']);
});
test('MP3 paid settings bind MP3-only chunk controls',()=>{
  const a=effectivePaidSettings(base,'mp3');
  const b=effectivePaidSettings({...base,chunkMb:5},'mp3');
  assert.notDeepEqual(a,b);
  assert.equal(a.previousContext,true);
});
