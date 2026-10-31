// Read-only status helper. It cannot start login, grant access, deploy or retry.
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createToolDiagnostics} from './tooling-diagnostics.mjs';
import {runObservedCommand} from './observed-subprocess.mjs';
export function statusEnvironment(profile,account,source=process.env){
 const env={...source};
 for(const key of Object.keys(env))if(/^(CLOUDFLARE_|CF_|WRANGLER_|OPENAI_|STAGING_|NODE_OPTIONS$|XDG_CONFIG_HOME$|CI$|GH_TOKEN$|GITHUB_TOKEN$|ACTIONS_RUNTIME_TOKEN$)/i.test(key))delete env[key];
 return {...env,CI:'true',XDG_CONFIG_HOME:profile,CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG_SANITIZE:'true'};
}
export async function observeWranglerStatus({cliFile,profile,expectedAccount,logDirectory,spawnImpl}){
 const valid=typeof cliFile==='string'&&typeof profile==='string'&&typeof expectedAccount==='string'&&path.isAbsolute(cliFile)&&path.isAbsolute(profile)&&/^[a-f0-9]{32}$/.test(expectedAccount)&&process.versions.node==='26.7.0';
 const log=createToolDiagnostics({component:'wrangler-auth',directory:valid?logDirectory:null});
 const blocked=async errorCategory=>{log.record({operation:'wrangler-whoami',phase:'preflight',result:'blocked',errorCategory});return {schema:'cosmic-wrangler-observed-status-1',status:'blocked',exitCode:null,errorCategory,expectedAccountMatched:false,automaticRetry:false,requiresReconciliation:false,diagnostics:await log.flush(),support:await log.exportSupport(),credentialsInspected:false,newLoginFlow:false,providerRequests:0,deployment:false}};
 if(!valid)return blocked('invocation_scope_rejected');
 let pkg;
 try{const packageFile=path.resolve(path.dirname(cliFile),'..','package.json');if((await stat(packageFile)).size>65536)return blocked('malformed_response');pkg=JSON.parse(await readFile(packageFile,'utf8'))}catch(error){return blocked(error?.code==='ENOENT'?'dependency_missing':error?.name==='SyntaxError'?'malformed_response':'process_failure')}
 if(pkg.name!=='wrangler'||typeof pkg.version!=='string'||!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(pkg.version)||path.basename(cliFile)!=='wrangler.js'||path.basename(path.dirname(cliFile))!=='bin')return blocked('invocation_scope_rejected');
 const result=await runObservedCommand({commandId:'wrangler-whoami',file:process.execPath,args:[cliFile,'whoami'],env:statusEnvironment(profile,expectedAccount),expectedAccountId:expectedAccount,timeoutMs:45000,diagnostics:log,spawnImpl});
 return {schema:'cosmic-wrangler-observed-status-1',toolVersion:pkg.version,...result,support:await log.exportSupport(),credentialsInspected:false,newLoginFlow:false,providerRequests:0,deployment:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const log=createToolDiagnostics({component:'wrangler-auth'});
 try{
  const a=process.argv.slice(2);if(a.length!==7||a[0]!=='--read-only-status'||a[1]!=='--cli-file'||a[3]!=='--profile'||a[5]!=='--expected-account')throw Error();
  const result=await observeWranglerStatus({cliFile:a[2],profile:a[4],expectedAccount:a[6],logDirectory:path.join(a[4],'tool-logs')});
  console.log(JSON.stringify(result));if(result.status!=='success'||result.expectedAccountMatched!==true)process.exitCode=1;
 }catch{log.record({operation:'wrangler-whoami',phase:'preflight',result:'blocked',errorCategory:'invocation_scope_rejected'});console.error(JSON.stringify(await log.exportSupport()));process.exitCode=1}
}
