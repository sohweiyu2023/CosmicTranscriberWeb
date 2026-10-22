import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_COMBINED_FILES,MAX_QUEUE_FILES,preparedQueueItem,eligibleQueueItem,combinedExportComplete,combinedExportHasMixedSettings,hasKnownDuration,queueDurationSummary} from '../../public/js/queue-policy.js';
const prepared=(status='ready',identity='1'.repeat(64))=>({status,fingerprint:'a'.repeat(64),inspection:{chunks:[{}]},parts:status==='done'?[]:undefined,completedSettingsIdentity:status==='done'?identity:undefined,completedExportSettingsIdentity:status==='done'?identity:undefined});

test('failed prepared queue items remain eligible while completed or unprepared items do not',()=>{
  assert.equal(eligibleQueueItem(prepared('error')),true);
  assert.equal(eligibleQueueItem({status:'error'}),false);
  assert.equal(eligibleQueueItem(prepared('inspecting')),false);
  assert.equal(eligibleQueueItem(prepared('running')),false);
  assert.equal(eligibleQueueItem(prepared('done')),false);
});

test('combined export is suppressed until every prepared queue item is completed',()=>{
  assert.equal(combinedExportComplete([prepared('done'),prepared('done')]),true);
  assert.equal(combinedExportComplete([prepared('done'),prepared('error')]),false);
  assert.equal(combinedExportComplete([{status:'error'}]),false);
  assert.equal(combinedExportComplete([prepared('done','1'.repeat(64)),prepared('done','2'.repeat(64))]),false);
  assert.equal(combinedExportHasMixedSettings([prepared('done','1'.repeat(64)),prepared('done','2'.repeat(64))]),true);
  assert.equal(combinedExportHasMixedSettings([prepared('done'),prepared('done')]),false);
});

test('Windows-parity queue and combined-export resource limits remain explicit',()=>{
  assert.equal(MAX_QUEUE_FILES,10_000);
  assert.equal(MAX_COMBINED_FILES,1_000);
  assert.equal(combinedExportComplete(Array.from({length:MAX_COMBINED_FILES},()=>prepared('done'))),true);
  assert.equal(combinedExportComplete(Array.from({length:MAX_COMBINED_FILES+1},()=>prepared('done'))),false);
});

test('combined export permits different source identities with matching transcription choices',()=>{
  const queue=[
    {...prepared('done','a'.repeat(64)),audioFormat:'mp3',completedExportSettingsIdentity:'1'.repeat(64)},
    {...prepared('done','b'.repeat(64)),audioFormat:'wav',completedExportSettingsIdentity:'1'.repeat(64)}
  ];
  assert.equal(combinedExportComplete(queue),true);
  assert.equal(combinedExportHasMixedSettings(queue),false);
});

test('combined export still refuses missing or different export settings despite matching source identities',()=>{
  const first=prepared('done');
  assert.equal(combinedExportComplete([first,{...first,completedExportSettingsIdentity:undefined}]),false);
  assert.equal(combinedExportHasMixedSettings([first,{...first,completedExportSettingsIdentity:undefined}]),true);
  const changed={...first,completedExportSettingsIdentity:'2'.repeat(64)};
  assert.equal(combinedExportComplete([first,changed]),false);
  assert.equal(combinedExportHasMixedSettings([first,changed]),true);
});

test('unreadable whole-file duration is excluded from estimates without treating it as zero cost',()=>{
  const unknown={...prepared(),audioFormat:'wav',duration:0.001};
  const known={...prepared(),audioFormat:'mp3',duration:60};
  assert.equal(hasKnownDuration(unknown),false);
  assert.deepEqual(queueDurationSummary([unknown,known]),{duration:60,unknownFiles:1});
  assert.deepEqual(queueDurationSummary([unknown]),{duration:0,unknownFiles:1});
  assert.deepEqual(queueDurationSummary([known,{status:'inspecting',duration:0}]),{duration:60,unknownFiles:0});
  assert.equal(hasKnownDuration({...unknown,duration:8}),true);
  assert.equal(hasKnownDuration({...unknown,duration:Infinity}),false);
});
