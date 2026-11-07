import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {sanitizeOrdinarySafariReport,macProcessFacts,safeMacProcessFacts,ordinaryErrorCategory,ordinarySafariGuardScript,ordinarySafariCleanupScript,runOrdinaryCleanup} from '../safari/ordinary-native-report-sanitize.mjs';

const secret='Bearer PRIVATE_TOKEN /Users/runner/private/secret.mp3 https://private.invalid/?token=secret';
const hash='a'.repeat(64);
const base={schema:'cosmic-ordinary-safari-file-probe-1',status:'FAIL',platform:'darwin',
 startedAt:'2026-10-16T11:15:00.000Z',finishedAt:'2026-10-16T11:15:12.000Z',
 source:{size:16941,sha256:hash,sliceSha256:hash,mtimeNs:'315532800000000000'},
 origin:'loopback-http-test-only',guiPicker:{method:'genuine-System-Events-mouse-click-and-open-panel',stages:[
  {stage:'native-mouse-click',osascriptStatus:1,osascriptError:secret,screenshotStatus:1,screenshotBytes:0,extra:secret}
 ]},native:{isTrusted:true,name:'format.mp3',type:'audio/mpeg',size:16941,bytesRead:0,lastModified:315532800000,
  sha256:hash,sliceSha256:hash,duration:1,error:'NotReadableError: '+secret,secret},
 error:'Error: '+secret,cleanupError:secret,failureScreenshot:secret,other:secret};

