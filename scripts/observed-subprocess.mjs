// Bounded process diagnostics. Raw output exists only in memory and is never
// returned, persisted or sent to the diagnostic sink. No automatic retries.
import {spawn} from 'node:child_process';
import {createToolDiagnostics} from './tooling-diagnostics.mjs';
const commands=new Set(['wrangler-whoami','wrangler-deployments-read','wrangler-device-login','package-verification','artifact-download']);
const knownNames=new Set(['Error','TypeError','SyntaxError','RangeError','AbortError','TimeoutError','AssertionError']);
const patterns=[
 ['invocation_scope_rejected',/Invalid authentication scope:|\binvalid_scope\b|\bunsupported_grant_type\b/i],
 ['auth_not_authenticated',/not authenticated|not logged in|not logged into|not logged-in/i],
 ['auth_device_expired',/expired_token|device.{0,30}expired|authorization.{0,30}expired|code has expired/i],
 ['auth_consent_denied',/access_denied|authorization.{0,20}(declined|denied)/i],
 ['secure_storage_unavailable',/keyring.{0,80}(unavailable|failed|error|not installed|not available)|keytar.{0,40}(failed|error)|@napi-rs\/keyring.{0,80}required/i],
 ['authorization_rejected',/Resource not accessible by integration|HTTP.?40[13]|status.?40[13]|Forbidden|\binvalid_client\b|\bunauthorized_client\b/i],
 ['malformed_response',/device authorization endpoint returned[^\n]{0,120}could not be interpreted|Unusable token response body/i],
 ['dns_failure',/ENOTFOUND|getaddrinfo/i],
 ['tls_failure',/CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|certificate.{0,30}(failed|verify)/i],
 ['dependency_missing',/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Cannot find module/i],
 ['native_dependency_failure',/ERR_DLOPEN_FAILED|not a valid Win32 application/i],
 ['network_failure',/ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed/i],
 ['auth_pending',/To authorize|and enter the code:/i],
 ['auth_authenticated',/Successfully logged in|You are logged in/i]
];
export function classifySubprocessText(text){return patterns.filter(([,pattern])=>pattern.test(text)).map(([category])=>category)}
export async function runObservedCommand({commandId,file,args=[],cwd,env,timeoutMs=30000,signal,diagnostics,expectedAccountId=null,spawnImpl=spawn}={}){
 const log=diagnostics||createToolDiagnostics({component:'unknown'});
 const mutating=commandId==='wrangler-device-login';
 if(expectedAccountId!==null&&(typeof expectedAccountId!=='string'||!/^[a-f0-9]{32}$/.test(expectedAccountId))||!commands.has(commandId)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>(mutating?330000:120000)){
  log.record({operation:commandId,phase:'preflight',result:'blocked',errorCategory:'invocation_scope_rejected'});
  return {status:'blocked',exitCode:null,errorCategory:'invocation_scope_rejected',automaticRetry:false,requiresReconciliation:false,diagnostics:await log.flush()};
 }
 if(signal?.aborted){log.record({operation:commandId,phase:'preflight',result:'cancelled',errorCategory:'cancelled',reconciliationRequired:mutating});return {status:'cancelled',exitCode:null,errorCategory:'cancelled',automaticRetry:false,requiresReconciliation:mutating,diagnostics:await log.flush()}}
 log.record({operation:commandId,phase:'start',result:'started',errorCategory:'none'});
 const captured={stdout:{bytes:0,text:'',truncated:false,labels:new Set()},stderr:{bytes:0,text:'',truncated:false,labels:new Set()}};
 let accountMatched=expectedAccountId===null?null:false,observedHttpStatus=null;
 let interrupt=()=>{},child,reason=null,exceptionType='unknown',exited=false,closed=false,exitCode=null,exitSignal=null,timer,onAbort;
 let resolveExit,resolveClose;const exit=new Promise(r=>{resolveExit=r}),close=new Promise(r=>{resolveClose=r});
 const capture=(stream,data)=>{
  let b;try{b=Buffer.isBuffer(data)?data:Buffer.from(data)}catch{reason??='malformed_response';interrupt();return}
  const out=captured[stream];out.bytes=Math.min(1e9,out.bytes+b.length);
  for(let at=0;at<b.length;at+=4096){
   const text=out.text+b.subarray(at,at+4096).toString('utf8').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g,'');
   if(expectedAccountId&&text.includes(expectedAccountId))accountMatched=true;
   const statusMatch=text.match(/\b(?:HTTP(?:\/\d(?:\.\d)?)?\s+|status[\s:=]+)([1-5]\d\d)\b/i);if(statusMatch)observedHttpStatus=Number(statusMatch[1]);
   for(const label of classifySubprocessText(text))out.labels.add(label);
   out.text=text.slice(-256);
  }
  if(out.bytes>16384)out.truncated=true;

 };
 const onStdout=data=>capture('stdout',data),onStderr=data=>capture('stderr',data),onStreamError=()=>{reason??='process_failure';interrupt()};
 try{
  child=spawnImpl(file,args,{cwd,env,stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true});
  child.stdout?.on('data',onStdout);child.stderr?.on('data',onStderr);child.stdout?.on('error',onStreamError);child.stderr?.on('error',onStreamError);
  child.once('exit',(code,sig)=>{exited=true;exitCode=Number.isInteger(code)?code:null;exitSignal=sig;resolveExit()});
  child.once('close',()=>{closed=true;resolveClose()});
  child.once('error',error=>{reason??='spawn_failure';interrupt();exceptionType=knownNames.has(error?.name)?error.name:'unknown';if(!Number.isInteger(child.pid)){exited=true;closed=true;resolveExit();resolveClose()}});
  const stop=new Promise(resolve=>{
   interrupt=resolve;
   onAbort=()=>{reason??='cancelled';resolve()};signal?.addEventListener('abort',onAbort,{once:true});
   timer=setTimeout(()=>{reason??='timeout';resolve()},timeoutMs);
   if(signal?.aborted)onAbort();
  });
  await Promise.race([close,stop]);
 }catch(error){reason??='spawn_failure';exceptionType=knownNames.has(error?.name)?error.name:'unknown'}
 finally{
  clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
  if(child&&!exited){
   try{child.kill('SIGTERM')}catch{reason??='process_failure'}
   let wait;await Promise.race([exit,new Promise(r=>{wait=setTimeout(r,2000)})]);clearTimeout(wait);
   if(!exited){try{child.kill('SIGKILL')}catch{reason??='process_failure'}let last;await Promise.race([exit,new Promise(r=>{last=setTimeout(r,2000)})]);clearTimeout(last)}
  }
  if(child&&!closed){let wait;await Promise.race([close,new Promise(r=>{wait=setTimeout(r,1000)})]);clearTimeout(wait);if(!closed){captured.stdout.truncated=true;captured.stderr.truncated=true;reason??='process_failure'}}
  for(const [stream,handler] of [[child?.stdout,onStdout],[child?.stderr,onStderr]])if(stream){try{stream.off?.('data',handler);stream.off?.('error',onStreamError);stream.on?.('error',()=>{});stream.destroy?.()}catch{reason??='process_failure'}}
 }
 const stdout=[...captured.stdout.labels],stderr=[...captured.stderr.labels];
 const labels=[...new Set([...stderr,...stdout])];
 const negative=labels.find(x=>!['auth_pending','auth_authenticated'].includes(x));
 const category=reason||(exitCode===0?(commandId==='wrangler-whoami'&&negative==='auth_not_authenticated'?negative:commandId==='wrangler-whoami'&&expectedAccountId&&accountMatched!==true?'auth_account_mismatch':'none'):(negative||'process_failure'));
 const status=reason==='timeout'?'timeout':reason==='cancelled'?'cancelled':!exited||!closed?'unknown':exitCode===0&&category==='none'?'success':'failure';
 const requiresReconciliation=mutating||!exited;
 log.record({operation:commandId,phase:'finish',result:status,errorCategory:category,exitCode,httpStatus:observedHttpStatus,signal:exitSignal,exceptionType,
  accountMatched,stdout:{bytes:captured.stdout.bytes,truncated:captured.stdout.truncated,categories:stdout},stderr:{bytes:captured.stderr.bytes,truncated:captured.stderr.truncated,categories:stderr},reconciliationRequired:requiresReconciliation});
 captured.stdout.text='';captured.stderr.text='';
 const summary=await log.flush();
 return {status,exitCode,expectedAccountMatched:accountMatched,errorCategory:category,automaticRetry:false,requiresReconciliation:requiresReconciliation||!closed,diagnostics:summary};
}
