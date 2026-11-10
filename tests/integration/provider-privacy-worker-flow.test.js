// Actual Worker fetch source, Node Web APIs, synthetic JWT/BYOK/D1 and closed mock HTTP.
// Not deployed-Workers-runtime or live-provider acceptance.
import {test,beforeAll as before} from 'vitest';
import assert from 'node:assert/strict';
import {SignJWT,generateKeyPair,exportJWK} from 'jose';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import worker from '../../src/index.js';
import {createCredentialSession} from '../../src/byok.js';
import {getKeyTestMp3} from '../../src/test-audio.js';
import {makeDiagnosticEvent,pushDiagnostic,makeDiagnosticExport} from '../../public/js/diagnostics.js';
const CANARY='fuchsiaWorkerCanary42',KEY='synthetic-byok-not-a-real-credential';
const origin='https://localhost',issuer='https://privacy-test.cloudflareaccess.com',audience='synthetic-aud';
const principal={sub:'synthetic-user',email:'synthetic-user@example.invalid'};
let privateKey,jwk;
before(async()=>{const pair=await generateKeyPair('RS256');privateKey=pair.privateKey;jwk={...(await exportJWK(pair.publicKey)),kid:'synthetic-key',alg:'RS256',use:'sig'}});
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
 },async run(){return {success:true}}}},async batch(statements){for(const row of statements){
  if(row.sql.includes('INSERT INTO cosmic_attempt_dispatches'))state.dispatch={chunk_index:row.args[3],model:row.args[4],chunk_count:row.args[5]};
  if(row.sql.includes('INSERT INTO cosmic_attempt_results')){state.resultWrites++;if(failResult)throw Error(CANARY);state.result={chunk_index:row.args[3],success:row.args[4]}}
 }return statements.map(()=>({success:true}))}};return {db,state};
}
async function scenario({route='/api/transcribe',mode='reject',status=400,sinkFailure=false,failResult=false,noJwt=false,badJwt=false,noCookie=false,badOrigin=false}={}){
 const {db,state}=database({failResult});
 const limiter={async limit(){return {success:true}}};
 const env={APP_ORIGIN:origin,DEPLOYMENT_ENV:'production',LOCAL_AUTH_BYPASS:'false',APP_VERSION:'1.2.0',ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUDIENCE:audience,ADMIN_EMAILS:principal.email,BYOK_KEY_VERSION_CURRENT:'1',BYOK_SESSION_MASTER_KEY_CURRENT:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',USER_DB:db,RL_TRANSCRIBE:limiter,RL_KEY_TEST:limiter,RL_KEY_SESSION:limiter,RL_ADMIN:limiter};
 const jwt=await new SignJWT({type:'app',sub:principal.sub,email:principal.email}).setProtectedHeader({alg:'RS256',kid:'synthetic-key'}).setIssuer(issuer).setAudience(badJwt?'wrong-aud':audience).setIssuedAt().setExpirationTime('5m').sign(privateKey);
 const session=await createCredentialSession(KEY,principal,env),audio=getKeyTestMp3();
 const metadata={v:2,jobId:'job-'+'a'.repeat(24),fileId:'file-'+'b'.repeat(24),attemptId:'attempt-'+'c'.repeat(24),chunkIndex:1,chunkCount:1,declaredBytes:audio.length,durationSeconds:.25,audioFormat:'mp3',model:'gpt-transcribe',languages:[],keywords:[CANARY],prompt:CANARY,requestKind:'transcription'};
 const headers={Origin:badOrigin?'https://unapproved.invalid':origin,'Content-Type':route==='/api/key/test'?'application/json':'audio/mpeg'};
 if(!noJwt)headers['Cf-Access-Jwt-Assertion']=jwt;
 if(!noCookie)headers.Cookie=session.setCookie.split(';')[0];
 if(route==='/api/transcribe')headers['X-Cosmic-Metadata']=Buffer.from(JSON.stringify(metadata)).toString('base64url');
 const request=new Request(origin+route,{method:'POST',headers,body:route==='/api/key/test'?'{"confirmMinimalUsage":true}':audio});
 const originalFetch=globalThis.fetch,originalLog=console.log;const logs=[],tasks=[];let calls=0,jwksCalls=0,unexpected=0;
 globalThis.fetch=async(url,init={})=>{
  if(String(url)===issuer+'/cdn-cgi/access/certs'){jwksCalls++;return new Response(JSON.stringify({keys:[jwk]}),{headers:{'content-type':'application/json'}})}
  if(String(url)!=='https://api.openai.com/v1/audio/transcriptions'){unexpected++;throw Error('Unexpected mock HTTP endpoint')}
  calls++;for await(const _ of init.body){};
  const h={'x-request-id':'req_abc123','content-type':'application/json'};
  if(mode==='transport')throw Object.assign(new TypeError(CANARY),{code:'ECONNRESET'});
  if(mode==='interrupted')return new Response(new ReadableStream({start(c){c.error(new Error(CANARY))}}),{status:200,headers:h});
  if(mode==='oversize')return new Response(new Uint8Array(5*1024*1024),{status:200,headers:h});
  if(mode==='html')return new Response(`<html>${CANARY}</html>`,{status:200,headers:h});
  if(mode==='plain')return new Response(CANARY,{status,headers:h});
  if(mode==='success')return new Response(JSON.stringify({text:CANARY}),{status:200,headers:h});
  return new Response(JSON.stringify({error:{message:`Unknown unquoted ${CANARY}, "${KEY}" ${jwt} ${session.setCookie.split(';')[0]}`,code:'invalid_value',type:'invalid_request_error',param:'response_format',details:{message:CANARY,code:'unsupported_parameter'},unknown:CANARY}}),{status,headers:h});
 };
 console.log=line=>{const event=JSON.parse(line);if(sinkFailure===true||event.category===sinkFailure)throw Error(CANARY);logs.push(event)};
 let response,body,outcomes;
 try{response=await worker.fetch(request,env,{waitUntil:task=>tasks.push(task)});body=await response.json();outcomes=await Promise.allSettled(tasks)}finally{globalThis.fetch=originalFetch;console.log=originalLog}
 assert.equal(unexpected,0);assert.ok(calls<=1,'No automatic provider replay');
 return {response,body,logs,state,calls,jwksCalls,outcomes,jwt,cookie:session.setCookie};
}
function noPrivate(text,x){const pair=x.cookie.split(';')[0];for(const value of [CANARY,KEY,x.jwt,x.cookie,pair,pair.slice(pair.indexOf('=')+1)])assert.equal(text.includes(value),false,'Private synthetic value must not persist/export')}
const facts=x=>x.logs.filter(e=>e.providerExplanation).map(e=>e.providerExplanation);
for(const status of [400,401,403,429,500])test('actual transcribe route persists safe facts and unchanged rejection billing for HTTP'+status,async()=>{
 const x=await scenario({status});assert.equal(x.response.status,status);assert.equal(x.calls,1);assert.ok(x.state.dispatch);assert.equal(x.state.result.success,0);assert.equal(x.body.error.details.billingState,status<500?'explicit_rejection':'ambiguous_after_dispatch');assert.match(x.body.requestId,/^req-/);assert.equal(x.body.error.details.openaiRequestId,'req_abc123');
 assert.ok(facts(x).length>=1);for(const e of facts(x)){assert.ok(e.facts.some(f=>f.value==='invalid_value'));assert.equal(e.proseRetained,false);assert.equal(e.completeProviderExplanation,false)}
 noPrivate(JSON.stringify(x.logs),x);noPrivate(JSON.stringify(x.body),x);assert.equal(JSON.stringify(x.body).includes('providerExplanation'),false)
});
for(const mode of ['transport','interrupted','oversize','html','plain'])test('actual transcribe route '+mode+' remains bounded/private and never replays',async()=>{
 const x=await scenario({mode,status:502});assert.equal(x.response.status,502);assert.equal(x.calls,1);assert.ok(facts(x).length>=1);for(const e of facts(x))assert.equal(e.completeProviderExplanation,false);
 if(mode==='transport'){assert.equal(x.body.error.details.billingState,'ambiguous_after_dispatch');assert.ok(facts(x).some(e=>e.facts.some(f=>f.value==='ECONNRESET')))}
 else if(mode!=='plain')assert.equal(x.body.error.details.billingState,'completed_or_ambiguous');
 noPrivate(JSON.stringify(x.logs),x);noPrivate(JSON.stringify(x.body),x)
});
test('actual key-test error route has safe provider facts/app correlation and excludes private evidence from response',async()=>{
 const x=await scenario({route:'/api/key/test',status:401});assert.equal(x.response.status,401);assert.equal(x.calls,1);assert.equal(x.state.dispatch,null);assert.ok(facts(x).length>=1);assert.ok(x.logs.some(e=>e.route==='/api/key/test'&&e.requestId===x.body.requestId));noPrivate(JSON.stringify(x.logs),x);noPrivate(JSON.stringify(x.body),x);assert.equal(JSON.stringify(x.body).includes('providerExplanation'),false)
});
test('actual success route returns intended synthetic transcript without logging it or attaching error evidence',async()=>{
 const x=await scenario({mode:'success'});assert.equal(x.response.status,200);assert.equal(x.body.result.text,CANARY);assert.equal(x.state.result.success,1);assert.equal(x.calls,1);assert.equal(facts(x).length,0);noPrivate(JSON.stringify(x.logs),x)
});
for(const options of [{noJwt:true},{badJwt:true},{noCookie:true},{badOrigin:true}])test('actual auth/BYOK/origin preflight stops before provider '+JSON.stringify(options),async()=>{
 const x=await scenario(options);assert.ok(x.response.status>=400);assert.equal(x.calls,0);assert.equal(x.state.dispatch,null);assert.equal(facts(x).length,0);assert.ok(x.logs.some(e=>e.phase==='preflight'));noPrivate(JSON.stringify(x.logs),x);noPrivate(JSON.stringify(x.body),x)
});
test('actual route sink failure cannot alter rejection, account outcome or request count',async()=>{
 const x=await scenario({status:429,sinkFailure:true});assert.equal(x.response.status,429);assert.equal(x.calls,1);assert.equal(x.state.result.success,0);assert.equal(x.body.error.details.billingState,'explicit_rejection');assert.equal(x.logs.length,0);noPrivate(JSON.stringify(x.body),x)
});
for(const settings of [
 {sinkFailure:'dispatch_start',mode:'success'},
 {sinkFailure:'success',mode:'success'},
 {sinkFailure:'request_failed',status:429},
 {sinkFailure:'usage_result_persist_failed',mode:'success',failResult:true},
])test('actual route logging failure at '+settings.sinkFailure+' cannot change provider/accounting outcome',async()=>{
 const x=await scenario(settings);assert.equal(x.calls,1);assert.equal(x.response.status,settings.mode==='success'?200:429);
 assert.equal(x.state.resultWrites,settings.failResult?3:1);
 if(settings.failResult)assert.equal(x.outcomes[0].status,'rejected');else assert.equal(x.state.result.success,settings.mode==='success'?1:0);
 noPrivate(JSON.stringify(x.logs),x)
});
test('actual result-persistence failure retries only accounting while preserving provider result and private logs',async()=>{
 const x=await scenario({mode:'success',failResult:true});assert.equal(x.response.status,200);assert.equal(x.calls,1);assert.equal(x.state.resultWrites,3);assert.equal(x.outcomes[0].status,'rejected');assert.ok(x.logs.some(e=>e.category==='usage_result_persist_failed'));noPrivate(JSON.stringify(x.logs),x);
 assert.equal(x.outcomes[0].reason.message.includes(CANARY),false,'Background rejection must not expose raw database cause');assert.equal(x.outcomes[0].reason.code,'usage_result_persist_failed');assert.equal(x.outcomes[0].reason.details.rawCauseOmitted,true);assert.equal(x.outcomes[0].reason.cause,undefined)
});
test('actual Worker error logs persist/export safe facts; browser export cannot acquire server-only evidence',async()=>{
 const x=await scenario({status:500});const dir=await mkdtemp(path.join(tmpdir(),'cosmic-worker-facts-'));
 try{const file=path.join(dir,'operations.jsonl');await writeFile(file,x.logs.map(e=>JSON.stringify(e)).join('\n'));const read=await readFile(file,'utf8');noPrivate(read,x);const exported=JSON.stringify({events:read.split('\n').map(l=>JSON.parse(l))});noPrivate(exported,x);assert.ok(exported.includes('invalid_value'));assert.ok(exported.includes('completeProviderExplanation'));
 const browser=[];for(const row of x.logs)pushDiagnostic(browser,makeDiagnosticEvent(row.category,row));assert.ok(browser.length>0);
 const exportedBrowser=makeDiagnosticExport({events:browser});assert.equal(exportedBrowser.events.length,browser.length);assert.ok(exportedBrowser.events.some(e=>e.requestId===x.body.requestId));assert.ok(exportedBrowser.events.some(e=>e.code===x.body.error.code));
 const support=JSON.stringify(exportedBrowser);noPrivate(support,x);assert.equal(support.includes('providerExplanation'),false)
 }finally{await rm(dir,{recursive:true,force:true})}
});
