import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes,randomInt} from 'node:crypto';
import {chmod,mkdir,mkdtemp,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {NATIVE_FIXTURES,describeFixture,fixtureIdentity,assertNativeObservation,assertPreparedDiagnostic,assertDispatch} from './native-file-contract.mjs';
import {submitRealMacOSFilePanel} from './native-picker.mjs';
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'; // CTW_REAL_SAFARI_LOCALHOST_TLS_ONLY

// Actual Safari only. Playwright WebKit and injected File buffers do not satisfy this gate.
if(process.platform!=='darwin')throw new Error('Real Safari native-file acceptance requires macOS and its installed /usr/bin/safaridriver.');
const root=path.resolve(import.meta.dirname,'../..');
const port=randomInt(20000,50000),driverPort=randomInt(50001,59000);
const token=randomBytes(16).toString('hex');
const origin=`https://localhost:${port}`; // CTW_REAL_SAFARI_HTTPS
const driverOrigin=`http://127.0.0.1:${driverPort}`;
const seeded='SAFARI-FAKE-KEY-NO-PROVIDER-7d9b4676';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={schema:'cosmic-real-safari-native-acceptance-1',status:'RUNNING',platform:process.platform,startedAt:new Date().toISOString(),fixtures:[],checks:[],providerCalls:0,mp3DispatchOracle:'separate Node execution of the shipped reviewed MP3 frame preparation',downloadVerification:'application-generated payloads; OS download destination is not asserted'};
const fixtures=[];
let server,driver,sessionId,sharedNativeFixtureDirectory;

async function jsonRequest(url,{method='GET',body,timeout=45000}={}){
  const response=await fetch(url,{method,headers:body===undefined?undefined:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
  const text=await response.text();
  let parsed;try{parsed=text?JSON.parse(text):{}}catch{throw new Error(`Invalid JSON from local acceptance endpoint (${response.status})`)}
  if(!response.ok||parsed.value?.error)throw new Error(`Local acceptance ${method} ${new URL(url).pathname}: ${response.status} ${parsed.value?.error||''} ${parsed.value?.message||''}`);
  return parsed;
}
async function until(label,read,accept,{timeout=30000}={}){
  const deadline=Date.now()+timeout;let last;
  do{last=await read();if(accept(last))return last;await sleep(100)}while(Date.now()<deadline);
  throw new Error(`${label} timed out; last state: ${JSON.stringify(last)}`);
}
async function waitEndpoint(url){return until('Local endpoint readiness',async()=>{try{return await jsonRequest(url,{timeout:1000})}catch{return null}},value=>value!==null,{timeout:20000})}
async function command(endpoint,body={},method='POST'){
  const result=await jsonRequest(`${driverOrigin}/session/${sessionId}${endpoint}`,{method,body:method==='GET'||method==='DELETE'?undefined:body});
  return result.value;
}
const evaluate=(fn,...args)=>command('/execute/sync',{script:`return (${fn.toString()})(...arguments);`,args});
async function evaluateAsync(fn,...args){
  const result=await command('/execute/async',{script:`const done=arguments[arguments.length-1];Promise.resolve().then(()=>(${fn.toString()})(...Array.from(arguments).slice(0,-1))).then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error?.stack||error)}));`,args});
  assert.equal(result?.ok,true,result?.error||'Safari asynchronous script failed');return result.value;
}
async function element(selector){
  const value=await command('/element',{using:'css selector',value:selector});
  const id=value?.['element-6066-11e4-a52e-4f735466cecf'];
  assert.ok(id,`SafariDriver did not return element ${selector}`);return id;
}
async function click(selector){await command(`/element/${await element(selector)}/click`)}
async function type(selector,text){const id=await element(selector);await command(`/element/${id}/clear`);await command(`/element/${id}/value`,{text})}
async function control(action){return jsonRequest(`${origin}/__cosmic_e2e_native_control?token=${token}`,action?{method:'POST',body:{action}}:{})}
async function count(){return (await control()).requests.length}
function passed(name){report.checks.push({name,status:'PASS'});console.log(`Real Safari acceptance PASS: ${name}`)}

// SafariDriver's native file upload requires world-readable paths. The exact
// committed fixture is copied to macOS /Users/Shared (not a synthetic JS File),
// preserving its original bytes and modification time. The source and copy
// are independently checked before/after Safari accesses the native file.
async function stageWorldReadableNativeFixtures(){
  sharedNativeFixtureDirectory=await mkdtemp('/Users/Shared/ctw-safari-native-');
  await chmod(sharedNativeFixtureDirectory,0o755);
  for(const fixture of fixtures){
    const source=fixture.file,destination=path.join(sharedNativeFixtureDirectory,fixture.name);
    fixture.sourceFile=source;
    const copied=spawnSync('/bin/cp',['-p',source,destination],{encoding:'utf8',timeout:15000});
    assert.equal(copied.status,0,`${fixture.name}: cannot create exact native fixture copy: ${copied.error?.message||copied.stderr}`);
    await chmod(destination,0o644);
    assert.equal((await stat(destination)).mode&0o777,0o644,`${fixture.name}: WebDriver fixture must be world-readable`);
    assert.deepEqual(await fixtureIdentity(destination),fixture.before,`${fixture.name}: world-readable fixture copy must preserve exact bytes and timestamp`);
    fixture.file=destination;
  }
  passed('native disk fixtures are world-readable, byte-identical and timestamp-identical');
}

async function attachObservers(){
  await evaluate(()=>{
    const observed=window.__ctwSafariAcceptance={selections:[],downloads:[]};
    // Observe the real File supplied by SafariDriver's native input command.
    // Never replace input.files, construct File objects, or change file MIME data.
    document.querySelector('#fileInput').addEventListener('change',event=>{
      const file=event.target.files[0],entry={done:false};observed.selections.push(entry);
      const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
      (async()=>{
        if(!file)throw new Error('Native selection supplied no file');
        const middle=Math.floor(file.size/2),ranges=[[0,file.size],[0,Math.min(1024,file.size)],[middle,Math.min(middle+257,file.size)],[Math.max(0,file.size-333),file.size]];
        const result={isFile:file instanceof File,name:file.name,type:file.type,size:file.size,lastModified:file.lastModified,sha256:await digest(file),slices:[]};
        for(const [start,end] of ranges)result.slices.push({start,end,size:end-start,sha256:await digest(file.slice(start,end))});
        result.duration=await new Promise((resolve,reject)=>{
          const audio=document.createElement('audio'),url=URL.createObjectURL(file);let settled=false;
          const finish=(value,error)=>{if(settled)return;settled=true;clearTimeout(timer);audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);error?reject(error):resolve(value)};
          const timer=setTimeout(()=>finish(null,new Error('Native media metadata timed out')),8000);
          audio.preload='metadata';audio.onloadedmetadata=()=>finish(audio.duration);audio.onerror=()=>finish(null,new Error(`Native media decode failed (${audio.error?.code})`));audio.src=url;audio.load();
        });
        entry.result=result;
      })().catch(async error=>{
        // A failing real-file read remains a HARD FAILURE. These bounded,
        // byte-free diagnostics distinguish file sandbox access from a single
        // Blob API regression without constructing or substituting any File.
        const failure={error:String(error?.stack||error)};
        if(file instanceof File){
          const blob=file.slice(0,Math.min(64,file.size));
          const probe=async read=>{
            try{
              const bytes=await Promise.race([read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('probe timeout')),3000))]);
              return {ok:bytes.byteLength===blob.size,bytes:bytes.byteLength};
            }catch(e){return {ok:false,error:String(e?.name||'Error')+': '+String(e?.message||e).slice(0,160)}}
          };
          const fileReader=()=>new Promise((resolve,reject)=>{
            const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error||new Error('FileReader failed'));reader.readAsArrayBuffer(blob);
          });
          const urlRead=async()=>{
            const url=URL.createObjectURL(blob);
            try{const response=await fetch(url);if(!response.ok)throw new Error('blob URL response '+response.status);return await response.arrayBuffer()}
            finally{URL.revokeObjectURL(url)}
          };
          failure.diskReadDiagnostics={size:file.size,type:file.type,
            sliceArrayBuffer:await probe(()=>blob.arrayBuffer()),
            fileReader:await probe(fileReader),
            blobUrlFetch:await probe(urlRead)};
        }
        entry.result=failure;
      }).finally(()=>{entry.done=true});
    },true);
    // Verify payloads produced by the application's real download controls.
    // This does not claim Safari's OS download-directory behavior was tested.
    document.addEventListener('click',event=>{
      const anchor=event.target.closest?.('a[download]');
      if(!anchor||!anchor.href.startsWith('blob:'))return;
      event.preventDefault();
      const entry={name:anchor.download,done:false};observed.downloads.push(entry);
      fetch(anchor.href).then(async response=>{if(!response.ok)throw new Error('Generated download could not be read');entry.type=response.headers.get('content-type');entry.text=await response.text()}).catch(error=>{entry.error=String(error)}).finally(()=>{entry.done=true});
    },true);
  });
}
async function openApp(){
  await command('/url',{url:origin});
  await until('Active application session',()=>evaluate(()=>({ready:document.readyState,email:document.querySelector('#accountEmail')?.textContent})),value=>value.ready==='complete'&&value.email==='e2e-user@example.test');
  await attachObservers();
}
async function clearAutomationOrigin(){
  await command('/url',{url:origin});
  await until('Initial application document',()=>evaluate(()=>document.readyState),state=>state==='complete');
  await command('/cookie',{},'DELETE');
  await evaluateAsync(async()=>{
    localStorage.clear();sessionStorage.clear();
    for(const {name} of await indexedDB.databases())await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Automation database deletion blocked'))});
    for(const name of await caches.keys())await caches.delete(name);
  });
}
async function downloadPayload(selector){
  const previous=await evaluate(()=>window.__ctwSafariAcceptance.downloads.length);await click(selector);
  const entry=await until('Generated download payload',()=>evaluate(index=>window.__ctwSafariAcceptance.downloads[index]||null,previous),value=>value?.done);
  assert.equal(entry.error,undefined,entry.error);return entry;
}
async function diagnostics(){return JSON.parse((await downloadPayload('#diagnosticsBtn')).text)}
async function selectNative(fixture){
  const beforeCount=await count(),previous=await evaluate(()=>window.__ctwSafariAcceptance.selections.length);
  // SafariDriver's file-input sendKeys must use the same interactable native
  // control available to a user, not an offscreen hidden input. The app leaves
  // this input hidden; expose it ONLY during genuine WebDriver file selection.
  // This never modifies input.files, constructs File/Blob or injects test bytes.
  const visibility=await evaluate(()=>{
    const input=document.querySelector('#fileInput');
    if(!input||input.type!=='file'||!input.hidden)throw new Error('Expected original hidden native file input');
    input.hidden=false;
    Object.assign(input.style,{display:'block',position:'fixed',top:'16px',left:'16px',width:'260px',height:'44px',zIndex:'2147483647'});
    const bounds=input.getBoundingClientRect();
    return {type:input.type,multiple:input.multiple,width:bounds.width,height:bounds.height,visible:getComputedStyle(input).visibility==='visible'&&getComputedStyle(input).display!=='none'};
  });
  assert.equal(visibility.visible,true,'Real Safari native file picker must be rendered');
  assert.ok(visibility.width>0&&visibility.height>0,'Real Safari native file input has nonzero dimensions');
  try{
    // Keep the original native file input rendered while Safari asynchronously
    // reads the selected disk file and the app completes its real preparation.
    // Safari's WebDriver file sandbox grant may not outlive hiding the control.
    // The exact native full/sliced SHA, timestamp and duration checks below stay mandatory.
    await command(`/element/${await element('#fileInput')}/value`,{text:fixture.file});
    let observed=await until(`${fixture.name} native bytes and media metadata`,()=>evaluate(index=>window.__ctwSafariAcceptance.selections[index]||null,previous),value=>value?.done);
    let nativeSelectionMode='safaridriver-sendkeys';let nativePickerDiagnostic=null;
    if(observed.result?.error){
      // SafariDriver can populate input.files but leave its underlying disk
      // handle unreadable. Try a REAL user-style macOS open panel, which grants
      // sandbox access, while retaining all original native identity checks.
      // Picker unavailability is reported but never turns a failure into PASS.
      try{
        const pickerPrevious=await evaluate(()=>window.__ctwSafariAcceptance.selections.length);
        // SafariDriver can keep a WebDriver click pending until the native
        // panel closes; submit the real panel while that click is outstanding.
        const clickSettled=click('#fileInput').then(()=>null,error=>String(error?.message||error));
        await sleep(500);
        submitRealMacOSFilePanel(fixture.file);
        const clickError=await clickSettled;
        if(clickError)throw new Error(`WebDriver native picker click failed: ${clickError.slice(0,180)}`);
        const pickerObserved=await until(`${fixture.name} native open-panel bytes`,()=>evaluate(index=>window.__ctwSafariAcceptance.selections[index]||null,pickerPrevious),entry=>entry?.done,{timeout:12000});
        nativePickerDiagnostic={mode:'native-macOS-open-panel',result:pickerObserved.result?.error||'read-completed'};
        if(!pickerObserved.result?.error){observed=pickerObserved;nativeSelectionMode='native-macOS-open-panel'}
      }catch(error){nativePickerDiagnostic={mode:'native-macOS-open-panel',error:String(error?.message||error).slice(0,300)}}
    }
  const evidence={name:fixture.name,format:fixture.format,expectedDuration:fixture.expectedDuration,expectedDispatch:fixture.expectedDispatch,before:fixture.before,native:observed.result,nativeSelectionMode,nativePickerDiagnostic,nativePreparationStatus:'RUNNING',workflowStatus:'NOT RUN'};report.fixtures.push(evidence);
  assertNativeObservation(observed.result,fixture);
  const queue=await until(`${fixture.name} application preparation`,()=>evaluate(()=>Array.from(document.querySelectorAll('#queueList li'),row=>({name:row.querySelector('strong')?.textContent,status:row.querySelector('.mini-state')?.textContent}))),rows=>rows.length===1&&rows[0].status!=='Inspecting');
  assert.deepEqual(queue,[{name:fixture.name,status:'Ready'}]);assertPreparedDiagnostic(await diagnostics(),fixture);
  assert.equal(await count(),beforeCount,'Selecting and preparing a native file must not dispatch transcription');
    evidence.nativePreparationStatus='PASS';return evidence;
  }finally{
    // Restore the original product UI only after all async native reads have
    // finished, whether the strict acceptance passes or fails.
    await evaluate(()=>{
      const input=document.querySelector('#fileInput');
      input.hidden=true;input.removeAttribute('style');
    });
  }
}
async function waitComplete(){
  const state=await until('Completed mocked transcription',()=>evaluate(()=>({title:document.querySelector('#progressTitle').textContent,status:document.querySelector('#queueList .mini-state')?.textContent,startDisabled:document.querySelector('#startBtn').disabled,cancelDisabled:document.querySelector('#cancelBtn').disabled})),value=>value.title==='Complete'&&value.status==='Completed'&&value.cancelDisabled);
  assert.equal(state.startDisabled,true,'Completed audio must not silently become billable again');
}
async function checkpointRecords(){return evaluateAsync(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('cosmic-transcriber-web');request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result;try{const query=db.transaction('checkpoints','readonly').objectStore('checkpoints').getAll();query.onerror=()=>{db.close();reject(query.error)};query.onsuccess=()=>{db.close();resolve(query.result)}}catch(error){db.close();reject(error)}};
}))}
async function assertCheckpoint(fixture,record){
  const matches=(await checkpointRecords()).filter(item=>item.sourceFingerprint===fixture.before.sha256&&item.audioFormat===fixture.format);
  assert.equal(matches.length,1,`${fixture.name}: one exact source/format checkpoint`);
  const checkpoint=matches[0];assert.equal(checkpoint.sourceSize,fixture.before.size);assert.equal(checkpoint.chunks.length,1);
  assert.equal(checkpoint.chunks[0].status,'completed');assert.equal(checkpoint.chunks[0].sha256,record.sha256);
  assert.equal(checkpoint.chunks[0].attempts.length,1,'Exactly one first paid-work attempt is recorded');
  assert.equal(checkpoint.chunks[0].attempts[0].attemptId,record.metadata.attemptId,'Checkpoint links the exact dispatched attempt identity');
  assert.equal(checkpoint.chunks[0].attempts[0].state,'success');assert.match(checkpoint.results['1'].text,/Mocked transcription result/);
}
async function clearQueue(){
  await click('#clearQueueBtn');assert.equal(await evaluate(()=>document.querySelectorAll('#queueList li').length),0);
  assert.equal(await evaluate(()=>document.querySelectorAll('#downloadButtons button').length),0);
}
async function confirmRerun(accept){
  await click('#rerunCompletedBtn');
  const text=await until('Explicit rerun confirmation',()=>evaluate(()=>document.querySelector('#confirmDialog').open?document.querySelector('#confirmText').textContent:null),Boolean);
  assert.match(text,/new OpenAI requests may incur charges/i);await click(accept?'#confirmYes':'#confirmNo');
}

