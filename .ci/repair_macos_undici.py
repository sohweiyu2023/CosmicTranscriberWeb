from __future__ import annotations
import pathlib

ROOT=pathlib.Path(__file__).resolve().parents[1]
WORK=ROOT/'work'
TEST=WORK/'tests'/'integration'/'worker.test.js'
AUDIT=WORK/'scripts'/'audit-lib.mjs'
MUT=WORK/'scripts'/'mutation-suite.mjs'

def fail(msg:str)->None: raise SystemExit('macOS Undici integration repair failed: '+msg)
def read(p:pathlib.Path)->str:
    if not p.is_file(): fail(f'missing {p}')
    return p.read_text(encoding='utf-8')
def write(p:pathlib.Path,s:str)->None: p.write_text(s,encoding='utf-8',newline='')
def once(p:pathlib.Path,old:str,new:str)->None:
    s=read(p)
    if s.count(old)!=1: fail(f'{p.name}: expected one anchor, found {s.count(old)} for {old!r}')
    write(p,s.replace(old,new,1))

once(TEST,"import {SignJWT,generateKeyPair,exportJWK} from 'jose';","import {SignJWT,generateKeyPair,exportJWK} from 'jose';\nimport net from 'node:net';")
anchor="const origin='http://localhost';\n"
guard="""const origin='http://localhost';

// Node 26/Undici performs a socket Type-of-Service optimization. On macOS the
// kernel may reject that optional QoS call with synchronous EINVAL even though
// the HTTP request itself succeeds. Keep this workaround test-only, Darwin-only,
// and narrow to that exact syscall/code; every other socket error still throws.
let ctwRestoreDarwinTypeOfService=null;
function ctwInstallDarwinTypeOfServiceGuard(){
  if(process.platform!=='darwin')return ()=>{};
  const original=net.Socket.prototype.setTypeOfService;
  if(typeof original!=='function')return ()=>{};
  net.Socket.prototype.setTypeOfService=function(...args){
    try{return original.apply(this,args)}
    catch(error){
      if(error?.code==='EINVAL'&&error?.syscall==='setTypeOfService')return this;
      throw error;
    }
  };
  return ()=>{net.Socket.prototype.setTypeOfService=original;};
}
"""
once(TEST,anchor,guard)
once(TEST,"beforeAll(async()=>{\n  network.listen({onUnhandledRequest:'error'});","beforeAll(async()=>{\n  ctwRestoreDarwinTypeOfService=ctwInstallDarwinTypeOfServiceGuard();\n  network.listen({onUnhandledRequest:'error'});")
once(TEST,"  network.close();\n  await server?.close();\n});","  network.close();\n  await server?.close();\n  ctwRestoreDarwinTypeOfService?.();\n  ctwRestoreDarwinTypeOfService=null;\n});")

label='macOS integration suppresses only harmless Undici setTypeOfService EINVAL and restores Socket prototype'
audit=read(AUDIT)
a='    ["integration harness lifecycle current",'
if audit.count(a)!=1: fail('audit anchor drifted')
check='    ["'+label+'", () => /process\\.platform!==\\\'darwin\\\'/.test(s("tests/integration/worker.test.js")) && /error\\?\\.code===\\\'EINVAL\\\'&&error\\?\\.syscall===\\\'setTypeOfService\\\'/.test(s("tests/integration/worker.test.js")) && /net\\.Socket\\.prototype\\.setTypeOfService=original/.test(s("tests/integration/worker.test.js"))],\n'
write(AUDIT,audit.replace(a,check+a,1))

mut=read(MUT)
ma='  ["remove integration server listen",'
if mut.count(ma)!=1: fail('mutation anchor drifted')
entry='  ["broaden macOS Undici ToS suppression beyond exact EINVAL -> '+label+'", "tests/integration/worker.test.js", /error\\?\\.code===\\\'EINVAL\\\'&&error\\?\\.syscall===\\\'setTypeOfService\\\'/, "error?.code"],\n'
write(MUT,mut.replace(ma,entry+ma,1))

final=read(TEST)
for required in ("process.platform!=='darwin'","error?.code==='EINVAL'&&error?.syscall==='setTypeOfService'","net.Socket.prototype.setTypeOfService=original"):
    if required not in final: fail(f'missing final invariant {required}')
print('macOS Undici ToS repair PASS: test-only Darwin guard suppresses only setTypeOfService EINVAL and restores the prototype.')
