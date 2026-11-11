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


# 1. Shared randomized E2E endpoint, localhost TLS, and fail-fast browser policy.
config = read(PLAYWRIGHT)
old_port = "const e2ePort=Number(process.env.COSMIC_E2E_PORT)||randomInt(20000,60000);"
new_port = "const e2ePort=Number(process.env.COSMIC_E2E_PORT ||= String(randomInt(20000,60000)));"
old_token = "const e2eToken=process.env.COSMIC_E2E_TOKEN||randomBytes(16).toString('hex');"
new_token = "const e2eToken=process.env.COSMIC_E2E_TOKEN ||= randomBytes(16).toString('hex');"
old_origin = "const origin=`http://localhost:${e2ePort}`;"
new_origin = "const origin=`https://localhost:${e2ePort}`;"
old_runner = "testDir:'./tests/e2e',fullyParallel:false,workers:process.env.CI?1:undefined,retries:1,timeout:60000,expect:{timeout:10000},"
new_runner = "testDir:'./tests/e2e',fullyParallel:false,workers:process.env.CI?1:undefined,retries:process.env.CI?0:1,timeout:60000,expect:{timeout:10000},"
old_use = "use:{baseURL:origin,trace:'retain-on-failure',screenshot:'only-on-failure'},"
new_use = "use:{baseURL:origin,ignoreHTTPSErrors:true,actionTimeout:15000,navigationTimeout:30000,trace:'retain-on-failure',screenshot:'only-on-failure'},"
old_webserver_tail = "reuseExistingServer:false,timeout:30000,stdout:'pipe',stderr:'pipe'"
new_webserver_tail = "reuseExistingServer:false,ignoreHTTPSErrors:true,timeout:30000,stdout:'pipe',stderr:'pipe'"
for label, old in (
    ("port", old_port), ("token", old_token), ("origin", old_origin),
    ("runner", old_runner), ("use", old_use), ("webServer", old_webserver_tail),
):
    if config.count(old) != 1:
        fail(f"Reviewed Playwright {label} anchor drifted: {config.count(old)}")
for old, new in (
    (old_port, new_port), (old_token, new_token), (old_origin, new_origin),
    (old_runner, new_runner), (old_use, new_use), (old_webserver_tail, new_webserver_tail),
):
    config = config.replace(old, new, 1)
for invariant, expected in (
    (new_port, 1), (new_token, 1), (new_origin, 1),
    ("url:`${origin}/__cosmic_e2e_health?token=${e2eToken}`", 1),
    ("env:{...process.env,COSMIC_E2E_PORT:String(e2ePort),COSMIC_E2E_TOKEN:e2eToken}", 1),
    ("reuseExistingServer:false", 1), ("ignoreHTTPSErrors:true", 2),
    ("retries:process.env.CI?0:1", 1), ("actionTimeout:15000", 1),
    ("navigationTimeout:30000", 1),
):
    if config.count(invariant) != expected:
        fail(f"Derived Playwright invariant drifted: {invariant} -> {config.count(invariant)} (expected {expected})")
write(PLAYWRIGHT, config)


# 2. E2E mock server uses TLS so production Secure __Host cookie semantics are tested.
mock = read(MOCK_SERVER)
old_http_import = "import http from 'node:http';"
new_imports = "\n".join([
    "import https from 'node:https';",
    "import {spawnSync} from 'node:child_process';",
    "import {mkdtempSync,readFileSync,rmSync} from 'node:fs';",
    "import {tmpdir} from 'node:os';",
])
old_mock_origin = "const ORIGIN=`http://localhost:${PORT}`;"
new_mock_origin = "const ORIGIN=`https://localhost:${PORT}`;"
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
for label, old in (("HTTP import", old_http_import), ("origin", old_mock_origin), ("server", old_server)):
    if mock.count(old) != 1:
        fail(f"Reviewed E2E mock {label} drifted: {mock.count(old)}")
mock = mock.replace(old_http_import, new_imports, 1)
mock = mock.replace(old_mock_origin, new_mock_origin, 1)
mock = mock.replace(old_server, tls_block, 1)
root_anchor = "const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..','dist','public');"
build_probe = "\nconst ctwBuiltApp=await readFile(path.join(root,'js','app.js'),'utf8');\nif(!ctwBuiltApp.includes('// CTW_RESTORED_PROMPT_BOUND'))throw new Error('Built E2E app is missing the reviewed restored-prompt repair.');\nif(!ctwBuiltApp.includes('// CTW_RESTORED_KEYWORD_SEMANTICS'))throw new Error('Built E2E app is missing the reviewed restored-keyword semantic repair.');"
if mock.count(root_anchor) != 1:
    fail(f"Reviewed E2E static-root anchor drifted: {mock.count(root_anchor)}")
