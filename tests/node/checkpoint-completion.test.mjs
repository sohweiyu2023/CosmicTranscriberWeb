import test from 'node:test';
import assert from 'node:assert/strict';
import {exerciseCheckpoint} from './checkpoint-completion-harness.mjs';

for(const model of ['gpt-transcribe','gpt-4o-transcribe-diarize']){
  for(const layout of ['missing-first','missing-later','missing-after-valid']){
    for(const previousContext of model==='gpt-transcribe'?[false,true]:[false]){
      test('completed missing result stops all parts without mutation: '+[model,layout,previousContext].join(' / '),async()=>{
        const r=await exerciseCheckpoint({model,layout,previousContext});
        assert.equal(r.shapeValid,true);assert.equal(r.integrityLoadAccepted,true);assert.equal(r.compatible,true);
        assert.equal(r.calls.length,0,'No part may dispatch, including pending parts before the missing completion');
        assert.equal(r.counts.confirms,0);assert.equal(r.counts.writes,0);assert.equal(r.counts.deletes,0);
        assert.equal(r.persistedUnchanged,true);assert.equal(r.loadedUnchanged,true);
        assert.equal(r.error?.code,'checkpoint_completed_result_missing');
        assert.match(r.error.message,/saved checkpoint was preserved/);
        assert.match(r.error.message,/another transcription charge/);
        assert.notEqual(r.itemStatus,'done');
        assert.equal(r.events.filter(e=>e.name==='checkpoint_chunk_reused').length,0);
      });
    }
  }
  for(const emptyResult of [false,true]){
    test('valid completed result remains reusable: '+model+' / empty='+emptyResult,async()=>{
      const r=await exerciseCheckpoint({model,layout:'valid-single',emptyResult});
      assert.equal(r.error,null);assert.equal(r.calls.length,0);assert.equal(r.counts.confirms,0);
      assert.equal(r.counts.writes,0);assert.equal(r.persistedUnchanged,true);assert.equal(r.itemStatus,'done');
      assert.equal(r.parts[0].text,emptyResult?'':'saved part 1');
      if(model==='gpt-4o-transcribe-diarize')assert.equal(r.parts[0].segments.length,emptyResult?0:1);
      else assert.equal(r.parts[0].segments,null);
    });
  }
  test('pending without result still performs one mocked request: '+model,async()=>{
    const r=await exerciseCheckpoint({model,layout:'pending'});
    assert.equal(r.error,null);assert.equal(r.calls.length,1);assert.equal(r.counts.confirms,0);
    assert.equal(r.counts.writes,2);assert.equal(r.itemStatus,'done');
  });
  for(const layout of ['in_flight','ambiguous']){
    for(const confirm of [false,true]){
      test('unresolved attempt retains explicit confirmation: '+[model,layout,confirm].join(' / '),async()=>{
        const r=await exerciseCheckpoint({model,layout,confirm});
        assert.equal(r.counts.confirms,1);assert.equal(r.calls.length,confirm?1:0);
        if(confirm){assert.equal(r.error,null);assert.equal(r.itemStatus,'done')}
        else{assert.match(r.error.message,/not resent without explicit confirmation/);assert.equal(r.persistedUnchanged,true);assert.equal(r.counts.writes,0)}
      });
    }
  }
}
for(const previousContext of [false,true]){
  test('valid cached later result preserves prior-context chain policy: '+previousContext,async()=>{
    const r=await exerciseCheckpoint({layout:'context-chain',previousContext});
    assert.equal(r.error,null);assert.deepEqual(r.calls.map(c=>c.index),previousContext?[2,3]:[2]);
    assert.equal(r.parts[2].text,previousContext?'synthetic part 3':'saved part 3');
    if(previousContext){assert.match(r.calls[0].prompt,/saved part 1/);assert.match(r.calls[1].prompt,/synthetic part 2/)}
  });
}
test('actual load rejects integrity mismatch before upload',async()=>{
  const r=await exerciseCheckpoint({tamperIntegrity:true});
  assert.match(r.error.message,/checkpoint is corrupt/);assert.equal(r.calls.length,0);
  assert.equal(r.counts.writes,0);assert.equal(r.persistedUnchanged,true);
});
test('actual compatibility gate rejects mismatched identity before upload',async()=>{
  const r=await exerciseCheckpoint({mismatchIdentity:true});
  assert.equal(r.compatible,false);assert.match(r.error.message,/does not exactly match/);
  assert.equal(r.calls.length,0);assert.equal(r.counts.writes,0);assert.equal(r.persistedUnchanged,true);
});
