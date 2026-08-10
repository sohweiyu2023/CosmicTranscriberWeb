from __future__ import annotations

import json
import os
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
PLAYWRIGHT = WORK / "playwright.config.js"
E2E_SPEC = WORK / "tests" / "e2e" / "app.spec.js"
MOCK_SERVER = WORK / "tests" / "e2e" / "mock-server.mjs"
APP = WORK / "public" / "js" / "app.js"
JS_DIR = APP.parent
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


def js_regex_exact(text: str) -> str:
    if "\n" in text or "\r" in text:
        fail("js_regex_exact only supports one-line targets")
    return "/" + re.sub(r"([\\^$.*+?()\[\]{}|/])", r"\\\1", text) + "/"


# ---------------------------------------------------------------------------
# 1. Playwright endpoint inheritance + production-like HTTPS + fail-fast CI.
# ---------------------------------------------------------------------------
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

old_origin = "const origin=`http://localhost:${e2ePort}`;"
new_origin = "const origin=`https://localhost:${e2ePort}`;"
if config.count(old_origin) != 1:
    fail(f"Reviewed Playwright origin drifted: expected 1 HTTP localhost origin; found {config.count(old_origin)}")
config = config.replace(old_origin, new_origin, 1)

old_runner = "testDir:'./tests/e2e',fullyParallel:false,workers:process.env.CI?1:undefined,retries:1,timeout:60000,expect:{timeout:10000},"
new_runner = "testDir:'./tests/e2e',fullyParallel:false,workers:process.env.CI?1:undefined,retries:process.env.CI?0:1,timeout:60000,expect:{timeout:10000},"
if config.count(old_runner) != 1:
    fail(f"Reviewed Playwright runner policy drifted: expected 1 exact occurrence; found {config.count(old_runner)}")
config = config.replace(old_runner, new_runner, 1)

old_use = "use:{baseURL:origin,trace:'retain-on-failure',screenshot:'only-on-failure'},"
new_use = "use:{baseURL:origin,ignoreHTTPSErrors:true,actionTimeout:15000,navigationTimeout:30000,trace:'retain-on-failure',screenshot:'only-on-failure'},"
if config.count(old_use) != 1:
    fail(f"Reviewed Playwright use policy drifted: expected 1 exact occurrence; found {config.count(old_use)}")
config = config.replace(old_use, new_use, 1)

old_webserver_tail = "reuseExistingServer:false,timeout:30000,stdout:'pipe',stderr:'pipe'"
new_webserver_tail = "reuseExistingServer:false,ignoreHTTPSErrors:true,timeout:30000,stdout:'pipe',stderr:'pipe'"
if config.count(old_webserver_tail) != 1:
    fail(f"Reviewed Playwright webServer policy drifted: expected 1 exact occurrence; found {config.count(old_webserver_tail)}")
config = config.replace(old_webserver_tail, new_webserver_tail, 1)

for invariant, count in (
    (new_port, 1),
    (new_token, 1),
    (new_origin, 1),
    ("url:`${origin}/__cosmic_e2e_health?token=${e2eToken}`", 1),
    ("env:{...process.env,COSMIC_E2E_PORT:String(e2ePort),COSMIC_E2E_TOKEN:e2eToken}", 1),
    ("reuseExistingServer:false", 1),
    ("ignoreHTTPSErrors:true", 2),
    ("retries:process.env.CI?0:1", 1),
    ("actionTimeout:15000", 1),
    ("navigationTimeout:30000", 1),
):
    if config.count(invariant) != count:
        fail(f"Derived Playwright invariant drifted: {invariant} -> {config.count(invariant)} (expected {count})")
if any(old in config for old in (old_port, old_token, old_origin, old_runner, old_use, old_webserver_tail)):
    fail("Old Playwright endpoint/HTTPS/retry/action policy survived E2E repair")
write(PLAYWRIGHT, config)


# ---------------------------------------------------------------------------
# 2. E2E mock server: keep the production Secure __Host cookie semantics by
# serving localhost over HTTPS. Generate an ephemeral one-day self-signed cert
# at runtime using OpenSSL present on all reviewed GitHub-hosted runner images;
# no key/cert is committed or uploaded.
# ---------------------------------------------------------------------------
mock = read(MOCK_SERVER)
old_http_import = "import http from 'node:http';"
new_imports = "\n".join([
    "import https from 'node:https';",
    "import {spawnSync} from 'node:child_process';",
    "import {mkdtempSync,readFileSync,rmSync} from 'node:fs';",
    "import {tmpdir} from 'node:os';",
])
if mock.count(old_http_import) != 1:
    fail(f"Reviewed E2E mock HTTP import drifted: {mock.count(old_http_import)}")
