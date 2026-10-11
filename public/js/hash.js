import { sha256 } from "/vendor/noble-hashes/sha2.js";

export function bytesToHex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");}
export async function hashBlobStreaming(blob,{sliceBytes=2*1024*1024,onProgress}={}){
  const h=sha256.create();
  if(blob.size===0){h.update(new Uint8Array());return bytesToHex(h.digest());}
  for(let offset=0;offset<blob.size;offset+=sliceBytes){
    const end=Math.min(blob.size,offset+sliceBytes);
    h.update(new Uint8Array(await blob.slice(offset,end).arrayBuffer()));
    onProgress?.(end/blob.size);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  return bytesToHex(h.digest());
}
export function hashBytes(bytes){return bytesToHex(sha256(bytes));}
export function hashText(text){return hashBytes(new TextEncoder().encode(text));}
