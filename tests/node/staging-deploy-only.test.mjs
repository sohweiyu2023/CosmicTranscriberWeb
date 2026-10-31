import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {PIN,assertManualIdentity,verifyCertification,checkProtectedStaging,verifyCoordinatorChanges,verifyRollback,verifyRollbackEvidence,diagnoseProtectedStaging,accessClaimMetadata,readCurrentStagingBindings,stagingSettingsOutputPath,safeDeployFailure} from '../../scripts/staging-deploy-only.mjs';
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
 assert.match(text,new RegExp(PIN.sourceDigest));assert.equal(PIN.rollback,null);assert.equal(PIN.rollbackSourceMessage,null);
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

test('coordinator-only diff guard permits checksum update but rejects application and acceptance-pin drift',()=>{
 verifyCoordinatorChanges(['.github/workflows/staging-deploy-only.yml','scripts/staging-deploy-only.mjs','tests/node/staging-deploy-only.test.mjs','SHA256SUMS.txt']);
 for(const files of [[],['src/index.js'],['scripts/staging-remaining-eight-policy.mjs'],['wrangler.jsonc'],['SHA256SUMS.txt','SHA256SUMS.txt']])assert.throws(()=>verifyCoordinatorChanges(files));
});
test('missing live rollback stays blocked; pure evidence checks reject stale/split/wrong sources',()=>{
 const pins={rollback:'11111111-2222-3333-4444-555555555555',rollbackSourceMessage:'synthetic source annotation'};
 const row=()=>({created_on:'2026-10-31T00:00:00Z',versions:[{version_id:pins.rollback,percentage:100}],sourceMessage:pins.rollbackSourceMessage});
 assert.throws(()=>verifyRollback([row()]));assert.equal(verifyRollbackEvidence([row()],pins).sourceMessage,pins.rollbackSourceMessage);
 for(const change of [r=>r.versions[0].percentage=99,r=>r.versions[0].version_id='another-version',r=>r.versions.push({...r.versions[0]}),r=>r.sourceMessage='another-source',r=>r.created_on='invalid']){const value=row();change(value);assert.throws(()=>verifyRollbackEvidence([value],pins))}
 assert.throws(()=>verifyRollbackEvidence([row(),{...row(),created_on:'2026-10-31T01:00:00Z',sourceMessage:'newer-source'}],pins));
});
test('updated immutable pins and workflow stay synchronized without paid or production successor',()=>{
 const y=readFileSync(new URL('../../.github/workflows/staging-deploy-only.yml',import.meta.url),'utf8');
 assert.equal(PIN.commit,'d34edd9ef4cccf648d65c71a3b016d78fd76d7bf');assert.equal(PIN.run,41165444076);assert.equal(PIN.artifact,13029840169);assert.equal(PIN.licensingRun,41165444000);
 for(const value of [PIN.commit,String(PIN.run),String(PIN.artifact),PIN.sourceDigest])assert.ok(y.includes(value));
 assert.ok(y.includes('(cd "$GITHUB_WORKSPACE" && node scripts/staging-deploy-only.mjs rollback)'));assert.ok(y.includes('Main advanced before deployment'));
 assert.equal((y.match(/npm run deploy:staging/g)||[]).length,1);assert.doesNotMatch(y,/deploy:production|STAGING_OPENAI_API_KEY|api\/transcribe/);
});