mock = mock.replace(old_http_import, new_imports, 1)

old_mock_origin = "const ORIGIN=`http://localhost:${PORT}`;"
new_mock_origin = "const ORIGIN=`https://localhost:${PORT}`;"
if mock.count(old_mock_origin) != 1:
    fail(f"Reviewed E2E mock origin drifted: {mock.count(old_mock_origin)}")
mock = mock.replace(old_mock_origin, new_mock_origin, 1)

old_server = "const server=http.createServer(async(req,res)=>{"
tls_block = r'''const tlsDir=mkdtempSync(path.join(tmpdir(),'cosmic-e2e-tls-'));
const tlsKeyPath=path.join(tlsDir,'key.pem');
const tlsCertPath=path.join(tlsDir,'cert.pem');
const openssl=spawnSync('openssl',[
  'req','-x509','-newkey','rsa:2048','-sha256','-nodes',
  '-keyout',tlsKeyPath,'-out',tlsCertPath,'-days','1',
  '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'
],{stdio:'pipe',windowsHide:true});
if(openssl.error||openssl.status!==0){
  rmSync(tlsDir,{recursive:true,force:true});
  throw new Error('Unable to generate ephemeral localhost TLS certificate for E2E.');
}
const tlsOptions={key:readFileSync(tlsKeyPath),cert:readFileSync(tlsCertPath)};
rmSync(tlsDir,{recursive:true,force:true});
const server=https.createServer(tlsOptions,async(req,res)=>{'''
if mock.count(old_server) != 1:
    fail(f"Reviewed E2E mock server constructor drifted: {mock.count(old_server)}")
mock = mock.replace(old_server, tls_block, 1)

for invariant, expected in (
    ("import https from 'node:https';", 1),
    ("spawnSync('openssl',[", 1),
    ("subjectAltName=DNS:localhost,IP:127.0.0.1", 1),
    (new_mock_origin, 1),
    ("https.createServer(tlsOptions,async(req,res)=>{", 1),
    ("HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600", 1),
):
    if mock.count(invariant) != expected:
        fail(f"Derived HTTPS E2E mock invariant drifted: {invariant} -> {mock.count(invariant)} (expected {expected})")
if "http.createServer" in mock or old_mock_origin in mock:
    fail("Plain-HTTP E2E mock server survived HTTPS repair")
write(MOCK_SERVER, mock)


# ---------------------------------------------------------------------------
# 3. Browser app repair: bind checkpointResultReusable used by queue prep.
# ---------------------------------------------------------------------------
app = read(APP)
if not re.search(r"\bcheckpointResultReusable\s*\(", app):
    fail("Browser app no longer calls checkpointResultReusable; reviewed failure shape drifted")
if re.search(r"(?m)^\s*(?:import\b[^\n]*\bcheckpointResultReusable\b|(?:export\s+)?(?:async\s+)?function\s+checkpointResultReusable\b|(?:export\s+)?(?:const|let|var)\s+checkpointResultReusable\b)", app):
    fail("Browser app unexpectedly already binds checkpointResultReusable before certification repair")

definition = re.compile(r"(?m)^\s*(?:export\s+)?(?:(?:async\s+)?function|const|let|var)\s+checkpointResultReusable\b")
exported = re.compile(r"(?:\bexport\s+(?:(?:async\s+)?function|const|let|var)\s+checkpointResultReusable\b|\bexport\s*\{[^}]*\bcheckpointResultReusable\b[^}]*\})", re.S)
exporters: list[pathlib.Path] = []
for candidate in sorted(JS_DIR.rglob("*.js")):
    if candidate == APP:
        continue
    text = read(candidate)
    if definition.search(text) and exported.search(text):
        exporters.append(candidate)
if len(exporters) != 1:
    mentions = []
    for candidate in sorted(JS_DIR.rglob("*.js")):
        if candidate != APP and "checkpointResultReusable" in read(candidate):
            mentions.append(candidate.relative_to(WORK).as_posix())
    fail(f"Expected exactly one exported checkpointResultReusable implementation; found {len(exporters)}. Mentioning files: {mentions[:8]}")
exporter = exporters[0]
rel = pathlib.PurePosixPath(os.path.relpath(exporter, APP.parent)).as_posix()
if not rel.startswith("."):
    rel = "./" + rel
