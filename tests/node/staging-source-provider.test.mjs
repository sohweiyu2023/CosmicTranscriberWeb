import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {PLAN,FIXTURES,proposal} from '../../scripts/staging-source-admission.mjs';
import {createJournalEngine} from '../../scripts/staging-source-journal.mjs';
import {prepareSourceProviderRequestComponent,parseSourceProviderResponseComponent,createSourceDispatchTransportComponent} from '../../scripts/staging-source-provider.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const claim=(f,i)=>({slot:i+11,format:f.format,model:f.model,maximumMicroUsd:f.reservationMicroUsd,attemptId:'attempt-'+hash(PLAN.campaign+'|123|'+(i+11)+'|'+f.sha256).slice(0,24)});
const fixture=f=>readFile(new URL('../fixtures/'+(f.format==='mp3'?'approved-single-mp3':'approved-remaining-eight')+'/'+f.name,import.meta.url));
test('all nine exact fixtures prepare a single staging-only request without credentials or admission',async()=>{
 for(const [i,f] of FIXTURES.entries()){const bytes=await fixture(f),r=prepareSourceProviderRequestComponent({runId:'123',claim:claim(f,i),format:f.format,bytes});const metadata=JSON.parse(Buffer.from(r.headers['x-cosmic-metadata'],'base64url'));assert.equal(r.url,PLAN.origin+'/api/transcribe');assert.equal(r.method,'POST');assert.equal(metadata.model,f.model);assert.equal(metadata.chunkCount,1);assert.equal(metadata.declaredBytes,f.bytes);assert.equal(metadata.durationSeconds,f.durationSeconds);assert.equal(metadata.attemptId,claim(f,i).attemptId);assert.equal(r.maximumMicroUsd,f.reservationMicroUsd);assert.equal(r.admission,false);assert.equal(r.automaticRetry,false);assert.deepEqual(Object.keys(r.headers).sort(),['content-type','x-cosmic-metadata']);bytes.fill(0);assert.equal(hash(r.body),f.sha256)}
});
test('unknown fixture, changed bytes and mismatched/doubled claims fail before request construction',async()=>{
 const f=FIXTURES[0],bytes=await fixture(f),c=claim(f,0);for(const patch of [{slot:12},{model:'unapproved-model'},{maximumMicroUsd:0},{attemptId:'attempt-forged'},{format:'wav'}])assert.throws(()=>prepareSourceProviderRequestComponent({runId:'123',claim:{...c,...patch},format:f.format,bytes}),{code:'provider_claim_mismatch'});
 assert.throws(()=>prepareSourceProviderRequestComponent({runId:'123',claim:c,format:f.format,bytes:Buffer.alloc(f.bytes)}),{code:'provider_fixture_changed'});assert.throws(()=>prepareSourceProviderRequestComponent({runId:'123',claim:c,format:'private-unapproved-audio',bytes}),{code:'provider_fixture_unknown'});
});
const parse=(body,extra={})=>parseSourceProviderResponseComponent({format:'mp3',httpStatus:200,contentType:'application/json',responseBytes:Buffer.from(JSON.stringify(body)),...extra});
test('speech acceptance emits only counts and request-ID presence, never transcript or provider identity',()=>{
 const privateText='Synthetic speech transcription contains useful recognizable words';const result=parse({ok:true,result:{text:privateText},diagnostics:{openaiRequestId:'synthetic-private-provider-id'},unapproved:'synthetic-private-token'});assert.equal(result.accepted,true);assert.equal(result.requestIdPresent,true);assert.equal(result.invoiceVerified,false);assert.equal(JSON.stringify(result).includes(privateText),false);assert.equal(JSON.stringify(result).includes('synthetic-private'),false);
 const diarized=parse({ok:true,result:{text:privateText,segments:[{speaker:'synthetic-speaker-a',text:'First speech segment',start:0,end:3},{speaker:'synthetic-speaker-b',text:'Second speech segment',start:3,end:8}]},diagnostics:{openaiRequestId:'synthetic-id'}},{format:'wav'});assert.equal(diarized.speakerCount,2);assert.equal(diarized.segmentCount,2);assert.equal(diarized.releaseReady,false);
});
test('missing IDs, malformed/HTML/oversized errors and all HTTP rejections retain uncertain billing',()=>{
 for(const result of [parse({ok:true,result:{text:'Meaningful synthetic spoken words'},diagnostics:{}}),parse({ok:true,result:{text:'x'},diagnostics:{openaiRequestId:'synthetic-id'}}),parse({ok:false,error:{message:'synthetic-private-key',details:{billingState:'not_dispatched'}}},{httpStatus:400}),parse({}, {httpStatus:302}),parse({}, {contentType:'application/jsonp'}),parse({}, {responseBytes:Buffer.from('<html>synthetic-private-key</html>')}),parse({}, {responseBytes:Buffer.alloc(131073)}),parse({}, {httpStatus:null})]){assert.equal(result.accepted,false);assert.equal(result.definitiveDenial,false);assert.equal(result.billingState,'uncertain');assert.equal(result.reservationReleased,false);assert.equal(result.automaticRetry,false);assert.equal(JSON.stringify(result).includes('synthetic-private-key'),false)}
});