mock = mock.replace(root_anchor, root_anchor + build_probe, 1)
for invariant, expected in (
    ("import https from 'node:https';", 1), ("spawnSync('openssl',[", 1),
    ("subjectAltName=DNS:localhost,IP:127.0.0.1", 1), (new_mock_origin, 1),
    ("https.createServer(tlsOptions,async(req,res)=>{", 1),
    ("HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600", 1),
    ("Built E2E app is missing the reviewed restored-prompt repair.", 1),
    ("Built E2E app is missing the reviewed restored-keyword semantic repair.", 1),
):
    if mock.count(invariant) != expected:
        fail(f"Derived HTTPS E2E mock invariant drifted: {invariant} -> {mock.count(invariant)}")
if "http.createServer" in mock or old_mock_origin in mock:
    fail("Plain-HTTP E2E mock server survived HTTPS repair")
write(MOCK_SERVER, mock)


# 3. Bind checkpointResultReusable used by queue preparation.
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
    fail(f"Expected exactly one exported checkpointResultReusable implementation; found {len(exporters)}")
exporter = exporters[0]
rel = pathlib.PurePosixPath(os.path.relpath(exporter, APP.parent)).as_posix()
if not rel.startswith("."):
    rel = "./" + rel
checkpoint_import = f'import {{checkpointResultReusable}} from {json.dumps(rel)}; // CTW_CHECKPOINT_REUSE_BINDING'
imports = list(re.finditer(r"(?ms)^import\b.*?;[ \t]*(?:\r?\n|$)", app))
if not imports:
    fail("Could not locate browser app import block for checkpoint reuse binding")
insert_at = imports[-1].end()
app = app[:insert_at] + checkpoint_import + "\n" + app[insert_at:]
if app.count(checkpoint_import) != 1:
    fail("Checkpoint reuse binding was not inserted exactly once")


# 4. Bound persisted prompt/keyword text before normal startup reads it.
prompt_marker = "// CTW_RESTORED_PROMPT_BOUND"
keyword_marker = "// CTW_RESTORED_KEYWORD_SEMANTICS"
preference_key = "cosmic-transcriber-web-preferences-v1"
preference_decl = f'const ctwPreferencesKey = "{preference_key}";'
if prompt_marker in app or keyword_marker in app:
    fail("Restored preference repair marker unexpectedly already present")
if read(E2E_SPEC).count(preference_key) != 1:
    fail("Malformed-preferences E2E storage key drifted; refusing mismatched persistence repair")
# The production parser must remain present: the semantic repair delegates to the
# app's own keyword contract instead of duplicating a potentially drifting rule.
keyword_defs = re.findall(r"(?m)^(?:function\s+keywordList\s*\(|(?:const|let|var)\s+keywordList\s*=)", app)
if len(keyword_defs) != 1:
    fail(f"Expected exactly one top-level keywordList parser before semantic repair; found {len(keyword_defs)}")
