// Request Apple-supported per-session diagnostics only for the independent
// genuine SafariDriver disk-file probe. This does not relax file identity or
// constitute release certification. Raw WebDriver logs are never exported.
export const SAFARI_DISK_PROBE_CAPABILITIES=Object.freeze({alwaysMatch:Object.freeze({
  browserName:'safari',acceptInsecureCerts:true,strictFileInteractability:false,
  'safari:diagnose':true
})});

// Safari may supply an empty or platform-specific MP3 MIME hint for a real
// native disk File. MIME is not byte identity; retain exact full/slice digests,
// size, timestamp, filename, and native change-event requirements.
const MP3_NATIVE_MIME_HINTS=new Set(['','audio/mpeg','audio/mp3','audio/x-mp3','audio/x-mpeg']);

// A diagnostic is positive ONLY after Safari has actually read a genuine
// disk-backed File and computed matching full and sliced SHA-256 digests.
// This is deliberately NOT a release-acceptance predicate: the original
// application, billing and checkpoint workflows must still be certified.
export function isGenuineDiskRead(native,expected){
  if(!native||typeof native!=='object'||native.error||!expected)return false;
  const mtimeMillis=Number(BigInt(expected.mtimeNs)/1000000n);
  return native.name==='format.mp3'
    &&MP3_NATIVE_MIME_HINTS.has(native.type)
    &&native.changeCount===1
    &&native.size===expected.size
    &&native.bytesRead===expected.size
    &&native.sha256===expected.sha256
    &&native.sliceSha256===expected.sliceSha256
    &&Math.abs(native.lastModified-mtimeMillis)<=1;
}

// A fresh-mtime-only success must never turn the preserved-mtime probe green.
// Neither result constitutes final application/Safari certification.
export function summarizeNativeDiskProbe(candidates){
  const entries=Array.isArray(candidates)?candidates:[];
  return {
    status:entries.some(x=>x?.status==='PASS'&&x.timestampMode==='preserved')?'PASS':'FAIL',
    freshMtimeDiagnostic:entries.some(x=>x?.status==='PASS'&&x.timestampMode==='fresh')?'PASS':'FAIL'
  };
}

// Evidence from the independent probe is uploaded as a CI artifact. Never
// serialize WebDriver messages, exception stacks, arbitrary native file names,
// absolute local paths or full capability objects into that artifact.
const SAFE_ERROR_CATEGORIES=Object.freeze([
  [/NotReadableError/i,'NotReadableError'],
  [/NotAllowedError/i,'NotAllowedError'],
  [/SecurityError/i,'SecurityError'],
  [/TimeoutError|timed? out|timeout/i,'TimeoutError'],
  [/AbortError/i,'AbortError'],
  [/PermissionDenied|permission denied|operation not permitted|EACCES|EPERM/i,'PermissionDenied'],
  [/NoSuchElement|no such element/i,'NoSuchElement'],
  [/SessionNotCreated|session not created/i,'SessionNotCreated'],
  [/InvalidArgument|invalid argument/i,'InvalidArgument'],
  [/NetworkError|ECONNREFUSED|ENOTFOUND/i,'NetworkError']
]);
export function safariProbeErrorCategory(error){
  const raw=[error?.name,error?.code,error?.message,typeof error==='string'?error:''].filter(Boolean).join(' ');
  for(const [pattern,category] of SAFE_ERROR_CATEGORIES)if(pattern.test(raw))return category;
  return 'UnclassifiedError';
}
export function redactSafariNativeResult(native){
  if(!native||typeof native!=='object')return null;
  const safe={nameMatches:native.name==='format.mp3',
    mimeHint:MP3_NATIVE_MIME_HINTS.has(native.type)?native.type:'OTHER'};
  for(const key of ['size','bytesRead','lastModified','changeCount']){
    if(Number.isFinite(native[key]))safe[key]=native[key];
  }
  for(const key of ['sha256','sliceSha256']){
    if(typeof native[key]==='string'&&/^[0-9a-f]{64}$/i.test(native[key]))safe[key]=native[key];
  }
  if(native.error)safe.errorCode=safariProbeErrorCategory(native.error);
  return safe;
}
