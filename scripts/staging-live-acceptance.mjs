import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {parseStagingAccessCredential} from './staging-access-credential.mjs';
import {speechWavDuration,assertSpeechDiarization,assertSpeechTranscription} from './staging-paid-audio.mjs';
import {SESSION_SLIDING_SECONDS} from '../src/config.js';
const ORIGIN='https://transcriber-staging.awakeningtoreality.com';
const FORMATS=[['mp3','audio/mpeg','gpt-transcribe'],['flac','audio/flac','gpt-transcribe'],['mp4','audio/mp4','gpt-transcribe'],['mpeg','audio/mpeg','gpt-transcribe'],['mpga','audio/mpeg','gpt-transcribe'],['m4a','audio/mp4','gpt-transcribe'],['ogg','audio/ogg','gpt-transcribe'],['wav','audio/wav','gpt-4o-transcribe-diarize'],['webm','audio/webm','gpt-transcribe']];
const report={schema:'cosmic-paid-staging-nine-1',commit:process.env.GITHUB_SHA||null,runId:process.env.GITHUB_RUN_ID||null,runAttempt:process.env.GITHUB_RUN_ATTEMPT||null,status:'RUNNING',phase:'environment',attempted:0,formats:[],startedAt:new Date().toISOString()};
let accessCookie='',authHeader='',byokCookie='',byokForgetAttempted=false;
// DOMException.code can be a numeric legacy code (e.g. TimeoutError = 23).
// Preserve the safe error *name* instead of emitting an opaque number.
// Never include messages, URLs, credentials, or response bodies.
const safeError=e=>{
 const label=typeof e?.code==='string'&&e.code?e.code
  :typeof e?.name==='string'&&e.name!=='Error'?e.name:'unknown';
 return label.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64)||'unknown';
};
function configureAccess(s){({authHeader,accessCookie}=parseStagingAccessCredential(s));}

// Bound untrusted staging JSON while it is being received, not after
// Response.text() has already buffered an arbitrarily large body. This
// runner is a paid-certification client, so a malformed/oversized response
// must fail closed without retrying an ambiguous billable request.
async function readWorkerJsonBounded(response){
 const maxBytes=131072;
 const invalid=(code)=>{const e=Error('Staging response rejected');e.code=code;throw e};
 const declared=response.headers.get('content-length');
 if(declared!==null&&/^\d+$/.test(declared)&&Number(declared)>maxBytes){
  try{await response.body?.cancel()}catch{/* never reveal stream error */}
  invalid('worker_response_oversized');
 }
 if(!response.body||typeof response.body.getReader!=='function')invalid('worker_response_stream_missing');
 const reader=response.body.getReader();const chunks=[];let total=0,complete=false;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done){complete=true;break}
   if(!(value instanceof Uint8Array))invalid('worker_response_stream_invalid');
   total+=value.byteLength;
   if(total>maxBytes)invalid('worker_response_oversized');
   chunks.push(value);
  }
 }finally{
  if(!complete)try{await reader.cancel()}catch{/* never reveal stream error */}
  try{reader.releaseLock()}catch{/* never reveal stream error */}
 }
 try{
  const bytes=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }catch{invalid('worker_response_invalid_json')}
}

// Release rejected HTTP bodies promptly without reading sensitive content.
async function discardRejectedResponse(response){
 try{await response.body?.cancel()}catch{/* never reveal response or network errors */}
}
async function api(route,method='GET',body=null,headers={}){
 assert.ok(route.startsWith('/api/'),'Only staging API permitted');
 const h={...headers};const cookie=[accessCookie,byokCookie].filter(Boolean).join('; ');
 if(cookie)h.Cookie=cookie;if(authHeader)h['Cf-Access-Token']=authHeader;
 if(method!=='GET')h.Origin=ORIGIN;
 const response=await fetch(ORIGIN+route,{method,body,headers:h,redirect:'manual',signal:AbortSignal.timeout(90000)});
 if(response.status>=300&&response.status<400){await discardRejectedResponse(response);const e=Error('Cloudflare Access returned a redirect');e.code='access_redirect';e.httpStatus=response.status;throw e}
 // Compare the actual media type, not a substring in a suffix or parameter.
 // application/jsonp and text/plain; hint=application/json are NOT JSON responses.
 const responseMediaType=response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase();
 if(responseMediaType!=='application/json'){
  await discardRejectedResponse(response);
  assert.fail('Staging Worker JSON required');
 }
 const j=await readWorkerJsonBounded(response);
 if(!response.ok||j?.ok!==true){const e=Error('Staging API response rejected');e.code=safeError({code:j?.error?.code||'http_'+response.status});e.httpStatus=response.status;throw e}
 return {j,response};
}
// This endpoint clears the browser-style BYOK cookie; it does not revoke an
// already copied, stateless encrypted cookie server-side. A successful JSON
// response alone is insufficient: verify the actual cookie-expiry instruction
// before declaring cleanup PASS. Never print the Set-Cookie header or its value.
function assertForgetCookie(response){
 const cookies=response.headers.getSetCookie?.()||[];
 const matches=cookies.filter(value=>value.startsWith('__Host-cosmic_byok='));
 const invalid=()=>{const e=Error('Staging BYOK deletion cookie missing or invalid');e.code='byok_clear_cookie_invalid';throw e};
 // Multiple Set-Cookie headers for the same name can reissue the cookie after
 // deletion. Duplicate attributes can also change the effective cookie path.
 if(matches.length!==1)return invalid();
 const parts=matches[0].split(';').map(x=>x.trim());
 if(parts.shift()!=='__Host-cosmic_byok=')return invalid();
 const attrs=parts.map(part=>{const i=part.indexOf('=');return [part.slice(0,i<0?undefined:i).toLowerCase(),i<0?null:part.slice(i+1)];});
 const only=(name,expected)=>{
  const found=attrs.filter(([key])=>key===name);
  return found.length===1&&found[0][1]===expected;
 };
 if(!only('max-age','0')||!only('path','/')||!only('secure',null)||
    !only('httponly',null)||!only('samesite','Strict')||
    attrs.some(([key])=>key==='domain'))return invalid();
}

