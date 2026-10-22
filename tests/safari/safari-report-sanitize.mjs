// Privacy boundary for downloadable REAL Safari acceptance reports. This runs
// after the unmodified native-file and workflow assertions; it must never
// decide whether a browser passes. Keep the known staging-only waiver fields.
import {safariProbeErrorCategory} from './disk-access-probe-contract.mjs';
import {NATIVE_FIXTURES} from './native-file-contract.mjs';

const knownNames=new Set(NATIVE_FIXTURES.map(item=>item.name));
const knownFormats=new Set(NATIVE_FIXTURES.map(item=>item.format));
const mimeHints=new Set(NATIVE_FIXTURES.flatMap(item=>item.mimeTypes));
const statuses=new Set(['PASS','FAIL','NOT RUN','RUNNING']);
const safeStatus=value=>statuses.has(value)?value:'UNKNOWN';
const safeNum=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const safeHash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value)?value:null;
const safeName=value=>knownNames.has(value)?value:'OTHER';
const safeFormat=value=>knownFormats.has(value)?value:'OTHER';
const safeTimestamp=value=>typeof value==='string'&&/^\d{1,24}$/.test(value)?value:null;
const safeId=value=>typeof value==='string'&&/^(?:attempt|run|job|file)-[0-9a-f]{24}$/.test(value)?value:null;
const safeError=value=>safariProbeErrorCategory(value);

