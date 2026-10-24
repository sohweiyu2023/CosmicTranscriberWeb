// Manual STAGING deployment coordinator; no paid/API-transcription operation.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {parseStagingAccessCredential} from './staging-access-credential.mjs';
export const PIN=Object.freeze({repo:'sohweiyu2023/CosmicTranscriberWeb',commit:'88ee4a683c8c277885f0737db53226e658390fae',run:40056803923,licensingRun:40056803922,artifact:12546575744,artifactName:'CosmicTranscriberWeb-1.2.0-staging-certified',outerDigest:'sha256:7ef92ed2ea8159badbf836d6594e05fc8829e672bdba8ee881b3b12d5a49c28c',sourceDigest:'eb50541cd16bc14b3d1aeb6b42e7ad6a9440cb09a60ef1370b9955cd8c4e3114',worker:'cosmic-transcriber-web-staging',rollback:'fdbfa10f-d2bb-4c22-bb32-90e6bb522ab7',rollbackSourceMessage:'Source82392336cfea5bc417098a2c6e3066dafca97b5b CI39872658149 artifact12468047768'});
const ORIGIN='https://transcriber-staging.awakeningtoreality.com',MAX_BYTES=32768;
const reject=(code,httpStatus=null)=>{const error=Error('Manual staging preflight rejected');error.code=code;if(Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599)error.httpStatus=httpStatus;throw error};
export function verifyCoordinatorChanges(changed){
 const allowed=['.github/workflows/staging-deploy-only.yml','scripts/staging-deploy-only.mjs','tests/node/staging-deploy-only.test.mjs','SHA256SUMS.txt'];
 assert.ok(Array.isArray(changed)&&changed.length>0);assert.equal(new Set(changed).size,changed.length);
 assert.ok(changed.every(x=>allowed.includes(x)),'Application/source changed beyond reviewed deployment coordinator');
}
export function verifyRollback(deployments){
 assert.ok(Array.isArray(deployments)&&deployments.length>0);
 assert.ok(deployments.every(x=>Number.isFinite(Date.parse(x.created_on))));
 const current=deployments.toSorted((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on))[0];
 assert.deepEqual(current.versions,[{version_id:PIN.rollback,percentage:100}]);
 assert.equal(current.sourceMessage,PIN.rollbackSourceMessage,'Current staging source changed');
 return current;
}
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
 }else if(process.argv[2]==='rollback'){
  verifyRollback(JSON.parse(await readFile('staging-before.json','utf8')));
  console.log('Current 100-percent staging version and source match reviewed rollback.');
 }else if(process.argv[2]==='access'){
  const receipt=JSON.parse(await readFile('staging-certification-receipt.json','utf8'));assert.equal(receipt.commit,PIN.commit);assert.equal(receipt.artifact,PIN.artifact);
  await checkProtectedStaging(process.env.STAGING_CF_AUTHORIZATION);
 }else throw Error('Unknown deployment-coordinator operation');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{await main()}catch{console.error('STAGING DEPLOY-ONLY preflight FAILED; no details/credentials logged. No paid requests.');process.exitCode=1}}
