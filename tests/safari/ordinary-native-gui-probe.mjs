import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {chmod,mkdir,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
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
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
async function identity(file){const [bytes,s]=await Promise.all([readFile(file),stat(file,{bigint:true})]);return {size:bytes.length,sha256:hash(bytes),sliceSha256:hash(bytes.subarray(0,Math.min(1024,bytes.length))),mtimeNs:String(s.mtimeNs)}}
const run=(cmd,args,timeout=16000)=>spawnSync(cmd,args,{encoding:'utf8',timeout,windowsHide:true});
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
    const command=run('/usr/bin/osascript',['-e',guardedScript],12000);
    await delay(stage.pause);
    const dest=path.join(root,'test-results',`ordinary-safari-stage-${stage.name}.png`);
    const screen=run('/usr/sbin/screencapture',['-x',dest],8000);
    let imageBytes=0;try{imageBytes=(await stat(dest)).size}catch{}
    const recorded={stage:stage.name,osascriptStatus:command.status,
      osascriptErrorCode:command.status===0?null:(command.error?.name||'UnclassifiedError'),osascriptDiagnostic:macProcessFacts(command),screenshotDiagnostic:macProcessFacts(screen),
      screenshotStatus:screen.status,screenshotBytes:imageBytes};
    stages.push(recorded);
    // Failure is never reported as success or hidden by later file-dialog keys.
    if(command.status!==0||screen.status!==0||imageBytes<1000)
      throw Object.assign(new Error(`Native picker stage ${stage.name} failed`),{stages});
  }
  return stages;
}
function page(token){return `<!doctype html><meta charset="utf-8"><title>Genuine ordinary Safari file picker</title>
<label for="diskFile">Choose genuine disk MP3</label>
<input id="diskFile" type="file" accept=".mp3,audio/mpeg" autofocus>
<p id="status">Awaiting real macOS file selection</p>
<script>
window.addEventListener('load',()=>document.getElementById('diskFile').focus());
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
let folder,server,fulfill,expected,selectedFile,browserUrl,browserOpened=false;
try{
 if(process.platform!=='darwin')throw Error('Requires genuine macOS Safari, not simulated WebKit');
 const version=run('/usr/bin/defaults',['read','/Applications/Safari.app/Contents/Info','CFBundleShortVersionString'],5000);report.processes.browserMetadata=macProcessFacts(version);
 assert.equal(version.status,0,'Safari version metadata must be readable');report.browserVersion=String(version.stdout||'').trim();
 if(process.env.COSMIC_ORDINARY_SAFARI_EXPECTED_VERSION){assert.equal(process.env.COSMIC_ORDINARY_SAFARI_EXPECTED_VERSION,'27.2');assert.equal(report.browserVersion,'27.2','Diagnostic target changed; do not equate versions')}
 expected=await identity(source);assert.ok(expected.size>1000,'Real MP3 fixture missing');report.source=expected;
 folder=await mkdtemp('/Users/Shared/ctw-ordinary-safari-');await chmod(folder,0o755);
 const file=path.join(folder,'format.mp3');selectedFile=file;const cp=run('/bin/cp',['-p',source,file],10000);report.processes.fixtureCopy=macProcessFacts(cp);assert.equal(cp.status,0,'Native cp -p failed');await chmod(file,0o644);
 assert.deepEqual(await identity(file),expected,'Native file must preserve bytes and nanosecond mtime');
 const token=randomBytes(16).toString('hex');
 let notified=false;const answer=new Promise(resolve=>{fulfill=resolve});
 server=createServer((req,res)=>{
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(page(token));return}
  if(req.method==='POST'&&req.url===`/result/${token}`){let body='';req.on('data',b=>{body+=b.toString();if(body.length>8192)req.destroy()});req.on('end',()=>{if(!notified){notified=true;try{fulfill(JSON.parse(body))}catch(error){fulfill({error:String(error)})}}res.writeHead(200,{'content-type':'text/plain'});res.end('ack')});return}
  res.writeHead(404);res.end('not found');
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const url=`http://127.0.0.1:${server.address().port}/`;browserUrl=url;report.origin='loopback-http-test-only';
 const browser=run('/usr/bin/open',['-a','Safari',url],10000);report.processes.browserOpen=macProcessFacts(browser);assert.equal(browser.status,0,'Could not open ordinary Safari');browserOpened=true;
 await delay(3500);
 report.guiPicker={method:'genuine-System-Events-mouse-click-and-open-panel',stages:[]};
 try{report.guiPicker.stages=await performOrdinaryNativePicker(folder,'format.mp3')}catch(error){if(error?.stages)report.guiPicker.stages=error.stages;throw error}
 const native=await Promise.race([answer,delay(23000).then(()=>({error:'Real native picker callback timeout'}))]);
 report.native=native;report.status=isOrdinarySafariGenuineFile(native,expected)?'PASS':'FAIL';
 if(report.status!=='PASS')throw Error('Ordinary Safari native File identity/bytes/duration not verified: '+String(native.error||'mismatch'));
}catch(error){report.status='FAIL';report.errorCode=ordinaryErrorCategory(error);
 if(process.platform==='darwin'){
  try{await mkdir(path.dirname(screenshot),{recursive:true});const shot=run('/usr/sbin/screencapture',['-x',screenshot],8000);report.processes.failureScreenshot=macProcessFacts(shot);report.failureScreenshot=shot.status===0?path.basename(screenshot):null;report.screenshotErrorCode=shot.status===0?null:(shot.error?.name||'UnclassifiedError')}catch(e){report.failureScreenshot=null;report.screenshotErrorCode=e?.name||'UnclassifiedError'}
 }
}finally{
 if(expected){try{report.sourceAfter=await identity(source);assert.deepEqual(report.sourceAfter,expected);if(selectedFile){report.selectedAfter=await identity(selectedFile);assert.deepEqual(report.selectedAfter,expected)}report.fixturesPreserved=true}catch(error){report.fixturesPreserved=false;report.integrityErrorCode=ordinaryErrorCategory(error);report.status='FAIL'}}
 if(browserOpened){const quit=run('/usr/bin/osascript',['-e',ordinarySafariCleanupScript(browserUrl)],9000);report.processes.browserClose=macProcessFacts(quit);if(quit.status!==0){report.cleanupErrorCode=ordinaryErrorCategory(quit.error||'Safari process cleanup failed');report.status='FAIL'}}
 if(server)await new Promise(resolve=>server.close(resolve));
 if(folder)await runOrdinaryCleanup(()=>rm(folder,{recursive:true,force:true}),report);
 report.finishedAt=new Date().toISOString();
 const publicReport=sanitizeOrdinarySafariReport(report);
 await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(publicReport,null,2)+'\n');
 console.log(`ORDINARY_SAFARI_NATIVE_FILE_REPORT=${JSON.stringify(publicReport)}`);
 if(report.status!=='PASS')process.exitCode=1;
}
