from __future__ import annotations
import pathlib

ROOT=pathlib.Path(__file__).resolve().parents[1]
WORK=ROOT/'work'
AUDIT=WORK/'scripts'/'audit-lib.mjs'
MUT=WORK/'scripts'/'mutation-suite.mjs'

def fail(msg:str)->None:
    raise SystemExit('latest-dependency policy repair failed: '+msg)

def read(p:pathlib.Path)->str:
    if not p.is_file(): fail(f'missing {p}')
    return p.read_text(encoding='utf-8')

def replace_one(p:pathlib.Path,old:str,new:str)->None:
    text=read(p)
    if text.count(old)!=1: fail(f'{p.name}: expected one stale invariant, found {text.count(old)}')
    p.write_text(text.replace(old,new,1),encoding='utf-8',newline='')

old_audit='    ,["current Workers Vitest pool direct dependency is ^0.21.0", () => s("package.json").includes("\\\"@cloudflare/vitest-pool-workers\\\": \\\"^0.21.0\\\"") && !s("package.json").includes("\\\"@cloudflare/vitest-pool-workers\\\": \\\"^0.20.3\\\"")]'
new_audit='    ,["Workers Vitest pool participates in generic registry-latest direct dependency refresh", () => /"@cloudflare\\/vitest-pool-workers"\\s*:/.test(s("package.json")) && /const dev = Object\\.keys\\(pkg\\.devDependencies \\|\\| \\{\\}\\)\\.map\\(name => `\\$\\{name\\}@latest`\\);/.test(s("scripts/deps-latest.mjs")) && /npm outdated --depth=0/.test(s(".github/workflows/ci.yml"))]'
replace_one(AUDIT,old_audit,new_audit)

old_mut='  ["restore superseded Workers Vitest pool direct dependency -> current Workers Vitest pool direct dependency is ^0.21.0", "package.json", /"@cloudflare\\/vitest-pool-workers": "\\^0\\.21\\.0"/, "\\\"@cloudflare/vitest-pool-workers\\\": \\\"^0.20.3\\\""],'
new_mut='  ["disable dev dependency registry-latest mapping -> Workers Vitest pool participates in generic registry-latest direct dependency refresh", "scripts/deps-latest.mjs", /const dev = Object\\.keys\\(pkg\\.devDependencies \\|\\| \\{\\}\\)\\.map\\(name => `\\$\\{name\\}@latest`\\);/, "const dev = Object.keys(pkg.devDependencies || {}).map(name => name);"],'
replace_one(MUT,old_mut,new_mut)

if '^0.21.0' in read(AUDIT): fail('stale Workers Vitest exact direct-version safeguard remains')
if 'Workers Vitest pool participates in generic registry-latest direct dependency refresh' not in read(AUDIT): fail('replacement safeguard missing')
if 'disable dev dependency registry-latest mapping' not in read(MUT): fail('replacement mutation missing')
print('Latest-dependency policy repair PASS: direct dependency freshness is behavioral, not version-number pinned.')
