import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root=path.resolve(import.meta.dirname,'..');
const target=process.argv[2];
if(!['staging','production'].includes(target)){
  console.error('Usage: node scripts/apply-registry-migrations.mjs <staging|production>');
  process.exit(2);
}
const result=spawnSync(process.execPath,['scripts/wrangler-invoke.mjs','d1','migrations','apply','USER_DB','--env',target,'--remote'],{cwd:root,stdio:'inherit',env:process.env,shell:false});
if(result.status!==0)process.exit(result.status??1);
console.log(`User-registry migrations applied for ${target}.`);
