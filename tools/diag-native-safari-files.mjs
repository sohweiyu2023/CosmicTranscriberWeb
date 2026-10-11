import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,copyFile,utimes,chmod,stat,realpath,unlink,rmdir,readdir,lstat} from 'node:fs/promises';
import {createServer as createHttpsServer} from 'node:https';
import {createServer as createTcpServer} from 'node:net';
import path from 'node:path';
import os from 'node:os';

// DIAGNOSTIC ONLY. No application, provider, API key, in-memory File replacement,
// release flag or accepted-fixture mutation belongs in this control experiment.
assert.equal(process.platform,'darwin','This diagnostic requires real macOS Safari.');
assert.equal(process.version,'v26.7.0');
const [extractedArg,outputArg]=process.argv.slice(2);
assert.ok(extractedArg&&outputArg,'Usage: node tools/diag-native-safari-files.mjs <untouched-extracted-root> <evidence-directory>');
const extracted=path.resolve(extractedArg),output=path.resolve(outputArg);
await mkdir(output,{recursive:true});
const reportPath=path.join(output,'native-safari-diagnostic.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const startedAt=Date.now(),deadline=startedAt+420000;
const report={schema:'native-safari-file-control-experiment-1',purpose:'DIAGNOSTIC ONLY; never release acceptance',status:'RUNNING',startedAt:new Date(startedAt).toISOString(),archiveSha256:process.env.DIAG_ARCHIVE_SHA256||null,platform:process.platform,node:process.version,providerCalls:0,applicationLoaded:false,sourceFiles:[],variants:[],trials:[],infrastructureErrors:[]};
let httpsServer,driver,driverOrigin,sessionId,tlsDir;
const driverLogRoot=path.join(os.homedir(),'Library','Logs','com.apple.WebDriver');
let driverLogsBefore=new Set();
const sources=[],variants=[];
const expectedArchiveSha256='c68370707fc18093a3e4e741bdd1686643fa585aed41715b8fbf4bd175ae1485';
const expectedFixtureHashes={'format.mp3':'e799ee1a44f73c9a4b146e76cce9deae6390ebc2aad3f51da13ce9dda2182b55','ID3 Unicode 東京.mp3':'7c170f8ca3be08da4e7c7a751998d066f6853be1598e5fac0aa0e8047767eb8c'};
const save=()=>writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
const safeError=error=>({name:error?.name||'Error',message:String(error?.message||error),code:error?.code??null});

async function identity(file){
  const [bytes,info,canonical]=await Promise.all([readFile(file),stat(file,{bigint:true}),realpath(file)]);
  return {path:file,realpath:canonical,size:Number(info.size),sha256:hash(bytes),mode:(Number(info.mode)&0o7777).toString(8),uid:info.uid.toString(),gid:info.gid.toString(),device:info.dev.toString(),inode:info.ino.toString(),mtimeNs:info.mtimeNs.toString(),mtimeMs:Number(info.mtimeNs)/1e6,mtimeLocal:new Date(Number(info.mtimeNs)/1e6).toString(),birthtimeNs:info.birthtimeNs.toString()};
}
async function driverLogFiles(){
  const files=[];
  async function walk(rel=''){
    let entries;try{entries=await readdir(path.join(driverLogRoot,rel),{withFileTypes:true})}catch(error){if(error.code==='ENOENT')return;throw error}
    for(const entry of entries){const child=path.join(rel,entry.name),info=await lstat(path.join(driverLogRoot,child));if(info.isSymbolicLink())continue;if(info.isDirectory())await walk(child);else if(info.isFile())files.push({rel:child,size:info.size,mtimeMs:info.mtimeMs});}
  }
  await walk();return files;
}
async function collectNewDriverLogs(){
  // Selenium's SafariDriverService documents this directory. Copy only files
  // newly created during this session, never prior user's/runner's driver logs.
  // https://www.selenium.dev/selenium/docs/api/dotnet/webdriver/OpenQA.Selenium.Safari.SafariDriverService.html
  const evidence=[];let total=0;
  for(const item of await driverLogFiles()){
    if(driverLogsBefore.has(item.rel)||item.mtimeMs<startedAt-2000)continue;
    if(item.size>2*1024*1024||total+item.size>16*1024*1024){evidence.push({name:item.rel,size:item.size,skipped:'diagnostic collection size bound'});continue;}
    const dest=path.join(output,'driver-diagnostics',item.rel);await mkdir(path.dirname(dest),{recursive:true});await copyFile(path.join(driverLogRoot,item.rel),dest);total+=item.size;
    evidence.push({name:item.rel,size:item.size,sha256:hash(await readFile(dest))});
  }
  report.newSessionDriverLogs={directory:driverLogRoot,files:evidence};
}
async function availablePort(){const server=createTcpServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function request(url,{method='GET',body,timeout=15000}={}){
  assert.ok(Date.now()<deadline,'Diagnostic global deadline exceeded.');
  const response=await fetch(url,{method,headers:body===undefined?undefined:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(Math.min(timeout,Math.max(1,deadline-Date.now())))});
  const text=await response.text();let parsed;try{parsed=text?JSON.parse(text):{}}catch{throw new Error(`Non-JSON local WebDriver reply (${response.status}).`)}
  if(!response.ok||parsed.value?.error)throw new Error(`WebDriver ${method} ${new URL(url).pathname}: ${response.status} ${parsed.value?.error||''} ${parsed.value?.message||''}`);
  return parsed;
}
async function command(endpoint,body={},method='POST'){
  return (await request(`${driverOrigin}/session/${sessionId}${endpoint}`,{method,body:method==='GET'||method==='DELETE'?undefined:body})).value;
}
const evaluate=(fn,...args)=>command('/execute/sync',{script:`return (${fn.toString()})(...arguments);`,args});
async function ready(){
  const until=Date.now()+20000;
  while(Date.now()<until){try{await request(`${driverOrigin}/status`,{timeout:1000});return;}catch{await delay(100)}}
  throw new Error('SafariDriver did not become ready.');
}

function installDiagnosticPage(){
  const input=document.querySelector('#nativeInput');
  const metadata=file=>file?{name:file.name,size:file.size,type:file.type,lastModified:file.lastModified,constructorName:file.constructor?.name,isNativeFile:file instanceof File}:null;
  window.nativeDiag={mode:'unchanged-sequential',selection:null};
  input.addEventListener('change',()=>{
    const file=input.files[0],mode=window.nativeDiag.mode;
    const entry=window.nativeDiag.selection={mode,metadataBeforeRead:metadata(file),inputCountBeforeRead:input.files.length,events:[],stages:[],done:false};
    // Retain the genuine native File object. No File/Blob replacement is used.
    window.retainedNativeFile=file;
    const event=name=>entry.events.push({name,atMs:performance.now(),inputCount:input.files.length,retainedMetadata:metadata(file)});
    async function read(stage,start,end){
      const result={stage,start,end,startedMs:performance.now(),metadataBefore:metadata(file),inputCountBefore:input.files.length};
      entry.stages.push(result);let timer;
      try{
        const blob=start===null?file:file.slice(start,end);
        const bytes=await Promise.race([blob.arrayBuffer(),new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('Native read exceeded1200ms');error.name='DiagnosticReadTimeout';reject(error)},1200)})]);
        const digest=await crypto.subtle.digest('SHA-256',bytes);
        result.status='READ';result.bytes=bytes.byteLength;result.sha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      }catch(error){result.status='READ_ERROR';result.error={name:error?.name||'Error',message:String(error?.message||error),code:error?.code??null};}
      finally{clearTimeout(timer);result.finishedMs=performance.now();result.metadataAfter=metadata(file);result.inputCountAfter=input.files.length;}
      return result;
    }
    const clear=()=>{event('before-input-clear');input.value='';event('after-input-clear');};
    (async()=>{
      if(!file)throw new Error('Native Send Keys produced no File.');
      event('native-selection');
      const middle=Math.floor(file.size/2),ranges=[['full',null,null],['prefix',0,Math.min(file.size,1024)],['middle',middle,Math.min(file.size,middle+257)],['tail',Math.max(0,file.size-333),file.size]];
      if(mode==='unchanged-sequential'){for(const [stage,start,end] of ranges)await read(stage,start,end);}
      else if(mode==='unchanged-concurrent'){await Promise.all(ranges.map(([stage,start,end])=>read(stage,start,end)));}
      else if(mode==='clear-before-read'){clear();await read('full-after-clear',null,null);await read('prefix-after-clear',0,Math.min(file.size,1024));}
      else if(mode==='clear-after-full-read'){await read('full-before-clear',null,null);clear();await read('prefix-after-clear',0,Math.min(file.size,1024));await read('full-reread-after-clear',null,null);}
      else throw new Error('Unknown diagnostic lifetime mode.');
    })().catch(error=>{entry.observerError={name:error?.name||'Error',message:String(error?.message||error)}}).finally(()=>{event('complete');entry.done=true;document.querySelector('#state').textContent=JSON.stringify(entry,null,2)});
  });
}

