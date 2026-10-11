import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyReleaseProvenance} from './deploy-provenance.mjs';

const REQUIRED_RATE_LIMITS=['RL_KEY_SESSION','RL_KEY_TEST','RL_TRANSCRIBE','RL_ADMIN'];

function validAccessTeamDomain(value){
  try{
    const u=new URL(value);
    return u.protocol==='https:'&&u.hostname.endsWith('.cloudflareaccess.com')&&u.hostname!=='.cloudflareaccess.com'&&!u.username&&!u.password&&!u.port&&(u.pathname==='/'||u.pathname==='')&&!u.search&&!u.hash;
  }catch{return false}
}


function validAdminEmails(value){
  if(typeof value!=='string')return false;
  const list=value.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  return list.length>=1&&list.length<=32&&new Set(list).size===list.length&&list.every(x=>x.length>=3&&x.length<=320&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
}

function validD1Id(value){return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)}
export function validateDeploymentConfig(config,envName,{packageVersion=null}={}){
  const errs=[];
  if(!['staging','production'].includes(envName)) return ['environment must be staging or production'];
  const e=config?.env?.[envName];
  if(!e)return ['environment missing'];

  if(config?.workers_dev!==false)errs.push('top-level workers_dev must be false');
  if(config?.preview_urls!==false)errs.push('top-level preview_urls must be false');
  if(config?.assets?.run_worker_first!==true)errs.push('static assets must run Worker first so Access is enforced before app assets');
  if(config?.assets?.binding!=='ASSETS')errs.push('static asset binding must be ASSETS');
  if(config?.assets?.directory!=='./dist/public')errs.push('static asset directory must be ./dist/public');
  if(config?.observability?.enabled!==true)errs.push('observability must remain enabled for redacted operational logs');
  if(config?.observability?.logs?.enabled!==true)errs.push('custom Workers Logs must remain enabled');
  if(config?.observability?.logs?.invocation_logs!==false)errs.push('automatic invocation logs must be disabled to minimize request metadata retention');
  const logSample=config?.observability?.logs?.head_sampling_rate;if(typeof logSample!=='number'||logSample<=0||logSample>0.1)errs.push('top-level custom log sampling must be greater than 0 and no more than 0.1');
  const envObs=e?.observability;
  if(envObs?.enabled!==true)errs.push(`${envName} observability must remain enabled`);
  if(envObs?.logs?.enabled!==true)errs.push(`${envName} custom Workers Logs must remain enabled`);
  if(envObs?.logs?.invocation_logs!==false)errs.push(`${envName} automatic invocation logs must remain disabled to minimize request metadata retention`);
  const envLogSample=envObs?.logs?.head_sampling_rate;
  const expectedLogSample=envName==='staging'?1:0.1;
  if(envLogSample!==expectedLogSample)errs.push(`${envName} custom log sampling must be ${expectedLogSample}`);
  if(envObs?.traces?.enabled!==true)errs.push(`${envName} automatic tracing must remain enabled`);
  const traceSample=envObs?.traces?.head_sampling_rate;
  const expectedTraceSample=envName==='staging'?1:0.05;
  if(traceSample!==expectedTraceSample)errs.push(`${envName} trace sampling must be ${expectedTraceSample}`);

  const txt=JSON.stringify(e);
  if(/example\.com|YOUR_TEAM|REPLACE_WITH/i.test(txt))errs.push('placeholder deployment configuration remains');
  if(e.workers_dev!==false)errs.push('workers_dev must be false');
  if(e.preview_urls!==false)errs.push('preview_urls must be false');
  if(e.vars?.LOCAL_AUTH_BYPASS!=='false')errs.push('LOCAL_AUTH_BYPASS must be false');
  if(e.vars?.DEPLOYMENT_ENV!==envName)errs.push('DEPLOYMENT_ENV mismatch');
  if(packageVersion&&e.vars?.APP_VERSION!==packageVersion)errs.push(`APP_VERSION must match package version ${packageVersion}`);
  if(!/^https:\/\//.test(e.vars?.APP_ORIGIN||''))errs.push('APP_ORIGIN must be https');
  if(!validAccessTeamDomain(e.vars?.ACCESS_TEAM_DOMAIN||''))errs.push('ACCESS_TEAM_DOMAIN must be a canonical https://<team>.cloudflareaccess.com origin');
  if(typeof e.vars?.ACCESS_AUDIENCE!=='string'||e.vars.ACCESS_AUDIENCE.length<8||e.vars.ACCESS_AUDIENCE.length>64)errs.push('ACCESS_AUDIENCE is missing or malformed');
  if(!validAdminEmails(e.vars?.ADMIN_EMAILS))errs.push('ADMIN_EMAILS must contain 1-32 canonical administrator email addresses');
  if(e.vars?.REGISTRY_SCHEMA_REVISION!=='2')errs.push('REGISTRY_SCHEMA_REVISION must be 2');

  const d1=Array.isArray(e.d1_databases)?e.d1_databases:[];
  const userDbs=d1.filter(x=>x?.binding==='USER_DB');
  if(userDbs.length!==1)errs.push('exactly one USER_DB D1 binding is required');
  const userDb=userDbs[0];
  if(userDb&&userDb.database_name!==`cosmic-transcriber-web-${envName}-users`)errs.push('USER_DB database_name does not match the environment');
  if(userDb&&!validD1Id(userDb.database_id))errs.push('USER_DB database_id is missing or malformed');
  if(userDb?.migrations_dir!=='migrations')errs.push('USER_DB migrations_dir must be migrations');
  const otherEnv=envName==='staging'?'production':'staging';
  const otherDb=(config?.env?.[otherEnv]?.d1_databases||[]).find(x=>x?.binding==='USER_DB');
  if(userDb&&validD1Id(otherDb?.database_id)&&userDb.database_id===otherDb.database_id)errs.push('staging and production USER_DB databases must be distinct');

  const routes=Array.isArray(e.routes)?e.routes:[];
  if(routes.length!==1)errs.push('exactly one custom-domain route is required');
  const route=routes[0];
  if(route?.custom_domain!==true)errs.push('route must be a Cloudflare Custom Domain');
  if(route?.pattern&&`https://${route.pattern}`!==e.vars?.APP_ORIGIN)errs.push('route and APP_ORIGIN mismatch');

  if(!e.secrets?.required?.includes('BYOK_SESSION_MASTER_KEY_CURRENT'))errs.push('required BYOK secret missing');
  if(!config?.secrets?.required?.includes('BYOK_SESSION_MASTER_KEY_CURRENT'))errs.push('top-level required BYOK secret missing');

  const limits=Array.isArray(e.ratelimits)?e.ratelimits:[];
  const names=limits.map(x=>x?.name);
  if(limits.length!==REQUIRED_RATE_LIMITS.length||REQUIRED_RATE_LIMITS.some(n=>!names.includes(n)))errs.push('required rate-limit bindings are incomplete');
  const ns=limits.map(x=>String(x?.namespace_id??''));
  if(ns.some(x=>!/^[1-9]\d*$/.test(x))||new Set(ns).size!==ns.length)errs.push('rate-limit namespace IDs invalid/not unique within environment');
  for(const item of limits){if(!Number.isSafeInteger(item?.simple?.limit)||item.simple.limit<=0||item?.simple?.period!==60)errs.push(`rate-limit binding ${item?.name||'(unnamed)'} must use a positive integer limit and 60-second period`)}

  const deployedNamespaceIds=[];
  for(const name of ['staging','production']) for(const item of config?.env?.[name]?.ratelimits||[]) deployedNamespaceIds.push(String(item?.namespace_id??''));
  if(deployedNamespaceIds.length!==new Set(deployedNamespaceIds).size)errs.push('staging and production rate-limit namespace IDs must be distinct from each other');

  return [...new Set(errs)];
}

async function main(){
  const envName=process.argv[2];
  if(!['staging','production'].includes(envName)){console.error('Usage: node scripts/deploy-verify.mjs staging|production');process.exit(2)}
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const config=JSON.parse(await readFile(path.join(root,'wrangler.jsonc'),'utf8'));
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const provenanceErrors=await verifyReleaseProvenance(root,{packageVersion:pkg.version,targetEnv:envName});
  const errs=[...provenanceErrors,...validateDeploymentConfig(config,envName,{packageVersion:pkg.version})];
  if(errs.length){console.error(`DEPLOY BLOCKED (${envName}):\n- ${errs.join('\n- ')}`);process.exit(1)}
  console.log(`Deployment configuration verified for ${envName}.`);
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href)await main();
