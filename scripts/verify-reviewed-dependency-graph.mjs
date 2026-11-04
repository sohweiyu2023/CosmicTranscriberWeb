import {readFile,realpath,lstat,readdir,writeFile,appendFile,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {spawnSync} from 'node:child_process';
import {createStoredZip,crc32} from './zip-utils.mjs';

const CODES=new Set(['dependency_snapshot_invalid','dependency_snapshot_hash_mismatch','dependency_snapshot_toolchain_mismatch','dependency_snapshot_identity_mismatch','dependency_snapshot_registry_rejected','dependency_snapshot_integrity_missing','dependency_snapshot_workerd_mismatch','dependency_snapshot_script_unreviewed','dependency_snapshot_source_unavailable','dependency_snapshot_source_mismatch','dependency_snapshot_target_rejected','dependency_input_bundle_invalid','dependency_input_bundle_hash_mismatch','dependency_input_bundle_exists','dependency_input_bundle_copy_failed']);
const fail=(code,details)=>{const error=Error(code);if(details)error.safeDetails=Object.freeze(details);throw error};
const badBundle=(cause,details={})=>fail('dependency_input_bundle_invalid',{stage:'input_bundle_validation',cause,...details});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const MAX_BUNDLE=32*1024*1024,MAX_ENTRY=8*1024*1024;
function gitRead(sourceRoot,args){
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.toUpperCase().startsWith('GIT_')));env.GIT_NO_REPLACE_OBJECTS='1';
  return spawnSync('git',['--no-replace-objects','--no-pager',...args],{cwd:sourceRoot,env,shell:false,encoding:null,timeout:10000,maxBuffer:65536,windowsHide:true});
}
export function verifyCommittedSnapshot({sourceRoot,commit,snapshotBytes}){
  if(typeof commit!=='string'||!/^[a-f0-9]{40}$/i.test(commit))fail('dependency_snapshot_source_unavailable');
  const result=gitRead(sourceRoot,['show',`${commit}:DEPENDENCY_GRAPH.json`]);
  if(result.status!==0||!result.stdout?.length){
    const text=String(result.stderr||''),cause=result.error?.code==='ENOENT'?'git_not_found':result.error?.code==='ETIMEDOUT'?'timeout':/not a git repository/i.test(text)?'not_a_repository':/dubious ownership/i.test(text)?'unsafe_repository':/bad object|invalid object|not a valid object/i.test(text)?'object_missing':/does not exist|exists on disk, but not in/i.test(text)?'snapshot_missing':'unknown';
    const error=Error('dependency_snapshot_source_unavailable');error.safeDetails=Object.freeze({stage:'git_snapshot_read',exitCode:Number.isInteger(result.status)?result.status:null,cause,rawStderrRetained:false,causeComplete:cause!=='unknown'});throw error;
  }
  if(digest(result.stdout)!==digest(snapshotBytes))fail('dependency_snapshot_source_mismatch');
}
export function verifyDependencySnapshot({packageBytes,lockBytes,snapshot,nodeVersion=process.versions.node}){
  try{
    const keys=['schema','packageSha256','lockSha256','nodeVersion','npmVersion','registry','workerdVersion','fixturePaths','generatedFixturePaths'];
    if(!snapshot||!isDeepStrictEqual(Object.keys(snapshot).sort(),keys.sort())||snapshot.schema!=='cosmic-dependency-snapshot-1'||
      !/^[a-f0-9]{64}$/.test(snapshot.packageSha256)||!/^[a-f0-9]{64}$/.test(snapshot.lockSha256)||snapshot.registry!=='https://registry.npmjs.org/'||!/^1\.\d{8}\.\d+$/.test(snapshot.workerdVersion))fail('dependency_snapshot_invalid');
    const validPath=p=>typeof p==='string'&&p.length<=240&&p.normalize('NFC')===p&&p.startsWith('tests/fixtures/')&&!/[\\<>:"|?*\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(p)&&!p.split('/').some(part=>!part||part==='.'||part==='..'||part.toLowerCase()==='.git'||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))&&/\.(mp3|flac|mp4|mpeg|mpga|m4a|ogg|wav|webm|md|json|txt)$/.test(p);
    if(!Array.isArray(snapshot.fixturePaths)||!snapshot.fixturePaths.length||snapshot.fixturePaths.length>128||snapshot.fixturePaths.some(p=>!validPath(p))||new Set(snapshot.fixturePaths.map(p=>p.toLowerCase())).size!==snapshot.fixturePaths.length||!Array.isArray(snapshot.generatedFixturePaths)||snapshot.generatedFixturePaths.some(p=>!snapshot.fixturePaths.includes(p))||new Set(snapshot.generatedFixturePaths).size!==snapshot.generatedFixturePaths.length)fail('dependency_snapshot_invalid');
    if(snapshot.nodeVersion!=='26.7.0'||snapshot.npmVersion!=='12.0.2'||nodeVersion!==snapshot.nodeVersion)fail('dependency_snapshot_toolchain_mismatch');
    if(digest(packageBytes)!==snapshot.packageSha256||digest(lockBytes)!==snapshot.lockSha256)fail('dependency_snapshot_hash_mismatch');
    const pkg=JSON.parse(Buffer.from(packageBytes).toString('utf8')),lock=JSON.parse(Buffer.from(lockBytes).toString('utf8'));
    const root=lock.packages?.[''];
    if(lock.lockfileVersion<3||!root||root.name!==pkg.name||root.version!==pkg.version||!isDeepStrictEqual(root.dependencies||{},pkg.dependencies||{})||!isDeepStrictEqual(root.devDependencies||{},pkg.devDependencies||{}))fail('dependency_snapshot_identity_mismatch');
    let workerdCount=0,workerdPlatformCount=0;
    for(const [location,entry] of Object.entries(lock.packages)){
      if(location==='')continue;
      if(!location.startsWith('node_modules/')||location.includes('\\')||location.split('/').some(part=>!part||part==='.'||part==='..'))fail('dependency_snapshot_registry_rejected');
      if(!entry||entry.link)fail('dependency_snapshot_registry_rejected');
      if(entry.resolved){let url;try{url=new URL(entry.resolved)}catch{fail('dependency_snapshot_registry_rejected')}
        if(url.protocol!=='https:'||url.hostname!=='registry.npmjs.org'||url.port||url.username||url.password||url.search||url.hash)fail('dependency_snapshot_registry_rejected');
        if(typeof entry.integrity!=='string'||!/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity))fail('dependency_snapshot_integrity_missing');
      }else if(!entry.inBundle)fail('dependency_snapshot_registry_rejected');
      const name=location.slice(location.lastIndexOf('node_modules/')+13);
      if(name==='workerd'){workerdCount++;if(entry.version!==snapshot.workerdVersion)fail('dependency_snapshot_workerd_mismatch')}
      if(name.startsWith('@cloudflare/workerd-')){workerdPlatformCount++;if(entry.version!==snapshot.workerdVersion)fail('dependency_snapshot_workerd_mismatch')}
      if(entry.hasInstallScript){const exact=`${name}@${entry.version}`;if(pkg.allowScripts?.[exact]!==true&&pkg.allowScripts?.[name]!==false)fail('dependency_snapshot_script_unreviewed')}
    }
    if(workerdCount===0||pkg.allowScripts?.[`workerd@${snapshot.workerdVersion}`]!==true)fail('dependency_snapshot_workerd_mismatch');
    return Object.freeze({schema:'cosmic-dependency-snapshot-check-1',status:'PASS',packageSha256:snapshot.packageSha256,lockSha256:snapshot.lockSha256,workerdVersion:snapshot.workerdVersion,workerdCount,workerdPlatformCount,nodeVersion:snapshot.nodeVersion,npmVersion:snapshot.npmVersion});
  }catch(error){if(CODES.has(error?.message))throw error;fail('dependency_snapshot_invalid')}
}
async function regularBytes(file,limit=2*1024*1024){try{const stat=await lstat(file);if(stat.isSymbolicLink()||!stat.isFile())badBundle('input_not_regular');if(stat.size>limit)badBundle('input_size_limit',{bytes:stat.size,limit});return await readFile(file)}catch(error){if(CODES.has(error?.message))throw error;badBundle('input_read_failed',{ioCode:['EACCES','EPERM','ENOSPC','EIO','ENOENT'].includes(error?.code)?error.code:'unknown'})}}
async function trustedInputs(sourceRoot,commit){
  const [packageBytes,lockBytes,snapshotBytes]=await Promise.all(['package.json','package-lock.json','DEPENDENCY_GRAPH.json'].map(name=>regularBytes(path.join(sourceRoot,name))));
  verifyCommittedSnapshot({sourceRoot,commit,snapshotBytes});const snapshot=JSON.parse(snapshotBytes.toString('utf8'));verifyDependencySnapshot({packageBytes,lockBytes,snapshot});
  const result=gitRead(sourceRoot,['ls-tree','-r','-z',commit,'--','tests/fixtures/']);if(result.status!==0)fail('dependency_snapshot_source_unavailable');
  const immutable=new Map();for(const row of new TextDecoder('utf-8',{fatal:true}).decode(result.stdout).split('\0').filter(Boolean)){const match=/^100(?:644|755) blob ([a-f0-9]{40})\t(tests\/fixtures\/.+)$/.exec(row);if(!match)fail('dependency_input_bundle_invalid');immutable.set(match[2],match[1])}
  if(immutable.size!==snapshot.fixturePaths.length||snapshot.fixturePaths.some(p=>!immutable.has(p)))badBundle('fixture_policy_not_tracked',{declaredFixtures:snapshot.fixturePaths.length,trackedFixtures:immutable.size});
  return {packageBytes,lockBytes,snapshot,immutable};
}
async function regularDestination(sourceRoot,relative){
  let current=sourceRoot;const parts=relative.split('/');
  for(let i=0;i<parts.length;i++){current=path.join(current,parts[i]);const stat=await lstat(current);if(stat.isSymbolicLink()||(i===parts.length-1?!stat.isFile():!stat.isDirectory()))fail('dependency_input_bundle_invalid')}
  return current;
}
function bundleEntries(buffer,policy){
  try{
    if(buffer.length<22||buffer.length>MAX_BUNDLE)badBundle('archive_size',{bytes:buffer.length,limit:MAX_BUNDLE});
    const e=buffer.length-22;if(buffer.readUInt32LE(e)!==0x06054b50||buffer.readUInt16LE(e+4)||buffer.readUInt16LE(e+6)||buffer.readUInt16LE(e+20))badBundle('archive_footer');
    const expected=new Set(['package.json','package-lock.json',...policy.snapshot.fixturePaths].map(p=>'reviewed-release-inputs/'+p)),count=buffer.readUInt16LE(e+10),central=buffer.readUInt32LE(e+16);
    if(count!==expected.size||buffer.readUInt16LE(e+8)!==count||central+buffer.readUInt32LE(e+12)!==e)badBundle('archive_entry_set',{entryCount:count,expectedEntries:expected.size});
    let p=central,nextLocal=0;const files=new Map();
    for(let i=0;i<count;i++){
      if(p+46>e||buffer.readUInt32LE(p)!==0x02014b50)badBundle('archive_directory',{entryIndex:i});
      const flags=buffer.readUInt16LE(p+8),method=buffer.readUInt16LE(p+10),crc=buffer.readUInt32LE(p+16),size=buffer.readUInt32LE(p+24),nameLength=buffer.readUInt16LE(p+28),local=buffer.readUInt32LE(p+42);
      if(flags!==0x800||method!==0||size>MAX_ENTRY||buffer.readUInt32LE(p+20)!==size||buffer.readUInt16LE(p+30)||buffer.readUInt16LE(p+32)||(buffer.readUInt32LE(p+38)>>>16)!==0o100644||local!==nextLocal||p+46+nameLength>e)badBundle('archive_entry_metadata',{entryIndex:i,method,bytes:size,flags});
      const nameBytes=buffer.subarray(p+46,p+46+nameLength),name=new TextDecoder('utf-8',{fatal:true}).decode(nameBytes);
      if(!expected.has(name))badBundle('unexpected_entry',{entryIndex:i});if(files.has(name))badBundle('duplicate_entry',{entryIndex:i});
      if(local+30+nameLength+size>central||buffer.readUInt32LE(local)!==0x04034b50||buffer.readUInt16LE(local+6)!==flags||buffer.readUInt16LE(local+8)!==method||buffer.readUInt32LE(local+14)!==crc||buffer.readUInt32LE(local+18)!==size||buffer.readUInt32LE(local+22)!==size||buffer.readUInt16LE(local+26)!==nameLength||buffer.readUInt16LE(local+28)||!buffer.subarray(local+30,local+30+nameLength).equals(nameBytes))badBundle('local_header_mismatch',{entryIndex:i});
      const start=local+30+nameLength,data=buffer.subarray(start,start+size);if(crc32(data)!==crc)badBundle('crc_mismatch',{entryIndex:i});files.set(name,data);nextLocal=start+size;p+=46+nameLength;
    }
    if(p!==e||nextLocal!==central||files.size!==expected.size)badBundle('archive_completion');
    const packageBytes=files.get('reviewed-release-inputs/package.json'),lockBytes=files.get('reviewed-release-inputs/package-lock.json');
    if(!packageBytes.equals(policy.packageBytes)||!lockBytes.equals(policy.lockBytes))fail('dependency_snapshot_hash_mismatch',{stage:'input_bundle_metadata',cause:'package_or_lock_mismatch',expectedPackageSha256:digest(policy.packageBytes),actualPackageSha256:digest(packageBytes),expectedLockSha256:digest(policy.lockBytes),actualLockSha256:digest(lockBytes)});
    for(const name of policy.snapshot.fixturePaths){if(policy.snapshot.generatedFixturePaths.includes(name))continue;const bytes=files.get('reviewed-release-inputs/'+name),gitHash=createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');if(gitHash!==policy.immutable.get(name))badBundle('immutable_fixture_changed',{fixturePath:name})}
    return files;
  }catch(error){if(CODES.has(error?.message))throw error;badBundle('archive_structure_unavailable')}
}
export async function prepareReviewedInputBundle({sourceRoot,commit,tempRoot}){
  const policy=await trustedInputs(sourceRoot,commit),output=path.join(tempRoot,'cosmic-reviewed-inputs.zip');
  try{await lstat(output);fail('dependency_input_bundle_exists')}catch(error){if(error?.code!=='ENOENT')throw error}
  let total=0;for(const file of ['package.json','package-lock.json',...policy.snapshot.fixturePaths]){const target=await regularDestination(sourceRoot,file),stat=await lstat(target);if(stat.size>MAX_ENTRY)fail('dependency_input_bundle_invalid');total+=stat.size}if(total>MAX_BUNDLE-65536)fail('dependency_input_bundle_invalid');
  const stage=await mkdtemp(path.join(tempRoot,'cosmic-input-stage-')),intermediate=path.join(stage,'inputs.zip');
  await createStoredZip({sourceRoot,rootName:'reviewed-release-inputs',files:['package.json','package-lock.json',...policy.snapshot.fixturePaths],outPath:intermediate});
  const bytes=await regularBytes(intermediate,MAX_BUNDLE);bundleEntries(bytes,policy);await writeFile(output,bytes,{flag:'wx'});return {sha256:digest(bytes),fixtureCount:policy.snapshot.fixturePaths.length};
}
export async function restoreReviewedInputBundle({sourceRoot,commit,zipPath,expectedSha256}){
  if(typeof expectedSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedSha256))fail('dependency_input_bundle_invalid');
  const directory=path.dirname(zipPath),stat=await lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())fail('dependency_input_bundle_invalid');
  const children=await readdir(directory);if(children.length!==1||children[0]!==path.basename(zipPath))badBundle('unexpected_download_entry',{entryCount:children.length});
  const policy=await trustedInputs(sourceRoot,commit),buffer=await regularBytes(zipPath,MAX_BUNDLE);if(digest(buffer)!==expectedSha256)fail('dependency_input_bundle_hash_mismatch',{stage:'input_bundle_identity',cause:'sha256_mismatch',expectedSha256,actualSha256:digest(buffer)});
  const files=bundleEntries(buffer,policy),targets=[];for(const fixture of policy.snapshot.fixturePaths)targets.push([await regularDestination(sourceRoot,fixture),files.get('reviewed-release-inputs/'+fixture)]);
  let copied=0;try{for(const [file,bytes] of targets){await writeFile(file,bytes);copied++}}catch(error){fail('dependency_input_bundle_copy_failed',{stage:'fixture_restore',cause:['EACCES','EPERM','ENOSPC','EIO','ENOENT'].includes(error?.code)?error.code:'unknown',copiedFixtures:copied,metadataCopied:false,automaticRetry:false})}
  return {fixtureCount:targets.length,metadataCopied:false,sha256:expectedSha256};
}
const invokedEntry=process.argv[1]?await realpath(process.argv[1]).catch(()=>null):null;
const moduleEntry=await realpath(fileURLToPath(import.meta.url));
if(invokedEntry&&invokedEntry===moduleEntry){
  const started=performance.now();let operation='verify-dependency-graph';
  try{
    const args=process.argv.slice(2),ci=args[0]==='--ci';
    const prepare=ci&&args.length===2&&args[1]==='--prepare-input-bundle',restore=ci&&args.length===2&&args[1]==='--restore-input-bundle';
    operation=prepare?'prepare-reviewed-input-bundle':restore?'restore-reviewed-input-bundle':'verify-dependency-graph';
    if(args.length!==0&&!(ci&&(args.length===1||prepare||restore||(args.length===3&&args[1]==='--target-root'))))fail('dependency_snapshot_invalid');
    const scriptRoot=await realpath(path.resolve(import.meta.dirname,'..'));
    let sourceRoot=scriptRoot,targetRoot=scriptRoot;
    if(ci){
      if(!process.env.GITHUB_WORKSPACE||!path.isAbsolute(process.env.GITHUB_WORKSPACE))fail('dependency_snapshot_source_unavailable');
      sourceRoot=await realpath(process.env.GITHUB_WORKSPACE);
      const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
      if(!same(sourceRoot,scriptRoot))fail('dependency_snapshot_source_mismatch');
      if(args.length===3){
        if(!path.isAbsolute(args[2]))fail('dependency_snapshot_invalid');
        targetRoot=await realpath(args[2]);
        const relative=path.relative(sourceRoot,targetRoot);
        if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail('dependency_snapshot_target_rejected');
      }
    }
    const [packageBytes,lockBytes,snapshotBytes]=await Promise.all(['package.json','package-lock.json','DEPENDENCY_GRAPH.json'].map(async name=>{const file=path.join(targetRoot,name),stat=await lstat(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>2*1024*1024)fail('dependency_snapshot_invalid');return readFile(file)}));
    if(ci)verifyCommittedSnapshot({sourceRoot,commit:process.env.GITHUB_SHA,snapshotBytes});
    const result=verifyDependencySnapshot({packageBytes,lockBytes,snapshot:JSON.parse(snapshotBytes.toString('utf8'))});
    let bundle;
    if(prepare||restore){
      if(!process.env.RUNNER_TEMP||!path.isAbsolute(process.env.RUNNER_TEMP))fail('dependency_input_bundle_invalid');const tempRoot=await realpath(process.env.RUNNER_TEMP);
      if(prepare){
        if(!process.env.GITHUB_OUTPUT||!path.isAbsolute(process.env.GITHUB_OUTPUT))badBundle('job_output_missing');
        const output=await realpath(process.env.GITHUB_OUTPUT),relative=path.relative(tempRoot,output),stat=await lstat(process.env.GITHUB_OUTPUT);
        if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||stat.isSymbolicLink()||!stat.isFile())badBundle('job_output_outside_temp');
        bundle=await prepareReviewedInputBundle({sourceRoot,commit:process.env.GITHUB_SHA,tempRoot});await appendFile(output,`reviewed_inputs_sha256=${bundle.sha256}\n`)
      }
      else bundle=await restoreReviewedInputBundle({sourceRoot,commit:process.env.GITHUB_SHA,zipPath:path.join(tempRoot,'cosmic-reviewed-inputs-download','cosmic-reviewed-inputs.zip'),expectedSha256:process.env.REVIEWED_INPUTS_SHA256});
    }
    console.log(JSON.stringify({...result,...(bundle?{bundle}:{}),operation,atUtc:new Date().toISOString(),elapsedMs:Math.round(performance.now()-started)}));
  }catch(error){console.error(JSON.stringify({schema:'cosmic-dependency-snapshot-check-1',status:'FAIL',operation,atUtc:new Date().toISOString(),elapsedMs:Math.round(performance.now()-started),code:CODES.has(error?.message)?error.message:'dependency_snapshot_invalid',...(error?.safeDetails||{}),rawPayloadRetained:false}));process.exitCode=1}
}
