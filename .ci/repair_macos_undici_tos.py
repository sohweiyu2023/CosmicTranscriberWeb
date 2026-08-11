from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
INTEGRATION = WORK / "tests" / "integration" / "worker.test.js"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"

MARKER = "// CTW_MACOS_UNDICI_DEFAULT_TOS_GUARD"
LABEL = "macOS integration skips only unsupported default Undici ToS marking and restores the test shim"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"macOS Undici ToS repair required file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"macOS Undici ToS repair expected UTF-8 file: {path}")
        raise


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def js_regex_exact(text: str) -> str:
    if "\n" in text or "\r" in text:
        fail("js_regex_exact only supports one-line targets")
    return "/" + re.sub(r"([\\^$.*+?()\[\]{}|/])", r"\\\1", text) + "/"


integration = read(INTEGRATION)
if MARKER in integration:
    fail("macOS Undici ToS repair marker unexpectedly already present")

adapter_anchor = "let ctwRestoreHarnessFetch=null;\n"
if integration.count(adapter_anchor) != 1:
    fail(f"Reviewed repaired integration adapter anchor drifted: {integration.count(adapter_anchor)}")

guard = r'''// CTW_MACOS_UNDICI_DEFAULT_TOS_GUARD
let ctwRestoreDarwinDefaultTos=null;
async function ctwInstallDarwinDefaultTosGuard(){
  if(process.platform!=='darwin')return ()=>{};
  const {Socket}=await import('node:net');
  const original=Socket.prototype.setTypeOfService;
  if(typeof original!=='function')return ()=>{};
  Socket.prototype.setTypeOfService=function(value,...rest){
    if(value===0)return this;
    return original.call(this,value,...rest);
  };
  return ()=>{Socket.prototype.setTypeOfService=original;};
}

'''
integration = integration.replace(adapter_anchor, guard + adapter_anchor, 1)

before_anchor = "beforeAll(async()=>{\n"
if integration.count(before_anchor) != 1:
    fail(f"Reviewed integration beforeAll anchor drifted: {integration.count(before_anchor)}")
integration = integration.replace(
    before_anchor,
    before_anchor + "  ctwRestoreDarwinDefaultTos=await ctwInstallDarwinDefaultTosGuard();\n",
    1,
)

network_close = re.search(r"(?m)^(?P<indent>\s*)network\.close\(\);\s*$", integration)
if network_close is None:
    fail("Reviewed integration network.close() cleanup anchor missing")
indent = network_close.group("indent")
cleanup = (
    network_close.group(0)
    + "\n"
    + f"{indent}ctwRestoreDarwinDefaultTos?.();\n"
    + f"{indent}ctwRestoreDarwinDefaultTos=null;"
)
integration = integration[: network_close.start()] + cleanup + integration[network_close.end() :]

for invariant, expected in (
    (MARKER, 1),
    ("if(process.platform!=='darwin')return ()=>{};", 1),
    ("const {Socket}=await import('node:net');", 1),
    ("if(value===0)return this;", 1),
    ("return original.call(this,value,...rest);", 1),
    ("ctwRestoreDarwinDefaultTos=await ctwInstallDarwinDefaultTosGuard();", 1),
    ("ctwRestoreDarwinDefaultTos?.();", 1),
    ("ctwRestoreDarwinDefaultTos=null;", 2),
):
    if integration.count(invariant) != expected:
        fail(f"macOS Undici ToS invariant drifted: {invariant} -> {integration.count(invariant)} (expected {expected})")
write(INTEGRATION, integration)

# Static safeguard: this is deliberately test-only, darwin-only and default-ToS-only.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Stable macOS Undici ToS audit insertion anchor drifted: {audit.count(audit_anchor)}")
if LABEL in audit:
    fail("macOS Undici ToS safeguard unexpectedly already present")
check = (
    f'    ,["{LABEL}", () => '
    's("tests/integration/worker.test.js").includes("// CTW_MACOS_UNDICI_DEFAULT_TOS_GUARD")'
    ' && s("tests/integration/worker.test.js").includes("if(process.platform!==\'darwin\')return ()=>{};")'
    ' && s("tests/integration/worker.test.js").includes("const {Socket}=await import(\'node:net\');")'
    ' && s("tests/integration/worker.test.js").includes("if(value===0)return this;")'
    ' && s("tests/integration/worker.test.js").includes("return original.call(this,value,...rest);")'
    ' && s("tests/integration/worker.test.js").includes("ctwRestoreDarwinDefaultTos=await ctwInstallDarwinDefaultTosGuard();")'
    ' && s("tests/integration/worker.test.js").includes("ctwRestoreDarwinDefaultTos?.();")'
    ' && (s("tests/integration/worker.test.js").match(/ctwRestoreDarwinDefaultTos=null;/g)||[]).length===2]\n'
)
audit = audit.replace(audit_anchor, check + audit_anchor, 1)
write(AUDIT, audit)

# Mutation coverage prevents broadening the shim or forgetting cleanup.
mutations = read(MUTATIONS)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable macOS Undici ToS mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")
mutation_specs = [
    (
        "make macOS Undici default-ToS test shim cross-platform -> macOS integration skips only unsupported default Undici ToS marking and restores the test shim",
        "tests/integration/worker.test.js",
        "if(process.platform!=='darwin')return ()=>{};",
        "if(false)return ()=>{};",
    ),
    (
        "make macOS Undici ToS test shim suppress every priority -> macOS integration skips only unsupported default Undici ToS marking and restores the test shim",
        "tests/integration/worker.test.js",
        "if(value===0)return this;",
        "return this;",
    ),
    (
        "remove macOS Undici ToS test shim restoration -> macOS integration skips only unsupported default Undici ToS marking and restores the test shim",
        "tests/integration/worker.test.js",
        "ctwRestoreDarwinDefaultTos?.();",
        "void ctwRestoreDarwinDefaultTos;",
    ),
]
for label, _, _, _ in mutation_specs:
    if label in mutations:
        fail(f"macOS Undici ToS mutation unexpectedly already present: {label}")
entries = [
    f'  [{json.dumps(label)}, {json.dumps(path)}, {js_regex_exact(target)}, {json.dumps(replacement)}],'
    for label, path, target, replacement in mutation_specs
]
mutations = mutations.replace(mutation_anchor, "\n".join(entries) + "\n" + mutation_anchor, 1)
write(MUTATIONS, mutations)

if read(AUDIT).count(f'"{LABEL}"') != 1:
    fail("Final macOS Undici ToS safeguard missing or duplicated")
for label, _, _, _ in mutation_specs:
    if read(MUTATIONS).count(label) != 1:
        fail(f"Final macOS Undici ToS mutation missing or duplicated: {label}")

print("macOS integration Undici ToS compatibility repair PASS: test harness skips only the default ToS=0 socket marking on Darwin and restores the native method after teardown.")
print("Production Worker code and non-default ToS behavior are unchanged; one static safeguard and three deliberate mutations installed.")
