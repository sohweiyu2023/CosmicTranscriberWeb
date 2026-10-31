import {fork,spawn} from 'node:child_process';
import {randomBytes,randomInt} from 'node:crypto';
import https from 'node:https';
import {createEphemeralLocalhostTlsOptions} from '../tests/e2e/ephemeral-tls.mjs';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..');
const expectedVersion=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
const failure=code=>Object.assign(new Error(`Cosmic E2E startup: ${code}`),{code});
const validPort=p=>Number.isInteger(p)&&p>=1024&&p<=65535;
export function probeOwnedHealth({port,token,cert},signal){
 return new Promise((resolve,reject)=>{
  const req=https.get({hostname:'127.0.0.1',port,servername:'localhost',path:`/__cosmic_e2e_health?token=${token}`,ca:cert,rejectUnauthorized:true,signal,timeout:5000},res=>{
   let data='';res.setEncoding('utf8');
   res.on('data',chunk=>{data+=chunk;if(data.length>1024)req.destroy(failure('health_oversized'))});
   res.on('error',()=>reject(failure('health_interrupted')));
   res.on('end',()=>{try{const v=JSON.parse(data);if(res.statusCode!==200||v.ok!==true||v.product!=='cosmic-transcriber-web-e2e'||v.version!==expectedVersion)throw 0;resolve()}catch{reject(failure('health_identity'))}});
  });
  req.once('timeout',()=>req.destroy(failure('health_timeout')));
  req.once('error',()=>reject(failure('health_failed')));
 });
}
function trackChild(child){
 let ended=false;
 const exit=new Promise(resolve=>{child.once('exit',(code,signal)=>{ended=true;resolve({code,signal})});child.once('error',()=>{if(!Number.isInteger(child.pid)){ended=true;resolve({code:null,signal:null,spawnFailed:true})}})});
 return {child,exit,get ended(){return ended},async stop(){
  if(ended)return;
  child.kill('SIGTERM');
  let timer;await Promise.race([exit,new Promise(resolve=>{timer=setTimeout(resolve,2000)})]);clearTimeout(timer);
  if(!ended){child.kill('SIGKILL');let last;await Promise.race([exit,new Promise(resolve=>{last=setTimeout(resolve,2000)})]);clearTimeout(last)}
  if(!ended)throw failure('owned_cleanup_unconfirmed');
 }};
}
export async function startOwnedMock({env=process.env,forkServer=fork,randomPort=()=>randomInt(20000,45000),probe=probeOwnedHealth,createTls=createEphemeralLocalhostTlsOptions,signal,startupTimeoutMs=15000,now=Date.now}={}){
 if(!Number.isInteger(startupTimeoutMs)||startupTimeoutMs<1||startupTimeoutMs>15000)throw failure('startup_timeout_invalid');
 const fixed=env.COSMIC_E2E_PORT!==undefined;
 const fixedPort=fixed?Number(env.COSMIC_E2E_PORT):null;
 if(fixed&&!validPort(fixedPort))throw failure('fixed_port_invalid');
 if(signal?.aborted)throw failure('cancelled');
 // Generate in this process: helper cleanup finishes before any killable child exists.
 const deadline=now()+45000;
 const tlsOptions=createTls();
 if(signal?.aborted)throw failure('cancelled');
 if(now()>=deadline)throw failure('startup_timeout');
 const token=randomBytes(16).toString('hex');
 for(let attempt=0;attempt<(fixed?1:8);attempt++){
  if(signal?.aborted)throw failure('cancelled');
  if(now()>=deadline)throw failure('startup_timeout');
  const port=fixed?fixedPort:randomPort();
  if(!validPort(port)||(!fixed&&(port<20000||port>=45000)))throw failure('candidate_port_invalid');
  const child=forkServer(path.join(root,'tests/e2e/mock-server.mjs'),[],{cwd:root,env:{...env,COSMIC_E2E_PORT:String(port),COSMIC_E2E_TOKEN:token,COSMIC_E2E_HTTP2:'1'},stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});
  const owned=trackChild(child);let timer,onAbort,onMessage,onError;
  try{
   const ready=await new Promise((resolve,reject)=>{
    onMessage=message=>{
     if(message?.type==='startup-error'){reject(failure(message.code==='EADDRINUSE'?'EADDRINUSE':'listen_failed'));return}
     if(message?.type!=='ready'||message.port!==port||typeof message.cert!=='string'||message.cert.length>8192||!message.cert.startsWith('-----BEGIN CERTIFICATE-----')){reject(failure('readiness_invalid'));return}
     resolve({port,token,cert:message.cert});
    };
    onError=()=>reject(failure('spawn_failed'));onAbort=()=>reject(failure('cancelled'));
    child.on('message',onMessage);child.once('error',onError);signal?.addEventListener('abort',onAbort,{once:true});
    owned.exit.then(()=>reject(failure('server_exited')));
    timer=setTimeout(()=>reject(failure('startup_timeout')),Math.min(startupTimeoutMs,Math.max(1,deadline-now())));
    // The private key crosses only this owned local IPC channel, never args/env/logs.
    child.send({type:'tls-init',key:String(tlsOptions.key),cert:String(tlsOptions.cert)},error=>{if(error)reject(failure('tls_handoff_failed'))});
   });
   clearTimeout(timer);child.off('message',onMessage);child.off('error',onError);signal?.removeEventListener('abort',onAbort);
   if(signal?.aborted||owned.ended)throw failure('server_exited');
   await probe(ready,signal);
   if(signal?.aborted||owned.ended)throw failure('server_exited');
   return {...ready,pid:child.pid,exit:owned.exit,stop:()=>owned.stop()};
  }catch(error){
   clearTimeout(timer);child.off('message',onMessage);child.off('error',onError);signal?.removeEventListener('abort',onAbort);
   // Retry only an explicit bind collision followed by confirmed child exit.
   // No browser test or provider request has started at this point.
   if(error.code==='EADDRINUSE'){
    let wait;const closed=await Promise.race([owned.exit,new Promise(resolve=>{wait=setTimeout(()=>resolve(null),2000)})]);clearTimeout(wait);
    if(!closed){await owned.stop();throw failure('collision_exit_unconfirmed')}
    if(closed.code!==1||closed.signal)throw failure('collision_exit_invalid');
    if(!fixed&&now()<deadline)continue;
   }
   await owned.stop();throw failure(error.code||'startup_failed');
  }
 }
 throw failure('collision_limit');
}
export async function runPlaywright(args,{env=process.env,spawnCli=spawn,start=startOwnedMock,signal}={}){
 let owned,tracked;
 try{
  owned=await start({env,signal});
  if(signal?.aborted)throw failure('cancelled');
  const cli=spawnCli(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),...args],{cwd:root,env:{...env,COSMIC_E2E_PORT:String(owned.port),COSMIC_E2E_TOKEN:owned.token,COSMIC_E2E_OWNED_SERVER:String(owned.pid)},stdio:'inherit',shell:false});
  tracked=trackChild(cli);
  let onAbort;
  const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(failure('cancelled'));signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort()});
  try{
   const status=await Promise.race([tracked.exit.then(v=>{if(v.spawnFailed)throw failure('playwright_spawn_failed');return v.code??1}),owned.exit.then(()=>{throw failure('server_exited_during_tests')}),cancelled]);
   if(signal?.aborted)throw failure('cancelled');
   return status;
  }finally{signal?.removeEventListener('abort',onAbort)}
 }finally{
  try{if(tracked)await tracked.stop()}finally{if(owned)await owned.stop()}
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const abort=new AbortController();for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>abort.abort());
 try{process.exitCode=await runPlaywright(process.argv.slice(2),{signal:abort.signal})}catch(error){console.error(`Cosmic E2E failed: ${/^[a-zA-Z_]+$/.test(error.code||'')?error.code:'unknown'}`);process.exitCode=1}
}