// Canonical signatures are needed by the *existing*, narrow Safari26 STAGING
// waiver. Never carry arbitrary browser-provided messages or stacks forward.
export function canonicalSafariNativeError(value){
 if(typeof value!=='string'||!value)return null;
 if(/^NotReadableError: The I\/O read operation failed\./.test(value))return 'NotReadableError: The I/O read operation failed.';
 if(/^TypeError: Load failed(?:\b|$)/.test(value))return 'TypeError: Load failed';
 return safeError(value);
}
const safeIdentity=value=>value&&typeof value==='object'?{
 size:safeNum(value.size),sha256:safeHash(value.sha256),mtimeNs:safeTimestamp(value.mtimeNs)
}:null;
const safeSlice=value=>({start:safeNum(value?.start),end:safeNum(value?.end),size:safeNum(value?.size),sha256:safeHash(value?.sha256)});
const safeRead=value=>value&&typeof value==='object'?{
 ok:value.ok===true, ...(safeNum(value.bytes)!==null?{bytes:safeNum(value.bytes)}:{}),
 ...(value.error?{error:canonicalSafariNativeError(value.error)}:{})
}:null;
const safeNative=value=>{
 if(!value||typeof value!=='object')return null;
 const result={};
 if(value.error)result.error=canonicalSafariNativeError(value.error);
 if(value.isFile!==undefined)result.isFile=value.isFile===true;
 if(value.name!==undefined)result.name=safeName(value.name);
 if(value.type!==undefined)result.type=mimeHints.has(value.type)?value.type:'OTHER';
 for(const field of ['size','lastModified','duration'])if(safeNum(value[field])!==null)result[field]=safeNum(value[field]);
 if(safeHash(value.sha256))result.sha256=safeHash(value.sha256);
 if(Array.isArray(value.slices))result.slices=value.slices.slice(0,8).map(safeSlice);
 if(value.diskReadDiagnostics&&typeof value.diskReadDiagnostics==='object'){
  const reads=value.diskReadDiagnostics;
  result.diskReadDiagnostics={size:safeNum(reads.size),type:mimeHints.has(reads.type)?reads.type:'OTHER',
   sliceArrayBuffer:safeRead(reads.sliceArrayBuffer),fileReader:safeRead(reads.fileReader),blobUrlFetch:safeRead(reads.blobUrlFetch)};
 }
 return result;
};
const safeFixture=value=>({
 name:safeName(value?.name),format:safeFormat(value?.format),
 expectedDuration:safeNum(value?.expectedDuration),
 expectedDispatch:value?.expectedDispatch?{bytes:safeNum(value.expectedDispatch.bytes),sha256:safeHash(value.expectedDispatch.sha256)}:null,
 before:safeIdentity(value?.before),after:safeIdentity(value?.after),
 native:safeNative(value?.native),
 nativeSelectionMode:value?.nativeSelectionMode==='safaridriver-sendkeys'?'safaridriver-sendkeys':'OTHER',
 nativePickerDiagnostic:value?.nativePickerDiagnostic?{mode:value.nativePickerDiagnostic.mode==='not-attempted'?'not-attempted':'OTHER'}:null,
 nativePreparationStatus:safeStatus(value?.nativePreparationStatus),workflowStatus:safeStatus(value?.workflowStatus)
});
const safeRequest=value=>({
 bytes:safeNum(value?.bytes),sha256:safeHash(value?.sha256),
 contentType:mimeHints.has(value?.contentType)?value.contentType:'OTHER',
 metadata:{
  v:safeNum(value?.metadata?.v),audioFormat:safeFormat(value?.metadata?.audioFormat),
  chunkIndex:safeNum(value?.metadata?.chunkIndex),chunkCount:safeNum(value?.metadata?.chunkCount),
  attemptId:safeId(value?.metadata?.attemptId),jobId:safeId(value?.metadata?.jobId),fileId:safeId(value?.metadata?.fileId),
  declaredBytes:safeNum(value?.metadata?.declaredBytes),durationSeconds:safeNum(value?.metadata?.durationSeconds),
  model:['gpt-transcribe','gpt-4o-transcribe-diarize','gpt-4o-transcribe','gpt-4o-mini-transcribe'].includes(value?.metadata?.model)?value.metadata.model:'OTHER',
  requestKind:value?.metadata?.requestKind==='transcription'?'transcription':'OTHER'
 }
});
export function sanitizeSafariAcceptanceReport(report){
 const r=report||{};
 const result={
  schema:'cosmic-real-safari-native-acceptance-1',
  status:safeStatus(r.status),platform:r.platform==='darwin'?'darwin':'OTHER',
  startedAt:typeof r.startedAt==='string'&&/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(r.startedAt)?r.startedAt:null,
  finishedAt:typeof r.finishedAt==='string'&&/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(r.finishedAt)?r.finishedAt:null,
  providerCalls:safeNum(r.providerCalls),fixturesPreserved:r.fixturesPreserved===true,
  capabilities:{browserName:r.capabilities?.browserName==='Safari'?'Safari':'OTHER',
   browserVersion:typeof r.capabilities?.browserVersion==='string'&&/^\d+(?:\.\d+){0,3}$/.test(r.capabilities.browserVersion)?r.capabilities.browserVersion:'UNKNOWN'},
  checks:Array.isArray(r.checks)?r.checks.slice(0,100).map(x=>({name:typeof x?.name==='string'&&x.name.length<250&&/^[\p{L}\p{N} .,:/()\-]+$/u.test(x.name)?x.name:'OTHER',status:safeStatus(x?.status)})):[],
  fixtures:Array.isArray(r.fixtures)?r.fixtures.slice(0,30).map(safeFixture):[],
  requestCount:Array.isArray(r.requests)?r.requests.length:0,
  requests:Array.isArray(r.requests)?r.requests.slice(0,30).map(safeRequest):[],
  safariDiagnosticSummary:r.safariDiagnosticSummary?{
   available:r.safariDiagnosticSummary.available===true,
   filesFound:safeNum(r.safariDiagnosticSummary.filesFound),filesInspected:safeNum(r.safariDiagnosticSummary.filesInspected),
   bytesInspected:safeNum(r.safariDiagnosticSummary.bytesInspected),
   counts:Object.fromEntries(['notReadableError','sandbox','permission','denied','fileRead'].map(k=>[k,safeNum(r.safariDiagnosticSummary.counts?.[k])])),
   ...(r.safariDiagnosticSummary.errorCode?{errorCode:safeError(r.safariDiagnosticSummary.errorCode)}:{})
  }:null
 };
 for(const key of ['error','serverError','integrityError','cleanupError','driverError'])if(r[key])result[key+'Code']=safeError(r[key]);
 return result;
}
