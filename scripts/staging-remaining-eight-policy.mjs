// Local deployment-pin candidate. No publication or paid execution before review and authorization.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {shortPcmWavSeconds} from '../src/short-wav.js';
export const POLICY=Object.freeze({repo:'sohweiyu2023/CosmicTranscriberWeb',origin:'https://transcriber-staging.awakeningtoreality.com',worker:'cosmic-transcriber-web-staging',workflow:'staging-remaining-eight.yml',approval:'Sentinel_c2c095975b008191b6e4af85864f70eb',priorRun:39979683866,priorArtifact:12512662440,maximumRequests:9,maximumMicroUsd:250000});
// Old-source automatic chunking is ineligible for this bounded eight-request plan.
// Local pins come from verified deployment evidence; runtime must revalidate actual current state.
export const APPROVED_DEPLOYMENT=Object.freeze({"source":"88ee4a683c8c277885f0737db53226e658390fae","version":"e1c94498-bfb2-4cbd-8488-e75cdec32877","run":40063452013,"head":"728b42283b4252f2a125e4c4b5bf56c22989e3ae","ciRun":40056803923,"licensingRun":40056803922,"artifact":12546575744});
export const FIXTURES=Object.freeze([{"format":"flac","model":"gpt-transcribe","bytes":196069,"sha256":"510e61c3296b67cab2fc5caaf6a1a849e3c84a14a3d8e1313c9ec8403e653901","dispatchDurationSeconds":12.0,"name":"staging-speech.flac","mime":"audio/flac","reservationMicroUsd":4500},{"format":"mp4","model":"gpt-transcribe","bytes":100621,"sha256":"a3bc3ef3c33926b8ab626ee01dcd6626070e9d1d9f1c48a736a69704b55a8276","dispatchDurationSeconds":12.0,"name":"staging-speech.mp4","mime":"audio/mp4","reservationMicroUsd":4500},{"format":"mpeg","model":"gpt-transcribe","bytes":194156,"sha256":"9a89f3860a66d1d1e0fba139b51fded9a5e0e2f6f19d687616b2efaad1c2f78a","dispatchDurationSeconds":12.096,"name":"staging-speech.mpeg","mime":"audio/mpeg","reservationMicroUsd":4500},{"format":"mpga","model":"gpt-transcribe","bytes":194156,"sha256":"9a89f3860a66d1d1e0fba139b51fded9a5e0e2f6f19d687616b2efaad1c2f78a","dispatchDurationSeconds":12.096,"name":"staging-speech.mpga","mime":"audio/mpeg","reservationMicroUsd":4500},{"format":"m4a","model":"gpt-transcribe","bytes":100621,"sha256":"a3bc3ef3c33926b8ab626ee01dcd6626070e9d1d9f1c48a736a69704b55a8276","dispatchDurationSeconds":12.0,"name":"staging-speech.m4a","mime":"audio/mp4","reservationMicroUsd":4500},{"format":"ogg","model":"gpt-transcribe","bytes":51197,"sha256":"6e1eae6e0002faf64d745d3f1c8a598f3c2fe9914de2afdb35e575ba93357dcd","dispatchDurationSeconds":12.0,"name":"staging-speech.ogg","mime":"audio/ogg","reservationMicroUsd":4500},{"format":"wav","model":"gpt-4o-transcribe-diarize","bytes":480396,"sha256":"3e6cf6e1fc99bb17e46734c50b5c7fcd3cbc78c9673c5473dafcb3395bad46d3","dispatchDurationSeconds":15.0099375,"name":"staging-wav-diarization.wav","mime":"audio/wav","reservationMicroUsd":180000},{"format":"webm","model":"gpt-transcribe","bytes":112266,"sha256":"0853722ad4b4f7dd68e226b4a803775c9bb8aa95e745d0dcd6386babcd416ea8","dispatchDurationSeconds":12.008,"name":"staging-speech.webm","mime":"audio/webm","reservationMicroUsd":4500}].map(Object.freeze));
export const PRIOR_FILES=Object.freeze({"budget.json":"2b47f1e6088e8863eae7b6aec7f4bdfe9190088246f09675f0bebca40d81b2a0","receipt.json":"6825dc9cc89774992a12d06e733547f7e425d65a12f31979b698f9e6467e5973","reservation.json":"0febf8dcaf82c90dfdc42b10dee1c15c979c9fac81a87399e44ed42e2e5b4a08","source.json":"857444d217e762de84d957927e6b2861fb41d3d678bfdda652e39f6f10f05f3c"});
export const SOURCE_FEATURES=Object.freeze({"src/index.js":"af1e74a08e6b06550129ebe920571e374e8b5ddb383a62afc3c30c2ecc32c55d","src/openai.js":"78f346ec60f134a81d4bdc3409953bec55d94799ff65d73c7ec8e3daf033f80e","src/short-wav.js":"822786914fd5bcc36619b9301c72045764c75f7e253a826da6e224c8fb278f30"});
export const sha256=b=>createHash('sha256').update(b).digest('hex');
export function requireReviewedDeployment(pin=APPROVED_DEPLOYMENT){
 assert.match(pin.source||'',/^[a-f0-9]{40}$/);assert.notEqual(pin.source,'82392336cfea5bc417098a2c6e3066dafca97b5b');
 assert.match(pin.version||'',/^[a-f0-9-]{36}$/);assert.match(pin.head||'',/^[a-f0-9]{40}$/);
 for(const key of ['run','ciRun','licensingRun','artifact'])assert.ok(Number.isSafeInteger(pin[key])&&pin[key]>0);
 return pin;
}
export function verifyPriorSmoke(files){
 assert.deepEqual(Object.keys(files).sort(),Object.keys(PRIOR_FILES).sort());
 for(const [name,hash] of Object.entries(PRIOR_FILES))assert.equal(sha256(files[name]),hash,'Prior receipt changed');
 const receipt=JSON.parse(files['receipt.json']),ledger=JSON.parse(files['budget.json']);
 assert.equal(receipt.status,'PASS');assert.equal(receipt.attempted,1);assert.equal(receipt.byokForget,'PASS');assert.equal(receipt.fullAcceptance,false);assert.equal(receipt.releaseReady,false);
 assert.equal(ledger.approval,POLICY.approval);assert.equal(ledger.reservedRequests,1);assert.equal(ledger.reservedMicroUsd,4500);
 return ledger;
}
export function reserveRemaining(ledger){
 assert.equal(ledger.schema,'cosmic-approved-paid-budget-1');assert.equal(ledger.approval,POLICY.approval);
 assert.equal(ledger.maximumRequests,9);assert.equal(ledger.maximumMicroUsd,250000);
 assert.equal(ledger.reservedRequests,1);assert.equal(ledger.reservedMicroUsd,4500);
 assert.equal(FIXTURES.length,8);assert.equal(FIXTURES.some(x=>x.format==='mp3'),false);
 const total=ledger.reservedMicroUsd+FIXTURES.reduce((n,x)=>n+x.reservationMicroUsd,0);
 assert.equal(total,216000);assert.ok(total<=250000);
 return {...ledger,reservedRequests:9,reservedMicroUsd:total};
}
export function verifyFixtures(files){
 assert.deepEqual(Object.keys(files).sort(),FIXTURES.map(x=>x.name).sort());
 for(const f of FIXTURES){const b=files[f.name];assert.equal(b.length,f.bytes);assert.equal(sha256(b),f.sha256);
  if(f.format==='wav')assert.equal(shortPcmWavSeconds(b),f.dispatchDurationSeconds);
  else assert.ok(f.dispatchDurationSeconds>0&&f.dispatchDurationSeconds<60&&f.model==='gpt-transcribe');
 }
 return FIXTURES;
}
export function verifyHistory(smokeRuns,remainingRuns,ciRuns,jobLists,currentRun){
 assert.equal(smokeRuns.filter(x=>x.event==='workflow_dispatch').length,1);
 for(const run of smokeRuns){assert.equal(run.run_attempt,1);assert.equal(run.status,'completed');
  if(run.id===POLICY.priorRun){assert.equal(run.event,'workflow_dispatch');assert.equal(run.conclusion,'success');}
  else {assert.ok(['push','pull_request'].includes(run.event));assert.equal(run.conclusion,'failure');assert.deepEqual(jobLists[run.id],[]);}
 }
 assert.ok(smokeRuns.some(x=>x.id===POLICY.priorRun));
 assert.equal(remainingRuns.filter(x=>String(x.id)===String(currentRun)).length,1);
 for(const run of remainingRuns){assert.equal(run.run_attempt,1);if(String(run.id)===String(currentRun))continue;
  assert.ok(['push','pull_request'].includes(run.event));assert.equal(run.status,'completed');assert.equal(run.conclusion,'failure');assert.deepEqual(jobLists[run.id],[]);
 }
 for(const run of ciRuns){assert.equal(run.status,'completed');assert.ok(Number.isSafeInteger(run.run_attempt)&&run.run_attempt>=1&&run.run_attempt<=20);
  const paid=jobLists[run.id]?.filter(x=>x.name==='Actual authenticated STAGING paid nine-format acceptance');assert.equal(paid?.length,run.run_attempt);
  for(let a=1;a<=run.run_attempt;a++){const p=paid.filter(x=>x.run_attempt===a);assert.equal(p.length,1);assert.equal(p[0].status,'completed');assert.equal(p[0].conclusion,'skipped');}
 }
 return true;
}
