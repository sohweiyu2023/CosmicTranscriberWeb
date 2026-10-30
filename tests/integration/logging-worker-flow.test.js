import {test} from 'vitest';
import assert from 'node:assert/strict';
import worker from '../../src/index.js';
import {createCredentialSession} from '../../src/byok.js';
import {getKeyTestMp3} from '../../src/test-audio.js';

const principal={sub:'local-development-user',email:'local-development@example.invalid'};
function database({failResult=false}={}){
  const state={dispatch:null,result:null,resultWrites:0};
  const db={prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this},async first(){
    if(sql.includes('cosmic_settings'))return {value:'open'};
    if(sql.includes('FROM cosmic_users'))return {id:1,access_sub:principal.sub,email:principal.email,status:'active',created_at:1,last_seen_at:Math.floor(Date.now()/1000)};
    if(sql.includes('FROM cosmic_attempt_dispatches'))return state.dispatch;
    if(sql.includes('FROM cosmic_attempt_results'))return state.result;
    if(sql.includes('SUM(CASE'))return {completed:state.result?.success?1:0,errors:state.result&&!state.result.success?1:0};
    if(sql.includes('FROM cosmic_jobs'))return state.dispatch?{model:'gpt-transcribe',chunk_count:1}:null;
    throw Error('Unexpected synthetic SQL');
  },async run(){return {success:true}}}},async batch(statements){
    for(const row of statements){
      if(row.sql.includes('INSERT INTO cosmic_attempt_dispatches'))state.dispatch={chunk_index:row.args[3],model:row.args[4],chunk_count:row.args[5]};
      if(row.sql.includes('INSERT INTO cosmic_attempt_results')){state.resultWrites++;if(failResult)throw Error('synthetic accounting failure');state.result={chunk_index:row.args[3],success:row.args[4]}}
    }return statements.map(()=>({success:true}));
  }};return {db,state};
}

for(const scenario of [
  {sink:'dispatch_start',status:200}, {sink:'success',status:200},
  {sink:'request_failed',status:429}, {sink:'usage_result_persist_failed',status:200,failResult:true}
])test('logging sink failure at '+scenario.sink+' preserves actual route result/accounting and one mock dispatch',{timeout:10000},async()=>{
  const {db,state}=database(scenario);
  const env={APP_ORIGIN:'https://localhost',DEPLOYMENT_ENV:'development',LOCAL_AUTH_BYPASS:'true',APP_VERSION:'1.2.0',ADMIN_EMAILS:principal.email,BYOK_KEY_VERSION_CURRENT:'1',BYOK_SESSION_MASTER_KEY_CURRENT:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',USER_DB:db,RL_TRANSCRIBE:{async limit(){return {success:true}}}};
  const session=await createCredentialSession('offline-test-only',principal,env);
  const audio=getKeyTestMp3();const meta={v:2,jobId:'job-'+ 'a'.repeat(24),fileId:'file-'+ 'b'.repeat(24),attemptId:'attempt-'+ 'c'.repeat(24),chunkIndex:1,chunkCount:1,declaredBytes:audio.length,durationSeconds:.25,audioFormat:'mp3',model:'gpt-transcribe',languages:[],keywords:[],prompt:'',requestKind:'transcription'};
  const request=new Request('https://localhost/api/transcribe',{method:'POST',headers:{Origin:'https://localhost',Cookie:session.setCookie.split(';')[0],'Content-Type':'audio/mpeg','X-Cosmic-Metadata':Buffer.from(JSON.stringify(meta)).toString('base64url')},body:audio});
  const originalFetch=globalThis.fetch,originalLog=console.log;let calls=0,failures=0;const tasks=[];
  globalThis.fetch=async(_url,init)=>{calls++;for await(const _ of init.body){}return new Response(scenario.status===200?'{"text":"synthetic test result"}':'{"error":{"code":"rate_limit_exceeded"}}',{status:scenario.status,headers:{'x-request-id':'req_abc123'}})};
  console.log=line=>{if(JSON.parse(line).category===scenario.sink){failures++;throw Error('synthetic sink failure')}};
  try{
    const response=await worker.fetch(request,env,{waitUntil:task=>tasks.push(task)});
    const body=await response.json();const outcomes=await Promise.allSettled(tasks);
    assert.equal(response.status,scenario.status);assert.equal(calls,1);assert.ok(failures>0);
    assert.ok(state.dispatch);assert.equal(state.resultWrites,scenario.failResult?3:1);
    if(scenario.failResult){assert.equal(body.ok,true);assert.equal(outcomes[0].status,'rejected')}
    else{assert.equal(state.result.success,scenario.status===200?1:0);assert.equal(outcomes[0].status,'fulfilled')}
    if(scenario.status===429)assert.equal(body.error.details.billingState,'explicit_rejection');
  }finally{globalThis.fetch=originalFetch;console.log=originalLog}
});

test('auth preflight failure is correlated and never sends provider or raw path',async()=>{
  const originalLog=console.log,originalFetch=globalThis.fetch;const lines=[];let calls=0;
  console.log=line=>lines.push(JSON.parse(line));globalThis.fetch=async()=>{calls++;throw Error('unexpected network')};
  try{const response=await worker.fetch(new Request('https://localhost/private-person@example.test'),{DEPLOYMENT_ENV:'production'});assert.equal(response.status,500);assert.equal(calls,0);assert.equal(lines[0].phase,'preflight');assert.equal(lines[0].route,'other');assert.match(lines[0].requestId,/^req-/);assert.ok(!JSON.stringify(lines).includes('private-person'))}finally{console.log=originalLog;globalThis.fetch=originalFetch}
});

test('key-test response has app/provider correlation even when all logging sinks fail',async()=>{
  const {db}=database();const env={APP_ORIGIN:'https://localhost',DEPLOYMENT_ENV:'development',LOCAL_AUTH_BYPASS:'true',APP_VERSION:'1.2.0',ADMIN_EMAILS:principal.email,BYOK_KEY_VERSION_CURRENT:'1',BYOK_SESSION_MASTER_KEY_CURRENT:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',USER_DB:db,RL_KEY_TEST:{async limit(){return {success:true}}}};
  const session=await createCredentialSession('offline-test-only',principal,env);
  const request=new Request('https://localhost/api/key/test',{method:'POST',headers:{Origin:'https://localhost',Cookie:session.setCookie.split(';')[0],'Content-Type':'application/json'},body:'{"confirmMinimalUsage":true}'});
  const originalFetch=globalThis.fetch,originalLog=console.log;let calls=0;
  globalThis.fetch=async(_url,init)=>{calls++;for await(const _ of init.body){}return new Response('{"text":"synthetic"}',{headers:{'x-request-id':'req_abc123'}})};
  console.log=()=>{throw Error('synthetic sink failure')};
  try{const response=await worker.fetch(request,env);const body=await response.json();assert.equal(response.status,200);assert.equal(calls,1);assert.equal(body.permitted,true);assert.match(body.diagnostics.appRequestId,/^req-/);assert.equal(body.diagnostics.openaiRequestId,'req_abc123')}
  finally{globalThis.fetch=originalFetch;console.log=originalLog}
});

test('throwing auth-failure sink preserves the safe preflight response',async()=>{
  const originalLog=console.log;console.log=()=>{throw Error('synthetic sink failure')};
  try{const response=await worker.fetch(new Request('https://localhost/'),{DEPLOYMENT_ENV:'production'});assert.equal(response.status,500);assert.equal((await response.json()).error.code,'access_config_missing')}
  finally{console.log=originalLog}
});
