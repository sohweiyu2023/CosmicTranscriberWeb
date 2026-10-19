import {describe,it,expect} from 'vitest';
import {SignJWT,generateKeyPair} from 'jose';
import {authenticateAccess,verifyAccessToken} from '../../src/access.js';
import {validateApiKey,validateOrigin,validateTranscriptionMetadata} from '../../src/validation.js';
import {createCredentialSession,readCredentialSession} from '../../src/byok.js';
const env={APP_ORIGIN:'https://transcriber.test',APP_VERSION:'1.2.0',DEPLOYMENT_ENV:'development',BYOK_KEY_VERSION_CURRENT:'1',BYOK_KEY_VERSION_PREVIOUS:'',BYOK_SESSION_MASTER_KEY_CURRENT:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'};
const principal={sub:'runtime-user'};
describe('Workers-runtime security primitives',()=>{
 it('AES-GCM credential session is HttpOnly/Secure/Strict and identity bound',async()=>{const made=await createCredentialSession('prefixless-test-key',principal,env,1000);expect(made.setCookie).toContain('HttpOnly');expect(made.setCookie).toContain('Secure');expect(made.setCookie).toContain('SameSite=Strict');const req=new Request('https://transcriber.test/api/session/status',{headers:{Cookie:made.setCookie.split(';',1)[0]}});const opened=await readCredentialSession(req,principal,env,{nowSeconds:1001,renew:false});expect(opened.apiKey).toBe('prefixless-test-key');await expect(readCredentialSession(req,{sub:'different-user'},env,{nowSeconds:1001,renew:false})).rejects.toMatchObject({code:'key_session_invalid'})});
 it('validates origin and does not assume sk prefix',()=>{expect(validateApiKey('abc_123.project-key')).toBe('abc_123.project-key');expect(()=>validateOrigin(new Request('https://transcriber.test/api/x',{method:'POST',headers:{Origin:'https://evil.test'}}),env)).toThrow()});

 it('cryptographically rejects wrong Access issuer/audience/type/expiry and spoofed email alone',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const accessEnv={ACCESS_TEAM_DOMAIN:'https://test.cloudflareaccess.com',ACCESS_AUDIENCE:'aud-1',DEPLOYMENT_ENV:'production',LOCAL_AUTH_BYPASS:'false'};
  const make=async(claims={},opts={})=>new SignJWT({type:'app',sub:'user-123',email:'user@example.test',...claims}).setProtectedHeader({alg:'RS256'}).setIssuer(opts.issuer||'https://test.cloudflareaccess.com').setAudience(opts.audience||'aud-1').setIssuedAt().setExpirationTime(opts.exp||'5m').sign(privateKey);
  expect(await verifyAccessToken(await make(),accessEnv,publicKey)).toMatchObject({sub:'user-123',email:'user@example.test',source:'access'});
  await expect(verifyAccessToken(await make({}, {audience:'wrong-aud'}),accessEnv,publicKey)).rejects.toBeTruthy();
  await expect(verifyAccessToken(await make({}, {issuer:'https://other.cloudflareaccess.com'}),accessEnv,publicKey)).rejects.toBeTruthy();
  await expect(verifyAccessToken(await make({type:'service'}),accessEnv,publicKey)).rejects.toBeTruthy();
  await expect(verifyAccessToken(await make({email:undefined}),accessEnv,publicKey)).rejects.toBeTruthy();
  await expect(verifyAccessToken(await make({email:'not-an-email'}),accessEnv,publicKey)).rejects.toBeTruthy();
  await expect(verifyAccessToken(await make({email:'victim @example.test'}),accessEnv,publicKey)).rejects.toBeTruthy();
  await expect(verifyAccessToken(await make({}, {exp:'-1m'}),accessEnv,publicKey)).rejects.toBeTruthy();
  const noExp=new SignJWT({type:'app',sub:'user-123',email:'user@example.test'}).setProtectedHeader({alg:'RS256'}).setIssuer('https://test.cloudflareaccess.com').setAudience('aud-1').setIssuedAt().sign(privateKey);
  await expect(verifyAccessToken(noExp,accessEnv,publicKey)).rejects.toBeTruthy();
  const futureIat=new SignJWT({type:'app',sub:'user-123',email:'user@example.test'}).setProtectedHeader({alg:'RS256'}).setIssuer('https://test.cloudflareaccess.com').setAudience('aud-1').setIssuedAt(Math.floor(Date.now()/1000)+120).setExpirationTime('10m').sign(privateKey);
  await expect(verifyAccessToken(futureIat,accessEnv,publicKey)).rejects.toBeTruthy();
  await expect(verifyAccessToken(await make(),{...accessEnv,ACCESS_TEAM_DOMAIN:'https://test.cloudflareaccess.com:8443'},publicKey)).rejects.toBeTruthy();
  await expect(verifyAccessToken(await make(),{...accessEnv,ACCESS_TEAM_DOMAIN:'https://.cloudflareaccess.com'},publicKey)).rejects.toBeTruthy();
  const spoof=new Request('https://transcriber.test/api/session/status',{headers:{'Cf-Access-Authenticated-User-Email':'victim@example.test'}});
  await expect(authenticateAccess(spoof,accessEnv)).rejects.toMatchObject({code:'access_required'});
 });
 it('rejects realtime/unknown completed-file model',()=>{expect(()=>validateTranscriptionMetadata({v:1,jobId:'j',fileId:'f',chunkIndex:1,chunkCount:1,attemptId:'a',declaredBytes:100,durationSeconds:1,model:'gpt-realtime',languages:[],keywords:[],prompt:'',requestKind:'transcription'})).toThrow()});
});
