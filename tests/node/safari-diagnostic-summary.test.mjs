import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {summarizeSafariDiagnostics} from '../../scripts/safari-diagnostic-summary.mjs';

test('Safari diagnostics export bounded counters, never raw log contents or paths',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'cosmic-safari-log-'));
  try{
    const sensitive='https://private.example/?token=SECRET_ABC /Users/someone/private.mp3';
    const log=path.join(dir,'driver.log');
    await writeFile(log,`sandbox denied file read NotReadableError ${sensitive}\n`);
    const result=await summarizeSafariDiagnostics({directory:dir,since:Date.now()-60000});
    assert.equal(result.available,true);
    assert.equal(result.filesFound,1);
    assert.equal(result.filesInspected,1);
    assert.equal(result.counts.notReadableError,1);
    assert.ok(result.counts.sandbox>0);
    assert.ok(result.counts.denied>0);
    assert.ok(result.counts.fileRead>0);
    const output=JSON.stringify(result);
    assert.ok(!output.includes('SECRET_ABC'));
    assert.ok(!output.includes('private.mp3'));
    assert.ok(!output.includes(dir));
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('Missing Safari diagnostic directory is nonfatal and does not pass certification',async()=>{
  const result=await summarizeSafariDiagnostics({directory:path.join(tmpdir(),'cosmic-does-not-exist-98765')});
  assert.equal(result.available,false);
  assert.equal(result.errorCode,'ENOENT');
});

// Keep privacy assertions above unconditional. Only the separate symlink
// exclusion coverage is unsupported when Windows denies symlink creation.
test('Safari diagnostics never follow file symlinks',async(t)=>{
  const tempRoot=path.resolve(tmpdir());
  const dir=await mkdtemp(path.join(tempRoot,'cosmic-safari-symlink-'));
  assert.ok(path.resolve(dir).startsWith(tempRoot+path.sep));
  try{
    const log=path.join(dir,'driver.log');
    await writeFile(log,'NotReadableError sandbox denied file read\n');
    try{
      await symlink(log,path.join(dir,'log-symlink'));
    }catch(error){
      if(process.platform==='win32'&&['EPERM','EACCES'].includes(error?.code)){
        t.skip(`Windows symlink privilege unavailable (${error.code}); symlink exclusion NOT RUN`);
        return;
      }
      throw error;
    }
    const result=await summarizeSafariDiagnostics({directory:dir,since:Date.now()-60000});
    assert.equal(result.available,true);
    assert.equal(result.filesFound,1);
    assert.equal(result.filesInspected,1);
    assert.equal(result.counts.notReadableError,1);
    assert.ok(!JSON.stringify(result).includes(dir));
  }finally{await rm(dir,{recursive:true,force:true})}
});