test('ordinary Safari GUI report retains genuine disk oracle data but strips all untrusted strings',()=>{
 const safe=sanitizeOrdinarySafariReport(base);
 assert.equal(JSON.stringify(safe).includes(secret),false);
 assert.equal(JSON.stringify(safe).includes('/Users/runner'),false);
 assert.equal(safe.native.name,'format.mp3');assert.equal(safe.native.sha256,hash);
 assert.equal(safe.native.errorCode,'NotReadableError');
 assert.equal(safe.guiPicker.stages[0].stage,'native-mouse-click');
 assert.equal(safe.guiPicker.stages[0].osascriptErrorCode,'UnclassifiedError');
 assert.equal(safe.failureScreenshot,null);assert.equal(safe.status,'FAIL');
});
test('ordinary Safari GUI report fails closed for unrecognized fields and preserves PASS without manufacturing it',()=>{
 const safe=sanitizeOrdinarySafariReport({...base,status:'PASS',native:{...base.native,name:secret,type:secret,sha256:secret},guiPicker:{method:secret,stages:[{stage:secret,osascriptStatus:999,screenshotStatus:-1}]}});
 assert.equal(safe.status,'PASS');assert.equal(safe.native.name,'OTHER');assert.equal(safe.native.type,'OTHER');
 assert.equal(safe.native.sha256,null);assert.equal(safe.guiPicker.method,'OTHER');
 assert.equal(safe.guiPicker.stages[0].stage,'OTHER');assert.equal(safe.guiPicker.stages[0].osascriptStatus,null);
 assert.equal(safe.guiPicker.stages[0].screenshotStatus,null);
 assert.equal(JSON.stringify(safe).includes(secret),false);
});
test('ordinary Safari GUI probe publishes only sanitized report and no raw AppleScript stderr or stacks',async()=>{
 const source=await readFile(new URL('../safari/ordinary-native-gui-probe.mjs',import.meta.url),'utf8');
 assert.match(source,/publicReport=sanitizeOrdinarySafariReport\(report\)/);
 assert.match(source,/writeFile\(output,JSON\.stringify\(publicReport,null,2\)/);
 assert.match(source,/ORDINARY_SAFARI_NATIVE_FILE_REPORT=\$\{JSON\.stringify\(publicReport\)\}/);
 assert.equal(source.includes('report.error=String(error?.stack'),false);
 assert.equal(source.includes('osascriptError:String(command.error?.message'),false);
});

test('ordinary process facts preserve actionable known causes without raw output',()=>{
 for(const [result,kind] of [
  [{status:1,stderr:'System Events: not authorized to send Apple events. '+secret},'apple-events-denied'],
  [{status:1,stderr:'osascript is not allowed assistive access. '+secret},'assistive-access-denied'],
  [{status:null,error:{code:'ETIMEDOUT',message:secret},stderr:secret},'timeout'],
  [{status:null,error:{code:'ENOENT',message:secret}},'command-missing'],
  [{status:null,error:{code:'EPERM',message:secret}},'execution-denied'],
  [{status:null,error:{code:'ENOBUFS',message:secret}},'output-limit'],
  [{status:null,signal:'SIGTERM',stderr:secret},'interrupted'],
  [{status:2,stderr:'<html>'+secret},'process-failed'],[{status:0},'none']
 ]){const facts=macProcessFacts(result);assert.equal(facts.failureKind,kind);assert.equal(JSON.stringify(facts).includes(secret),false);assert.equal(facts.rawOutput,'omitted')}
});
test('ordinary process fact projections bound data, resist getters, and retain completeness',()=>{
 const raw=macProcessFacts({status:1,stderr:'x'.repeat(9000)+secret});assert.equal(raw.stderrCharsInspected,8192);assert.equal(raw.stderrTruncated,true);assert.equal(raw.detailsState,'unrecognized-output-omitted');
 let reads=0;const projected=safeMacProcessFacts({get failureKind(){return ++reads===1?'timeout':secret},exitStatus:999,signal:secret,stderrCharsInspected:Infinity,detailsState:secret,extra:secret});assert.equal(projected.failureKind,'timeout');assert.equal(projected.exitStatus,null);assert.equal(projected.signal,null);assert.equal(projected.stderrCharsInspected,null);assert.equal(JSON.stringify(projected).includes(secret),false);
 const bad={};Object.defineProperty(bad,'error',{get(){throw new Error(secret)}});assert.doesNotThrow(()=>macProcessFacts(bad));
});
test('ordinary sanitized evidence retains process failures and exact fixture aftermath',()=>{
 const report=sanitizeOrdinarySafariReport({...base,browserVersion:'27.2',architecture:'arm64',fixturesPreserved:true,sourceAfter:base.source,selectedAfter:base.source,processes:{browserOpen:macProcessFacts({status:1,stderr:'not authorized to send Apple events '+secret})},guiPicker:{...base.guiPicker,stages:[{stage:'native-open',osascriptDiagnostic:macProcessFacts({status:1,stderr:'not allowed assistive access '+secret})}]}});
 const persisted=JSON.parse(JSON.stringify(report));assert.equal(persisted.browserVersion,'27.2');assert.equal(persisted.architecture,'arm64');assert.equal(persisted.fixturesPreserved,true);assert.equal(persisted.sourceAfter.sha256,hash);assert.equal(persisted.processes.browserOpen.failureKind,'apple-events-denied');assert.equal(persisted.guiPicker.stages[0].osascriptDiagnostic.failureKind,'assistive-access-denied');assert.equal(JSON.stringify(persisted).includes(secret),false);
});

test('ordinary diagnostic is bounded, default driver-free, read-only and source pinned',async()=>{
 const workflow=await readFile(new URL('../../.github/workflows/safari-native-diagnostic.yml',import.meta.url),'utf8');
 assert.match(workflow,/include_driver:[\s\S]*?type: boolean[\s\S]*?default: false/);
 assert.match(workflow,/native-safari-diagnostic:\s*if: \$\{\{ github.event_name == 'push' \|\| inputs.include_driver == true \}\}/);
 assert.match(workflow,/permissions:\s+contents: read\s+jobs:/);
 const ordinary=workflow.split('  ordinary-safari-gui-diagnostic:')[1];assert.ok(ordinary);assert.equal(ordinary.includes('npm '),false);assert.equal(ordinary.includes('safaridriver'),false);assert.equal(ordinary.includes('sudo '),false);assert.match(ordinary,/timeout-minutes: 4/);assert.match(ordinary,/COSMIC_ORDINARY_SAFARI_EXPECTED_VERSION: '27.2'/);
 const expected=['tests/safari/ordinary-native-gui-probe.mjs','tests/safari/ordinary-native-file-contract.mjs','tests/safari/ordinary-native-report-sanitize.mjs','tests/safari/disk-access-probe-contract.mjs','tests/fixtures/format.mp3'];
 const listed=Array.from(ordinary.matchAll(/^\s+([0-9a-f]{64})  (tests\/[^\r\n]+)$/gm));assert.equal(listed.length,expected.length);assert.deepEqual(listed.map(x=>x[2]),expected);
 for(const [,hash,file] of listed){const bytes=await readFile(new URL('../../'+file,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,file)}
});

test('ordinary exception classification and version projection cannot leak throwing or changing getters',()=>{
 const error={};Object.defineProperty(error,'message',{get(){throw new Error(secret)}});assert.equal(ordinaryErrorCategory(error),'UnclassifiedError');
 let reads=0;const safe=sanitizeOrdinarySafariReport({...base,get browserVersion(){return ++reads===1?'27.2':secret}});assert.equal(safe.browserVersion,'27.2');assert.equal(JSON.stringify(safe).includes(secret),false);
});

test('ordinary native input requires verified Safari window then native panel ownership',()=>{
 const page=ordinarySafariGuardScript('page'),panel=ordinarySafariGuardScript('chooser');
 for(const script of [page,panel]){assert.match(script,/frontApp is not "Safari"/);assert.match(script,/count of windows/);assert.equal(/keystroke|key code|click at|defaults write/.test(script),false)}
 assert.match(page,/Genuine ordinary Safari file picker/);assert.match(panel,/count of sheets of window 1/);assert.throws(()=>ordinarySafariGuardScript(true));assert.match(panel,/hasOpen and hasCancel and hasFiles/);assert.match(ordinarySafariGuardScript('go-to-folder'),/hasGo and hasFolderField/);
 for(const [marker,kind] of [['CTW_SAFARI_NOT_FOREGROUND','foreground-unverified'],['CTW_SAFARI_NATIVE_WINDOW_UNVERIFIED','native-window-unverified'],['CTW_SAFARI_NATIVE_PANEL_UNVERIFIED','native-panel-unverified']]){const safe=macProcessFacts({status:1,stderr:marker+' '+secret});assert.equal(safe.failureKind,kind);assert.equal(JSON.stringify(safe).includes(secret),false)}
});

test('ordinary cleanup closes only the positively owned unblocked page and fails terminally on disk errors',async()=>{
 const script=ordinarySafariCleanupScript('http://127.0.0.1:34567/');assert.match(script,/URL of current tab/);assert.match(script,/count of sheets/);assert.match(script,/close ownedWindow/);assert.equal(script.includes('to quit'),false);assert.throws(()=>ordinarySafariCleanupScript('https://private.invalid/'));assert.throws(()=>ordinarySafariCleanupScript('http://127.0.0.1:34567/?token=private'));
 const report={status:'PASS'};await runOrdinaryCleanup(async()=>{throw Object.assign(new Error(secret),{code:'EPERM'})},report);assert.equal(report.status,'FAIL');assert.equal(report.cleanupErrorCode,'PermissionDenied');assert.equal(JSON.stringify(report).includes(secret),false);
});
