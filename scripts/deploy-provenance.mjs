import {readFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

const WRANGLER_MUTABLE_ENV_VAR_FIELDS=new Set(['ACCESS_TEAM_DOMAIN','ACCESS_AUDIENCE','ADMIN_EMAILS']);

const GENERATED_DIRS=new Set(['node_modules','dist','artifacts','.git','.wrangler','playwright-report','test-results']);
async function certifiedSourceFiles(root){
  const files=[];
  async function walk(rel=''){
    for(const entry of await readdir(path.join(root,rel),{withFileTypes:true})){
      const child=path.join(rel,entry.name),unix=child.replaceAll('\\','/');
      const st=await lstat(path.join(root,child));
      if(st.isSymbolicLink())throw new Error(`symlink is not permitted in a certified deployment tree: ${unix}`);
      if(st.isDirectory()){if(!GENERATED_DIRS.has(entry.name))await walk(child);continue;}
      if(!st.isFile())throw new Error(`unsupported file type in certified deployment tree: ${unix}`);
      if(unix==='SHA256SUMS.txt')continue;
      files.push(unix);
    }
  }
  await walk();files.sort();return files;
}

function canonicalize(value){
  if(Array.isArray(value))return value.map(canonicalize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalize(value[k])]));
  return value;
}

export function normalizedWranglerForRelease(config){
  const copy=structuredClone(config);
  for(const envName of ['staging','production']){
    const vars=copy?.env?.[envName]?.vars;
    if(!vars||typeof vars!=='object'||Array.isArray(vars))continue;
    for(const key of WRANGLER_MUTABLE_ENV_VAR_FIELDS)if(Object.hasOwn(vars,key))vars[key]=`__PRIVATE_${key}__`;
    for(const binding of copy?.env?.[envName]?.d1_databases||[])if(binding?.binding==='USER_DB'&&Object.hasOwn(binding,'database_id'))binding.database_id='__PRIVATE_USER_DB_ID__';
  }
  return canonicalize(copy);
}

export function wranglerReleaseFingerprint(config){
  return createHash('sha256').update(JSON.stringify(normalizedWranglerForRelease(config))).digest('hex');
}

export function validateReleaseManifest(manifest,packageVersion,{targetEnv='production'}={}){
  const errs=[];
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))return ['RELEASE_MANIFEST.json is missing or malformed'];
  if(manifest.product!=='Cosmic Transcriber Web')errs.push('release manifest product mismatch');
  if(manifest.version!==packageVersion)errs.push(`release manifest version must match package version ${packageVersion}`);
  const stagingCertified=targetEnv==='staging'&&manifest.releaseReady===false&&manifest.certificationLevel==='staging';
  const finalCertified=manifest.releaseReady===true&&manifest.certificationLevel==='release';
  if(!stagingCertified&&!finalCertified)errs.push(targetEnv==='staging'?'source is not staging-certified (requires certificationLevel:staging with releaseReady:false, or final release certification)':'source is not final release-certified (production requires releaseReady:true and certificationLevel:release)');
  const lock=manifest.dependencyLock;
  if(!lock||typeof lock!=='object'||Array.isArray(lock)||lock.status!=='verified'||!/^[0-9a-f]{64}$/.test(String(lock.sha256||''))||lock.registry!=='https://registry.npmjs.org/')errs.push('release manifest dependency lock is not verified against the public npm registry');
  if(!/^[0-9a-f]{64}$/.test(String(manifest.wranglerReleaseFingerprint||'')))errs.push('release manifest Wrangler security fingerprint is missing or malformed');
  return errs;
}

export function parseChecksumManifest(text){
  const rows=[];
  for(const raw of String(text||'').split(/\r?\n/)){
    if(!raw.trim())continue;
    const m=raw.match(/^([0-9a-f]{64})  (.+)$/);
    if(!m)throw new Error(`Malformed SHA256SUMS.txt row: ${raw.slice(0,160)}`);
    const rel=m[2].replaceAll('\\','/');
    if(rel.startsWith('/')||rel.includes('../')||rel.includes('/..'))throw new Error(`Unsafe checksum path: ${rel}`);
    rows.push({sha256:m[1],rel});
  }
  if(rows.length===0)throw new Error('SHA256SUMS.txt is empty.');
  return rows;
}

async function sha256File(file){const b=await readFile(file);return createHash('sha256').update(b).digest('hex')}

export async function verifyReleaseProvenance(root,{packageVersion,targetEnv='production'}){
  let manifest;
  try{manifest=JSON.parse(await readFile(path.join(root,'RELEASE_MANIFEST.json'),'utf8'));}
  catch{return ['RELEASE_MANIFEST.json is missing or malformed'];}
  const errs=validateReleaseManifest(manifest,packageVersion,{targetEnv});
  if(errs.length)return errs;
  let rows;
  try{rows=parseChecksumManifest(await readFile(path.join(root,'SHA256SUMS.txt'),'utf8'));}
  catch(e){return [e.message||'SHA256SUMS.txt is invalid'];}
  const listed=new Set(rows.map(x=>x.rel));
  try{
    const actual=new Set(await certifiedSourceFiles(root));
    for(const rel of actual)if(!listed.has(rel))errs.push(`uncertified source file present: ${rel}`);
    for(const rel of listed)if(!actual.has(rel))errs.push(`release-certified source file missing: ${rel}`);
  }catch(e){errs.push(e?.message||'certified source tree could not be enumerated')}
  if(!listed.has('RELEASE_MANIFEST.json'))errs.push('release manifest is not covered by SHA256SUMS.txt');
  if(!listed.has('package.json'))errs.push('package.json is not covered by SHA256SUMS.txt');
  if(!listed.has('wrangler.jsonc'))errs.push('wrangler.jsonc is not covered by SHA256SUMS.txt');
  for(const row of rows){
    if(row.rel==='wrangler.jsonc')continue;
    try{const actual=await sha256File(path.join(root,row.rel));if(actual!==row.sha256)errs.push(`release-certified source checksum mismatch: ${row.rel}`)}
    catch{errs.push(`release-certified source file missing: ${row.rel}`)}
  }
  try{
    const currentWrangler=JSON.parse(await readFile(path.join(root,'wrangler.jsonc'),'utf8'));
    if(wranglerReleaseFingerprint(currentWrangler)!==manifest.wranglerReleaseFingerprint)errs.push('release-certified Wrangler security/configuration fingerprint mismatch; only approved staging/production Access, administrator-email and USER_DB identifier fields may change after packaging');
  }catch{errs.push('wrangler.jsonc is missing or malformed')}
  return [...new Set(errs)];
}
