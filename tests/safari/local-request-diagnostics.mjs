// Bounded facts only: never persist URLs, session IDs, bodies, scripts or error prose.
const phases=new Set(['fixture_preparation','mock_startup','driver_startup','driver_session','driver_configuration','origin_reset','app_shell','workflows','cleanup']);
const commands=new Set(['mock_health','mock_control','driver_status','driver_session_create','driver_session_delete','driver_timeouts','driver_navigation','driver_execute','driver_element','driver_cookie','other']);
const errors=new Set(['TimeoutError','AbortError','TypeError','SyntaxError','Error','AssertionError']);
const protocolErrors=new Set(['session not created','invalid session id','unknown error','timeout','script timeout','invalid argument','unsupported operation','no such element','stale element reference','element not interactable','invalid selector','unexpected alert open','no such window','javascript error','insecure certificate']);
const get=(o,k)=>{try{return o?.[k]}catch{return undefined}};
const integer=v=>Number.isSafeInteger(v)&&v>=0?v:null;
export function safeRequestDiagnostics(value){
 const record=v=>{
  if(!v)return null;
  const phase=get(v,'phase'),command=get(v,'command'),elapsedMs=get(v,'elapsedMs'),httpStatus=get(v,'httpStatus'),errorType=get(v,'errorType'),protocolError=get(v,'protocolError');
  return {phase:phases.has(phase)?phase:'unknown',command:commands.has(command)?command:'other',elapsedMs:integer(elapsedMs),httpStatus:Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599?httpStatus:null,errorType:errors.has(errorType)?errorType:'unknown',protocolError:protocolErrors.has(protocolError)?protocolError:'unavailable',detail:'prose_omitted'};
 };
 const phase=get(value,'phase');
 return {schema:1,phase:phases.has(phase)?phase:'unknown',requestCount:integer(get(value,'requestCount')),last:record(get(value,'last')),firstFailure:record(get(value,'firstFailure')),lastReadinessFailure:record(get(value,'lastReadinessFailure')),firstFailureScope:'excludes_readiness_probes',rawOutput:'omitted'};
}
export function safeProcessDiagnostics(value){
 const driverExitCode=get(value,'driverExitCode'),serverExitCode=get(value,'serverExitCode');
 const exit=v=>Number.isInteger(v)&&v>=0&&v<=255?v:null;
 return {driverExitCode:exit(driverExitCode),serverExitCode:exit(serverExitCode)};
}

export function createRequestDiagnostics(){
 let phase='fixture_preparation',requestCount=0,last=null,firstFailure=null,lastReadinessFailure=null;
 return {
  phase(value){phase=phases.has(value)?value:'unknown'},
  begin(url,method,probe=false){
   let command='other';
   try{const p=new URL(url).pathname;
    if(p==='/__cosmic_e2e_health')command='mock_health';else if(p==='/__cosmic_e2e_native_control')command='mock_control';else if(p==='/status')command='driver_status';else if(p==='/session'&&method==='POST')command='driver_session_create';else if(/^\/session\/[^/]+$/.test(p)&&method==='DELETE')command='driver_session_delete';else if(/^\/session\/[^/]+\/timeouts$/.test(p))command='driver_timeouts';else if(/^\/session\/[^/]+\/url$/.test(p))command='driver_navigation';else if(/^\/session\/[^/]+\/execute\/(sync|async)$/.test(p))command='driver_execute';else if(/^\/session\/[^/]+\/element(?:\/[^/]+\/(?:click|clear|value))?$/.test(p))command='driver_element';else if(/^\/session\/[^/]+\/cookie$/.test(p))command='driver_cookie';
   }catch{}
   const started=performance.now();requestCount++;
   const entry={phase,command,httpStatus:null,protocolError:'unavailable',errorType:'unknown',elapsedMs:0};
   return {response(status,code){entry.httpStatus=status;entry.protocolError=protocolErrors.has(code)?code:'unavailable'},end(error){entry.elapsedMs=Math.max(0,Math.round(performance.now()-started));entry.errorType=errors.has(get(error,'name'))?get(error,'name'):'unknown';last={...entry};if(error&&probe)lastReadinessFailure={...entry};if(error&&!probe&&!firstFailure)firstFailure={...entry}}};
  },
  snapshot(){return safeRequestDiagnostics({phase,requestCount,last,firstFailure,lastReadinessFailure})}
 };
}
