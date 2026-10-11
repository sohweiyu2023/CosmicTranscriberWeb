import { readFile, access, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { invokeNpm } from './npm-invoke.mjs';
import os from 'node:os';
import path from 'node:path';
import { inspectZip, extractStoredZip, UTF8_FLAG } from './zip-utils.mjs';

const root=path.resolve(import.meta.dirname,'..');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const candidate=process.argv.includes('--audit-candidate');
const stagingCandidate=process.argv.includes('--staging-candidate');
if(candidate&&stagingCandidate)throw new Error('Choose either --audit-candidate or --staging-candidate, not both.');
const zipArg=process.argv.find(x=>x.endsWith('.zip')) || path.join(path.dirname(root),`${path.basename(root)}-source.zip`);
const zipPath=path.resolve(zipArg);
const {entries}=await inspectZip(zipPath);
if(!entries.length)throw new Error('Source ZIP is empty.');
if(entries.some(e=>(e.flags&UTF8_FLAG)!==UTF8_FLAG))throw new Error('Every ZIP filename must be explicitly UTF-8 encoded.');
const rootName=entries[0].name.split('/')[0];
const expectedRoot=`CosmicTranscriberWeb-${pkg.version}`;
if(rootName!==expectedRoot)throw new Error(`ZIP top-level root must be exactly ${expectedRoot}; found ${rootName}.`);
if(entries.some(e=>e.name.split('/')[0]!==rootName))throw new Error('ZIP contains multiple top-level roots.');
const unicode=`${rootName}/tests/fixtures/ID3 Unicode 東京.mp3`;
if(!entries.some(e=>e.name===unicode))throw new Error(`Exact Unicode fixture missing from ZIP: ${unicode}`);
for(const e of entries){if(/(?:^|\/)(?:node_modules|dist|artifacts|\.git|\.wrangler|playwright-report|test-results)(?:\/|$)/.test(e.name))throw new Error(`Forbidden release path: ${e.name}`);if(/(?:^|\/)(?:\.dev\.vars|\.env(?:\..*)?)$/.test(e.name))throw new Error(`Forbidden secret file: ${e.name}`);}
if(!entries.some(e=>e.name===`${rootName}/package-lock.json`)){
  if(!candidate)throw new Error('package-lock.json is required before this artifact can be release-certified.');
  console.warn('AUDIT-CANDIDATE WARNING: package-lock.json is absent; dependency-reproducibility release gate is not satisfied.');
}
const packageTempParent=process.platform==='win32'?path.dirname(root):os.tmpdir();
const tmp=await mkdtemp(path.join(packageTempParent,'.cosmic-package-'));
try{
  await extractStoredZip(zipPath,tmp);const extracted=path.join(tmp,rootName);await access(path.join(extracted,'tests','fixtures','ID3 Unicode 東京.mp3'));
  const manifest=JSON.parse(await readFile(path.join(extracted,'RELEASE_MANIFEST.json'),'utf8'));
  if(manifest.version!==pkg.version)throw new Error(`Release manifest version ${manifest.version} does not match package ${pkg.version}.`);
  const lockPath=path.join(extracted,'package-lock.json');
  const lockExists=await access(lockPath).then(()=>true,()=>false);
  const lockSha=lockExists?createHash('sha256').update(await readFile(lockPath)).digest('hex'):null;
  const lock=manifest.dependencyLock;
  if(!lock||typeof lock!=='object'||Array.isArray(lock))throw new Error('RELEASE_MANIFEST.json dependencyLock must use the structured schema.');
  if(candidate){
    if(manifest.releaseReady!==false)throw new Error('Audit-candidate manifest must remain releaseReady:false.');
    const expectedStatus=lockExists?'present-unverified':'missing';
    if(lock.status!==expectedStatus||lock.sha256!==lockSha||lock.registry!==null)throw new Error(`Audit-candidate dependencyLock metadata must be ${expectedStatus} with exact hash state and no certified registry.`);
  }else if(stagingCandidate){
    if(manifest.releaseReady!==false)throw new Error('Staging-candidate manifest must remain releaseReady:false.');
    if(manifest.certificationLevel!=='staging')throw new Error('Staging-candidate manifest must declare certificationLevel:staging.');
    if(!lockExists||lock.status!=='verified'||lock.sha256!==lockSha||lock.registry!=='https://registry.npmjs.org/')throw new Error('Staging-candidate dependencyLock metadata must match package-lock.json and the verified public npm registry.');
  }else{
    if(manifest.releaseReady!==true)throw new Error('Release manifest must be releaseReady:true.');
    if(!lockExists||lock.status!=='verified'||lock.sha256!==lockSha||lock.registry!=='https://registry.npmjs.org/')throw new Error('Certified dependencyLock metadata must match package-lock.json and the verified public npm registry.');
  }
  const sums=(await readFile(path.join(extracted,'SHA256SUMS.txt'),'utf8')).trim().split(/\r?\n/).filter(Boolean);for(const line of sums){const m=/^([0-9a-f]{64})  (.+)$/.exec(line);if(!m)throw new Error(`Malformed checksum row: ${line}`);const got=createHash('sha256').update(await readFile(path.join(extracted,m[2]))).digest('hex');if(got!==m[1])throw new Error(`Post-extraction SHA-256 mismatch: ${m[2]}`);}
  const node=process.execPath;for(const script of ['scripts/secret-scan.mjs','scripts/validate.mjs']){const r=spawnSync(node,[script],{cwd:extracted,stdio:'inherit'});if(r.status!==0)throw new Error(`Fresh-extraction verification failed: ${script}`);}
  if(!candidate){
    const lock=spawnSync(node,['scripts/deps-lock-verify.mjs'],{cwd:extracted,stdio:'inherit'});if(lock.status!==0)throw new Error('Fresh-extraction package-lock gate failed.');
    console.log('Fresh extraction: installing exactly from package-lock.json with npm ci…');
    const ci=invokeNpm(['ci'],{cwd:extracted,stdio:'inherit'});if(ci.status!==0)throw new Error('Fresh-extraction npm ci failed.');
    console.log('Fresh extraction: rerunning the complete release verification…');
    const full=spawnSync(node,['scripts/release-verify.mjs','--release-package'],{cwd:extracted,stdio:'inherit'});if(full.status!==0)throw new Error('Fresh-extraction complete release verification failed.');
  }
  console.log(`Source ZIP round-trip PASS: ${entries.length} UTF-8 entries, exact Unicode fixture, CRC, SHA-256, secret scan, dependency-free validation${candidate?'':', npm ci, and complete dependency-backed release verification'}.`);
  console.log(`Package version: ${pkg.version}`);
} finally {await rm(tmp,{recursive:true,force:true});}
