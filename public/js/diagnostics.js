export const DIAGNOSTICS_SCHEMA='cosmic-web-diagnostics-2';
export const DIAGNOSTICS_REVISION='privacy-safe-detail-2';
export const MAX_DIAGNOSTIC_EVENTS=1200;
const BLOCKED_KEY=/key|authorization|cookie|prompt|transcript|audio|filename|email|token|fingerprint|principal|secret|credential/i;

function boundedPrimitive(value){
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value==='string')return value.slice(0,300);
  if(Array.isArray(value))return value.slice(0,32).map(boundedPrimitive).filter(v=>v!==undefined);
  return undefined;
}

export function makeDiagnosticEvent(category,data={}, {now=()=>new Date().toISOString(),elapsedMs=0}={}){
  const event={time:now(),pageElapsedMs:Math.max(0,Math.round(Number(elapsedMs)||0)),category:String(category||'event').slice(0,80)};
  for(const [key,value] of Object.entries(data||{})){
    if(BLOCKED_KEY.test(key))continue;
    const safe=boundedPrimitive(value);
    if(safe!==undefined)event[key]=safe;
  }
  return event;
}

export function pushDiagnostic(events,event,max=MAX_DIAGNOSTIC_EVENTS){
  if(!Array.isArray(events))throw new TypeError('events must be an array');
  events.push(event);
  const limit=Math.max(100,Math.min(5000,Number.isInteger(max)?max:MAX_DIAGNOSTIC_EVENTS));
  if(events.length>limit)events.splice(0,events.length-limit);
  return event;
}

export function diagnosticErrorFields(error){
  return {
    code:typeof error?.code==='string'?error.code:'unknown_error',
    errorName:typeof error?.name==='string'?error.name:'Error',
    status:Number.isInteger(error?.status)?error.status:null
  };
}
