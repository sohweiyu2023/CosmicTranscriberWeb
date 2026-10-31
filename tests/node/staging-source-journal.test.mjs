import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {PLAN,proposal,admitExecution} from '../../scripts/staging-source-admission.mjs';
import {writeExclusiveSynced,createJournalEngine,createLocalReservation,bindRemotePersistence,claimSlot,recordOutcome,summarizeJournal} from '../../scripts/staging-source-journal.mjs';
import {safeDiagnosticField} from '../../public/js/diagnostic-policy.js';
const prior={paidRequests:10,reservedMicroUsd:220500,completedRun:40413365240};
async function directory(t){
 const base=await fs.realpath(tmpdir()),d=await fs.mkdtemp(path.join(base,'cosmic-admission-journal-'));
 t.after(async()=>{const resolved=await fs.realpath(d),relative=path.relative(base,resolved);
  assert.ok(relative.startsWith('cosmic-admission-journal-')&&!relative.includes(path.sep)&&!relative.startsWith('..')&&resolved!==base);
  await fs.rm(resolved,{recursive:true,force:true});});return d;
}
async function prepare(t){const d=await directory(t);await createLocalReservation(d,proposal(prior),'9001',1);return d;}
async function syntheticWitness(d){return {artifact:{repository:'sohweiyu2023/CosmicTranscriberWeb',runId:'9001',id:123,
 name:'source-verification-reservation-'+PLAN.campaign,expired:false,digest:'sha256:'+'d'.repeat(64)},archiveSha256:'d'.repeat(64),
 files:{'admission.json':await fs.readFile(path.join(d,'admission.json'))}};}
async function bound(t){const d=await prepare(t);await bindRemotePersistence(d,await syntheticWitness(d));return d;}