prompt_repair = r'''// CTW_RESTORED_PROMPT_BOUND
{
  const ctwPreferencesKey = "cosmic-transcriber-web-preferences-v1";
  const ctwClampPreferenceText = (element, value, fallbackMax) => {
    const raw = typeof value === "string" ? value : "";
    const max = Number.isInteger(element?.maxLength) && element.maxLength > 0 ? element.maxLength : fallbackMax;
    let bounded = raw.length > max ? raw.slice(0, max) : raw;
    if (bounded.length && raw.length > bounded.length) {
      const last = bounded.charCodeAt(bounded.length - 1);
      if (last >= 0xD800 && last <= 0xDBFF) bounded = bounded.slice(0, -1);
    }
    return bounded;
  };
  const ctwPromptInput = document.getElementById("promptInput");
  const ctwKeywordsInput = document.getElementById("keywordsInput");
  try {
    const ctwSavedRaw = localStorage.getItem(ctwPreferencesKey);
    if (ctwSavedRaw !== null) {
      const ctwParsed = JSON.parse(ctwSavedRaw);
      if (ctwParsed && typeof ctwParsed === "object" && !Array.isArray(ctwParsed)) {
        let ctwChanged = false;
        if (typeof ctwParsed.prompt === "string") {
          const ctwPromptBounded = ctwClampPreferenceText(ctwPromptInput, ctwParsed.prompt, 12000);
          if (ctwPromptBounded !== ctwParsed.prompt) {
            ctwParsed.prompt = ctwPromptBounded;
            ctwChanged = true;
          }
        }
        if (typeof ctwParsed.keywords === "string") {
          const ctwKeywordsBounded = ctwClampPreferenceText(ctwKeywordsInput, ctwParsed.keywords, 8000);
          if (ctwKeywordsBounded !== ctwParsed.keywords) {
            ctwParsed.keywords = ctwKeywordsBounded;
            ctwChanged = true;
          }
        }
        if (ctwChanged) localStorage.setItem(ctwPreferencesKey, JSON.stringify(ctwParsed));
      }
    }
  } catch {}
  if (ctwPromptInput) ctwPromptInput.value = ctwClampPreferenceText(ctwPromptInput, ctwPromptInput.value, 12000);
  if (ctwKeywordsInput) ctwKeywordsInput.value = ctwClampPreferenceText(ctwKeywordsInput, ctwKeywordsInput.value, 8000);
}'''
startup_insert_at = insert_at + len(checkpoint_import) + 1
app = app[:startup_insert_at] + prompt_repair + "\n" + app[startup_insert_at:]

# A total maxLength is not the semantic keyword contract. Hosted Chromium,
# Firefox, WebKit, Chrome, and Edge all proved that a persisted 9000-character
# single keyword was truncated to 8000 yet still rejected by keywordList(),
# causing diagnosticsText()->readSettings() to throw before a diagnostics
# download could be created. Run the real production keyword parser after app
# startup and fail-soft only that malformed persisted field to the safe default.
keyword_repair = r'''// CTW_RESTORED_KEYWORD_SEMANTICS
{
  const ctwSemanticPreferenceKey = "cosmic-transcriber-web-preferences-v1";
  const ctwRepairSemanticKeywords = () => {
    const ctwSemanticKeywordsInput = document.getElementById("keywordsInput");
    if (!ctwSemanticKeywordsInput) return;
    const ctwKeywordCandidate = ctwSemanticKeywordsInput.value;
    let ctwKeywordSafe = ctwKeywordCandidate;
    try {
      keywordList(ctwKeywordCandidate);
    } catch {
      ctwKeywordSafe = "";
    }
    if (ctwKeywordSafe === ctwKeywordCandidate) return;
    ctwSemanticKeywordsInput.value = ctwKeywordSafe;
    try {
      const ctwSemanticRaw = localStorage.getItem(ctwSemanticPreferenceKey);
      if (ctwSemanticRaw === null) return;
      const ctwSemanticParsed = JSON.parse(ctwSemanticRaw);
      if (!ctwSemanticParsed || typeof ctwSemanticParsed !== "object" || Array.isArray(ctwSemanticParsed)) return;
      if (typeof ctwSemanticParsed.keywords !== "string" || ctwSemanticParsed.keywords === ctwKeywordSafe) return;
      ctwSemanticParsed.keywords = ctwKeywordSafe;
      localStorage.setItem(ctwSemanticPreferenceKey, JSON.stringify(ctwSemanticParsed));
    } catch {}
  };
  if (document.readyState === "complete") ctwRepairSemanticKeywords();
  else window.addEventListener("load", ctwRepairSemanticKeywords, { once: true });
}'''
app = app.rstrip() + "\n" + keyword_repair + "\n"
prompt_prefix = checkpoint_import + "\n" + prompt_marker
for invariant, expected in (
    (prompt_marker, 1), (keyword_marker, 1), (prompt_prefix, 1), (preference_decl, 1),
    ('localStorage.getItem(ctwPreferencesKey)', 1),
    ('localStorage.setItem(ctwPreferencesKey, JSON.stringify(ctwParsed))', 1),
    ('ctwParsed.prompt = ctwPromptBounded;', 1), ('ctwParsed.keywords = ctwKeywordsBounded;', 1),
    ('ctwClampPreferenceText(ctwPromptInput, ctwParsed.prompt, 12000)', 1),
    ('ctwClampPreferenceText(ctwKeywordsInput, ctwParsed.keywords, 8000)', 1),
    ('last >= 0xD800 && last <= 0xDBFF', 1),
    ('keywordList(ctwKeywordCandidate);', 1), ('ctwKeywordSafe = "";', 1),
    ('window.addEventListener("load", ctwRepairSemanticKeywords, { once: true });', 1),
    ('ctwSemanticParsed.keywords = ctwKeywordSafe;', 1),
):
    if app.count(invariant) != expected:
        fail(f"Restored-preference derived invariant drifted: {invariant} -> {app.count(invariant)} (expected {expected})")
