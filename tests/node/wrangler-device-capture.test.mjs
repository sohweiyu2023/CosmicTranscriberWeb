import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceFlowCapture,observeReviewedDeviceProcessComponent} from '../../scripts/wrangler-device-capture.mjs';
import {EventEmitter} from 'node:events';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createToolDiagnostics} from '../../scripts/tooling-diagnostics.mjs';
const code='SYN1-TST2',start=Date.parse('2026-10-31T00:00:00Z');
const handoff=(url='https://dash.cloudflare.com/oauth2/device/verify',window='5 minutes')=>`To authorize Wrangler, please visit:\n\n ${url}\n\n and enter the code:\n\n ${code}\n\n You have ${window} to approve this request.\n`;

test('pre-device error taxonomy distinguishes transport, command, storage, OAuth and URL refusal safely',async()=>{
 const cases=[['ERROR getaddrinfo EAI_AGAIN synthetic-private-host','dns_resolution','dns_failure'],['ERROR UNABLE_TO_GET_ISSUER_CERT_LOCALLY synthetic-private-host','certificate_validation','tls_failure'],['ERROR proxy authentication required CONNECT 407','proxy_transport','network_failure'],['ERROR UND_ERR_CONNECT_TIMEOUT','connection_transport','network_failure'],['ERROR Unknown argument: synthetic-private-option','unsupported_command','invocation_scope_rejected'],['ERROR @napi-rs/keyring unavailable','keyring_storage','secure_storage_unavailable'],['ERROR invalid_request','oauth_request','invocation_scope_rejected'],['ERROR temporarily_unavailable','oauth_service','network_failure'],['ERROR invalid_grant','oauth_rejected','authorization_rejected'],['ERROR authorization server returned an untrusted verification_uri https://evil.example/?token=synthetic-private-token','untrusted_verification','authorization_rejected'],['ERROR invalid_json','malformed_oauth_response','malformed_response']];
 for(const [text,cause,category] of cases){const c=createDeviceFlowCapture();c.feed('stderr',text+'\n');const r=await c.finish({exitCode:1});assert.equal(r.errorCategory,category);assert.equal(r.failureEvidence[0].cause,cause);assert.equal(r.failureEvidenceComplete,true);assert.equal(r.phase,'failed-before-handoff');const serialized=JSON.stringify(r);for(const secret of ['synthetic-private','https://','evil.example'])assert.equal(serialized.includes(secret),false);assert.equal(r.handedOff,false)}
});

test('unmatched error retains bounded redacted vocabulary with explicit incompleteness, never arbitrary payload',async()=>{
 const c=createDeviceFlowCapture();for(let i=0;i<12;i++)c.feed('stderr','ERROR unable to parse response novelFailure synthetic-private-token ABCD-EFGH https://dash.cloudflare.com/callback?code=private 123456\n');
 const r=await c.finish({exitCode:1});assert.equal(r.errorCategory,'unknown');assert.equal(r.unclassifiedErrors,12);assert.equal(r.failureEvidence.length,8);assert.equal(r.droppedFailureEvidence,4);assert.equal(r.failureEvidenceComplete,false);assert.match(r.failureEvidence[0].messageTemplate,/unable \[redacted\] parse response/);assert.ok(r.failureEvidence.every(e=>e.messageTemplate.split(' ').length<=24));for(const secret of ['novelFailure','synthetic-private','ABCD-EFGH','https://','123456'])assert.equal(JSON.stringify(r).includes(secret),false);assert.equal(r.automaticRetry,false);
});

