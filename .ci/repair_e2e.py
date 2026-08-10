from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
PLAYWRIGHT = WORK / "playwright.config.js"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"E2E certification repair required file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"E2E certification repair expected UTF-8 file: {path}")
        raise


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def top_level_entry(text: str, label: str) -> tuple[int, int, str, str]:
    pattern = re.compile(rf'(?m)^(?P<indent>[ \t]*)\["{re.escape(label)}"')
    hits = list(pattern.finditer(text))
    if len(hits) != 1:
        fail(f'Mutation "{label}" entry count drifted: {len(hits)}')
    hit = hits[0]
    indent = hit.group("indent")
    nxt = re.search(rf'(?m)^{re.escape(indent)}\["', text[hit.end():])
    end = hit.end() + nxt.start() if nxt else len(text)
    return hit.start(), end, text[hit.start():end], indent


# Playwright evaluates its config in more than one process. The reviewed config
# generated a fresh fallback port/token on every evaluation, so the parent could
# start the mock server on one port while a test worker navigated to another.
# Seed the values into the parent environment during the first config load;
# every subsequently spawned Playwright/webServer process inherits the same pair.
config = read(PLAYWRIGHT)
old_port = "const e2ePort=Number(process.env.COSMIC_E2E_PORT)||randomInt(20000,60000);"
new_port = "const e2ePort=Number(process.env.COSMIC_E2E_PORT ||= String(randomInt(20000,60000)));"
old_token = "const e2eToken=process.env.COSMIC_E2E_TOKEN||randomBytes(16).toString('hex');"
new_token = "const e2eToken=process.env.COSMIC_E2E_TOKEN ||= randomBytes(16).toString('hex');"
for label, old in (("port", old_port), ("token", old_token)):
    count = config.count(old)
    if count != 1:
        fail(f"Reviewed Playwright {label} fallback drifted: expected 1 exact occurrence; found {count}")
config = config.replace(old_port, new_port, 1).replace(old_token, new_token, 1)
for invariant, count in (
    (new_port, 1),
    (new_token, 1),
    ("const origin=`http://localhost:${e2ePort}`;", 1),
    ("url:`${origin}/__cosmic_e2e_health?token=${e2eToken}`", 1),
    ("env:{...process.env,COSMIC_E2E_PORT:String(e2ePort),COSMIC_E2E_TOKEN:e2eToken}", 1),
    ("reuseExistingServer:false", 1),
):
    if config.count(invariant) != count:
        fail(f"Derived Playwright shared-endpoint invariant drifted: {invariant}")
if old_port in config or old_token in config:
    fail("Unseeded randomized Playwright fallback survived E2E repair")
write(PLAYWRIGHT, config)


# Add a static safeguard so this race cannot silently return in a certified tree.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Stable audit insertion anchor drifted: {audit.count(audit_anchor)}")
label = "Playwright E2E shares one generated endpoint across runner and workers"
if label in audit:
    fail("E2E shared-endpoint safeguard unexpectedly already present")
port_seed = "process.env.COSMIC_E2E_PORT ||= String(randomInt(20000,60000))"
token_seed = "process.env.COSMIC_E2E_TOKEN ||= randomBytes(16).toString('hex')"
server_env = "env:{...process.env,COSMIC_E2E_PORT:String(e2ePort),COSMIC_E2E_TOKEN:e2eToken}"
e2e_check = (
    f'    ,["{label}", () => '
    + f's("playwright.config.js").includes({json.dumps(port_seed)})'
    + f' && s("playwright.config.js").includes({json.dumps(token_seed)})'
    + f' && s("playwright.config.js").includes({json.dumps(server_env)})'
    + ' && s("playwright.config.js").includes("reuseExistingServer:false")'
    + f' && !s("playwright.config.js").includes({json.dumps(old_port)})'
    + f' && !s("playwright.config.js").includes({json.dumps(old_token)})]\n'
)
audit = audit.replace(audit_anchor, e2e_check + audit_anchor, 1)
write(AUDIT, audit)


# The reviewed mutation that restores a fixed collision-prone E2E port originally
# targeted the pre-repair fallback expression. Preserve that regression test by
# retargeting the entire unique mutation entry to the shared-port expression.
mutations = read(MUTATIONS)
legacy_label = "restore fixed collision-prone E2E port"
legacy_start, legacy_end, legacy_entry, legacy_indent = top_level_entry(mutations, legacy_label)
if '"playwright.config.js"' not in legacy_entry:
    fail("Fixed-port mutation no longer targets playwright.config.js")
fixed_port_mutation = (
    f'{legacy_indent}["{legacy_label}", "playwright.config.js", '
    r'/const e2ePort=Number\(process\.env\.COSMIC_E2E_PORT \|\|= String\(randomInt\(20000,60000\)\)\);/, '
    '"const e2ePort=41731;"],\n'
)
mutations = mutations[:legacy_start] + fixed_port_mutation + mutations[legacy_end:]
if mutations.count(legacy_label) != 1:
    fail("Migrated fixed-port mutation missing or duplicated")
if mutations.count(r'process\.env\.COSMIC_E2E_PORT \|\|= String\(randomInt\(20000,60000\)\)') != 1:
    fail("Migrated fixed-port mutation does not target the shared E2E port seed")

# Deliberately mutate each inherited seed; both regressions must be caught by the
# static safeguard. These are certification-test mutations, not production code.
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")
mutation_labels = (
    "drop shared E2E port seed -> Playwright E2E shares one generated endpoint across runner and workers",
    "drop shared E2E token seed -> Playwright E2E shares one generated endpoint across runner and workers",
)
if any(label_text in mutations for label_text in mutation_labels):
    fail("E2E shared-endpoint mutation unexpectedly already present")
new_mutations = "\n".join([
    (
        '  ["drop shared E2E port seed -> Playwright E2E shares one generated endpoint across runner and workers", '
        '"playwright.config.js", '
        r'/process\.env\.COSMIC_E2E_PORT \|\|= String\(randomInt\(20000,60000\)\)/, '
        '"randomInt(20000,60000)"],'
    ),
    (
        '  ["drop shared E2E token seed -> Playwright E2E shares one generated endpoint across runner and workers", '
        '"playwright.config.js", '
        r'/process\.env\.COSMIC_E2E_TOKEN \|\|= randomBytes\(16\)\.toString\(\'hex\'\)/, '
        '"randomBytes(16).toString(\'hex\')"],'
    ),
])
mutations = mutations.replace(mutation_anchor, new_mutations + "\n" + mutation_anchor, 1)
write(MUTATIONS, mutations)

final_audit = read(AUDIT)
final_mutations = read(MUTATIONS)
if final_audit.count(f'"{label}"') != 1:
    fail("Final E2E shared-endpoint safeguard missing or duplicated")
for mutation_label in (legacy_label, *mutation_labels):
    if final_mutations.count(mutation_label) != 1:
        fail(f"Final E2E mutation missing or duplicated: {mutation_label}")

print("Playwright E2E endpoint repair PASS: random port/token are generated once, exported to the parent environment, and inherited by server/workers.")
print("Existing fixed-port mutation migrated to shared endpoint; E2E shared-endpoint static safeguard + two seed mutations installed.")
