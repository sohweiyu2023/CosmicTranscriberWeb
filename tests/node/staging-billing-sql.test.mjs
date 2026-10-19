import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExactBillingSql,validatePaidReceipt} from '../../scripts/staging-billing-sql.mjs';
const formats=['mp3','flac','mp4','mpeg','mpga','m4a','ogg','wav','webm'];
const makeReport=(n=9)=>({schema:'cosmic-paid-staging-nine-1',commit:'2a52e2020cfe159454697b3077a0c5ed21d6a14b',runId:'38224473067',runAttempt:'1',status:n===9?'PASS':'FAIL',phase:n===9?'complete':'paid-'+formats[n-1],access:'PASS',secureByok:'PASS',...(n===9?{}:{failure:{phase:'paid-'+formats[n-1],code:'unknown'}}),byokForget:'PASS',attempted:n,formats:formats.slice(0,n).map((format,i)=>({format,model:format==='wav'?'gpt-4o-transcribe-diarize':'gpt-transcribe',jobId:'live-'+i.toString(16).padStart(32,'0'),attemptId:'a-'+i.toString(16).padStart(32,'0'),status:n===9||i<n-1?'PASS':'FAIL'}))});
test('exact nine paid receipts generate only SELECT and CTE with opaque IDs',()=>{
 const report=makeReport(),sql=buildExactBillingSql(report);
 assert.equal((sql.match(/\bWITH expected\(/g)||[]).length,2);
 assert.equal((sql.match(/\bSELECT\b/g)||[]).length,2);
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA)\b/i);
 for(const row of report.formats)assert.ok(sql.includes(`'${row.jobId}','${row.attemptId}'`));
 assert.match(sql,/distinct_principals/);assert.match(sql,/wrong_model_dispatches/);
});
test('partial failure can be reconciled without inventing nine requests',()=>{
 const report=makeReport(5),sql=buildExactBillingSql(report);
 assert.equal(validatePaidReceipt(report),report);
 assert.match(sql,/Expected attempted formats: 5/);
 assert.doesNotMatch(sql,/live-00000000000000000000000000000005/);
});
for(const [name,mutate] of [
 ['missing run ID',r=>delete r.runId],['rerun',r=>r.runAttempt='2'],
 ['zero paid requests',r=>{r.attempted=0;r.formats=[];r.status='FAIL'}],
 ['duplicate receipt',r=>r.formats[1].jobId=r.formats[0].jobId],
 ['mismatched attempt',r=>r.formats[0].attemptId='a-'+'f'.repeat(32)],
 ['SQL injection',r=>r.formats[0].jobId="live-000');DROP TABLE x;--"],
 ['model mismatch',r=>r.formats[7].model='gpt-transcribe'],
 ['unrecognized format',r=>r.formats[7].format='wma'],
 ['false all-pass',r=>r.formats[8].status='FAIL'],
 ['ambiguous count',r=>r.attempted=10],
 ['failure before final format',r=>{r.status='FAIL';r.formats[2].status='FAIL'}]
])test(`reconciliation fails closed: ${name}`,()=>{
 const r=makeReport();mutate(r);assert.throws(()=>buildExactBillingSql(r));
});

test('reconciliation rejects shuffled format receipts',()=>{
 const r=makeReport();[r.formats[0],r.formats[1]]=[r.formats[1],r.formats[0]];
 assert.throws(()=>buildExactBillingSql(r));
});
test('reconciliation rejects skipped format in partial failed run',()=>{
 const r=makeReport(4);r.formats[2].format='mpga';
 assert.throws(()=>buildExactBillingSql(r));
});


test('reconciliation rejects a purported full PASS without verified BYOK cleanup',()=>{
 const r=makeReport();delete r.byokForget;
 assert.throws(()=>buildExactBillingSql(r));
});
test('reconciliation rejects an impossible partial FAIL with no failed paid request',()=>{
 const r=makeReport(4);r.formats.at(-1).status='PASS';
 assert.throws(()=>buildExactBillingSql(r));
});
test('reconciliation permits nine successful paid requests followed by failed BYOK cleanup',()=>{
 const r=makeReport();r.status='FAIL';r.phase='byok-forget';r.byokForget='FAIL';r.failure={phase:'byok-forget',code:'unknown'};
 assert.match(buildExactBillingSql(r),/Expected attempted formats: 9/);
});
test('reconciliation rejects all paid PASS but unrelated final failure',()=>{
 const r=makeReport();r.status='FAIL';r.phase='unknown';r.byokForget='FAIL';r.failure={phase:'unknown',code:'unknown'};
 assert.throws(()=>buildExactBillingSql(r));
});

// Adversarial cases that v29 incorrectly treated as trustworthy paid evidence.
test('reconciliation rejects a paid failure with a mismatched primary phase',()=>{
 const r=makeReport(3);r.phase='paid-mpga';r.failure.phase='paid-mpga';
 assert.throws(()=>buildExactBillingSql(r));
});
test('reconciliation rejects paid failure with no recorded failure',()=>{
 const r=makeReport(3);delete r.failure;
 assert.throws(()=>buildExactBillingSql(r));
});
test('reconciliation rejects paid evidence without verified Access principal',()=>{
 const r=makeReport(3);delete r.access;
 assert.throws(()=>buildExactBillingSql(r));
});
test('reconciliation rejects paid evidence without verified BYOK session',()=>{
 const r=makeReport(3);delete r.secureByok;
 assert.throws(()=>buildExactBillingSql(r));
});
test('reconciliation rejects paid failure disguised as complete',()=>{
 const r=makeReport(3);r.phase='complete';r.failure.phase='complete';
 assert.throws(()=>buildExactBillingSql(r));
});
test('reconciliation rejects a full PASS carrying contradictory failure evidence',()=>{
 const r=makeReport();r.failure={phase:'paid-webm',code:'unknown'};
 assert.throws(()=>buildExactBillingSql(r));
});
test('reconciliation preserves legitimate partial failure with failed BYOK cleanup',()=>{
 const r=makeReport(3);r.byokForget='FAIL';r.byokForgetFailure={code:'TimeoutError',httpStatus:null};
 assert.match(buildExactBillingSql(r),/Expected attempted formats: 3/);
});

// A paid failure always attempts BYOK cleanup before the report is persisted.
test('reconciliation rejects paid failure with missing BYOK cleanup outcome',()=>{
 const r=makeReport(2);delete r.byokForget;
 assert.throws(()=>buildExactBillingSql(r));
});
test('reconciliation rejects successful cleanup with contradictory failure evidence',()=>{
 const r=makeReport(2);r.byokForgetFailure={code:'TimeoutError'};
 assert.throws(()=>buildExactBillingSql(r));
});
test('reconciliation rejects failed cleanup with no failure evidence',()=>{
 const r=makeReport(2);r.byokForget='FAIL';
 assert.throws(()=>buildExactBillingSql(r));
});
test('reconciliation rejects full PASS with spurious secondary cleanup error',()=>{
 const r=makeReport();r.byokForgetFailure={code:'TimeoutError'};
 assert.throws(()=>buildExactBillingSql(r));
});
test('reconciliation rejects primary cleanup failure with spurious secondary cleanup error',()=>{
 const r=makeReport();r.status='FAIL';r.phase='byok-forget';r.byokForget='FAIL';r.failure={phase:'byok-forget',code:'unknown'};
 r.byokForgetFailure={code:'TimeoutError'};
 assert.throws(()=>buildExactBillingSql(r));
});
