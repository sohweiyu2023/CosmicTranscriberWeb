import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
let lock;
try{lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'))}catch{console.error('package-lock.json is required to verify dependency install-script policy.');process.exit(1)}
const policy=pkg.allowScripts||{};
const pending=new Set();
for(const [loc,entry] of Object.entries(lock.packages||{})){
  if(!entry?.hasInstallScript||!entry.version||!loc.includes('node_modules/'))continue;
  const tail=loc.slice(loc.lastIndexOf('node_modules/')+'node_modules/'.length);
  const parts=tail.split('/');
  const name=parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0];
  const exact=`${name}@${entry.version}`;
  if(policy[exact]===true||policy[name]===false)continue;
  pending.add(exact);
}
if(pending.size){const list=[...pending].sort();console.error(`Unreviewed dependency install scripts in lockfile:\n- ${list.join('\n- ')}`);console.error('This verifier is deliberately lock-wide (including optional packages for other supported OSes). Review the package, then record an explicit allowScripts allow/deny policy before release.');process.exit(1)}
console.log('Dependency install-script policy PASS: every lockfile install script is explicitly reviewed.');
