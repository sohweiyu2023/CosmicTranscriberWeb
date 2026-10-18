import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const fixtureNames=['mp3','flac','mp4','mpeg','mpga','m4a','ogg','webm'].map(ext=>'staging-speech.'+ext).concat('staging-wav-diarization.wav');

// These scenarios use actual reviewed disk fixtures but a strictly offline
// mocked fetch. They never contact Cloudflare or the transcription provider.
for(const [scenario,expectedPaid,expectedFailure,expectedCleanup] of [
 ['redirect',0,'access-status',undefined],
 ['non-json-status',0,'access-status',undefined],
 ['json-suffix-status',0,'access-status',undefined],
 ['json-parameter-spoof-status',0,'access-status',undefined],
 ['oversized-status',0,'access-status',undefined],
 ['declared-oversized-status',0,'access-status',undefined],
 ['invalid-utf8-status',0,'access-status',undefined],
 ['session-no-path',0,'byok-cookie',undefined],
 ['session-domain',0,'byok-cookie',undefined],
 ['session-expired',0,'byok-cookie',undefined],
 ['session-duplicate-path',0,'byok-cookie',undefined],
 ['session-too-long',0,'byok-cookie',undefined],
 ['all-pass',9,undefined,'PASS'],
 ['fifth-failure',5,'paid-mpga','PASS'],
 ['one-speaker',8,'paid-wav','PASS'],
 ['nonwav-empty-transcript',1,'paid-mp3','PASS'],
 ['nonwav-short-transcript',1,'paid-mp3','PASS'],
 ['wav-out-of-range',8,'paid-wav','PASS'],
 ['wav-out-of-order',8,'paid-wav','PASS'],
 ['cleanup-failure',5,'paid-mpga','FAIL'],
 ['forget-no-expiry',5,'paid-mpga','FAIL'],
 ['all-pass-no-expiry',9,'byok-forget','FAIL'],
 ['all-pass-forget-duplicate-cookie',9,'byok-forget','FAIL'],
 ['all-pass-forget-duplicate-path',9,'byok-forget','FAIL'],
 ['all-pass-forget-domain',9,'byok-forget','FAIL'],
 ['midstream-access-redirect',5,'paid-mpga','FAIL'],
 ['midstream-timeout',5,'paid-mpga','PASS']
]){
 test(`offline staging ${scenario}: bounded paid requests and BYOK cleanup`,()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'ctw-staging-mock-'));
  try{
   mkdirSync(path.join(dir,'tests','fixtures'),{recursive:true});
   copyFileSync(path.join(root,'SHA256SUMS.txt'),path.join(dir,'SHA256SUMS.txt'));
   for(const name of fixtureNames)copyFileSync(path.join(root,'tests','fixtures',name),path.join(dir,'tests','fixtures',name));
   const log=path.join(dir,'calls.json');
   const result=spawnSync(process.execPath,['--import',path.join(root,'tests','node','staging-live-mock-fetch.mjs'),path.join(root,'scripts','staging-live-acceptance.mjs')],{
    cwd:dir,encoding:'utf8',timeout:30000,env:{...process.env,
     COSMIC_MOCK_SCENARIO:scenario,COSMIC_MOCK_LOG:log,
     COSMIC_PAID_STAGING_MODE:'exact-nine-real-requests',
     GITHUB_REF:'refs/heads/ci/v1.2.0-production-readiness',
     GITHUB_SHA:'2a52e2020cfe159454697b3077a0c5ed21d6a14b',
     GITHUB_EVENT_NAME:'push',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'38224473067',
     STAGING_CF_AUTHORIZATION:'a.b.c',STAGING_OPENAI_API_KEY:'offline-fixture-only'
    }
   });
   assert.equal(result.error,undefined,String(result.error));
   const report=JSON.parse(readFileSync(path.join(dir,'test-results','staging-live-acceptance.json'),'utf8'));
   const network=JSON.parse(readFileSync(log,'utf8'));
   assert.equal(result.status,expectedFailure?1:0);
   assert.equal(report.status,expectedFailure?'FAIL':'PASS');
   assert.equal(report.failure?.phase,expectedFailure);
   assert.equal(report.attempted,expectedPaid);
   assert.equal(report.runId,'38224473067');
   assert.equal(report.runAttempt,'1');
   assert.equal(report.formats.length,expectedPaid);
   const seenJobs=new Set(),seenAttempts=new Set();
   for(const row of report.formats){
    assert.match(row.jobId,/^live-[0-9a-f]{32}$/);
    assert.match(row.attemptId,/^a-[0-9a-f]{32}$/);
    assert.equal(row.jobId.slice(5),row.attemptId.slice(2));
    assert.ok(!seenJobs.has(row.jobId)&&!seenAttempts.has(row.attemptId));
    seenJobs.add(row.jobId);seenAttempts.add(row.attemptId);
   }
   assert.equal(network.paid,expectedPaid);
   if(scenario==='redirect')assert.equal(network.redirectCancelled,true,'Redirect response body must be cancelled');
   if(['non-json-status','json-suffix-status','json-parameter-spoof-status'].includes(scenario))assert.equal(network.nonJsonCancelled,true,'Non-JSON response body must be cancelled');
   if(scenario==='oversized-status'){
    assert.equal(network.oversizeCancelled,true,'Oversized response must be cancelled before it is fully consumed');
    assert.equal(report.failure?.code,'worker_response_oversized');
   }
   if(scenario==='declared-oversized-status'){
    assert.equal(network.declaredOversizeCancelled,true,'Declared-oversized response must be cancelled without reading body');
    assert.equal(report.failure?.code,'worker_response_oversized');
   }
   if(scenario==='invalid-utf8-status')assert.equal(report.failure?.code,'worker_response_invalid_json');
   assert.equal(report.byokForget,expectedCleanup);
   assert.equal(network.calls.filter(call=>call.route==='/api/key/forget').length,expectedCleanup?1:0);
   assert.ok(network.calls.every(call=>call.hasAccessHeader));
   if(scenario==='midstream-access-redirect'){
    assert.equal(report.failure.code,'access_redirect');
    assert.equal(report.failure.httpStatus,302);
    assert.equal(report.byokForgetFailure.code,'access_redirect');
    assert.equal(report.byokForgetFailure.httpStatus,302);
   }
   if(scenario==='midstream-timeout'){
    assert.equal(report.failure.code,'TimeoutError');
    assert.equal(report.failure.httpStatus,null);
   }
   if(expectedCleanup==='FAIL'&&scenario!=='midstream-access-redirect'){
    if(scenario==='cleanup-failure'){
     assert.equal(report.failure.code,'upstream_failed');
     assert.equal(report.byokForgetFailure.code,'cleanup_rejected');
     assert.equal(report.byokForgetFailure.httpStatus,503);
    }else if(scenario==='forget-no-expiry'){
     assert.equal(report.failure.code,'upstream_failed');
     assert.equal(report.byokForgetFailure.code,'byok_clear_cookie_invalid');
    }else{
     assert.equal(report.failure.code,'byok_clear_cookie_invalid');
     assert.equal(report.byokForgetFailure,undefined);
    }
   }
   if(expectedCleanup==='PASS')assert.equal(network.calls.at(-1).hasByokCookie,false);
  }finally{rmSync(dir,{recursive:true,force:true})}
 });
}
