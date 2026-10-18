import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStoredZip} from '../../scripts/zip-utils.mjs';

// The deterministic source ZIP declares Unix origin (version-made-by 0x0314).
// Its central-directory external attributes must therefore carry a readable
// regular-file mode; zero previously extracted as mode 000 on Linux unzip.
test('deterministic source ZIP entries declare regular 0644 permissions',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'cosmic-zip-mode-'));
  try{
    const input=Buffer.from('Cosmic ZIP mode regression\n');
    await writeFile(path.join(dir,'fixture.txt'),input);
    const zip=path.join(dir,'fixture.zip');
    await createStoredZip({sourceRoot:dir,rootName:'CosmicFixture',files:['fixture.txt'],outPath:zip});
    const archive=await readFile(zip);
    const central=archive.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
    assert.ok(central>=0,'Missing ZIP central directory');
    assert.equal(archive.readUInt16LE(central+4),0x0314,'ZIP creator must identify Unix');
    assert.equal(archive.readUInt32LE(central+38)>>>16,0o100644,'ZIP entry must declare a regular readable file');
    if(process.platform!=='win32'){
      const hasUnzip=spawnSync('unzip',['-v'],{encoding:'utf8'});
      if(!hasUnzip.error&&hasUnzip.status===0){
        const destination=path.join(dir,'extracted');
        const extracted=spawnSync('unzip',['-q',zip,'-d',destination],{encoding:'utf8'});
        assert.equal(extracted.status,0,extracted.stderr||'Native unzip failed');
        const output=path.join(destination,'CosmicFixture','fixture.txt');
        assert.deepEqual(await readFile(output),input);
        assert.equal((await stat(output)).mode&0o444,0o444,'Native extraction must remain readable by ordinary users');
      }
    }
  }finally{await rm(dir,{recursive:true,force:true})}
});