test('exclusive journal writer fsyncs before completion and closes on all paths',async()=>{
 for(const failure of [null,'write','sync']){
  const events=[];const opener=async(_target,flags,mode)=>{assert.equal(flags,'wx');assert.equal(mode,0o600);return {
   writeFile:async()=>{events.push('write');if(failure==='write')throw Error('synthetic write failure');},
   sync:async()=>{events.push('sync');if(failure==='sync')throw Error('synthetic sync failure');},close:async()=>{events.push('close');}};};
  if(failure)await assert.rejects(writeExclusiveSynced('synthetic',Buffer.from('safe'),opener));else await writeExclusiveSynced('synthetic',Buffer.from('safe'),opener);
  assert.deepEqual(events,failure==='write'?['write','close']:['write','sync','close']);
 }
});
test('local reservation preserves entire prior ledger and all nine conservative intents',async t=>{
 const d=await prepare(t),a=JSON.parse(await fs.readFile(path.join(d,'admission.json'),'utf8'));
 assert.equal(a.priorRequests,10);assert.equal(a.reservedRequests,19);assert.equal(a.reservedMicroUsd,436500);assert.equal(a.ownerCeilingMicroUsd,2000000);
 assert.equal(a.slots.length,9);assert.equal(a.slots.reduce((n,s)=>n+s.maximumMicroUsd,0),216000);
 assert.equal(a.automaticRetries,0);assert.ok(a.slots.every(s=>s.state==='RESERVED_NO_EXECUTION_PROOF'));
 await assert.rejects(claimSlot(d,11));
});
for(const [name,patch]of Object.entries({requestReset:{previousRequests:0},extraRequest:{additionalRequests:10},capIncrease:{ownerCeilingMicroUsd:3000000},underReserve:{maximumMicroUsd:220500},retry:{automaticRetries:1},falseCertification:{releaseReady:true}})){
 test('reservation rejects '+name+' before any ownership write',async t=>{
  const d=await directory(t);await assert.rejects(createLocalReservation(d,{...proposal(prior),...patch},'9001',1));assert.deepEqual(await fs.readdir(d),[]);
 });
}
test('attempt2 and duplicate cross-run claim cannot replace existing reservation',async t=>{
 const d=await directory(t);await assert.rejects(createLocalReservation(d,proposal(prior),'9001',2));assert.deepEqual(await fs.readdir(d),[]);
 await createLocalReservation(d,proposal(prior),'9001',1);const before=await fs.readFile(path.join(d,'admission.json'));
 await assert.rejects(createLocalReservation(d,proposal(prior),'9002',1));assert.deepEqual(await fs.readFile(path.join(d,'admission.json')),before);
});
test('incomplete local reservation remains owned and cannot be silently retried',async t=>{
 const d=await directory(t);await fs.mkdir(path.join(d,'admission.json'));
 await assert.rejects(createLocalReservation(d,proposal(prior),'9001',1));
 assert.ok((await fs.readdir(d)).includes('campaign.lock'));
 await assert.rejects(createLocalReservation(d,proposal(prior),'9001',1));
});
for(const name of ['wrongOwner','wrongRun','expired','wrongName','wrongDigest','extraEntry','changedContent']){
 test('remote persistence receipt rejects '+name,async t=>{
  const d=await prepare(t),proof=await syntheticWitness(d);
  if(name==='wrongOwner')proof.artifact.repository='other/repo';if(name==='wrongRun')proof.artifact.runId='9002';
  if(name==='expired')proof.artifact.expired=true;if(name==='wrongName')proof.artifact.name='other';
  if(name==='wrongDigest')proof.artifact.digest='sha256:'+'e'.repeat(64);
  if(name==='extraEntry')proof.files.extra=Buffer.from('unexpected');if(name==='changedContent')proof.files['admission.json']=Buffer.from('{}');
  await assert.rejects(bindRemotePersistence(d,proof));await assert.rejects(claimSlot(d,11));
 });
}
test('synthetic exact persistence witness can bind once but is not a live admission',async t=>{
 const d=await bound(t);await assert.rejects(bindRemotePersistence(d,await syntheticWitness(d)));
 assert.throws(()=>admitExecution({directory:d,ready:true}),e=>e.code==='execution_evidence_unpinned');
});
test('intent is on disk before descriptor; duplicate slot never sends again',async t=>{
 const d=await bound(t),descriptor=await claimSlot(d,11);
 const intent=JSON.parse(await fs.readFile(path.join(d,'slot-11-intent.json'),'utf8'));
 assert.equal(intent.attemptId,descriptor.attemptId);assert.equal(intent.state,'DISPATCH_INTENT_PERSISTED_OUTCOME_UNKNOWN');
 let mockSends=0;await assert.rejects((async()=>{await claimSlot(d,11);mockSends++;})());assert.equal(mockSends,0);
 await assert.rejects(claimSlot(d,12));
});
test('intent write failure prevents a sender from being reached',async t=>{
 const d=await bound(t);await fs.mkdir(path.join(d,'slot-11-intent.json'));let mockSends=0;
 await assert.rejects((async()=>{await claimSlot(d,11);mockSends++;})());assert.equal(mockSends,0);
});
for(const status of ['denied','uncertain']){
 test(status+' keeps full reservation, stops batch and denies replay',async t=>{
  const d=await bound(t);await claimSlot(d,11);const outcome=await recordOutcome(d,11,{status});
  assert.equal(outcome.reservationReleased,false);assert.equal(outcome.automaticRetry,false);
  await assert.rejects(claimSlot(d,11));await assert.rejects(claimSlot(d,12));
  const summary=await summarizeJournal(d);assert.equal(summary.reservedRequests,19);assert.equal(summary.reservedMicroUsd,436500);assert.equal(summary.stopped,true);
 });
}
test('missing outcome or unacknowledged intent is uncertain rather than a free slot',async t=>{
 const d=await bound(t);await claimSlot(d,11);await assert.rejects(claimSlot(d,12));
 const summary=await summarizeJournal(d);assert.equal(summary.observedOutcomes,0);assert.equal(summary.unresolvedOrUnusedSlots,9);assert.equal(summary.reservationReleased,false);
});
test('outcome persistence failure cannot enable the next slot or a retry',async t=>{
 const d=await bound(t);await claimSlot(d,11);await fs.mkdir(path.join(d,'slot-11-outcome.json'));
 await assert.rejects(recordOutcome(d,11,{status:'success',requestIdPresent:true}));await assert.rejects(claimSlot(d,12));await assert.rejects(claimSlot(d,11));
});
test('success requires provider request-id presence and outcome fields are bounded',async t=>{
 const invalid=await bound(t);await claimSlot(invalid,11);await assert.rejects(recordOutcome(invalid,11,{status:'success'}));
 await assert.rejects(claimSlot(invalid,12));
 const d=await bound(t);await claimSlot(d,11);
 await recordOutcome(d,11,{status:'success',requestIdPresent:true,token:'fake-private-value',transcript:'fake transcript'});
 const raw=await fs.readFile(path.join(d,'slot-11-outcome.json'),'utf8');assert.equal(raw.includes('fake-private-value'),false);assert.equal(raw.includes('fake transcript'),false);
 await assert.rejects(recordOutcome(d,11,{status:'uncertain'}));
});
function failingOpener(suffix,failure){return async(target,...options)=>{
 const h=await fs.open(target,...options),hit=String(target).endsWith(suffix);
 return {writeFile:async data=>h.writeFile(data),sync:async()=>{if(hit&&failure==='sync')throw Error('synthetic post-write sync failure');return h.sync();},
  close:async()=>{await h.close();if(hit&&failure==='close')throw Error('synthetic post-write close failure');}};
};}
async function engineBound(t,engine){const d=await directory(t);await engine.createLocalReservation(d,proposal(prior),'9001',1);await engine.bindRemotePersistence(d,await syntheticWitness(d));return d;}
for(const failure of ['sync','close']){
 test('parseable success after '+failure+' failure cannot progress or count as committed',async t=>{
  const e=createJournalEngine({openFile:failingOpener('slot-11-outcome.json',failure)}),d=await engineBound(t,e);await e.claimSlot(d,11);
  await assert.rejects(e.recordOutcome(d,11,{status:'success',requestIdPresent:true}));
  assert.equal(JSON.parse(await fs.readFile(path.join(d,'slot-11-outcome.json'),'utf8')).status,'success');
  await assert.rejects(e.claimSlot(d,12));await assert.rejects(e.claimSlot(d,11));
  const summary=await e.summarizeJournal(d);assert.equal(summary.successes,0);assert.equal(summary.stopped,true);assert.equal(summary.reservedMicroUsd,436500);
 });
 test('parseable remote witness after '+failure+' failure never acknowledges durability',async t=>{
  const e=createJournalEngine({openFile:failingOpener('remote-witness.json',failure)}),d=await directory(t);
  await e.createLocalReservation(d,proposal(prior),'9001',1);await assert.rejects(e.bindRemotePersistence(d,await syntheticWitness(d)));
  assert.equal(JSON.parse(await fs.readFile(path.join(d,'remote-witness.json'),'utf8')).runId,'9001');await assert.rejects(e.claimSlot(d,11));
 });
 test('parseable reservation after '+failure+' failure cannot be adopted',async t=>{
  const e=createJournalEngine({openFile:failingOpener('admission.json',failure)}),d=await directory(t);
  await assert.rejects(e.createLocalReservation(d,proposal(prior),'9001',1));
  assert.equal(JSON.parse(await fs.readFile(path.join(d,'admission.json'),'utf8')).reservedRequests,19);
  await assert.rejects(e.bindRemotePersistence(d,await syntheticWitness(d)));await assert.rejects(e.claimSlot(d,11));
 });
}
test('new engine/process cannot adopt parseable journal or restore acknowledgments',async t=>{
 const first=createJournalEngine(),d=await engineBound(t,first);await first.claimSlot(d,11);await first.recordOutcome(d,11,{status:'success',requestIdPresent:true});
 const restarted=createJournalEngine();await assert.rejects(restarted.bindRemotePersistence(d,await syntheticWitness(d)));await assert.rejects(restarted.claimSlot(d,12));
});
test('concurrent failed outcome and next claim serialize without returning a descriptor',async t=>{
 const e=createJournalEngine({openFile:failingOpener('slot-11-outcome.json','sync')}),d=await engineBound(t,e);await e.claimSlot(d,11);
 const result=await Promise.allSettled([e.recordOutcome(d,11,{status:'success',requestIdPresent:true}),e.claimSlot(d,12)]);
 assert.ok(result.every(r=>r.status==='rejected'));assert.equal((await e.summarizeJournal(d)).successes,0);
});
test('concurrent duplicate claims cannot return two descriptors',async t=>{
 const e=createJournalEngine(),d=await engineBound(t,e);const results=await Promise.allSettled([e.claimSlot(d,11),e.claimSlot(d,11)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 await assert.rejects(e.claimSlot(d,12));
});
test('deterministic attempt correlation survives the pinned diagnostic grammar',async t=>{
 const d=await bound(t),descriptor=await claimSlot(d,11);
 assert.equal(safeDiagnosticField('attemptId',descriptor.attemptId),descriptor.attemptId);assert.match(descriptor.attemptId,/^attempt-[a-f0-9]{24}$/);
});
test('altered reservation, witness, intent and outcome all fail closed',async t=>{
 for(const kind of ['reservation','witness','intent','outcome']){
  const d=await bound(t);await claimSlot(d,11);
  const name={reservation:'admission.json',witness:'remote-witness.json',intent:'slot-11-intent.json',outcome:'slot-11-outcome.json'}[kind];
  let content=kind==='outcome'?{status:'success'}:JSON.parse(await fs.readFile(path.join(d,name),'utf8'));
  if(kind==='reservation')content.reservedMicroUsd=1;if(kind==='witness')content.admissionSha256='0'.repeat(64);if(kind==='intent')content.model='another-model';
  await fs.writeFile(path.join(d,name),JSON.stringify(content));
  if(kind==='intent')await assert.rejects(recordOutcome(d,11,{status:'success',requestIdPresent:true}));else await assert.rejects(claimSlot(d,12));
 }
});
test('exact nine synthetic successes exhaust slots without claiming certification',async t=>{
 const d=await bound(t);for(let slot=11;slot<=19;slot++){await claimSlot(d,slot);await recordOutcome(d,slot,{status:'success',requestIdPresent:true});}
 await assert.rejects(claimSlot(d,20));await assert.rejects(claimSlot(d,10));
 const summary=await summarizeJournal(d);assert.equal(summary.successes,9);assert.equal(summary.unresolvedOrUnusedSlots,0);
 assert.equal(summary.reservedMicroUsd,436500);assert.equal(summary.reservationReleased,false);assert.equal(summary.fullAcceptance,false);assert.equal(summary.releaseReady,false);assert.equal(summary.genuineMacSafariValidated,false);
});
