import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomInt} from 'node:crypto';
import {createServer} from 'node:https';
import {chmod,mkdir,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createEphemeralLocalhostTlsOptions} from '../e2e/ephemeral-tls.mjs';
import {isGenuineDiskRead} from './disk-access-probe-contract.mjs';

// Diagnostic only: this does NOT replace genuine application Safari acceptance.
// No synthetic File, Blob, DataTransfer or FileList is ever constructed. All
// selected files are independently hashed real macOS disk copies of format.mp3.
const root=path.resolve(import.meta.dirname,'../..');
const reportFile=path.resolve(process.env.COSMIC_SAFARI_DISK_PROBE_REPORT||path.join(root,'test-results/safari-disk-access-probe.json'));
const report={schema:'cosmic-safari-disk-access-probe-1',role:'diagnostic-only-not-release-certification',startedAt:new Date().toISOString(),platform:process.platform,candidates:[],status:'RUNNING'};
const original=path.join(root,'tests/fixtures/format.mp3');
const filePage='<!doctype html><html><head><meta charset="UTF-8"><title>Genuine Safari file access probe</title></head><body><input type="file" id="diskInput" accept=".mp3,audio/mpeg"><script>document.getElementById("diskInput").addEventListener("change",()=>{window.__ctwNativeChangeCount=(window.__ctwNativeChangeCount||0)+1})</script></body></html>';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
async function identity(file){const [bytes,s]=await Promise.all([readFile(file),stat(file,{bigint:true})]);return {size:bytes.length,sha256:sha256(bytes),mtimeNs:String(s.mtimeNs),sliceSha256:sha256(bytes.subarray(0,Math.min(1024,bytes.length)))};}
async function request(origin,endpoint,{method='GET',body,timeout=12000}={}){
 const response=await fetch(origin+endpoint,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});
 const json=await response.json();if(response.status>=400||json.value?.error)throw new Error(`WebDriver ${endpoint}: ${json.value?.error||response.status} ${json.value?.message||''}`);
 return json.value;
}
async function waitDriver(origin){let last;for(let i=0;i<60;i++){try{return await request(origin,'/status',{timeout:1000})}catch(e){last=e;await delay(250)}}throw new Error('SafariDriver not ready: '+String(last));}
async function placeRealFixture(base,label,expected){
  let folder;try{
    folder=await mkdtemp(path.join(base,'ctw-safari-real-disk-'));
    await chmod(folder,0o755);
    const destination=path.join(folder,'format.mp3');
    const cp=spawnSync('/bin/cp',['-p',original,destination],{encoding:'utf8',timeout:15000});
    assert.equal(cp.status,0,`${label}: copy -p failed: ${cp.stderr||cp.error?.message}`);
    await chmod(destination,0o644);
    assert.deepEqual(await identity(destination),expected,`${label}: fixture bytes, slice and original nanosecond mtime MUST match`);
    return {label,folder,file:destination,ready:true};
  }catch(error){if(folder)await rm(folder,{recursive:true,force:true}).catch(()=>{});return {label,ready:false,error:String(error)};}
}
async function probeSelection(driverOrigin,sessionId,fixture,expected){
 const output={label:fixture.label,location:fixture.file,pathKind:fixture.label,status:'FAIL'};
 const wd=(endpoint,opts)=>request(driverOrigin,`/session/${sessionId}${endpoint}`,opts);
 try{
  await wd('/url',{method:'POST',body:{url:pageUrl}});
  const element=await wd('/element',{method:'POST',body:{using:'css selector',value:'#diskInput'}});
  const elementId=element?.['element-6066-11e4-a52e-4f735466cecf'];
  assert.ok(elementId,`${fixture.label}: genuine input missing`);
  await wd(`/element/${elementId}/value`,{method:'POST',body:{text:fixture.file},timeout:15000});
  const result=await wd('/execute/async',{method:'POST',timeout:20000,body:{script:`const done=arguments[arguments.length-1];
(async()=>{
  const input=document.getElementById('diskInput'),file=input?.files?.[0];
  if(!file)return {error:'No browser-selected native disk File',changeCount:window.__ctwNativeChangeCount||0};
  const result={name:file.name,type:file.type,size:file.size,lastModified:file.lastModified,changeCount:window.__ctwNativeChangeCount||0};
  try{
    const [full,slice]=await Promise.all([file.arrayBuffer(),file.slice(0,1024).arrayBuffer()]);
    const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
    result.sha256=await digest(full);result.sliceSha256=await digest(slice);result.bytesRead=full.byteLength;
  }catch(e){result.error=String(e?.name||'Error')+': '+String(e?.message||e)}
  return result;
})().then(done,e=>done({error:String(e?.stack||e)}));`,args:[]}});
  output.native=result;
  const matches=isGenuineDiskRead(result,expected);
  output.status=matches?'PASS':'FAIL';
  if(!matches)output.reason='Native file full/sliced SHA, size, filename, MIME, timestamp or change event mismatch';
 }catch(error){output.error=String(error?.stack||error).slice(0,900)}
 return output;
}
let server,driver,sessionId,shared=[],driverOrigin,pageUrl;
try{
 if(process.platform!=='darwin')throw new Error('Real Safari disk access probe requires a native macOS host');
 const expected=await identity(original);assert.ok(expected.size>1000,'Original disk fixture too small');report.original=expected;
 const candidateBases=[['UsersShared','/Users/Shared'],['PrivateTmp','/private/tmp'],['RunnerTemp',process.env.RUNNER_TEMP||tmpdir()],['HomeDownloads',path.join(homedir(),'Downloads')]];
 for(const [label,base] of candidateBases){if(label==='HomeDownloads')await mkdir(base,{recursive:true});shared.push(await placeRealFixture(base,label,expected));}
 assert.ok(shared.some(f=>f.ready),'No genuine disk fixture staging location available');
 const tls=createEphemeralLocalhostTlsOptions();
 server=createServer(tls,(req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(filePage)});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,resolve)});
 pageUrl=`https://localhost:${server.address().port}/`;
 const port=randomInt(50100,58000);driverOrigin=`http://127.0.0.1:${port}`;
 driver=spawn('/usr/bin/safaridriver',['-p',String(port)],{stdio:['ignore','pipe','pipe']});
 let driverStderr='';driver.stderr.on('data',data=>driverStderr+=data.toString().slice(0,200));
 await waitDriver(driverOrigin);
 const session=await request(driverOrigin,'/session',{method:'POST',body:{capabilities:{alwaysMatch:{browserName:'safari',acceptInsecureCerts:true,strictFileInteractability:false}}},timeout:30000});
 sessionId=session?.sessionId;assert.ok(sessionId,'No genuine Safari W3C session');
 report.capabilities=session.capabilities;
 await request(driverOrigin,`/session/${sessionId}/timeouts`,{method:'POST',body:{script:15000,pageLoad:30000,implicit:0}});
 for(const staged of shared){if(!staged.ready){report.candidates.push({label:staged.label,status:'NOT RUN',reason:staged.error});continue;}
  report.candidates.push(await probeSelection(driverOrigin,sessionId,staged,expected));
 }
 report.status=report.candidates.some(x=>x.status==='PASS')?'PASS':'FAIL';
 report.note='PASS indicates only genuine WebDriver disk-file byte access under at least one location; original app workflow, BYOK and billing remain separately mandatory.';
}catch(error){report.status='FAIL';report.error=String(error?.stack||error)}
finally{
 if(sessionId&&driverOrigin){try{await request(driverOrigin,`/session/${sessionId}`,{method:'DELETE',timeout:5000})}catch(e){report.cleanupError=String(e).slice(0,300)}}
 if(driver&&!driver.killed)driver.kill('SIGTERM');if(server)await new Promise(resolve=>server.close(resolve));
 for(const staged of shared){if(staged.folder)await rm(staged.folder,{recursive:true,force:true}).catch(error=>{report.cleanupError=String(error)})}
 report.finishedAt=new Date().toISOString();await mkdir(path.dirname(reportFile),{recursive:true});await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
 console.log(`SAFARI_DISK_ACCESS_PROBE=${JSON.stringify(report)}`);
 if(report.status!=='PASS')process.exitCode=1;
}
