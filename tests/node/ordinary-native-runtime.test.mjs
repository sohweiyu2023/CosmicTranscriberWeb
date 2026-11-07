import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {runOrdinaryProcess,materializeOrdinaryFixture,ordinaryFileIdentity,CERTIFIED_ORDINARY_MP3,waitOrdinaryReady,createOrdinaryRunner} from '../safari/ordinary-native-runtime.mjs';
import {macProcessFacts,sanitizeOrdinarySafariReport} from '../safari/ordinary-native-report-sanitize.mjs';
const secret='PRIVATE-SYNTHETIC-UNQUOTED-CANARY';
test('synchronous UI-style subprocess can starve same-process HTTP; async process keeps server responsive',async()=>{
 const server=createServer((req,res)=>{res.end('ready')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const url='http://127.0.0.1:'+server.address().port+'/';
  const script=`fetch(${JSON.stringify(url)},{signal:AbortSignal.timeout(2000)}).then(async r=>{process.stdout.write(String(r.status)+':'+await r.text())}).catch(e=>{process.stdout.write(JSON.stringify({name:['TimeoutError','TypeError'].includes(e.name)?e.name:'OTHER',cause:['ECONNREFUSED','EACCES','EPERM','ENETUNREACH','ECONNRESET','UND_ERR_SOCKET'].includes(e.cause?.code)?e.cause.code:'unavailable'}));process.exitCode=3})`;
  const old=spawnSync(process.execPath,['-e',script],{encoding:'utf8',timeout:6000,windowsHide:true});assert.equal(old.status,3,JSON.stringify({status:old.status,signal:old.signal,code:old.error?.code??null,stderrPresent:!!old.stderr}));assert.equal(JSON.parse(old.stdout).name,'TimeoutError',old.stdout);
  const result=await runOrdinaryProcess(process.execPath,['-e',script],{timeoutMs:6000});assert.equal(result.status,0,result.error?.code);assert.equal(result.stdout,'200:ready');assert.equal(result.outcomeUncertain,false);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
});
test('owned subprocess timeout and cancellation are explicit uncertain outcomes, never silently success',async()=>{
 const timed=await runOrdinaryProcess(process.execPath,['-e','setTimeout(()=>{},2500)'],{timeoutMs:60});assert.equal(timed.error.code,'ETIMEDOUT');assert.equal(timed.outcomeUncertain,true);assert.equal(macProcessFacts(timed).failureKind,'timeout');
 const controller=new AbortController();const pending=runOrdinaryProcess(process.execPath,['-e','setTimeout(()=>{},2500)'],{timeoutMs:1500,signal:controller.signal});setTimeout(()=>controller.abort(),50);const cancelled=await pending;assert.equal(cancelled.error.code,'ABORT_ERR');assert.equal(cancelled.outcomeUncertain,true);assert.equal(macProcessFacts(cancelled).failureKind,'interrupted');
});
test('missing command and oversized output retain bounded facts without unrestricted output',async()=>{
 const missing=await runOrdinaryProcess(path.join(tmpdir(),'ctw-nonexistent-command-20261107'),[],{timeoutMs:500});assert.equal(missing.error.code,'ENOENT');assert.equal(macProcessFacts(missing).failureKind,'command-missing');
 const oversized=await runOrdinaryProcess(process.execPath,['-e',"process.stdout.write('x'.repeat(131072))"],{timeoutMs:2000});assert.ok(Buffer.byteLength(oversized.stdout)<=32768);assert.equal(oversized.outputTruncated,true);assert.equal(macProcessFacts(oversized).failureKind,'output-limit');
});
test('source fixture stays untouched while a real owned copy matches exact certified bytes and1980mtime',async()=>{
 const source=fileURLToPath(new URL('../fixtures/format.mp3',import.meta.url)),before=await ordinaryFileIdentity(source),folder=await mkdtemp(path.join(tmpdir(),'ctw-ordinary-safari-runtime-'));
 try{const staged=await materializeOrdinaryFixture(source,folder);assert.deepEqual(staged.source,before);assert.deepEqual(staged.selected,CERTIFIED_ORDINARY_MP3);assert.deepEqual(await ordinaryFileIdentity(staged.file),CERTIFIED_ORDINARY_MP3);assert.deepEqual(await ordinaryFileIdentity(source),before);await assert.rejects(materializeOrdinaryFixture(source,folder),{code:'EEXIST'})}
 finally{assert.ok(path.resolve(folder).startsWith(path.resolve(tmpdir())+path.sep));await rm(folder,{recursive:true,force:true})}
});
test('unknown subprocess prose is absent from actual persisted structured evidence',async()=>{
 const result=await runOrdinaryProcess(process.execPath,['-e',`process.stderr.write(${JSON.stringify(secret)});process.exitCode=2`],{timeoutMs:2000});const report=sanitizeOrdinarySafariReport({status:'FAIL',platform:'darwin',processes:{browserOpen:macProcessFacts(result)}});
 const folder=await mkdtemp(path.join(tmpdir(),'ctw-ordinary-safari-log-'));try{const file=path.join(folder,'safe.json');await writeFile(file,JSON.stringify(report));const text=await readFile(file,'utf8');assert.equal(text.includes(secret),false);assert.equal(JSON.parse(text).processes.browserOpen.detailsState,'unrecognized-output-omitted')}finally{assert.ok(path.resolve(folder).startsWith(path.resolve(tmpdir())+path.sep));await rm(folder,{recursive:true,force:true})}
});
test('page readiness waits for the real acknowledgement and times out explicitly',async()=>{
 const flags={titleMatches:true,inputPresent:true,secureContext:true,cryptoSubtlePresent:true};assert.deepEqual(await waitOrdinaryReady(Promise.resolve(flags),100),flags);await assert.rejects(waitOrdinaryReady(new Promise(()=>{}),20),{name:'TimeoutError'});await assert.rejects(waitOrdinaryReady(Promise.resolve(flags),Infinity));
 const source=await readFile(new URL('../safari/ordinary-native-gui-probe.mjs',import.meta.url),'utf8');assert.equal(source.includes('spawnSync'),false);const outputIndex=source.indexOf('await mkdir(path.dirname(output)'),readyIndex=source.indexOf('await waitOrdinaryReady(ready)');assert.ok(outputIndex>=0&&outputIndex<source.indexOf('const version=await run'));assert.ok(readyIndex>=0&&readyIndex<source.indexOf('report.guiPicker={'));assert.match(source,/browserOpened&&!report.uiOutcomeUncertain/);assert.match(source,/await run\('/);
});

test('an uncertain native action blocks every further UI command while retaining read-only evidence',async()=>{
 const report={},calls=[];const run=createOrdinaryRunner(report,{capture:async(cmd)=>{calls.push(cmd);return calls.length===1?{status:null,error:{code:'ETIMEDOUT'},outcomeUncertain:true}:{status:0,outcomeUncertain:false}}});
 await run('/usr/bin/osascript',[],100);assert.equal(report.uiOutcomeUncertain,true);const blocked=await run('/usr/bin/osascript',[],100);assert.equal(blocked.error.code,'EUNCERTAIN');await run('/usr/bin/open',[],100);assert.equal(calls.length,1);await run('/usr/sbin/screencapture',[],100);assert.equal(calls.length,2);assert.equal(macProcessFacts(blocked).failureKind,'outcome-uncertain');
});