const credentials=()=>({authHeader:'synthetic.access.assertion',byokCookie:'__Host-cosmic_byok='+'z'.repeat(80)});
const accepted=()=>new Response(JSON.stringify({ok:true,result:{text:'Synthetic speech contains several meaningful spoken words'},diagnostics:{openaiRequestId:'synthetic-request'}}),{headers:{'content-type':'application/json'}});
async function dispatchInput(){return {claim:claim(FIXTURES[0],0),fixture:FIXTURES[0],bytes:await fixture(FIXTURES[0])}}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('explicit transport sends fixed staging request once; throwing diagnostics cannot replay success',async()=>{
 let sends=0;const c=createSourceDispatchTransportComponent({runId:'123',getSessionHeaders:credentials,diagnostics:{record(){throw Error('synthetic-private-token')}},send:async(url,o)=>{sends++;assert.equal(url,PLAN.origin+'/api/transcribe');assert.equal(o.redirect,'manual');assert.equal(o.headers.Origin,PLAN.origin);assert.equal(o.headers['Cf-Access-Token'],'synthetic.access.assertion');assert.equal(hash(o.body),FIXTURES[0].sha256);return accepted()}});
 const input=await dispatchInput(),result=await c.dispatch(input);assert.equal(result.accepted,true);await assert.rejects(c.dispatch(input),{code:'provider_transport_duplicate'});assert.equal(sends,1);assert.equal(c.snapshot().admission,false);assert.equal(JSON.stringify(result).includes('synthetic-request'),false);
});

test('credential timeout prevents late dispatch and concurrent or later attempts',async()=>{
 let release,sends=0;const c=createSourceDispatchTransportComponent({runId:'123',timeoutMs:15,getSessionHeaders:()=>new Promise(resolve=>release=resolve),send:async()=>{sends++;return accepted()}}),input=await dispatchInput(),pending=c.dispatch(input);
 await assert.rejects(c.dispatch(input),{code:'provider_transport_stopped'});const result=await pending;assert.equal(result.code,'provider_transport_timeout');assert.equal(result.transportInvoked,false);release(credentials());await pause(20);assert.equal(sends,0);await assert.rejects(c.dispatch(input),{code:'provider_transport_stopped'});
});

