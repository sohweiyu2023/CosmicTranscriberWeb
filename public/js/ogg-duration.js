// A bounded, metadata-only Ogg Vorbis duration oracle for browsers that
// cannot decode Ogg natively. Never supplies synthetic audio or fake duration.
// Read at most two 64-KiB slices of the actual disk-backed native File.
export async function probeOggVorbisDuration(blob) {
  if (!(blob instanceof Blob) || blob.size < 58) return null;
  const LIMIT = 65536;
  const head = new Uint8Array(await blob.slice(0, Math.min(LIMIT, blob.size)).arrayBuffer());
  const tail = new Uint8Array(await blob.slice(Math.max(0, blob.size - LIMIT)).arrayBuffer());
  function page(bytes, offset) {
    if (offset < 0 || offset + 27 > bytes.length ||
        bytes[offset] !== 79 || bytes[offset+1] !== 103 ||
        bytes[offset+2] !== 103 || bytes[offset+3] !== 83 ||
        bytes[offset+4] !== 0) return null;
    const count = bytes[offset+26];
    if (offset+27+count > bytes.length) return null;
    let payloadLength = 0;
    for (let i=0;i<count;i++) payloadLength += bytes[offset+27+i];
    const payloadStart = offset+27+count, end = payloadStart+payloadLength;
    if (end > bytes.length) return null;
    let granule = 0n;
    for (let i=7;i>=0;i--) granule = (granule<<8n)|BigInt(bytes[offset+6+i]);
    const serial = (bytes[offset+14] | (bytes[offset+15]<<8) |
                    (bytes[offset+16]<<16) | (bytes[offset+17]<<24)) >>> 0;
    return {flags:bytes[offset+5],payloadStart,end,serial,granule};
  }
  const first = page(head,0);
  if (!first || !(first.flags & 2) || first.payloadStart+16 > first.end) return null;
  const p = first.payloadStart;
  if (head[p]!==1 ||
      String.fromCharCode(...head.subarray(p+1,p+7))!=='vorbis' ||
      head[p+7]!==0 || head[p+8]!==0 || head[p+9]!==0 || head[p+10]!==0 ||
      head[p+11]===0) return null;
  const rate = (head[p+12] | (head[p+13]<<8) |
               (head[p+14]<<16) | (head[p+15]<<24)) >>> 0;
  if (rate < 8000 || rate > 192000) return null;
  // Accept only the terminal EOS page of the same logical Vorbis stream.
  // Ogg's maximum page size is below 64 KiB, so this bounded slice includes it.
  for (let i=tail.length-27;i>=0;i--) {
    if (tail[i]!==79) continue;
    const last=page(tail,i);
    if (!last || last.end!==tail.length || !(last.flags & 4) ||
        last.serial!==first.serial || last.granule===0xffffffffffffffffn ||
        last.granule>BigInt(Number.MAX_SAFE_INTEGER)) continue;
    const duration=Number(last.granule)/rate;
    return Number.isFinite(duration) && duration>0 ? duration : null;
  }
  return null;
}
