import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir,stat,realpath} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';

// DIAGNOSTIC ONLY: normal Safari and its genuine OS file picker. No WebDriver,
// File replacement, application/provider code, TCC writes or security changes.
assert.equal(process.platform,'darwin');
assert.equal(process.version,'v26.7.0');
const [extractedArg,outputArg]=process.argv.slice(2);
assert.ok(extractedArg&&outputArg,'Expected untouched extracted root and evidence directory.');
const extracted=await realpath(extractedArg),output=path.resolve(outputArg);
assert.ok(path.relative(extracted,output).startsWith('..'),'Evidence must be outside extracted source.');
await mkdir(output,{recursive:true});
const startedAt=Date.now(),deadline=startedAt+240000;
const reportPath=path.join(output,'native-safari-os-picker.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const expectedArchive='c68370707fc18093a3e4e741bdd1686643fa585aed41715b8fbf4bd175ae1485';
const fixtureHashes={'format.mp3':'e799ee1a44f73c9a4b146e76cce9deae6390ebc2aad3f51da13ce9dda2182b55','ID3 Unicode 東京.mp3':'7c170f8ca3be08da4e7c7a751998d066f6853be1598e5fac0aa0e8047767eb8c'};
const report={schema:'native-safari-os-picker-diagnostic-2',purpose:'DIAGNOSTIC ONLY; never release acceptance',status:'RUNNING',startedAt:new Date(startedAt).toISOString(),node:process.version,providerCalls:0,applicationLoaded:false,webDriverUsed:false,safariScriptingAppleEventsUsed:false,securitySettingsChanged:false,releaseAcceptance:false,runner:{image:process.env.ImageOS||null,version:process.env.ImageVersion||null},permissionProbe:{},commands:[],trials:[],errors:[]};
let server,origin;
const ownedWindowTitles=new Set();
const sources=[],active=new Map();
let saveChain=Promise.resolve();
const save=()=>{const snapshot=JSON.stringify(report,null,2)+'\n';saveChain=saveChain.then(()=>writeFile(reportPath,snapshot));return saveChain;};
const errorInfo=error=>({name:error?.name||'Error',message:String(error?.message||error)});
async function identity(file){const [bytes,info,canonical]=await Promise.all([readFile(file),stat(file,{bigint:true}),realpath(file)]);return {path:file,realpath:canonical,size:Number(info.size),sha256:hash(bytes),mtimeNs:info.mtimeNs.toString(),mtimeMs:Number(info.mtimeNs)/1e6,mode:(Number(info.mode)&0o7777).toString(8),uid:String(info.uid),gid:String(info.gid),inode:String(info.ino),device:String(info.dev)};}

async function osa(stage,script,args=[],language='AppleScript',timeout=15000){
  assert.ok(Date.now()<deadline,'Diagnostic deadline exceeded.');
  const row={stage,language,startedAt:new Date().toISOString()};report.commands.push(row);await save();
  return new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/osascript',['-l',language,'-',...args],{stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',timedOut=false,killTimer;
    const append=(current,chunk)=>current.length<65536?(current+chunk.toString()).slice(0,65536):current;
    child.stdout.on('data',chunk=>{stdout=append(stdout,chunk)});child.stderr.on('data',chunk=>{stderr=append(stderr,chunk)});
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000)},Math.min(timeout,Math.max(1,deadline-Date.now())));
    child.once('error',error=>{clearTimeout(timer);clearTimeout(killTimer);row.error=errorInfo(error);reject(error)});
    child.once('close',(code,signal)=>{clearTimeout(timer);clearTimeout(killTimer);Object.assign(row,{code,signal,timedOut,stdout,stderr,finishedAt:new Date().toISOString()});if(code===0&&!timedOut)resolve(stdout.trim());else reject(new Error(`OS automation ${stage} failed (${code}/${signal}, timeout=${timedOut}): ${stderr.trim()}`));});
    child.stdin.on('error',()=>{});child.stdin.end(script);
  });
}