const settingsEnv=()=>({CLOUDFLARE_ACCOUNT_ID:'1'.repeat(32),CLOUDFLARE_API_TOKEN:'synthetic-token-do-not-log',STAGING_WORKER_NAME:PIN.worker});
const settingsBody=()=>({success:true,result:{bindings:[...['ACCESS_TEAM_DOMAIN','ACCESS_AUDIENCE','ADMIN_EMAILS'].map(name=>({name,type:'plain_text',text:'synthetic-value'})),{name:'USER_DB',type:'d1',id:'11111111-2222-3333-4444-555555555555'},{name:'UNRELATED_PRIVATE',type:'plain_text',text:'synthetic-unrelated-do-not-persist'}]}});
const settingsResponse=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
test('settings read uses only exact account/Worker, internal authorization header and minimal binding projection',async()=>{
 const env=settingsEnv();let calls=0;const result=await readCurrentStagingBindings(env,async(url,options)=>{calls++;assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${PIN.worker}/settings`);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+env.CLOUDFLARE_API_TOKEN);return settingsResponse(settingsBody())});
 assert.equal(calls,1);assert.equal(result.result.bindings.length,4);assert.equal(JSON.stringify(result).includes(env.CLOUDFLARE_API_TOKEN),false);assert.equal(JSON.stringify(result).includes('synthetic-unrelated-do-not-persist'),false);
 const workflow=readFileSync(new URL('../../.github/workflows/staging-deploy-only.yml',import.meta.url),'utf8');assert.ok(workflow.includes('node scripts/staging-deploy-only.mjs settings'));assert.doesNotMatch(workflow,/curl --fail-with-body|Authorization: Bearer \$\{CLOUDFLARE_API_TOKEN\}/);
});
test('settings failures retain only fixed categories, never response/token/exception content',async()=>{
 const secret='synthetic-private-do-not-leak';
 for(const [make,code] of [[()=>new Response(secret,{status:403}),'settings_http_rejected'],[()=>new Response(secret,{status:302}),'settings_http_rejected'],[()=>new Response(secret,{headers:{'content-type':'text/html'}}),'settings_not_json'],[()=>new Response(secret,{headers:{'content-type':'application/json'}}),'settings_invalid_json'],[()=>new Response('x'.repeat(33000),{headers:{'content-type':'application/json'}}),'settings_oversized'],[()=>{throw Error(secret)},'settings_network_failed']])await assert.rejects(readCurrentStagingBindings(settingsEnv(),async()=>make()),error=>error.code===code&&!error.message.includes(secret));
 for(const env of [{...settingsEnv(),STAGING_WORKER_NAME:'production'},{...settingsEnv(),CLOUDFLARE_ACCOUNT_ID:'bad'},{...settingsEnv(),CLOUDFLARE_API_TOKEN:''}])await assert.rejects(readCurrentStagingBindings(env,()=>assert.fail('No network for invalid identity')),{code:'settings_identity_invalid'});
});
test('settings rejects duplicate/missing bindings and interrupted streams without retry',async()=>{
 const duplicate=settingsBody();duplicate.result.bindings.push(duplicate.result.bindings[0]);await assert.rejects(readCurrentStagingBindings(settingsEnv(),async()=>settingsResponse(duplicate)),{code:'settings_binding_invalid'});
 const missing=settingsBody();missing.result.bindings=[];await assert.rejects(readCurrentStagingBindings(settingsEnv(),async()=>settingsResponse(missing)),{code:'settings_binding_invalid'});
 let calls=0;await assert.rejects(readCurrentStagingBindings(settingsEnv(),async()=>{calls++;return new Response(new ReadableStream({start(c){c.error(Error('synthetic-private-stream-message'))}}),{headers:{'content-type':'application/json'}})}),error=>error.code==='settings_interrupted'&&!error.message.includes('synthetic-private-stream-message'));assert.equal(calls,1);
});

test('settings private output is exclusive and restricted to the existing runner temporary filename',()=>{
 const root=path.resolve(tmpdir(),'synthetic-runner'),file=path.join(root,'current-staging-settings.json');assert.equal(stagingSettingsOutputPath({RUNNER_TEMP:root,SETTINGS_FILE:file}),file);
 for(const candidate of [path.join(root,'other.json'),path.join(root,'..','current-staging-settings.json'),'relative.json'])assert.throws(()=>stagingSettingsOutputPath({RUNNER_TEMP:root,SETTINGS_FILE:candidate}),{code:'settings_output_invalid'});
 const source=readFileSync(new URL('../../scripts/staging-deploy-only.mjs',import.meta.url),'utf8');assert.ok(source.includes("flag:'wx',mode:0o600"));
});
test('deployment failure logs retain bounded phase/status categories without raw errors or unsupported fields',()=>{
 const secret='synthetic-token-and-private-settings';const unsafe=safeDeployFailure(secret,{code:secret,httpStatus:9999,message:secret,stack:secret,body:secret});assert.equal(unsafe.phase,'unknown');assert.equal(unsafe.code,'preflight_rejected');assert.equal(unsafe.httpStatus,null);assert.equal(JSON.stringify(unsafe).includes(secret),false);
 const known=safeDeployFailure('settings',{code:'settings_http_rejected',httpStatus:403,message:secret});assert.equal(known.code,'settings_http_rejected');assert.equal(known.httpStatus,403);assert.equal(JSON.stringify(known).includes(secret),false);
});
