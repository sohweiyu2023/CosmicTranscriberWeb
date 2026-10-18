import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {verifyNarrowSafari26StagingWaiver,SAFARI26_WAIVER_ID} from '../../scripts/safari-staging-waiver.mjs';
const makeReport=()=>({
 schema:'cosmic-real-safari-native-acceptance-1',status:'FAIL',platform:'darwin',
 capabilities:{browserName:'Safari',browserVersion:'26.6.2'},providerCalls:0,
 checks:[
  {name:'native disk fixtures are world-readable, byte-identical and timestamp-identical',status:'PASS'},
  {name:'real Safari shell, native controls and strict localhost HTTPS origin',status:'PASS'},
  {name:'mocked BYOK setup clears plaintext and uses HttpOnly session',status:'PASS'}
 ],
 fixtures:[{
  name:'format.mp3',format:'mp3',nativeSelectionMode:'safaridriver-sendkeys',
  nativePreparationStatus:'FAIL',workflowStatus:'NOT RUN',
  before:{size:16941,sha256:'e799ee1a44f73c9a4b146e76cce9deae6390ebc2aad3f51da13ce9dda2182b55',mtimeNs:'315532800000000000'},
  after:{size:16941,sha256:'e799ee1a44f73c9a4b146e76cce9deae6390ebc2aad3f51da13ce9dda2182b55',mtimeNs:'315532800000000000'},
  native:{error:'NotReadableError: The I/O read operation failed.',diskReadDiagnostics:{
   size:16941,type:'audio/mpeg',
   sliceArrayBuffer:{ok:false,error:'NotReadableError: The I/O read operation failed.'},
   fileReader:{ok:false,error:'NotReadableError: The I/O read operation failed.'},
   blobUrlFetch:{ok:false,error:'TypeError: Load failed'}
  }}
 }]
});
test('staging-only Safari26 waiver recognizes only reviewed genuine disk read error',()=>{
 assert.equal(verifyNarrowSafari26StagingWaiver(makeReport()),SAFARI26_WAIVER_ID);
});
test('staging-only Safari26 waiver denies unexpected browsers, source mutations, paid dispatches and unrelated failures',()=>{
 const changes=[
  r=>{r.status='PASS'},r=>{r.capabilities.browserVersion='27.0'},r=>{r.capabilities.browserName='Chromium'},
  r=>{r.providerCalls=1},r=>{r.checks[2].status='FAIL'},r=>{r.fixtures[0].name='other.mp3'},
  r=>{r.fixtures[0].nativeSelectionMode='synthetic'},r=>{r.fixtures[0].nativePreparationStatus='PASS'},
  r=>{r.fixtures[0].workflowStatus='PASS'},r=>{r.fixtures[0].after.size=16940},
  r=>{r.fixtures[0].native.error='TimeoutError: unrelated failure'},
  r=>{r.fixtures[0].native.diskReadDiagnostics.fileReader.ok=true},
  r=>{r.fixtures[0].native.diskReadDiagnostics.blobUrlFetch.ok=true},
  r=>{r.fixtures.push(r.fixtures[0])},r=>{r.fixtures[0].before.sha256='0'.repeat(64)}
 ];
 for(const mutate of changes){const r=makeReport();mutate(r);assert.throws(()=>verifyNarrowSafari26StagingWaiver(r))}
});

test('staging-only Safari26 waiver rejects a same-sized substituted disk fixture even when before/after match',()=>{
 const r=makeReport();
 const substitutedDigest='0'.repeat(64);
 r.fixtures[0].before.sha256=substitutedDigest;
 r.fixtures[0].after.sha256=substitutedDigest;
 assert.throws(()=>verifyNarrowSafari26StagingWaiver(r),/reviewed MP3 SHA-256/);
});

test('reviewed Safari26 waiver digest is pinned to the actual bundled MP3 bytes',async()=>{
 const bytes=await readFile(new URL('../fixtures/format.mp3',import.meta.url));
 const sha256=createHash('sha256').update(bytes).digest('hex');
 assert.equal(bytes.length,16941);
 assert.equal(sha256,makeReport().fixtures[0].before.sha256);
});