async function launchSafari(){
  const row={stage:'Launch normal Safari through LaunchServices',command:'/usr/bin/open -a Safari',startedAt:new Date().toISOString()};report.commands.push(row);await save();
  await new Promise((resolve,reject)=>execFile('/usr/bin/open',['-a','Safari'],{timeout:10000,maxBuffer:65536},(error,stdout,stderr)=>{Object.assign(row,{stdout,stderr,finishedAt:new Date().toISOString(),error:error?errorInfo(error):null});if(error)reject(error);else resolve();}));
}
const openPage=`on run argv
  set targetURL to item 1 of argv
  tell application "System Events"
    repeat 50 times
      if exists process "Safari" then exit repeat
      delay 0.1
    end repeat
    if not (exists process "Safari") then error "Safari process did not launch."
    tell process "Safari"
      set frontmost to true
      set previousCount to count of windows
      keystroke "n" using command down
      repeat 50 times
        if (count of windows) > previousCount then exit repeat
        delay 0.1
      end repeat
      if (count of windows) <= previousCount then error "Native New Window did not appear."
      keystroke "l" using command down
      set addressField to missing value
      repeat 25 times
        repeat with e in (entire contents of front window)
          try
            if role of e is "AXTextField" and description of e is "smart search field" and value of attribute "AXFocused" of e is true then
              set addressField to e
              exit repeat
            end if
          end try
        end repeat
        if addressField is not missing value then exit repeat
        delay 0.1
      end repeat
      if addressField is missing value then error "Observed Safari smart search field is not focused."
      keystroke targetURL
      if (value of attribute "AXValue" of addressField as text) is not targetURL then error "Native address bar did not retain the exact local URL."
      key code 36
      return "NAVIGATED_USING_NATIVE_SMART_SEARCH"
    end tell
  end tell
end run`;
const closePage=`on run argv
  set ownedTitle to item 1 of argv
  tell application "System Events"
    if not (exists process "Safari") then return "NO_SAFARI_PROCESS"
    tell process "Safari"
      repeat with w in windows
        if (name of w as text) contains ownedTitle then
          set frontmost to true
          perform action "AXRaise" of w
          repeat 3 times
            if (count of sheets of w) is 0 then exit repeat
            key code 53
            delay 0.1
          end repeat
          if (count of sheets of w) > 0 then error "Owned diagnostic window still has a modal sheet."
          click (first button of w whose subrole is "AXCloseButton")
          return "CLOSED_OWNED_DIAGNOSTIC_TITLE"
        end if
      end repeat
      return "OWNED_DIAGNOSTIC_TITLE_ABSENT"
    end tell
  end tell
end run`;
const dumpAX=`tell application "System Events"
  tell process "Safari"
    set resultLines to {}
    repeat with w in windows
      set end of resultLines to "WINDOW " & (name of w as text)
      set allElements to entire contents of w
      set n to 0
      repeat with e in allElements
        set n to n + 1
        if n > 250 then exit repeat
        try
          set end of resultLines to (role of e as text) & " | " & (name of e as text) & " | " & (description of e as text)
        end try
      end repeat
    end repeat
    set AppleScript's text item delimiters to linefeed
    return resultLines as text
  end tell
end tell`;
const clickFileInput=`tell application "System Events"
  tell process "Safari"
    set frontmost to true
    set chosen to missing value
    repeat with e in (entire contents of front window)
      try
        if role of e is "AXButton" then
          set labelText to (name of e as text) & " " & (description of e as text)
          if labelText contains "Choose File" or labelText contains "Choose file" or labelText contains "Select untouched fixture" then
            set chosen to e
            exit repeat
          end if
        end if
      end try
    end repeat
    if chosen is missing value then error "Native file input is absent from the observed Safari AX tree."
    click chosen
    repeat 50 times
      if (count of sheets of front window) > 0 then return "FILE_PICKER_VISIBLE"
      delay 0.1
    end repeat
    error "Native Open sheet did not appear."
  end tell
end tell`;
const enterPath=`on run argv
  set originalPath to item 1 of argv
  tell application "System Events"
    tell process "Safari"
      if (count of sheets of front window) is 0 then error "No native file picker is open."
      keystroke "g" using {command down, shift down}
      delay 0.25
      set pathField to missing value
      repeat 50 times
        repeat with e in (entire contents of sheet 1 of front window)
          try
            if (role of e is "AXTextField" or role of e is "AXComboBox") and (value of attribute "AXFocused" of e is true) then
              set fieldLabel to (name of e as text) & " " & (description of e as text)
              if fieldLabel does not contain "Search" then
                set pathField to e
                exit repeat
              end if
            end if
          end try
        end repeat
        if pathField is not missing value then exit repeat
        delay 0.1
      end repeat
      if pathField is missing value then error "Focused Go To Folder path field was not found."
      set value of attribute "AXValue" of pathField to originalPath
      if (value of attribute "AXValue" of pathField as text) is not originalPath then error "Native Unicode path field did not retain the exact path."
      key code 36
      return "EXACT_PATH_ENTERED_IN_NATIVE_SHEET"
    end tell
  end tell
end run`;
const confirmOpen=`tell application "System Events"
  tell process "Safari"
    repeat 50 times
      if (count of sheets of front window) is 0 then return "SHEET_DISMISSED_BY_PATH_RETURN"
      repeat with e in (entire contents of sheet 1 of front window)
        try
          if role of e is "AXButton" and enabled of e then
            if name of e is "Open" or name of e is "Choose" then
              click e
              return "NATIVE_OPEN_PRESSED"
            end if
          end if
        end try
      end repeat
      delay 0.1
    end repeat
    error "Enabled native Open button was not found."
  end tell
end tell`;

