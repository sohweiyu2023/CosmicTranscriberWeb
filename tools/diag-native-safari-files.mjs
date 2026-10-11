import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,copyFile,stat,realpath,unlink,rmdir,readdir,lstat} from 'node:fs/promises';
import {createServer as createHttpServer} from 'node:http';
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
const report={schema:'native-safari-file-control-experiment-2',purpose:'DIAGNOSTIC ONLY; never release acceptance',status:'RUNNING',startedAt:new Date(startedAt).toISOString(),archiveSha256:process.env.DIAG_ARCHIVE_SHA256||null,platform:process.platform,node:process.version,providerCalls:0,applicationLoaded:false,sourceFiles:[],trials:[],infrastructureErrors:[]};
report.changesFromV1=['strictFileInteractability true rather than false','native read APIs and post-Send-Keys first-read delays','HTTP and HTTPS localhost origins','macOS 26 and macOS 15 runner matrix'];
report.interpretation='Diagnostic controls only. Any success must be isolated before attributing it to one changed factor or claiming release acceptance.';
let httpsServer,httpServer,driver,driverOrigin,sessionId,tlsDir;
const driverLogRoot=path.join(os.homedir(),'Library','Logs','com.apple.WebDriver');
let driverLogsBefore=new Set();
const sources=[],receipts=new Map();
const uploadToken=randomUUID();
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
    if(item.size>8*1024*1024||total+item.size>16*1024*1024){evidence.push({name:item.rel,size:item.size,skipped:'diagnostic collection size bound'});continue;}
    const dest=path.join(output,'driver-diagnostics',item.rel);await mkdir(path.dirname(dest),{recursive:true});await copyFile(path.join(driverLogRoot,item.rel),dest);total+=item.size;
    evidence.push({name:item.rel,size:item.size,sha256:hash(await readFile(dest))});
  }
  report.newSessionDriverLogs={directory:driverLogRoot,files:evidence};
}
async function collectScopedOperatingSystemLogs(){
  // Read-only, bounded and optional. Restrict output to this experiment's two
  // filenames and Safari/WebKit/sandbox processes. Do not request extra rights.
  const predicate='(eventMessage CONTAINS "format.mp3" OR eventMessage CONTAINS "ID3 Unicode 東京.mp3") AND (process == "sandboxd" OR process == "kernel" OR process CONTAINS "WebKit" OR process CONTAINS "Safari")';
  const result=spawnSync('/usr/bin/log',['show','--last','8m','--style','ndjson','--predicate',predicate],{encoding:'utf8',timeout:8000,maxBuffer:2*1024*1024});
  report.operatingSystemLogCollection={purpose:'Optional read-only filename/process-scoped diagnostic',status:result.status,signal:result.signal,error:result.error?safeError(result.error):null,stderr:String(result.stderr||'').slice(0,2000)};
  if(result.status===0){const content=result.stdout||'';await writeFile(path.join(output,'scoped-native-file-os.log'),content);report.operatingSystemLogCollection.bytes=Buffer.byteLength(content);}
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

function installDiagnosticPage(uploadToken){
  const input=document.querySelector('#nativeInput'),form=document.querySelector('#nativeForm');
  const metadata=file=>file?{name:file.name,size:file.size,type:file.type,lastModified:file.lastModified,constructorName:file.constructor?.name,isNativeFile:file instanceof File}:null;
  window.nativeDiag={config:null,selection:null};
  const errorInfo=error=>({name:error?.name||'Error',message:String(error?.message||error),code:error?.code??null});
  window.runNativeRead=()=>{
    const entry=window.nativeDiag.selection,config=window.nativeDiag.config,file=window.retainedNativeFile;
    if(!entry||entry.started)throw new Error('Missing or previously started native selection.');
    entry.started=true;entry.commandStartedMs=performance.now();
    (async()=>{
      if(config.delayMs)await new Promise(resolve=>setTimeout(resolve,config.delayMs));
      const result={api:config.api,start:config.slice?0:null,end:config.slice?Math.min(file.size,1024):null,startedMs:performance.now(),metadataBefore:metadata(file),inputCountBefore:input.files.length};
      entry.stages.push(result);let timer,reader,url,streamReader;
      try{
        const blob=config.slice?file.slice(0,Math.min(file.size,1024)):file;
        const read=async()=>{
          if(config.api==='arrayBuffer')return blob.arrayBuffer();
          if(config.api==='FileReader')return new Promise((resolve,reject)=>{reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.onabort=()=>reject(new DOMException('FileReader aborted','AbortError'));reader.readAsArrayBuffer(blob)});
          if(config.api==='stream'){
            streamReader=blob.stream().getReader();const chunks=[];let length=0;
            while(true){const {done,value}=await streamReader.read();if(done)break;chunks.push(value);length+=value.byteLength;}
            const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes.buffer;
          }
          if(config.api==='blobURLfetch'){url=URL.createObjectURL(blob);const response=await fetch(url);result.fetchStatus=response.status;return response.arrayBuffer();}
          if(config.api==='nativeForm'){
            // Submit the real form and its native file input directly. No FormData,
            // replacement File, fetch upload, or JavaScript file read occurs here.
            form.action=`/upload?trial=${encodeURIComponent(config.id)}&token=${encodeURIComponent(uploadToken)}`;
            form.submit();
            for(let attempt=0;attempt<80;attempt++){
              const response=await fetch(`/receipt?trial=${encodeURIComponent(config.id)}&token=${encodeURIComponent(uploadToken)}`,{cache:'no-store'});
              if(response.status===200){const receipt=await response.json();result.nativeUpload=receipt;if(receipt.error)throw new Error(receipt.error);return {serverReceipt:receipt};}
              await new Promise(resolve=>setTimeout(resolve,25));
            }
            throw new Error('Native form receipt not received within2seconds.');
          }
          throw new Error('Unknown read API.');
        };
        const bytes=await Promise.race([read(),new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('Native operation exceeded2500ms');error.name='DiagnosticReadTimeout';reject(error)},2500)})]);
        result.readCompletedMs=performance.now();result.status='READ';
        if(bytes?.serverReceipt){result.bytes=bytes.serverReceipt.bytes;result.sha256=bytes.serverReceipt.sha256;}
        else{const digest=await crypto.subtle.digest('SHA-256',bytes);result.bytes=bytes.byteLength;result.sha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
      }catch(error){result.status='READ_ERROR';result.error=errorInfo(error);}
      finally{
        clearTimeout(timer);if(reader?.readyState===FileReader.LOADING)reader.abort();if(streamReader)void streamReader.cancel().catch(()=>{});if(url)URL.revokeObjectURL(url);
        result.finishedMs=performance.now();result.metadataAfter=metadata(file);result.inputCountAfter=input.files.length;
      }
    })().catch(error=>{entry.observerError=errorInfo(error)}).finally(()=>{entry.done=true;entry.completedMs=performance.now();document.querySelector('#state').textContent=JSON.stringify(entry,null,2)});
    return {started:true,selectionAtMs:entry.selectionAtMs,commandStartedMs:entry.commandStartedMs};
  };
  input.addEventListener('change',()=>{
    const file=input.files[0];
    // This reference is the browser-created native File. The delayed controls
    // only record metadata here; their first byte read starts after Send Keys.
    window.retainedNativeFile=file;
    const entry=window.nativeDiag.selection={metadataBeforeRead:metadata(file),inputCountBeforeRead:input.files.length,selectionAtMs:performance.now(),stages:[],started:false,done:false};
    if(!file){entry.observerError={name:'Error',message:'Native Send Keys produced no File.'};entry.done=true;return;}
    if(window.nativeDiag.config.inChange)window.runNativeRead();
  });
}