if app.index(prompt_marker) != app.index(checkpoint_import) + len(checkpoint_import) + 1:
    fail("Restored-prompt persistence guard is not immediately after imports/checkpoint binding")
if app.rfind(keyword_marker) <= app.index(prompt_marker):
    fail("Restored-keyword semantic guard was not installed after normal app startup source")
write(APP, app)


# 5. E2E: direct preference recovery proof + natural-sort synchronization.
spec = read(E2E_SPEC)
old_prompt_assertion = "  await expect(page.locator('#promptInput')).toHaveJSProperty('value',expect.stringMatching(/^.{0,12000}$/s));"
prompt_assertion_block = "\n".join([
    "  const restoredPrompt=await page.locator('#promptInput').inputValue();",
    "  const restoredKeywords=await page.locator('#keywordsInput').inputValue();",
    "  expect(restoredPrompt.length).toBe(12000);",
    "  expect(restoredKeywords).toBe('');",
    "  expect(/[\\uD800-\\uDBFF]$/.test(restoredPrompt)).toBe(false);",
])
if spec.count(old_prompt_assertion) != 1:
    fail(f"Malformed-preferences prompt assertion drifted: {spec.count(old_prompt_assertion)}")
spec = spec.replace(old_prompt_assertion, prompt_assertion_block, 1)
if old_prompt_assertion in spec or spec.count(prompt_assertion_block) != 1:
    fail("Direct restored-preference semantic assertion was not installed exactly once")
# Preserve the existing diagnostics download/privacy proof; this is the exact
# regression that failed when malformed restored keywords escaped startup.
for invariant in (
    "const downloadPromise=page.waitForEvent('download');",
    "await page.locator('#diagnosticsBtn').click();",
    "expect(diagnostic).not.toContain('private-person-name.mp3');",
):
    if spec.count(invariant) != 1:
        fail(f"Malformed-preferences diagnostics proof drifted: {invariant} -> {spec.count(invariant)}")
queue_anchor = "  await expect(page.locator('#queueList li')).toHaveCount(2,{timeout:30000});\n  const names=await page.locator('#queueList li strong').allTextContents();"
ready_line = "  await expect(page.locator('#queueList .mini-state')).toHaveText(['Ready','Ready'],{timeout:30000});"
if spec.count(queue_anchor) != 1 or ready_line in spec:
    fail("Natural-sort E2E assertion anchor drifted")
spec = spec.replace(queue_anchor, "  await expect(page.locator('#queueList li')).toHaveCount(2,{timeout:30000});\n" + ready_line + "\n  const names=await page.locator('#queueList li strong').allTextContents();", 1)
write(E2E_SPEC, spec)


# 6. Static safeguards for every browser/E2E repair.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Stable audit insertion anchor drifted: {audit.count(audit_anchor)}")
shared_label = "Playwright E2E shares one generated endpoint across runner and workers"
https_label = "E2E preserves Secure BYOK cookie over ephemeral localhost HTTPS"
checkpoint_label = "browser queue preparation binds checkpoint result reuse helper"
prompt_label = "restored prompt respects textarea maxLength with surrogate-safe truncation"
keyword_label = "restored invalid keywords are reset before diagnostics and paid settings reads"
prompt_assertion_label = "E2E directly verifies restored prompt and keyword bounds"
sort_label = "E2E natural sort waits for prepared queue state"
failfast_label = "Playwright CI fails fast without retry masking and bounds browser actions"
labels = (shared_label, https_label, checkpoint_label, prompt_label, keyword_label, prompt_assertion_label, sort_label, failfast_label)
for label in labels:
    if label in audit:
        fail(f"Browser/E2E safeguard unexpectedly already present: {label}")
