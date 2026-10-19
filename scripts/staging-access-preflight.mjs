// Nonbillable, D1-read-only staging Access/JWT check. This must pass before
// deployment or D1 migration. The existing Worker authenticates ALL paths,
// but /api/* resolves the registry (and can INSERT/UPDATE); therefore request
// the protected app shell instead. Account status is verified separately after
// deployment and immediately before any paid request.
import assert from 'node:assert/strict';
import {parseStagingAccessCredential} from './staging-access-credential.mjs';

const ORIGIN='https://transcriber-staging.awakeningtoreality.com';
const MAX_BYTES=32768;
const reject=(code)=>{const error=new Error('Staging Access preflight rejected');error.code=code;throw error};

async function check(){
  // Do not allow a rerun or manual workflow to exercise staging credentials.
  assert.equal(process.env.GITHUB_EVENT_NAME,'push');
  assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
  assert.equal(process.env.GITHUB_REF,'refs/heads/ci/v1.2.0-production-readiness');
  assert.match(process.env.GITHUB_SHA||'',/^[0-9a-f]{40}$/);
  assert.match(process.env.GITHUB_RUN_ID||'',/^[1-9][0-9]{0,19}$/);
  const {authHeader,accessCookie}=parseStagingAccessCredential(process.env.STAGING_CF_AUTHORIZATION);
  const headers={};
  if(authHeader)headers['Cf-Access-Token']=authHeader;
  if(accessCookie)headers.Cookie=accessCookie;
  const response=await fetch(ORIGIN+'/',{
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
try{await check()}catch(error){
  const safe=typeof error?.code==='string'&&/^[a-z0-9_-]{1,64}$/i.test(error.code)?error.code:'access_preflight_failed';
  console.error('STAGING ACCESS PREFLIGHT FAIL: '+safe+'; zero paid requests');
  process.exitCode=1;
}
