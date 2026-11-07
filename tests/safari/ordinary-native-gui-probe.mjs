import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {chmod,mkdir,mkdtemp,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createOrdinaryRunner,materializeOrdinaryFixture,ordinaryFileIdentity,waitOrdinaryReady} from './ordinary-native-runtime.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {isOrdinarySafariGenuineFile} from './ordinary-native-file-contract.mjs';
import {sanitizeOrdinarySafariReport,macProcessFacts,ordinaryErrorCategory,ordinarySafariGuardScript,ordinarySafariCleanupScript,runOrdinaryCleanup} from './ordinary-native-report-sanitize.mjs';

// Never start or connect to SafariDriver here. This isolated macOS runner
// operates an ordinary Safari window and its genuine macOS file chooser.
// Test-only page with no app instrumentation, no synthetic File/Blob/List.
const root=path.resolve(import.meta.dirname,'../..');
const source=path.join(root,'tests/fixtures/format.mp3');
const output=path.join(root,'test-results/ordinary-safari-native-picker.json');
const screenshot=path.join(root,'test-results/ordinary-safari-native-picker.png');
const report={schema:'cosmic-ordinary-safari-file-probe-1',role:'diagnostic-only-not-release-or-SafariDriver-certification',platform:process.platform,startedAt:new Date().toISOString(),status:'RUNNING',architecture:process.arch,processes:{}};
const identity=ordinaryFileIdentity;
const run=createOrdinaryRunner(report);
// Apple documents System Events UI scripting of the actual process. The
// macOS runner screenshots show the visible Choose File control at {210,100}
// in its 1024x768 ordinary Safari window. A native OS click (NOT WebDriver or
// JS .click()) is used, followed by real Open-panel key navigation. Captures
// are obtained by Node after each action, so no AppleScript child process can
// silently omit an intermediate GUI screenshot.
function pickerSteps(dir,name){return [
  {name:'native-mouse-click',guard:'page',pause:1400,script:`tell application "System Events" to tell process "Safari"
    click at {210, 100}
  end tell`},
  {name:'go-to-folder-sheet',guard:'chooser',pause:1000,script:`tell application "System Events"
    keystroke "g" using {command down, shift down}
  end tell`},
  {name:'native-parent-directory',guard:'go-to-folder',pause:600,script:`tell application "System Events"
    keystroke ${JSON.stringify(dir)}
  end tell`},
  {name:'native-parent-confirm',guard:'go-to-folder',pause:1400,script:`tell application "System Events"
    key code 36
  end tell`},
  {name:'native-filename',guard:'chooser',pause:900,script:`tell application "System Events"
    keystroke ${JSON.stringify(name)}
  end tell`},
  {name:'native-open',guard:'chooser',pause:1100,script:`tell application "System Events"
    key code 36
  end tell`},
]}
async function performOrdinaryNativePicker(dir,name){
  const stages=[];
  for(const stage of pickerSteps(dir,name)){
    const guardedScript=ordinarySafariGuardScript(stage.guard)+'\n'+stage.script;
    const command=await run('/usr/bin/osascript',['-e',guardedScript],12000);
    await delay(stage.pause);
    const dest=path.join(root,'test-results',`ordinary-safari-stage-${stage.name}.png`);
    const screen=await run('/usr/sbin/screencapture',['-x',dest],8000);
    let imageBytes=0;try{imageBytes=(await stat(dest)).size}catch{}
    const recorded={stage:stage.name,osascriptStatus:command.status,
      osascriptErrorCode:command.status===0?null:(command.error?.name||'UnclassifiedError'),osascriptDiagnostic:macProcessFacts(command),screenshotDiagnostic:macProcessFacts(screen),
      screenshotStatus:screen.status,screenshotBytes:imageBytes};
    stages.push(recorded);
    // Failure is never reported as success or hidden by later file-dialog keys.
    if(command.status!==0||command.error||command.outcomeUncertain||screen.status!==0||screen.error||imageBytes<1000)
      throw Object.assign(new Error(`Native picker stage ${stage.name} failed`),{stages});
  }
  return stages;
}
function page(token){return `<!doctype html><meta charset="utf-8"><title>Genuine ordinary Safari file picker</title>
<label for="diskFile">Choose genuine disk MP3</label>
<input id="diskFile" type="file" accept=".mp3,audio/mpeg" autofocus>
<p id="status">Awaiting real macOS file selection</p>
<script>
window.addEventListener('load',()=>{const input=document.getElementById('diskFile');input?.focus();fetch('/ready/${token}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({titleMatches:document.title==='Genuine ordinary Safari file picker',inputPresent:input?.type==='file',secureContext:window.isSecureContext,cryptoSubtlePresent:!!window.crypto?.subtle})}).catch(()=>{})});
document.getElementById('diskFile').addEventListener('change',async event=>{
  const file=event.currentTarget.files[0];
  const result={isTrusted:event.isTrusted,name:file?.name,type:file?.type,size:file?.size,lastModified:file?.lastModified};
  try{
    if(!file)throw Error('No real disk File was selected');
    const full=await file.arrayBuffer(),part=await file.slice(0,1024).arrayBuffer();
    const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
    result.bytesRead=full.byteLength;result.sha256=await digest(full);result.sliceSha256=await digest(part);
    result.duration=await new Promise((resolve,reject)=>{
      const audio=document.createElement('audio'),url=URL.createObjectURL(file);
      const timer=setTimeout(()=>{URL.revokeObjectURL(url);reject(Error('Native audio metadata timeout'))},12000);
      audio.onloadedmetadata=()=>{clearTimeout(timer);URL.revokeObjectURL(url);resolve(audio.duration)};
      audio.onerror=()=>{clearTimeout(timer);URL.revokeObjectURL(url);reject(Error('Native audio metadata error'))};
      audio.preload='metadata';audio.src=url;audio.load();
    });
  }catch(error){result.error=String(error?.name||'Error')+': '+String(error?.message||error)}
  try{await fetch('/result/${token}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(result)})}catch{}
  document.getElementById('status').textContent=result.error||'Browser-file access completed';
},{once:true});
</script>`}
let folder,server,fulfill,fulfillReady,expected,sourceExpected,selectedFile,browserUrl,browserOpened=false;
const ready=new Promise(resolve=>{fulfillReady=resolve});
report.pageReadiness={homeRequests:0,homeResponsesFinished:0,readyCallbacks:0,invalidReadyBodies:0,resultCallbacks:0,otherRequests:0,acknowledged:false,elapsedMs:null};
report.phase='setup';
try{
 if(process.platform!=='darwin')throw Error('Requires genuine macOS Safari, not simulated WebKit');
 await mkdir(path.dirname(output),{recursive:true});
 const version=await run('/usr/bin/defaults',['read','/Applications/Safari.app/Contents/Info','CFBundleShortVersionString'],5000);report.processes.browserMetadata=macProcessFacts(version);
 assert.ok(version.status===0&&!version.error&&!version.outcomeUncertain,'Safari version metadata must be readable');report.browserVersion=String(version.stdout||'').trim();
 if(process.env.COSMIC_ORDINARY_SAFARI_EXPECTED_VERSION){assert.equal(process.env.COSMIC_ORDINARY_SAFARI_EXPECTED_VERSION,'27.2');assert.equal(report.browserVersion,'27.2','Diagnostic target changed; do not equate versions')}
 sourceExpected=await identity(source);report.source=sourceExpected;
 folder=await mkdtemp('/Users/Shared/ctw-ordinary-safari-');await chmod(folder,0o755);
 const staged=await materializeOrdinaryFixture(source,folder);assert.deepEqual(staged.source,sourceExpected);
 selectedFile=staged.file;expected=staged.selected;report.selectedExpected=expected;report.fixtureMaterialization='certified-mp3-1980-mtime';
 const file=selectedFile;
 const token=randomBytes(16).toString('hex');
 let notified=false;const answer=new Promise(resolve=>{fulfill=resolve});
 server=createServer((req,res)=>{
  if(req.method==='GET'&&req.url==='/'){report.pageReadiness.homeRequests++;res.once('finish',()=>{report.pageReadiness.homeResponsesFinished++});res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(page(token));return}
  if(req.method==='POST'&&req.url===`/ready/${token}`){let body='';req.on('data',b=>{body+=b.toString();if(body.length>1024)req.destroy()});req.on('end',()=>{report.pageReadiness.readyCallbacks++;try{const raw=JSON.parse(body);const flags={titleMatches:raw.titleMatches===true,inputPresent:raw.inputPresent===true,secureContext:raw.secureContext===true,cryptoSubtlePresent:raw.cryptoSubtlePresent===true};Object.assign(report.pageReadiness,flags);report.pageReadiness.acknowledged=true;fulfillReady(flags)}catch{report.pageReadiness.invalidReadyBodies++}res.writeHead(200,{'content-type':'text/plain'});res.end('ack')});return}
  if(req.method==='POST'&&req.url===`/result/${token}`){report.pageReadiness.resultCallbacks++;let body='';req.on('data',b=>{body+=b.toString();if(body.length>8192)req.destroy()});req.on('end',()=>{if(!notified){notified=true;try{fulfill(JSON.parse(body))}catch(error){fulfill({error:String(error)})}}res.writeHead(200,{'content-type':'text/plain'});res.end('ack')});return}
  report.pageReadiness.otherRequests++;res.writeHead(404);res.end('not found');
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const url=`http://127.0.0.1:${server.address().port}/`;browserUrl=url;report.origin='loopback-http-test-only';
 report.phase='page-readiness';const readinessStarted=performance.now();
 const browser=await run('/usr/bin/open',['-a','Safari',url],10000);report.processes.browserOpen=macProcessFacts(browser);assert.ok(browser.status===0&&!browser.error&&!browser.outcomeUncertain,'Could not open ordinary Safari');browserOpened=true;
 let flags;try{flags=await waitOrdinaryReady(ready)}finally{report.pageReadiness.elapsedMs=Math.round(performance.now()-readinessStarted)}
 assert.ok(Object.values(flags).every(value=>value===true),'Owned page, native input and secure hashing must acknowledge readiness');
 report.phase='native-picker';
 report.guiPicker={method:'genuine-System-Events-mouse-click-and-open-panel',stages:[]};
 try{report.guiPicker.stages=await performOrdinaryNativePicker(folder,'format.mp3')}catch(error){if(error?.stages)report.guiPicker.stages=error.stages;throw error}
 const native=await Promise.race([answer,delay(23000).then(()=>({error:'Real native picker callback timeout'}))]);
 report.native=native;report.status=isOrdinarySafariGenuineFile(native,expected)?'PASS':'FAIL';
 if(report.status!=='PASS')throw Error('Ordinary Safari native File identity/bytes/duration not verified: '+String(native.error||'mismatch'));
}catch(error){report.failurePhase=report.phase;report.status='FAIL';report.errorCode=ordinaryErrorCategory(error);
 if(process.platform==='darwin'){
  try{await mkdir(path.dirname(screenshot),{recursive:true});const shot=await run('/usr/sbin/screencapture',['-x',screenshot],8000);report.processes.failureScreenshot=macProcessFacts(shot);report.failureScreenshot=shot.status===0?path.basename(screenshot):null;report.screenshotErrorCode=shot.status===0?null:(shot.error?.name||'UnclassifiedError')}catch(e){report.failureScreenshot=null;report.screenshotErrorCode=e?.name||'UnclassifiedError'}
 }
}finally{
 report.phase='cleanup';
 if(expected){try{report.sourceAfter=await identity(source);assert.deepEqual(report.sourceAfter,sourceExpected);if(selectedFile){report.selectedAfter=await identity(selectedFile);assert.deepEqual(report.selectedAfter,expected)}report.fixturesPreserved=true}catch(error){report.fixturesPreserved=false;report.failurePhase??='cleanup';report.integrityErrorCode=ordinaryErrorCategory(error);report.status='FAIL'}}
 if(browserOpened&&!report.uiOutcomeUncertain){const quit=await run('/usr/bin/osascript',['-e',ordinarySafariCleanupScript(browserUrl)],9000);report.processes.browserClose=macProcessFacts(quit);if(quit.status!==0||quit.error||quit.outcomeUncertain){report.failurePhase??='cleanup';report.cleanupErrorCode=ordinaryErrorCategory(quit.error||'Safari process cleanup failed');report.status='FAIL'}}
 if(report.uiOutcomeUncertain){report.failurePhase??='cleanup';report.status='FAIL';report.cleanupState='skipped-uncertain-ui-outcome'}
 if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
 if(folder&&!report.uiOutcomeUncertain)await runOrdinaryCleanup(()=>rm(folder,{recursive:true,force:true}),report);else if(folder)report.fixtureCleanupState='preserved-for-uncertain-ui-outcome';
 report.finishedAt=new Date().toISOString();
 const publicReport=sanitizeOrdinarySafariReport(report);
 await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(publicReport,null,2)+'\n');
 console.log(`ORDINARY_SAFARI_NATIVE_FILE_REPORT=${JSON.stringify(publicReport)}`);
 if(report.status!=='PASS')process.exitCode=1;
}
