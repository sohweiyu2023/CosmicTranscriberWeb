import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_COMBINED_FILES,MAX_QUEUE_FILES,preparedQueueItem,eligibleQueueItem,combinedExportComplete,combinedExportHasMixedSettings} from '../../public/js/queue-policy.js';
const prepared=(status='ready',identity='1'.repeat(64))=>({status,fingerprint:'a'.repeat(64),inspection:{chunks:[{}]},parts:status==='done'?[]:undefined,completedSettingsIdentity:status==='done'?identity:undefined});

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
