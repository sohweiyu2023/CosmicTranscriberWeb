import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createToolDiagnostics} from '../../scripts/tooling-diagnostics.mjs';
async function temporary(run){const p=await fs.mkdtemp(path.join(tmpdir(),'cosmic-tool-logs-'));try{return await run(p)}finally{await fs.rm(p,{recursive:true,force:true})}}
test('typed events ignore private fields and reserved-key overwrite, cycles and hostile arrays',async()=>{
 const secret='synthetic-private-key-cookie-transcript-do-not-log',log=createToolDiagnostics({component:'wrangler-auth'}),cycle=[];cycle.push(cycle);
 const revoked=Proxy.revocable([],{});revoked.revoke();
 for(const labels of [cycle,revoked.proxy,['auth_not_authenticated',secret]]){
  const event=log.record({schema:secret,buildIdentity:secret,diagnosticsCodeSha256:secret,operationId:secret,atUtc:secret,component:secret,operation:secret,phase:secret,result:'failure',errorCategory:secret,message:secret,stack:secret,token:secret,stdout:{bytes:123,categories:labels,raw:secret},stderr:cycle});
  assert.equal(JSON.stringify(event).includes(secret),false);assert.equal(event.component,'wrangler-auth');assert.equal(event.operation,'unknown');assert.equal(event.phase,'unknown');assert.equal(event.schema,'cosmic-tool-event-1');assert.match(event.operationId,/^[a-f0-9-]{36}$/);assert.match(event.diagnosticsCodeSha256,/^[a-f0-9]{64}$/);
 }
 const exported=await log.exportSupport();assert.equal(exported.events.length,3);assert.equal(JSON.stringify(exported).includes(secret),false);
});
test('logger/sink/clock failure never throws into primary operation and reports incomplete diagnostics',async()=>{
 const log=createToolDiagnostics({sink:()=>{throw Error('private sink')},clock:()=>{throw Error('private clock')}});
 assert.doesNotThrow(()=>log.record({phase:'finish',result:'success',exitCode:0}));const summary=await log.flush();assert.equal(summary.complete,false);assert.ok(summary.writeFailures>0);
});
test('disk failure retains safe cause in memory without exposing filesystem error or losing primary status',async()=>temporary(async directory=>{
 const log=createToolDiagnostics({component:'wrangler-auth',directory,fsImpl:{...fs,open:async()=>{throw Error('synthetic-private-disk-error')}}});
 log.record({operation:'wrangler-whoami',phase:'finish',result:'failure',errorCategory:'auth_not_authenticated',exitCode:0});
 const support=await log.exportSupport();assert.equal(support.summary.complete,false);assert.ok(support.summary.writeFailures>0);assert.equal(support.events.at(-1).errorCategory,'auth_not_authenticated');assert.equal(JSON.stringify(support).includes('synthetic-private-disk-error'),false);
}));
test('rotation stays within three bounded files and discloses loss counts and completeness',async()=>temporary(async directory=>{
 const log=createToolDiagnostics({directory,maximumFileBytes:2048});for(let i=0;i<30;i++)log.record({operation:'artifact-download',phase:'verify',result:'success',exitCode:0});
 const support=await log.exportSupport();const files=await fs.readdir(directory);assert.ok(files.length<=3);for(const f of files)assert.ok((await fs.stat(path.join(directory,f))).size<=2048);
 assert.equal(support.summary.complete,false);assert.ok(support.summary.diskRecordsExpiredOrRotated>0);assert.ok(support.summary.droppedEventsAtLeast>0);
}));
test('restart is conservative, malformed records are dropped and old records expire after seven days',async()=>temporary(async directory=>{
 const first=createToolDiagnostics({directory,component:'wrangler-auth'});first.record({phase:'start',result:'started'});first.record({phase:'finish',result:'failure',errorCategory:'auth_device_expired',exitCode:1});await first.flush();
 await fs.appendFile(path.join(directory,'operations-0.jsonl'),'not-json-synthetic-private-data\n');
 const next=createToolDiagnostics({directory});next.record({phase:'recovery',result:'unknown',reconciliationRequired:true});const support=await next.exportSupport();assert.equal(support.summary.restarted,true);assert.equal(support.summary.priorOutcomeUnverified,true);assert.equal(support.summary.complete,false);assert.equal(support.summary.parseFailures,1);assert.ok(support.events.some(e=>e.errorCategory==='auth_device_expired'));assert.equal(JSON.stringify(support).includes('not-json-synthetic-private-data'),false);
 const old=new Date(Date.now()-8*86400000);const lines=(await fs.readFile(path.join(directory,'operations-0.jsonl'),'utf8')).trim().split('\n').map(line=>{const event=JSON.parse(line);event.atUtc=old.toISOString();return JSON.stringify(event)});await fs.writeFile(path.join(directory,'operations-0.jsonl'),lines.join('\n')+'\n');
 const expired=createToolDiagnostics({directory});const result=await expired.exportSupport();assert.equal(result.events.length,0);assert.ok(result.summary.diskRecordsExpiredOrRotated>0);
}));
test('memory retention and support export stay bounded with explicit eviction count',async()=>{
 const log=createToolDiagnostics({component:'source-admission'});for(let i=0;i<150;i++)log.record({phase:'preflight',result:'blocked',errorCategory:'unknown'});const support=await log.exportSupport();assert.equal(support.events.length,128);assert.equal(support.summary.memoryEvictions,22);assert.equal(support.summary.complete,false);
});

