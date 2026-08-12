from __future__ import annotations
import json, pathlib, re, runpy

ROOT=pathlib.Path(__file__).resolve().parents[1]
WORK=ROOT/'work'
PACKAGE=WORK/'package.json'
AUDIT=WORK/'scripts'/'audit-lib.mjs'
MUT=WORK/'scripts'/'mutation-suite.mjs'
OLDER='workerd@1.20260801.1'
NEWER='workerd@1.20260804.1'
POOL='@cloudflare/vitest-pool-workers'

def fail(msg:str)->None: raise SystemExit('install/dependency certification repair failed: '+msg)
def read(p:pathlib.Path)->str:
    if not p.is_file(): fail(f'missing {p}')
    return p.read_text(encoding='utf-8')
def write(p:pathlib.Path,s:str)->None: p.write_text(s,encoding='utf-8',newline='')

package_text=read(PACKAGE)
pkg=json.loads(package_text)
policy=pkg.get('allowScripts')
if not isinstance(policy,dict) or policy.get(OLDER) is not True or policy.get('workerd') is True:
    fail('reviewed starting workerd lifecycle policy drifted')
if NEWER in policy: fail('newer reviewed workerd approval unexpectedly already exists')
sections=[s for s in ('dependencies','devDependencies') if isinstance(pkg.get(s),dict) and POOL in pkg[s]]
if len(sections)!=1: fail(f'{POOL} must occur in exactly one direct dependency section')
section=sections[0]
if pkg[section][POOL] not in {'^0.20.3','~0.20.3','0.20.3'}:
    fail(f'reviewed starting Workers Vitest pool range drifted: {pkg[section][POOL]!r}')

policy[NEWER]=True
pkg[section][POOL]='^0.21.0'
write(PACKAGE,json.dumps(pkg,indent=2,ensure_ascii=False)+'\n')

audit=read(AUDIT)
anchor='    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(anchor)!=1: fail('audit insertion anchor drifted')
workerd_label='reviewed workerd lifecycle approvals are exact-version pinned to 1.20260801.1 and 1.20260804.1'
pool_label='current Workers Vitest pool direct dependency is ^0.21.0'
if workerd_label in audit or pool_label in audit: fail('install/dependency safeguard already present')
checks=(
'    ,["'+workerd_label+'", () => s("package.json").includes("\\\"workerd@1.20260801.1\\\": true") && s("package.json").includes("\\\"workerd@1.20260804.1\\\": true") && !s("package.json").includes("\\\"workerd\\\": true")]\n'
'    ,["'+pool_label+'", () => s("package.json").includes("\\\"@cloudflare/vitest-pool-workers\\\": \\\"^0.21.0\\\"") && !s("package.json").includes("\\\"@cloudflare/vitest-pool-workers\\\": \\\"^0.20.3\\\"")]\n'
)
write(AUDIT,audit.replace(anchor,checks+anchor,1))

mut=read(MUT)
ma='  ["stop CI from sharing one reviewed lock across platforms",'
if mut.count(ma)!=1: fail('mutation insertion anchor drifted')
entries=(
'  ["drop older reviewed workerd install-script approval -> '+workerd_label+'", "package.json", /"workerd@1\\.20260801\\.1": true/, "\\\"workerd@1.20260801.1\\\": false"],\n'
'  ["drop newer reviewed workerd install-script approval -> '+workerd_label+'", "package.json", /"workerd@1\\.20260804\\.1": true/, "\\\"workerd@1.20260804.1\\\": false"],\n'
'  ["restore superseded Workers Vitest pool direct dependency -> '+pool_label+'", "package.json", /"@cloudflare\\/vitest-pool-workers": "\\^0\\.21\\.0"/, "\\\"@cloudflare/vitest-pool-workers\\\": \\\"^0.20.3\\\""],\n'
)
write(MUT,mut.replace(ma,entries+ma,1))

# Replace the historical exact direct-version invariant with a permanent behavioral
# freshness invariant before any registry @latest resolution occurs.
runpy.run_path(str(ROOT/'.ci'/'repair_latest_dependency_policy.py'),run_name='__main__')

final=json.loads(read(PACKAGE))
if final.get('allowScripts',{}).get(OLDER) is not True or final.get('allowScripts',{}).get(NEWER) is not True:
    fail('final reviewed workerd lifecycle approvals missing')
if final.get('allowScripts',{}).get('workerd') is True: fail('broad workerd lifecycle approval forbidden')
if final.get(section,{}).get(POOL)!='^0.21.0': fail('pre-refresh Workers Vitest migration failed')
print('Reviewed install-script policy repair PASS; direct dependency freshness is no longer version-number pinned.')

for script in ('repair_cancel.py','repair_firefox_key_dialog.py','repair_cookie_contract.py','repair_safari.py'):
    runpy.run_path(str(ROOT/'.ci'/script),run_name='__main__')
