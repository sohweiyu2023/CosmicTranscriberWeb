import assert from 'node:assert/strict';

const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// Cloudflared's CLI outputs a bare user JWT; it must be sent as
// Cf-Access-Token. An explicit CF_Authorization=... remains supported
// for callers intentionally supplying a browser-style cookie.
export function parseStagingAccessCredential(value){
  const s=String(value||'').trim();
  assert.ok(s.length>0&&s.length<=16384,'Missing secure staging identity');
  let authHeader='',accessCookie='';
  if(/^Authorization:\s*Bearer\s+\S+$/i.test(s))authHeader=s.replace(/^Authorization:\s*Bearer\s+/i,'');
  else if(/^Bearer\s+\S+$/i.test(s))authHeader=s.replace(/^Bearer\s+/i,'');
  else if(/^Cf-Access-Token:\s*\S+$/i.test(s))authHeader=s.replace(/^Cf-Access-Token:\s*/i,'');
  else if(/^Cookie:\s*CF_Authorization=[A-Za-z0-9._-]+$/i.test(s))accessCookie=s.replace(/^Cookie:\s*/i,'');
  else if(/^CF_Authorization=[A-Za-z0-9._-]+$/.test(s))accessCookie=s;
  else if(JWT.test(s))authHeader=s;
  else throw Error('Staging Access credential format not supported');
  if(authHeader&&!JWT.test(authHeader)){
    const error=Error('Access bearer credential must be a JWT');
    error.code='access_token_not_jwt';
    throw error;
  }
  return {authHeader,accessCookie};
}
