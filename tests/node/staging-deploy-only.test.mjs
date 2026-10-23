import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PIN,assertManualIdentity,verifyCertification,checkProtectedStaging,diagnoseProtectedStaging,accessClaimMetadata} from '../../scripts/staging-deploy-only.mjs';
const env=()=>({GITHUB_REPOSITORY:PIN.repo,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW:'Deploy pinned certified source to STAGING ONLY',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',CREDENTIAL_REVIEW:'owner-authorized-existing-secret-use'});
const names=['Resolve one reviewed dependency graph','Linux Worker + integration + browser matrix','Windows toolchain + Chrome/Edge + staging-certified ZIP','macOS native ZIP + WebKit/mobile + Chrome + real Safari','RELEASE BROWSER GATE - native Safari PASS or exact disclosed exception','STAGING PREFLIGHT - reviewed Safari26 automation exception, no final release'];
const metadata=()=>{const common={status:'completed',conclusion:'success',head_sha:PIN.commit,event:'push',head_branch:'main',run_attempt:1};return [{...common,id:PIN.run},names.map(name=>({name,status:'completed',conclusion:'success'})),{id:PIN.artifact,name:PIN.artifactName,expired:false,digest:PIN.outerDigest,workflow_run:{id:PIN.run,head_sha:PIN.commit}},{...common,id:PIN.licensingRun}]};
test('manual identity requires exact repo/workflow/main, first attempt and explicit owner authorization for existing secret use',()=>{
 assertManualIdentity(env());
 for(const change of [{GITHUB_EVENT_NAME:'push'},{GITHUB_REF:'refs/heads/other'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_WORKFLOW:'Other'},{GITHUB_REPOSITORY:'another/repo'},{CREDENTIAL_REVIEW:'unresolved-refuse-deployment'},{GITHUB_SHA:'bad'}])assert.throws(()=>assertManualIdentity({...env(),...change}));
});
test('pinned source certification requires every success plus exact unexpired artifact and license run',()=>{
 const m=metadata();assert.equal(verifyCertification(...m).releaseReady,false);
 for(const mutation of [x=>x[0].head_sha='b'.repeat(40),x=>x[0].run_attempt=2,x=>x[1].pop(),x=>x[1][0].conclusion='failure',x=>x[1].push(x[1][0]),x=>x[2].expired=true,x=>x[2].digest='wrong',x=>x[2].workflow_run.id++,x=>x[3].conclusion='failure']){const x=metadata();mutation(x);assert.throws(()=>verifyCertification(...x))}
});
test('protected preflight only GETs existing staging shell, redirects/errors/oversized responses fail closed',async()=>{
 let calls=0;const html='<!doctype html><title>Cosmic Transcriber Web</title><span id="appStatus"></span>';
 const fake=async(url,options)=>{calls++;assert.equal(url,'https://transcriber-staging.awakeningtoreality.com/');assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');return new Response(html,{headers:{'content-type':'text/html','cache-control':'no-store','content-security-policy':"frame-ancestors 'none'"}})};
 await checkProtectedStaging('a.b.c',fake);assert.equal(calls,1);
 await assert.rejects(checkProtectedStaging('',fake));assert.equal(calls,1);
 for(const response of [new Response('',{status:302}),new Response('',{status:403}),new Response(html,{headers:{'content-type':'text/html'}}),new Response('x'.repeat(33000),{headers:{'content-type':'text/html','cache-control':'no-store','content-security-policy':"frame-ancestors 'none'"}})])await assert.rejects(checkProtectedStaging('a.b.c',async()=>response));
});
test('manual workflow preserves deployment-only staging boundaries and existing paid guards',()=>{
 const text=readFileSync(new URL('../../.github/workflows/staging-deploy-only.yml',import.meta.url),'utf8');
 assert.match(text,/workflow_dispatch:/);assert.doesNotMatch(text,/^  (push|pull_request):/m);
 assert.match(text,/cancel-in-progress: false/);assert.match(text,/environment: staging/);
 assert.match(text,/default: unresolved-refuse-deployment/);
 assert.doesNotMatch(text,/STAGING_OPENAI_API_KEY|staging-live-acceptance|\/api\/transcribe|deploy:production|LOCAL_AUTH_BYPASS.*true/);
 assert.ok(text.indexOf('staging-deploy-only.mjs access')<text.indexOf('npm run deploy:staging'));
 assert.match(text,new RegExp(PIN.sourceDigest));assert.match(text,new RegExp(PIN.rollback));
 assert.match(text,/releaseReady.*false/);assert.match(text,/BYOK_SESSION_MASTER_KEY_CURRENT/);
 const old=readFileSync(new URL('../../scripts/staging-access-preflight.mjs',import.meta.url),'utf8');assert.match(old,/GITHUB_EVENT_NAME,'push'/);assert.match(old,/GITHUB_RUN_ATTEMPT,'1'/);
});

test('diagnostics emit only fixed categories, never token/error/body/identity/other claims',async()=>{
 const secret='DO-NOT-LEAK-SECRET';const jwt='abc.'+Buffer.from(JSON.stringify({exp:1,email:secret,aud:[secret],iss:secret})).toString('base64url')+'.sig';
 const meta=accessClaimMetadata(jwt,2);assert.equal(meta.unverifiedExpiry,'expired-claim');assert.equal(meta.signatureVerified,false);
 assert.equal(accessClaimMetadata('x.'+Buffer.from(JSON.stringify({exp:9999999999})).toString('base64url')+'.z',2).unverifiedExpiry,'future-claim');
 const missing=await diagnoseProtectedStaging('',()=>assert.fail('No network with missing credential'));assert.equal(missing.code,'access_credential_missing');
 const bad=await diagnoseProtectedStaging(secret,()=>assert.fail('No network with opaque credential'));assert.equal(bad.code,'access_credential_format');
 const redirect=await diagnoseProtectedStaging(jwt,async()=>new Response(secret,{status:302}));assert.equal(redirect.code,'access_redirect');assert.equal(redirect.httpStatus,302);
 const denied=await diagnoseProtectedStaging(jwt,async()=>new Response(secret,{status:403}));assert.equal(denied.code,'access_http_rejected');assert.equal(denied.httpStatus,403);
 const failed=await diagnoseProtectedStaging(jwt,async()=>{throw Error(secret)});assert.equal(failed.code,'access_network_failed');
 for(const value of [meta,missing,bad,redirect,denied,failed])assert.equal(JSON.stringify(value).includes(secret),false);
});
test('diagnostic workflow has no deployment, provider key, billing or policy-changing operation',()=>{
 const text=readFileSync(new URL('../../.github/workflows/staging-access-diagnostic.yml',import.meta.url),'utf8');
 assert.match(text,/workflow_dispatch:/);assert.match(text,/environment: staging/);assert.match(text,/github.run_attempt == '1'/);
 assert.doesNotMatch(text,/CLOUDFLARE_API_TOKEN|STAGING_OPENAI_API_KEY|wrangler|deploy:|migrations|configure-access|api\/transcribe/);
 assert.match(text,/diagnoseProtectedStaging/);assert.ok(text.includes("JSON.stringify(result,null,2)+'\\n'"),'Diagnostic artifact must end with a real newline escape');
});
