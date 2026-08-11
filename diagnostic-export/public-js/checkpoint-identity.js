export function chunkIdentity(chunk){
  return {
    index: chunk?.index,
    sourceStart: chunk?.sourceStart,
    sourceEnd: chunk?.sourceEnd,
    bytes: chunk?.bytes,
    sha256: chunk?.sha256
  };
}

export function compatibleCheckpoint(cp,{principalScope,sourceFingerprint,sourceSize,settingsIdentity,chunkerRevision,chunks}){
  if(!cp || typeof cp!=="object" || Array.isArray(cp)) return false;
  if(typeof principalScope!=="string" || !/^[A-Za-z0-9_-]{32}$/.test(principalScope)) return false;
  if(typeof sourceFingerprint!=="string" || !sourceFingerprint) return false;
  if(!Number.isSafeInteger(sourceSize) || sourceSize<0) return false;
  if(typeof settingsIdentity!=="string" || !settingsIdentity) return false;
  if(typeof chunkerRevision!=="string" || !chunkerRevision) return false;
  if(cp.principalScope!==principalScope || cp.sourceFingerprint!==sourceFingerprint || cp.sourceSize!==sourceSize || cp.settingsIdentity!==settingsIdentity || cp.chunkerRevision!==chunkerRevision) return false;
  if(!Array.isArray(cp.chunks) || !Array.isArray(chunks) || cp.chunks.length!==chunks.length) return false;
  return cp.chunks.every((saved,i)=>{
    const a=chunkIdentity(saved), b=chunkIdentity(chunks[i]);
    return Number.isInteger(a.index) && a.index>=1 && Number.isSafeInteger(a.sourceStart) && Number.isSafeInteger(a.sourceEnd) && Number.isSafeInteger(a.bytes) && /^[0-9a-f]{64}$/.test(a.sha256||"") &&
      Number.isInteger(b.index) && b.index>=1 && Number.isSafeInteger(b.sourceStart) && Number.isSafeInteger(b.sourceEnd) && Number.isSafeInteger(b.bytes) && /^[0-9a-f]{64}$/.test(b.sha256||"") &&
      a.index===b.index && a.sourceStart===b.sourceStart && a.sourceEnd===b.sourceEnd && a.bytes===b.bytes && a.sha256===b.sha256;
  });
}
