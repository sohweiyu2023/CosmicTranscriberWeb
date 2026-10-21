import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'), out=path.join(root,'dist','public');
await rm(path.join(root,'dist'),{recursive:true,force:true}); await mkdir(out,{recursive:true});
await cp(path.join(root,'public'),out,{recursive:true});
const noble=path.join(root,'node_modules','@noble','hashes');
try{await stat(noble)}catch{throw new Error('Missing node_modules/@noble/hashes. Run npm ci before build.');}
const vendor=path.join(out,'vendor','noble-hashes'); await mkdir(vendor,{recursive:true});
async function copyJs(src,dst){for(const e of await readdir(src,{withFileTypes:true})){const a=path.join(src,e.name),b=path.join(dst,e.name);if(e.isDirectory()){await mkdir(b,{recursive:true});await copyJs(a,b)}else if(/\.(js|json)$/.test(e.name)){await cp(a,b)}}}
await copyJs(noble,vendor);
// Preserve the owner grant and exact third-party grants with distributed assets.
await cp(path.join(root,'LICENSE'),path.join(out,'LICENSE'));
await cp(path.join(root,'THIRD-PARTY-NOTICES.md'),path.join(out,'THIRD-PARTY-NOTICES.md'));
await cp(path.join(root,'licenses'),path.join(out,'licenses'),{recursive:true});
await cp(path.join(noble,'LICENSE'),path.join(vendor,'LICENSE'));
console.log(`Built static assets: ${out}`);
