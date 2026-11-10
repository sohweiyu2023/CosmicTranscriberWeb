import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

// All certificates and keys here are E2E-only and short-lived. Even when
// configuration validation, certificate generation, or export fails, the
// ephemeral PRIVATE key must never survive in the runner's temporary folder.
export function createEphemeralLocalhostTlsOptions({
  nativeAcceptance=false,certificateOut,temporaryRoot=tmpdir(),opensslExecutable='openssl'
}={}){
  const directory=mkdtempSync(path.join(temporaryRoot,'cosmic-e2e-tls-'));
  try{
    const keyPath=path.join(directory,'key.pem'),certPath=path.join(directory,'cert.pem');
    const generated=spawnSync(opensslExecutable,[
      'req','-x509','-newkey','rsa:2048','-sha256','-nodes',
      '-keyout',keyPath,'-out',certPath,'-days','1',
      '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'
    ],{stdio:'pipe',windowsHide:true,timeout:20000});
    if(generated.error||generated.status!==0){
      // Preserve a finite cause without persisting OpenSSL output, command
      // arguments, temporary key paths or a raw exception message.
      const cause=['ENOENT','EACCES','EPERM','ETIMEDOUT'].includes(generated.error?.code)?generated.error.code:'unknown';
      const error=new Error('Unable to generate ephemeral localhost TLS certificate for E2E.');
      error.code=cause==='ENOENT'?'tls_generator_missing':cause==='ETIMEDOUT'?'tls_generator_timeout':cause==='EACCES'||cause==='EPERM'?'tls_generator_denied':'tls_generator_failed';
      error.safeDetails=Object.freeze({stage:'tls_generation',cause,exitCode:Number.isInteger(generated.status)?generated.status:null,rawOutputOmitted:true});
      throw error;
    }
    const tlsOptions={key:readFileSync(keyPath),cert:readFileSync(certPath)};
    if(certificateOut){
      if(!nativeAcceptance||typeof certificateOut!=='string'||!path.isAbsolute(certificateOut))
        throw new Error('Native E2E certificate export requires a controlled absolute path');
      // Public certificate ONLY, exclusive creation, owner-only permissions.
      writeFileSync(certificateOut,tlsOptions.cert,{flag:'wx',mode:0o600});
    }
    return tlsOptions;
  }finally{
    // This cleanup is mandatory on BOTH success and failure, including a
    // rejected export path or an existing destination. Never leave key.pem.
    rmSync(directory,{recursive:true,force:true});
  }
}
