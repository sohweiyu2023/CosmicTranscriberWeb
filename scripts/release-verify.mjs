import {invokeNpm} from './npm-invoke.mjs';

const requireWindows=process.argv.includes('--release-package');
const nodeParts=process.versions.node.split('.').map(Number);
const minimumNode=[26,7,0];
const nodeCurrentEnough=nodeParts[0]===26 && (nodeParts[1]>minimumNode[1] || (nodeParts[1]===minimumNode[1] && nodeParts[2]>=minimumNode[2]));
if(!nodeCurrentEnough){
  console.error(`Release verification requires Node >=26.7.0 <27 (current reviewed Current-major floor); current runtime is ${process.version}.`);
  process.exit(1);
}
const npmVersionResult=invokeNpm(['--version'],{stdio:'pipe'});
const npmVersionText=npmVersionResult.status===0?String(npmVersionResult.stdout||'').trim():'';
const npmMatch=/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(npmVersionText);
const npmCurrentEnough=!!npmMatch && Number(npmMatch[1])===12 && (Number(npmMatch[2])>0 || Number(npmMatch[3])>=2);
if(!npmCurrentEnough){
  console.error(`Release verification requires npm >=12.0.2 <13 (current reviewed stable major); current npm is ${npmVersionText||'unavailable'}.`);
  process.exit(1);
}
if(requireWindows && process.platform!=='win32'){
  console.error('Release-mode source packaging requires Windows so the branded Chrome and Edge release gates actually run. Use npm run package:source:candidate on other operating systems.');
  process.exit(1);
}

const steps=[
  ['run','validate:version'],
  ['run','deps:lock:verify'],
  ['ls','--all'],
  ['run','deps:check'],
  ['run','deps:install-scripts:verify'],
  ['run','validate:powershell'],
  ['audit'],
  ['run','validate'],
  ['run','test:worker'],
  ['run','test:integration'],
  ['run','test:e2e:core']
];
if(process.platform==='win32')steps.push(['run','test:e2e:firefox-key-stress']);
if(process.platform==='win32')steps.push(['run','test:e2e:branded']);
else console.log('Branded Chrome/Edge gate is Windows-only and was not executed on this platform.');
steps.push(['run','build:inspect']);
steps.push(['run','audit:secrets']);

for(const args of steps){
  console.log(`\n> npm ${args.join(' ')}`);
  const result=invokeNpm(args,{stdio:'inherit'});
  if(result.status!==0){
    console.error(`Release verification FAILED at: npm ${args.join(' ')}`);
    process.exit(result.status||1);
  }
}
console.log(`Release verification PASS${process.platform==='win32'?' including branded Chrome/Edge':''}.`);