test('plain existing rejection signals survive and silent failed exits cannot claim complete evidence',async()=>{
 for(const [text,category] of [['Forbidden','authorization_rejected'],['expired_token','auth_device_expired']]){const c=createDeviceFlowCapture();c.feed('stderr',text+'\n');const r=await c.finish({exitCode:1});assert.equal(r.errorCategory,category);assert.equal(r.failureEvidence.length,1);assert.equal(r.failureEvidence[0].category,category);assert.equal(r.failureEvidenceComplete,true)}
 for(const exitCode of [1,null,0]){const c=createDeviceFlowCapture(),r=await c.finish({exitCode});assert.equal(r.failureEvidence.length,0);assert.equal(r.failureEvidenceComplete,false);assert.equal(r.renewalVerified,false)}
});
test('only a verified ordered current handoff can be retrieved once, never in diagnostics',async()=>{
 const c=createDeviceFlowCapture({now:()=>start});const text=handoff();for(let i=0;i<text.length;i+=3)c.feed('stdout',text.slice(i,i+3));const h=c.takeHandoff();assert.equal(h.userCode,code);assert.equal(h.verificationUri,'https://dash.cloudflare.com/oauth2/device/verify');assert.equal(h.conservativeDeadlineUtc,'2026-10-31T00:04:55.000Z');assert.equal(h.exactServerExpiryVerified,false);assert.equal(c.takeHandoff(),null);const result=await c.finish({exitCode:0});assert.equal(result.renewalVerified,false);assert.equal(result.requiresReconciliation,true);assert.equal(JSON.stringify(result).includes(code),false);assert.equal(JSON.stringify(result).includes('https://'),false);
});
test('invalid origins, query credentials, malformed codes/windows and expiry never yield a handoff',async()=>{
 for(const text of [handoff('https://evil.example/oauth2/device/verify'),handoff('https://dash.cloudflare.com.evil.example/oauth2/device/verify'),handoff('https://dash.cloudflare.com/oauth2/device/verify?private=secret'),handoff().replace(code,'synthetic-private-code'),handoff(undefined,'6 minutes'),handoff().split('\n').reverse().join('\n')]){const c=createDeviceFlowCapture({now:()=>start});c.feed('stdout',text);assert.equal(c.takeHandoff(),null);const result=await c.finish({exitCode:1});assert.equal(JSON.stringify(result).includes('secret'),false)}
 let at=start;const c=createDeviceFlowCapture({now:()=>at});c.feed('stdout',handoff(undefined,'1 minute and 59 seconds'));at+=115000;assert.equal(c.takeHandoff(),null);assert.equal((await c.finish({exitCode:1})).errorCategory,'auth_device_expired');
});
test('known rejection causes, numeric HTTPstatus and unrecognized errors survive without payloads',async()=>{
 for(const [text,category,status] of [['ERROR invalid_scope synthetic-private-body','invocation_scope_rejected',null],['ERROR HTTP 401 Unauthorized synthetic-private-body','authorization_rejected',401],['ERROR keyring unavailable synthetic-private-body','secure_storage_unavailable',null],['ERROR novel diagnostic synthetic-private-body','unknown',null]]){const c=createDeviceFlowCapture();c.feed('stderr',text);const r=await c.finish({exitCode:1});assert.equal(r.errorCategory,category);assert.equal(r.errorLines,1);assert.equal(r.unclassifiedErrors,category==='unknown'?1:0);assert.equal(r.support.events.at(-1).httpStatus,status);assert.equal(JSON.stringify(r).includes('synthetic-private-body'),false);assert.equal(r.phase,'failed-before-handoff');assert.equal(r.automaticRetry,false)}
});
test('timeout, cancellation, logger failure and oversized output remain bounded and uncertain',async()=>{
 for(const reason of [{timedOut:true},{cancelled:true}]){const log=createToolDiagnostics({sink:()=>{throw Error('synthetic-private-logger')}}),c=createDeviceFlowCapture({diagnostics:log});c.feed('stderr','synthetic-private-body'.repeat(10000));const r=await c.finish({exitCode:1,...reason});assert.equal(r.requiresReconciliation,true);assert.equal(r.support.summary.complete,false);assert.equal(r.support.events.at(-1).stderr.truncated,true);assert.equal(JSON.stringify(r).includes('synthetic-private'),false)}
});

