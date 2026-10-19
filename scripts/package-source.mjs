import {readFile,writeFile,access,rm,mkdtemp,mkdir,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {collectFiles,createStoredZip} from './zip-utils.mjs';
import {wranglerReleaseFingerprint} from './deploy-provenance.mjs';

const root=path.resolve(import.meta.dirname,'..');
const parent=path.dirname(root);
const candidate=process.argv.includes('--audit-candidate');
const stagingCandidate=process.argv.includes('--staging-candidate');
if(candidate&&stagingCandidate)throw new Error('Choose either --audit-candidate or --staging-candidate, not both.');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const rootName=`CosmicTranscriberWeb-${pkg.version}`;
const excludeDirs=new Set(['node_modules','dist','artifacts','.git','.wrangler','playwright-report','test-results']);
const excludeFiles=new Set(['.dev.vars','.env']);
const isGeneratedWorkspaceFile=(rel)=>/\.log$/i.test(rel);

async function exists(file){try{await access(file);return true}catch{return false}}
function assertSafePackagePath(rel){
  if(/(^|\/)\.env(?:\.|$)/.test(rel)&&!/(^|\/)\.env\.example$/.test(rel))throw new Error(`Secret-like environment file would be packaged: ${rel}`);
  if(/(^|\/)\.dev\.vars$/.test(rel))throw new Error(`Secret-like environment file would be packaged: ${rel}`);
}
async function copySourceIntoStage(stageRoot){
  const files=(await collectFiles(root,{excludeDirs,excludeFiles})).filter(rel=>!isGeneratedWorkspaceFile(rel));
  for(const rel of files){
    assertSafePackagePath(rel);
    const dest=path.join(stageRoot,rel);
    await mkdir(path.dirname(dest),{recursive:true});
    await copyFile(path.join(root,rel),dest);
  }
}

await access(path.join(root,'tests','fixtures','ID3 Unicode 東京.mp3'));
if(!candidate){
  const verification=spawnSync(process.execPath,['scripts/release-verify.mjs','--release-package'],{cwd:root,stdio:'inherit'});
  if(verification.status!==0)throw new Error('Refusing certified package because the complete release verification did not pass.');
}

// Build the package in an isolated staging copy. The editable/audit-candidate
// tree is never stamped releaseReady:true, so an interrupted or failed release
// packaging attempt cannot accidentally make the development tree deployable.
const stageParent=await mkdtemp(path.join(os.tmpdir(),'cosmic-release-stage-'));
const stageRoot=path.join(stageParent,rootName);
const out=path.join(parent,`${rootName}-source.zip`);
try{
  await mkdir(stageRoot,{recursive:true});
  await copySourceIntoStage(stageRoot);

  const wranglerConfig=JSON.parse(await readFile(path.join(stageRoot,'wrangler.jsonc'),'utf8'));
  const lockPath=path.join(stageRoot,'package-lock.json');
  const lockPresent=await exists(lockPath);
  const lockBytes=lockPresent?await readFile(lockPath):null;
  const lockSha256=lockBytes?createHash('sha256').update(lockBytes).digest('hex'):null;
  const dependencyLock={
    status:candidate?(lockPresent?'present-unverified':'missing'):'verified',
    sha256:lockSha256,
    registry:!candidate&&lockPresent?'https://registry.npmjs.org/':null
  };
  const manifest={
    product:'Cosmic Transcriber Web',
    version:pkg.version,
    generatedAt:new Date().toISOString(),
    releaseReady:!candidate&&!stagingCandidate,
    certificationLevel:stagingCandidate?'staging':(!candidate?'release':'audit'),
    dependencyLock,
    unicodeFixture:'tests/fixtures/ID3 Unicode 東京.mp3',
    archiveEncoding:'UTF-8 filenames (general-purpose bit 11 set for every entry)',
    wranglerReleaseFingerprint:wranglerReleaseFingerprint(wranglerConfig),
    wranglerMutableAfterRelease:['env.staging.vars.ACCESS_TEAM_DOMAIN','env.staging.vars.ACCESS_AUDIENCE','env.staging.vars.ADMIN_EMAILS','env.staging.d1_databases.USER_DB.database_id','env.production.vars.ACCESS_TEAM_DOMAIN','env.production.vars.ACCESS_AUDIENCE','env.production.vars.ADMIN_EMAILS','env.production.d1_databases.USER_DB.database_id'],
    notes:candidate?['This source package is an audit candidate and is blocked from deployment.']:stagingCandidate?['This source package passed package certification for STAGING ONLY. releaseReady remains false until staging acceptance passes; production deployment must remain blocked.']:[]
  };
  await writeFile(path.join(stageRoot,'RELEASE_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');

  let r=spawnSync(process.execPath,['scripts/checksums.mjs'],{cwd:stageRoot,stdio:'inherit'});
  if(r.status!==0)throw new Error('Checksum generation failed.');

  const files=(await collectFiles(stageRoot,{excludeDirs,excludeFiles})).filter(rel=>!isGeneratedWorkspaceFile(rel));
  for(const rel of files)assertSafePackagePath(rel);
  await rm(out,{force:true});
  await createStoredZip({sourceRoot:stageRoot,rootName,files,outPath:out});

  const verifyScript=path.join(root,'scripts','verify-source-package.mjs');
  const args=[verifyScript,out,...(candidate?['--audit-candidate']:stagingCandidate?['--staging-candidate']:[])];
  r=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});
  if(r.status!==0){
    await rm(out,{force:true});
    throw new Error('Source package round-trip verification failed. The failed archive was deleted.');
  }
  console.log(out);
} finally {
  await rm(stageParent,{recursive:true,force:true});
}
