import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {canonicalSafariNativeError,sanitizeSafariAcceptanceReport} from '../safari/safari-report-sanitize.mjs';
import {verifyNarrowSafari26StagingWaiver,SAFARI26_WAIVER_ID} from '../../scripts/safari-staging-waiver.mjs';

const known='NotReadableError: The I/O read operation failed.';
const secret='Bearer PRIVATE_TOKEN /Users/runner/secret.mp3 https://private.invalid/a?token=secret';
const identity={size:16941,sha256:'e799ee1a44f73c9a4b146e76cce9deae6390ebc2aad3f51da13ce9dda2182b55',mtimeNs:'315532800000000000'};
const checks=['native disk fixtures are world-readable, byte-identical and timestamp-identical','real Safari shell, native controls and strict localhost HTTPS origin','mocked BYOK setup clears plaintext and uses HttpOnly session'].map(name=>({name,status:'PASS'}));
const report=()=>({
 schema:'cosmic-real-safari-native-acceptance-1',status:'FAIL',platform:'darwin',
 startedAt:'2026-10-16T15:15:00.000Z',finishedAt:'2026-10-16T15:15:12.000Z',
 capabilities:{browserName:'Safari',browserVersion:'26.6.2',platformName:secret,webdriverLogs:secret},
 providerCalls:0,checks,fixturesPreserved:true,
 error:`AssertionError: ${secret}`,serverError:secret,cleanupError:secret,
 fixtures:[{name:'format.mp3',format:'mp3',nativeSelectionMode:'safaridriver-sendkeys',
  nativePreparationStatus:'FAIL',workflowStatus:'NOT RUN',before:identity,after:identity,
  native:{error:known+'\n'+secret,arbitrary:secret,diskReadDiagnostics:{size:16941,type:'audio/mpeg',
   sliceArrayBuffer:{ok:false,error:known+'\n'+secret},fileReader:{ok:false,error:known+'\n'+secret},
   blobUrlFetch:{ok:false,error:'TypeError: Load failed '+secret}}}
 }],requests:[{metadata:{attemptId:secret},url:secret,apiKey:secret}],
 safariDiagnosticSummary:{available:true,filesFound:2,filesInspected:2,bytesInspected:128,counts:{notReadableError:1,sandbox:1,permission:0,denied:1,fileRead:3},rawLog:secret}
});

test('strict Safari artifact redacts arbitrary stack, path, token and capability values without weakening the staging-only waiver',()=>{
 const safe=sanitizeSafariAcceptanceReport(report());
 const encoded=JSON.stringify(safe);
 assert.equal(encoded.includes(secret),false);
 assert.equal(encoded.includes('/Users/runner'),false);
 assert.equal(safe.errorCode,'UnclassifiedError');
 assert.deepEqual(safe.capabilities,{browserName:'Safari',browserVersion:'26.6.2'});
 assert.equal(safe.fixtures[0].native.error,known);
 assert.equal(safe.fixtures[0].native.diskReadDiagnostics.blobUrlFetch.error,'TypeError: Load failed');
 assert.equal(safe.requestCount,1);
 assert.equal(safe.requests[0].metadata.attemptId,null);
 assert.equal(verifyNarrowSafari26StagingWaiver(safe),SAFARI26_WAIVER_ID);
});

test('strict Safari artifact does not copy unknown file names, MIME, metadata or WebDriver errors',()=>{
 const raw=report();raw.fixtures[0].name=secret;raw.fixtures[0].native.name=secret;
 raw.fixtures[0].native.type=secret;raw.fixtures[0].native.error='TimeoutError: '+secret;
 raw.fixtures[0].native.diskReadDiagnostics.type=secret;
 raw.requests[0].contentType=secret;raw.requests[0].metadata.model=secret;
 const safe=sanitizeSafariAcceptanceReport(raw);
 assert.equal(JSON.stringify(safe).includes(secret),false);
 assert.equal(safe.fixtures[0].name,'OTHER');
 assert.equal(safe.fixtures[0].native.name,'OTHER');
 assert.equal(safe.fixtures[0].native.error,'TimeoutError');
 assert.equal(safe.fixtures[0].native.diskReadDiagnostics.type,'OTHER');
 assert.equal(safe.requests[0].contentType,'OTHER');
 assert.equal(safe.requests[0].metadata.model,'OTHER');
 assert.throws(()=>verifyNarrowSafari26StagingWaiver(safe));
});

test('known native Safari error signatures remain canonical, without exporting stack content',()=>{
 assert.equal(canonicalSafariNativeError(known+'\n'+secret),known);
 assert.equal(canonicalSafariNativeError('TypeError: Load failed\n'+secret),'TypeError: Load failed');
 assert.equal(canonicalSafariNativeError('Error: '+secret),'UnclassifiedError');
});

test('strict Safari writes and prints only sanitized acceptance evidence',async()=>{
 const source=await readFile(new URL('../safari/safari-smoke.mjs',import.meta.url),'utf8');
 assert.match(source,/publicReport=sanitizeSafariAcceptanceReport\(report\)/);
 assert.match(source,/JSON\.stringify\(publicReport,null,2\)/);
 assert.match(source,/SAFARI_NATIVE_ACCEPTANCE_JSON=\$\{JSON\.stringify\(publicReport\)\}/);
 assert.equal(source.includes('console.error(`Real Safari native-file acceptance FAILED: ${report.error}`)'),false);
});
