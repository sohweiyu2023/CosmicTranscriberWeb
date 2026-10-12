// A real native-picker diagnostic may pass only if a trusted browser change
// event supplied the genuine disk File with exact independent bytes, slices,
// MIME, mtime, and decoded duration. It never certifies the paid application.
export function isOrdinarySafariGenuineFile(result,expected){
  if(!result||!expected||result.error)return false;
  const expectedMtimeMs=Number(BigInt(expected.mtimeNs)/1000000n);
  return result.isTrusted===true&&result.name==='format.mp3'&&result.type==='audio/mpeg'
    &&result.size===expected.size&&result.bytesRead===expected.size
    &&result.sha256===expected.sha256&&result.sliceSha256===expected.sliceSha256
    &&Math.abs(result.lastModified-expectedMtimeMs)<=1
    &&Number.isFinite(result.duration)&&Math.abs(result.duration-1)<=0.15;
}
