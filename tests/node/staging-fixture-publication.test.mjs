import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyFixedMp3,MP3} from '../../scripts/staging-single-mp3-smoke.mjs';
const fixture='tests/fixtures/approved-single-mp3/staging-speech.mp3';
test('public synthetic fixture is the exact separately approved one-request input',async()=>{
 const bytes=await readFile(new URL('../../'+fixture,import.meta.url));assert.deepEqual(verifyFixedMp3(bytes),MP3);
 assert.equal(MP3.model,'gpt-transcribe');assert.equal(MP3.reservationMicroUsd,4500);
 const sums=await readFile(new URL('../../SHA256SUMS.txt',import.meta.url),'utf8');assert.ok(sums.split('\n').includes(MP3.sha256+'  '+fixture));
});
test('existing CI verifies and uploads exactly one fixture after validation, without a paid successor',async()=>{
 const y=await readFile(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
 const start=y.indexOf('      - name: Verify exact approved single MP3 bytes');const end=y.indexOf('      - name: Upload reviewed lock and fixtures',start);assert.ok(start>y.indexOf('      - name: Full dependency-free adversarial gate'));
 const section=y.slice(start,end);assert.ok(section.includes('verifyFixedMp3(await readFile(\''+fixture+'\'))'));
 assert.match(section,/name: cosmic-approved-single-mp3-fixture/);assert.ok(section.includes('path: '+fixture));
 assert.match(section,/if-no-files-found: error/);assert.match(section,/retention-days: 7/);
 for(const forbidden of ['secrets.','deploy:','staging-single-mp3-smoke.mjs "','staging-live-acceptance.mjs'])assert.equal(section.includes(forbidden),false);
 assert.equal((y.match(/name: cosmic-approved-single-mp3-fixture/g)||[]).length,1);
});
test('source documents preserve distinct synthetic provenance and binary media exclusion',async()=>{
 const doc=await readFile(new URL('../../docs/STAGING_SPEECH_ACCEPTANCE.md',import.meta.url),'utf8');const notices=await readFile(new URL('../../THIRD-PARTY-NOTICES.md',import.meta.url),'utf8');
 for(const term of [MP3.sha256,'3e6cf6e1fc99bb17e46734c50b5c7fcd3cbc78c9673c5473dafcb3395bad46d3','no private recording','not a new MIT grant'])assert.ok(doc.includes(term),term);
 assert.ok(notices.includes(fixture));assert.ok(notices.includes('outside the root MIT grant'));
});