port_seed = "process.env.COSMIC_E2E_PORT ||= String(randomInt(20000,60000))"
token_seed = "process.env.COSMIC_E2E_TOKEN ||= randomBytes(16).toString('hex')"
server_env = "env:{...process.env,COSMIC_E2E_PORT:String(e2ePort),COSMIC_E2E_TOKEN:e2eToken}"
prompt_marker_offset = len(checkpoint_import) + 1
checks = [
    (shared_label,
     f's("playwright.config.js").includes({json.dumps(port_seed)})'
     + f' && s("playwright.config.js").includes({json.dumps(token_seed)})'
     + f' && s("playwright.config.js").includes({json.dumps(server_env)})'
     + ' && s("playwright.config.js").includes("reuseExistingServer:false")'),
    (https_label,
     f's("playwright.config.js").includes({json.dumps(new_origin)})'
     + ' && (s("playwright.config.js").match(/ignoreHTTPSErrors:true/g)||[]).length===2'
     + f' && s("tests/e2e/mock-server.mjs").includes({json.dumps(new_mock_origin)})'
     + ' && s("tests/e2e/mock-server.mjs").includes("https.createServer(tlsOptions,async(req,res)=>{")'
     + ' && s("tests/e2e/mock-server.mjs").includes("HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600")'
     + ' && !s("tests/e2e/mock-server.mjs").includes("http.createServer")'),
    (checkpoint_label,
     f's("public/js/app.js").includes({json.dumps(checkpoint_import)})'
     + ' && s("public/js/app.js").includes("checkpointResultReusable(")'),
    (prompt_label,
     's("public/js/app.js").includes("// CTW_RESTORED_PROMPT_BOUND")'
     + f' && s("public/js/app.js").includes({json.dumps(preference_decl)})'
     + ' && s("public/js/app.js").includes("ctwParsed.prompt = ctwPromptBounded;")'
     + ' && s("public/js/app.js").includes("ctwParsed.keywords = ctwKeywordsBounded;")'
     + ' && s("public/js/app.js").includes("last >= 0xD800 && last <= 0xDBFF")'
     + f' && s("public/js/app.js").indexOf({json.dumps(prompt_marker)})===s("public/js/app.js").indexOf({json.dumps(checkpoint_import)})+{prompt_marker_offset}'),
    (keyword_label,
     's("public/js/app.js").includes("// CTW_RESTORED_KEYWORD_SEMANTICS")'
     + ' && s("public/js/app.js").includes("keywordList(ctwKeywordCandidate);")'
     + ' && s("public/js/app.js").includes("ctwKeywordSafe = \\\"\\\";")'
     + ' && s("public/js/app.js").includes("window.addEventListener(\\\"load\\\", ctwRepairSemanticKeywords, { once: true });")'
     + ' && s("public/js/app.js").includes("ctwSemanticParsed.keywords = ctwKeywordSafe;")'
     + ' && s("tests/e2e/app.spec.js").includes("const downloadPromise=page.waitForEvent(\'download\');")'
     + ' && s("tests/e2e/app.spec.js").includes("expect(diagnostic).not.toContain(\'private-person-name.mp3\');")'
     + ' && s("tests/e2e/mock-server.mjs").includes("restored-keyword semantic repair")'),
    (prompt_assertion_label,
     's("tests/e2e/app.spec.js").includes("const restoredPrompt=await page.locator(\'#promptInput\').inputValue();")'
     + ' && s("tests/e2e/app.spec.js").includes("const restoredKeywords=await page.locator(\'#keywordsInput\').inputValue();")'
     + ' && s("tests/e2e/app.spec.js").includes("expect(restoredPrompt.length).toBe(12000);")'
     + ' && s("tests/e2e/app.spec.js").includes("expect(restoredKeywords).toBe(\'\');")'
     + ' && !s("tests/e2e/app.spec.js").includes("toHaveJSProperty(\'value\',expect.stringMatching")'),
    (sort_label, f's("tests/e2e/app.spec.js").includes({json.dumps(ready_line.strip())})'),
    (failfast_label,
     's("playwright.config.js").includes("retries:process.env.CI?0:1")'
     + ' && s("playwright.config.js").includes("actionTimeout:15000")'
     + ' && s("playwright.config.js").includes("navigationTimeout:30000")'),
]
check_lines = [f'    ,["{label}", () => {expr}]' for label, expr in checks]
audit = audit.replace(audit_anchor, "\n".join(check_lines) + "\n" + audit_anchor, 1)
write(AUDIT, audit)


