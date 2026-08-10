from __future__ import annotations

import json
import os
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
PLAYWRIGHT = WORK / "playwright.config.js"
E2E_SPEC = WORK / "tests" / "e2e" / "app.spec.js"
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
    # Escape an exact one-line string for a JavaScript /.../ regex literal.
    if "\n" in text or "\r" in text:
        fail("js_regex_exact only supports one-line targets")
    return "/" + re.sub(r"([\\^$.*+?()\[\]{}|/])", r"\\\1", text) + "/"


# ---------------------------------------------------------------------------
# 1. Playwright endpoint inheritance + fail-fast CI behavior.
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

old_runner = "testDir:'./tests/e2e',fullyParallel:false,workers:process.env.CI?1:undefined,retries:1,timeout:60000,expect:{timeout:10000},"
new_runner = "testDir:'./tests/e2e',fullyParallel:false,workers:process.env.CI?1:undefined,retries:process.env.CI?0:1,timeout:60000,expect:{timeout:10000},"
if config.count(old_runner) != 1:
    fail(f"Reviewed Playwright runner policy drifted: expected 1 exact occurrence; found {config.count(old_runner)}")
config = config.replace(old_runner, new_runner, 1)

old_use = "use:{baseURL:origin,trace:'retain-on-failure',screenshot:'only-on-failure'},"
new_use = "use:{baseURL:origin,actionTimeout:15000,navigationTimeout:30000,trace:'retain-on-failure',screenshot:'only-on-failure'},"
if config.count(old_use) != 1:
    fail(f"Reviewed Playwright use policy drifted: expected 1 exact occurrence; found {config.count(old_use)}")
config = config.replace(old_use, new_use, 1)

for invariant, count in (
    (new_port, 1),
    (new_token, 1),
    ("const origin=`http://localhost:${e2ePort}`;", 1),
    ("url:`${origin}/__cosmic_e2e_health?token=${e2eToken}`", 1),
    ("env:{...process.env,COSMIC_E2E_PORT:String(e2ePort),COSMIC_E2E_TOKEN:e2eToken}", 1),
    ("reuseExistingServer:false", 1),
    ("retries:process.env.CI?0:1", 1),
    ("actionTimeout:15000", 1),
    ("navigationTimeout:30000", 1),
):
    if config.count(invariant) != count:
        fail(f"Derived Playwright invariant drifted: {invariant}")
if old_port in config or old_token in config or old_runner in config or old_use in config:
    fail("Old Playwright endpoint/retry/action policy survived E2E repair")
write(PLAYWRIGHT, config)


# ---------------------------------------------------------------------------
# 2. Browser app repair: bind checkpointResultReusable used by queue prep.
# Hosted E2E evidence showed file preparation failing with the exact runtime
# ReferenceError "checkpointResultReusable is not defined". Resolve the unique
# exported implementation and bind it with a distinct import in app.js.
# ---------------------------------------------------------------------------
app = read(APP)
if not re.search(r"\bcheckpointResultReusable\s*\(", app):
    fail("Browser app no longer calls checkpointResultReusable; reviewed failure shape drifted")
if re.search(r"(?m)^\s*(?:import\b[^\n]*\bcheckpointResultReusable\b|(?:export\s+)?(?:async\s+)?function\s+checkpointResultReusable\b|(?:export\s+)?(?:const|let|var)\s+checkpointResultReusable\b)", app):
    fail("Browser app unexpectedly already binds checkpointResultReusable before certification repair")

definition = re.compile(
    r"(?m)^\s*(?:export\s+)?(?:(?:async\s+)?function|const|let|var)\s+checkpointResultReusable\b"
)
exported = re.compile(
    r"(?:\bexport\s+(?:(?:async\s+)?function|const|let|var)\s+checkpointResultReusable\b|\bexport\s*\{[^}]*\bcheckpointResultReusable\b[^}]*\})",
    re.S,
)
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
        if candidate == APP:
            continue
        if "checkpointResultReusable" in read(candidate):
            mentions.append(candidate.relative_to(WORK).as_posix())
    fail(
        "Expected exactly one exported checkpointResultReusable implementation; "
        f"found {len(exporters)}. Mentioning files: {mentions[:8]}"
    )
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
# 3. Browser app repair: clamp programmatically restored prompt values to the
# textarea's declared maxLength, preserving surrogate pairs. HTML maxlength
# constrains user editing but does not itself sanitize programmatic restoration.
# Run after synchronous module initialization and again at load as a fallback;
# dispatch input so the app's normal non-secret preference persistence observes
# the bounded value instead of retaining a corrupt oversized one.
# ---------------------------------------------------------------------------
prompt_marker = "// CTW_RESTORED_PROMPT_BOUND"
if prompt_marker in app:
    fail("Restored-prompt bound marker unexpectedly already present")
