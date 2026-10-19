import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sanitizeOrdinarySafariReport} from '../safari/ordinary-native-report-sanitize.mjs';

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
