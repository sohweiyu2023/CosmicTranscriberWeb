import {diagnosticFields,safeCategory,safeCode,safeDiagnosticField} from './diagnostic-policy.js';
export const DIAGNOSTICS_SCHEMA='cosmic-web-diagnostics-2';
export const DIAGNOSTICS_REVISION='typed-bounded-detail-3';
export const MAX_DIAGNOSTIC_EVENTS=1200;
const ringStats=new WeakMap();
const validEvents=new WeakSet();
function stats(events){let s=ringStats.get(events);if(!s){s={observed:0,dropped:0,writeFailures:0,unknown:0,expected:[]};ringStats.set(events,s)}return s}
function timestamp(value){return typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))?value:null}
export function makeDiagnosticEvent(category,data={}, {now=()=>new Date().toISOString(),elapsedMs=0}={}){
  try {
    const event={...diagnosticFields(data),time:timestamp(now()),pageElapsedMs:safeDiagnosticField('elapsedMs',elapsedMs)??0,category:safeCategory(category)};
    validEvents.add(event);return Object.freeze(event);
  }catch{
    const event=Object.freeze({time:null,pageElapsedMs:0,category:'unknown_event'});validEvents.add(event);return event;
  }
}
export function pushDiagnostic(events,event,max=MAX_DIAGNOSTIC_EVENTS){
  try{
    if(!Array.isArray(events))return null;
    const s=stats(events);s.observed++;
    const safe=validEvents.has(event)?event:makeDiagnosticEvent('unknown_event');
    if(safe.category==='unknown_event'||safe.code==='unknown_error'||Object.values(safe).includes('unknown'))s.unknown++;
    const limit=Math.max(1,Math.min(MAX_DIAGNOSTIC_EVENTS,Number.isInteger(max)?max:MAX_DIAGNOSTIC_EVENTS));
    try{events.push(safe);s.expected.push(safe);if(events.length>limit){const count=events.length-limit;events.splice(0,count);s.expected.splice(0,count);s.dropped+=count}return safe}catch{s.writeFailures++;return null}
  }catch{return null}
}
export function diagnosticCompleteness(events){
  const s=ringStats.get(events)||{observed:0,dropped:0,writeFailures:0,unknown:0,expected:[]};
  const tracked=ringStats.has(events)||Array.isArray(events)&&events.length===0;
  const retained=Array.isArray(events)?events.length:0;
  const integrity=tracked&&retained===s.expected.length&&events.every((event,index)=>event===s.expected[index]&&validEvents.has(event));
  return {observed:s.observed,dropped:s.dropped,writeFailures:s.writeFailures,unknown:s.unknown,retained,capacity:MAX_DIAGNOSTIC_EVENTS,
    completeObservedStream:integrity&&s.dropped===0&&s.writeFailures===0&&s.unknown===0,
    integrity,
    tracked,
    scope:'current_page_memory_only',fullApplicationCoverage:false};
}
export function diagnosticErrorFields(error){
  try{return {code:safeCode(error?.code),errorName:safeDiagnosticField('errorName',error?.name),status:safeDiagnosticField('status',error?.status)??null}}
  catch{return {code:'unknown_error',errorName:'unknown',status:null}}
}
export function preferenceFailure(operation,error,report){
  try{report('preference_failure',{operation,storageCategory:error?.name==='QuotaExceededError'?'quota':error?.name==='SyntaxError'?'malformed':error?.name==='SecurityError'?'unavailable':'unknown',...diagnosticErrorFields(error)})}catch{}
}

// Do not export free-form server/browser strings, settings text or checkpoint results.
export function browserIdentity(userAgent){
  if(typeof userAgent!=='string'||userAgent.length>1024)return {family:'unknown',major:null};
  for(const [family,pattern] of [['Edge',/Edg\/(\d{1,4})\./],['Firefox',/Firefox\/(\d{1,4})\./],['Chromium',/Chrome\/(\d{1,4})\./],['Safari',/Version\/(\d{1,4})\.[^\r\n]*Safari\//]]){
    const match=userAgent.match(pattern);if(match)return {family,major:Number(match[1])};
  }
  return {family:'unknown',major:null};
}
export function makeDiagnosticExport({appVersion,runtime={},browser={},session={},settings={},queue=[],events=[]}){
  const queueRows=Array.isArray(queue)?queue.slice(0,500).map(row=>({
    ...diagnosticFields(row),
    errorCode:row.errorCode==null?null:safeCode(row.errorCode),
    completedModel:row.completedModel==null?null:safeDiagnosticField('completedModel',row.completedModel),
    status:['inspecting','preparing','ready','running','done','error','pending'].includes(row.status)?row.status:'unknown'
  })):[];
  return {schema:DIAGNOSTICS_SCHEMA,diagnosticsRevision:DIAGNOSTICS_REVISION,
    appVersion:safeDiagnosticField('appVersion',appVersion)??'unknown',generatedAt:new Date().toISOString(),
    runtime:{...diagnosticFields(runtime),pageAgeMs:safeDiagnosticField('elapsedMs',runtime.pageAgeMs)??null,
      activeOperation:runtime.activeOperation?diagnosticFields(runtime.activeOperation):null},
    browser:{...diagnosticFields(browser),identityHint:browserIdentity(browser.userAgent)},session:diagnosticFields(session),settings:diagnosticFields(settings),
    queue:queueRows,queueTruncated:Array.isArray(queue)&&queue.length>queueRows.length,
    eventCompleteness:diagnosticCompleteness(events),events:events.slice(0,MAX_DIAGNOSTIC_EVENTS).map(event=>validEvents.has(event)?event:makeDiagnosticEvent('unknown_event'))};
}
