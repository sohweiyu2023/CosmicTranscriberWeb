import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,open,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseStagingAccessCredential} from './staging-access-credential.mjs';
import {assertSpeechTranscription,assertSpeechDiarization} from './staging-paid-audio.mjs';
import {SESSION_SLIDING_SECONDS} from '../src/config.js';
const ORIGIN='https://transcriber-staging.awakeningtoreality.com';
import {POLICY,APPROVED_DEPLOYMENT,FIXTURES,SOURCE_FEATURES,requireReviewedDeployment,verifyFixtures,sha256} from './staging-remaining-eight-policy.mjs';
const BASE=APPROVED_DEPLOYMENT.source;
const report={schema:'cosmic-staging-remaining-eight-1',formats:[],baseCommit:BASE,status:'RUNNING',phase:'preflight',attempted:0,releaseReady:false,fullAcceptance:false,genuineMacSafariValidated:false,startedAt:new Date().toISOString()};
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
export async function runFixedBatch(files,report,persist,request){
 verifyFixtures(files);assert.equal(report.attempted,0);assert.deepEqual(report.formats,[]);
  for(const f of FIXTURES){
   assert.ok(report.attempted<8);const bytes=files[f.name],id=randomUUID().replaceAll('-','');
   const metadata={v:2,audioFormat:f.format,jobId:'remaining-'+id,fileId:'f-'+id,attemptId:'a-'+id,chunkIndex:1,chunkCount:1,declaredBytes:bytes.length,durationSeconds:f.dispatchDurationSeconds,model:f.model,languages:[],keywords:[],prompt:'',requestKind:'transcription'};
   report.phase='paid-'+f.format;report.attempted++;
   const record={format:f.format,model:f.model,status:'ATTEMPTED',attemptId:metadata.attemptId};report.formats.push(record);
   await persist();
   const {j}=await request('/api/transcribe','POST',bytes,{'content-type':f.mime,'x-cosmic-metadata':Buffer.from(JSON.stringify(metadata)).toString('base64url')});
   const validation=f.format==='wav'?assertSpeechDiarization(j.result,f.dispatchDurationSeconds):assertSpeechTranscription(j.result);
   Object.assign(record,{status:'PASS',requestIdPresent:!!j.diagnostics?.openaiRequestId,...validation});
   await persist();
  }
}
async function run(fixturePath,receiptPath,ledgerPath){
 requireReviewedDeployment();
 assert.equal(process.env.GITHUB_REPOSITORY,POLICY.repo);assert.equal(process.env.GITHUB_REF,'refs/heads/main');
 assert.equal(process.env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
 assert.equal(process.env.GITHUB_WORKFLOW,'Remaining EIGHT approved STAGING formats ONLY');
 report.runnerSha256=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
 assert.equal(process.env.COSMIC_REMAINING_EIGHT_MODE,'remaining-eight-existing-approval');
 // No spoofed GitHub identity and no reuse of the certification runner.
 const root=path.resolve(process.env.COSMIC_SMOKE_SOURCE_ROOT||path.resolve(import.meta.dirname,'..'));
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),BASE);
 assert.equal(execFileSync('git',['diff','HEAD','--name-only'],{cwd:root,encoding:'utf8'}).trim(),'','Tracked source changed');
 for(const [name,hash] of Object.entries(SOURCE_FEATURES))assert.equal(sha256(await readFile(path.join(root,name))),hash,'Required single-block source differs');
 report.phase='fixture';const files=Object.create(null);for(const e of await readdir(fixturePath,{withFileTypes:true})){assert.equal(e.isFile(),true);files[e.name]=await readFile(path.join(fixturePath,e.name));}verifyFixtures(files);
 report.pricing={currency:'USD',gptMinuteMicroUsd:4500,diarizationContextTokens:16000,diarizationOutputTokens:2000,conservativeBothTokenRateUsdPerMillion:10,diarizationReservationMicroUsd:180000,cumulativeReservationMicroUsd:216000,invoiceVerified:false};
 report.phase='access-credential';configureAccess(process.env.STAGING_CF_AUTHORIZATION);
 report.phase='billing-credential';
 const apiKey=String(process.env.STAGING_OPENAI_API_KEY||'').trim();
 assert.ok(apiKey&&apiKey.length<=512&&!/\s/.test(apiKey),'Dedicated staging OpenAI key missing');
 // A generic OPENAI_API_KEY is deliberately never substituted.
 // Require separately verified deployed-source evidence; version alone is insufficient.
 report.phase='deployed-source';
 const deployed=JSON.parse(await readFile(process.env.COSMIC_STAGING_SOURCE_RECEIPT||'','utf8'));
 assert.equal(deployed.schema,'cosmic-verified-staging-source-1');
 assert.equal(deployed.origin,ORIGIN);assert.equal(deployed.commit,BASE);
 assert.equal(deployed.workerVersionId,APPROVED_DEPLOYMENT.version);
 assert.equal(deployed.verified,true);
 assert.ok(typeof deployed.checkedAtUtc==='string'&&Number.isFinite(Date.parse(deployed.checkedAtUtc)));
 const sourceAge=Date.now()-Date.parse(deployed.checkedAtUtc);assert.ok(sourceAge>=0&&sourceAge<=300000,'Deployed-source evidence is stale');
 report.deployedSource={commit:BASE,workerVersionId:deployed.workerVersionId};
 report.phase='access-status';const status=(await api('/api/session/status')).j;
 assert.equal(status.version,'1.2.0');assert.ok(status.account?.isAdmin===true||status.account?.status==='active');
 assert.ok(typeof status.principalScope==='string'&&status.principalScope.length>5);
 report.access='PASS';
 report.phase='byok-create';
 const session=await api('/api/key/session','POST',JSON.stringify({apiKey}),{'content-type':'application/json'});
 assert.equal(session.j.configured,true);byokCookie=assertIssuedByokCookie(session.response);
 assert.equal((await api('/api/session/status')).j.configured,true);
 const lock=await open(ledgerPath+'.lock','wx');
 try{
  const ledger=JSON.parse(await readFile(ledgerPath,'utf8'));
  assert.equal(ledger.schema,'cosmic-approved-paid-budget-1');assert.equal(ledger.approval,POLICY.approval);
  assert.equal(ledger.maximumRequests,9);assert.equal(ledger.maximumMicroUsd,250000);
  assert.equal(ledger.reservedRequests,9);assert.equal(ledger.reservedMicroUsd,216000);
  report.budget={reservedRequests:9,reservedMicroUsd:216000};
  await runFixedBatch(files,report,async()=>writeFile(receiptPath,JSON.stringify(report,null,2)+'\n'),api);
 }finally{await lock.close();/* Keep the lock as a durable one-shot marker; no automatic replay. */}
 await forgetByok();report.phase='complete';report.status='PASS';
}
async function main(){
 let receiptPath,receiptOwned=false;
 try{
  assert.equal(process.argv.length,5,'Usage: node scripts/staging-remaining-eight-runner.mjs <fixed-eight-directory> <new-receipt.json> <approved-ledger.json>');
  const [fixture,receipt,ledger]=process.argv.slice(2);receiptPath=path.resolve(receipt);
  // Never overwrite a previous receipt, even when an earlier dispatch is uncertain.
  const receiptHandle=await open(receiptPath,'wx');receiptOwned=true;await receiptHandle.close();
  await run(path.resolve(fixture),receiptPath,path.resolve(ledger));
 }catch(e){
  const primary={phase:report.phase,code:safeError(e)};report.status='FAIL';report.failure=primary;
  if(byokCookie&&!byokForgetAttempted){try{await forgetByok()}catch{report.byokForget='FAIL'}}
  if(byokForgetAttempted&&report.byokForget!=='PASS')report.byokForget='FAIL';
  report.phase=primary.phase;process.exitCode=1;
 }finally{
  report.finishedAt=new Date().toISOString();
  if(receiptOwned)await writeFile(receiptPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({schema:report.schema,status:report.status,phase:report.phase,attempted:report.attempted,fullAcceptance:false,releaseReady:false}));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
