import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import net from 'node:net';
import {fork} from 'node:child_process';
import path from 'node:path';
import {mkdtemp,mkdir,copyFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createEphemeralLocalhostTlsOptions} from '../e2e/ephemeral-tls.mjs';
import {startOwnedMock,runPlaywright} from '../../scripts/run-playwright.mjs';
const cert='-----BEGIN CERTIFICATE-----\npublic-test-only';
const pending=()=>new Promise(()=>{});
function child(){const c=new EventEmitter();c.pid=123;c.kills=[];c.send=(_message,callback)=>callback?.(null);c.ended=false;c.end=(code=0)=>{if(!c.ended){c.ended=true;c.emit('exit',code,null)}};c.kill=s=>{c.kills.push(s);queueMicrotask(()=>c.end(1));return true};return c}
function forks(actions){const seen=[];return {seen,fork:(_file,_args,options)=>{const c=child();seen.push({c,options});queueMicrotask(()=>{const action=actions.shift();if(action==='collision'){c.emit('message',{type:'startup-error',code:'EADDRINUSE'});c.end(1)}else if(action==='unknown'){c.emit('message',{type:'startup-error',code:'EACCES'});c.end(1)}else if(action==='exit'){c.end(1)}else if(action==='error'){c.emit('error',new Error('secret raw failure'));c.end(1)}else if(action==='bad'){c.emit('message',{type:'ready',port:1,cert})}else if(action!=='hang'){c.emit('message',{type:'ready',port:Number(options.env.COSMIC_E2E_PORT),cert})}});return c}}}
async function realFixture(run){
 const root=path.resolve(import.meta.dirname,'../..');const directory=await mkdtemp(path.join(tmpdir(),'cosmic-owned-listener-'));
 try{
  await mkdir(path.join(directory,'tests/e2e'),{recursive:true});await mkdir(path.join(directory,'dist/public/js'),{recursive:true});
  for(const name of ['mock-server.mjs','tls-transport.mjs','ephemeral-tls.mjs'])await copyFile(path.join(root,'tests/e2e',name),path.join(directory,'tests/e2e',name));
  // Health-only synthetic fixture: no npm install, vendor build or browser acceptance claim.
  await copyFile(path.join(root,'public/js/app.js'),path.join(directory,'dist/public/js/app.js'));
  return await run((file,args,options)=>fork(path.join(directory,'tests/e2e/mock-server.mjs'),args,{...options,cwd:directory}));
 }finally{await rm(directory,{recursive:true,force:true})}
}
const startFake=options=>startOwnedMock({...options,createTls:()=>({key:'synthetic-key',cert})});
const probe=async()=>{};
test('bind collision retries only after exact owned child exits, then shares owned endpoint',async()=>{
 const f=forks(['collision','ready']);let p=20000;const owner=await startFake({env:{},forkServer:f.fork,randomPort:()=>p++,probe});
 assert.equal(f.seen.length,2);assert.equal(owner.port,20001);assert.equal(f.seen[0].c.ended,true);assert.equal(f.seen[0].c.kills.length,0);assert.match(owner.token,/^[0-9a-f]{32}$/);assert.equal(f.seen[1].options.stdio[3],'ipc');assert.deepEqual(f.seen[1].options.execArgv,[]);await owner.stop();assert.equal(f.seen[1].c.ended,true);
});
test('explicit port collision never substitutes another port or launches tests',async()=>{const f=forks(['collision','ready']);await assert.rejects(startFake({env:{COSMIC_E2E_PORT:'23456'},forkServer:f.fork,probe}),{code:'EADDRINUSE'});assert.equal(f.seen.length,1)});
test('randomized collision handling has an eight-start finite bound',async()=>{const f=forks(Array(9).fill('collision'));await assert.rejects(startFake({env:{},forkServer:f.fork,randomPort:()=>20000,probe}),{code:'collision_limit'});assert.equal(f.seen.length,8)});
test('unknown listener error, early exit and spawn error never retry or leak raw error',async()=>{
 for(const [action,code] of [['unknown','listen_failed'],['exit','server_exited'],['error','spawn_failed']]){const f=forks([action,'ready']);await assert.rejects(startFake({env:{},forkServer:f.fork,probe}),e=>e.code===code&&!e.message.includes('secret'));assert.equal(f.seen.length,1);assert.equal(f.seen[0].c.ended,true)}
});
test('malformed readiness and failed pinned health stop only the owned child and never retry',async()=>{
 const f=forks(['bad']);await assert.rejects(startFake({env:{},forkServer:f.fork,probe}),{code:'readiness_invalid'});assert.deepEqual(f.seen[0].c.kills,['SIGTERM']);
 const g=forks(['ready']);await assert.rejects(startFake({env:{},forkServer:g.fork,probe:async()=>{throw Object.assign(new Error('private response'),{code:'health_failed'})}}),e=>e.code==='health_failed'&&!e.message.includes('private'));assert.equal(g.seen.length,1);assert.equal(g.seen[0].c.ended,true);
});
test('startup timeout is finite, cleans owned process and cannot retry',async()=>{const f=forks(['hang']);await assert.rejects(startFake({env:{},forkServer:f.fork,probe,startupTimeoutMs:15}),{code:'startup_timeout'});assert.equal(f.seen.length,1);assert.equal(f.seen[0].c.ended,true)});
test('cancelled startup and invalid candidate cannot launch a process',async()=>{const f=forks([]);const a=new AbortController();a.abort();await assert.rejects(startFake({env:{},forkServer:f.fork,probe,signal:a.signal}),{code:'cancelled'});for(const p of [19999,45000,NaN])await assert.rejects(startFake({env:{},forkServer:f.fork,probe,randomPort:()=>p}),{code:'candidate_port_invalid'});assert.equal(f.seen.length,0)});
test('cancellation during readiness kills owned server without retry',async()=>{const f=forks(['hang']);const a=new AbortController();const wait=startFake({env:{},forkServer:f.fork,probe,signal:a.signal});a.abort();await assert.rejects(wait,{code:'cancelled'});assert.equal(f.seen[0].c.ended,true);assert.equal(f.seen.length,1)});
test('Playwright retains arguments, exit failure and shared endpoint, no shell or test replay',async()=>{
 let stopped=0,launched=0;const owned={port:23456,token:'a'.repeat(32),pid:99,exit:pending(),stop:async()=>{stopped++}};
 const status=await runPlaywright(['test','--project=firefox','--repeat-each=10'],{env:{CI:'true'},start:async()=>owned,spawnCli:(_node,args,opts)=>{launched++;assert.deepEqual(args.slice(1),['test','--project=firefox','--repeat-each=10']);assert.equal(opts.shell,false);assert.equal(opts.env.COSMIC_E2E_PORT,'23456');assert.equal(opts.env.COSMIC_E2E_OWNED_SERVER,'99');const c=child();queueMicrotask(()=>c.end(7));return c}});
 assert.equal(status,7);assert.equal(launched,1);assert.equal(stopped,1);
});
test('failed startup never launches Playwright and unexpected server exit fails tests',async()=>{
 let launched=0;await assert.rejects(runPlaywright(['test'],{start:async()=>{throw new Error('fail')},spawnCli:()=>{launched++}}));assert.equal(launched,0);
 let resolveServer,stopped=0;const exit=new Promise(r=>{resolveServer=r});let cli;
 await assert.rejects(runPlaywright(['test'],{start:async()=>({port:23456,token:'a'.repeat(32),pid:99,exit,stop:async()=>{stopped++}}),spawnCli:()=>{cli=child();queueMicrotask(()=>resolveServer({code:1}));return cli}}),{code:'server_exited_during_tests'});assert.equal(stopped,1);assert.ok(cli.kills.includes('SIGTERM'));
});
test('real TLS owner is health-verified and fixed occupied listener is never terminated',async()=>realFixture(async forkServer=>{
 const owner=await startOwnedMock({env:{...process.env,COSMIC_E2E_PORT:undefined},forkServer});assert.ok(owner.port>=20000&&owner.port<45000);await owner.stop();
 const foreign=net.createServer();await new Promise((resolve,reject)=>{foreign.once('error',reject);foreign.listen(0,'127.0.0.1',resolve)});
 try{await assert.rejects(startOwnedMock({env:{...process.env,COSMIC_E2E_PORT:String(foreign.address().port)},forkServer}),{code:'EADDRINUSE'});assert.equal(foreign.listening,true)}finally{await new Promise(resolve=>foreign.close(resolve))}
}));
test('abort leaves Promise.race immediately and confirms CLI exit after ignored TERM',async()=>{
 const a=new AbortController();let cli,stopped=0;
 const run=runPlaywright(['test'],{signal:a.signal,start:async()=>({port:23456,token:'a'.repeat(32),pid:99,exit:pending(),stop:async()=>{stopped++}}),spawnCli:()=>{cli=child();cli.kill=s=>{cli.kills.push(s);if(s==='SIGKILL')queueMicrotask(()=>cli.end(1));return true};queueMicrotask(()=>a.abort());return cli}});
 await assert.rejects(run,{code:'cancelled'});assert.deepEqual(cli.kills,['SIGTERM','SIGKILL']);assert.equal(cli.ended,true);assert.equal(stopped,1);
});
test('unconfirmed CLI cleanup fails closed after bounded TERM and KILL, still stops server',async()=>{
 let stopped=0,cli;const a=new AbortController();
 await assert.rejects(runPlaywright(['test'],{signal:a.signal,start:async()=>({port:23456,token:'a'.repeat(32),pid:99,exit:pending(),stop:async()=>{stopped++}}),spawnCli:()=>{cli=child();cli.kill=s=>{cli.kills.push(s);return true};queueMicrotask(()=>a.abort());return cli}}),{code:'owned_cleanup_unconfirmed'});
 assert.deepEqual(cli.kills,['SIGTERM','SIGKILL']);assert.equal(stopped,1);
});
test('real owned mock exits if its parent IPC disconnects; no standalone behavior changed',async()=>realFixture(async forkServer=>{
 let child;const owner=await startOwnedMock({env:{...process.env,COSMIC_E2E_PORT:undefined},forkServer:(...args)=>(child=forkServer(...args))});
 let stop;try{child.disconnect();await Promise.race([owner.exit,new Promise((_,reject)=>{stop=setTimeout(()=>reject(new Error('disconnect did not close child')),3000)})]);assert.equal(child.connected,false)}finally{clearTimeout(stop);await owner.stop()}
}));

