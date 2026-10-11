import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {verifyVersionConsistency} from '../../scripts/version-consistency.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const required=[
  'package.json','RELEASE_MANIFEST.json','wrangler.jsonc','public/js/models.js','public/index.html','README.md',
  'tests/worker/wrangler.test.jsonc','tests/integration/wrangler.test.jsonc','tests/worker/runtime.test.js','tests/e2e/mock-server.mjs','PASTE-ONCE-WINDOWS.ps1','.nvmrc','WINDOWS-TOOLCHAIN.ps1'
];

async function fixture(){
  const dir=await mkdtemp(path.join(os.tmpdir(),'ctw-version-'));
  for(const rel of required){
    const dst=path.join(dir,rel);await mkdir(path.dirname(dst),{recursive:true});
    await writeFile(dst,await readFile(path.join(root,rel)));
  }
  return dir;
}

test('current release and runtime-test version surfaces are coherent',async()=>{
  assert.equal(await verifyVersionConsistency(root),'1.2.0');
});

for(const [label,eol] of [['LF','\n'],['CRLF','\r\n']]){
  test(`README version validation supports ${label} without accepting a stale or extended heading`,async()=>{
    const dir=await fixture();
    try{
      const file=path.join(dir,'README.md');
      const valid=(await readFile(file,'utf8')).replace(/\r?\n/g,eol);
      await writeFile(file,valid);
      assert.equal(await verifyVersionConsistency(dir),'1.2.0');
      await writeFile(file,valid.replace('# Cosmic Transcriber Web 1.2.0','# Cosmic Transcriber Web 1.1.1'));
      await assert.rejects(verifyVersionConsistency(dir),/README.md heading/);
      await writeFile(file,valid.replace('# Cosmic Transcriber Web 1.2.0','# Cosmic Transcriber Web 1.2.0-uncertified'));
      await assert.rejects(verifyVersionConsistency(dir),/README.md heading/);
    }finally{await rm(dir,{recursive:true,force:true})}
  });
}

test('version consistency rejects stale Worker/integration runtime metadata',async()=>{
  const dir=await fixture();
  try{
    const rel='tests/worker/wrangler.test.jsonc';const p=path.join(dir,rel);
    await writeFile(p,(await readFile(p,'utf8')).replace('1.2.0','0.0.0'));
    await assert.rejects(verifyVersionConsistency(dir),/Worker Vitest Wrangler APP_VERSION/);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('version consistency rejects stale E2E and paste-once launcher versions',async()=>{
  const dir=await fixture();
  try{
    let p=path.join(dir,'tests/e2e/mock-server.mjs');
    await writeFile(p,(await readFile(p,'utf8')).replace("version:'1.2.0'","version:'0.0.0'"));
    await assert.rejects(verifyVersionConsistency(dir),/e2e\/mock-server|E2E/i);
  }finally{await rm(dir,{recursive:true,force:true})}
  const dir2=await fixture();
  try{
    const p=path.join(dir2,'PASTE-ONCE-WINDOWS.ps1');
    await writeFile(p,(await readFile(p,'utf8')).replace("$Version = '1.2.0'","$Version = '0.0.0'"));
    await assert.rejects(verifyVersionConsistency(dir2),/PASTE-ONCE-WINDOWS/);
  }finally{await rm(dir2,{recursive:true,force:true})}
});


test('version consistency rejects Node/npm toolchain drift',async()=>{
  const dir=await fixture();
  try{
    await writeFile(path.join(dir,'.nvmrc'),'25.6.1\n');
    await assert.rejects(verifyVersionConsistency(dir),/\.nvmrc/);
  }finally{await rm(dir,{recursive:true,force:true})}
  const dir2=await fixture();
  try{
    const p=path.join(dir2,'WINDOWS-TOOLCHAIN.ps1');
    await writeFile(p,(await readFile(p,'utf8')).replace("CosmicNodeVersion = '26.7.0'","CosmicNodeVersion = '25.6.1'"));
    await assert.rejects(verifyVersionConsistency(dir2),/WINDOWS-TOOLCHAIN.*Node version/);
  }finally{await rm(dir2,{recursive:true,force:true})}
});
