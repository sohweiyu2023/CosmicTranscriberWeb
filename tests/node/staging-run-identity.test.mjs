import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const fixtureNames=['mp3','flac','mp4','mpeg','mpga','m4a','ogg','webm'].map(ext=>'staging-speech.'+ext).concat('staging-wav-diarization.wav');

// A GitHub rerun could otherwise repeat paid calls despite the nine-call
// limit being enforced within each individual process invocation.
for(const [label,overrides] of [
 ['rerun attempt two',{GITHUB_RUN_ATTEMPT:'2'}],
 ['rerun attempt three',{GITHUB_RUN_ATTEMPT:'3'}],
 ['non-push event',{GITHUB_EVENT_NAME:'workflow_dispatch'}],
 ['missing run id',{GITHUB_RUN_ID:''}],
]){
 test(`paid staging refuses ${label} before network or billable requests`,()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'ctw-run-identity-'));
  try{
   mkdirSync(path.join(dir,'tests','fixtures'),{recursive:true});
   copyFileSync(path.join(root,'SHA256SUMS.txt'),path.join(dir,'SHA256SUMS.txt'));
   for(const name of fixtureNames)copyFileSync(path.join(root,'tests','fixtures',name),path.join(dir,'tests','fixtures',name));
   const log=path.join(dir,'calls.json');
   const child=spawnSync(process.execPath,['--import',path.join(root,'tests','node','staging-live-mock-fetch.mjs'),path.join(root,'scripts','staging-live-acceptance.mjs')],{
    cwd:dir,encoding:'utf8',timeout:30000,
    env:{...process.env,
     COSMIC_MOCK_SCENARIO:'all-pass',COSMIC_MOCK_LOG:log,
     COSMIC_PAID_STAGING_MODE:'exact-nine-real-requests',
     GITHUB_REF:'refs/heads/ci/v1.2.0-production-readiness',
     GITHUB_SHA:'2a52e2020cfe159454697b3077a0c5ed21d6a14b',
     GITHUB_EVENT_NAME:'push',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'38224473067',
     STAGING_CF_AUTHORIZATION:'a.b.c',STAGING_OPENAI_API_KEY:'offline-fixture-only',
     ...overrides
    }
   });
   assert.equal(child.error,undefined,String(child.error));
   const report=JSON.parse(readFileSync(path.join(dir,'test-results','staging-live-acceptance.json'),'utf8'));
   const network=JSON.parse(readFileSync(log,'utf8'));
   assert.equal(child.status,1,'Invalid workflow identity must fail');
   assert.equal(report.status,'FAIL');
   assert.equal(report.failure?.phase,'run-identity');
   assert.equal(report.attempted,0);
   assert.equal(network.paid,0);
   assert.deepEqual(network.calls,[],'No network requests, including free requests');
  }finally{rmSync(dir,{recursive:true,force:true})}
 });
}
