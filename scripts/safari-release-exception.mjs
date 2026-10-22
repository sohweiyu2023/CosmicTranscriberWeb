import assert from 'node:assert/strict';
import {readFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {verifyNarrowSafari26StagingWaiver,SAFARI26_WAIVER_ID} from './safari-staging-waiver.mjs';

// Owner accepted on 2026-10-22 for the 1.2.0 release only. This recognizes a
// failed native test; it does not certify Safari or waive any other release gate.
export const SAFARI_RELEASE_EXCEPTION_VERSION='1.2.0';
export const SAFARI_RELEASE_EXCEPTION_ID=SAFARI26_WAIVER_ID;
const READ_ERROR='NotReadableError: The I/O read operation failed.';
const FIXTURE_IDENTITY={
  size:16941,
  sha256:'e799ee1a44f73c9a4b146e76cce9deae6390ebc2aad3f51da13ce9dda2182b55',
  mtimeNs:'315532800000000000'
};

function requireKeys(value,keys,label){
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value),`${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),`${label} contains missing or unreviewed fields`);
}

export function verifyNarrowSafari26ReleaseException(report,{packageVersion}={}){
  assert.equal(packageVersion,SAFARI_RELEASE_EXCEPTION_VERSION,'Exception is limited to the reviewed 1.2.0 release');
  // Reuse all existing staging assertions, without broadening that policy.
  assert.equal(verifyNarrowSafari26StagingWaiver(report),SAFARI_RELEASE_EXCEPTION_ID);
  // The sanitized report must contain only the reviewed fields. In particular,
  // server/driver/integrity/cleanup errors (even null or empty) cannot be waived.
  requireKeys(report,['schema','status','platform','startedAt','finishedAt','providerCalls','fixturesPreserved','capabilities','checks','fixtures','requestCount','requests','safariDiagnosticSummary','errorCode'],'Native Safari report');
  assert.equal(report.errorCode,'NotReadableError','Only the native disk-read failure is covered');
  assert.equal(report.fixturesPreserved,true,'Every original native fixture must remain unchanged');
  assert.equal(report.requestCount,0,'No transcription request may have been dispatched');
  assert.deepEqual(report.requests,[],'The request receipt must explicitly be empty');
  assert.deepEqual(report.capabilities,{browserName:'Safari',browserVersion:'26.6.2'});
  for(const key of ['startedAt','finishedAt']){
    assert.equal(typeof report[key],'string',`${key} is required`);
    const timestamp=Date.parse(report[key]);
    assert.ok(Number.isFinite(timestamp)&&new Date(timestamp).toISOString()===report[key],`${key} must be a canonical UTC timestamp`);
  }
  assert.ok(Date.parse(report.finishedAt)>=Date.parse(report.startedAt),'The report must record a completed attempt');
  assert.deepEqual(report.fixtures[0],{
    name:'format.mp3',format:'mp3',expectedDuration:1,
    expectedDispatch:{bytes:16896,sha256:'79e8469c541ed481cdc6067c038b12570ee6091f42f3955ef34f09c6132b9909'},
    before:FIXTURE_IDENTITY,after:FIXTURE_IDENTITY,
    native:{error:READ_ERROR,diskReadDiagnostics:{size:16941,type:'audio/mpeg',
      sliceArrayBuffer:{ok:false,error:READ_ERROR},
      fileReader:{ok:false,error:READ_ERROR},
      blobUrlFetch:{ok:false,error:'TypeError: Load failed'}
    }},
    nativeSelectionMode:'safaridriver-sendkeys',nativePickerDiagnostic:{mode:'not-attempted'},
    nativePreparationStatus:'FAIL',workflowStatus:'NOT RUN'
  },'Only the exact reviewed first-MP3 native read failure is covered');
  const diagnostics=report.safariDiagnosticSummary;
  requireKeys(diagnostics,['available','filesFound','filesInspected','bytesInspected','counts'],'Safari diagnostic summary');
  assert.equal(diagnostics.available,true,'Diagnostic collection must not fail');
  requireKeys(diagnostics.counts,['notReadableError','sandbox','permission','denied','fileRead'],'Safari diagnostic counts');
  for(const value of [diagnostics.filesFound,diagnostics.filesInspected,diagnostics.bytesInspected,...Object.values(diagnostics.counts)]){
    assert.ok(Number.isSafeInteger(value)&&value>=0,'Diagnostic counters must be nonnegative integers');
  }
  assert.ok(diagnostics.filesInspected<=diagnostics.filesFound,'Diagnostic file counts must be consistent');
  return {
    status:'WAIVED',exceptionId:SAFARI_RELEASE_EXCEPTION_ID,packageVersion,
    nativeSafariStatus:'FAIL',genuineMacSafariValidated:false,
    reason:'SafariDriver 26.6.2 cannot read the unchanged native MP3 before transcription dispatch.',
    iphoneSafariEvidence:'User-reported successful iPhone Safari happy path; distinct from Mac Safari validation.',
    allOtherGatesRequired:true,certifiesRelease:false,
    decision:'docs/RELEASE_EXCEPTION_2026-10-22.md'
  };
}

function main(){
  assert.equal(process.argv.length,3,'Usage: node scripts/safari-release-exception.mjs <sanitized-native-report.json>');
  const report=JSON.parse(readFileSync(process.argv[2],'utf8'));
  const {version}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const result=verifyNarrowSafari26ReleaseException(report,{packageVersion:version});
  console.log(JSON.stringify(result));
  const disclosure='Native Safari: WAIVED for the exact reviewed SafariDriver 26.6.2 disk-read failure. Genuine Mac Safari remains NOT VALIDATED. User-reported iPhone Safari success is separate evidence. All unrelated release gates remain required; this is not full release certification.';
  console.log(disclosure);
  if(process.env.GITHUB_STEP_SUMMARY){
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### Owner-accepted Safari automation exception for ${version}\n\n${disclosure}\n\nException: ${result.exceptionId}. Decision: docs/RELEASE_EXCEPTION_2026-10-22.md. Tracking: https://github.com/sohweiyu2023/CosmicTranscriberWeb/issues/6\n`);
  }
  if(process.env.GITHUB_OUTPUT){
    appendFileSync(process.env.GITHUB_OUTPUT,`outcome=waived\nexception_id=${result.exceptionId}\ngenuine_mac_safari_validated=false\n`);
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{main()}
  catch{
    console.error('RELEASE Safari exception REJECTED: evidence does not match the complete reviewed 1.2.0 failure signature. All release gates remain required.');
    process.exitCode=1;
  }
}
