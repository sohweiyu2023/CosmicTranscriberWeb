import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const dist=path.join(root,'dist','public');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const findings=[];
const files=[];

async function walk(dir,rel=''){
  for(const e of await readdir(dir,{withFileTypes:true})){
    const r=path.join(rel,e.name).replaceAll('\\','/');
    const p=path.join(dir,e.name);
    if(e.isDirectory())await walk(p,r);else if(e.isFile())files.push(r);else findings.push(`${r}: unsupported build entry type`);
  }
}
try{await stat(dist)}catch{console.error('Built frontend is missing. Run npm run build first.');process.exit(1)}
await walk(dist);

for(const required of ['index.html','js/app.js','js/hash.js','vendor/noble-hashes/sha2.js'])if(!files.includes(required))findings.push(`${required}: required build artifact missing`);
for(const rel of files){
  if(/\.map$/i.test(rel))findings.push(`${rel}: source map must not ship`);
  if(/(^|\/)(?:\.env(?:\..*)?|\.dev\.vars|credentials?|secrets?)(\/|$)/i.test(rel))findings.push(`${rel}: secret-like file must not ship`);
  if(/service[-_.]?worker|sw\.js$/i.test(rel))findings.push(`${rel}: service worker must not ship in V1`);
  const p=path.join(dist,...rel.split('/')); const st=await stat(p); if(st.size>8*1024*1024)continue;
  let text;try{text=await readFile(p,'utf8')}catch{continue}
  if(/sourceMappingURL\s*=/.test(text))findings.push(`${rel}: source-map reference must not ship`);
  if(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/.test(text))findings.push(`${rel}: possible OpenAI key literal in built frontend`);
  if(/BYOK_SESSION_MASTER_KEY_CURRENT\s*=\s*["']?[A-Za-z0-9+/_=-]{32,}/.test(text))findings.push(`${rel}: possible BYOK master key in built frontend`);
  if(/CLOUDFLARE_API_TOKEN\s*=\s*\S+/.test(text))findings.push(`${rel}: possible Cloudflare token in built frontend`);
  if(/https:\/\/api\.openai\.com/i.test(text))findings.push(`${rel}: browser bundle must not contain the OpenAI upstream URL`);
  if(/serviceWorker\.register/.test(text))findings.push(`${rel}: service worker registration must not ship`);
}
const index=await readFile(path.join(dist,'index.html'),'utf8');
if(!index.includes(`v${pkg.version}`))findings.push(`index.html: built UI version does not match package ${pkg.version}`);
if(findings.length){console.error(findings.join('\n'));process.exit(1)}
console.log(`Built frontend inspection PASS (${files.length} files): required assets present; no source maps, service worker, obvious secrets, or browser-side OpenAI upstream.`);
