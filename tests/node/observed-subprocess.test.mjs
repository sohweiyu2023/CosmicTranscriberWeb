import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {runObservedCommand} from '../../scripts/observed-subprocess.mjs';
import {createToolDiagnostics} from '../../scripts/tooling-diagnostics.mjs';
function child(action){const c=new EventEmitter();c.pid=123;c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kills=[];c.done=false;c.finish=(code=0)=>{if(c.done)return;c.done=true;c.emit('exit',code,null);c.emit('close')};c.kill=s=>{c.kills.push(s);queueMicrotask(()=>c.finish(1));return true};queueMicrotask(()=>action(c));return c}
const invoke=(action,extra={})=>runObservedCommand({commandId:'wrangler-whoami',file:'synthetic-executable',args:['synthetic-private-argument'],spawnImpl:(_file,_args,options)=>{assert.equal(options.shell,false);return child(action)},...extra});
test('non-authenticated CLI exit zero survives safely as logical failure without raw output',async()=>{
 const secret='synthetic-cookie-and-key';const log=createToolDiagnostics({component:'wrangler-auth'});const result=await invoke(c=>{c.stdout.emit('data',Buffer.from('You are not authenticated. '+secret));c.finish(0)},{diagnostics:log});assert.equal(result.exitCode,0);assert.equal(result.errorCategory,'auth_not_authenticated');assert.equal(result.status,'failure');assert.equal(result.automaticRetry,false);assert.equal(JSON.stringify(await log.exportSupport()).includes(secret),false);
});
test('auth rejection, expiry, dependency and transport failures retain finite causes only',async()=>{
 for(const [message,expected] of [['Invalid authentication scope: secret','invocation_scope_rejected'],['expired_token secret','auth_device_expired'],['access_denied secret','auth_consent_denied'],['keyring unavailable secret','secure_storage_unavailable'],['HTTP 403 secret','authorization_rejected'],['ENOTFOUND secret','dns_failure'],['MODULE_NOT_FOUND secret','dependency_missing'],['fetch failed secret','network_failure']]){const result=await invoke(c=>{c.stderr.emit('data',Buffer.from(message));c.finish(1)});assert.equal(result.errorCategory,expected);assert.equal(JSON.stringify(result).includes(' secret'),false)}
});
test('device auth always requires independent status reconciliation and never persists URL/code',async()=>{
 const log=createToolDiagnostics({component:'wrangler-auth'});const result=await invoke(c=>{c.stdout.emit('data',Buffer.from('To authorize https://dash.cloudflare.com/oauth2/device/verify?synthetic-private-token=secret and enter the code: SYNTHETIC-CODE expired_token'));c.finish(1)},{commandId:'wrangler-device-login',diagnostics:log});assert.equal(result.requiresReconciliation,true);const exported=JSON.stringify(await log.exportSupport());assert.equal(exported.includes('https://'),false);assert.equal(exported.includes('SYNTHETIC-CODE'),false);assert.equal(exported.includes('synthetic-private-token'),false);
});
test('timeout and cancellation terminate only owned fake child and never retry',async()=>{
 let timed;const result=await invoke(c=>{timed=c},{timeoutMs:15});assert.equal(result.status,'timeout');assert.ok(timed.kills.includes('SIGTERM'));assert.equal(result.automaticRetry,false);
 const a=new AbortController();let cancelled;const cancelledResult=await invoke(c=>{cancelled=c;a.abort()},{signal:a.signal,commandId:'wrangler-device-login'});assert.equal(cancelledResult.status,'cancelled');assert.equal(cancelledResult.requiresReconciliation,true);assert.ok(cancelled.kills.includes('SIGTERM'));
});
test('unknown process outcome after ignored TERM/KILL is explicit and requires reconciliation',async()=>{
 let owned;const result=await invoke(c=>{owned=c;c.kill=s=>{c.kills.push(s);return true}},{timeoutMs:10,commandId:'wrangler-device-login'});assert.equal(result.status,'timeout');assert.equal(result.requiresReconciliation,true);assert.deepEqual(owned.kills,['SIGTERM','SIGKILL']);
});
test('verbose output is classified incrementally and retained only as bounded summaries',async()=>{
 const log=createToolDiagnostics({component:'wrangler-auth'});const result=await invoke(c=>{c.stdout.emit('data',Buffer.from('synthetic-private-data '.repeat(10000)+'expired_token'));c.finish(1)},{diagnostics:log});assert.equal(result.errorCategory,'auth_device_expired');const support=await log.exportSupport();assert.equal(support.events.at(-1).stdout.truncated,true);assert.equal(JSON.stringify(support).includes('synthetic-private-data'),false);
 const ok=await invoke(c=>{c.stdout.emit('data',Buffer.from('negative test says not authenticated'));c.finish(0)},{commandId:'package-verification'});assert.equal(ok.status,'success');
});
test('sink failure cannot change known successful process result; unknown spawn errors are redacted',async()=>{
 const log=createToolDiagnostics({sink:()=>{throw Error('private logger failure')}});const success=await invoke(c=>c.finish(0),{diagnostics:log});assert.equal(success.status,'success');assert.equal(success.exitCode,0);assert.equal(success.diagnostics.complete,false);
 const failed=await runObservedCommand({commandId:'wrangler-whoami',file:'synthetic',spawnImpl:()=>{throw Error('private spawn exception')}});assert.equal(failed.errorCategory,'spawn_failure');assert.equal(JSON.stringify(failed).includes('private spawn exception'),false);
});

test('exited child with inherited open pipes is bounded and owned capture streams are destroyed',async()=>{
 const log=createToolDiagnostics();let owned;const result=await invoke(c=>{owned=c;c.stdout.destroy=()=>{c.stdout.destroyed=true};c.stderr.destroy=()=>{c.stderr.destroyed=true};c.emit('exit',0,null)},{timeoutMs:15,diagnostics:log});assert.equal(result.requiresReconciliation,true);assert.equal(owned.stdout.listenerCount('data'),0);assert.equal(owned.stderr.listenerCount('data'),0);assert.equal(owned.stdout.destroyed,true);assert.equal(owned.stderr.destroyed,true);owned.stdout.emit('data',Buffer.from('synthetic-private-late-output'));assert.equal(JSON.stringify(await log.exportSupport()).includes('synthetic-private-late-output'),false);
});

test('official pre-handoff errors retain finite categories without inventing HTTP status',async()=>{
 for(const [message,expected,status] of [['`@napi-rs/keyring` is required for OS keyring storage on Windows but is not installed.','secure_storage_unavailable',null],['The device authorization endpoint returned a response that could not be interpreted (synthetic-private-body).','malformed_response',null],['invalid_scope synthetic-private-body','invocation_scope_rejected',null],['Forbidden synthetic-private-body','authorization_rejected',null],['HTTP 401 Unauthorized synthetic-private-body','authorization_rejected',401]]){
  const log=createToolDiagnostics({component:'wrangler-auth'});const result=await invoke(c=>{c.stderr.emit('data',Buffer.from(message));c.finish(1)},{commandId:'wrangler-device-login',diagnostics:log});assert.equal(result.errorCategory,expected);assert.equal(result.requiresReconciliation,true);const support=await log.exportSupport();assert.equal(support.events.at(-1).httpStatus,status);assert.equal(JSON.stringify(support).includes('synthetic-private-body'),false);
 }
});
