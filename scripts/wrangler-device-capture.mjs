// No default launcher, network or browser. Pure capture alone has no side effects.
// The process bridge invokes only explicitly supplied reviewed lifecycle ports.
// Device codes are ephemeral handoff data, never diagnostic/support fields.
import {classifySubprocessText,runObservedCommand} from './observed-subprocess.mjs';
import {createToolDiagnostics} from './tooling-diagnostics.mjs';
const ansi=/\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const exceptions=new Set(['Error','TypeError','SyntaxError','AbortError','TimeoutError']);
// Fixed diagnostic grammar, not raw stderr passthrough. Unknown lexical values
// are replaced; URLs, codes, paths, identifiers and numeric payloads never pass.
const templateWords=new Set('error failed failure unable cannot unknown invalid unsupported unexpected argument arguments command option request response endpoint server authorization authentication login device scope grant client malformed json parse parsing network connection connect refused reset timed out timeout dns certificate issuer tls ssl proxy tunnel keyring unavailable installed module dependency permission denied access blocked code internal fetch read write open secure storage'.split(' '));
const causeRules=[
 ['unsupported_command','invocation_scope_rejected',/Unknown (?:argument|command)|Unrecognized (?:argument|option)|Unsupported (?:command|option)|Not enough non-option arguments/i],
 ['dns_resolution','dns_failure',/\b(?:ENOTFOUND|EAI_AGAIN|getaddrinfo)\b|Unable to resolve Cloudflare['’]s API hostname/i],
 ['certificate_validation','tls_failure',/\b(?:CERT_HAS_EXPIRED|ERR_TLS_CERT_ALTNAME_INVALID|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN)\b|certificate (?:verify|validation) failed/i],
 ['proxy_transport','network_failure',/\b(?:ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|UND_ERR_PRX_TLS)\b|proxy.{0,30}(?:authentication|required|failed)|\bCONNECT\s+407\b/i],
 ['connection_transport','network_failure',/\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)\b|fetch failed/i],
 ['keyring_storage','secure_storage_unavailable',/keyring.{0,80}(?:unavailable|failed|error|not installed|not available)|keytar.{0,40}(?:failed|error)|@napi-rs\/keyring.{0,80}required/i],
 ['oauth_request','invocation_scope_rejected',/\b(?:invalid_request|invalid_scope|unsupported_response_type|unsupported_grant_type)\b/],
 ['oauth_rejected','authorization_rejected',/\b(?:invalid_client|unauthorized_client|invalid_grant|invalid_token)\b/],
 ['oauth_service','network_failure',/\b(?:server_error|temporarily_unavailable)\b/],
 ['untrusted_verification','authorization_rejected',/authorization server returned an untrusted|Refusing to display or open it/i],
 ['malformed_oauth_response','malformed_response',/\binvalid_json\b|endpoint returned a response that could not be interpreted|Unexpected token.{0,80}(?:JSON|json)/]
];
function describeFailure(text,stream){
 const matched=causeRules.find(([, ,pattern])=>pattern.test(text));
 // Replace whole URLs and code-like words first, then admit fixed vocabulary.
 const scrubbed=text.replace(/https?:\/\/\S+|\b[A-Za-z0-9_-]*[0-9_][A-Za-z0-9_-]*\b|\b[A-Z][A-Z0-9_-]{2,}\b/g,' [redacted] ');
 const words=scrubbed.toLowerCase().match(/[a-z]+/g)||[],tokens=[];
 for(const word of words){const token=templateWords.has(word)?word:'[redacted]';if(token==='[redacted]'&&tokens.at(-1)===token)continue;tokens.push(token);if(tokens.length===24)break}
 return Object.freeze({stream,cause:matched?.[0]||'unclassified',category:matched?.[1]||'unknown',messageTemplate:tokens.join(' ')||'[redacted]',rawTextRetained:false});
}
export function createDeviceFlowCapture({diagnostics,now=Date.now}={}){
 const log=diagnostics||createToolDiagnostics({component:'wrangler-auth'});
 const emittedCategories=new Set();
 const streams={stdout:{tail:'',bytes:0,truncated:false,discardUntilNewline:false,categories:new Set()},stderr:{tail:'',bytes:0,truncated:false,discardUntilNewline:false,categories:new Set()}};
 let phase='bootstrap',uri=null,code=null,deadline=null,handedOff=false,terminal=false,httpStatus=null,errorLines=0,unclassifiedErrors=0,successMessage=false,handoffBlocked=false;
 const failureEvidence=[];let droppedFailureEvidence=0;
 const safeNow=()=>{try{const value=now();return Number.isSafeInteger(value)&&value>0?value:null}catch{return null}};
 const record=fields=>{try{log.record({operation:'wrangler-device-login',reconciliationRequired:true,...fields})}catch{}};
 record({phase:'start',result:'started',errorCategory:'none'});
 function clear(){uri=null;code=null;deadline=null}
 function line(stream,text){
  const cleaned=text.replace(ansi,'').trim();let details=describeFailure(cleaned,stream);
  const labels=[...new Set([...classifySubprocessText(cleaned),...(details.category==='unknown'?[]:[details.category])])],out=streams[stream];
  const existingNegative=labels.find(label=>!['auth_pending','auth_authenticated'].includes(label));
  if(details.cause==='unclassified'&&existingNegative)details=Object.freeze({...details,cause:'classified_rejection',category:existingNegative});
  for(const label of labels)out.categories.add(label);
  const numeric=cleaned.match(/\b(?:HTTP(?:\/\d(?:\.\d)?)?\s+|status[\s:=]+)([1-5]\d\d)\b/i);if(numeric)httpStatus=Number(numeric[1]);
  if(/\bERROR\b|\[error\]|Unhandled|Exception/i.test(cleaned)||details.cause!=='unclassified'){
   errorLines++;if(labels.length===0)unclassifiedErrors++;
   if(failureEvidence.length<8)failureEvidence.push(details);else droppedFailureEvidence++;
  }
  if(/Successfully logged in/i.test(cleaned))successMessage=true;
  for(const label of labels)if(!['auth_pending','auth_authenticated'].includes(label)&&!emittedCategories.has(label)){emittedCategories.add(label);record({phase:'status',result:'failure',errorCategory:label,httpStatus})}
  if(labels.length===0&&/\bERROR\b|\[error\]|Unhandled|Exception/i.test(cleaned)&&!emittedCategories.has('unknown')){emittedCategories.add('unknown');record({phase:'status',result:'unknown',errorCategory:'unknown',httpStatus})}
  const negative=labels.some(label=>!['auth_pending','auth_authenticated'].includes(label));
  if(negative||/\bERROR\b|\[error\]|Unhandled|Exception/i.test(cleaned)){handoffBlocked=true;clear();phase=labels.includes('auth_device_expired')?'expired':'failed-before-handoff'}
  else if(labels.includes('auth_authenticated')){handoffBlocked=true;clear();phase='renewal-needs-status'}
  if(stream!=='stdout'||terminal||handedOff||handoffBlocked)return;
  if(/^To authorize wrangler, please visit:$/i.test(cleaned)){clear();phase='awaiting-url';return}
  if(!cleaned)return;
  if(phase==='awaiting-url'){
   try{const u=new URL(cleaned);if(u.origin!=='https://dash.cloudflare.com'||u.pathname!=='/oauth2/device/verify'||u.username||u.password||u.search||u.hash)throw Error();uri=u.href;phase='awaiting-code-label'}
   catch{out.categories.add('malformed_response');clear();phase='invalid-handoff'}return;
  }
  if(phase==='awaiting-code-label'){
   if(/^and enter the code:$/i.test(cleaned))phase='awaiting-code';else{out.categories.add('malformed_response');clear();phase='invalid-handoff'}return;
  }
  if(phase==='awaiting-code'){
   if(/^[A-Z0-9][A-Z0-9-]{3,31}$/.test(cleaned)){code=cleaned;phase='awaiting-window'}else{out.categories.add('malformed_response');clear();phase='invalid-handoff'}return;
  }
  if(phase==='awaiting-window'){
   const match=cleaned.match(/^You have (\d+(?:\.\d+)?) (seconds?|minutes?)(?: and (\d+(?:\.\d+)?) seconds?)? to approve this request\.$/);
   const at=safeNow(),seconds=match?Number(match[1])*(match[2].startsWith('minute')?60:1)+Number(match[3]||0):NaN;
   // Wrangler rounds some displayed periods upward. This is intentionally
   // conservative, not an assertion of exact server expiry or grant lifetime.
   if(at!==null&&seconds>5&&seconds<=300){deadline=at+(seconds-5)*1000;phase='handoff-ready';record({phase:'handoff',result:'running',errorCategory:'auth_pending'})}
   else{out.categories.add('malformed_response');clear();phase='invalid-handoff'}
  }
 }
 function feed(stream,chunk){
  if(terminal||!Object.hasOwn(streams,stream))return;
  let bytes;try{bytes=Buffer.from(chunk)}catch{streams[stream].categories.add('malformed_response');return}
  const out=streams[stream];out.bytes=Math.min(1000000000,out.bytes+bytes.length);if(out.bytes>16384)out.truncated=true;
  // Bounded line assembly; long private/error bodies never enter support data.
  for(let offset=0;offset<bytes.length;offset+=1024){
   let fragment=bytes.subarray(offset,offset+1024).toString('utf8');
   if(out.discardUntilNewline){const newline=fragment.indexOf('\n');if(newline===-1)continue;out.discardUntilNewline=false;fragment=fragment.slice(newline+1)}
   out.tail+=fragment;
   let end;while((end=out.tail.indexOf('\n'))!==-1){const next=out.tail.slice(0,end);out.tail=out.tail.slice(end+1);if(next.length<=2048)line(stream,next);else{out.truncated=true;out.categories.add('output_oversized');handoffBlocked=true;clear();phase='invalid-handoff'}}
   if(out.tail.length>2048){out.tail='';out.discardUntilNewline=true;out.truncated=true;out.categories.add('output_oversized');handoffBlocked=true;clear();phase='invalid-handoff'}
  }
 }
 function takeHandoff(){
  const at=safeNow();if(terminal||handedOff||phase!=='handoff-ready'||at===null||at>=deadline){if(phase==='handoff-ready'){streams.stdout.categories.add('auth_device_expired');clear();phase='expired'}return null}
  handedOff=true;const handoff={verificationUri:uri,userCode:code,conservativeDeadlineUtc:new Date(deadline).toISOString(),exactServerExpiryVerified:false};clear();return handoff;
 }
 async function finish({exitCode=null,timedOut=false,cancelled=false,spawnError=null}={}){
  if(!terminal){for(const stream of ['stdout','stderr']){if(streams[stream].tail)line(stream,streams[stream].tail);streams[stream].tail=''}terminal=true;clear()}
  const labels=[...new Set([...streams.stderr.categories,...streams.stdout.categories])],negative=labels.find(c=>!['auth_pending','auth_authenticated'].includes(c));
  const status=timedOut?'timeout':cancelled?'cancelled':exitCode===0?'success':'failure';
  const category=timedOut?'timeout':cancelled?'cancelled':spawnError?'spawn_failure':negative||((exitCode===0&&successMessage)?'none':'unknown');
  const summary=out=>({bytes:out.bytes,truncated:out.truncated,categories:[...out.categories]});
  record({phase:'finish',result:status,errorCategory:category,exitCode,exceptionType:exceptions.has(spawnError?.name)?spawnError.name:'unknown',httpStatus,stdout:summary(streams.stdout),stderr:summary(streams.stderr)});
  let support;try{support=await log.exportSupport()}catch{support={schema:'cosmic-tool-support-unavailable-1',complete:false}}
  return {schema:'cosmic-device-capture-1',status,exitCode:Number.isInteger(exitCode)?exitCode:null,errorCategory:category,phase,handedOff,errorLines,unclassifiedErrors,failureEvidence:Object.freeze([...failureEvidence]),droppedFailureEvidence,failureEvidenceComplete:(failureEvidence.length>0||status==='success'&&category==='none')&&unclassifiedErrors===0&&failureEvidence.every(e=>e.cause!=='unclassified')&&droppedFailureEvidence===0&&!streams.stdout.truncated&&!streams.stderr.truncated,successMessage,renewalVerified:false,requiresReconciliation:true,automaticRetry:false,exactServerExpiryVerified:false,support};
 }
 return Object.freeze({feed,takeHandoff,finish});
}

// No default launcher or CLI entry: the existing secure executor must provide
// its already-reviewed exact command/environment and an approved handoff sink.
// This bridge itself cannot choose credentials, scopes, accounts or a browser.
export async function observeReviewedDeviceProcessComponent({startReviewedProcess,onHandoff,readOnlyStatus,diagnostics,timeoutMs=330000,statusTimeoutMs=45000}={}){
 const log=diagnostics||createToolDiagnostics({component:'wrangler-auth'});
 if(!diagnostics||!['record','flush','exportSupport'].every(k=>typeof diagnostics[k]==='function')||![startReviewedProcess,onHandoff,readOnlyStatus].every(f=>typeof f==='function')||!Number.isInteger(statusTimeoutMs)||statusTimeoutMs<1||statusTimeoutMs>60000){
  try{log.record({operation:'wrangler-device-login',phase:'preflight',result:'blocked',errorCategory:'invocation_scope_rejected'})}catch{}
  return {status:'blocked',errorCategory:'invocation_scope_rejected',processStarted:false,renewalVerified:false,automaticRetry:false};
 }
 const capture=createDeviceFlowCapture({diagnostics:log}),handoffAbort=new AbortController();let child,started=false,delivery='not-issued';const handlers=[],abortListeners=[];
 const deliver=()=>{
  if(handoffAbort.signal.aborted)return;
  const h=capture.takeHandoff();if(!h)return;delivery='pending';
  try{const result=onHandoff(h,{signal:handoffAbort.signal});if(result&&typeof result.then==='function')Promise.resolve(result).then(()=>{delivery='delivered'},()=>{delivery='unknown'});else delivery='delivered'}catch{delivery='unknown'}
 };
 const attach=(stream,name)=>{if(!stream)return;const handler=chunk=>{capture.feed(name,chunk);deliver()};stream.on('data',handler);handlers.push([stream,handler])};
 let processResult;
 try{
  processResult=await runObservedCommand({commandId:'wrangler-device-login',file:'reviewed-device-process',args:[],timeoutMs,diagnostics:log,spawnImpl:()=>{child=startReviewedProcess();started=true;for(const name of ['exit','close','error']){const end=()=>handoffAbort.abort();child.once(name,end);abortListeners.push([name,end])}attach(child.stdout,'stdout');attach(child.stderr,'stderr');return child}});
 }finally{handoffAbort.abort();for(const [stream,handler] of handlers)try{stream.off('data',handler)}catch{};for(const [name,handler] of abortListeners)try{child.off(name,handler)}catch{}}
 const captured=await capture.finish({exitCode:processResult.exitCode,timedOut:processResult.status==='timeout',cancelled:processResult.status==='cancelled',spawnError:processResult.errorCategory==='spawn_failure'?new Error():null});
 let authenticated=false,statusCause='unknown',statusVerificationTimedOut=false,statusTimer;const statusAbort=new AbortController();
 // Status is read-only, never a new login. A failed/unknown mutation is never
 // declared renewed merely because some credential happens to authenticate.
 try{const status=await Promise.race([Promise.resolve().then(()=>readOnlyStatus({signal:statusAbort.signal})),new Promise(resolve=>{statusTimer=setTimeout(()=>{statusVerificationTimedOut=true;statusAbort.abort();resolve(null)},statusTimeoutMs)})]);authenticated=!statusVerificationTimedOut&&status?.status==='success'&&status?.expectedAccountMatched===true;statusCause=statusVerificationTimedOut?'timeout':['none','auth_not_authenticated','auth_account_mismatch','authorization_rejected','secure_storage_unavailable','network_failure','dns_failure','tls_failure','process_failure','dependency_missing'].includes(status?.errorCategory)?status.errorCategory:'unknown'}catch{}finally{clearTimeout(statusTimer);statusAbort.abort()}
 try{log.record({operation:'wrangler-device-login',phase:'status',result:authenticated?'success':statusVerificationTimedOut?'timeout':'unknown',errorCategory:statusCause,reconciliationRequired:!authenticated})}catch{}
 // Drain the final reconciliation event before returning or a caller exits.
 try{captured.support=await log.exportSupport()}catch{captured.support={schema:'cosmic-tool-support-unavailable-1',complete:false}}
 const renewalVerified=processResult.status==='success'&&captured.successMessage===true&&authenticated&&delivery!=='pending'&&delivery!=='unknown';
 return {schema:'cosmic-reviewed-device-process-component-1',processStarted:started,status:processResult.status,errorCategory:captured.errorCategory==='unknown'?processResult.errorCategory:captured.errorCategory,capture:captured,handoffDelivery:delivery,authenticated,statusCause,statusVerificationTimedOut,renewalVerified,requiresReconciliation:!renewalVerified,automaticRetry:false,admission:false,providerRequests:0,deployment:false};
}