try{
  assert.equal(report.archiveSha256,expectedArchiveSha256,'This diagnostic is pinned to the old30de Windows ZIP.');
  assert.ok(process.env.DIAG_ARCHIVE_PATH,'DIAG_ARCHIVE_PATH is required.');
  assert.equal(hash(await readFile(process.env.DIAG_ARCHIVE_PATH)),expectedArchiveSha256,'Diagnostic ZIP bytes changed.');
  for(const name of ['format.mp3','ID3 Unicode 東京.mp3']){
    const file=path.join(extracted,'tests','fixtures',name),before=await identity(file),bytes=await readFile(file);
    assert.equal(before.sha256,expectedFixtureHashes[name],'Fixture does not match the pinned old Windows ZIP.');
    const source={name,file,before,expectedPrefix:{bytes:Math.min(bytes.length,1024),sha256:hash(bytes.subarray(0,1024))}};
    sources.push(source);report.sourceFiles.push({name,before});
  }
  await save();
  tlsDir=await mkdtemp('/tmp/cosmic-safari-diagnostic-tls-');
  const key=path.join(tlsDir,'key.pem'),cert=path.join(tlsDir,'cert.pem');
  const tls=spawnSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'],{encoding:'utf8',timeout:15000});
  assert.equal(tls.status,0,`Local TLS setup failed: ${tls.stderr}`);
  const html=`<!doctype html><meta charset="utf-8"><title>Native Safari API diagnostic only</title><h1>Diagnostic only</h1><form id="nativeForm" method="post" enctype="multipart/form-data" target="uploadResult"><input id="nativeInput" name="audio" type="file"></form><iframe name="uploadResult" title="Native form diagnostic result"></iframe><pre id="state"></pre><script>(${installDiagnosticPage.toString()})(${JSON.stringify(uploadToken)});</script>`;
  const pageOrigins=new Set();
  const handler=(req,res)=>{
    const scheme=req.socket.encrypted?'https':'http',origin=`${scheme}://${req.headers.host}`,url=new URL(req.url,origin);
    const send=(status,body,type='application/json')=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store'});res.end(body)};
    if(!pageOrigins.has(origin))return send(403,'{"error":"Unexpected host"}');
    if(req.method==='GET'&&url.pathname==='/')return send(200,html,'text/html; charset=utf-8');
    if(url.pathname==='/favicon.ico')return send(204,'');
    if(url.searchParams.get('token')!==uploadToken)return send(403,'{"error":"Invalid diagnostic token"}');
    const id=url.searchParams.get('trial');if(!/^trial-[0-9]+$/.test(id||''))return send(400,'{"error":"Invalid trial"}');
    if(req.method==='GET'&&url.pathname==='/receipt')return send(receipts.has(id)?200:404,JSON.stringify(receipts.get(id)||{}));
    if(req.method!=='POST'||url.pathname!=='/upload'||req.headers.origin!==origin)return send(403,'{"error":"Unexpected diagnostic route or Origin"}');
    const contentType=String(req.headers['content-type']||''),parts=[];let length=0,ended=false;
    req.on('data',chunk=>{length+=chunk.length;if(length>1024*1024){ended=true;receipts.set(id,{error:'Native upload exceeded1MiB'});req.destroy();return;}parts.push(chunk)});
    req.on('error',error=>receipts.set(id,{error:`Native form request error: ${error.message}`,wireBytes:length}));
    req.on('end',()=>{
      if(ended)return;
      try{
        const body=Buffer.concat(parts),boundary=/^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))$/i.exec(contentType);
        assert.ok(boundary,'Native form did not send multipart/form-data');
        const marker=boundary[1]||boundary[2],start=Buffer.from(`--${marker}\r\n`),closing=Buffer.from(`\r\n--${marker}--`);
        assert.ok(body.subarray(0,start.length).equals(start),'Native multipart opening boundary missing');
        const headersEnd=body.indexOf(Buffer.from('\r\n\r\n'),start.length),end=body.indexOf(closing,headersEnd+4);
        assert.ok(headersEnd>start.length&&end>=headersEnd+4,'Native multipart shape is invalid');
        const headers=body.subarray(start.length,headersEnd).toString('utf8');
        assert.match(headers,/content-disposition: form-data; name="audio"; filename="/i,'Unexpected native form field');
        const bytes=body.subarray(headersEnd+4,end);
        receipts.set(id,{transport:'browser-native-form',origin,contentType,partHeaders:headers,wireBytes:body.length,bytes:bytes.length,sha256:hash(bytes)});
        send(200,'<!doctype html><p>Diagnostic upload received.</p>','text/html');
      }catch(error){receipts.set(id,{error:String(error.message),wireBytes:length});send(400,'<!doctype html><p>Invalid diagnostic upload.</p>','text/html')}
    });
  };
  httpsServer=createHttpsServer({key:await readFile(key),cert:await readFile(cert)},handler);
  httpServer=createHttpServer(handler);
  await unlink(key);await unlink(cert);await rmdir(tlsDir);
  for(const server of [httpServer,httpsServer])await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const origins=[`http://localhost:${httpServer.address().port}`,`https://localhost:${httpsServer.address().port}`];
  for(const origin of origins)pageOrigins.add(origin);
  const driverPort=await availablePort();driverOrigin=`http://127.0.0.1:${driverPort}`;
  report.origins={pages:origins,driver:driverOrigin};
  const driverStdout=[],driverStderr=[];
  driverLogsBefore=new Set((await driverLogFiles()).map(item=>item.rel));
  driver=spawn('/usr/bin/safaridriver',['-p',String(driverPort)],{stdio:['ignore','pipe','pipe']});
  driver.stdout.on('data',chunk=>driverStdout.push(chunk.toString()));driver.stderr.on('data',chunk=>driverStderr.push(chunk.toString()));
  driver.once('error',error=>report.infrastructureErrors.push(safeError(error)));
  report.driverLogs={stdout:driverStdout,stderr:driverStderr};await ready();
  const session=await request(`${driverOrigin}/session`,{method:'POST',body:{capabilities:{alwaysMatch:{browserName:'safari',acceptInsecureCerts:true,strictFileInteractability:true,'safari:diagnose':true}}}});
  sessionId=session.value?.sessionId;assert.ok(sessionId);report.capabilities=session.value.capabilities;
  assert.equal(report.capabilities.browserName?.toLowerCase(),'safari');
  await command('/timeouts',{script:10000,pageLoad:15000,implicit:0});
  const cases=[
    {name:'arrayBuffer-in-change',api:'arrayBuffer',inChange:true,delayMs:0},
    {name:'arrayBuffer-next-command',api:'arrayBuffer',delayMs:0},
    {name:'arrayBuffer-after250ms',api:'arrayBuffer',delayMs:250},
    {name:'arrayBuffer-after2000ms',api:'arrayBuffer',delayMs:2000},
    {name:'arrayBuffer-prefix-next-command',api:'arrayBuffer',slice:true,delayMs:0},
    {name:'FileReader-next-command',api:'FileReader',delayMs:0},
    {name:'stream-next-command',api:'stream',delayMs:0},
    {name:'blobURLfetch-next-command',api:'blobURLfetch',delayMs:0},
    {name:'native-form-next-command',api:'nativeForm',delayMs:0},
  ];
  report.caseDefinitions=cases;
  for(const origin of origins)for(const source of sources)for(const control of cases){
    assert.ok(Date.now()<deadline-15000,'Diagnostic global deadline nearly exhausted.');
    const id=`trial-${report.trials.length+1}`,config={...control,id};
    const trial={id,fixture:source.name,origin,control:control.name,selectedPath:source.file,status:'RUNNING',before:await identity(source.file)};
    report.trials.push(trial);await save();
    try{
      await command('/url',{url:origin});
      trial.page=await evaluate(selected=>{window.nativeDiag.config=selected;return {ready:document.readyState,secure:isSecureContext,userAgent:navigator.userAgent}},config);
      const element=(await command('/element',{using:'css selector',value:'#nativeInput'}))['element-6066-11e4-a52e-4f735466cecf'];assert.ok(element);
      // Always a fresh native selection and page for each operation. Never
      // substitute a File or deliver file content through the WebDriver script.
      trial.sendKeysStartedAt=new Date().toISOString();
      await command(`/element/${element}/value`,{text:source.file});
      trial.sendKeysReturnedAt=new Date().toISOString();
      trial.nativeAfterSendKeys=await evaluate(()=>window.nativeDiag.selection);
      assert.ok(trial.nativeAfterSendKeys,'No native change event after Send Keys.');
      if(!control.inChange){
        assert.equal(trial.nativeAfterSendKeys.stages.length,0,'Deferred control read bytes before post-Send-Keys command.');
        trial.startCommand=await evaluate(()=>window.runNativeRead());
      }
      const trialDeadline=Date.now()+6500;let observed;
      do{
        observed=await evaluate(()=>window.nativeDiag.selection);
        if(observed){trial.native=observed;if(observed.done)break;}
        await delay(50);
      }while(Date.now()<trialDeadline);
      assert.ok(observed?.done,'Native observer did not complete within6500ms.');
      for(const stage of observed.stages){
        if(stage.status!=='READ')continue;
        const expected=control.slice?source.expectedPrefix:{bytes:source.before.size,sha256:source.before.sha256};
        stage.matchesExpectedBytes=stage.bytes===expected.bytes&&stage.sha256===expected.sha256;
      }
      trial.status=observed.observerError?'OBSERVER_ERROR':observed.stages.length!==1||observed.stages.some(stage=>stage.status!=='READ'||!stage.matchesExpectedBytes)?'READ_FAILURE_OBSERVED':'ALL_OBSERVED_READS_MATCH';
    }catch(error){trial.status='COMMAND_OR_OBSERVER_FAILURE';trial.error=safeError(error);try{trial.native=await evaluate(()=>window.nativeDiag?.selection||null)}catch{}}
    trial.after=await identity(source.file);trial.diskUnchanged=JSON.stringify(trial.before)===JSON.stringify(trial.after);
    assert.equal(trial.diskUnchanged,true,'Diagnostic unexpectedly changed file bytes or filesystem identity.');
    console.log(`DIAGNOSTIC ${trial.status}: ${source.name}; ${origin}; ${control.name}`);await save();
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
  try{await collectScopedOperatingSystemLogs()}catch(error){report.operatingSystemLogCollectionError=safeError(error)}
  for(const server of [httpServer,httpsServer])if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  if(tlsDir){for(const name of ['key.pem','cert.pem'])try{await unlink(path.join(tlsDir,name))}catch(error){if(error.code!=='ENOENT')report.infrastructureErrors.push(safeError(error))}try{await rmdir(tlsDir)}catch(error){if(error.code!=='ENOENT')report.infrastructureErrors.push(safeError(error))}}
  report.nativeUploadReceipts=[...receipts.entries()].map(([id,receipt])=>({id,...receipt}));
  report.finishedAt=new Date().toISOString();report.durationMs=Date.now()-startedAt;
  report.summary={trials:report.trials.length,readFailureTrials:report.trials.filter(t=>t.status==='READ_FAILURE_OBSERVED').length,matchingReadTrials:report.trials.filter(t=>t.status==='ALL_OBSERVED_READS_MATCH').length,commandOrObserverFailures:report.trials.filter(t=>t.status==='COMMAND_OR_OBSERVER_FAILURE'||t.status==='OBSERVER_ERROR').length,releaseAcceptance:false};
  await save();console.log(JSON.stringify({status:report.status,...report.summary,report:reportPath}));
}