# 7. Preserve fixed-port mutation and add deliberate mutations for new contracts.
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
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")
mutation_specs = [
    ("drop shared E2E port seed -> Playwright E2E shares one generated endpoint across runner and workers", "playwright.config.js", port_seed, "randomInt(20000,60000)"),
    ("drop shared E2E token seed -> Playwright E2E shares one generated endpoint across runner and workers", "playwright.config.js", token_seed, "randomBytes(16).toString('hex')"),
    ("downgrade E2E browser origin to HTTP -> E2E preserves Secure BYOK cookie over ephemeral localhost HTTPS", "playwright.config.js", new_origin, old_origin),
    ("remove E2E TLS server -> E2E preserves Secure BYOK cookie over ephemeral localhost HTTPS", "tests/e2e/mock-server.mjs", "https.createServer(tlsOptions,async(req,res)=>{", "https.createServer({},async(req,res)=>{"),
    ("remove checkpoint result reuse import -> browser queue preparation binds checkpoint result reuse helper", "public/js/app.js", checkpoint_import, ""),
    ("bypass restored prompt bound -> restored prompt respects textarea maxLength with surrogate-safe truncation", "public/js/app.js", "ctwParsed.prompt = ctwPromptBounded;", "ctwParsed.prompt = ctwParsed.prompt;"),
    ("bypass restored keyword semantic parser -> restored invalid keywords are reset before diagnostics and paid settings reads", "public/js/app.js", "keywordList(ctwKeywordCandidate);", "void ctwKeywordCandidate;"),
    ("keep malformed restored keyword after semantic rejection -> restored invalid keywords are reset before diagnostics and paid settings reads", "public/js/app.js", 'ctwKeywordSafe = "";', "ctwKeywordSafe = ctwKeywordCandidate;"),
    ("weaken direct restored prompt length proof -> E2E directly verifies restored prompt and keyword bounds", "tests/e2e/app.spec.js", "expect(restoredPrompt.length).toBe(12000);", "expect(restoredPrompt.length).toBeGreaterThanOrEqual(0);"),
    ("weaken malformed restored keyword recovery proof -> E2E directly verifies restored prompt and keyword bounds", "tests/e2e/app.spec.js", "expect(restoredKeywords).toBe('');", "expect(typeof restoredKeywords).toBe('string');"),
    ("assert natural sort before preparation -> E2E natural sort waits for prepared queue state", "tests/e2e/app.spec.js", ready_line.strip(), "void 0;"),
    ("restore CI E2E retries -> Playwright CI fails fast without retry masking and bounds browser actions", "playwright.config.js", "retries:process.env.CI?0:1", "retries:1"),
]
for label, _, _, _ in mutation_specs:
    if label in mutations:
        fail(f"Browser/E2E mutation unexpectedly already present: {label}")
entries = [f'  [{json.dumps(label)}, {json.dumps(path)}, {js_regex_exact(target)}, {json.dumps(replacement)}],' for label, path, target, replacement in mutation_specs]
mutations = mutations.replace(mutation_anchor, "\n".join(entries) + "\n" + mutation_anchor, 1)
write(MUTATIONS, mutations)

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
print("E2E HTTPS repair PASS: ephemeral localhost TLS preserves production Secure __Host cookie semantics and verifies both built preference repairs.")
print("Playwright CI fail-fast repair PASS: no CI retries; browser actions/navigation are bounded.")
print(f"Browser checkpoint reuse binding PASS: checkpointResultReusable imported from {rel}.")
print("Restored prompt bound PASS: saved prompt/keyword text is maxLength-bounded with surrogate-safe truncation and fail-soft storage handling.")
print("Restored keyword semantic recovery PASS: after app startup, the production keywordList contract validates restored keywords and malformed persisted keywords reset safely before diagnostics/settings reads.")
print("Restored preference E2E assertion PASS: prompt is checked at 12000 and the deliberately malformed restored keyword is required to recover to the safe empty default.")
print("Natural-sort E2E synchronization PASS: ordering is asserted only after both files reach Ready.")
print("Browser/E2E static safeguards and deliberate mutations installed; existing fixed-port mutation preserved.")
