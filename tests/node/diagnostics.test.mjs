import test from 'node:test';
import assert from 'node:assert/strict';
import {DIAGNOSTICS_SCHEMA,diagnosticErrorFields,makeDiagnosticEvent,pushDiagnostic} from '../../public/js/diagnostics.js';

test('diagnostics v2 is privacy bounded and removes sensitive field names',()=>{
  assert.equal(DIAGNOSTICS_SCHEMA,'cosmic-web-diagnostics-2');
  const e=makeDiagnosticEvent('chunk',{fileRef:'f-123',apiKey:'SECRET',prompt:'private',filename:'person.mp3',authorization:'Bearer X',openaiRequestId:'req_123',big:'x'.repeat(500)},{now:()=> '2026-01-01T00:00:00.000Z',elapsedMs:12.4});
  assert.equal(e.fileRef,undefined);assert.equal(e.openaiRequestId,'req_123');assert.equal(e.apiKey,undefined);assert.equal(e.prompt,undefined);assert.equal(e.filename,undefined);assert.equal(e.authorization,undefined);assert.equal(e.big,undefined);assert.equal(e.pageElapsedMs,12);
});

test('diagnostic ring buffer remains bounded',()=>{const events=[];for(let i=0;i<150;i++)pushDiagnostic(events,makeDiagnosticEvent('chunk',{chunk:i}),100);assert.equal(events.length,100);assert.equal(events[0].chunk,50)});
test('error diagnostics omit messages but retain classification',()=>assert.deepEqual(diagnosticErrorFields({name:'TypeError',code:'browser_network_error',status:502,message:'private filename'}),{code:'browser_network_error',errorName:'TypeError',status:502}));
