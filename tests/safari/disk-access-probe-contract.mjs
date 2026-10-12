// A diagnostic is positive ONLY after Safari has actually read a genuine
// disk-backed File and computed matching full and sliced SHA-256 digests.
// This is deliberately NOT a release-acceptance predicate: the original
// application, billing and checkpoint workflows must still be certified.
export function isGenuineDiskRead(native,expected){
  if(!native||typeof native!=='object'||native.error||!expected)return false;
  const mtimeMillis=Number(BigInt(expected.mtimeNs)/1000000n);
  return native.name==='format.mp3'
    &&native.type==='audio/mpeg'
    &&native.changeCount===1
    &&native.size===expected.size
    &&native.bytesRead===expected.size
    &&native.sha256===expected.sha256
    &&native.sliceSha256===expected.sliceSha256
    &&Math.abs(native.lastModified-mtimeMillis)<=1;
}