// Node's fetch permits a manually replayed Set-Cookie value even when a real
// browser would reject an invalid __Host- cookie. Validate the full browser
// contract before counting any potentially billable transcription request.
// Never include the cookie value in logs or evidence.
function assertIssuedByokCookie(response){
 const cookies=response.headers.getSetCookie?.()||[];
 const matches=cookies.filter(value=>value.startsWith('__Host-cosmic_byok='));
 const invalid=()=>{const e=Error('Staging BYOK issuance cookie missing or invalid');e.code='byok_issue_cookie_invalid';throw e};
 if(matches.length!==1)return invalid();
 const parts=matches[0].split(';').map(x=>x.trim());
 const value=/^__Host-cosmic_byok=([A-Za-z0-9_-]{61,3800})$/.exec(parts.shift()||'')?.[1];
 if(!value)return invalid();
 const attrs=parts.map(part=>{const i=part.indexOf('=');return [part.slice(0,i<0?undefined:i).toLowerCase(),i<0?null:part.slice(i+1)];});
 const only=(name,expected)=>{
  const found=attrs.filter(([key])=>key===name);
  return found.length===1&&found[0][1]===expected;
 };
 const age=attrs.filter(([key])=>key==='max-age');
 if(!only('path','/')||!only('secure',null)||!only('httponly',null)||
    !only('samesite','Strict')||attrs.some(([key])=>key==='domain')||
    age.length!==1||!/^[0-9]+$/.test(age[0][1]||'')||
    Number(age[0][1])<1||Number(age[0][1])>SESSION_SLIDING_SECONDS)return invalid();
 return '__Host-cosmic_byok='+value;
}
async function forgetByok(){
 byokForgetAttempted=true;
 report.phase='byok-forget';
 const forgotten=await api('/api/key/forget','DELETE');
 assert.equal(forgotten.j.configured,false);
 assertForgetCookie(forgotten.response);
 byokCookie='';
 report.phase='byok-forget-status';
 assert.equal((await api('/api/session/status')).j.configured,false);
 report.byokForget='PASS';
}
async function run(){
 // A GitHub Actions rerun re-executes this process and could repeat
 // already-billable calls from an earlier attempt. Reject every rerun and
 // non-push invocation before any network request, including preflight.
 report.phase='run-identity';
 assert.equal(process.env.GITHUB_EVENT_NAME,'push','Paid acceptance requires an authorized push workflow');
 assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1','Paid acceptance must never repeat on a GitHub rerun');
 assert.match(process.env.GITHUB_RUN_ID||'',/^[1-9][0-9]{0,19}$/,'Paid acceptance requires a GitHub workflow run id');
 assert.equal(process.env.COSMIC_PAID_STAGING_MODE,'exact-nine-real-requests');
 assert.equal(process.env.GITHUB_REF,'refs/heads/ci/v1.2.0-production-readiness');
 assert.match(process.env.GITHUB_SHA||'',/^[0-9a-f]{40}$/);
 report.phase='access-credential';
 configureAccess(process.env.STAGING_CF_AUTHORIZATION);
 report.phase='openai-key';
 const apiKey=String(process.env.STAGING_OPENAI_API_KEY||'').trim();
 assert.ok(apiKey&&apiKey.length<=512&&!/\s/.test(apiKey),'Staging OpenAI key invalid or missing');
 report.phase='fixture-manifest';
 const sums=(await readFile('SHA256SUMS.txt','utf8')).split('\n');
 const fixtures=[];
 for(const [format,mime,model] of FORMATS){
  report.phase='fixture-'+format;
  const name=format==='wav'?'tests/fixtures/staging-wav-diarization.wav':'tests/fixtures/staging-speech.'+format;
  const sum=sums.find(line=>line.endsWith('  '+name));assert.ok(sum,'No reviewed source fixture');
  const bytes=await readFile(name);assert.ok(bytes.length>=1024&&bytes.length<=24_000_000,'Invalid audio fixture size');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),sum.split(' ',1)[0],'Reviewed disk fixture SHA-256 differs');
  const durationSeconds=format==='wav'?speechWavDuration(bytes):({mp3:12.096,flac:12,mp4:12,mpeg:12.096,mpga:12.096,m4a:12,ogg:12,webm:12.008})[format];
  fixtures.push({format,mime,model,bytes,durationSeconds});
 }
 report.phase='access-status';
 const status=(await api('/api/session/status')).j;
 report.phase='access-version';
 assert.equal(status.version,'1.2.0','Wrong staging Worker version');
 report.phase='access-account';
 assert.ok(status.account?.isAdmin===true||status.account?.status==='active','Cloudflare Access account not active');
 report.phase='access-principal';
 assert.ok(typeof status.principalScope==='string'&&status.principalScope.length>5,'Verified identity missing');
 report.access='PASS';
 if(status.account?.isAdmin){report.phase='admin-overview';assert.equal((await api('/api/admin/overview')).j.ok,true);report.adminReadOnly='PASS'}
 report.phase='byok-create';
 const session=await api('/api/key/session','POST',JSON.stringify({apiKey}),{'content-type':'application/json'});
 assert.equal(session.j.configured,true);
 report.phase='byok-cookie';
 byokCookie=assertIssuedByokCookie(session.response);
 report.phase='byok-status';
 assert.equal((await api('/api/session/status')).j.configured,true);report.secureByok='PASS';
 console.log('STAGING PREPAID PASS: verified identity, fixtures and encrypted BYOK cookie');
 for(const {format,mime,model,bytes,durationSeconds} of fixtures){
  report.phase='paid-'+format;
  assert.ok(report.attempted<9,'Hard cap nine paid requests');
  const id=randomUUID().replaceAll('-','');
  const metadata={v:2,audioFormat:format,jobId:'live-'+id,fileId:'f-'+id,attemptId:'a-'+id,chunkIndex:1,chunkCount:1,declaredBytes:bytes.length,durationSeconds,model,languages:[],keywords:[],prompt:'',requestKind:'transcription'};
  const headers={'content-type':mime,'x-cosmic-metadata':Buffer.from(JSON.stringify(metadata)).toString('base64url')};
  report.attempted++;
  try{
   const {j}=await api('/api/transcribe','POST',bytes,headers);
   assert.ok(j.result&&typeof j.result==='object','Missing OpenAI result');
   assert.ok(typeof j.result.text==='string'||Array.isArray(j.result.segments),'Invalid OpenAI transcript structure');
   assert.ok(j.diagnostics&&typeof j.diagnostics==='object','Missing upstream diagnostics');
   const diarization=format==='wav'?assertSpeechDiarization(j.result,durationSeconds):null;
   const speech=format==='wav'?null:assertSpeechTranscription(j.result);
   report.formats.push({format,model,jobId:metadata.jobId,attemptId:metadata.attemptId,status:'PASS',requestIdPresent:!!j.diagnostics.openaiRequestId,...(diarization?{speakerCount:diarization.speakers,segmentCount:diarization.segments}:{}),...(speech?{speechWordCount:speech.wordCount}:{})});
   console.log('STAGING PAID PASS '+format+' model='+model);
  }catch(e){report.formats.push({format,model,jobId:metadata.jobId,attemptId:metadata.attemptId,status:'FAIL',code:safeError(e),httpStatus:e?.httpStatus||null});throw e}
 }
 await forgetByok();
 report.phase='complete';report.status='PASS';
}
try{await run()}catch(e){
 // Preserve the primary failure even if nonbillable BYOK cleanup also fails.
 const primaryFailure={phase:report.phase,code:safeError(e),httpStatus:e?.httpStatus||null};
 report.status='FAIL';
 if(byokCookie&&!byokForgetAttempted){
  try{await forgetByok()}
  catch(cleanupError){report.byokForget='FAIL';report.byokForgetFailure={code:safeError(cleanupError),httpStatus:cleanupError?.httpStatus||null}}
 }
 if(byokForgetAttempted&&report.byokForget!=='PASS')report.byokForget='FAIL';
 report.phase=primaryFailure.phase;report.failure=primaryFailure;
 console.error('STAGING REAL PAID FAIL: phase='+report.failure.phase+' code='+report.failure.code+'; attempted='+report.attempted);
 process.exitCode=1; // No retry: the previous paid request could already be billable.
}finally{
 report.finishedAt=new Date().toISOString();
 await mkdir('test-results',{recursive:true});
 await writeFile('test-results/staging-live-acceptance.json',JSON.stringify(report,null,2)+'\n');
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'\nV1.2 staging real paid acceptance: '+report.status+'; attempts '+report.attempted+'/9; passes '+report.formats.filter(x=>x.status==='PASS').length+'/9. Secrets and transcripts omitted.\n');
}