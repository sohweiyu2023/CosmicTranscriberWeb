// Manual STAGING deployment coordinator; no paid/API-transcription operation.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {createToolDiagnostics} from './tooling-diagnostics.mjs';
import {parseStagingAccessCredential} from './staging-access-credential.mjs';
export const PIN=Object.freeze({repo:'sohweiyu2023/CosmicTranscriberWeb',commit:'d34edd9ef4cccf648d65c71a3b016d78fd76d7bf',run:41165444076,licensingRun:41165444000,artifact:13029840169,artifactName:'CosmicTranscriberWeb-1.2.0-staging-certified',outerDigest:'sha256:191ff4bbd47aa072cad1e48591317ec4f34ddde7e24ae2ebb7ecb1478e82f4a8',sourceDigest:'65a57e43bbaac1369c187a86f3ac8679c4326233affda69228769fcd2f6e4bdd',worker:'cosmic-transcriber-web-staging',rollback:null,rollbackSourceMessage:null});
const ORIGIN='https://transcriber-staging.awakeningtoreality.com',MAX_BYTES=32768;
const reject=(code,httpStatus=null)=>{const error=Error('Manual staging preflight rejected');error.code=code;if(Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599)error.httpStatus=httpStatus;throw error};
export function verifyCoordinatorChanges(changed){
 const allowed=['.github/workflows/staging-deploy-only.yml','scripts/staging-deploy-only.mjs','tests/node/staging-deploy-only.test.mjs','SHA256SUMS.txt'];
 assert.ok(Array.isArray(changed)&&changed.length>0);assert.equal(new Set(changed).size,changed.length);
 assert.ok(changed.every(x=>allowed.includes(x)),'Application/source changed beyond reviewed deployment coordinator');
}
export function verifyRollbackEvidence(deployments,pins){
 assert.match(pins?.rollback||'',/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
 assert.ok(typeof pins.rollbackSourceMessage==='string'&&pins.rollbackSourceMessage.length>0,'Fresh source annotation missing');
 assert.ok(Array.isArray(deployments)&&deployments.length>0);
 assert.ok(deployments.every(x=>Number.isFinite(Date.parse(x.created_on))));
 const current=deployments.toSorted((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on))[0];
 assert.deepEqual(current.versions,[{version_id:pins.rollback,percentage:100}]);
 assert.equal(current.sourceMessage,pins.rollbackSourceMessage,'Current staging source changed');
 return current;
}
export function verifyRollback(deployments){return verifyRollbackEvidence(deployments,PIN)}
export function assertManualIdentity(env){
 assert.equal(env.GITHUB_REPOSITORY,PIN.repo);assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');
 assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
 assert.equal(env.GITHUB_WORKFLOW,'Deploy pinned certified source to STAGING ONLY');
 assert.match(env.GITHUB_SHA||'',/^[a-f0-9]{40}$/);assert.match(env.GITHUB_RUN_ID||'',/^[1-9][0-9]*$/);
 assert.equal(env.CREDENTIAL_REVIEW,'owner-authorized-existing-secret-use','Current owner authorization is required to use the existing GitHub staging secret');
}
export function verifyCertification(run,jobs,artifact,licensing){
 for(const value of [run,licensing]){assert.equal(value.status,'completed');assert.equal(value.conclusion,'success');assert.equal(value.head_sha,PIN.commit);assert.equal(value.event,'push');assert.equal(value.head_branch,'main');assert.equal(value.run_attempt,1)}
 assert.equal(run.id,PIN.run);assert.equal(licensing.id,PIN.licensingRun);
 const required=['Resolve one reviewed dependency graph','Linux Worker + integration + browser matrix','Windows toolchain + Chrome/Edge + staging-certified ZIP','macOS native ZIP + WebKit/mobile + Chrome + real Safari','RELEASE BROWSER GATE - native Safari PASS or exact disclosed exception','STAGING PREFLIGHT - reviewed Safari26 automation exception, no final release'];
 for(const name of required){const matches=jobs.filter(x=>x.name===name);assert.equal(matches.length,1);assert.equal(matches[0].status,'completed');assert.equal(matches[0].conclusion,'success')}
 assert.equal(artifact.id,PIN.artifact);assert.equal(artifact.name,PIN.artifactName);assert.equal(artifact.expired,false);assert.equal(artifact.digest,PIN.outerDigest);
 assert.equal(artifact.workflow_run.id,PIN.run);assert.equal(artifact.workflow_run.head_sha,PIN.commit);
 return {schema:'cosmic-manual-staging-ci-1',commit:PIN.commit,run:PIN.run,artifact:PIN.artifact,sourceDigest:PIN.sourceDigest,nativeSafari:'FAIL/WAIVED; genuine Mac Safari not validated',releaseReady:false,credentialUseDecision:'Owner authorized existing GitHub secret use; exposed-token relationship remains unresolved; no pasted token used'};
}
export async function checkProtectedStaging(credential,fetchImpl=fetch){
  let parsed;try{parsed=parseStagingAccessCredential(credential)}catch{reject(typeof credential==='string'&&credential.trim()?'access_credential_format':'access_credential_missing')}
  const {authHeader,accessCookie}=parsed;
  const headers={};
  if(authHeader)headers['Cf-Access-Token']=authHeader;
  if(accessCookie)headers.Cookie=accessCookie;
  let response;try{response=await fetchImpl(ORIGIN+'/',{
    method:'GET',headers,redirect:'manual',signal:AbortSignal.timeout(20000)
  })}catch(e){reject(e?.name==='TimeoutError'?'access_timeout':'access_network_failed')}
  if(response.status>=300&&response.status<400)reject('access_redirect',response.status);
  if(!response.ok)reject('access_http_rejected',response.status);
  if(response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='text/html')reject('access_not_app_html');
  if(!/\bno-store\b/i.test(response.headers.get('cache-control')||''))reject('access_missing_no_store');
  if(!/frame-ancestors 'none'/.test(response.headers.get('content-security-policy')||''))reject('access_missing_app_csp');
  const declared=response.headers.get('content-length');
  if(declared!==null&&/^\d+$/.test(declared)&&Number(declared)>MAX_BYTES)reject('access_response_oversized');
  if(!response.body||typeof response.body.getReader!=='function')reject('access_response_stream_missing');
  const reader=response.body.getReader();const chunks=[];let size=0,finished=false;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done){finished=true;break}
      if(!(value instanceof Uint8Array))reject('access_response_stream_invalid');
      size+=value.byteLength;
      if(size>MAX_BYTES)reject('access_response_oversized');
      chunks.push(value);
    }
  }finally{
    if(!finished)try{await reader.cancel()}catch{/* no response content logged */}
    try{reader.releaseLock()}catch{/* no response content logged */}
  }
  let html;
  try{
    const data=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength}
    html=new TextDecoder('utf-8',{fatal:true}).decode(data);
  }catch{reject('access_invalid_html')}
  if(!/^\s*<!doctype html>/i.test(html)||
    !html.includes('<title>Cosmic Transcriber Web</title>')||
    !html.includes('id="appStatus"'))reject('access_unrecognized_app');
  // This is a JWT-protected app-shell check, NOT a registry/account-status check.
  // The paid gate MUST revalidate /api/session/status after migration/deployment.
  console.log('STAGING ACCESS PREFLIGHT PASS: protected app shell; no D1 or paid requests');
}
// Only these fixed categories may leave the process; never serialize errors/messages/claims.
const SAFE_ACCESS_CODES=new Set(['access_credential_missing','access_credential_format','access_redirect','access_http_rejected','access_not_app_html','access_missing_no_store','access_missing_app_csp','access_response_oversized','access_response_stream_missing','access_response_stream_invalid','access_invalid_html','access_unrecognized_app','access_timeout','access_network_failed']);
export function accessClaimMetadata(credential,nowSeconds=Math.floor(Date.now()/1000)){
 const result={credentialPresent:typeof credential==='string'&&credential.trim().length>0,transport:'unknown',unverifiedExpiry:'unknown',signatureVerified:false};
 try{
  const p=parseStagingAccessCredential(credential);result.transport=p.authHeader?'Cf-Access-Token':'CF_Authorization cookie';
  const token=p.authHeader||p.accessCookie.slice('CF_Authorization='.length);
  const claims=JSON.parse(Buffer.from(token.split('.')[1]||'','base64url').toString('utf8'));
  if(Number.isSafeInteger(claims?.exp)&&claims.exp>0)result.unverifiedExpiry=claims.exp<=nowSeconds?'expired-claim':'future-claim';
 }catch{/* Never include original input, exception, token, identity or other JWT claims. */}
 return result;
}
export async function diagnoseProtectedStaging(credential,fetchImpl=fetch){
 const metadata=accessClaimMetadata(credential);
 try{await checkProtectedStaging(credential,fetchImpl);return {schema:'cosmic-staging-access-diagnostic-1',status:'PASS',code:'access_pass',...metadata,paidRequests:0}}
 catch(e){return {schema:'cosmic-staging-access-diagnostic-1',status:'FAIL',code:SAFE_ACCESS_CODES.has(e?.code)?e.code:'access_unclassified',httpStatus:Number.isInteger(e?.httpStatus)&&e.httpStatus>=100&&e.httpStatus<=599?e.httpStatus:null,...metadata,paidRequests:0}}
}
// Read the existing token only from this process environment. Never put it in
// command arguments, persisted settings, error messages or diagnostic output.
export async function readCurrentStagingBindings(env,fetchImpl=fetch){
 const account=env.CLOUDFLARE_ACCOUNT_ID,token=env.CLOUDFLARE_API_TOKEN;
 if(typeof account!=='string'||!/^[a-f0-9]{32}$/.test(account)||typeof token!=='string'||!token.trim()||env.STAGING_WORKER_NAME!==PIN.worker)reject('settings_identity_invalid');
 let response;
 try{response=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${PIN.worker}/settings`,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)})}catch(e){reject(e?.name==='TimeoutError'?'settings_timeout':'settings_network_failed')}
 if(response.status!==200)reject('settings_http_rejected',response.status);
 if(response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')reject('settings_not_json');
 const declared=response.headers.get('content-length');if(declared!==null&&/^\d+$/.test(declared)&&Number(declared)>MAX_BYTES)reject('settings_oversized');
 if(!response.body||typeof response.body.getReader!=='function')reject('settings_stream_missing');
 const reader=response.body.getReader(),parts=[];let count=0,finished=false;
 try{
  while(true){let chunk;try{chunk=await reader.read()}catch{reject('settings_interrupted')}
   if(chunk.done){finished=true;break}
   if(!(chunk.value instanceof Uint8Array))reject('settings_stream_invalid');
   count+=chunk.value.byteLength;if(count>MAX_BYTES)reject('settings_oversized');parts.push(chunk.value);
  }
 }finally{if(!finished)try{await reader.cancel()}catch{};try{reader.releaseLock()}catch{}}
 let body;try{const bytes=new Uint8Array(count);let at=0;for(const part of parts){bytes.set(part,at);at+=part.byteLength}body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{reject('settings_invalid_json')}
 if(body?.success!==true||!Array.isArray(body?.result?.bindings))reject('settings_unrecognized');
 const bindings=[];
 for(const name of ['ACCESS_TEAM_DOMAIN','ACCESS_AUDIENCE','ADMIN_EMAILS']){
  const found=body.result.bindings.filter(b=>b?.name===name&&b.type==='plain_text');
  if(found.length!==1||typeof found[0].text!=='string'||!found[0].text.trim())reject('settings_binding_invalid');
  bindings.push({name,type:'plain_text',text:found[0].text});
 }
 const d1=body.result.bindings.filter(b=>b?.name==='USER_DB'&&b.type==='d1');const id=d1[0]?.database_id||d1[0]?.id;
 if(d1.length!==1||typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))reject('settings_binding_invalid');
 bindings.push({name:'USER_DB',type:'d1',id});
 return {success:true,result:{bindings}};
}
export function stagingSettingsOutputPath(env){
 const temp=env.RUNNER_TEMP,target=env.SETTINGS_FILE;
 if(typeof temp!=='string'||typeof target!=='string'||!path.isAbsolute(temp)||!path.isAbsolute(target))reject('settings_output_invalid');
 const root=path.resolve(temp),file=path.resolve(target);
 if(path.dirname(file)!==root||path.basename(file)!=='current-staging-settings.json')reject('settings_output_invalid');
 return file;
}
const SAFE_SETTINGS_CODES=new Set(['settings_identity_invalid','settings_network_failed','settings_timeout','settings_http_rejected','settings_not_json','settings_oversized','settings_stream_missing','settings_stream_invalid','settings_interrupted','settings_invalid_json','settings_unrecognized','settings_binding_invalid','settings_output_invalid']);
export function safeDeployFailure(operation,error){
 let code,status;try{code=error?.code;status=error?.httpStatus}catch{}
 return {schema:'cosmic-staging-deploy-only-error-1',status:'FAIL',phase:['certification','rollback','access','settings'].includes(operation)?operation:'unknown',code:SAFE_SETTINGS_CODES.has(code)||SAFE_ACCESS_CODES.has(code)?code:'preflight_rejected',httpStatus:Number.isInteger(status)&&status>=100&&status<=599?status:null,paidRequests:0,releaseReady:false};
}
async function github(route){
 const response=await fetch('https://api.github.com/repos/'+PIN.repo+route,{headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200,'GitHub certification metadata unavailable');
 const text=await response.text();assert.ok(text.length<1_000_000);return JSON.parse(text);
}
async function main(){
 assertManualIdentity(process.env);
 if(process.argv[2]==='certification'){
  assert.equal(execFileSync('git',['ls-remote','origin','refs/heads/main'],{encoding:'utf8'}).split(/\s/)[0],process.env.GITHUB_SHA,'Main advanced');
  const changed=execFileSync('git',['diff','--name-only',PIN.commit,process.env.GITHUB_SHA],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  verifyCoordinatorChanges(changed);
  const run=await github('/actions/runs/'+PIN.run),jobs=await github('/actions/runs/'+PIN.run+'/jobs?per_page=100'),artifact=await github('/actions/artifacts/'+PIN.artifact),licensing=await github('/actions/runs/'+PIN.licensingRun);
  await writeFile('staging-certification-receipt.json',JSON.stringify(verifyCertification(run,jobs.jobs,artifact,licensing),null,2)+'\n');
  console.log('Pinned current-source CI/licensing/artifact eligible for STAGING only; native Safari FAIL/WAIVED.');
 }else if(process.argv[2]==='settings'){
  const target=stagingSettingsOutputPath(process.env);
  const settings=await readCurrentStagingBindings(process.env);
  await writeFile(target,JSON.stringify(settings)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});
  console.log('STAGING SETTINGS PASS: minimum existing bindings captured; no values logged.');
 }else if(process.argv[2]==='rollback'){
  verifyRollback(JSON.parse(await readFile('staging-before.json','utf8')));
  console.log('Current 100-percent staging version and source match reviewed rollback.');
 }else if(process.argv[2]==='access'){
  const receipt=JSON.parse(await readFile('staging-certification-receipt.json','utf8'));assert.equal(receipt.commit,PIN.commit);assert.equal(receipt.artifact,PIN.artifact);
  await checkProtectedStaging(process.env.STAGING_CF_AUTHORIZATION);
 }else throw Error('Unknown deployment-coordinator operation');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const logs=createToolDiagnostics({component:'staging-deploy',directory:process.env.RUNNER_TEMP?path.join(process.env.RUNNER_TEMP,'cosmic-tool-logs'):null,sink:event=>console.error(JSON.stringify(event))});
 const operation='staging-deploy',phase=['certification','settings','rollback','access'].includes(process.argv[2])?process.argv[2]:'unknown';
 logs.record({operation,phase,result:'started',errorCategory:'none'});
 try{await main();logs.record({operation,phase,result:'success',errorCategory:'none',exitCode:0})}
 catch(error){const safe=safeDeployFailure(process.argv[2],error);logs.record({operation,phase,result:'failure',errorCategory:safe.code,httpStatus:safe.httpStatus,exitCode:1});process.exitCode=1}
 const support=await logs.exportSupport();
 try{await writeFile('staging-tool-support.json',JSON.stringify(support)+'\n',{encoding:'utf8',mode:0o600})}catch{/* Log loss cannot change the primary deployment/read outcome. */}
}