test('redirect, HTML, interrupted/oversized response and thrown transport are uncertain and terminal',async()=>{
 const factories=[()=>new Response(null,{status:302}),()=>new Response('<html>synthetic-private-token</html>',{headers:{'content-type':'text/html'}}),()=>new Response('x',{headers:{'content-type':'application/json','content-length':'131073'}}),()=>new Response(new ReadableStream({start(c){c.error(Error('synthetic-private-token'))}}),{headers:{'content-type':'application/json'}}),()=>new Response(Buffer.alloc(131073),{headers:{'content-type':'application/json'}}),()=>{throw Error('synthetic-private-token')}];
 for(const make of factories){let sends=0;const events=[],c=createSourceDispatchTransportComponent({runId:'123',getSessionHeaders:credentials,diagnostics:{record:e=>events.push(e)},send:async()=>{sends++;return make()}}),input=await dispatchInput(),r=await c.dispatch(input);assert.equal(r.accepted,false);assert.equal(r.billingState,'uncertain');assert.equal(r.reservationReleased,false);assert.equal(r.transportInvoked,true);await assert.rejects(c.dispatch(input));assert.equal(sends,1);assert.equal(JSON.stringify([r,events]).includes('synthetic-private-token'),false)}
});

test('malformed headers fail before send; stalled response and late send resolution never replay',async()=>{
 let sends=0;const bad=createSourceDispatchTransportComponent({runId:'123',getSessionHeaders:()=>({...credentials(),accessCookie:'CF_Authorization=synthetic.access.assertion'}),send:async()=>{sends++;return accepted()}});assert.equal((await bad.dispatch(await dispatchInput())).transportInvoked,false);assert.equal(sends,0);
 for(const stalled of [true,false]){let release;const c=createSourceDispatchTransportComponent({runId:'123',timeoutMs:15,getSessionHeaders:credentials,send:async()=>{sends++;return stalled?new Response(new ReadableStream({pull(){return new Promise(()=>{})}}),{headers:{'content-type':'application/json'}}):new Promise(resolve=>release=resolve)}});const r=await c.dispatch(await dispatchInput());assert.equal(r.code,'provider_transport_timeout');assert.equal(r.transportInvoked,true);release?.(accepted());await pause(15);assert.equal(c.snapshot().stopped,true)}assert.equal(sends,2);
});

test('transport uncertainty is durably recorded before stop; restart cannot reclaim acknowledged journal',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cosmic-provider-component-'));try{
  const engine=createJournalEngine();await engine.createLocalReservation(root,proposal({paidRequests:10,reservedMicroUsd:220500,completedRun:40413365240}),'123',1);
  await engine.bindRemotePersistence(root,{artifact:{repository:'sohweiyu2023/CosmicTranscriberWeb',runId:'123',id:456,name:'source-verification-reservation-'+PLAN.campaign,expired:false,digest:'sha256:'+'d'.repeat(64)},archiveSha256:'d'.repeat(64),files:{'admission.json':await readFile(path.join(root,'admission.json'))}});
  const descriptor=await engine.claimSlot(root,11);assert.equal(JSON.parse(await readFile(path.join(root,'slot-11-intent.json'),'utf8')).attemptId,descriptor.attemptId);
  let sends=0;const c=createSourceDispatchTransportComponent({runId:'123',getSessionHeaders:credentials,send:async()=>{sends++;throw Error('synthetic-private-token')}}),r=await c.dispatch({claim:descriptor,fixture:FIXTURES[0],bytes:await fixture(FIXTURES[0])});
  await engine.recordOutcome(root,11,{status:r.accepted?'success':'uncertain',requestIdPresent:r.requestIdPresent});
  const onDisk=JSON.parse(await readFile(path.join(root,'slot-11-outcome.json'),'utf8'));assert.equal(onDisk.status,'uncertain');assert.equal(JSON.stringify(onDisk).includes('synthetic-private-token'),false);
  const summary=await engine.summarizeJournal(root);assert.equal(summary.reservedRequests,19);assert.equal(summary.reservedMicroUsd,436500);assert.equal(summary.stopped,true);await assert.rejects(engine.claimSlot(root,12));await assert.rejects(createJournalEngine().claimSlot(root,11));assert.equal(sends,1);
 }finally{await rm(root,{recursive:true,force:true})}
});
