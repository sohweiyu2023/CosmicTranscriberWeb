import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';

async function verify(dependencies){
  const root=await mkdtemp(path.join(tmpdir(),'ctw-lock-test-'));
  try{
    await mkdir(path.join(root,'scripts'));
    await copyFile(new URL('../../scripts/deps-lock-verify.mjs',import.meta.url),path.join(root,'scripts/deps-lock-verify.mjs'));
    const pkg={name:'lock-test',version:'1.2.0',dependencies:{alpha:'^1.0.0',beta:'^2.0.0'},devDependencies:{}};
    const lock={lockfileVersion:4,packages:{'':{...pkg,dependencies}}};
    await writeFile(path.join(root,'package.json'),JSON.stringify(pkg));
    await writeFile(path.join(root,'package-lock.json'),JSON.stringify(lock));
    return spawnSync(process.execPath,['scripts/deps-lock-verify.mjs'],{cwd:root,encoding:'utf8'});
  }finally{await rm(root,{recursive:true,force:true})}
}

test('dependency lock verification accepts identical declarations reordered by npm',async()=>{
  const result=await verify({beta:'^2.0.0',alpha:'^1.0.0'});
  assert.equal(result.status,0,result.stderr);
});

test('dependency lock verification rejects changed, missing or extra dependency declarations',async()=>{
  for(const deps of [{alpha:'^9.0.0',beta:'^2.0.0'},{alpha:'^1.0.0'},{alpha:'^1.0.0',beta:'^2.0.0',extra:'^1.0.0'}]){
    const result=await verify(deps);
    assert.equal(result.status,1);
    assert.match(result.stderr,/dependencies in package-lock.json does not exactly match package.json/);
  }
});
