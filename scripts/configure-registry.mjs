import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { verifyReleaseProvenance } from './deploy-provenance.mjs';

const root = path.resolve(import.meta.dirname, '..');

export function normalizeAdminEmails(raw) {
  const list=String(raw??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(list.length<1||list.length>32||new Set(list).size!==list.length||list.some(x=>x.length<3||x.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))) {
    throw new Error('Enter 1-32 unique administrator email addresses separated by commas.');
  }
  return list.join(',');
}

export function parseD1ListOutput(text) {
  const raw=String(text??'').trim();
  if(!raw) throw new Error('wrangler d1 list returned no output.');
  try { const parsed=JSON.parse(raw); if(Array.isArray(parsed))return parsed; } catch {}
  const lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    const candidate=lines.slice(i).join('\n');
    try { const parsed=JSON.parse(candidate); if(Array.isArray(parsed))return parsed; } catch {}
  }
  throw new Error('wrangler d1 list did not return a JSON array.');
}

export function applyRegistryValues(config, target, databaseId, adminEmails) {
  if(!['staging','production'].includes(target))throw new Error('Environment must be staging or production.');
  if(typeof databaseId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId))throw new Error('D1 database ID is malformed.');
  const envConfig=config?.env?.[target];
  if(!envConfig?.vars||!Array.isArray(envConfig?.d1_databases))throw new Error(`wrangler.jsonc is missing ${target} registry configuration.`);
  const binding=envConfig.d1_databases.find(x=>x?.binding==='USER_DB');
  if(!binding||binding.database_name!==`cosmic-transcriber-web-${target}-users`)throw new Error(`USER_DB configuration is invalid for ${target}.`);
  binding.database_id=databaseId;
  envConfig.vars.ADMIN_EMAILS=normalizeAdminEmails(adminEmails);
  return config;
}

function runWrangler(args,{capture=false}={}) {
  const result=spawnSync(process.execPath,['scripts/wrangler-invoke.mjs',...args],{
    cwd:root,encoding:capture?'utf8':undefined,stdio:capture?['ignore','pipe','pipe']:'inherit',env:process.env,shell:false
  });
  if(result.status!==0){if(capture){process.stdout.write(String(result.stdout||''));process.stderr.write(String(result.stderr||''));}throw new Error(`Wrangler command failed: ${args.join(' ')}`)}
  return capture?String(result.stdout||''):'';
}

async function main() {
  const target=process.argv[2];
  if(!['staging','production'].includes(target)){console.error('Usage: node scripts/configure-registry.mjs <staging|production>');process.exit(2)}
  const configPath=path.join(root,'wrangler.jsonc');
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const beforeErrors=await verifyReleaseProvenance(root,{packageVersion:pkg.version,targetEnv:target});
  if(beforeErrors.length)throw new Error(`REGISTRY CONFIG BLOCKED (${target}):\n- ${beforeErrors.join('\n- ')}`);

  const original=await readFile(configPath,'utf8');
  const config=JSON.parse(original);
  const binding=config?.env?.[target]?.d1_databases?.find(x=>x?.binding==='USER_DB');
  if(!binding?.database_name)throw new Error(`USER_DB configuration is missing for ${target}.`);
  const databaseName=binding.database_name;

  // Validate local/operator input before performing remote D1 side effects.
  const rl=createInterface({input,output});
  let adminEmails;
  try{adminEmails=normalizeAdminEmails(await rl.question(`Enter ${target} Cosmic administrator email(s), comma-separated. Use the exact email identity used through Cloudflare Access: `));}
  finally{rl.close()}

  let list=parseD1ListOutput(runWrangler(['d1','list','--json'],{capture:true}));
  let database=list.find(x=>x?.name===databaseName);
  if(!database){
    console.log(`Creating private D1 registry database ${databaseName}...`);
    runWrangler(['d1','create',databaseName,'--update-config=false','--experimental-auto-create=false','--experimental-provision=false']);
    list=parseD1ListOutput(runWrangler(['d1','list','--json'],{capture:true}));
    database=list.find(x=>x?.name===databaseName);
  }
  const databaseId=database?.uuid||database?.id;
  if(typeof databaseId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId))throw new Error(`Could not resolve the D1 UUID for ${databaseName}.`);

  applyRegistryValues(config,target,databaseId,adminEmails);
  await writeFile(configPath,JSON.stringify(config,null,2)+'\n','utf8');
  try{
    const afterErrors=await verifyReleaseProvenance(root,{packageVersion:pkg.version,targetEnv:target});
    if(afterErrors.length)throw new Error(`Release provenance failed after registry edit:\n- ${afterErrors.join('\n- ')}`);
  }catch(error){await writeFile(configPath,original,'utf8');throw error}

  console.log(`${target} registry D1 binding and administrator email(s) were saved. Release provenance remains valid.`);
  console.log(`D1 database: ${databaseName} (${databaseId})`);
  console.log(`Next: node scripts/deploy-verify.mjs ${target}`);
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){main().catch(error=>{console.error(error?.message||error);process.exit(1)})}
