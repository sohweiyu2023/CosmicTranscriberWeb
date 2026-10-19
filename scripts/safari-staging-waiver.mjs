import assert from 'node:assert/strict';
import {readFileSync,appendFileSync} from 'node:fs';

// STAGING ONLY: user-authorized 2026-10-12 known SafariDriver 26.6.2
// disk File sandbox failure. Never certifies real Safari or production.
export const SAFARI26_WAIVER_ID='safaridriver-26.6.2-native-disk-not-readable';
// The staging exception applies to the reviewed fixture bytes, not merely
// a file with the same name and size. Keep this pinned to SHA256SUMS.txt.
const REVIEWED_MP3_SHA256='e799ee1a44f73c9a4b146e76cce9deae6390ebc2aad3f51da13ce9dda2182b55';
export function verifyNarrowSafari26StagingWaiver(report){
  assert.equal(report?.schema,'cosmic-real-safari-native-acceptance-1');
  assert.equal(report?.status,'FAIL');
  assert.equal(report?.platform,'darwin');
  assert.equal(report?.capabilities?.browserName,'Safari');
  assert.equal(report?.capabilities?.browserVersion,'26.6.2');
  assert.equal(report?.providerCalls,0,'Only zero-paid-request failures may be waived for staging');
  assert.equal(report?.fixtures?.length,1,'Only known first real MP3 selection may be waived');
  const item=report.fixtures[0];
  assert.equal(item.name,'format.mp3');
  assert.equal(item.format,'mp3');
  assert.equal(item.nativeSelectionMode,'safaridriver-sendkeys');
  assert.equal(item.nativePreparationStatus,'FAIL');
  assert.equal(item.workflowStatus,'NOT RUN');
  assert.deepEqual(item.after,item.before,'Original native source SHA256/mtime must remain intact');
  assert.equal(item.before.sha256,REVIEWED_MP3_SHA256,'Only the exact reviewed MP3 SHA-256 can use this staging waiver');
  assert.equal(item.before.size,16941,'Only the exact reviewed MP3 fixture can use this waiver');
  const native=item.native;
  assert.match(native?.error||'',/^NotReadableError: The I\/O read operation failed\./);
  const reads=native?.diskReadDiagnostics;
  assert.equal(reads?.size,item.before.size);
  assert.equal(reads?.type,'audio/mpeg');
  assert.equal(reads?.sliceArrayBuffer?.ok,false);
  assert.match(reads?.sliceArrayBuffer?.error||'',/^NotReadableError:/);
  assert.equal(reads?.fileReader?.ok,false);
  assert.match(reads?.fileReader?.error||'',/^NotReadableError:/);
  assert.equal(reads?.blobUrlFetch?.ok,false);
  assert.match(reads?.blobUrlFetch?.error||'',/^TypeError:/);
  const names=['native disk fixtures are world-readable, byte-identical and timestamp-identical','real Safari shell, native controls and strict localhost HTTPS origin','mocked BYOK setup clears plaintext and uses HttpOnly session'];
  assert.deepEqual(report.checks,names.map(name=>({name,status:'PASS'})));
  return SAFARI26_WAIVER_ID;
}

if(process.argv[1]?.endsWith('/safari-staging-waiver.mjs')){
  const report=JSON.parse(readFileSync(process.argv[2],'utf8'));
  const verified=verifyNarrowSafari26StagingWaiver(report);
  console.log('STAGING ONLY native Safari automation waiver accepted for exact known issue: '+verified);
  console.log('Real Safari is NOT CERTIFIED; production/final release remains blocked.');
  if(process.env.GITHUB_STEP_SUMMARY){
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\n### Staging-only known SafariDriver exception\n\nSafariDriver 26.6.2 genuine native disk MP3 read FAILED with reviewed NotReadableError signature. This is NOT a passing Safari test, and final release remains uncertified. All other macOS tests must still pass. Tracking: https://github.com/sohweiyu2023/CosmicTranscriberWeb/issues/6\n');
  }
}
