import test from 'node:test';
import assert from 'node:assert/strict';
import {SAFARI_DISK_PROBE_CAPABILITIES,isGenuineDiskRead,summarizeNativeDiskProbe,safariProbeErrorCategory,redactSafariNativeResult} from '../safari/disk-access-probe-contract.mjs';
const expected={size:16941,sha256:'a'.repeat(64),sliceSha256:'b'.repeat(64),mtimeNs:'315532800000000000'};
const valid={name:'format.mp3',type:'audio/mpeg',size:16941,bytesRead:16941,sha256:expected.sha256,sliceSha256:expected.sliceSha256,changeCount:1,lastModified:315532800000};
test('native probe accepts only matching real full and slice digests, metadata, and one change',()=>{
  assert.equal(isGenuineDiskRead(valid,expected),true);
});
for(const [field,value] of [
  ['name','wrong.mp3'],['type','text/html'],['size',0],['bytesRead',0],['sha256','c'.repeat(64)],
  ['sliceSha256','d'.repeat(64)],['changeCount',0],['lastModified',0],['error','NotReadableError']
])test(`native disk probe fails closed on ${field} discrepancy`,()=>{
  assert.equal(isGenuineDiskRead({...valid,[field]:value},expected),false);
});
test('native Safari disk probe accepts documented MP3 MIME hints without relaxing byte identity',()=>{
  for(const type of ['', 'audio/mpeg', 'audio/mp3', 'audio/x-mp3', 'audio/x-mpeg']){
    assert.equal(isGenuineDiskRead({...valid,type},expected),true,`Expected valid native MIME hint ${JSON.stringify(type)}`);
  }
  assert.equal(isGenuineDiskRead({...valid,type:'text/html'},expected),false);
  assert.equal(isGenuineDiskRead({...valid,type:'audio/mpeg',sha256:'0'.repeat(64)},expected),false);
});

test('native disk probe fails closed without native file or expected disk identity',()=>{
  assert.equal(isGenuineDiskRead(null,expected),false);
  assert.equal(isGenuineDiskRead(valid,null),false);
});

test('fresh-mtime diagnostic identity must match its own disk mtime and cannot certify the original fixture',()=>{
  const freshExpected={...expected,mtimeNs:'1792100000000000000'};
  const freshNative={...valid,lastModified:Number(BigInt(freshExpected.mtimeNs)/1000000n)};
  assert.equal(isGenuineDiskRead(freshNative,freshExpected),true);
  assert.equal(isGenuineDiskRead(freshNative,expected),false);
  assert.equal(isGenuineDiskRead(valid,freshExpected),false);
});

test('fresh-timestamp-only Safari read cannot green-light the preserved-mtime diagnostic',()=>{
  assert.deepEqual(summarizeNativeDiskProbe([{timestampMode:'preserved',status:'FAIL'},{timestampMode:'fresh',status:'PASS'}]),
    {status:'FAIL',freshMtimeDiagnostic:'PASS'});
  assert.deepEqual(summarizeNativeDiskProbe([{timestampMode:'preserved',status:'PASS'},{timestampMode:'fresh',status:'FAIL'}]),
    {status:'PASS',freshMtimeDiagnostic:'FAIL'});
  assert.deepEqual(summarizeNativeDiskProbe([]),{status:'FAIL',freshMtimeDiagnostic:'FAIL'});
});

test('independent genuine SafariDriver disk probe requests official per-session diagnostics',()=>{
  assert.deepEqual(SAFARI_DISK_PROBE_CAPABILITIES,{alwaysMatch:{
    browserName:'safari',acceptInsecureCerts:true,strictFileInteractability:false,
    'safari:diagnose':true
  }});
  assert.equal(Object.isFrozen(SAFARI_DISK_PROBE_CAPABILITIES),true);
  assert.equal(Object.isFrozen(SAFARI_DISK_PROBE_CAPABILITIES.alwaysMatch),true);
});


test('Safari diagnostic artifact redacts local paths, bearer tokens and WebDriver stacks',()=>{
  const secret='Bearer secret-token-123 /Users/runner/private/format.mp3 https://internal.invalid/session';
  assert.equal(safariProbeErrorCategory(new Error(`NotReadableError: ${secret}`)),'NotReadableError');
  assert.equal(safariProbeErrorCategory(new Error(`unexpected ${secret}`)),'UnclassifiedError');
  const raw={...valid,name:secret,type:secret,error:`NotReadableError: ${secret}`};
  const safe=redactSafariNativeResult(raw);
  assert.deepEqual(safe,{nameMatches:false,mimeHint:'OTHER',size:16941,bytesRead:16941,
    lastModified:315532800000,changeCount:1,sha256:expected.sha256,
    sliceSha256:expected.sliceSha256,errorCode:'NotReadableError'});
  assert.equal(JSON.stringify(safe).includes(secret),false);
  assert.equal(redactSafariNativeResult(null),null);
});

test('independent Safari probe never exports raw paths, capabilities or exception stacks',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../safari/disk-access-probe.mjs',import.meta.url),'utf8');
  for(const unsafe of ['location:fixture.file','report.capabilities=session.capabilities',
    'report.error=String(error?.stack||error)','output.native=result','reason:staged.error']){
    assert.equal(source.includes(unsafe),false,`Raw diagnostic evidence must not include ${unsafe}`);
  }
  assert.match(source,/output\.native=redactSafariNativeResult\(result\)/);
});
