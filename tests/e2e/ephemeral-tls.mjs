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
    if(generated.error||generated.status!==0)
      throw new Error('Unable to generate ephemeral localhost TLS certificate for E2E.');
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
