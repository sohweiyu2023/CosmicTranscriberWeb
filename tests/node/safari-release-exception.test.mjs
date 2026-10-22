import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNarrowSafari26ReleaseException,SAFARI_RELEASE_EXCEPTION_ID} from '../../scripts/safari-release-exception.mjs';

const READ_ERROR='NotReadableError: The I/O read operation failed.';
const identity=()=>({size:16941,sha256:'e799ee1a44f73c9a4b146e76cce9deae6390ebc2aad3f51da13ce9dda2182b55',mtimeNs:'315532800000000000'});
const makeReport=()=>({
  schema:'cosmic-real-safari-native-acceptance-1',status:'FAIL',platform:'darwin',
  startedAt:'2026-10-22T04:05:34.825Z',finishedAt:'2026-10-22T04:06:09.678Z',
  providerCalls:0,fixturesPreserved:true,capabilities:{browserName:'Safari',browserVersion:'26.6.2'},
  checks:[
    'native disk fixtures are world-readable, byte-identical and timestamp-identical',
    'real Safari shell, native controls and strict localhost HTTPS origin',
    'mocked BYOK setup clears plaintext and uses HttpOnly session'
  ].map(name=>({name,status:'PASS'})),
  fixtures:[{
    name:'format.mp3',format:'mp3',expectedDuration:1,
    expectedDispatch:{bytes:16896,sha256:'79e8469c541ed481cdc6067c038b12570ee6091f42f3955ef34f09c6132b9909'},
    before:identity(),after:identity(),native:{error:READ_ERROR,diskReadDiagnostics:{
      size:16941,type:'audio/mpeg',sliceArrayBuffer:{ok:false,error:READ_ERROR},
      fileReader:{ok:false,error:READ_ERROR},blobUrlFetch:{ok:false,error:'TypeError: Load failed'}
    }},
    nativeSelectionMode:'safaridriver-sendkeys',nativePickerDiagnostic:{mode:'not-attempted'},
    nativePreparationStatus:'FAIL',workflowStatus:'NOT RUN'
  }],
  requestCount:0,requests:[],safariDiagnosticSummary:{available:true,filesFound:0,filesInspected:0,bytesInspected:0,
    counts:{notReadableError:0,sandbox:0,permission:0,denied:0,fileRead:0}},
  errorCode:'NotReadableError'
});
const verify=report=>verifyNarrowSafari26ReleaseException(report,{packageVersion:'1.2.0'});

test('release exception reports a waiver, never genuine Mac Safari or full-release certification',()=>{
  const report=makeReport(),before=structuredClone(report),result=verify(report);
  assert.equal(result.status,'WAIVED');
  assert.equal(result.exceptionId,SAFARI_RELEASE_EXCEPTION_ID);
  assert.equal(result.nativeSafariStatus,'FAIL');
  assert.equal(result.genuineMacSafariValidated,false);
  assert.equal(result.certifiesRelease,false);
  assert.equal(result.allOtherGatesRequired,true);
  assert.match(result.iphoneSafariEvidence,/User-reported.*distinct from Mac Safari/);
  assert.deepEqual(report,before,'Verification must not rewrite failed evidence');
});

test('release exception is limited to the reviewed release version',()=>{
  for(const packageVersion of [undefined,null,'','1.2.1','1.3.0','1.2.0-preview',1.2]){
    assert.throws(()=>verifyNarrowSafari26ReleaseException(makeReport(),{packageVersion}));
  }
});

test('release exception fails closed when any required report or fixture evidence is absent',()=>{
  for(const key of Object.keys(makeReport())){
    const report=makeReport();delete report[key];assert.throws(()=>verify(report),key);
  }
  for(const key of Object.keys(makeReport().fixtures[0])){
    const report=makeReport();delete report.fixtures[0][key];assert.throws(()=>verify(report),key);
  }
  for(const key of Object.keys(makeReport().fixtures[0].before)){
    const report=makeReport();delete report.fixtures[0].before[key];delete report.fixtures[0].after[key];
    assert.throws(()=>verify(report),`both identities missing ${key}`);
  }
  for(const key of Object.keys(makeReport().fixtures[0].native.diskReadDiagnostics)){
    const report=makeReport();delete report.fixtures[0].native.diskReadDiagnostics[key];assert.throws(()=>verify(report),key);
  }
});

