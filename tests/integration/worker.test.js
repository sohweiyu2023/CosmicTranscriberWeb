import {beforeAll,beforeEach,afterAll,afterEach,describe,it,expect} from 'vitest';
import {http,HttpResponse} from 'msw/http';
import {setupServer} from 'msw/node';
import {createTestHarness} from 'wrangler';
import {SignJWT,generateKeyPair,exportJWK} from 'jose';
import net from 'node:net';

const network=setupServer();
// Upload mocks consume their request before replying, just as the successful
// multipart-inspection mocks do. Returning while Miniflare is still forwarding
// the upload can race early-response cancellation with Miniflare's queued close.
// Do not suppress that error: finish the stream, and let read failures fail tests.
const TEST_BYOK_MASTER_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const issuer='https://test.cloudflareaccess.com';
const audience='test-aud';
let server,worker,privateKey,jwk;
const origin='http://localhost';

// Node 26/Undici performs a socket Type-of-Service optimization. On macOS the
// kernel may reject that optional QoS call with synchronous EINVAL even though
// the HTTP request itself succeeds. Keep this workaround test-only, Darwin-only,
// and narrow to that exact syscall/code; every other socket error still throws.
let ctwRestoreDarwinTypeOfService=null;
function ctwInstallDarwinTypeOfServiceGuard(){
  if(process.platform!=='darwin')return ()=>{};
  const original=net.Socket.prototype.setTypeOfService;
  if(typeof original!=='function')return ()=>{};
  net.Socket.prototype.setTypeOfService=function(...args){
    try{return original.apply(this,args)}
    catch(error){
      if(error?.code==='EINVAL'&&error?.syscall==='setTypeOfService')return this;
      throw error;
    }
  };
  return ()=>{net.Socket.prototype.setTypeOfService=original;};
}

let ctwRestoreHarnessFetch=null;
function ctwInstallHarnessRequestNormalizer(){
  const mswFetch=globalThis.fetch;
  globalThis.fetch=(input,init)=>{
    const foreignRequest=Boolean(
      init && typeof init==='object' && init.body!=null &&
      !(init instanceof Request) &&
      typeof init.headers?.get==='function' &&
      typeof init.headers?.forEach==='function'
    );
    if(!foreignRequest)return mswFetch(input,init);

    const headers=new Headers();
    init.headers.forEach((value,name)=>headers.append(name,value));

    let signal=init.signal;
    if(signal && typeof AbortSignal!=='undefined' && !(signal instanceof AbortSignal)){
      const bridge=new AbortController();
      if(signal.aborted)bridge.abort(signal.reason);
      else signal.addEventListener?.('abort',()=>bridge.abort(signal.reason),{once:true});
      signal=bridge.signal;
    }

    return mswFetch(input,{
      method:init.method,
      headers,
      body:init.body,
      redirect:init.redirect,
      signal,
      duplex:'half'
    });
  };
  return ()=>{globalThis.fetch=mswFetch;};
}

beforeAll(async()=>{
  ctwRestoreDarwinTypeOfService=ctwInstallDarwinTypeOfServiceGuard();
  network.listen({onUnhandledFrame:'error'});
  ctwRestoreHarnessFetch=ctwInstallHarnessRequestNormalizer();
  const pair=await generateKeyPair('RS256');
  privateKey=pair.privateKey;
  jwk={...(await exportJWK(pair.publicKey)),kid:'test-key',alg:'RS256',use:'sig'};
  server=createTestHarness({workers:[{
    configPath:'./tests/integration/wrangler.test.jsonc',
    secrets:{BYOK_SESSION_MASTER_KEY_CURRENT:TEST_BYOK_MASTER_KEY}
  }]});
  await server.listen();
  worker=server.getWorker();
  await worker.applyD1Migrations('USER_DB');
});
beforeEach(()=>{
  network.use(http.get(`${issuer}/cdn-cgi/access/certs`,()=>HttpResponse.json({keys:[jwk]})));
});
afterEach(async()=>{
  network.resetHandlers();
  await server.reset();
  worker=server.getWorker();
  await worker.applyD1Migrations('USER_DB');
});
afterAll(async()=>{
  ctwRestoreHarnessFetch?.();
  ctwRestoreHarnessFetch=null;
  network.close();
  await server?.close();
  ctwRestoreDarwinTypeOfService?.();
  ctwRestoreDarwinTypeOfService=null;
});

