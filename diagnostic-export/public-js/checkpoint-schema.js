export const CHECKPOINT_SCHEMA="cosmic-web-checkpoint-3";
const MAX_CHECKPOINT_CHUNKS=100_000;
const MAX_ATTEMPTS_PER_CHUNK=100;
const MAX_RESULT_TEXT_CHARS=4*1024*1024;
const MAX_SEGMENTS_PER_RESULT=50_000;
const CHUNK_STATUSES=new Set(["pending","in_flight","ambiguous","completed"]);
const ATTEMPT_STATES=new Set(["dispatched","success","failed","cancelled_or_ambiguous"]);

function plainObject(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function exactKeys(obj,allowed){return plainObject(obj)&&Object.keys(obj).every(k=>allowed.has(k))}
function safeString(v,max,{allowEmpty=true}={}){return typeof v==="string"&&v.length<=max&&(allowEmpty||v.length>0)}
function validIso(v){return safeString(v,64,{allowEmpty:false})&&Number.isFinite(Date.parse(v))}
function validFinite(v,{min=-Infinity,max=Infinity}={}){return typeof v==="number"&&Number.isFinite(v)&&v>=min&&v<=max}
function validSafeInt(v,{min=Number.MIN_SAFE_INTEGER,max=Number.MAX_SAFE_INTEGER}={}){return typeof v==="number"&&Number.isSafeInteger(v)&&v>=min&&v<=max}

function validAttempt(a){
  if(!exactKeys(a,new Set(["attemptId","startedAt","completedAt","state","code","appRequestId","openaiRequestId"])))return false;
  if(!safeString(a.attemptId,100,{allowEmpty:false})||!validIso(a.startedAt)||!ATTEMPT_STATES.has(a.state))return false;
  if(a.completedAt!==undefined&&!validIso(a.completedAt))return false;
  for(const key of ["code","appRequestId","openaiRequestId"])if(a[key]!==undefined&&a[key]!==null&&!safeString(a[key],160))return false;
  return true;
}
function validAttempts(a){return Array.isArray(a)&&a.length<=MAX_ATTEMPTS_PER_CHUNK&&a.every(validAttempt)}

function validChunk(c,index){
  if(!exactKeys(c,new Set(["index","sourceStart","sourceEnd","bytes","sha256","logicalStart","duration","prerollDuration","status","attempts"])))return false;
  return c.index===index&&validSafeInt(c.sourceStart,{min:0})&&validSafeInt(c.sourceEnd,{min:c.sourceStart+1})&&validSafeInt(c.bytes,{min:1})&&/^[0-9a-f]{64}$/.test(c.sha256||"")&&
    validFinite(c.logicalStart,{min:0,max:30*24*60*60})&&validFinite(c.duration,{min:Number.EPSILON,max:24*60*60})&&
    validFinite(c.prerollDuration,{min:0,max:60})&&CHUNK_STATUSES.has(c.status)&&validAttempts(c.attempts);
}
function validSegment(seg){
  if(!exactKeys(seg,new Set(["start","end","speaker","text"])))return false;
  return validFinite(seg.start,{min:0,max:30*24*60*60})&&validFinite(seg.end,{min:seg.start,max:30*24*60*60})&&safeString(seg.speaker,128,{allowEmpty:false})&&safeString(seg.text,MAX_RESULT_TEXT_CHARS);
}
function validDiagnostics(d){
  if(!exactKeys(d,new Set(["appRequestId","openaiRequestId","status"])))return false;
  if(d.appRequestId!==null&&d.appRequestId!==undefined&&!safeString(d.appRequestId,160))return false;
  if(d.openaiRequestId!==null&&d.openaiRequestId!==undefined&&!safeString(d.openaiRequestId,160))return false;
  return d.status===200;
}
function validResult(r,index){
  if(!exactKeys(r,new Set(["index","logicalStart","duration","text","segments","diagnostics","attempts"])))return false;
  if(r.index!==index||!validFinite(r.logicalStart,{min:0,max:30*24*60*60})||!validFinite(r.duration,{min:Number.EPSILON,max:24*60*60})||!safeString(r.text,MAX_RESULT_TEXT_CHARS)||!validDiagnostics(r.diagnostics)||!validAttempts(r.attempts))return false;
  if(r.segments===null)return true;
  return Array.isArray(r.segments)&&r.segments.length<=MAX_SEGMENTS_PER_RESULT&&r.segments.every(validSegment);
}

export function validateCheckpointShape(record,{requireIntegrity=true}={}){
  const top=new Set(["id","principalScope","sourceFingerprint","sourceSize","settingsIdentity","chunkerRevision","chunks","results","createdAt","updatedAt","schema","integrity"]);
  if(!exactKeys(record,top))return false;
  if(record.schema!==CHECKPOINT_SCHEMA||!/^cp:[0-9a-f]{64}$/.test(record.id||"")||!/^[A-Za-z0-9_-]{32}$/.test(record.principalScope||"")||!/^[0-9a-f]{64}$/.test(record.sourceFingerprint||"")||!/^[0-9a-f]{64}$/.test(record.settingsIdentity||""))return false;
  if(!validSafeInt(record.sourceSize,{min:1})||!safeString(record.chunkerRevision,160,{allowEmpty:false})||!validIso(record.createdAt)||!validIso(record.updatedAt))return false;
  if(requireIntegrity&&!/^[0-9a-f]{64}$/.test(record.integrity||""))return false;
  if(!requireIntegrity&&record.integrity!==undefined)return false;
  if(!Array.isArray(record.chunks)||record.chunks.length<1||record.chunks.length>MAX_CHECKPOINT_CHUNKS)return false;
  if(!record.chunks.every((c,i)=>validChunk(c,i+1)))return false;
  if(!plainObject(record.results))return false;
  const resultKeys=Object.keys(record.results);
  if(resultKeys.length>record.chunks.length)return false;
  for(const key of resultKeys){
    if(!/^[1-9][0-9]*$/.test(key))return false;
    const index=Number(key);
    if(index<1||index>record.chunks.length||!validResult(record.results[key],index))return false;
  }
  return true;
}

