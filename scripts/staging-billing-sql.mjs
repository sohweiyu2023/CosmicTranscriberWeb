// Generate a SELECT-only, exact-receipt staging D1 reconciliation query from
// the sanitized first-attempt paid acceptance artifact. Never queries D1,
// makes provider calls, or prints credentials, transcripts, emails or audio.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const MODELS=Object.freeze({mp3:'gpt-transcribe',flac:'gpt-transcribe',mp4:'gpt-transcribe',mpeg:'gpt-transcribe',mpga:'gpt-transcribe',m4a:'gpt-transcribe',ogg:'gpt-transcribe',wav:'gpt-4o-transcribe-diarize',webm:'gpt-transcribe'});
const FORMATS=Object.keys(MODELS);
const fail=()=>{throw new Error('Paid staging receipt invalid or not eligible for exact-ID reconciliation')};

export function validatePaidReceipt(report){
 if(!report||typeof report!=='object'||report.schema!=='cosmic-paid-staging-nine-1')fail();
 if(!/^[0-9a-f]{40}$/.test(report.commit||''))fail();
 if(!/^[1-9][0-9]{0,19}$/.test(report.runId||'')||report.runAttempt!=='1')fail();
 if(!['PASS','FAIL'].includes(report.status)||!Number.isInteger(report.attempted)||report.attempted<1||report.attempted>9)fail();
 if(!Array.isArray(report.formats)||report.formats.length!==report.attempted)fail();
 // A billable attempt can only start after the signed-in principal and
 // encrypted BYOK session were both verified. Do not accept receipts with
 // those pre-paid gates missing, even if opaque job IDs look well formed.
 if(report.access!=='PASS'||report.secureByok!=='PASS')fail();
 if(report.status==='PASS'&&Object.hasOwn(report,'failure'))fail();
 if(report.status==='FAIL'){
  // The runner always records the primary failure's phase in both fields.
  if(!report.failure||typeof report.failure!=='object'||
     typeof report.failure.phase!=='string'||report.phase!==report.failure.phase)fail();
  const terminal=report.formats.at(-1);
  if(terminal?.status==='FAIL'){
   if(report.phase!==`paid-${terminal.format}`)fail();
   // After any paid request fails, the runner always attempts BYOK cleanup
   // before writing the receipt. Missing or contradictory cleanup evidence
   // cannot represent a completed runner artifact.
   if(!['PASS','FAIL'].includes(report.byokForget))fail();
   if(report.byokForget==='FAIL'&&
      (!report.byokForgetFailure||typeof report.byokForgetFailure.code!=='string'))fail();
   if(report.byokForget==='PASS'&&Object.hasOwn(report,'byokForgetFailure'))fail();
  }else if(!['byok-forget','byok-forget-status'].includes(report.phase))fail();
 }
 // Secondary cleanup errors are recorded only when a paid request failed
 // first. Successful runs and primary cleanup failures never create one.
 if(report.formats.at(-1)?.status!=='FAIL'&&Object.hasOwn(report,'byokForgetFailure'))fail();
 if(report.status==='PASS'&&(report.attempted!==9||report.formats.some(row=>row?.status!=='PASS')||report.phase!=='complete'||report.byokForget!=='PASS'))fail();
 // The runner writes PASS only after all nine requests and successful BYOK
 // cleanup. A shorter failed run stops at a failed request; a run with nine
 // successful requests can fail only during the final BYOK cleanup.
 if(report.status==='FAIL'&&report.attempted<9&&report.formats.at(-1)?.status!=='FAIL')fail();
 if(report.status==='FAIL'&&report.attempted===9&&report.formats.every(row=>row?.status==='PASS')&&
    (report.byokForget!=='FAIL'||!['byok-forget','byok-forget-status'].includes(report.failure?.phase)))fail();
 const formats=new Set(),jobs=new Set(),attempts=new Set();
 for(const [index,row] of report.formats.entries()){
  // The paid runner submits a fixed prefix of FORMATS and stops on first failure.
  // Reject shuffled or skipped-format reports before emitting reconciliation SQL.
  if(row?.format!==FORMATS[index])fail();
  if(!row||typeof row!=='object'||!Object.hasOwn(MODELS,row.format)||row.model!==MODELS[row.format]||!['PASS','FAIL'].includes(row.status))fail();
  if(!/^live-[0-9a-f]{32}$/.test(row.jobId||'')||!/^a-[0-9a-f]{32}$/.test(row.attemptId||'')||row.jobId.slice(5)!==row.attemptId.slice(2))fail();
  if(formats.has(row.format)||jobs.has(row.jobId)||attempts.has(row.attemptId))fail();
  formats.add(row.format);jobs.add(row.jobId);attempts.add(row.attemptId);
 }
 // A failed request is terminal; the runner cannot submit later formats.
 const failed=report.formats.findIndex(row=>row.status==='FAIL');
 if(failed>=0&&failed!==report.formats.length-1)fail();
 return report;
}
export function buildExactBillingSql(input){
 const report=validatePaidReceipt(input);
 const values=report.formats.map(row=>` ('${row.format}','${row.model}','${row.jobId}','${row.attemptId}')`).join(',\n');
 const cte=`WITH expected(format,expected_model,job_id,attempt_id) AS (VALUES\n${values}\n)`;
 const joins=`FROM expected e\nLEFT JOIN cosmic_attempt_dispatches d ON d.job_id=e.job_id AND d.attempt_id=e.attempt_id\nLEFT JOIN cosmic_attempt_results r ON r.user_id=d.user_id AND r.job_id=d.job_id AND r.attempt_id=d.attempt_id`;
 return `-- AUDIT ONLY: STAGING D1 SELECTs, never production.\n-- GitHub run ${report.runId}, attempt 1, commit ${report.commit}.\n-- Expected attempted formats: ${report.attempted}; report status: ${report.status}.\n-- Exact opaque job/attempt pairs from sanitized paid evidence; no time-window guessing.\n-- Execute only with authorized staging D1 read access. A missing result may\n-- be an unfinished waitUntil write; NEVER automatically retry a paid request.\n${cte}\nSELECT e.format,e.expected_model,\n COUNT(d.job_id) AS dispatch_receipts,\n COALESCE(SUM(CASE WHEN d.job_id IS NOT NULL AND d.model<>e.expected_model THEN 1 ELSE 0 END),0) AS wrong_model_dispatches,\n COUNT(r.attempt_id) AS result_receipts,\n COALESCE(SUM(CASE WHEN r.success=1 THEN 1 ELSE 0 END),0) AS recorded_successes,\n COALESCE(SUM(CASE WHEN r.success=0 THEN 1 ELSE 0 END),0) AS recorded_failures,\n COUNT(DISTINCT d.user_id) AS distinct_principals\n${joins}\nGROUP BY e.format,e.expected_model\nORDER BY CASE e.format ${FORMATS.map((f,i)=>`WHEN '${f}' THEN ${i}`).join(' ')} END;\n\n${cte}\nSELECT COUNT(d.job_id) AS dispatch_receipts, COUNT(r.attempt_id) AS result_receipts,\n COUNT(DISTINCT d.user_id) AS distinct_principals,\n COALESCE(SUM(CASE WHEN d.job_id IS NOT NULL AND d.model<>e.expected_model THEN 1 ELSE 0 END),0) AS wrong_model_dispatches\n${joins};\n-- Cross-check against sanitized per-format CI evidence and provider billing.\n-- Exact IDs do not prove the upstream request was billed or completed.\n`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3){console.error('Usage: node scripts/staging-billing-sql.mjs <sanitized-staging-live-acceptance.json>');process.exitCode=2}
 else try{
  const report=JSON.parse(await readFile(process.argv[2],'utf8'));
  process.stdout.write(buildExactBillingSql(report));
 }catch{console.error('Failed closed: invalid paid receipt or unreadable input; no SQL emitted');process.exitCode=1}
}
