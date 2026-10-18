import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const fixture=`
import {writeFileSync} from 'node:fs';
globalThis.fetch=async(url,options)=>{
 const calls=JSON.parse(process.env.PREFLIGHT_LOG||'[]');
 calls.push({url,method:options.method,redirect:options.redirect,header:Object.keys(options.headers),auth:options.headers['Cf-Access-Token']||null,cookie:options.headers.Cookie||null});
 writeFileSync(process.env.PREFLIGHT_LOG_PATH,JSON.stringify(calls));
 const mode=process.env.PREFLIGHT_SCENARIO;
 if(mode==='network')throw Error('secret should never be printed');
 if(mode==='redirect')return new Response('',{status:302,headers:{location:'https://access.example.invalid'}});
 if(mode==='denied')return new Response('',{status:403});
 if(mode==='wrong-type')return new Response('text',{headers:{'content-type':'application/json'}});
 if(mode==='oversized')return new Response('x'.repeat(33000),{headers:{'content-type':'text/html','cache-control':'no-store','content-security-policy':"frame-ancestors 'none'"}});
 if(mode==='missing-csp')return new Response('<!doctype html><title>Cosmic Transcriber Web</title><div id="appStatus"></div>',{headers:{'content-type':'text/html','cache-control':'no-store'}});
 if(mode==='missing-no-store')return new Response('<!doctype html><title>Cosmic Transcriber Web</title><div id="appStatus"></div>',{headers:{'content-type':'text/html','content-security-policy':"frame-ancestors 'none'"}});
 const body=mode==='login-page'?'<html><title>Cloudflare Access Login</title></html>':'<!doctype html><html><head><title>Cosmic Transcriber Web</title></head><body><span id="appStatus">Checking</span></body></html>';
 return new Response(body,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store, max-age=0','content-security-policy':"frame-ancestors 'none'"}});
};`;
const cases=[
 ['bare JWT succeeds','ok','a.b.c',0],
 ['explicit cookie succeeds','ok','CF_Authorization=a.b.c',0],
 ['redirect fails closed','redirect','a.b.c',1],
 ['403 fails closed','denied','a.b.c',1],
 ['non-HTML fails closed','wrong-type','a.b.c',1],
 ['oversized response fails closed','oversized','a.b.c',1],
 ['Access login page fails closed','login-page','a.b.c',1],
 ['missing app CSP fails closed','missing-csp','a.b.c',1],
 ['missing no-store fails closed','missing-no-store','a.b.c',1],
 ['network failure fails closed','network','a.b.c',1],
 ['missing credential fails before network','ok','',1],
 ['invalid workflow attempt fails before network','ok','a.b.c',1,{GITHUB_RUN_ATTEMPT:'2'}],
];
for(const [name,scenario,credential,expected,overrides={}] of cases){
 test(`predeploy ${name}`,()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'ctw-access-preflight-'));
  try{
   const mock=path.join(dir,'mock.mjs');const log=path.join(dir,'calls.json');
   writeFileSync(mock,fixture);writeFileSync(log,'[]');
   const env={...process.env,GITHUB_EVENT_NAME:'push',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'38224473067',GITHUB_REF:'refs/heads/ci/v1.2.0-production-readiness',GITHUB_SHA:'2a52e2020cfe159454697b3077a0c5ed21d6a14b',STAGING_CF_AUTHORIZATION:credential,PREFLIGHT_SCENARIO:scenario,PREFLIGHT_LOG_PATH:log,...overrides};
   const child=spawnSync(process.execPath,['--import',mock,path.join(root,'scripts/staging-access-preflight.mjs')],{cwd:root,env,encoding:'utf8',timeout:20000});
   assert.equal(child.error,undefined,String(child.error));
   assert.equal(child.status,expected,child.stderr);
   const calls=JSON.parse(readFileSync(log,'utf8'));
   assert.equal(calls.length,credential&&overrides.GITHUB_RUN_ATTEMPT!=='2'?1:0);
   if(calls.length){
    assert.equal(calls[0].url,'https://transcriber-staging.awakeningtoreality.com/');
    assert.equal(calls[0].method,'GET');assert.equal(calls[0].redirect,'manual');
    if(credential.startsWith('CF_Authorization='))assert.equal(calls[0].cookie,credential);
    else assert.equal(calls[0].auth,credential);
   }
   assert.ok(!child.stdout.includes('a.b.c')&&!child.stderr.includes('a.b.c'),'Credentials must not appear in logs');
   assert.ok(!child.stderr.includes('secret should never be printed'),'Exception text must be sanitized');
  }finally{rmSync(dir,{recursive:true,force:true})}
 });
}
test('staging Access check precedes archive extraction, D1 migration and deployment',()=>{
 const workflow=readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8');
 const section=workflow.split('  deploy-staging-certified:')[1].split('  staging-live-nine-formats:')[0];
 assert.match(section,/STAGING_CF_AUTHORIZATION: \$\{\{ secrets\.STAGING_CF_AUTHORIZATION \}\}/);
 const preflight=section.indexOf('node scripts/staging-access-preflight.mjs');
 assert.ok(preflight>0);
 for(const action of ['actions/download-artifact@','npm run deploy:staging']){
  assert.ok(section.indexOf(action)>preflight,`${action} must occur after Access preflight`);
 }
});

test('predeploy uses protected static route and cannot trigger Worker D1 registry resolution',()=>{
 const source=readFileSync(path.join(root,'scripts/staging-access-preflight.mjs'),'utf8');
 const worker=readFileSync(path.join(root,'src/index.js'),'utf8');
 assert.match(source,/fetch\(ORIGIN\+'\/'/);
 assert.doesNotMatch(source,/fetch\(ORIGIN\+'\/api\//);
 assert.match(worker,/const principal = await authenticateAccess\(request, env\);\s*if \(!url\.pathname\.startsWith\("\/api\/"\)\) return await authenticatedAssetResponse\(request, env\);\s*const account = await resolveUserAccount\(env, principal\);/);
});