checkpoint_import = f'import {{checkpointResultReusable}} from {json.dumps(rel)}; // CTW_CHECKPOINT_REUSE_BINDING'
if checkpoint_import in app or "CTW_CHECKPOINT_REUSE_BINDING" in app:
    fail("Checkpoint reuse binding marker unexpectedly already present")
imports = list(re.finditer(r"(?ms)^import\b.*?;[ \t]*(?:\r?\n|$)", app))
if not imports:
    fail("Could not locate browser app import block for checkpoint reuse binding")
insert_at = imports[-1].end()
app = app[:insert_at] + checkpoint_import + "\n" + app[insert_at:]
if app.count(checkpoint_import) != 1:
    fail("Checkpoint reuse binding was not inserted exactly once")


# ---------------------------------------------------------------------------
# 4. Browser app repair: constrain every programmatic prompt assignment through
# the textarea's native value setter. Hosted cross-engine evidence proved that
# app startup can restore saved preferences before an end-of-module guard is
# reached (for example across top-level-await initialization). Install this
# guard immediately after the complete import block and checkpoint import, before
# any original application startup statement can execute. The declared textarea
# maxLength plus surrogate-pair boundary is then enforced on every later direct
# programmatic value assignment, including saved-preference restoration.
# ---------------------------------------------------------------------------
prompt_marker = "// CTW_RESTORED_PROMPT_BOUND"
if prompt_marker in app:
    fail("Restored-prompt bound marker unexpectedly already present")
prompt_repair = r'''// CTW_RESTORED_PROMPT_BOUND
{
  const ctwPromptInput = document.getElementById("promptInput");
  if (ctwPromptInput) {
    let ctwOwner = ctwPromptInput;
    let ctwValueDescriptor = null;
    while (ctwOwner && !ctwValueDescriptor) {
      ctwValueDescriptor = Object.getOwnPropertyDescriptor(ctwOwner, "value") || null;
      ctwOwner = Object.getPrototypeOf(ctwOwner);
    }
    if (ctwValueDescriptor?.get && ctwValueDescriptor?.set) {
      const ctwGet = ctwValueDescriptor.get;
      const ctwSet = ctwValueDescriptor.set;
      Object.defineProperty(ctwPromptInput, "value", {
        configurable: true,
        enumerable: ctwValueDescriptor.enumerable ?? true,
        get() { return ctwGet.call(this); },
        set(value) {
          const raw = String(value ?? "");
          const max = Number.isInteger(this.maxLength) && this.maxLength > 0 ? this.maxLength : 12000;
          let bounded = raw.length > max ? raw.slice(0, max) : raw;
          if (bounded.length && raw.length > bounded.length) {
            const last = bounded.charCodeAt(bounded.length - 1);
            if (last >= 0xD800 && last <= 0xDBFF) bounded = bounded.slice(0, -1);
          }
          ctwSet.call(this, bounded);
        }
      });
      ctwPromptInput.value = ctwPromptInput.value;
    }
  }
}'''
startup_insert_at = insert_at + len(checkpoint_import) + 1
app = app[:startup_insert_at] + prompt_repair + "\n" + app[startup_insert_at:]
prompt_prefix = checkpoint_import + "\n" + prompt_marker
for invariant, expected in (
    (prompt_marker, 1),
    (prompt_prefix, 1),
    ('document.getElementById("promptInput")', 1),
    ('Object.defineProperty(ctwPromptInput, "value"', 1),
    ("this.maxLength", 3),
    ("ctwSet.call(this, bounded);", 1),
    ("last >= 0xD800 && last <= 0xDBFF", 1),
    ("ctwPromptInput.value = ctwPromptInput.value;", 1),
):
    if app.count(invariant) != expected:
        fail(f"Restored-prompt derived invariant drifted: {invariant} -> {app.count(invariant)} (expected {expected})")
if app.index(prompt_marker) != app.index(checkpoint_import) + len(checkpoint_import) + 1:
    fail("Restored-prompt guard is not immediately after imports/checkpoint binding and before original app startup")
write(APP, app)


# ---------------------------------------------------------------------------
# 5. E2E correctness: natural-sort assertion waits for async file preparation.
# ---------------------------------------------------------------------------
spec = read(E2E_SPEC)
queue_anchor = "  await expect(page.locator('#queueList li')).toHaveCount(2,{timeout:30000});\n  const names=await page.locator('#queueList li strong').allTextContents();"
ready_line = "  await expect(page.locator('#queueList .mini-state')).toHaveText(['Ready','Ready'],{timeout:30000});"
if spec.count(queue_anchor) != 1:
    fail(f"Natural-sort E2E assertion anchor drifted: {spec.count(queue_anchor)}")
