import test from 'node:test';
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import https from 'node:https';
import {createE2eTlsServer} from '../e2e/tls-transport.mjs';
import {createEphemeralLocalhostTlsOptions} from '../e2e/ephemeral-tls.mjs';

// Use the SAME temporary localhost certificate generator as the real HTTPS
// mock server. The former duplicate Windows spawnSync OpenSSL setup could
// time out during concurrent CI tests despite the real server generator
// passing. Keep genuine certificate generation, ALPN and HTTP/1.1 tests.
const ephemeralTls=()=>createEphemeralLocalhostTlsOptions();
async function listen(server){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});return server.address().port}
function getHttp1(port,resource){return new Promise((resolve,reject)=>{
  https.get({hostname:'127.0.0.1',port,path:resource,rejectUnauthorized:false,ALPNProtocols:['http/1.1']},res=>{
    const data=[],protocol=res.socket?.alpnProtocol;res.on('data',chunk=>data.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(data).toString(),protocol}));res.on('error',reject);
  }).on('error',reject);
})}
function getHttp2(client,resource){return new Promise((resolve,reject)=>{
  const stream=client.request({':path':resource});let status;const data=[];
  stream.on('response',headers=>{status=headers[':status']});stream.on('data',chunk=>data.push(chunk));
  stream.on('end',()=>resolve({status,body:Buffer.concat(data).toString()}));stream.on('error',reject);stream.end();
})}

test('Playwright TLS transport multiplexes concurrent modules over one HTTP/2 session and keeps HTTP/1.1 fallback', {timeout:60000},async()=>{
  const seen=[];
  const server=createE2eTlsServer(ephemeralTls(),(req,res)=>{
    seen.push(req.url);
    res.writeHead(200,{'content-type':'application/javascript','cache-control':'no-store'});
    res.end(`module:${req.url}`);
  },{multiplex:true});
  const port=await listen(server);
  const client=http2.connect(`https://127.0.0.1:${port}`,{rejectUnauthorized:false});
  try{
    await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('error',reject)});
    assert.equal(client.alpnProtocol,'h2','Real HTTP/2 ALPN negotiation is required');
    const paths=Array.from({length:24},(_,i)=>`/js/module-${i}.js`);
    const results=await Promise.all(paths.map(resource=>getHttp2(client,resource)));
    results.forEach((result,i)=>{assert.equal(result.status,200);assert.equal(result.body,`module:${paths[i]}`)});
    assert.equal(seen.length,24);
    const legacy=await getHttp1(port,'/api/session/status');
    assert.equal(legacy.status,200);assert.equal(legacy.body,'module:/api/session/status');
    assert.equal(legacy.protocol,'http/1.1');
  }finally{client.close();await new Promise(resolve=>server.close(resolve))}
});

test('Real SafariDriver transport remains native HTTPS/1.1 when HTTP/2 is not enabled', {timeout:60000},async()=>{
  const server=createE2eTlsServer(ephemeralTls(),(req,res)=>{res.writeHead(200);res.end('original-safari-http1')});
  const port=await listen(server);
  try{const result=await getHttp1(port,'/native-file');assert.equal(result.status,200);assert.equal(result.body,'original-safari-http1')}
  finally{await new Promise(resolve=>server.close(resolve))}
});
