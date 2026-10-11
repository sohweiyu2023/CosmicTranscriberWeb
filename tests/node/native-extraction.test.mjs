import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {createStoredZip} from '../../scripts/zip-utils.mjs';

test('Windows native ZIP extraction preserves Unicode bytes and original DOS timestamp', {skip:process.platform!=='win32'}, async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'cosmic-native-extraction-test-'));
  try{
    const source=path.join(temp,'source');await mkdir(source);
    const file='ID3 Unicode 東京.mp3',bytes=Buffer.from([0x49,0x44,0x33,0,1,2,255]);
    await writeFile(path.join(source,file),bytes);
    const zip=path.join(temp,'fixture.zip');
    await createStoredZip({sourceRoot:source,rootName:'CosmicFixture',files:[file],outPath:zip});
    const destination=path.join(temp,'native');
    const script=path.resolve('scripts/extract-source-package.ps1');
    const args=['-NoProfile','-NonInteractive','-File',script,'-ZipPath',zip,'-Destination',destination];
    const result=spawnSync('pwsh',args,{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr||result.stdout||result.error?.message);
    const extracted=path.join(destination,'CosmicFixture',file);
    assert.deepEqual(await readFile(extracted),bytes);
    // The extractor itself compares .NET's exact archive timestamp interpretation.
    // This bound independently catches replacement with the current time without
    // conflating historical Node/.NET local timezone offsets.
    assert.ok((await stat(extracted)).mtimeMs<Date.UTC(1981,0,1));
    const repeated=spawnSync('pwsh',args,{encoding:'utf8'});
    assert.notEqual(repeated.status,0,'A populated extraction destination must be rejected.');
    assert.deepEqual(await readFile(extracted),bytes);
  }finally{
    if(!path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'cosmic-native-extraction-test-'))throw new Error('Unexpected test cleanup path.');
    await rm(temp,{recursive:true,force:true});
  }
});