test('later rejection, expiry, unknown errors or completion invalidate a ready code immediately',async()=>{
 for(const message of ['ERROR access_denied','expired_token','ERROR synthetic-private-unrecognized','Successfully logged in']){const c=createDeviceFlowCapture({now:()=>start});c.feed('stdout',handoff());c.feed('stderr',message+'\n');assert.equal(c.takeHandoff(),null);c.feed('stdout',handoff());assert.equal(c.takeHandoff(),null);const r=await c.finish({exitCode:1});assert.equal(r.handedOff,false);assert.equal(JSON.stringify(r).includes(code),false);assert.equal(r.requiresReconciliation,true)}
});

test('oversized physical lines cannot turn a remaining suffix into a fresh handoff',async()=>{
 const c=createDeviceFlowCapture({now:()=>start});c.feed('stdout','x'.repeat(3072));c.feed('stdout',handoff());assert.equal(c.takeHandoff(),null);c.feed('stdout','\n'+handoff());assert.equal(c.takeHandoff(),null);const r=await c.finish({exitCode:1});assert.equal(r.errorCategory,'output_oversized');assert.equal(r.handedOff,false);assert.equal(JSON.stringify(r).includes(code),false);
});
function fakeProcess(action){const c=new EventEmitter();c.pid=123;c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.finish=code=>{c.emit('exit',code,null);c.emit('close')};c.kill=()=>{queueMicrotask(()=>c.finish(1));return true};queueMicrotask(()=>action(c));return c}
test('reviewed process bridge preserves causes and confines the code to a single ephemeral sink',async()=>{
 let delivered=0,statusReads=0,signal;const result=await observeReviewedDeviceProcessComponent({diagnostics:createToolDiagnostics(),startReviewedProcess:()=>fakeProcess(c=>{c.stdout.emit('data',Buffer.from(handoff()));c.stdout.emit('data',Buffer.from('Successfully logged in\n'));c.finish(0)}),onHandoff:(h,context)=>{assert.equal(h.userCode,code);assert.equal(h.verificationUri,'https://dash.cloudflare.com/oauth2/device/verify');delivered++;signal=context.signal},readOnlyStatus:async()=>{statusReads++;return {status:'success',expectedAccountMatched:true,errorCategory:'none',private:'synthetic-private-token'}}});assert.equal(delivered,1);assert.equal(statusReads,1);assert.equal(signal.aborted,true);assert.equal(result.renewalVerified,true);assert.equal(result.admission,false);assert.equal(result.providerRequests,0);assert.equal(JSON.stringify(result).includes(code),false);assert.equal(JSON.stringify(result).includes('synthetic-private-token'),false);
});
test('bridge cannot start without explicit ports and never replays errors or failed handoff delivery',async()=>{
 let starts=0;const missing=await observeReviewedDeviceProcessComponent({diagnostics:createToolDiagnostics(),startReviewedProcess:()=>{starts++}});assert.equal(missing.status,'blocked');assert.equal(starts,0);
 const result=await observeReviewedDeviceProcessComponent({diagnostics:createToolDiagnostics(),startReviewedProcess:()=>{starts++;return fakeProcess(c=>{c.stdout.emit('data',Buffer.from(handoff()));c.stderr.emit('data',Buffer.from('ERROR HTTP 401 synthetic-private-body\n'));c.finish(1)})},onHandoff:()=>{throw Error('synthetic-private-handoff')},readOnlyStatus:async()=>{throw Error('synthetic-private-status')}});assert.equal(starts,1);assert.equal(result.errorCategory,'authorization_rejected');assert.equal(result.handoffDelivery,'unknown');assert.equal(result.requiresReconciliation,true);assert.equal(result.automaticRetry,false);assert.equal(result.capture.support.events.some(e=>e.httpStatus===401),true);assert.equal(JSON.stringify(result).includes('synthetic-private'),false);
});

