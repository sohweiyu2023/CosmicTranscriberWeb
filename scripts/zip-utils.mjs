import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';

const UTF8_FLAG = 0x0800;
const STORE = 0;
const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n=0;n<256;n++) { let c=n; for(let k=0;k<8;k++) c=(c&1)?0xedb88320^(c>>>1):c>>>1; table[n]=c>>>0; }
  return table;
})();
export function crc32(buf){ let c=0xffffffff; for(const b of buf)c=crcTable[(c^b)&0xff]^(c>>>8); return (c^0xffffffff)>>>0; }
function safeZipName(name){
  const n=String(name).replaceAll('\\','/');
  if (!n || n.startsWith('/') || /^[A-Za-z]:\//.test(n) || n.split('/').some(x=>x===''||x==='.'||x==='..')) throw new Error(`Unsafe ZIP entry: ${name}`);
  return n;
}
function localHeader(nameBytes,size,crc){const b=Buffer.alloc(30);b.writeUInt32LE(LOCAL_SIG,0);b.writeUInt16LE(20,4);b.writeUInt16LE(UTF8_FLAG,6);b.writeUInt16LE(STORE,8);b.writeUInt16LE(0,10);b.writeUInt16LE(0x21,12);b.writeUInt32LE(crc,14);b.writeUInt32LE(size,18);b.writeUInt32LE(size,22);b.writeUInt16LE(nameBytes.length,26);b.writeUInt16LE(0,28);return b;}
function centralHeader(nameBytes,size,crc,offset){const b=Buffer.alloc(46);b.writeUInt32LE(CENTRAL_SIG,0);b.writeUInt16LE(0x0314,4);b.writeUInt16LE(20,6);b.writeUInt16LE(UTF8_FLAG,8);b.writeUInt16LE(STORE,10);b.writeUInt16LE(0,12);b.writeUInt16LE(0x21,14);b.writeUInt32LE(crc,16);b.writeUInt32LE(size,20);b.writeUInt32LE(size,24);b.writeUInt16LE(nameBytes.length,28);b.writeUInt16LE(0,30);b.writeUInt16LE(0,32);b.writeUInt16LE(0,34);b.writeUInt16LE(0,36);b.writeUInt32LE(0,38);b.writeUInt32LE(offset,42);return b;}

export async function collectFiles(root,{excludeDirs=new Set(),excludeFiles=new Set()}={}){
  const rows=[];
  async function walk(rel=''){
    const dir=path.join(root,rel);
    for(const e of await readdir(dir,{withFileTypes:true})){
      if(e.name.includes('\0')) throw new Error('NUL filename encountered.');
      const r=path.join(rel,e.name);
      const unix=r.replaceAll('\\','/');
      const st=await lstat(path.join(root,r));
      if(st.isSymbolicLink()) throw new Error(`Symlinks are forbidden in source packages: ${unix}`);
      if(st.isDirectory()){if(!excludeDirs.has(e.name))await walk(r);continue;}
      if(!st.isFile())throw new Error(`Unsupported package entry type: ${unix}`);
      if(!excludeFiles.has(unix))rows.push(unix);
    }
  }
  await walk(); rows.sort((a,b)=>a.localeCompare(b,'en')); return rows;
}

export async function createStoredZip({sourceRoot,rootName,files,outPath}){
  const parts=[],central=[]; let offset=0;
  for(const rel of files){
    const entry=safeZipName(`${rootName}/${rel}`); const name=Buffer.from(entry,'utf8'); const data=await readFile(path.join(sourceRoot,rel));
    if(data.length>0xffffffff)throw new Error(`ZIP64 not implemented; file too large: ${rel}`);
    const crc=crc32(data),lh=localHeader(name,data.length,crc); parts.push(lh,name,data); central.push(centralHeader(name,data.length,crc,offset),name); offset+=lh.length+name.length+data.length;
  }
  const centralOffset=offset,centralSize=central.reduce((n,b)=>n+b.length,0); const e=Buffer.alloc(22);e.writeUInt32LE(EOCD_SIG,0);e.writeUInt16LE(0,4);e.writeUInt16LE(0,6);e.writeUInt16LE(files.length,8);e.writeUInt16LE(files.length,10);e.writeUInt32LE(centralSize,12);e.writeUInt32LE(centralOffset,16);e.writeUInt16LE(0,20);
  await writeFile(outPath,Buffer.concat([...parts,...central,e]));
}
function findEocd(buf){for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--)if(buf.readUInt32LE(i)===EOCD_SIG)return i;throw new Error('ZIP EOCD not found.');}
export async function inspectZip(zipPath){
  const buf=await readFile(zipPath),e=findEocd(buf),count=buf.readUInt16LE(e+10),centralOffset=buf.readUInt32LE(e+16); let p=centralOffset;const entries=[];
  for(let i=0;i<count;i++){
    if(buf.readUInt32LE(p)!==CENTRAL_SIG)throw new Error('Malformed central directory.');
    const flags=buf.readUInt16LE(p+8),method=buf.readUInt16LE(p+10),crc=buf.readUInt32LE(p+16),compressedSize=buf.readUInt32LE(p+20),size=buf.readUInt32LE(p+24),nameLen=buf.readUInt16LE(p+28),extraLen=buf.readUInt16LE(p+30),commentLen=buf.readUInt16LE(p+32),localOffset=buf.readUInt32LE(p+42);
    const name=safeZipName(buf.subarray(p+46,p+46+nameLen).toString('utf8'));
    entries.push({name,flags,method,crc,compressedSize,size,localOffset}); p+=46+nameLen+extraLen+commentLen;
  }
  return {buffer:buf,entries};
}
export async function extractStoredZip(zipPath,dest){
  const {buffer:buf,entries}=await inspectZip(zipPath); const destAbs=path.resolve(dest); await mkdir(destAbs,{recursive:true});
  for(const ent of entries){
    if((ent.flags&UTF8_FLAG)!==UTF8_FLAG)throw new Error(`ZIP UTF-8 filename flag missing: ${ent.name}`);
    if(ent.method!==STORE)throw new Error(`Unsupported ZIP method ${ent.method}: ${ent.name}`);
    const p=ent.localOffset;if(buf.readUInt32LE(p)!==LOCAL_SIG)throw new Error(`Local header missing: ${ent.name}`);const nameLen=buf.readUInt16LE(p+26),extraLen=buf.readUInt16LE(p+28),localName=buf.subarray(p+30,p+30+nameLen).toString('utf8');if(localName!==ent.name)throw new Error(`Central/local filename mismatch: ${ent.name}`);
    const start=p+30+nameLen+extraLen,end=start+ent.compressedSize,data=buf.subarray(start,end);if(data.length!==ent.size||crc32(data)!==ent.crc)throw new Error(`ZIP CRC/size mismatch: ${ent.name}`);
    const target=path.resolve(destAbs,...ent.name.split('/'));if(!(target===destAbs||target.startsWith(destAbs+path.sep)))throw new Error(`ZIP traversal rejected: ${ent.name}`);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data);
  }
  return entries;
}
export { UTF8_FLAG };
