import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CANONICAL_MP3,verifyCanonicalMp3,generateFixtures} from '../../scripts/generate-test-fixtures.mjs';

const canonical=await readFile(new URL('../fixtures/format.mp3',import.meta.url));
test('canonical native-Safari MP3 stays pinned independently of encoder output',()=>{
 verifyCanonicalMp3(canonical);
 assert.equal(CANONICAL_MP3.bytes,16941);
 assert.equal(CANONICAL_MP3.sha256,'e799ee1a44f73c9a4b146e76cce9deae6390ebc2aad3f51da13ce9dda2182b55');
 const substituted=Buffer.from(canonical);substituted[substituted.length-1]^=1;
 assert.throws(()=>verifyCanonicalMp3(substituted),/SHA-256 changed/);
 assert.throws(()=>verifyCanonicalMp3(canonical.subarray(0,-1)),/size changed/);
});

test('fixture generation never deletes or re-encodes the canonical MP3',async()=>{
 const out=await mkdtemp(path.join(tmpdir(),'cosmic-canonical-'));
 try{
  await writeFile(path.join(out,'format.mp3'),canonical);
  const calls=[];
  await generateFixtures({out,spawn:(_command,args)=>{
   const target=args.at(-1);calls.push(path.basename(target));
   assert.notEqual(path.basename(target),'format.mp3');
   // Model a different encoder version producing arbitrary bytes for generated fixtures.
   writeFileSync(target,Buffer.alloc(256,7));return {status:0};
  }});
  assert.equal(calls.length,11);
  assert.deepEqual(await readFile(path.join(out,'format.mp3')),canonical);
  assert.equal((await readFile(path.join(out,'truncated.mp3'))).length,239);
 }finally{await rm(out,{recursive:true,force:true});}
});

test('missing or changed canonical evidence fails before generation or cleanup',async()=>{
 const out=await mkdtemp(path.join(tmpdir(),'cosmic-canonical-reject-'));
 try{
  let calls=0;const spawn=()=>{calls++;throw new Error('must not run');};
  const sentinel=Buffer.from('preserve existing generated input');
  await writeFile(path.join(out,'format.flac'),sentinel);
  await assert.rejects(generateFixtures({out,spawn}),{code:'ENOENT'});
  await writeFile(path.join(out,'format.mp3'),canonical.subarray(0,-1));
  await assert.rejects(generateFixtures({out,spawn}),/size changed/);
  const changed=Buffer.from(canonical);changed[changed.length-1]^=1;
  await writeFile(path.join(out,'format.mp3'),changed);
  await assert.rejects(generateFixtures({out,spawn}),/SHA-256 changed/);
  assert.equal(calls,0);
  assert.deepEqual(await readFile(path.join(out,'format.flac')),sentinel);
 }finally{await rm(out,{recursive:true,force:true});}
});