test('abort during parent TLS preparation cannot fork or leave child-side key generation',async()=>{
 const a=new AbortController();let forked=0;
 await assert.rejects(startOwnedMock({env:{},signal:a.signal,createTls:()=>{a.abort();return {key:'synthetic-key',cert}},forkServer:()=>{forked++}}),{code:'cancelled'});assert.equal(forked,0);
});
test('unconfirmed or invalid collision exit is never retried',async()=>{
 const f=forks([]);f.fork=()=>{const c=child();f.seen.push({c});queueMicrotask(()=>{c.emit('message',{type:'startup-error',code:'EADDRINUSE'});c.end(0)});return c};await assert.rejects(startFake({env:{},forkServer:f.fork,probe}),{code:'collision_exit_invalid'});assert.equal(f.seen.length,1);
 const g=forks([]);g.fork=()=>{const c=child();g.seen.push({c});queueMicrotask(()=>c.emit('message',{type:'startup-error',code:'EADDRINUSE'}));return c};await assert.rejects(startFake({env:{},forkServer:g.fork,probe}),{code:'collision_exit_unconfirmed'});assert.equal(g.seen.length,1);assert.equal(g.seen[0].c.ended,true);
});

test('TLS preparation consumes the startup deadline and expired preparation cannot fork',async()=>{
 let clock=0,forked=0;await assert.rejects(startOwnedMock({env:{},now:()=>clock,createTls:()=>{clock=46000;return {key:'synthetic-key',cert}},forkServer:()=>{forked++}}),{code:'startup_timeout'});assert.equal(forked,0);
});
test('cancel after real TLS preparation leaves no temporary key and never forks',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'cosmic-cancel-tls-'));const a=new AbortController();let forked=0;
 try{await assert.rejects(startOwnedMock({env:{},signal:a.signal,createTls:()=>{const tls=createEphemeralLocalhostTlsOptions({temporaryRoot:directory});a.abort();return tls},forkServer:()=>{forked++}}),{code:'cancelled'});assert.equal(forked,0);assert.deepEqual(await readdir(directory),[])}finally{await rm(directory,{recursive:true,force:true})}
});
