import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:https';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pinnedLocalRequest} from '../safari/pinned-local-https.mjs';

async function certificate(dir,prefix){
  const key=path.join(dir,prefix+'.key'),cert=path.join(dir,prefix+'.crt');
  const command=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-sha256','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'pipe',timeout:15000});
  assert.equal(command.status,0,command.stderr?.toString()||'openssl failed');
  return {key:await readFile(key),cert:await readFile(cert),certPath:cert};
}
test('real localhost HTTPS control request trusts only the exact ephemeral certificate',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ctw-pinned-tls-test-'));
  let server;
  try{
    const good=await certificate(dir,'good'),wrong=await certificate(dir,'wrong');
    server=createServer({key:good.key,cert:good.cert},(req,res)=>{
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({method:req.method,path:req.url}));
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
    const url=`https://localhost:${server.address().port}/__cosmic_e2e_health`;
    const result=await pinnedLocalRequest(url,{certificatePath:good.certPath,timeout:3000});
    assert.equal(result.status,200);
    assert.deepEqual(JSON.parse(result.text),{method:'GET',path:'/__cosmic_e2e_health'});
    await assert.rejects(pinnedLocalRequest(url,{certificatePath:wrong.certPath,timeout:3000}),/certificate|self-signed|verify/i);
    await assert.rejects(pinnedLocalRequest(url,{timeout:3000}),/requires a server certificate/);
    await assert.rejects(pinnedLocalRequest(url.replace('localhost','example.com'),{certificatePath:good.certPath}),/restricted to localhost/);
    await assert.rejects(pinnedLocalRequest(url.replace('https:','http:'),{certificatePath:good.certPath}),/restricted to localhost/);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await rm(dir,{recursive:true,force:true});
  }
});