prompt_repair = r'''

// CTW_RESTORED_PROMPT_BOUND
function ctwBoundRestoredPrompt() {
  const input = document.getElementById("promptInput");
  if (!input || typeof input.value !== "string") return;
  const max = Number.isInteger(input.maxLength) && input.maxLength > 0 ? input.maxLength : 12000;
  if (input.value.length <= max) return;
  let bounded = input.value.slice(0, max);
  if (bounded.length) {
    const last = bounded.charCodeAt(bounded.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) bounded = bounded.slice(0, -1);
  }
  input.value = bounded;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
queueMicrotask(ctwBoundRestoredPrompt);
window.addEventListener("load", ctwBoundRestoredPrompt, { once: true });
'''
app = app.rstrip() + prompt_repair + "\n"
for invariant, expected in (
    (prompt_marker, 1),
    ('document.getElementById("promptInput")', 1),
    ("input.maxLength", 3),
    ("input.value = bounded;", 1),
    ("last >= 0xD800 && last <= 0xDBFF", 1),
    ("queueMicrotask(ctwBoundRestoredPrompt);", 1),
    ('window.addEventListener("load", ctwBoundRestoredPrompt, { once: true });', 1),
):
    if app.count(invariant) != expected:
        fail(f"Restored-prompt derived invariant drifted: {invariant} -> {app.count(invariant)} (expected {expected})")
write(APP, app)


# ---------------------------------------------------------------------------
# 4. E2E correctness: natural-sort assertion must wait for asynchronous file
# inspection/preparation to complete. The prior failure snapshot showed both rows
# still saying "Inspecting safely..." when the test read their order.
# ---------------------------------------------------------------------------
spec = read(E2E_SPEC)
queue_anchor = "  await expect(page.locator('#queueList li')).toHaveCount(2,{timeout:30000});\n  const names=await page.locator('#queueList li strong').allTextContents();"
ready_line = "  await expect(page.locator('#queueList .mini-state')).toHaveText(['Ready','Ready'],{timeout:30000});"
if spec.count(queue_anchor) != 1:
    fail(f"Natural-sort E2E assertion anchor drifted: {spec.count(queue_anchor)}")
if ready_line in spec:
    fail("Natural-sort readiness assertion unexpectedly already present")
spec = spec.replace(
    queue_anchor,
    "  await expect(page.locator('#queueList li')).toHaveCount(2,{timeout:30000});\n" + ready_line + "\n  const names=await page.locator('#queueList li strong').allTextContents();",
    1,
)
if spec.count(ready_line) != 1:
    fail("Natural-sort readiness assertion missing or duplicated after repair")
write(E2E_SPEC, spec)


# ---------------------------------------------------------------------------
# 5. Static safeguards for all new browser/E2E repairs.
# ---------------------------------------------------------------------------
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Stable audit insertion anchor drifted: {audit.count(audit_anchor)}")

shared_label = "Playwright E2E shares one generated endpoint across runner and workers"
checkpoint_label = "browser queue preparation binds checkpoint result reuse helper"
prompt_label = "restored prompt respects textarea maxLength with surrogate-safe truncation"
sort_label = "E2E natural sort waits for prepared queue state"
failfast_label = "Playwright CI fails fast without retry masking and bounds browser actions"
for label in (shared_label, checkpoint_label, prompt_label, sort_label, failfast_label):
    if label in audit:
        fail(f"Browser/E2E safeguard unexpectedly already present: {label}")

