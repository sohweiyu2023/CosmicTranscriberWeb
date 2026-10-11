import test from 'node:test';
import assert from 'node:assert/strict';
import {CHECKPOINT_SCHEMA,validateCheckpointShape} from '../../public/js/checkpoint-schema.js';

const hex='a'.repeat(64);
function valid(){return {
  id:`cp:${hex}`,principalScope:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',sourceFingerprint:hex,sourceSize:1000,settingsIdentity:hex,audioFormat:'wav',processingRevision:'whole-v1',
  chunks:[{index:1,sourceStart:0,sourceEnd:1000,bytes:1000,sha256:hex,logicalStart:0,duration:1,prerollDuration:0,status:'completed',attempts:[{attemptId:'a-1',startedAt:'2026-08-08T00:00:00.000Z',completedAt:'2026-08-08T00:00:01.000Z',state:'success',appRequestId:'req-1',openaiRequestId:'oai-1'}]}],
  results:{1:{index:1,logicalStart:0,duration:1,text:'hello',segments:null,diagnostics:{appRequestId:'req-1',openaiRequestId:'oai-1',status:200},attempts:[{attemptId:'a-1',startedAt:'2026-08-08T00:00:00.000Z',completedAt:'2026-08-08T00:00:01.000Z',state:'success',appRequestId:'req-1',openaiRequestId:'oai-1'}]}},
  createdAt:'2026-08-08T00:00:00.000Z',updatedAt:'2026-08-08T00:00:01.000Z',schema:CHECKPOINT_SCHEMA,integrity:hex
}}

test('checkpoint schema v4 accepts a bounded format-aware record',()=>assert.equal(validateCheckpointShape(valid()),true));
test('checkpoint schema rejects unknown fields and malformed nested data',()=>{const extra=valid();extra.rawAudio='no';assert.equal(validateCheckpointShape(extra),false);const bad=valid();bad.results[1].segments=[{speaker:'A',text:'x',start:2,end:1}];assert.equal(validateCheckpointShape(bad),false)});
test('checkpoint schema rejects impossible status/attempt types and malformed chunk hashes',()=>{const badStatus=valid();badStatus.chunks[0].status='paid-maybe';assert.equal(validateCheckpointShape(badStatus),false);const badAttempt=valid();badAttempt.chunks[0].attempts[0].state='unknown';assert.equal(validateCheckpointShape(badAttempt),false);const badHash=valid();badHash.chunks[0].sha256='abc';assert.equal(validateCheckpointShape(badHash),false)});
test('checkpoint schema requires principal, audio format, and processing revision',()=>{const missing=valid();delete missing.principalScope;assert.equal(validateCheckpointShape(missing),false);const bad=valid();bad.principalScope='short';assert.equal(validateCheckpointShape(bad),false);const noFormat=valid();delete noFormat.audioFormat;assert.equal(validateCheckpointShape(noFormat),false);const noRev=valid();delete noRev.processingRevision;assert.equal(validateCheckpointShape(noRev),false)});
