// A conservative proof from complete server-validated bytes, never client duration.
// Unknown/compressed/ambiguous WAVs retain the existing automatic chunking path.
export function shortPcmWavSeconds(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 44) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || v.getUint32(4, true) + 8 !== bytes.byteLength) return null;
  let offset = 12, format = false, dataBytes = null, chunks = 0;
  while (offset + 8 <= bytes.byteLength) {
    if (++chunks > 64) return null;
    const name = tag(offset), size = v.getUint32(offset + 4, true), start = offset + 8;
    if (start + size + size % 2 > bytes.byteLength) return null;
    if (!['fmt ', 'data', 'LIST'].includes(name)) return null;
    if (name === 'LIST' && (size < 4 || tag(start) !== 'INFO')) return null;
    if (name === 'fmt ') {
      if (format || size !== 16 || v.getUint16(start, true) !== 1 ||
          v.getUint16(start + 2, true) !== 1 || v.getUint32(start + 4, true) !== 16000 ||
          v.getUint32(start + 8, true) !== 32000 || v.getUint16(start + 12, true) !== 2 ||
          v.getUint16(start + 14, true) !== 16) return null;
      format = true;
    }
    if (name === 'data') {
      if (dataBytes !== null || !size || size % 2) return null;
      dataBytes = size;
    }
    offset = start + size + size % 2;
  }
  if (offset !== bytes.byteLength || !format || dataBytes === null) return null;
  const seconds = dataBytes / 32000;
  return seconds > 0 && seconds <= 30 ? seconds : null;
}
