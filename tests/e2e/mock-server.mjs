import https from 'node:https';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..','dist','public');
const ctwBuiltApp=await readFile(path.join(root,'js','app.js'),'utf8');
if(!ctwBuiltApp.includes('// CTW_RESTORED_PROMPT_BOUND'))throw new Error('Built E2E app is missing the reviewed restored-prompt repair.');
if(!ctwBuiltApp.includes('// CTW_RESTORED_KEYWORD_SEMANTICS'))throw new Error('Built E2E app is missing the reviewed restored-keyword semantic repair.');
if(!ctwBuiltApp.includes('// CTW_CANCEL_RACE_REPAIR'))throw new Error('Built E2E app is missing the reviewed cancellation-race repair.');
if(!ctwBuiltApp.includes('// CTW_FIREFOX_KEY_DIALOG_CLICK_REPAIR'))throw new Error('Built E2E app is missing the reviewed Firefox key-dialog click repair.');
const PORT=Number(process.env.COSMIC_E2E_PORT);
if(!Number.isInteger(PORT)||PORT<1024||PORT>65535)throw new Error('COSMIC_E2E_PORT must be a valid unprivileged TCP port.');
const E2E_TOKEN=String(process.env.COSMIC_E2E_TOKEN||'');
if(!/^[0-9a-f]{32}$/.test(E2E_TOKEN))throw new Error('COSMIC_E2E_TOKEN is missing or malformed.');
const ORIGIN=`https://localhost:${PORT}`;
const COOKIE='__Host-cosmic_byok=opaque-e2e-token';
const ct={html:'text/html;charset=utf-8',css:'text/css;charset=utf-8',js:'text/javascript;charset=utf-8',json:'application/json;charset=utf-8',mp3:'audio/mpeg'};
function json(res,status,obj,headers={}){res.writeHead(status,{'Content-Type':ct.json,'Cache-Control':'no-store',...headers});res.end(JSON.stringify(obj))}
function hasSession(req){return (req.headers.cookie||'').split(/;\s*/).includes(COOKIE)}
const tlsDir=mkdtempSync(path.join(tmpdir(),'cosmic-e2e-tls-'));
const tlsKeyPath=path.join(tlsDir,'key.pem');
const tlsCertPath=path.join(tlsDir,'cert.pem');
const openssl=spawnSync('openssl',[
  'req','-x509','-newkey','rsa:2048','-sha256','-nodes',
  '-keyout',tlsKeyPath,'-out',tlsCertPath,'-days','1',
  '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'
],{stdio:'pipe',windowsHide:true});
if(openssl.error||openssl.status!==0){
  rmSync(tlsDir,{recursive:true,force:true});
  throw new Error('Unable to generate ephemeral localhost TLS certificate for E2E.');
}
const tlsOptions={key:readFileSync(tlsKeyPath),cert:readFileSync(tlsCertPath)};
rmSync(tlsDir,{recursive:true,force:true});
const server=https.createServer(tlsOptions,async(req,res)=>{
  const u=new URL(req.url,ORIGIN);
  if(u.pathname==='/__cosmic_e2e_health'){if(u.searchParams.get('token')!==E2E_TOKEN){res.writeHead(403);return res.end('Forbidden')}return json(res,200,{ok:true,product:'cosmic-transcriber-web-e2e',version:'1.2.0'})}
  if(u.pathname.startsWith('/api/')){
    if(req.headers.origin&&req.headers.origin!==ORIGIN)return json(res,403,{ok:false,error:{code:'origin_rejected',message:'Cross-origin requests are not permitted.'}});
    if(u.pathname==='/api/session/status')return json(res,200,{ok:true,configured:hasSession(req),expiresAt:hasSession(req)?Math.floor(Date.now()/1000)+3600:null,principalScope:'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',version:'1.2.0',account:{status:'active',email:'e2e-user@example.test',isAdmin:false,registrationMode:'open',createdAt:1700000000,lastSeenAt:1700000000}});
    if(u.pathname==='/api/key/session'&&req.method==='POST'){
      let body='';for await(const c of req)body+=c;
      const key=JSON.parse(body).apiKey;
      if(!key)return json(res,400,{ok:false,error:{code:'key_malformed',message:'Enter an API key.'}});
      return json(res,200,{ok:true,configured:true,expiresAt:Math.floor(Date.now()/1000)+3600},{'Set-Cookie':`${COOKIE}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`});
    }
    if(u.pathname==='/api/key/forget')return json(res,200,{ok:true,configured:false},{'Set-Cookie':'__Host-cosmic_byok=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
    if(!hasSession(req))return json(res,401,{ok:false,error:{code:'key_session_invalid',message:'Configure an API key first.'}});
    if(u.pathname==='/api/key/test')return json(res,200,{ok:true,permitted:true,diagnostics:{openaiRequestId:'req_mock_keytest'}});
    if(u.pathname==='/api/transcribe'){
      let n=0;for await(const c of req)n+=c.length;
      return json(res,200,{ok:true,result:{text:'Mocked transcription result. <script>window.__xss=1</script>'},diagnostics:{appRequestId:'app_mock',openaiRequestId:'req_mock',status:200,receivedBytes:n}});
    }
    return json(res,404,{ok:false,error:{code:'not_found',message:'Not found'}});
  }
  let rel;
  try{rel=decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname)}catch{res.writeHead(400);return res.end('Bad request')}
  if(rel.includes('..')){res.writeHead(400);return res.end('Bad request')}
  const f=path.join(root,rel);
  try{const st=await stat(f);if(!st.isFile())throw new Error('not file');const ext=path.extname(f).slice(1);res.writeHead(200,{'Content-Type':ct[ext]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(await readFile(f))}
  catch{res.writeHead(404,{'Content-Type':'text/plain;charset=utf-8'});res.end('Not found')}
});
server.listen(PORT,'127.0.0.1',()=>console.log(`Cosmic E2E mock server ${ORIGIN}`));