test('mutating or throwing sink cannot inject payload/toJSON before queued persistence',async()=>temporary(async directory=>{
 const secret='synthetic-private-sink-payload';const log=createToolDiagnostics({directory,sink:event=>{try{event.stdout.categories.push(secret)}catch{};try{event.privatePayload=secret}catch{};try{event.toJSON=()=>({secret})}catch{};throw Error(secret)}});
 const event=log.record({phase:'finish',result:'success',exitCode:0});assert.equal(Object.isFrozen(event),true);assert.equal(Object.isFrozen(event.stdout.categories),true);
 const support=await log.exportSupport();assert.equal(JSON.stringify(support).includes(secret),false);assert.equal(support.summary.complete,false);const disk=await fs.readFile(path.join(directory,'operations-0.jsonl'),'utf8');assert.equal(disk.includes(secret),false);
}));

test('async rejection is contained; a hung async sink cannot block flush or claim completeness',async()=>{
 const rejected=createToolDiagnostics({sink:async()=>{throw Error('synthetic-private-async-error')}});rejected.record({result:'success',phase:'finish'});const a=await rejected.exportSupport();assert.equal(a.summary.complete,false);assert.ok(a.summary.writeFailures>0);assert.equal(JSON.stringify(a).includes('synthetic-private-async-error'),false);
 const hung=createToolDiagnostics({sink:()=>new Promise(()=>{})});hung.record({result:'success',phase:'finish'});const b=await hung.flush();assert.equal(b.pendingSinks,1);assert.equal(b.complete,false);
});
test('category truncation is explicit even when raw output is short',async()=>{
 const log=createToolDiagnostics();log.record({result:'failure',stderr:{bytes:10,categories:['none','auth_not_authenticated','auth_device_expired','auth_consent_denied','dns_failure','tls_failure','dependency_missing','process_failure','network_failure']}});const support=await log.exportSupport();assert.equal(support.events[0].stderr.categoriesTruncated,true);assert.equal(support.events[0].stderr.categories.length,8);assert.ok(support.summary.categoryLossEvents>0);assert.equal(support.summary.complete,false);
});
test('concurrent instances sharing a directory preserve segment caps or disclose contention loss',async()=>temporary(async directory=>{
 const a=createToolDiagnostics({directory,maximumFileBytes:2048}),b=createToolDiagnostics({directory,maximumFileBytes:2048});for(let i=0;i<30;i++){a.record({phase:'finish',result:'success'});b.record({phase:'finish',result:'success'})}const summaries=await Promise.all([a.flush(),b.flush()]);const files=(await fs.readdir(directory)).filter(n=>n.endsWith('.jsonl'));assert.ok(files.length<=3);for(const f of files)assert.ok((await fs.stat(path.join(directory,f))).size<=2048);assert.ok(summaries.some(s=>s.lockContentions>0||!s.complete));assert.equal((await fs.readdir(directory)).includes('operations.writer.lock'),false);
}));

test('active logger expires old rotated segments without requiring a restart',async()=>temporary(async directory=>{
 const log=createToolDiagnostics({directory});log.record({phase:'start',result:'started'});await log.flush();
 const old=JSON.parse((await fs.readFile(path.join(directory,'operations-0.jsonl'),'utf8')).trim());old.atUtc=new Date(Date.now()-8*86400000).toISOString();
 await fs.writeFile(path.join(directory,'operations-2.jsonl'),JSON.stringify(old)+'\n');
 log.record({phase:'finish',result:'success'});const summary=await log.flush();assert.ok(summary.diskRecordsExpiredOrRotated>0);await assert.rejects(fs.stat(path.join(directory,'operations-2.jsonl')),e=>e.code==='ENOENT');
}));

test('restored runtime attribution is preserved without accepting arbitrary stored version text',async()=>temporary(async directory=>{
 const initial=createToolDiagnostics({directory});initial.record({phase:'finish',result:'success'});await initial.flush();
 const file=path.join(directory,'operations-0.jsonl'),event=JSON.parse((await fs.readFile(file,'utf8')).trim());event.nodeVersion='24.19.0';await fs.writeFile(file,JSON.stringify(event)+'\n');
 const old=await createToolDiagnostics({directory}).exportSupport();assert.equal(old.events[0].nodeVersion,'24.19.0');
 event.nodeVersion='synthetic-private-runtime-payload';await fs.writeFile(file,JSON.stringify(event)+'\n');
 const invalid=await createToolDiagnostics({directory}).exportSupport();assert.equal(invalid.events[0].nodeVersion,null);assert.equal(JSON.stringify(invalid).includes('synthetic-private-runtime-payload'),false);
}));
