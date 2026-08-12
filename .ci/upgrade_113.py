from __future__ import annotations
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / 'work'

def fail(msg: str) -> None:
    raise SystemExit(f'1.0.13 upgrade failed: {msg}')

def read(rel: str) -> str:
    p = WORK / rel
    if not p.is_file(): fail(f'missing {rel}')
    return p.read_text(encoding='utf-8')

def write(rel: str, text: str) -> None:
    (WORK / rel).write_text(text, encoding='utf-8', newline='')

def replace_exact(rel: str, old: str, new: str, minimum: int = 1) -> None:
    text = read(rel)
    count = text.count(old)
    if count < minimum: fail(f'{rel}: expected at least {minimum} occurrence(s) of {old!r}; got {count}')
    write(rel, text.replace(old, new))

text_exts = {'.js','.mjs','.html','.css','.json','.jsonc','.md','.ps1','.yml','.yaml','.txt'}
for p in sorted(WORK.rglob('*')):
    if not p.is_file() or p.suffix.lower() not in text_exts: continue
    rel = p.relative_to(WORK).as_posix()
    if rel in {'SHA256SUMS.txt','windows-release-output.log','windows-release-transcript.log'}: continue
    try: text = p.read_text(encoding='utf-8')
    except UnicodeDecodeError: continue
    updated = text.replace(r'1\.0\.12', r'1\.0\.13').replace('1.0.12','1.0.13')
    if updated != text: p.write_text(updated, encoding='utf-8', newline='')

for rel in ('SHA256SUMS.txt','windows-release-output.log','windows-release-transcript.log'):
    p=WORK/rel
    if p.exists(): p.unlink()

replace_exact('.nvmrc','24.19.0','26.5.1')
replace_exact('WINDOWS-TOOLCHAIN.ps1',"$script:CosmicNodeVersion = '24.19.0'", "$script:CosmicNodeVersion = '26.5.1'")
replace_exact('WINDOWS-TOOLCHAIN.ps1','node-v24.19.0-win-x64.zip','node-v26.5.1-win-x64.zip')
replace_exact('WINDOWS-TOOLCHAIN.ps1','57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73','c432c996b95cbf7568f13a0fbb37526de84a27e3a5c520c3be15f05a9a168212')
replace_exact('WINDOWS-TOOLCHAIN.ps1','3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237','b48b0224081224cda1f49374e2fc63d143041ade51754f0cc6608fe8510ba29e')
replace_exact('WINDOWS-TOOLCHAIN.ps1','node-v24.19.0-win-arm64.zip','node-v26.5.1-win-arm64.zip')
replace_exact('WINDOWS-TOOLCHAIN.ps1','8502f4a50b458d4cc38ed8f2001556c2cd239d464920f74017926ccb1e1c157f','467f425228a2fdcc83a330f5f38b124b5b43b42f5033d7848b4e47c9becc36f9')
replace_exact('WINDOWS-TOOLCHAIN.ps1','3958e4bb3f2d4ef37c938215dfc65a9d3c9d839b5060fec103bd2345fa78e951','c6ca33154ee426f46e02aa9f5676d69b768808b564aa22652fe18bb08c188fe5')
replace_exact('WINDOWS-TOOLCHAIN.ps1','portable Node.js LTS archive','portable Node.js Current archive')

first = read('FIRST-DEPLOY-WINDOWS.ps1')
old = """function Require-ExactInput([string]$Prompt, [string]$Expected) {\n  $value = Read-Host $Prompt\n  if ($value -cne $Expected) { throw \"Confirmation not received. Expected exactly: $Expected\" }\n}"""
new = """function Require-ExactInput([string]$Prompt, [string]$Expected) {\n  $value = Read-Host $Prompt\n  $normalized = if ($null -eq $value) { '' } else { $value.Trim() }\n  if ($normalized -ine $Expected) { throw \"Confirmation not received. Expected: $Expected (case-insensitive; surrounding spaces are ignored).\" }\n}"""
if first.count(old) != 1: fail('FIRST-DEPLOY-WINDOWS.ps1 confirmation helper drifted')
write('FIRST-DEPLOY-WINDOWS.ps1', first.replace(old,new,1))

pkg = json.loads(read('package.json'))
if pkg.get('version') != '1.0.13': fail(f'package version after identity promotion is {pkg.get("version")!r}')
pkg['engines']={'node':'>=26.5.1 <27','npm':'>=12.0.2 <13'}
pkg.setdefault('devDependencies',{})['wrangler']='^4.121.0'
write('package.json', json.dumps(pkg, indent=2, ensure_ascii=False)+'\n')

# The reviewed source lineage intentionally has no package-lock.json here. The resolve-lock
# job creates the 1.0.13 lock only after moving every direct dependency to registry @latest.
lock_path=WORK/'package-lock.json'
if lock_path.exists(): lock_path.unlink()

rv=read('scripts/release-verify.mjs')
rv=rv.replace('minimumNode=[24,19,0]','minimumNode=[26,5,1]')
rv=rv.replace('nodeParts[0]===24','nodeParts[0]===26')
rv=rv.replace('Node >=24.19.0 <25','Node >=26.5.1 <27')
rv=rv.replace('reviewed LTS-major floor','reviewed Current-major floor').replace('current reviewed LTS floor','current reviewed Current-major floor')
write('scripts/release-verify.mjs',rv)

vc=read('scripts/version-consistency.mjs')
vc=vc.replace("const expectedNode='24.19.0'","const expectedNode='26.5.1'")
vc=vc.replace("includes('>=24.19')","includes('>=26.5.1')")
vc=vc.replace("includes('<25')","includes('<27')")
vc=vc.replace('Node 24.19 LTS-major floor','Node 26.5.1 Current-major floor')
write('scripts/version-consistency.mjs',vc)