try{
  assert.equal(report.archiveSha256,expectedArchiveSha256,'This diagnostic is pinned to the old30de Windows ZIP.');
  assert.ok(process.env.DIAG_ARCHIVE_PATH,'DIAG_ARCHIVE_PATH is required.');
  assert.equal(hash(await readFile(process.env.DIAG_ARCHIVE_PATH)),expectedArchiveSha256,'Diagnostic ZIP bytes changed.');
  const workspaceCopies=await mkdtemp(path.join(path.dirname(extracted),'safari-file-controls-'));
  const tmpCopies=await mkdtemp('/tmp/cosmic-safari-file-controls-');
  report.controlDirectories={workspace:workspaceCopies,tmp:tmpCopies};
  for(const name of ['format.mp3','ID3 Unicode 東京.mp3']){
    const file=path.join(extracted,'tests','fixtures',name),before=await identity(file),bytes=await readFile(file);
    assert.equal(before.sha256,expectedFixtureHashes[name],'Fixture does not match the pinned old Windows ZIP.');
    const source={name,file,before};sources.push(source);report.sourceFiles.push({name,before});
    const candidates=[{label:'untouched-archive-workspace-1980',file}];
    for(const [location,directory] of [['workspace',workspaceCopies],['tmp',tmpCopies]]){
      for(const stamp of location==='workspace'?['2000','current']:['1980','2000','current']){
        const targetDir=path.join(directory,stamp);await mkdir(targetDir,{recursive:true});const target=path.join(targetDir,name);
        await copyFile(file,target);await chmod(target,parseInt(before.mode,8));
        const seconds=stamp==='1980'?before.mtimeMs/1000:stamp==='2000'?Date.UTC(2000,0,1,12)/1000:Date.now()/1000;
        await utimes(target,seconds,seconds);
        candidates.push({label:`${location}-copy-${stamp}`,file:target});
      }
    }
    for(const candidate of candidates){
      const beforeVariant=await identity(candidate.file);assert.equal(beforeVariant.sha256,before.sha256);assert.equal(beforeVariant.size,before.size);
      for(const [pathKind,selectedPath] of beforeVariant.realpath===candidate.file?[['supplied',candidate.file]]:[['supplied',candidate.file],['canonical-realpath',beforeVariant.realpath]]){
        const variant={id:`${name}/${candidate.label}/${pathKind}`,name,label:candidate.label,pathKind,selectedPath,before:beforeVariant,expectedSlices:[]};
        const middle=Math.floor(bytes.length/2);
        for(const [start,end] of [[0,Math.min(bytes.length,1024)],[middle,Math.min(bytes.length,middle+257)],[Math.max(0,bytes.length-333),bytes.length]])variant.expectedSlices.push({start,end,bytes:end-start,sha256:hash(bytes.subarray(start,end))});
        variants.push(variant);report.variants.push(variant);
      }
    }
  }
  await save();
  tlsDir=await mkdtemp('/tmp/cosmic-safari-diagnostic-tls-');
  const key=path.join(tlsDir,'key.pem'),cert=path.join(tlsDir,'cert.pem');
  const tls=spawnSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'],{encoding:'utf8',timeout:15000});
  assert.equal(tls.status,0,`Local TLS setup failed: ${tls.stderr}`);
  const html=`<!doctype html><meta charset="utf-8"><title>Native Safari file diagnostic only</title><h1>Diagnostic only</h1><input id="nativeInput" type="file"><pre id="state"></pre><script>(${installDiagnosticPage.toString()})();</script>`;
  httpsServer=createHttpsServer({key:await readFile(key),cert:await readFile(cert)},(req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html)});
  await unlink(key);await unlink(cert);await rmdir(tlsDir); // Do not retain/upload even the ephemeral localhost key.
  await new Promise((resolve,reject)=>{httpsServer.once('error',reject);httpsServer.listen(0,'127.0.0.1',resolve)});
  const origin=`https://localhost:${httpsServer.address().port}`,driverPort=await availablePort();driverOrigin=`http://127.0.0.1:${driverPort}`;
  report.origins={page:origin,driver:driverOrigin};
  const driverStdout=[],driverStderr=[];
  driverLogsBefore=new Set((await driverLogFiles()).map(item=>item.rel));
  driver=spawn('/usr/bin/safaridriver',['-p',String(driverPort)],{stdio:['ignore','pipe','pipe']});
  driver.stdout.on('data',chunk=>driverStdout.push(chunk.toString()));driver.stderr.on('data',chunk=>driverStderr.push(chunk.toString()));
  driver.once('error',error=>report.infrastructureErrors.push(safeError(error)));
  report.driverLogs={stdout:driverStdout,stderr:driverStderr};await ready();
  const session=await request(`${driverOrigin}/session`,{method:'POST',body:{capabilities:{alwaysMatch:{browserName:'safari',acceptInsecureCerts:true,strictFileInteractability:false,'safari:diagnose':true}}}});
  sessionId=session.value?.sessionId;assert.ok(sessionId);report.capabilities=session.value.capabilities;
  assert.equal(report.capabilities.browserName?.toLowerCase(),'safari');
  await command('/timeouts',{script:10000,pageLoad:15000,implicit:0});
  for(const variant of variants){
    for(const mode of ['unchanged-sequential','unchanged-concurrent','clear-before-read','clear-after-full-read']){
      assert.ok(Date.now()<deadline-15000,'Diagnostic global deadline nearly exhausted.');
      const trial={variantId:variant.id,mode,selectedPath:variant.selectedPath,status:'RUNNING',before:await identity(variant.selectedPath)};report.trials.push(trial);await save();
      try{
        await command('/url',{url:origin});
        await evaluate(selectedMode=>{window.nativeDiag.mode=selectedMode;return {ready:document.readyState,secure:isSecureContext,userAgent:navigator.userAgent}},mode).then(value=>{trial.page=value});
        const element=(await command('/element',{using:'css selector',value:'#nativeInput'}))['element-6066-11e4-a52e-4f735466cecf'];assert.ok(element);
        // The only file delivery path is genuine W3C Element Send Keys.
        await command(`/element/${element}/value`,{text:variant.selectedPath});
        const trialDeadline=Date.now()+8000;let observed;
        do{
          observed=await evaluate(()=>window.nativeDiag.selection);
          if(observed){trial.native=observed;if(observed.done)break;}
          await delay(50);
        }while(Date.now()<trialDeadline);
        assert.ok(observed?.done,'Native observer did not complete within8seconds.');
        for(const stage of observed.stages){
          if(stage.status!=='READ')continue;
          const expected=stage.start===null?{bytes:variant.before.size,sha256:variant.before.sha256}:variant.expectedSlices.find(slice=>slice.start===stage.start&&slice.end===stage.end);
          stage.matchesExpectedBytes=!!expected&&stage.bytes===expected.bytes&&stage.sha256===expected.sha256;
        }
        trial.status=observed.observerError?'OBSERVER_ERROR':observed.stages.some(stage=>stage.status!=='READ'||!stage.matchesExpectedBytes)?'READ_FAILURE_OBSERVED':'ALL_OBSERVED_READS_MATCH';
      }catch(error){trial.status='COMMAND_OR_OBSERVER_FAILURE';trial.error=safeError(error);try{trial.native=await evaluate(()=>window.nativeDiag?.selection||null)}catch{}}
      trial.after=await identity(variant.selectedPath);trial.diskUnchanged=JSON.stringify(trial.before)===JSON.stringify(trial.after);
      assert.equal(trial.diskUnchanged,true,'Diagnostic unexpectedly changed file bytes or filesystem identity.');
      console.log(`DIAGNOSTIC ${trial.status}: ${variant.id}; ${mode}`);await save();
    }
  }
  report.status='DIAGNOSTIC_COMPLETE';
}catch(error){report.status='DIAGNOSTIC_INCOMPLETE';report.infrastructureErrors.push(safeError(error));process.exitCode=1;console.error(error);}
finally{
  for(const source of sources){
    try{const after=await identity(source.file),row=report.sourceFiles.find(item=>item.name===source.name);row.after=after;row.unchanged=JSON.stringify(source.before)===JSON.stringify(after);if(!row.unchanged){report.status='DIAGNOSTIC_SOURCE_CHANGED';process.exitCode=1;}}catch(error){report.infrastructureErrors.push(safeError(error));process.exitCode=1;}
  }
  if(sessionId)try{await request(`${driverOrigin}/session/${sessionId}`,{method:'DELETE',timeout:5000})}catch(error){report.cleanupError=safeError(error)}
  if(driver&&!driver.killed)driver.kill('SIGTERM');
  if(driver){if(driver.exitCode===null)await Promise.race([new Promise(resolve=>driver.once('exit',resolve)),delay(1000)]);try{await collectNewDriverLogs()}catch(error){report.driverLogCollectionError=safeError(error)}}
  if(httpsServer){httpsServer.closeAllConnections();await new Promise(resolve=>httpsServer.close(resolve));}
  if(tlsDir){for(const name of ['key.pem','cert.pem'])try{await unlink(path.join(tlsDir,name))}catch(error){if(error.code!=='ENOENT')report.infrastructureErrors.push(safeError(error))}try{await rmdir(tlsDir)}catch(error){if(error.code!=='ENOENT')report.infrastructureErrors.push(safeError(error))}}
  report.finishedAt=new Date().toISOString();report.durationMs=Date.now()-startedAt;
  report.summary={trials:report.trials.length,readFailureTrials:report.trials.filter(t=>t.status==='READ_FAILURE_OBSERVED').length,matchingReadTrials:report.trials.filter(t=>t.status==='ALL_OBSERVED_READS_MATCH').length,commandOrObserverFailures:report.trials.filter(t=>t.status==='COMMAND_OR_OBSERVER_FAILURE'||t.status==='OBSERVER_ERROR').length,releaseAcceptance:false};
  await save();console.log(JSON.stringify({status:report.status,...report.summary,report:reportPath}));
}
