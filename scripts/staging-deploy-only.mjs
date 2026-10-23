// Manual STAGING deployment coordinator; no paid/API-transcription operation.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {parseStagingAccessCredential} from './staging-access-credential.mjs';
export const PIN=Object.freeze({repo:'sohweiyu2023/CosmicTranscriberWeb',commit:'82392336cfea5bc417098a2c6e3066dafca97b5b',run:39872658149,licensingRun:39872658103,artifact:12468047768,artifactName:'CosmicTranscriberWeb-1.2.0-staging-certified',outerDigest:'sha256:cfb3f70c6906da68b04478cce0ee23861f6ea83bb292a8948ff07ce88bbb7f3d',sourceDigest:'a12cc04d5f88b981fa9aa2dd5d704495dcee8e0aef0faf2f2455b0ded3ae44a0',worker:'cosmic-transcriber-web-staging',rollback:'31808bae-7ca6-4a38-b13f-042959a192de'});
const ORIGIN='https://transcriber-staging.awakeningtoreality.com',MAX_BYTES=32768;
const reject=code=>{const error=Error('Manual staging preflight rejected');error.code=code;throw error};
export function assertManualIdentity(env){
 assert.equal(env.GITHUB_REPOSITORY,PIN.repo);assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');
 assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
 assert.equal(env.GITHUB_WORKFLOW,'Deploy pinned certified source to STAGING ONLY');
 assert.match(env.GITHUB_SHA||'',/^[a-f0-9]{40}$/);assert.match(env.GITHUB_RUN_ID||'',/^[1-9][0-9]*$/);
 assert.equal(env.CREDENTIAL_REVIEW,'reviewed-safe-to-use','Deployment paused until exposed-token relationship/remediation is resolved');
}
export function verifyCertification(run,jobs,artifact,licensing){
 for(const value of [run,licensing]){assert.equal(value.status,'completed');assert.equal(value.conclusion,'success');assert.equal(value.head_sha,PIN.commit);assert.equal(value.event,'push');assert.equal(value.head_branch,'main');assert.equal(value.run_attempt,1)}
 assert.equal(run.id,PIN.run);assert.equal(licensing.id,PIN.licensingRun);
 const required=['Resolve one reviewed dependency graph','Linux Worker + integration + browser matrix','Windows toolchain + Chrome/Edge + staging-certified ZIP','macOS native ZIP + WebKit/mobile + Chrome + real Safari','RELEASE BROWSER GATE - native Safari PASS or exact disclosed exception','STAGING PREFLIGHT - reviewed Safari26 automation exception, no final release'];
 for(const name of required){const matches=jobs.filter(x=>x.name===name);assert.equal(matches.length,1);assert.equal(matches[0].status,'completed');assert.equal(matches[0].conclusion,'success')}
 assert.equal(artifact.id,PIN.artifact);assert.equal(artifact.name,PIN.artifactName);assert.equal(artifact.expired,false);assert.equal(artifact.digest,PIN.outerDigest);
 assert.equal(artifact.workflow_run.id,PIN.run);assert.equal(artifact.workflow_run.head_sha,PIN.commit);
 return {schema:'cosmic-manual-staging-ci-1',commit:PIN.commit,run:PIN.run,artifact:PIN.artifact,sourceDigest:PIN.sourceDigest,nativeSafari:'FAIL/WAIVED; genuine Mac Safari not validated',releaseReady:false};
}
export async function checkProtectedStaging(credential,fetchImpl=fetch){
  const {authHeader,accessCookie}=parseStagingAccessCredential(credential);
  const headers={};
  if(authHeader)headers['Cf-Access-Token']=authHeader;
  if(accessCookie)headers.Cookie=accessCookie;
  const response=await fetchImpl(ORIGIN+'/',{
    method:'GET',headers,redirect:'manual',signal:AbortSignal.timeout(20000)
  });
  if(response.status>=300&&response.status<400)reject('access_redirect');
  if(!response.ok)reject('access_http_rejected');
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
  const allowed=['.github/workflows/staging-deploy-only.yml','scripts/staging-deploy-only.mjs','tests/node/staging-deploy-only.test.mjs'];
  assert.ok(changed.length>0);assert.ok(changed.every(x=>allowed.includes(x)),'Application/source changed beyond reviewed deployment coordinator');
  const run=await github('/actions/runs/'+PIN.run),jobs=await github('/actions/runs/'+PIN.run+'/jobs?per_page=100'),artifact=await github('/actions/artifacts/'+PIN.artifact),licensing=await github('/actions/runs/'+PIN.licensingRun);
  await writeFile('staging-certification-receipt.json',JSON.stringify(verifyCertification(run,jobs.jobs,artifact,licensing),null,2)+'\n');
  console.log('Pinned current-source CI/licensing/artifact eligible for STAGING only; native Safari FAIL/WAIVED.');
 }else if(process.argv[2]==='access'){
  const receipt=JSON.parse(await readFile('staging-certification-receipt.json','utf8'));assert.equal(receipt.commit,PIN.commit);assert.equal(receipt.artifact,PIN.artifact);
  await checkProtectedStaging(process.env.STAGING_CF_AUTHORIZATION);
 }else throw Error('Unknown deployment-coordinator operation');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{await main()}catch{console.error('STAGING DEPLOY-ONLY preflight FAILED; no details/credentials logged. No paid requests.');process.exitCode=1}}