async function accessToken(overrides={}){
  return new SignJWT({type:'app',sub:'integration-user',email:'integration-user@example.test',...overrides})
    .setProtectedHeader({alg:'RS256',kid:'test-key'})
    .setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(privateKey);
}
async function authHeaders(extra={}){return {'Cf-Access-Jwt-Assertion':await accessToken(),...extra}}
async function createSession(key='test-key'){
  const r=await worker.fetch(`${origin}/api/key/session`,{method:'POST',headers:await authHeaders({Origin:origin,'Content-Type':'application/json'}),body:JSON.stringify({apiKey:key})});
  expect(r.status).toBe(200);
  return (r.headers.get('set-cookie')||'').split(';',1)[0];
}
function twoFrameMpeg(){const out=new Uint8Array(834);out.set([0xff,0xfb,0x90,0x64],0);out.set([0xff,0xfb,0x90,0x64],417);return out}
const DEFAULT_MP3=twoFrameMpeg();
function metadata(overrides={}){
  return {v:2,audioFormat:'mp3',jobId:'job-1',fileId:'file-1',chunkIndex:1,chunkCount:1,attemptId:'attempt-1',declaredBytes:DEFAULT_MP3.length,durationSeconds:1,model:'gpt-transcribe',languages:[],keywords:[],prompt:'',requestKind:'transcription',...overrides};
}
function encodeMeta(value){return Buffer.from(JSON.stringify(value)).toString('base64url')}
async function transcribe(cookie,meta=metadata(),headers={},body=DEFAULT_MP3){
  return worker.fetch(`${origin}/api/transcribe`,{method:'POST',headers:await authHeaders({Origin:origin,'Content-Type':'audio/mpeg','X-Cosmic-Metadata':encodeMeta(meta),Cookie:cookie,...headers}),body});
}

