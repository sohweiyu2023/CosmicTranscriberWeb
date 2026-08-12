from __future__ import annotations
import json, pathlib

ROOT=pathlib.Path(__file__).resolve().parents[1]
WORK=ROOT/'work'

def fail(msg:str)->None:
    raise SystemExit(f'1.0.14 upgrade failed: {msg}')

def read(rel:str)->str:
    p=WORK/rel
    if not p.is_file(): fail(f'missing {rel}')
    return p.read_text(encoding='utf-8')

def write(rel:str,text:str)->None:
    (WORK/rel).write_text(text,encoding='utf-8',newline='')

# Promote only current release identity surfaces. Preserve historical changelog entries.
targets=[
    'package.json','RELEASE_MANIFEST.json','wrangler.jsonc','README.md','PASTE-ONCE-WINDOWS.ps1',
    'public/index.html','public/js/models.js','tests/e2e/mock-server.mjs',
    'tests/integration/wrangler.test.jsonc','tests/worker/runtime.test.js','tests/worker/wrangler.test.jsonc',
    'tests/node/version-consistency.test.mjs','.github/workflows/ci.yml','scripts/audit-lib.mjs','scripts/mutation-suite.mjs',
]
targets += [p.relative_to(WORK).as_posix() for p in sorted((WORK/'docs').glob('*.md')) if p.name!='CHANGELOG.md']
for rel in targets:
    text=read(rel)
    updated=text.replace(r'1\.0\.13',r'1\.0\.14').replace('1.0.13','1.0.14')
    if updated!=text:
        write(rel,updated)

pkg=json.loads(read('package.json'))
if pkg.get('version')!='1.0.14': fail(f'package version is {pkg.get("version")!r}')
write('package.json',json.dumps(pkg,indent=2,ensure_ascii=False)+'\n')

manifest=json.loads(read('RELEASE_MANIFEST.json'))
manifest['version']='1.0.14'
manifest['generatedAt']=None
manifest['releaseReady']=False
manifest['dependencyLock']={'status':'candidate-unverified','sha256':None,'registry':'https://registry.npmjs.org/'}
manifest['notes']=['Candidate metadata only; release packaging regenerates verified provenance after all gates pass.']
write('RELEASE_MANIFEST.json',json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')

ch=read('docs/CHANGELOG.md')
entry='''## 1.0.14 — candidate\n\n- Replaces overly strict MP3 byte-for-byte rejection with decoder-tolerant frame recovery: leading/trailing non-audio bytes are ignored, trustworthy MPEG frame runs are resynchronized after embedded junk, and a bounded partial terminal frame can be retained in the final chunk for tolerant decoders.\n- Adds regression coverage modeled on real staging failures: an otherwise valid recording with a 1,600-byte `0xFF` trailer and a recording whose final MPEG frame is 128 bytes short. The original private user recordings are not committed.\n- Keeps empty/no-audio inputs rejected, preserves frame ordering, keeps diarization overlap-free, retains Xing/Info/VBRI rewriting, increments the chunker revision so old checkpoints cannot cross the changed chunk semantics, and requires decoder-backed verification of generated chunks.\n- Refreshes every direct dependency to registry `@latest` during certification and reruns the complete Linux, macOS/WebKit/real-Safari, Windows private-toolchain/branded-browser, Worker, integration, mutation, package and independent ZIP gates.\n\n'''
if not ch.startswith('## 1.0.14 — candidate'):
    write('docs/CHANGELOG.md',entry+ch)

checks={
    'version': json.loads(read('package.json')).get('version')=='1.0.14',
    'manifest': json.loads(read('RELEASE_MANIFEST.json')).get('version')=='1.0.14' and json.loads(read('RELEASE_MANIFEST.json')).get('releaseReady') is False,
    'chunker revision': 'web-mp3-tolerant-resync-vbrmeta-1.3' in read('public/js/mp3.js'),
    'tolerant tests': 'arbitrary decoder-tolerable trailing bytes do not reject' in read('tests/node/mp3.test.mjs'),
    'no inherited lock': not (WORK/'package-lock.json').exists(),
}
bad=[k for k,v in checks.items() if not v]
if bad: fail('post-transform invariant failure(s): '+', '.join(bad))
print('Cosmic Transcriber Web 1.0.14 tolerant-MP3 candidate promotion PASS.')