test('release exception rejects changed browsers, fixtures, request receipts and unrelated failed checks',()=>{
  const changes=[
    r=>{r.status='PASS'},r=>{r.status='SKIPPED'},r=>{r.platform='linux'},
    r=>{r.capabilities.browserVersion='26.6.3'},r=>{r.capabilities.browserName='WebKit'},
    r=>{r.providerCalls=1},r=>{r.requestCount=1},r=>{r.requests.push({})},
    r=>{r.fixturesPreserved=false},r=>{r.errorCode='TimeoutError'},
    r=>{r.checks[2].status='FAIL'},r=>{r.checks.push({name:'Unrelated check',status:'FAIL'})},
    r=>{r.fixtures.push(structuredClone(r.fixtures[0]))},r=>{r.fixtures[0].name='format.wav'},
    r=>{r.fixtures[0].nativeSelectionMode='synthetic'},r=>{r.fixtures[0].nativePickerDiagnostic.mode='native-picker'},
    r=>{r.fixtures[0].nativePreparationStatus='PASS'},r=>{r.fixtures[0].workflowStatus='PASS'},
    r=>{r.fixtures[0].after.mtimeNs='315532800000000001'},
    r=>{r.fixtures[0].before.mtimeNs=r.fixtures[0].after.mtimeNs='1792641934825000000'},
    r=>{r.fixtures[0].before.sha256=r.fixtures[0].after.sha256='0'.repeat(64)},
    r=>{r.fixtures[0].before.size=r.fixtures[0].after.size=16940},
    r=>{r.fixtures[0].expectedDispatch.sha256='0'.repeat(64)},r=>{r.fixtures[0].expectedDuration=0},
    r=>{r.startedAt=null},r=>{r.finishedAt='2026-10-22T04:05:00.000Z'},
    r=>{r.safariDiagnosticSummary.available=false},r=>{r.safariDiagnosticSummary.counts.denied=-1},
    r=>{r.safariDiagnosticSummary.filesInspected=1}
  ];
  changes.forEach((mutate,index)=>{const report=makeReport();mutate(report);assert.throws(()=>verify(report),`change ${index}`)});
});

test('release exception rejects compound cleanup, integrity, server, driver and diagnostic errors',()=>{
  for(const field of ['serverErrorCode','driverErrorCode','integrityErrorCode','cleanupErrorCode','serverError','driverError','integrityError','cleanupError','error','anotherFailure']){
    for(const value of ['NotReadableError',null,'',false]){
      const report=makeReport();report[field]=value;assert.throws(()=>verify(report),field);
    }
  }
  const report=makeReport();report.safariDiagnosticSummary.errorCode='PermissionError';assert.throws(()=>verify(report));
  const nativeReport=makeReport();nativeReport.fixtures[0].native.cleanupErrorCode='UnknownError';assert.throws(()=>verify(nativeReport));
});

test('release exception requires exact canonical errors and fails closed on partial reads',()=>{
  for(const readName of ['sliceArrayBuffer','fileReader','blobUrlFetch']){
    for(const mutate of [read=>{read.ok=true},read=>{read.error+=' unrelated failure'},read=>{read.error='NotReadableError: another cause'},read=>{read.bytes=1},read=>{delete read.ok}]){
      const report=makeReport();mutate(report.fixtures[0].native.diskReadDiagnostics[readName]);assert.throws(()=>verify(report),readName);
    }
  }
  for(const error of [READ_ERROR+' another failure','NotReadableError: other cause','TypeError: Load failed','']){
    const report=makeReport();report.fixtures[0].native.error=error;assert.throws(()=>verify(report));
  }
});

test('release exception fixture digest is pinned to the actual bundled MP3',async()=>{
  const bytes=await readFile(new URL('../fixtures/format.mp3',import.meta.url));
  assert.equal(bytes.length,identity().size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),identity().sha256);
});

test('release exception CLI writes explicit waiver receipts only after complete validation',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'cosmic-safari-exception-'));
  try{
    const reportFile=path.join(dir,'native report.json'),output=path.join(dir,'output.txt'),summary=path.join(dir,'summary.md');
    await writeFile(reportFile,JSON.stringify(makeReport()));
    const script=fileURLToPath(new URL('../../scripts/safari-release-exception.mjs',import.meta.url));
    const result=spawnSync(process.execPath,[script,reportFile],{encoding:'utf8',env:{...process.env,GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:summary}});
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/"status":"WAIVED"/);
    assert.match(await readFile(output,'utf8'),/^outcome=waived\nexception_id=safaridriver-26\.6\.2-native-disk-not-readable\ngenuine_mac_safari_validated=false\n$/);
    assert.match(await readFile(summary,'utf8'),/Genuine Mac Safari remains NOT VALIDATED/);
    const invalid=makeReport();invalid.cleanupErrorCode='UnclassifiedError';await writeFile(reportFile,JSON.stringify(invalid));
    const rejectedOutput=path.join(dir,'rejected-output.txt'),rejectedSummary=path.join(dir,'rejected-summary.md');
    const rejected=spawnSync(process.execPath,[script,reportFile],{encoding:'utf8',env:{...process.env,GITHUB_OUTPUT:rejectedOutput,GITHUB_STEP_SUMMARY:rejectedSummary}});
    assert.equal(rejected.status,1);
    assert.match(rejected.stderr,/exception REJECTED/);
    await assert.rejects(access(rejectedOutput));await assert.rejects(access(rejectedSummary));
  }finally{await rm(dir,{recursive:true,force:true})}
});
