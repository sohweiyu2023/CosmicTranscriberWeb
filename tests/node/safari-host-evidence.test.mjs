import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inspectDriverLogs,redactEvidence,summarizeUnifiedText} from '../../scripts/safari-host-evidence.mjs';

test('Nested session logs are inspected without exporting names, paths or secret contents',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'ctw-host-evidence-'));
  try{
    await mkdir(path.join(root,'SESSION_SECRET'));
    await writeFile(path.join(root,'SESSION_SECRET','PRIVATE_SECRET.log'),'Safari deny(1) file-read-data /Users/PRIVATE_SECRET/format.mp3 https://private.invalid/?token=SECRET_TOKEN\n');
    const r=await inspectDriverLogs({directory:root,since:Date.now()-60000});
    assert.equal(r.available,true);assert.equal(r.filesInspected,1);assert.equal(r.filesByDepth[1],1);assert.equal(r.events[0].operation,'file-read-data');
    assert.ok(!/SECRET|\/Users\/|https:|private\.invalid/.test(JSON.stringify(r)));
  }finally{await rm(root,{recursive:true,force:true})}
});
test('Driver log collection respects file and byte ceilings',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'ctw-host-limit-'));
  try{for(let i=0;i<4;i++)await writeFile(path.join(root,i+'.log'),'deny file-read-data\n'.repeat(20));
    const r=await inspectDriverLogs({directory:root,maxFiles:1,maxBytes:32});assert.equal(r.filesInspected,1);assert.ok(r.bytesInspected<=32);assert.equal(r.truncated,true);
  }finally{await rm(root,{recursive:true,force:true})}
});
test('Unified OS records retain only allowlisted process/operation and safe time',()=>{
  const r=summarizeUnifiedText(JSON.stringify({processImagePath:'/PRIVATE_SECRET/com.apple.WebKit.WebContent',timestamp:'2026-10-21T02:30:00Z',eventMessage:'deny(1) file-issue-extension /Users/PRIVATE_SECRET/ctw-safari-real-disk-SECRET/format.mp3 com.apple.app-sandbox.read token=SECRET_TOKEN'}));
  assert.equal(r.matchingEvents,1);assert.equal(r.events[0].process,'com.apple.WebKit.WebContent');assert.equal(r.events[0].mentionsTestFixture,true);assert.equal(r.events[0].mentionsReadExtension,true);
  assert.ok(!/SECRET|\/Users\/|token=/.test(JSON.stringify(r)));
});
test('Unknown records and arbitrary strings cannot become OS denial evidence',()=>{
  assert.equal(redactEvidence('normal success message'),null);
  const r=summarizeUnifiedText('not JSON deny SECRET\n'+JSON.stringify({processImagePath:'/SECRET/unknown',eventMessage:'deny file-read-data SECRET'}));
  assert.equal(r.unparsedLines,1);assert.equal(r.matchingEvents,0);assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('Missing log roots are reported without exposing the root path',async()=>{
  const r=await inspectDriverLogs({directory:path.join(tmpdir(),'missing-SECRET-host-evidence')});assert.equal(r.available,false);assert.equal(r.errorCode,'ENOENT');assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('Driver evidence never follows directory symlinks',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'ctw-host-link-'));
  try{
    await mkdir(path.join(root,'real'));await writeFile(path.join(root,'real','one.log'),'NotReadableError');
    try{await symlink(path.join(root,'real'),path.join(root,'link'),'junction')}catch(e){if(process.platform==='win32'&&['EPERM','EACCES'].includes(e.code)){t.skip('Windows symlink privilege unavailable');return}throw e}
    const r=await inspectDriverLogs({directory:root});assert.equal(r.filesInspected,1);assert.equal(r.skippedSymlinks,1);
  }finally{await rm(root,{recursive:true,force:true})}
});
