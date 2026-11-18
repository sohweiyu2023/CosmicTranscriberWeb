import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

// Execute extracted production functions. Only browser transports and the SHA-256
// primitive adapter are substituted; schema, integrity recipe, identity, MP3
// inspection/materialization, source/chunk hashes and the upload consumer run.
export async function exerciseCheckpoint({
  model='gpt-transcribe', layout='missing-first', previousContext=false,
  confirm=false, tamperIntegrity=false, mismatchIdentity=false,
  emptyResult=false
}={}, {root=new URL('../../',import.meta.url)}={}) {
  const js=new URL('public/js/',root);
  const names=['checkpoint-schema','checkpoint-identity','checkpoint-effective-settings',
    'retry-policy','models','mp3','audio-formats','transcript-result',
    'transcript-limits','text-bounds','transport-policy'];
  const modules=await Promise.all(names.map(n=>import(new URL(n+'.js',js))));
  const deps=Object.assign({},...modules);
  const app=await readFile(new URL('app.js',js),'utf8');
  const stores=new Map(), counts={reads:0,writes:0,deletes:0,confirms:0,network:0};
  const calls=[],events=[],loadedRecords=[];
  const db={
    objectStoreNames:{contains:()=>true},close(){},
    transaction(_name,mode){
      const tx={objectStore:()=>({
        get(id){assert.equal(mode,'readonly');counts.reads++;const request={};
          queueMicrotask(()=>{request.result=structuredClone(stores.get(id));loadedRecords.push(request.result);request.onsuccess?.()});return request},
        put(record){assert.equal(mode,'readwrite');counts.writes++;stores.set(record.id,structuredClone(record));
          queueMicrotask(()=>tx.oncomplete?.())},
        delete(){counts.deletes++;throw new Error('Unexpected checkpoint deletion')}
      })};return tx;
    }
  };
  const indexedDB={open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.()});return request}};
  const sha256=Object.assign(bytes=>new Uint8Array(createHash('sha256').update(bytes).digest()),{
    create(){const h=createHash('sha256');return {update(bytes){h.update(bytes)},digest(){return new Uint8Array(h.digest())}}}
  });
  let ids=0;
  const context={...deps,sha256,indexedDB,structuredClone,TextEncoder,Uint8Array,
    Blob,AbortController,DOMException,performance,setTimeout,clearTimeout,btoa,
    state:{principalScope:'A'.repeat(32),runId:'synthetic-run',completedFiles:0,cancelRequested:false,online:true},
    document:{visibilityState:'visible'},UI:{completedStat:{},progressBar:{value:0}},
    rid:prefix=>prefix+'-'+(++ids),nowIso:()=>new Date('2026-11-18T00:00:00.000Z').toISOString(),
    addDiag:(name,data)=>events.push({name,data}),setProgress(){},renderQueue(){},
    safeDisplayName:s=>s,beginTimedOperation(){},endTimedOperation(){},
    errorCode:e=>e.code||'synthetic_error',diagnosticErrorFields:()=>({}),
    askAmbiguousRetry:async()=>{counts.confirms++;return confirm},
    fetch:()=>{counts.network++;throw new Error('Network forbidden in checkpoint test')},
    api:async(url,options)=>{
      assert.equal(url,'/api/transcribe');assert.equal(options.method,'POST');
      const meta=JSON.parse(Buffer.from(options.headers['X-Cosmic-Metadata'],'base64url').toString());
      calls.push({index:meta.chunkIndex,model:meta.model,prompt:meta.prompt,bodyBytes:options.body.size});
      const text='synthetic part '+meta.chunkIndex;
      return {result:{text,...(deps.MODELS[meta.model].diarize
        ?{segments:[{speaker:'A',start:0,end:1,text}]}:{})},diagnostics:{}};
    }
  };
  vm.createContext(context);
  const hash=(await readFile(new URL('hash.js',js),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  vm.runInContext(hash,context,{filename:'actual-hash.js'});
  const checkpoint=(await readFile(new URL('checkpoint.js',js),'utf8'))
    .replace(/^import .*;\r?\n/gm,'').replace(/^export \{.*\} from .*;\r?\n/gm,'').replace(/^export /gm,'');
  vm.runInContext(checkpoint+'\nglobalThis.storage={saveCheckpoint,loadCheckpoint,settingsIdentity,checkpointId};',context,{filename:'actual-checkpoint.js'});
  const helpers=['settingsForIdentity','processingRevision','chunkBlob','encodeMetadata','newCheckpoint']
    .map(name=>{const line=app.split('\n').find(s=>s.startsWith('function '+name+'('));assert.ok(line,name);return line}).join('\n');
  const sendStart=app.indexOf('function checkpointPersistenceFailure(');
  const processStart=app.indexOf('async function processFile('),processEnd=app.indexOf('\nfunction prepareDownloads',processStart);
  assert.ok(sendStart>=0&&processStart>sendStart&&processEnd>processStart);
  vm.runInContext(helpers+'\n'+app.slice(sendStart,processEnd)+
    '\nglobalThis.consumer={processFile,ensureInspectionForSettings,newCheckpoint};',context,{filename:'actual-app-consumer.js'});
  const multi=layout!=='missing-first'&&layout!=='valid-single'&&layout!=='in_flight'&&layout!=='ambiguous'&&layout!=='pending';
  const file=new Blob([await readFile(new URL('tests/fixtures/'+(multi?'cbr-128k-370s.mp3':'format.mp3'),root))],{type:'audio/mpeg'});
  Object.defineProperty(file,'name',{value:'synthetic-fixture.mp3'});
  const settings={model,diarize:deps.MODELS[model].diarize,previousContext,languages:[],keywords:[],prompt:'synthetic prompt',chunkMb:20,maxMinutes:multi&&layout==='context-chain'?3:5,retryCount:0};
  const item={file,fingerprint:await context.hashBlobStreaming(file),audioFormat:'mp3',diagRef:'synthetic-file'};
  await context.consumer.ensureInspectionForSettings(item,settings);
  assert.equal(item.inspection.chunks.length,multi?(layout==='context-chain'?3:2):1);
  const sid=context.storage.settingsIdentity(deps.effectivePaidSettings(settings,'mp3'),{audioFormat:'mp3',processingRevision:deps.MP3_CHUNKER_REVISION});
  const cpid=await context.storage.checkpointId(context.state.principalScope,item.fingerprint,sid);
  const record=context.consumer.newCheckpoint(item,cpid,sid);
  function complete(index,withResult=true){
    const c=record.chunks[index-1];c.status='completed';
    c.attempts=[{attemptId:'synthetic-paid-'+index,startedAt:'2026-11-17T00:00:00.000Z',completedAt:'2026-11-17T00:00:01.000Z',state:'success'}];
    if(withResult)record.results[index]={index,logicalStart:c.logicalStart,duration:c.duration,
      text:emptyResult?'':'saved part '+index,
      segments:deps.MODELS[model].diarize?(emptyResult?[]:[{speaker:'A',start:c.logicalStart,end:c.logicalStart+1,text:'saved part '+index}]):null,
      diagnostics:{status:200},attempts:structuredClone(c.attempts)};
  }
  if(layout==='missing-first')complete(1,false);
  else if(layout==='missing-later')complete(record.chunks.length,false);
  else if(layout==='missing-after-valid'){complete(1);complete(record.chunks.length,false)}
  else if(layout==='context-chain'){complete(1);complete(3)}
  else if(layout==='valid-single')complete(1);
  else if(layout==='in_flight'||layout==='ambiguous'){
    record.chunks[0].status=layout;record.chunks[0].attempts=[{attemptId:'synthetic-unresolved',startedAt:'2026-11-17T00:00:00.000Z',state:'dispatched'}];
  } else assert.equal(layout,'pending');
  if(mismatchIdentity)record.settingsIdentity='f'.repeat(64);
  const seeded=await context.storage.saveCheckpoint(record);
  const shapeValid=deps.validateCheckpointShape(seeded);
  assert.equal(shapeValid,true);
  const loadProbe=await context.storage.loadCheckpoint(cpid);
  const integrityLoadAccepted=JSON.stringify(loadProbe)===JSON.stringify(seeded);
  assert.equal(integrityLoadAccepted,true);
  const compatible=deps.compatibleCheckpoint(seeded,{principalScope:context.state.principalScope,sourceFingerprint:item.fingerprint,
    sourceSize:file.size,settingsIdentity:sid,audioFormat:'mp3',processingRevision:deps.MP3_CHUNKER_REVISION,chunks:item.inspection.chunks});
  assert.equal(compatible,!mismatchIdentity);
  if(tamperIntegrity){const damaged=structuredClone(stores.get(cpid));damaged.integrity='0'.repeat(64);stores.set(cpid,damaged)}
  const before=JSON.stringify(stores.get(cpid));
  for(const key of Object.keys(counts))counts[key]=0;
  events.length=0;
  let parts,error;
  try{parts=await context.consumer.processFile(item,settings,1,1)}catch(e){error=e}
  const after=JSON.stringify(stores.get(cpid));
  assert.equal(counts.network,0);
  return {model,layout,previousContext,shapeValid,integrityLoadAccepted,compatible,counts,calls,events,parts,
    error:error?{code:error.code,message:error.message}:null,itemStatus:item.status,before,after,
    persistedUnchanged:before===after,loadedUnchanged:JSON.stringify(loadedRecords.at(-1))===before,appSha256:createHash('sha256').update(app).digest('hex')};
}
