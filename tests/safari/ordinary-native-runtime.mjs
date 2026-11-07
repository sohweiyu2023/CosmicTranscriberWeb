import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {readFile,stat,lstat,copyFile,chmod,utimes} from 'node:fs/promises';
import path from 'node:path';

// Exact approved MP3 from certified4ec47b1f ZIP, including its original mtime.
// Git checkout mtime is not the artifact mtime; never mutate the source file.
export const CERTIFIED_ORDINARY_MP3=Object.freeze({size:16941,sha256:'e799ee1a44f73c9a4b146e76cce9deae6390ebc2aad3f51da13ce9dda2182b55',sliceSha256:'e48ee45b3f57d3837c75c83898d243a59bdccc0c4b8c40e45e5500475ea10702',mtimeNs:'315532800000000000'});
const hash=x=>createHash('sha256').update(x).digest('hex');
export async function ordinaryFileIdentity(file){const [bytes,s]=await Promise.all([readFile(file),stat(file,{bigint:true})]);return {size:bytes.length,sha256:hash(bytes),sliceSha256:hash(bytes.subarray(0,Math.min(1024,bytes.length))),mtimeNs:String(s.mtimeNs)}}
export async function materializeOrdinaryFixture(source,directory){
 assert.ok(path.isAbsolute(directory)&&path.basename(directory).startsWith('ctw-ordinary-safari-'),'Fixture destination must be an owned diagnostic directory');
 const dir=await lstat(directory);assert.ok(dir.isDirectory()&&!dir.isSymbolicLink(),'Fixture directory must not be a link');
 const before=await ordinaryFileIdentity(source);
 for(const field of ['size','sha256','sliceSha256'])assert.equal(before[field],CERTIFIED_ORDINARY_MP3[field],'Source must be exact reviewed MP3');
 const file=path.join(directory,'format.mp3');await copyFile(source,file,constants.COPYFILE_EXCL);await chmod(file,0o644);
 await utimes(file,315532800,315532800);
 assert.deepEqual(await ordinaryFileIdentity(file),CERTIFIED_ORDINARY_MP3,'Real disk copy must match certified bytes and original mtime');
 assert.deepEqual(await ordinaryFileIdentity(source),before,'Original source must remain unchanged');
 return {file,source:before,selected:{...CERTIFIED_ORDINARY_MP3}};
}

// Keep the loopback HTTP server responsive during OS commands. Only this
// spawned child can be terminated; no shell, process search or unrelated kill.
export function runOrdinaryProcess(command,args,{timeoutMs=16000,signal}={}){
 assert.ok(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=16000,'Bounded subprocess deadline required');
 return new Promise(resolve=>{
  const started=performance.now(),limit=32768;let child,error=null,timer,hardTimer,settleTimer,done=false,uncertain=false,outputTruncated=false;
  const chunks={stdout:[],stderr:[]},sizes={stdout:0,stderr:0};
  const finish=(status,childSignal)=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(hardTimer);clearTimeout(settleTimer);signal?.removeEventListener('abort',abort);resolve({status,signal:childSignal,stdout:Buffer.concat(chunks.stdout).toString('utf8'),stderr:Buffer.concat(chunks.stderr).toString('utf8'),error,elapsedMs:Math.round(performance.now()-started),outputTruncated,outcomeUncertain:uncertain||!!childSignal})};
  const stop=code=>{if(done||error)return;error=Object.assign(new Error('Owned diagnostic subprocess interrupted'),{code});uncertain=true;child?.kill('SIGTERM');hardTimer=setTimeout(()=>{if(!done)child?.kill('SIGKILL')},500);settleTimer=setTimeout(()=>finish(null,null),1000)};
  const abort=()=>stop('ABORT_ERR');
  if(signal?.aborted){error=Object.assign(new Error('Diagnostic cancelled before launch'),{code:'ABORT_ERR'});finish(null,null);return}
  try{child=spawn(command,args,{stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false})}catch(e){error=e;finish(null,null);return}
  for(const stream of ['stdout','stderr'])child[stream].on('data',data=>{const room=limit-sizes[stream];if(room>0){const kept=data.subarray(0,room);chunks[stream].push(kept);sizes[stream]+=kept.length}if(data.length>room){outputTruncated=true;stop('ENOBUFS')}}).on('error',()=>stop('EIO'));
  child.on('error',e=>{if(!error)error=e;if(!child.pid)finish(null,null);else{uncertain=true;if(!settleTimer)settleTimer=setTimeout(()=>finish(null,null),1000)}});child.on('close',(code,sig)=>finish(code,sig));
  timer=setTimeout(()=>stop('ETIMEDOUT'),timeoutMs);signal?.addEventListener('abort',abort,{once:true});
 });
}
export function createOrdinaryRunner(report,{capture=runOrdinaryProcess}={}){
 return async(cmd,args,timeout=16000)=>{
  const ui=cmd==='/usr/bin/osascript'||cmd==='/usr/bin/open';
  if(ui&&report.uiOutcomeUncertain)return {status:null,signal:null,error:{code:'EUNCERTAIN'},stdout:'',stderr:'',outcomeUncertain:true,elapsedMs:0,outputTruncated:false};
  const result=await capture(cmd,args,{timeoutMs:timeout});
  if(ui&&result.outcomeUncertain)report.uiOutcomeUncertain=true;
  return result;
 };
}
export async function waitOrdinaryReady(promise,timeoutMs=20000){
 assert.ok(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=20000,'Bounded page deadline required');
 let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('Ordinary page readiness timed out'),{name:'TimeoutError'})),timeoutMs)})])}finally{clearTimeout(timer)}
}
