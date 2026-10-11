import test from 'node:test';
import assert from 'node:assert/strict';
import {createCredentialSession,readCredentialSession,clearCredentialCookie} from '../../src/byok.js';
const enc=b=>Buffer.from(b).toString('base64url');
const K1=enc(Uint8Array.from({length:32},(_,i)=>i+1));const K2=enc(Uint8Array.from({length:32},(_,i)=>255-i));
const env={APP_ORIGIN:'https://transcriber.example.test',BYOK_KEY_VERSION_CURRENT:'2',BYOK_KEY_VERSION_PREVIOUS:'1',BYOK_SESSION_MASTER_KEY_CURRENT:K2,BYOK_SESSION_MASTER_KEY_PREVIOUS:K1};
function req(cookie){return new Request('https://transcriber.example.test/api/session/status',{headers:{Cookie:cookie}})}
function cookieOf(set){return set.split(';',1)[0]}

test('BYOK cookie is hardened and plaintext key is not visible',async()=>{const c=await createCredentialSession('test-secret-value',{sub:'user-a'},env,1000);assert.match(c.setCookie,/^__Host-cosmic_byok=/);assert.match(c.setCookie,/HttpOnly/);assert.match(c.setCookie,/Secure/);assert.match(c.setCookie,/SameSite=Strict/);assert.match(c.setCookie,/Path=\//);assert.doesNotMatch(c.setCookie,/Domain=/i);assert.doesNotMatch(c.setCookie,/test-secret-value/);const r=await readCredentialSession(req(cookieOf(c.setCookie)),{sub:'user-a'},env,{renew:false,nowSeconds:1001});assert.equal(r.apiKey,'test-secret-value')});

test('cookie is identity-bound, tamper-resistant and expires',async()=>{const c=await createCredentialSession('abc123',{sub:'user-a'},env,1000);const ck=cookieOf(c.setCookie);await assert.rejects(()=>readCredentialSession(req(ck),{sub:'user-b'},env,{renew:false,nowSeconds:1001}),/could not be authenticated/);const tampered=ck.slice(0,-1)+(ck.endsWith('A')?'B':'A');await assert.rejects(()=>readCredentialSession(req(tampered),{sub:'user-a'},env,{renew:false,nowSeconds:1001}));await assert.rejects(()=>readCredentialSession(req(ck),{sub:'user-a'},env,{renew:false,nowSeconds:1000+13*3600}),/expired/)});

test('rotation decrypts previous version and re-encrypts current version',async()=>{const oldEnv={...env,BYOK_KEY_VERSION_CURRENT:'1',BYOK_KEY_VERSION_PREVIOUS:'',BYOK_SESSION_MASTER_KEY_CURRENT:K1,BYOK_SESSION_MASTER_KEY_PREVIOUS:undefined};const old=await createCredentialSession('rotation-key',{sub:'user-a'},oldEnv,1000);const r=await readCredentialSession(req(cookieOf(old.setCookie)),{sub:'user-a'},env,{renew:true,nowSeconds:1001});assert.equal(r.apiKey,'rotation-key');assert.ok(r.renewal);const next=await readCredentialSession(req(cookieOf(r.renewal)),{sub:'user-a'},env,{renew:false,nowSeconds:1002});assert.equal(next.apiKey,'rotation-key')});

test('clear cookie has zero max-age and no domain',()=>{const c=clearCredentialCookie();assert.match(c,/Max-Age=0/);assert.doesNotMatch(c,/Domain=/i)});


test('renewal reports the renewed sliding expiry and cookie decrypts',async()=>{
  const created=await createCredentialSession('renewal-key',{sub:'user-a'},env,1000);
  const nearExpiry=created.expiresAt-30;
  const renewed=await readCredentialSession(req(cookieOf(created.setCookie)),{sub:'user-a'},env,{renew:true,nowSeconds:nearExpiry});
  assert.ok(renewed.renewal);
  assert.ok(renewed.expiresAt>created.expiresAt);
  const reopened=await readCredentialSession(req(cookieOf(renewed.renewal)),{sub:'user-a'},env,{renew:false,nowSeconds:nearExpiry+1});
  assert.equal(reopened.expiresAt,renewed.expiresAt);
  assert.equal(reopened.apiKey,'renewal-key');
});