function installPage(token){
  const state={token,page:{userAgent:navigator.userAgent,secure:isSecureContext,href:location.href},ready:true,selected:false,done:false,stages:[]};
  const send=async()=>{const response=await fetch(`/collect/${token}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(state),signal:AbortSignal.timeout(3000)});if(!response.ok)throw new Error(`Collector ${response.status}`);};
  const metadata=file=>({name:file.name,size:file.size,type:file.type,lastModified:file.lastModified,isNativeFile:file instanceof File,constructorName:file.constructor?.name});
  document.querySelector('#nativeInput').addEventListener('change',async event=>{
    const input=event.currentTarget,file=input.files[0];
    state.selected=true;state.selectionEventTrusted=event.isTrusted;state.inputCount=input.files.length;state.metadata=file?metadata(file):null;
    try{
      if(!file)throw new Error('No native File selected.');
      await send();
      const middle=Math.floor(file.size/2),ranges=[['full',null,null],['prefix',0,Math.min(1024,file.size)],['middle',middle,Math.min(middle+257,file.size)],['tail',Math.max(0,file.size-333),file.size]];
      for(const [stage,start,end] of ranges){
        const row={stage,start,end,metadataBefore:metadata(file),status:'RUNNING'};state.stages.push(row);await send();let timer;
        try{
          const blob=start===null?file:file.slice(start,end);
          const bytes=await Promise.race([blob.arrayBuffer(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Native read exceeded 2000ms')),2000)})]);
          row.bytes=bytes.byteLength;row.sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');row.status='READ';
        }catch(error){row.status='READ_ERROR';row.error={name:error.name,message:error.message};}
        finally{clearTimeout(timer);row.metadataAfter=metadata(file);}
        await send();
      }
    }catch(error){state.error={name:error.name,message:error.message};}
    finally{state.done=true;document.querySelector('#state').textContent=JSON.stringify(state,null,2);try{await send()}catch(error){document.querySelector('#state').textContent+='\nCOLLECTOR ERROR: '+error.message;}}
  },{once:true});
  send().catch(error=>{document.querySelector('#state').textContent=error.message});
}

try{
  assert.equal(process.env.DIAG_ARCHIVE_SHA256,expectedArchive);
  assert.equal(hash(await readFile(process.env.DIAG_ARCHIVE_PATH)),expectedArchive);
  report.archiveSha256=expectedArchive;
  report.runner.reviewedImageTag='macos-26-arm64/20260907.0351';
  report.runner.provisioningSource='https://raw.githubusercontent.com/actions/runner-images/macos-26-arm64/20260907.0351/images/macos/scripts/build/configure-tccdb-macos.sh';
  assert.equal(process.env.ImageVersion,'20260907.0351.1','Runner image differs from the reviewed existing-permission provisioning.');
  assert.equal(process.arch,'arm64');
  for(const [name,expectedHash] of Object.entries(fixtureHashes)){
    const file=path.join(extracted,'tests','fixtures',name),before=await identity(file),bytes=await readFile(file);
    assert.equal(before.sha256,expectedHash);const middle=Math.floor(bytes.length/2);
    sources.push({name,file:before.realpath,before,expected:[{stage:'full',bytes:bytes.length,sha256:hash(bytes)},...[[0,Math.min(1024,bytes.length),'prefix'],[middle,Math.min(middle+257,bytes.length),'middle'],[Math.max(0,bytes.length-333),bytes.length,'tail']].map(([start,end,stage])=>({stage,bytes:end-start,sha256:hash(bytes.subarray(start,end))}))]});
  }
  report.permissionProbe.ax=await osa('AX trust without prompt',`ObjC.import('ApplicationServices'); $.AXIsProcessTrusted() ? 'trusted' : 'denied';`,[],'JavaScript');
  if(report.permissionProbe.ax!=='trusted'){report.status='PERMISSION_BLOCKED';throw new Error('Existing Accessibility permission is unavailable; no permission changes attempted.');}
  report.permissionProbe.systemEvents=await osa('Existing System Events access','tell application "System Events" to return UI elements enabled');
  assert.equal(report.permissionProbe.systemEvents,'true','Existing UI scripting permission unavailable.');
  server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,origin),parts=url.pathname.split('/'),token=parts[2],trial=active.get(token);
      if(req.headers.host!==new URL(origin).host||!trial){res.writeHead(404);res.end();return;}
      if(req.method==='GET'&&parts[1]==='trial'){
        const html=`<!doctype html><meta charset="utf-8"><title>${trial.windowTitle}</title><h1>Native Safari OS picker — diagnostic only</h1><label for="nativeInput">Select untouched fixture</label><input id="nativeInput" aria-label="Select untouched fixture" type="file"><pre id="state">Waiting for native selection</pre><script>(${installPage.toString()})(${JSON.stringify(token)});</script>`;
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'"});res.end(html);return;
      }
      if(req.method==='POST'&&parts[1]==='collect'&&req.headers.origin===origin&&req.headers['content-type']==='application/json'){
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536){res.writeHead(413);res.end();return;}}
        const payload=JSON.parse(body);assert.equal(payload.token,token);trial.native=payload;await save();res.writeHead(204);res.end();return;
      }
      res.writeHead(405);res.end();
    }catch(error){report.errors.push(errorInfo(error));res.writeHead(500);res.end();}
  });
  server.headersTimeout=5000;server.requestTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  origin=`http://localhost:${server.address().port}`;report.origin=origin;
  await launchSafari();
  for(const source of sources){
    const token=randomBytes(16).toString('hex'),windowTitle=`Cosmic OS Picker ${token}`,trial={name:source.name,selectedPath:source.file,windowTitle,before:source.before,status:'RUNNING',ui:{}};active.set(token,trial);ownedWindowTitles.add(windowTitle);report.trials.push(trial);await save();
    try{
      trial.ui.navigation=await osa('Navigate normal Safari through native address bar',openPage,[`${origin}/trial/${token}`]);
      assert.equal(trial.ui.navigation,'NAVIGATED_USING_NATIVE_SMART_SEARCH');
      const readyUntil=Date.now()+15000;while(!trial.native?.ready&&Date.now()<readyUntil)await delay(100);
      assert.equal(trial.native?.ready,true,'Bare page did not report ready.');assert.equal(trial.native.page.secure,true,'Loopback page lacks secure-context hashing.');
      assert.match(trial.native.page.userAgent,/Version\/[\d.]+.*Safari\//);
      assert.equal(trial.native.page.href,`${origin}/trial/${token}`);
      trial.safariVersionFromUserAgent=trial.native.page.userAgent.match(/Version\/([\d.]+)/)[1];
      trial.axBefore=await osa('Observe native Safari AX tree',dumpAX);
      trial.ui.filePicker=await osa('Press native Choose File',clickFileInput);
      assert.equal(trial.ui.filePicker,'FILE_PICKER_VISIBLE');
      trial.ui.pathEntry=await osa('Enter exact original path in Go To Folder',enterPath,[source.file]);
      assert.equal(trial.ui.pathEntry,'EXACT_PATH_ENTERED_IN_NATIVE_SHEET');
      trial.ui.open=await osa('Confirm native Open',confirmOpen);
      assert.ok(['NATIVE_OPEN_PRESSED','SHEET_DISMISSED_BY_PATH_RETURN'].includes(trial.ui.open));
      const until=Date.now()+20000;while(!trial.native?.done&&Date.now()<until)await delay(100);
      assert.equal(trial.native?.done,true,'Native selection/read report did not complete.');
      assert.equal(trial.native.selectionEventTrusted,true);assert.equal(trial.native.inputCount,1);
      assert.deepEqual(trial.native.metadata,{name:source.name,size:source.before.size,type:'audio/mpeg',lastModified:Math.trunc(source.before.mtimeMs),isNativeFile:true,constructorName:'File'});
      assert.equal(trial.native.error,undefined);assert.equal(trial.native.stages.length,4);
      for(const expected of source.expected){const stage=trial.native.stages.find(item=>item.stage===expected.stage);assert.ok(stage);stage.matchesExpectedBytes=stage.status==='READ'&&stage.bytes===expected.bytes&&stage.sha256===expected.sha256;assert.equal(stage.matchesExpectedBytes,true,`Native ${expected.stage} read does not match source.`);}
      trial.status='PASS_NATIVE_OS_PICKER_READS';
    }catch(error){trial.status='FAILED';trial.error=errorInfo(error);process.exitCode=1;try{trial.axAfterFailure=await osa('Observe failed native picker',dumpAX,[],'AppleScript',5000)}catch(dumpError){trial.axCaptureError=errorInfo(dumpError)}}
    finally{trial.after=await identity(source.file);trial.diskUnchanged=JSON.stringify(trial.before)===JSON.stringify(trial.after);assert.equal(trial.diskUnchanged,true);await save();trial.ui.cleanup=await osa('Close only the owned diagnostic AX title',closePage,[windowTitle]);ownedWindowTitles.delete(windowTitle);}
  }
  report.status=report.trials.length===2&&report.trials.every(t=>t.status==='PASS_NATIVE_OS_PICKER_READS')?'DIAGNOSTIC_NATIVE_PICKER_READS_PASS':'DIAGNOSTIC_NATIVE_PICKER_FAILED';
}catch(error){if(report.status!=='PERMISSION_BLOCKED')report.status='DIAGNOSTIC_INCOMPLETE';report.errors.push(errorInfo(error));process.exitCode=1;}
finally{
  for(const source of sources){try{const after=await identity(source.file);assert.deepEqual(after,source.before)}catch(error){report.errors.push(errorInfo(error));report.status='SOURCE_CHANGED_OR_UNREADABLE';process.exitCode=1;}}
  for(const title of ownedWindowTitles)try{await osa('Final owned diagnostic AX title cleanup',closePage,[title],'AppleScript',5000)}catch(error){report.cleanupError=errorInfo(error)}
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  report.finishedAt=new Date().toISOString();report.durationMs=Date.now()-startedAt;
  report.summary={trials:report.trials.length,passed:report.trials.filter(t=>t.status==='PASS_NATIVE_OS_PICKER_READS').length,failed:report.trials.filter(t=>t.status==='FAILED').length,releaseAcceptance:false};
  await save();console.log(JSON.stringify({status:report.status,...report.summary,report:reportPath}));
}
