from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
APP = WORK / "public" / "js" / "app.js"
SPEC = WORK / "tests" / "e2e" / "app.spec.js"
MOCK = WORK / "tests" / "e2e" / "mock-server.mjs"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"

MARKER = "// CTW_CANCEL_RACE_REPAIR"
WAIT_LABEL = "retry backoff rejects already-aborted signals and rechecks cancellation after checkpoint persistence"
E2E_LABEL = "E2E 429 cancellation waits for the rejection response and proves resumable Ready state"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"Cancellation repair required file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"Cancellation repair expected UTF-8 file: {path}")
        raise


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def js_regex_exact(text: str) -> str:
    if "\n" in text or "\r" in text:
        fail("js_regex_exact only supports one-line targets")
    return "/" + re.sub(r"([\\^$.*+?()\[\]{}|/])", r"\\\1", text) + "/"


# 1. Production cancellation fix.
app = read(APP)
old_wait = "function wait(ms,signal){return new Promise((res,rej)=>{const t=setTimeout(res,ms);signal?.addEventListener('abort',()=>{clearTimeout(t);rej(new DOMException('Aborted','AbortError'))},{once:true})})}"
new_wait = MARKER + "\n" + "function wait(ms,signal){return new Promise((res,rej)=>{if(signal?.aborted){rej(new DOMException('Aborted','AbortError'));return}let settled=false;const onAbort=()=>{if(settled)return;settled=true;clearTimeout(t);signal?.removeEventListener('abort',onAbort);rej(new DOMException('Aborted','AbortError'))};const t=setTimeout(()=>{if(settled)return;settled=true;signal?.removeEventListener('abort',onAbort);res()},ms);signal?.addEventListener('abort',onAbort,{once:true})})}"
if app.count(old_wait) != 1:
    fail(f"Reviewed cancellation wait anchor drifted: {app.count(old_wait)}")
if MARKER in app:
    fail("Cancellation-race repair marker unexpectedly already present")
app = app.replace(old_wait, new_wait, 1)

old_post_checkpoint = "    if(aborted)throw e;\n    if(knownSafeRetry(e)&&explicit429Retries<s.retryCount){const delay=automaticRetryDelayMs(e,explicit429Retries+1);if(delay!==null){explicit429Retries++;await wait(delay,controller.signal);continue}}"
new_post_checkpoint = "    if(aborted)throw e;\n    if(state.cancelRequested||controller.signal.aborted)throw new DOMException('Cancelled','AbortError');\n    if(knownSafeRetry(e)&&explicit429Retries<s.retryCount){const delay=automaticRetryDelayMs(e,explicit429Retries+1);if(delay!==null){explicit429Retries++;await wait(delay,controller.signal);continue}}"
if app.count(old_post_checkpoint) != 1:
    fail(f"Reviewed post-checkpoint retry anchor drifted: {app.count(old_post_checkpoint)}")
app = app.replace(old_post_checkpoint, new_post_checkpoint, 1)

for invariant, expected in (
    (MARKER, 1),
    ("if(signal?.aborted){rej(new DOMException('Aborted','AbortError'));return}", 1),
    ("signal?.removeEventListener('abort',onAbort)", 2),
    ("if(state.cancelRequested||controller.signal.aborted)throw new DOMException('Cancelled','AbortError');", 1),
):
    if app.count(invariant) != expected:
        fail(f"Cancellation repair invariant drifted: {invariant} -> {app.count(invariant)} (expected {expected})")
write(APP, app)


# 2. Strengthen the E2E so Cancel occurs only after the explicit 429 response is observed.
spec = read(SPEC)
old_e2e = """  const first=page.waitForRequest(req=>req.url().includes('/api/transcribe'));
  await page.locator('#startBtn').click();
  await first;
  await expect(page.locator('#cancelBtn')).toBeEnabled();
  await page.locator('#cancelBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Cancelled',{timeout:5000});
  expect(requests).toBe(1);"""
new_e2e = """  const first=page.waitForRequest(req=>req.url().includes('/api/transcribe'));
  const firstResponse=page.waitForResponse(res=>res.url().includes('/api/transcribe')&&res.status()===429);
  await page.locator('#startBtn').click();
  await first;
  await firstResponse;
  await expect(page.locator('#cancelBtn')).toBeEnabled();
  await page.locator('#cancelBtn').click();
  await expect(page.locator('#progressTitle')).toHaveText('Cancelled',{timeout:5000});
  await expect(page.locator('#queueList .mini-state')).toHaveText('Ready',{timeout:5000});
  expect(requests).toBe(1);"""
if spec.count(old_e2e) != 1:
    fail(f"Reviewed 429 cancellation E2E anchor drifted: {spec.count(old_e2e)}")
spec = spec.replace(old_e2e, new_e2e, 1)
for invariant in (
    "const firstResponse=page.waitForResponse(res=>res.url().includes('/api/transcribe')&&res.status()===429);",
    "await firstResponse;",
    "await expect(page.locator('#queueList .mini-state')).toHaveText('Ready',{timeout:5000});",
    "expect(requests).toBe(1);",
):
    if spec.count(invariant) != 1:
        fail(f"429 cancellation E2E invariant missing/duplicated: {invariant}")
