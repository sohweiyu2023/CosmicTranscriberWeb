import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {FIXTURES,verifyFixtures} from '../../scripts/staging-remaining-eight-policy.mjs';
import {verifyFixedMp3,MP3} from '../../scripts/staging-single-mp3-smoke.mjs';
import {safeguards} from '../../scripts/audit-lib.mjs';
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
test('exact first-party action policy admits precisely the sixth approved upload and rejects drift',async()=>{
 const y=await readFile(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
 const check=workflow=>safeguards({'.github/workflows/ci.yml':workflow}).find(([name])=>name==='GitHub CI uses current exact first-party action releases')[1]();
 assert.equal(check(y),true);
 const pin='actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9';assert.equal((y.match(/actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9/g)||[]).length,6);
 assert.equal(check(y.replace(pin,'actions/upload-artifact@v7')),false);assert.equal(check(y.replace(pin,'')),false);assert.equal(check(y+'\n      - uses: '+pin+'\n'),false);
 assert.match(y,/runs-on: ubuntu-latest\n    timeout-minutes: 20/);assert.equal((y.match(/timeout-minutes: 10\n        run: node scripts\/provision-ci-media.mjs/g)||[]).length,2);
});

test('media provisioning policy requires both bounded Linux steps and post-install validation',async()=>{
 const workflow=await readFile(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
 const helper=await readFile(new URL('../../scripts/provision-ci-media.mjs',import.meta.url),'utf8');
 const check=(y,h)=>safeguards({'.github/workflows/ci.yml':y,'scripts/provision-ci-media.mjs':h}).find(([name])=>name==='CI provisions ffprobe and runs full validation in resolve-lock Linux macOS and Windows')[1]();
 assert.equal(check(workflow,helper),true);
 assert.equal(check(workflow.replace('timeout-minutes: 10','timeout-minutes: 100'),helper),false);
 assert.equal(check(workflow,helper.replace('assert.ok(probe(run,log)','assert.ok(true')),false);
 assert.equal(check(workflow.replace('run: npm run validate','run: echo skipped'),helper),false);
});


test('public remaining-eight folder and CI artifact contain only exact approved inputs',async()=>{
 const root=new URL('../fixtures/approved-remaining-eight/',import.meta.url);
 const names=await readdir(root);assert.deepEqual(names.sort(),[...FIXTURES.map(f=>f.name),'README.md'].sort());
 const files=Object.create(null);for(const f of FIXTURES)files[f.name]=await readFile(new URL(f.name,root));
 assert.equal(verifyFixtures(files).length,8);
 const notice=await readFile(new URL('README.md',root),'utf8');assert.ok(notice.includes('outside the root MIT grant'));assert.ok(notice.includes('No microphone or private recording'));
 const y=await readFile(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
 const start=y.indexOf('      - name: Validate exactly the eight approved synthetic speech fixtures');const end=y.indexOf('      - name: Upload reviewed lock and fixtures',start);assert.ok(start>y.indexOf('      - name: Full dependency-free adversarial gate'));
 const section=y.slice(start,end);assert.ok(section.includes('prepare-remaining-eight-fixtures.mjs tests/fixtures/approved-remaining-eight "$RUNNER_TEMP/approved-eight"'));
 assert.ok(section.includes('path: ${{ runner.temp }}/approved-eight/files/*'));assert.match(section,/name: cosmic-approved-remaining-eight-fixtures/);assert.match(section,/if-no-files-found: error/);assert.match(section,/retention-days: 7/);
 for(const x of ['secrets.','deploy:','staging-live-acceptance','receipt.json'])assert.equal(section.includes(x),false);
 assert.equal((y.match(/name: cosmic-approved-remaining-eight-fixtures/g)||[]).length,1);
});