try{
  for(const spec of NATIVE_FIXTURES)fixtures.push(await describeFixture(root,spec));
  await stageWorldReadableNativeFixtures();
  server=spawn(process.execPath,['tests/e2e/mock-server.mjs'],{cwd:root,env:{...process.env,COSMIC_E2E_PORT:String(port),COSMIC_E2E_TOKEN:token,COSMIC_E2E_CONTROL:'native-file-acceptance'},stdio:['ignore','pipe','pipe']});
  server.stdout.pipe(process.stdout);server.stderr.pipe(process.stderr);server.on('error',error=>{report.serverError=error.message});
  await waitEndpoint(`${origin}/__cosmic_e2e_health?token=${token}`);
  driver=spawn('/usr/bin/safaridriver',['-p',String(driverPort)],{stdio:['ignore','pipe','pipe']});
  driver.stdout.pipe(process.stdout);driver.stderr.pipe(process.stderr);driver.on('error',error=>{report.driverError=error.message});
  await waitEndpoint(`${driverOrigin}/status`);
  const session=await jsonRequest(`${driverOrigin}/session`,{method:'POST',body:{capabilities:{alwaysMatch:{acceptInsecureCerts:true,browserName:'safari',strictFileInteractability:false}}}});
  sessionId=session.value?.sessionId;assert.ok(sessionId,'SafariDriver did not return a W3C session id');
  report.capabilities=session.value.capabilities;assert.equal(report.capabilities.browserName?.toLowerCase(),'safari','Acceptance must run the installed Safari browser');
  await command('/timeouts',{script:20000,pageLoad:30000,implicit:0});await clearAutomationOrigin();await openApp();
  const shell=await evaluate(()=>({title:document.title,brand:document.querySelector('.brand')?.textContent,heading:document.querySelector('h1')?.textContent,models:Array.from(document.querySelectorAll('#modelSelect option'),option=>option.value),startVisible:!!document.querySelector('#startBtn')&&getComputedStyle(document.querySelector('#startBtn')).display!=='none',secure:window.isSecureContext,origin:location.origin}));
  assert.equal(shell.title,'Cosmic Transcriber Web');assert.match(shell.brand,/COSMIC TRANSCRIBER/i);assert.match(shell.heading,/Your API key, your usage/i);
  assert.deepEqual(shell.models,['gpt-transcribe','gpt-4o-transcribe-diarize','gpt-4o-transcribe','gpt-4o-mini-transcribe']);assert.equal(shell.startVisible,true);assert.equal(shell.secure,true);assert.equal(shell.origin,origin);
  assert.equal(await count(),0);passed('real Safari shell, native controls and strict localhost HTTPS origin');
  await click('#configureKeyBtn');await type('#apiKeyInput',seeded);await click('#createKeyBtn');
  await until('Fake BYOK session configured',()=>evaluate(()=>({status:document.querySelector('#keyStatus').textContent,value:document.querySelector('#apiKeyInput').value,open:document.querySelector('#keyDialog').open})),value=>/configured/i.test(value.status)&&value.value===''&&!value.open);
  assert.equal(await evaluate(()=>document.cookie.includes('__Host-cosmic_byok')),false,'BYOK session cookie must be HttpOnly');
  passed('mocked BYOK setup clears plaintext and uses HttpOnly session');

  for(const fixture of fixtures){
    const evidence=await selectNative(fixture);const previous=await count();await click('#startBtn');await waitComplete();
    const snapshot=await control();assert.equal(snapshot.requests.length,previous+1,`${fixture.name}: one transcription dispatch`);
    const record=snapshot.requests.at(-1);assertDispatch(record,fixture);await assertCheckpoint(fixture,record);
    assert.equal(await evaluate(()=>document.querySelectorAll('#downloadButtons button').length),2);
    const txt=await downloadPayload('#downloadButtons button:nth-child(1)'),markdown=await downloadPayload('#downloadButtons button:nth-child(2)');
    assert.match(txt.name,/\.txt$/);assert.match(markdown.name,/\.md$/);assert.match(txt.text,/Mocked transcription result/);assert.match(markdown.text,/Mocked transcription result/);
    assert.equal(await evaluate(()=>window.__xss===undefined),true,'Transcript text must not execute as markup');
    assert.equal(await count(),previous+1,'Download payload generation must not resubmit audio');
    evidence.workflowStatus='PASS';evidence.workflow='initial mocked transcription, durable checkpoint and generated download payloads';
    passed(`${fixture.name}: native bytes, slices, media duration, preparation, one mocked request, durable checkpoint and TXT/Markdown payloads`);
    if(fixture.format==='wav'){
      await evaluate(()=>{for(const [id,value] of [['chunkRange','5'],['durationRange','3']]){const element=document.getElementById(id);element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}))}const previous=document.getElementById('previousContext');previous.checked=!previous.checked;previous.dispatchEvent(new Event('change',{bubbles:true}))});
      await confirmRerun(false);assert.equal(await count(),previous+1,'Declining rerun cannot dispatch');
      await confirmRerun(true);await waitComplete();assert.equal(await count(),previous+1,'Irrelevant MP3 controls must reuse completed WAV checkpoint');
      await openApp();assert.match(await evaluate(()=>document.querySelector('#keyStatus').textContent),/configured/i,'HttpOnly session survives refresh');
      const resumed=await selectNative(fixture);await click('#startBtn');await waitComplete();assert.equal(await count(),previous+1,'Reload and native reselection must not repeat completed paid work');
      resumed.workflowStatus='PASS';resumed.workflow='reload and native reselection reuse completed checkpoint';
      passed('WAV rerun decline, irrelevant MP3 settings, reload and native reselection reuse checkpoint without dispatch');
    }
    await clearQueue();
  }

  const cancellationFixture=fixtures.at(-1);await type('#promptInput','Safari native-file cancellation acceptance; independent settings identity.');const cancellationEvidence=await selectNative(cancellationFixture);
  const beforeCancel=await count();await control('hold-next');await click('#startBtn');
  await until('Held mocked transcription',control,state=>state.requests.length===beforeCancel+1&&state.held===1);
  assert.equal(await evaluate(()=>['configureKeyBtn','modelSelect','includeTimestamps'].every(id=>document.getElementById(id).disabled)),true,'Settings are locked while dispatched');
  await click('#cancelBtn');
  await until('Cancellation preserves resumable row',()=>evaluate(()=>({title:document.querySelector('#progressTitle').textContent,status:document.querySelector('#queueList .mini-state')?.textContent,enabled:!document.querySelector('#startBtn').disabled})),state=>state.title==='Cancelled'&&state.status==='Ready'&&state.enabled);
  await control('release-held');assert.equal(await count(),beforeCancel+1);await click('#startBtn');
  let confirmation=await until('Saved ambiguous attempt requires consent',()=>evaluate(()=>document.querySelector('#confirmDialog').open?document.querySelector('#confirmText').textContent:null),Boolean);
  assert.match(confirmation,/second transcription charge/i);assert.equal(await count(),beforeCancel+1);await click('#confirmNo');
  await until('Declined retry settles',()=>evaluate(()=>document.querySelector('#cancelBtn').disabled),Boolean);
  assert.equal(await count(),beforeCancel+1,'Declining ambiguous retry cannot dispatch');await click('#startBtn');
  confirmation=await until('Retry still requires explicit consent',()=>evaluate(()=>document.querySelector('#confirmDialog').open?document.querySelector('#confirmText').textContent:null),Boolean);
  assert.match(confirmation,/second transcription charge/i);assert.equal(await count(),beforeCancel+1);await click('#confirmYes');await waitComplete();
  const finalRequests=(await control()).requests;assert.equal(finalRequests.length,beforeCancel+2,'Only the explicitly accepted retry may dispatch');assertDispatch(finalRequests.at(-1),cancellationFixture);
  assert.equal(finalRequests.at(-1).sha256,finalRequests.at(-2).sha256,'Retry keeps exact prepared audio identity');
  assert.notEqual(finalRequests.at(-1).metadata.attemptId,finalRequests.at(-2).metadata.attemptId,'Explicit retry records a distinct attempt');
  const retryCheckpoints=(await checkpointRecords()).filter(item=>item.chunks?.some(chunk=>chunk.attempts?.some(attempt=>attempt.attemptId===finalRequests.at(-1).metadata.attemptId)));
  assert.equal(retryCheckpoints.length,1);const retryCheckpoint=retryCheckpoints[0];
  assert.equal(retryCheckpoint.sourceFingerprint,cancellationFixture.before.sha256);assert.equal(retryCheckpoint.audioFormat,cancellationFixture.format);
  assert.equal(retryCheckpoint.chunks[0].status,'completed');assert.equal(retryCheckpoint.chunks[0].attempts.length,2);
  assert.deepEqual(retryCheckpoint.chunks[0].attempts.map(attempt=>({id:attempt.attemptId,state:attempt.state})),[{id:finalRequests.at(-2).metadata.attemptId,state:'cancelled_or_ambiguous'},{id:finalRequests.at(-1).metadata.attemptId,state:'success'}]);
  const finalDiagnostic=await diagnostics();assert.ok(finalDiagnostic.events.some(event=>event.category==='job_cancelled'));
  assert.ok(finalDiagnostic.events.some(event=>event.category==='ambiguous_retry_answered'&&event.accepted===false));assert.ok(finalDiagnostic.events.some(event=>event.category==='ambiguous_retry_answered'&&event.accepted===true));
  passed('cancelled native upload remains ambiguous; reject prevents dispatch and explicit consent permits exactly one retry');
  cancellationEvidence.workflowStatus='PASS';cancellationEvidence.workflow='cancel, decline ambiguous retry and explicitly accept one retry';
  const persisted=await evaluate(()=>({local:Object.values(localStorage).join('|'),session:Object.values(sessionStorage).join('|'),cookie:document.cookie}));
  assert.equal(JSON.stringify(persisted).includes(seeded),false);assert.equal(JSON.stringify(await checkpointRecords()).includes(seeded),false);
  passed('fake API key absent from readable cookie and local/session/IndexedDB storage');
  report.requests=finalRequests;report.status='PASS';
}catch(error){
  report.status='FAIL';report.error=String(error?.stack||error);process.exitCode=1;console.error(`Real Safari native-file acceptance FAILED: ${report.error}`);
}finally{
  report.fixturesPreserved=true;
  for(const entry of report.fixtures)if(entry.nativePreparationStatus==='RUNNING')entry.nativePreparationStatus='FAIL';
  for(const fixture of fixtures){
    try{const after=await fixtureIdentity(fixture.file);assert.deepEqual(after,fixture.before);if(fixture.sourceFile)assert.deepEqual(await fixtureIdentity(fixture.sourceFile),fixture.before,`${fixture.name}: original source fixture changed`);for(const entry of report.fixtures.filter(item=>item.name===fixture.name))entry.after=after}
    catch(error){report.fixturesPreserved=false;report.status='FAIL';report.integrityError=String(error);process.exitCode=1}
  }
  if(sessionId&&driver){try{await command('',{},'DELETE')}catch(error){report.cleanupError=String(error);report.status='FAIL';process.exitCode=1}}
  if(driver&&!driver.killed)driver.kill('SIGTERM');if(server&&!server.killed)server.kill('SIGTERM');
  if(sharedNativeFixtureDirectory){try{await rm(sharedNativeFixtureDirectory,{recursive:true,force:true})}catch(error){report.cleanupError=String(error);report.status='FAIL';process.exitCode=1}}
  report.finishedAt=new Date().toISOString();const text=JSON.stringify(report,null,2)+'\n';
  const reportPath=path.resolve(process.env.COSMIC_SAFARI_REPORT||path.join(root,'test-results','safari-native-acceptance.json'));
  await mkdir(path.dirname(reportPath),{recursive:true});await writeFile(reportPath,text);
  console.log(`SAFARI_NATIVE_ACCEPTANCE_JSON=${JSON.stringify(report)}`);
  if(report.status==='PASS')console.log('Real Safari native-file and mocked workflow acceptance: PASS');
}