if ready_line in spec:
    fail("Natural-sort readiness assertion unexpectedly already present")
spec = spec.replace(queue_anchor, "  await expect(page.locator('#queueList li')).toHaveCount(2,{timeout:30000});\n" + ready_line + "\n  const names=await page.locator('#queueList li strong').allTextContents();", 1)
if spec.count(ready_line) != 1:
    fail("Natural-sort readiness assertion missing or duplicated after repair")
write(E2E_SPEC, spec)


# ---------------------------------------------------------------------------
# 6. Static safeguards for all browser/E2E repairs.
# ---------------------------------------------------------------------------
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Stable audit insertion anchor drifted: {audit.count(audit_anchor)}")

shared_label = "Playwright E2E shares one generated endpoint across runner and workers"
https_label = "E2E preserves Secure BYOK cookie over ephemeral localhost HTTPS"
checkpoint_label = "browser queue preparation binds checkpoint result reuse helper"
prompt_label = "restored prompt respects textarea maxLength with surrogate-safe truncation"
sort_label = "E2E natural sort waits for prepared queue state"
failfast_label = "Playwright CI fails fast without retry masking and bounds browser actions"
labels = (shared_label, https_label, checkpoint_label, prompt_label, sort_label, failfast_label)
for label in labels:
    if label in audit:
        fail(f"Browser/E2E safeguard unexpectedly already present: {label}")

port_seed = "process.env.COSMIC_E2E_PORT ||= String(randomInt(20000,60000))"
token_seed = "process.env.COSMIC_E2E_TOKEN ||= randomBytes(16).toString('hex')"
server_env = "env:{...process.env,COSMIC_E2E_PORT:String(e2ePort),COSMIC_E2E_TOKEN:e2eToken}"
prompt_marker_offset = len(checkpoint_import) + 1
checks = [
    (
        shared_label,
        f's("playwright.config.js").includes({json.dumps(port_seed)})'
        + f' && s("playwright.config.js").includes({json.dumps(token_seed)})'
        + f' && s("playwright.config.js").includes({json.dumps(server_env)})'
        + ' && s("playwright.config.js").includes("reuseExistingServer:false")'
        + f' && !s("playwright.config.js").includes({json.dumps(old_port)})'
        + f' && !s("playwright.config.js").includes({json.dumps(old_token)})',
    ),
    (
        https_label,
        f's("playwright.config.js").includes({json.dumps(new_origin)})'
        + ' && (s("playwright.config.js").match(/ignoreHTTPSErrors:true/g)||[]).length===2'
        + f' && s("tests/e2e/mock-server.mjs").includes({json.dumps(new_mock_origin)})'
        + ' && s("tests/e2e/mock-server.mjs").includes("spawnSync(\'openssl\',[\")'
        + ' && s("tests/e2e/mock-server.mjs").includes("subjectAltName=DNS:localhost,IP:127.0.0.1")'
        + ' && s("tests/e2e/mock-server.mjs").includes("https.createServer(tlsOptions,async(req,res)=>{")'
        + ' && s("tests/e2e/mock-server.mjs").includes("HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600")'
        + ' && !s("tests/e2e/mock-server.mjs").includes("http.createServer")',
    ),
    (
        checkpoint_label,
        f's("public/js/app.js").includes({json.dumps(checkpoint_import)})'
        + ' && s("public/js/app.js").includes("checkpointResultReusable(")',
    ),
    (
        prompt_label,
        's("public/js/app.js").includes("// CTW_RESTORED_PROMPT_BOUND")'
        + ' && s("public/js/app.js").includes("Object.defineProperty(ctwPromptInput, \\\"value\\\"")'
        + ' && s("public/js/app.js").includes("this.maxLength")'
        + ' && s("public/js/app.js").includes("ctwSet.call(this, bounded);")'
        + ' && s("public/js/app.js").includes("last >= 0xD800 && last <= 0xDBFF")'
        + f' && s("public/js/app.js").indexOf({json.dumps(prompt_marker)})===s("public/js/app.js").indexOf({json.dumps(checkpoint_import)})+{prompt_marker_offset}',
    ),
    (
        sort_label,
        f's("tests/e2e/app.spec.js").includes({json.dumps(ready_line.strip())})',
    ),
    (
        failfast_label,
        's("playwright.config.js").includes("retries:process.env.CI?0:1")'
        + ' && s("playwright.config.js").includes("actionTimeout:15000")'
        + ' && s("playwright.config.js").includes("navigationTimeout:30000")',
    ),
]
check_lines = [f'    ,["{label}", () => {expr}]' for label, expr in checks]
audit = audit.replace(audit_anchor, "\n".join(check_lines) + "\n" + audit_anchor, 1)
write(AUDIT, audit)