test('a stuck read-only status port is bounded, aborted and cannot certify renewal',async()=>{
 let statusSignal;const r=await observeReviewedDeviceProcessComponent({diagnostics:createToolDiagnostics(),startReviewedProcess:()=>fakeProcess(c=>{c.stdout.emit('data',Buffer.from('Successfully logged in\n'));c.finish(0)}),onHandoff:()=>{},readOnlyStatus:({signal})=>{statusSignal=signal;return new Promise(()=>{})},statusTimeoutMs:10});assert.equal(statusSignal.aborted,true);assert.equal(r.statusVerificationTimedOut,true);assert.equal(r.statusCause,'timeout');assert.equal(r.renewalVerified,false);assert.equal(r.requiresReconciliation,true);assert.equal(r.automaticRetry,false);
});

test('handoff is aborted immediately on child exit while pipe cleanup is still pending',async()=>{
 let handedSignal;const pending=observeReviewedDeviceProcessComponent({diagnostics:createToolDiagnostics(),startReviewedProcess:()=>fakeProcess(c=>{c.kill=()=>true;c.stdout.emit('data',Buffer.from(handoff()));c.emit('exit',0,null)}),onHandoff:(_h,{signal})=>{handedSignal=signal;return new Promise(()=>{})},readOnlyStatus:async()=>({status:'success',expectedAccountMatched:true,errorCategory:'none'}),timeoutMs:15});await new Promise(resolve=>setTimeout(resolve,25));assert.equal(handedSignal.aborted,true);const r=await pending;assert.equal(r.handoffDelivery,'pending');assert.equal(r.renewalVerified,false);assert.equal(r.requiresReconciliation,true);assert.equal(r.automaticRetry,false);
});

test('recognized failure is persisted safely before the child finishes or reconciliation runs',async()=>{
 const directory=await fs.mkdtemp(path.join(tmpdir(),'cosmic-auth-capture-test-'));const log=createToolDiagnostics({component:'wrangler-auth',directory});let owned,pending;try{
  pending=observeReviewedDeviceProcessComponent({diagnostics:log,startReviewedProcess:()=>fakeProcess(c=>{owned=c;c.stderr.emit('data',Buffer.from('ERROR HTTP 401 synthetic-private-key-body\n'))}),onHandoff:()=>{},readOnlyStatus:async()=>({status:'failure',expectedAccountMatched:false,errorCategory:'auth_not_authenticated'})});
  await new Promise(resolve=>setTimeout(resolve,5));await log.flush();const before=await fs.readFile(path.join(directory,'operations-0.jsonl'),'utf8');assert.match(before,/authorization_rejected/);assert.match(before,/"httpStatus":401/);assert.equal(before.includes('synthetic-private-key-body'),false);owned.finish(1);const result=await pending;assert.equal(result.errorCategory,'authorization_rejected');assert.equal(result.renewalVerified,false);
 }finally{owned?.finish(1);if(pending)await pending;await log.flush();await fs.rm(directory,{recursive:true,force:true})}
});


test('installed Wrangler public DNS template is recognized without raw stderr or broad unable matching',async()=>{
 for(const apostrophe of ["'",'’']){const c=createDeviceFlowCapture({now:()=>start});c.feed('stdout',handoff());c.feed('stderr',"\u001b[31mUnable to resolve Cloudflare"+apostrophe+"s API hostname (api.cloudflare.com or dash.cloudflare.com).\u001b[0m synthetic-private-token https://example.invalid/callback?code=private\n");assert.equal(c.takeHandoff(),null);const r=await c.finish({exitCode:1});assert.equal(r.errorCategory,'dns_failure');assert.equal(r.failureEvidence[0].cause,'dns_resolution');assert.equal(r.failureEvidenceComplete,true);assert.equal(r.phase,'failed-before-handoff');assert.equal(r.renewalVerified,false);assert.equal(r.automaticRetry,false);for(const secret of ['synthetic-private','https://','api.cloudflare.com','dash.cloudflare.com'])assert.equal(JSON.stringify(r).includes(secret),false)}
 const other=createDeviceFlowCapture();other.feed('stderr','ERROR Unable to find a package manager.\n');const r=await other.finish({exitCode:1});assert.equal(r.errorCategory,'unknown');assert.equal(r.failureEvidenceComplete,false);
});
