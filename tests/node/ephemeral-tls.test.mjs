import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createEphemeralLocalhostTlsOptions} from '../e2e/ephemeral-tls.mjs';

async function withIsolatedTemporaryRoot(run){
  const dir=await mkdtemp(path.join(tmpdir(),'ctw-tls-cleanup-unit-'));
  try{await run(dir)}finally{await rm(dir,{recursive:true,force:true})}
}
async function assertNoPrivateKeyArtifacts(dir){
  const names=await readdir(dir);
  assert.ok(names.every(name=>!name.startsWith('cosmic-e2e-tls-')),
    `Ephemeral private-key directory survived: ${names.join(', ')}`);
}

test('ephemeral HTTPS certificate generation deletes its private key on success',async()=>{
  await withIsolatedTemporaryRoot(async dir=>{
    const exported=path.join(dir,'public-cert.pem');
    const tls=createEphemeralLocalhostTlsOptions({nativeAcceptance:true,certificateOut:exported,temporaryRoot:dir});
    assert.match(tls.key.toString(),/BEGIN PRIVATE KEY/);
    assert.match(tls.cert.toString(),/BEGIN CERTIFICATE/);
    assert.deepEqual(await readFile(exported),tls.cert);
    const publicCertStat=await stat(exported);
    assert.equal(publicCertStat.isFile(),true,'The exported public certificate must be a regular file');
    // Windows reports synthetic Unix permission bits from DOS file attributes,
    // so mode & 0777 is not evidence about the NTFS ACL. Keep the strict 0600
    // assertion on POSIX, where these mode bits are meaningful. The actual
    // private-key absence and certificate contents remain asserted everywhere.
    if(process.platform!=='win32')assert.equal(publicCertStat.mode&0o777,0o600);
    await assertNoPrivateKeyArtifacts(dir);
  });
});

test('ephemeral HTTPS rejects certificate export without native acceptance and erases private key',async()=>{
  await withIsolatedTemporaryRoot(async dir=>{
    const exported=path.join(dir,'forbidden.pem');
    assert.throws(()=>createEphemeralLocalhostTlsOptions({certificateOut:exported,temporaryRoot:dir}),/controlled absolute path/);
    await assert.rejects(stat(exported),{code:'ENOENT'});
    await assertNoPrivateKeyArtifacts(dir);
  });
});

test('ephemeral HTTPS rejects relative certificate destination and erases private key',async()=>{
  await withIsolatedTemporaryRoot(async dir=>{
    assert.throws(()=>createEphemeralLocalhostTlsOptions({nativeAcceptance:true,certificateOut:'relative.pem',temporaryRoot:dir}),/controlled absolute path/);
    await assertNoPrivateKeyArtifacts(dir);
  });
});

test('ephemeral HTTPS cannot overwrite an existing public certificate and erases private key',async()=>{
  await withIsolatedTemporaryRoot(async dir=>{
    const exported=path.join(dir,'existing.pem');
    await writeFile(exported,'sentinel');
    assert.throws(()=>createEphemeralLocalhostTlsOptions({nativeAcceptance:true,certificateOut:exported,temporaryRoot:dir}),/EEXIST/);
    assert.equal((await readFile(exported,'utf8')),'sentinel');
    await assertNoPrivateKeyArtifacts(dir);
  });
});

test('ephemeral HTTPS cleans up even when OpenSSL fails before creating certificates',async()=>{
  await withIsolatedTemporaryRoot(async dir=>{
    assert.throws(()=>createEphemeralLocalhostTlsOptions({temporaryRoot:dir,opensslExecutable:'/missing/cosmic-no-openssl'}),/Unable to generate/);
    await assertNoPrivateKeyArtifacts(dir);
  });
});