# ---------------------------------------------------------------------------
# 7. Preserve the old fixed-port mutation and add deliberate mutations for each
# new browser/E2E contract.
# ---------------------------------------------------------------------------
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

mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")

mutation_specs = [
    ("drop shared E2E port seed -> Playwright E2E shares one generated endpoint across runner and workers", "playwright.config.js", "process.env.COSMIC_E2E_PORT ||= String(randomInt(20000,60000))", "randomInt(20000,60000)"),
    ("drop shared E2E token seed -> Playwright E2E shares one generated endpoint across runner and workers", "playwright.config.js", "process.env.COSMIC_E2E_TOKEN ||= randomBytes(16).toString('hex')", "randomBytes(16).toString('hex')"),
    ("downgrade E2E browser origin to HTTP -> E2E preserves Secure BYOK cookie over ephemeral localhost HTTPS", "playwright.config.js", new_origin, old_origin),
    ("remove E2E TLS server -> E2E preserves Secure BYOK cookie over ephemeral localhost HTTPS", "tests/e2e/mock-server.mjs", "https.createServer(tlsOptions,async(req,res)=>{", "https.createServer({},async(req,res)=>{"),
    ("remove checkpoint result reuse import -> browser queue preparation binds checkpoint result reuse helper", "public/js/app.js", checkpoint_import, ""),
    ("bypass restored prompt bound -> restored prompt respects textarea maxLength with surrogate-safe truncation", "public/js/app.js", "ctwSet.call(this, bounded);", "ctwSet.call(this, raw);"),
    ("assert natural sort before preparation -> E2E natural sort waits for prepared queue state", "tests/e2e/app.spec.js", ready_line.strip(), "void 0;"),
    ("restore CI E2E retries -> Playwright CI fails fast without retry masking and bounds browser actions", "playwright.config.js", "retries:process.env.CI?0:1", "retries:1"),
]
for label, _, _, _ in mutation_specs:
    if label in mutations:
        fail(f"Browser/E2E mutation unexpectedly already present: {label}")
entries = [f'  [{json.dumps(label)}, {json.dumps(path)}, {js_regex_exact(target)}, {json.dumps(replacement)}],' for label, path, target, replacement in mutation_specs]
mutations = mutations.replace(mutation_anchor, "\n".join(entries) + "\n" + mutation_anchor, 1)
write(MUTATIONS, mutations)


# Final fail-closed invariants.
final_audit = read(AUDIT)
final_mutations = read(MUTATIONS)
for label in labels:
    if final_audit.count(f'"{label}"') != 1:
        fail(f"Final browser/E2E safeguard missing or duplicated: {label}")
for mutation_label in (legacy_label, *(x[0] for x in mutation_specs)):
    if final_mutations.count(mutation_label) != 1:
        fail(f"Final E2E mutation missing or duplicated: {mutation_label}")
for path in (APP, E2E_SPEC, MOCK_SERVER, PLAYWRIGHT):
    if "CTW_DIAGNOSTIC_ONLY" in read(path):
        fail(f"Diagnostic-only marker survived browser repair: {path}")

print("Playwright E2E endpoint repair PASS: random port/token are generated once and inherited by server/workers.")
print("E2E HTTPS repair PASS: ephemeral localhost TLS preserves production Secure __Host cookie semantics across browsers; Playwright accepts only the test certificate error.")
print("Playwright CI fail-fast repair PASS: no CI retries; browser actions/navigation have bounded waits while test assertions retain explicit long-operation timeouts.")
print(f"Browser checkpoint reuse binding PASS: checkpointResultReusable imported from {rel}.")
print("Restored prompt bound PASS: prompt setter guard is installed before original app startup and clamps every programmatic assignment to maxLength without splitting a trailing high surrogate.")
print("Natural-sort E2E synchronization PASS: ordering is asserted only after both files reach Ready.")
print("Browser/E2E static safeguards and deliberate mutations installed; existing fixed-port mutation preserved.")