port_seed = "process.env.COSMIC_E2E_PORT ||= String(randomInt(20000,60000))"
token_seed = "process.env.COSMIC_E2E_TOKEN ||= randomBytes(16).toString('hex')"
server_env = "env:{...process.env,COSMIC_E2E_PORT:String(e2ePort),COSMIC_E2E_TOKEN:e2eToken}"
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
        checkpoint_label,
        f's("public/js/app.js").includes({json.dumps(checkpoint_import)})'
        + ' && s("public/js/app.js").includes("checkpointResultReusable(")',
    ),
    (
        prompt_label,
        's("public/js/app.js").includes("// CTW_RESTORED_PROMPT_BOUND")'
        + ' && s("public/js/app.js").includes("input.maxLength")'
        + ' && s("public/js/app.js").includes("input.value = bounded;")'
        + ' && s("public/js/app.js").includes("last >= 0xD800 && last <= 0xDBFF")'
        + ' && s("public/js/app.js").includes("queueMicrotask(ctwBoundRestoredPrompt);")',
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
check_lines = []
for label, expr in checks:
    check_lines.append(f'    ,["{label}", () => {expr}]')
audit = audit.replace(audit_anchor, "\n".join(check_lines) + "\n" + audit_anchor, 1)
write(AUDIT, audit)


# ---------------------------------------------------------------------------
# 6. Preserve old fixed-port regression mutation and add mutations for each new
# browser/E2E safeguard. These mutate the derived certification tree only.
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
    (
        "drop shared E2E port seed -> Playwright E2E shares one generated endpoint across runner and workers",
        "playwright.config.js",
        "process.env.COSMIC_E2E_PORT ||= String(randomInt(20000,60000))",
        "randomInt(20000,60000)",
    ),
    (
        "drop shared E2E token seed -> Playwright E2E shares one generated endpoint across runner and workers",
        "playwright.config.js",
        "process.env.COSMIC_E2E_TOKEN ||= randomBytes(16).toString('hex')",
        "randomBytes(16).toString('hex')",
    ),
    (
        "remove checkpoint result reuse import -> browser queue preparation binds checkpoint result reuse helper",
        "public/js/app.js",
        checkpoint_import,
        "",
    ),
    (
        "disable restored prompt assignment -> restored prompt respects textarea maxLength with surrogate-safe truncation",
        "public/js/app.js",
        "input.value = bounded;",
        "void bounded;",
    ),
    (
        "assert natural sort before preparation -> E2E natural sort waits for prepared queue state",
        "tests/e2e/app.spec.js",
        ready_line.strip(),
        "void 0;",
    ),
    (
        "restore CI E2E retries -> Playwright CI fails fast without retry masking and bounds browser actions",
        "playwright.config.js",
        "retries:process.env.CI?0:1",
        "retries:1",
    ),
]
for label, _, _, _ in mutation_specs:
    if label in mutations:
        fail(f"Browser/E2E mutation unexpectedly already present: {label}")
entries = []
for label, path, target, replacement in mutation_specs:
    entries.append(
        f'  [{json.dumps(label)}, {json.dumps(path)}, {js_regex_exact(target)}, {json.dumps(replacement)}],'
    )
mutations = mutations.replace(mutation_anchor, "\n".join(entries) + "\n" + mutation_anchor, 1)
write(MUTATIONS, mutations)


# Final fail-closed invariants.
final_audit = read(AUDIT)
final_mutations = read(MUTATIONS)
for label in (shared_label, checkpoint_label, prompt_label, sort_label, failfast_label):
    if final_audit.count(f'"{label}"') != 1:
        fail(f"Final browser/E2E safeguard missing or duplicated: {label}")
for mutation_label in (legacy_label, *(x[0] for x in mutation_specs)):
    if final_mutations.count(mutation_label) != 1:
        fail(f"Final E2E mutation missing or duplicated: {mutation_label}")
if "CTW_DIAGNOSTIC_ONLY" in read(APP) or "CTW_DIAGNOSTIC_ONLY" in read(E2E_SPEC):
    fail("Diagnostic-only marker survived browser repair")

print("Playwright E2E endpoint repair PASS: random port/token are generated once and inherited by server/workers.")
print("Playwright CI fail-fast repair PASS: no CI retries; browser actions/navigation have bounded waits while test assertions retain explicit long-operation timeouts.")
print(f"Browser checkpoint reuse binding PASS: checkpointResultReusable imported from {rel}.")
print("Restored prompt bound PASS: programmatic saved prompt is clamped to textarea maxLength without splitting a trailing high surrogate.")
print("Natural-sort E2E synchronization PASS: ordering is asserted only after both files reach Ready.")
print("Browser/E2E static safeguards and deliberate mutations installed; existing fixed-port mutation preserved.")