repls = {
 '24.19.0':'26.5.1',
 '24\\.19\\.0':'26\\.5\\.1',
 'minimumNode=\\[24,19,0\\]':'minimumNode=\\[26,5,1\\]',
 '>=24.19 <25':'>=26.5.1 <27',
 '>=24\\.19 <25':'>=26\\.5\\.1 <27',
 '>=24.19.0 <25':'>=26.5.1 <27',
 '>=24\\.19\\.0 <25':'>=26\\.5\\.1 <27',
 '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73':'c432c996b95cbf7568f13a0fbb37526de84a27e3a5c520c3be15f05a9a168212',
 '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237':'b48b0224081224cda1f49374e2fc63d143041ade51754f0cc6608fe8510ba29e',
 '8502f4a50b458d4cc38ed8f2001556c2cd239d464920f74017926ccb1e1c157f':'467f425228a2fdcc83a330f5f38b124b5b43b42f5033d7848b4e47c9becc36f9',
 '3958e4bb3f2d4ef37c938215dfc65a9d3c9d839b5060fec103bd2345fa78e951':'c6ca33154ee426f46e02aa9f5676d69b768808b564aa22652fe18bb08c188fe5',
}
for rel in ('scripts/audit-lib.mjs','scripts/mutation-suite.mjs','tests/node/windows-toolchain-policy.test.mjs','tests/node/version-consistency.test.mjs','WINDOWS-TOOLCHAIN-SELFTEST.ps1','RELEASE-WINDOWS.ps1','.github/workflows/ci.yml'):
    t=read(rel)
    for a,b in repls.items(): t=t.replace(a,b)
    t=t.replace('Node 24.19','Node 26.5.1').replace('Node 24 LTS','Node 26 Current').replace('reviewed Node 24','reviewed Node 26')
    write(rel,t)

doc_repls = {
 'Node 26.5.1 as Latest LTS':'Node 26.5.1 as the current stable release',
 'Node 24.x is the LTS line selected for this release; the official Node 24 archive listed v26.5.1 as the latest LTS build at review time.':'Node 26.x Current is selected for this release; Node v26.5.1 was the current stable release when this candidate was created.',
 'Current Node 24 LTS / npm 12 / Playwright release assumptions':'Current Node 26 / npm 12 / Playwright release assumptions',
 'Node 24 LTS and current direct dependency release lines':'Node 26 Current and current direct dependency release lines',
 'Node 24.19 LTS floor':'Node 26.5.1 Current floor',
 'Node 24.19 LTS-major floor':'Node 26.5.1 Current-major floor',
 'Node 24 LTS floor':'Node 26.5.1 Current floor',
 'Node 24 LTS':'Node 26 Current',
 '>=26.5.1 <25':'>=26.5.1 <27',
}
for p in sorted((WORK/'docs').glob('*.md')):
    t=p.read_text(encoding='utf-8')
    for a,b in doc_repls.items(): t=t.replace(a,b)
    p.write_text(t,encoding='utf-8',newline='')

ch=read('docs/CHANGELOG.md')
if '## 1.0.13 — candidate' not in ch:
    ch = ('## 1.0.13 — candidate\n\n'
          '- Refreshes every direct production and development dependency from registry `@latest` before certification; `package.json` stays upgrade-friendly while the resulting `package-lock.json` is frozen only as evidence for this release.\n'
          '- Moves the reviewed release runtime to Node 26.5.1 Current with npm 12.0.2 and refreshes the private Windows x64/ARM64 hash-pinned toolchain.\n'
          '- Makes guided deployment confirmation tokens case-insensitive and whitespace-tolerant while still requiring the explicit token.\n'
          '- Requires full Linux browser/Worker/integration, macOS WebKit + real Safari, and Windows private-toolchain + branded-browser + release-package gates before promotion.\n\n') + ch
write('docs/CHANGELOG.md', ch)

manifest=json.loads(read('RELEASE_MANIFEST.json'))
manifest['version']='1.0.13'
manifest['generatedAt']=None
manifest['releaseReady']=False
manifest['dependencyLock']={'status':'candidate-unverified','sha256':None,'registry':'https://registry.npmjs.org/'}
manifest['notes']=['Candidate metadata only; release packaging regenerates verified provenance after all gates pass.']
write('RELEASE_MANIFEST.json',json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')

checks={
 'package version': json.loads(read('package.json')).get('version')=='1.0.13',
 'node engine': json.loads(read('package.json')).get('engines',{}).get('node')=='>=26.5.1 <27',
 'nvmrc': read('.nvmrc').strip()=='26.5.1',
 'case-insensitive confirmation': '$normalized -ine $Expected' in read('FIRST-DEPLOY-WINDOWS.ps1'),
 'x64 archive hash': 'c432c996b95cbf7568f13a0fbb37526de84a27e3a5c520c3be15f05a9a168212' in read('WINDOWS-TOOLCHAIN.ps1'),
 'arm64 archive hash': '467f425228a2fdcc83a330f5f38b124b5b43b42f5033d7848b4e47c9becc36f9' in read('WINDOWS-TOOLCHAIN.ps1'),
 'no inherited lock': not (WORK/'package-lock.json').exists(),
}
bad=[k for k,v in checks.items() if not v]
if bad: fail('post-transform invariant failure(s): '+', '.join(bad))
print('Cosmic Transcriber Web 1.0.13 fail-closed upgrade transform PASS.')
