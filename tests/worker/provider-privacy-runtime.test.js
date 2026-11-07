// Real local workerd + migrated D1. Outbound provider fetch is closed/mocked.
// No production Access, account, credentials or provider request is involved.
import {test,expect,beforeEach} from 'vitest';
import {env} from 'cloudflare:workers';
import {createExecutionContext,waitOnExecutionContext} from 'cloudflare:test';
import worker from '../../src/index.js';
import {createCredentialSession} from '../../src/byok.js';
import {getKeyTestMp3} from '../../src/test-audio.js';
import {resolveUserAccount} from '../../src/user-registry.js';
import {captureProviderFailure} from '../../src/provider-failure.js';
const CANARY='fuchsiaRuntimeCanary42',KEY='EXAMPLE-offline-runtime-only';
const principal={sub:'local-development-user',email:'local-development@example.invalid'};
const limiter={async limit(){return {success:true}}};
function bindings(){return {...env,DEPLOYMENT_ENV:'development',LOCAL_AUTH_BYPASS:'true',APP_ORIGIN:'https://localhost',ADMIN_EMAILS:principal.email,RL_TRANSCRIBE:limiter,RL_KEY_TEST:limiter}}
beforeEach(async()=>{
 // Only the plugin-provided local test DB; schema comes from existing setup.
 for(const table of ['cosmic_attempt_results','cosmic_attempt_dispatches','cosmic_job_chunks','cosmic_jobs','cosmic_admin_audit','cosmic_users','cosmic_model_usage'])await env.USER_DB.prepare(`DELETE FROM ${table}`).run();
 await env.USER_DB.prepare("UPDATE cosmic_settings SET value='open' WHERE key='registration_mode'").run();
});
async function invoke({status=400,mode='reject',cookie,sinkFailure=false,overrideDb}={}){
 const b=bindings();if(overrideDb)b.USER_DB=overrideDb;
 const session=await createCredentialSession(KEY,principal,b),audio=getKeyTestMp3();
 const meta={v:2,jobId:'job-'+'a'.repeat(24),fileId:'file-'+'b'.repeat(24),attemptId:'attempt-'+'c'.repeat(24),chunkIndex:1,chunkCount:1,declaredBytes:audio.length,durationSeconds:.25,audioFormat:'mp3',model:'gpt-transcribe',languages:[],keywords:[CANARY],prompt:CANARY,requestKind:'transcription'};
 const req=new Request('https://localhost/api/transcribe',{method:'POST',headers:{Origin:'https://localhost',Cookie:cookie||session.setCookie.split(';')[0],'Content-Type':'audio/mpeg','X-Cosmic-Metadata':btoa(JSON.stringify(meta)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')},body:audio});
 const originalFetch=globalThis.fetch,originalLog=console.log;let calls=0;const logs=[];
 globalThis.fetch=async(url,init)=>{
  if(String(url)!=='https://api.openai.com/v1/audio/transcriptions')throw Error('Unexpected mock endpoint');calls++;
  for await(const _ of init.body){};
  if(mode==='transport')throw Object.assign(new TypeError(CANARY),{code:'ECONNRESET'});
  return new Response(JSON.stringify(status===200?{text:CANARY}:{error:{code:'invalid_value',message:CANARY+' '+KEY,details:{message:CANARY,type:'invalid_request_error'}}}),{status,headers:{'content-type':'application/json','x-request-id':'req_abc123'}});
 };
 console.log=line=>{if(sinkFailure)throw Error(CANARY);logs.push(JSON.parse(line))};
 const ctx=createExecutionContext();let response,body,rejection;
 try{response=await worker.fetch(req,b,ctx);body=await response.json();try{await waitOnExecutionContext(ctx)}catch(e){rejection=e}}
 finally{globalThis.fetch=originalFetch;console.log=originalLog}
 const serialized=JSON.stringify(logs);expect(serialized).not.toContain(CANARY);expect(serialized).not.toContain(KEY);expect(serialized).not.toContain(session.setCookie.split(';')[0]);
 return {response,body,rejection,calls,logs};
}
test('privacy-v2 fixed-fact module executes inside workerd without retaining unknown prose',()=>{
 const e=captureProviderFailure({message:CANARY,code:'invalid_value'},{bodyKind:'json'});expect(e.schema).toBe('cosmic-provider-explanation-2');expect(e.facts.some(f=>f.value==='invalid_value')).toBe(true);expect(JSON.stringify(e)).not.toContain(CANARY);expect(e.completeProviderExplanation).toBe(false)
});
test('workerd rejection records real D1 dispatch/result with safe operational facts',async()=>{
 const x=await invoke();expect(x.response.status).toBe(400);expect(x.calls).toBe(1);expect(x.rejection).toBeUndefined();expect(x.body.error.details.billingState).toBe('explicit_rejection');expect(x.logs.some(e=>e.providerExplanation?.facts.some(f=>f.value==='invalid_value'))).toBe(true);
 expect((await env.USER_DB.prepare('SELECT COUNT(*) AS n FROM cosmic_attempt_dispatches').first()).n).toBe(1);expect((await env.USER_DB.prepare('SELECT success FROM cosmic_attempt_results').first()).success).toBe(0)
});
test('real local D1 prevents duplicate attempt admission before a second mocked provider request',async()=>{
 const first=await invoke({status:200});expect(first.response.status).toBe(200);expect(first.calls).toBe(1);
 const second=await invoke({status:200});expect(second.response.status).toBe(409);expect(second.calls).toBe(0);expect(second.body.error.code).toBe('duplicate_usage_attempt');
 expect((await env.USER_DB.prepare('SELECT COUNT(*) AS n FROM cosmic_attempt_dispatches').first()).n).toBe(1);expect((await env.USER_DB.prepare('SELECT COUNT(*) AS n FROM cosmic_attempt_results').first()).n).toBe(1);
 await expect(env.USER_DB.prepare('INSERT INTO cosmic_attempt_dispatches SELECT * FROM cosmic_attempt_dispatches').run()).rejects.toThrow();
 expect((await env.USER_DB.prepare('SELECT success FROM cosmic_attempt_results').first()).success).toBe(1)
});
for(const mode of ['server','transport'])test('workerd '+mode+' failure preserves ambiguous billing with one mocked send',async()=>{
 const x=await invoke({status:mode==='server'?500:502,mode:mode==='server'?'reject':'transport'});expect(x.response.status).toBe(mode==='server'?500:502);expect(x.calls).toBe(1);expect(x.body.error.details.billingState).toBe('ambiguous_after_dispatch');expect((await env.USER_DB.prepare('SELECT success FROM cosmic_attempt_results').first()).success).toBe(0)
});
test('workerd logger failure does not change real D1 failure result or mocked send count',async()=>{
 const x=await invoke({sinkFailure:true,status:429});expect(x.response.status).toBe(429);expect(x.calls).toBe(1);expect(x.logs.length).toBe(0);expect((await env.USER_DB.prepare('SELECT success FROM cosmic_attempt_results').first()).success).toBe(0)
});
test('real D1 result trigger failure reaches waitUntil as a safe rejection, not raw SQL cause',async()=>{
 await resolveUserAccount(bindings(),principal);
 await env.USER_DB.prepare(`CREATE TRIGGER synthetic_result_failure BEFORE INSERT ON cosmic_attempt_results BEGIN SELECT RAISE(ABORT, '${CANARY}'); END`).run();
 let batches=0;const db={prepare:env.USER_DB.prepare.bind(env.USER_DB),batch(statements){batches++;return env.USER_DB.batch(statements)}};
 try{const x=await invoke({status:200,overrideDb:db});expect(x.response.status).toBe(200);expect(x.calls).toBe(1);expect(batches).toBe(4);expect(x.rejection).toBeTruthy();expect(String(x.rejection.message)).not.toContain(CANARY);expect(x.rejection.code).toBe('usage_result_persist_failed');expect(x.rejection.details.rawCauseOmitted).toBe(true);expect(x.rejection.cause).toBeUndefined();expect((await env.USER_DB.prepare('SELECT COUNT(*) AS n FROM cosmic_attempt_dispatches').first()).n).toBe(1);expect((await env.USER_DB.prepare('SELECT COUNT(*) AS n FROM cosmic_attempt_results').first()).n).toBe(0)}finally{await env.USER_DB.prepare('DROP TRIGGER IF EXISTS synthetic_result_failure').run()}
});