write(SPEC, spec)


# 3. Require the built E2E app to contain the production repair marker.
mock = read(MOCK)
build_anchor = "if(!ctwBuiltApp.includes('// CTW_RESTORED_KEYWORD_SEMANTICS'))throw new Error('Built E2E app is missing the reviewed restored-keyword semantic repair.');"
build_check = "if(!ctwBuiltApp.includes('// CTW_CANCEL_RACE_REPAIR'))throw new Error('Built E2E app is missing the reviewed cancellation-race repair.');"
if mock.count(build_anchor) != 1 or build_check in mock:
    fail("Cancellation repair could not bind uniquely to the E2E built-app probe")
mock = mock.replace(build_anchor, build_anchor + "\n" + build_check, 1)
write(MOCK, mock)


# 4. Static safeguards.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Stable cancellation audit insertion anchor drifted: {audit.count(audit_anchor)}")
for label in (WAIT_LABEL, E2E_LABEL):
    if label in audit:
        fail(f"Cancellation safeguard unexpectedly already present: {label}")
wait_expr = (
    's("public/js/app.js").includes("// CTW_CANCEL_RACE_REPAIR")'
    ' && s("public/js/app.js").includes("if(signal?.aborted){rej(new DOMException(\'Aborted\',\'AbortError\'));return}")'
    ' && (s("public/js/app.js").match(/signal\?\.removeEventListener\(\'abort\',onAbort\)/g)||[]).length===2'
    ' && s("public/js/app.js").includes("if(state.cancelRequested||controller.signal.aborted)throw new DOMException(\'Cancelled\',\'AbortError\');")'
    ' && s("tests/e2e/mock-server.mjs").includes("reviewed cancellation-race repair")'
)
e2e_expr = (
    's("tests/e2e/app.spec.js").includes("const firstResponse=page.waitForResponse(res=>res.url().includes(\'/api/transcribe\')&&res.status()===429);")'
    ' && s("tests/e2e/app.spec.js").includes("await firstResponse;")'
    ' && s("tests/e2e/app.spec.js").includes("await expect(page.locator(\'#queueList .mini-state\')).toHaveText(\'Ready\',{timeout:5000});")'
    ' && s("tests/e2e/app.spec.js").includes("expect(requests).toBe(1);")'
)
checks = [
    f'    ,["{WAIT_LABEL}", () => {wait_expr}]',
    f'    ,["{E2E_LABEL}", () => {e2e_expr}]',
]
audit = audit.replace(audit_anchor, "\n".join(checks) + "\n" + audit_anchor, 1)
write(AUDIT, audit)


# 5. Mutation coverage for both halves of the race repair and E2E synchronization.
mutations = read(MUTATIONS)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable cancellation mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")
mutation_specs = [
    (
        "let already-aborted retry wait sleep -> retry backoff rejects already-aborted signals and rechecks cancellation after checkpoint persistence",
        "public/js/app.js",
        "if(signal?.aborted){rej(new DOMException('Aborted','AbortError'));return}",
        "void signal;",
    ),
    (
        "remove post-checkpoint cancellation recheck -> retry backoff rejects already-aborted signals and rechecks cancellation after checkpoint persistence",
        "public/js/app.js",
        "if(state.cancelRequested||controller.signal.aborted)throw new DOMException('Cancelled','AbortError');",
        "void state.cancelRequested;",
    ),
    (
        "stop waiting for explicit 429 response before cancel -> E2E 429 cancellation waits for the rejection response and proves resumable Ready state",
        "tests/e2e/app.spec.js",
        "await firstResponse;",
        "void firstResponse;",
    ),
    (
        "stop proving cancelled 429 returns queue row to Ready -> E2E 429 cancellation waits for the rejection response and proves resumable Ready state",
        "tests/e2e/app.spec.js",
        "await expect(page.locator('#queueList .mini-state')).toHaveText('Ready',{timeout:5000});",
        "void 0;",
    ),
]
for label, _, _, _ in mutation_specs:
    if label in mutations:
        fail(f"Cancellation mutation unexpectedly already present: {label}")
entries = [
    f'  [{json.dumps(label)}, {json.dumps(path)}, {js_regex_exact(target)}, {json.dumps(replacement)}],'
    for label, path, target, replacement in mutation_specs
]
mutations = mutations.replace(mutation_anchor, "\n".join(entries) + "\n" + mutation_anchor, 1)
write(MUTATIONS, mutations)

final_audit = read(AUDIT)
final_mutations = read(MUTATIONS)
for label in (WAIT_LABEL, E2E_LABEL):
    if final_audit.count(f'"{label}"') != 1:
        fail(f"Final cancellation safeguard missing or duplicated: {label}")
for label, _, _, _ in mutation_specs:
    if final_mutations.count(label) != 1:
        fail(f"Final cancellation mutation missing or duplicated: {label}")

print("Cancellation-race production repair PASS: already-aborted retry waits reject immediately and cancellation is rechecked after post-dispatch checkpoint persistence.")
print("429 cancellation E2E repair PASS: test observes the explicit 429 response, then requires prompt Cancel -> Ready with no second request.")
print("Cancellation-race built-app probe, static safeguards, and four deliberate mutations installed.")
