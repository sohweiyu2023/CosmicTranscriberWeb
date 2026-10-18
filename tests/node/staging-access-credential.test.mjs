import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStagingAccessCredential} from '../../scripts/staging-access-credential.mjs';

const jwt='eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOlsidGVzdCJdfQ.signature_123';
test('bare cloudflared user JWT uses Cf-Access-Token, not browser cookie',()=>{
  assert.deepEqual(parseStagingAccessCredential(jwt),{authHeader:jwt,accessCookie:''});
});
test('explicit Access cookie formats remain supported',()=>{
  for(const s of [`CF_Authorization=${jwt}`,`Cookie: CF_Authorization=${jwt}`]){
    assert.deepEqual(parseStagingAccessCredential(s),{authHeader:'',accessCookie:`CF_Authorization=${jwt}`});
  }
});
test('explicit bearer and Cf-Access-Token header forms normalize to user JWT',()=>{
  for(const s of [`Bearer ${jwt}`,`Authorization: Bearer ${jwt}`,`Cf-Access-Token: ${jwt}`]){
    assert.deepEqual(parseStagingAccessCredential(s),{authHeader:jwt,accessCookie:''});
  }
});
test('invalid and oversized credential values fail closed',()=>{
  for(const s of ['', 'opaque-token', 'Bearer not-a-jwt', 'CF_Authorization=invalid cookie', 'x'.repeat(16385)]){
    assert.throws(()=>parseStagingAccessCredential(s));
  }
});