describe('whole-Worker integration against real Wrangler entry/config',()=>{
  it('requires Access before serving static app assets and attaches security headers',async()=>{
    const missing=await worker.fetch(`${origin}/`);
    expect(missing.status).toBe(401);
    const valid=await worker.fetch(`${origin}/`,{headers:await authHeaders()});
    expect(valid.status).toBe(200);
    const html=await valid.text();
    expect(html).toContain('COSMIC TRANSCRIBER');
    expect(valid.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(valid.headers.get('x-frame-options')).toBe('DENY');
    expect(valid.headers.get('cache-control')).toContain('no-store');
  });

  it('requires a cryptographically valid Access JWT and ignores spoofable email header',async()=>{
    const missing=await worker.fetch(`${origin}/api/session/status`,{headers:{'Cf-Access-Authenticated-User-Email':'victim@example.test'}});
    expect(missing.status).toBe(401);
    const wrongAud=await new SignJWT({type:'app',sub:'integration-user',email:'integration-user@example.test'}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(issuer).setAudience('wrong-aud').setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const invalid=await worker.fetch(`${origin}/api/session/status`,{headers:{'Cf-Access-Jwt-Assertion':wrongAud}});
    expect(invalid.status).toBe(401);
    const valid=await worker.fetch(`${origin}/api/session/status`,{headers:await authHeaders()});
    expect(valid.status).toBe(200);
    const validBody=await valid.json();
    expect(validBody.principalScope).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const other=await worker.fetch(`${origin}/api/session/status`,{headers:{'Cf-Access-Jwt-Assertion':await accessToken({sub:'integration-user-2',email:'integration-user-2@example.test'})}});
    expect(other.status).toBe(200);
    expect((await other.json()).principalScope).not.toBe(validBody.principalScope);
  });

  it('registers authenticated users, exposes only their own account state, and denies admin APIs to non-admins',async()=>{
    const status=await worker.fetch(`${origin}/api/session/status`,{headers:await authHeaders()});
    expect(status.status).toBe(200);
    const body=await status.json();
    expect(body.account).toMatchObject({email:'integration-user@example.test',status:'active',isAdmin:false,registrationMode:'open'});
    expect(body.account).not.toHaveProperty('userId');
    const denied=await worker.fetch(`${origin}/api/admin/overview`,{headers:await authHeaders()});
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ok:false,error:{code:'admin_required'}});
  });

  it('supports approval registration and admin activation without weakening Access authentication',async()=>{
    const adminToken=await accessToken({sub:'admin-integration',email:'admin@example.test'});
    const adminHeaders={'Cf-Access-Jwt-Assertion':adminToken};
    const adminStatus=await worker.fetch(`${origin}/api/session/status`,{headers:adminHeaders});
    expect(adminStatus.status).toBe(200);
    expect((await adminStatus.json()).account).toMatchObject({status:'active',isAdmin:true});

    const mode=await worker.fetch(`${origin}/api/admin/settings/registration`,{
      method:'PUT',headers:{...adminHeaders,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({mode:'approval'})
    });
    expect(mode.status).toBe(200);

    const pendingToken=await accessToken({sub:'pending-integration',email:'pending-integration@example.test'});
    const pendingHeaders={'Cf-Access-Jwt-Assertion':pendingToken};
    const pendingStatus=await worker.fetch(`${origin}/api/session/status`,{headers:pendingHeaders});
    expect((await pendingStatus.json()).account).toMatchObject({status:'pending',registrationMode:'approval'});
    const blockedKey=await worker.fetch(`${origin}/api/key/session`,{
      method:'POST',headers:{...pendingHeaders,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({apiKey:'pending-user-key'})
    });
    expect(blockedKey.status).toBe(403);
    expect(await blockedKey.json()).toMatchObject({error:{code:'registration_pending'}});

    const users=await worker.fetch(`${origin}/api/admin/users?limit=100&offset=0`,{headers:adminHeaders});
    const list=await users.json();
    const pending=list.users.find(x=>x.email==='pending-integration@example.test');
    expect(pending).toMatchObject({status:'pending',isAdmin:false});
    expect(Number.isSafeInteger(pending.id)).toBe(true);
    expect(pending).not.toHaveProperty('subject');

    const activate=await worker.fetch(`${origin}/api/admin/users/${pending.id}`,{
      method:'PATCH',headers:{...adminHeaders,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({status:'active'})
    });
    expect(activate.status).toBe(200);
    const activeStatus=await worker.fetch(`${origin}/api/session/status`,{headers:pendingHeaders});
    expect((await activeStatus.json()).account.status).toBe('active');
  });

  it('closed registration refuses new Cosmic accounts while existing active users continue',async()=>{
    const existingToken=await accessToken({sub:'existing-integration',email:'existing-integration@example.test'});
    const existingHeaders={'Cf-Access-Jwt-Assertion':existingToken};
    expect((await (await worker.fetch(`${origin}/api/session/status`,{headers:existingHeaders})).json()).account.status).toBe('active');

    const adminToken=await accessToken({sub:'admin-close',email:'admin@example.test'});
    const adminHeaders={'Cf-Access-Jwt-Assertion':adminToken};
    await worker.fetch(`${origin}/api/session/status`,{headers:adminHeaders});
    const close=await worker.fetch(`${origin}/api/admin/settings/registration`,{
      method:'PUT',headers:{...adminHeaders,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({mode:'closed'})
    });
    expect(close.status).toBe(200);

    const freshToken=await accessToken({sub:'fresh-closed',email:'fresh-closed@example.test'});
    const fresh=await worker.fetch(`${origin}/api/session/status`,{headers:{'Cf-Access-Jwt-Assertion':freshToken}});
    expect((await fresh.json()).account.status).toBe('registration_closed');
    const existing=await worker.fetch(`${origin}/api/session/status`,{headers:existingHeaders});
    expect((await existing.json()).account.status).toBe('active');
  });

  it('rejects cross-origin credential setup before any upstream OpenAI request',async()=>{
    const r=await worker.fetch(`${origin}/api/key/session`,{method:'POST',headers:await authHeaders({Origin:'https://evil.test','Content-Type':'application/json'}),body:JSON.stringify({apiKey:'test-prefixless-key'})});
    expect(r.status).toBe(403);
  });

  it('does not reflect arbitrary credential-route field names in errors',async()=>{
    const sentinel='PRIVATE-SENTINEL-FIELD';
    const r=await worker.fetch(`${origin}/api/key/session`,{method:'POST',headers:await authHeaders({Origin:origin,'Content-Type':'application/json'}),body:JSON.stringify({apiKey:'test-key',[sentinel]:1})});
    const text=await r.text();
    expect(r.status).toBe(400);
    expect(text).not.toContain(sentinel);
  });

  it('rejects unknown key-test JSON fields before any OpenAI request',async()=>{
    const cookie=await createSession();
    const sentinel='PRIVATE-KEYTEST-FIELD';
    const r=await worker.fetch(`${origin}/api/key/test`,{method:'POST',headers:await authHeaders({Origin:origin,'Content-Type':'application/json',Cookie:cookie}),body:JSON.stringify({confirmMinimalUsage:true,[sentinel]:1})});
    const text=await r.text();
    expect(r.status).toBe(400);
    expect(text).not.toContain(sentinel);
  });

  it('creates BYOK session without echoing plaintext key',async()=>{
    const key='SEED-NO-PERSIST-KEY-7d9b4676';
    const r=await worker.fetch(`${origin}/api/key/session`,{method:'POST',headers:await authHeaders({Origin:origin,'Content-Type':'application/json'}),body:JSON.stringify({apiKey:key})});
    const text=await r.text();
    expect(r.status).toBe(200);
    expect(text).not.toContain(key);
    const set=r.headers.get('set-cookie')||'';
    expect(set).toContain('__Host-cosmic_byok=');
    expect(set).toContain('HttpOnly');
    expect(set).toContain('Secure');
    expect(set).toContain('SameSite=Strict');
    expect(set).not.toContain('Domain=');
  });

  it('constructs upstream Authorization from BYOK and ignores browser Authorization',async()=>{
    let seenAuth='',seenContentType='',seenModel='',seenFileSize=-1,handlerError=null,mockHits=0;
    network.use(http.post('https://api.openai.com/v1/audio/transcriptions',async({request})=>{
      mockHits++;
      seenAuth=request.headers.get('authorization')||'';
      seenContentType=request.headers.get('content-type')||'';
      try {
        // MSW documents the intercepted object as a standard Request and
        // recommends cloning before reading its body. Keep assertions OUT of
        // the resolver: an assertion thrown here becomes a synthetic network
        // failure and the Worker correctly classifies that as billing-ambiguous,
        // which would hide the real test failure behind a misleading HTTP 502.
        const form=await request.clone().formData();
        seenModel=String(form.get('model')||'');
        const file=form.get('file');
        seenFileSize=file&&typeof file==='object'&&Number.isFinite(file.size)?file.size:-1;
      } catch (error) {
        handlerError=error;
      }
      return HttpResponse.json({text:'ok'},{headers:{'x-request-id':'req_mock_auth'}});
    }));
    const cookie=await createSession('server-side-byok-key');
    const r=await transcribe(cookie,metadata(),{Authorization:'Bearer attacker-browser-token'});
    const responseText=await r.clone().text();
    expect(mockHits,'OpenAI MSW mock must be reached exactly once').toBe(1);
    expect(r.status,responseText).toBe(200);
    expect(handlerError).toBeNull();
    expect(seenAuth).toBe('Bearer server-side-byok-key');
    expect(seenContentType).toMatch(/^multipart\/form-data;\s*boundary=/i);
    expect(seenModel).toBe('gpt-transcribe');
    expect(seenFileSize).toBe(DEFAULT_MP3.length);
  });

  it('rejects malformed direct-format audio before paid dispatch and leaves the attempt reusable',async()=>{
    let upstreamHits=0;
    network.use(http.post('https://api.openai.com/v1/audio/transcriptions',async({request})=>{upstreamHits++;await request.clone().arrayBuffer();return HttpResponse.json({text:'ok'},{headers:{'x-request-id':'req_prebill_malformed'}})}));
    const cookie=await createSession('prebill-malformed-key');
    const valid=Uint8Array.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x41,0x56,0x45,1,2,3,4]);
    const invalid=Uint8Array.from([0x4e,0x4f,0x50,0x45,0,0,0,0,0x42,0x41,0x44,0x21,1,2,3,4]);
    const identity={v:2,audioFormat:'wav',jobId:'job-prebill-malformed',fileId:'file-prebill-malformed',chunkIndex:1,chunkCount:1,attemptId:'attempt-prebill-malformed',durationSeconds:1,model:'gpt-transcribe',languages:[],keywords:[],prompt:'',requestKind:'transcription'};
    const bad=await transcribe(cookie,{...identity,declaredBytes:invalid.length},{'Content-Type':'audio/wav'},invalid);
    expect(bad.status).toBe(415);expect(upstreamHits).toBe(0);
    const retry=await transcribe(cookie,{...identity,declaredBytes:valid.length},{'Content-Type':'audio/wav'},valid);
    expect(retry.status,await retry.clone().text()).toBe(200);expect(upstreamHits).toBe(1);
  });

  it('normalizes verified MPGA Layer III only at the upstream filename boundary without another paid attempt',async()=>{
    let upstreamHits=0,handlerError=null,seenFile=null,seenClientRequestId='';
    network.use(http.post('https://api.openai.com/v1/audio/transcriptions',async({request})=>{
      upstreamHits++;
      seenClientRequestId=request.headers.get('x-client-request-id')||'';
      try {
        const form=await request.clone().formData();
        const file=form.get('file');
        seenFile={name:file.name,type:file.type,bytes:new Uint8Array(await file.arrayBuffer())};
      } catch (error) {
        handlerError=error;
      }
      return HttpResponse.json({text:'MPGA accepted'},{headers:{'x-request-id':'req_mpga_filename'}});
    }));
    const cookie=await createSession('mpga-filename-key');
    const audio=twoFrameMpeg();
    audio[12]=0x37;audio[433]=0x5a;
    // Keep the public request format MPGA. Only the verified upstream filename
    // may change; its bytes, MIME, attempt identifier and duplicate guard may not.
    const identity=metadata({audioFormat:'mpga',jobId:'job-mpga-filename',fileId:'file-mpga-filename',attemptId:'attempt-mpga-filename',declaredBytes:audio.length});
    const accepted=await transcribe(cookie,identity,{'Content-Type':'audio/mpeg'},audio);
    expect(accepted.status,await accepted.clone().text()).toBe(200);
    expect(handlerError).toBeNull();
    expect(upstreamHits).toBe(1);
    expect(seenFile?.name).toBe('audio.mp3');
    expect(seenFile?.type).toBe('audio/mpeg');
    expect(seenFile?.bytes).toEqual(audio);
    expect(seenClientRequestId).toBe(`ctw-${identity.attemptId}`);
    expect((await accepted.json()).diagnostics.clientRequestId).toBe(`ctw-${identity.attemptId}`);

    const duplicate=await transcribe(cookie,identity,{'Content-Type':'audio/mpeg'},audio);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({error:{code:'duplicate_usage_attempt',details:{billingState:'ambiguous_after_dispatch'}}});
    const conflict=await transcribe(cookie,{...identity,model:'gpt-4o-mini-transcribe'},{'Content-Type':'audio/mpeg'},audio);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({error:{code:'usage_attempt_identity_mismatch',details:{billingState:'ambiguous_after_dispatch'}}});
    expect(upstreamHits).toBe(1);
  });

  it.each([
    ['Layer II',()=>{
      const audio=new Uint8Array(834);
      audio.set([0xff,0xfd,0x80,0x64],0);audio.set([0xff,0xfd,0x80,0x64],417);
      return audio;
    }],
    ['late mixed Layer II',()=>{
      const audio=new Uint8Array(1251);
      audio.set(twoFrameMpeg());audio.set([0xff,0xfd,0x80,0x64],834);
      return audio;
    }],
    ['truncated third frame',()=>{
      const audio=new Uint8Array(1034);
      audio.set(twoFrameMpeg());audio.set([0xff,0xfb,0x90,0x64],834);
      return audio;
    }]
  ])('rejects %s MPGA before dispatch and leaves its original attempt reusable',async(_label,makeInvalid)=>{
    let upstreamHits=0;
    network.use(http.post('https://api.openai.com/v1/audio/transcriptions',async({request})=>{
      upstreamHits++;
      await request.clone().arrayBuffer();
      return HttpResponse.json({text:'valid retry'},{headers:{'x-request-id':'req_mpga_prebilling'}});
    }));
    const cookie=await createSession('mpga-prebilling-key');
    const identity=metadata({audioFormat:'mpga',jobId:'job-mpga-prebilling',fileId:'file-mpga-prebilling',attemptId:'attempt-mpga-prebilling'});
    const invalid=makeInvalid();
    const rejected=await transcribe(cookie,{...identity,declaredBytes:invalid.length},{'Content-Type':'audio/mpeg'},invalid);
    expect(rejected.status,await rejected.clone().text()).toBe(415);
    expect(upstreamHits).toBe(0);
    const valid=twoFrameMpeg();
    const retry=await transcribe(cookie,{...identity,declaredBytes:valid.length},{'Content-Type':'audio/mpeg'},valid);
    expect(retry.status,await retry.clone().text()).toBe(200);
    expect(upstreamHits).toBe(1);
  });

  it('rejects client MPGA filename and upstream-format spoof fields without consuming an attempt',async()=>{
    let upstreamHits=0;
    network.use(http.post('https://api.openai.com/v1/audio/transcriptions',async({request})=>{
      upstreamHits++;
      await request.clone().arrayBuffer();
      return HttpResponse.json({text:'valid MPGA'});
    }));
    const cookie=await createSession('mpga-spoof-key');
    const audio=twoFrameMpeg();
    const identity=metadata({audioFormat:'mpga',jobId:'job-mpga-spoof',fileId:'file-mpga-spoof',attemptId:'attempt-mpga-spoof',declaredBytes:audio.length});
    for(const spoof of [{filename:'untrusted.wav'},{upstreamExtension:'wav'},{upstreamAudioFormat:'wav'}]){
      const rejected=await transcribe(cookie,{...identity,...spoof},{'Content-Type':'audio/mpeg'},audio);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({error:{code:'invalid_metadata'}});
      expect(upstreamHits).toBe(0);
    }
    const accepted=await transcribe(cookie,identity,{'Content-Type':'audio/mpeg'},audio);
    expect(accepted.status,await accepted.clone().text()).toBe(200);
    expect(upstreamHits).toBe(1);
  });

  it('rejects direct-format MIME mismatch and oversize metadata before paid dispatch without consuming attempt',async()=>{
    let upstreamHits=0;
    network.use(http.post('https://api.openai.com/v1/audio/transcriptions',async({request})=>{upstreamHits++;await request.clone().arrayBuffer();return HttpResponse.json({text:'ok'})}));
    const cookie=await createSession('prebill-bind-key');
    const valid=Uint8Array.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x41,0x56,0x45,1,2,3,4]);
    const base={v:2,audioFormat:'wav',jobId:'job-prebill-bind',fileId:'file-prebill-bind',chunkIndex:1,chunkCount:1,attemptId:'attempt-prebill-bind',durationSeconds:1,model:'gpt-transcribe',languages:[],keywords:[],prompt:'',requestKind:'transcription'};
    const mimeBad=await transcribe(cookie,{...base,declaredBytes:valid.length},{'Content-Type':'audio/ogg'},valid);
    expect(mimeBad.status).toBe(415);expect(upstreamHits).toBe(0);
    const oversize=await transcribe(cookie,{...base,declaredBytes:24_000_001},{'Content-Type':'audio/wav'},valid);
    expect(oversize.status).toBe(413);expect(upstreamHits).toBe(0);
    const retry=await transcribe(cookie,{...base,declaredBytes:valid.length},{'Content-Type':'audio/wav'},valid);
    expect(retry.status,await retry.clone().text()).toBe(200);expect(upstreamHits).toBe(1);
  });

  it('rejects a lone MPEG frame ending at EOF before paid dispatch and keeps the attempt reusable',async()=>{
    let upstreamHits=0;
    network.use(http.post('https://api.openai.com/v1/audio/transcriptions',async({request})=>{upstreamHits++;await request.clone().arrayBuffer();return HttpResponse.json({text:'ok'})}));
    const cookie=await createSession('prebill-mpeg-key');
    const exactEof=new Uint8Array(417);exactEof.set([0xff,0xfb,0x90,0x64],0);
    const identity={v:2,audioFormat:'mp3',jobId:'job-prebill-mpeg',fileId:'file-prebill-mpeg',chunkIndex:1,chunkCount:1,attemptId:'attempt-prebill-mpeg',durationSeconds:1,model:'gpt-transcribe',languages:[],keywords:[],prompt:'',requestKind:'transcription'};
    const bad=await transcribe(cookie,{...identity,declaredBytes:exactEof.length},{'Content-Type':'audio/mpeg'},exactEof);
    expect(bad.status).toBe(415);expect(upstreamHits).toBe(0);
    const valid=twoFrameMpeg();
    const retry=await transcribe(cookie,{...identity,declaredBytes:valid.length},{'Content-Type':'audio/mpeg'},valid);
    expect(retry.status,await retry.clone().text()).toBe(200);expect(upstreamHits).toBe(1);
  });

  it('rejects unsupported/realtime model before upstream',async()=>{
    const cookie=await createSession();
    const r=await transcribe(cookie,metadata({model:'gpt-realtime'}));
    expect(r.status).toBe(400);
  });

  it('never follows unexpected OpenAI redirect',async()=>{
    let redirectMockHits=0,redirectUploadedBytes=0;
    network.use(http.post('https://api.openai.com/v1/audio/transcriptions',async({request})=>{
      redirectMockHits++;
      redirectUploadedBytes=(await request.clone().arrayBuffer()).byteLength;
      return HttpResponse.redirect('https://evil.invalid/',302);
    }));
    const key='test-key';
    const cookie=await createSession(key);
    const r=await transcribe(cookie);
    expect(redirectMockHits,'redirect MSW mock must be reached exactly once').toBe(1);
    expect(redirectUploadedBytes,'mock must finish reading the multipart upload before redirecting').toBeGreaterThan(DEFAULT_MP3.length);
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(await r.text()).not.toContain(key);
  });
});
