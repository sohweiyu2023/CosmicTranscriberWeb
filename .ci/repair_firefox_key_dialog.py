from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
INDEX = WORK / "public" / "index.html"
APP = WORK / "public" / "js" / "app.js"
SPEC = WORK / "tests" / "e2e" / "app.spec.js"
MOCK = WORK / "tests" / "e2e" / "mock-server.mjs"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"

MARKER = "// CTW_FIREFOX_KEY_DIALOG_CLICK_REPAIR"
PROD_LABEL = "secure key creation bypasses native dialog-submit click path and is single-flight"
E2E_LABEL = "E2E secure key creation proves explicit button semantics and successful session response"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"Firefox key-dialog repair required file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"Firefox key-dialog repair expected UTF-8 file: {path}")
        raise


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def js_regex_exact(text: str) -> str:
    if "\n" in text or "\r" in text:
        fail("js_regex_exact only supports one-line targets")
    return "/" + re.sub(r"([\\^$.*+?()\[\]{}|/])", r"\\\1", text) + "/"


# 1. Production repair.
index = read(INDEX)
old_button = '<button class="primary" type="submit">Create secure session</button>'
new_button = '<button id="createKeyBtn" class="primary" type="button">Create secure session</button>'
if index.count(old_button) != 1:
    fail(f"Reviewed secure-session button anchor drifted: {index.count(old_button)}")
if new_button in index:
    fail("Firefox key-dialog button repair unexpectedly already present")
index = index.replace(old_button, new_button, 1)
write(INDEX, index)

app = read(APP)
ui_old = " keyStatus:$('keyStatus'),configureKeyBtn:$('configureKeyBtn'),testKeyBtn:$('testKeyBtn'),forgetKeyBtn:$('forgetKeyBtn'),keyDialog:$('keyDialog'),keyForm:$('keyForm'),apiKeyInput:$('apiKeyInput'),keyDialogError:$('keyDialogError'),cancelKeyBtn:$('cancelKeyBtn'),closeKeyBtn:$('closeKeyBtn'),"
ui_new = " keyStatus:$('keyStatus'),configureKeyBtn:$('configureKeyBtn'),testKeyBtn:$('testKeyBtn'),forgetKeyBtn:$('forgetKeyBtn'),keyDialog:$('keyDialog'),keyForm:$('keyForm'),apiKeyInput:$('apiKeyInput'),keyDialogError:$('keyDialogError'),cancelKeyBtn:$('cancelKeyBtn'),closeKeyBtn:$('closeKeyBtn'),createKeyBtn:$('createKeyBtn'),"
if app.count(ui_old) != 1:
    fail(f"Reviewed key UI anchor drifted: {app.count(ui_old)}")
if MARKER in app:
    fail("Firefox key-dialog app repair marker unexpectedly already present")
app = app.replace(ui_old, ui_new, 1)

old_handler = "UI.keyForm.addEventListener('submit',async e=>{e.preventDefault();const value=UI.apiKeyInput.value;UI.keyDialogError.textContent='';try{if(!value||value.length>512||/[\\s\\u0000-\\u001f\\u007f]/u.test(value))throw new Error('Enter the API key exactly as issued by OpenAI, without spaces.');await api('/api/key/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:value})});UI.apiKeyInput.value='';UI.keyDialog.close();await refreshSession();setProgress(0,'Ready','Secure API-key session configured.')}catch(err){UI.keyDialogError.textContent=safeError(err)}finally{UI.apiKeyInput.value=''}});"
new_handler = MARKER + "\n" + "async function createKeySession(){if(UI.createKeyBtn.disabled)return;UI.createKeyBtn.disabled=true;const value=UI.apiKeyInput.value;UI.keyDialogError.textContent='';try{if(!value||value.length>512||/[\\s\\u0000-\\u001f\\u007f]/u.test(value))throw new Error('Enter the API key exactly as issued by OpenAI, without spaces.');await api('/api/key/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:value})});UI.apiKeyInput.value='';UI.keyDialog.close();await refreshSession();setProgress(0,'Ready','Secure API-key session configured.')}catch(err){UI.keyDialogError.textContent=safeError(err)}finally{UI.apiKeyInput.value='';UI.createKeyBtn.disabled=false}}\nUI.createKeyBtn.addEventListener('click',()=>{void createKeySession()});\nUI.keyForm.addEventListener('submit',e=>{e.preventDefault();void createKeySession()});"
if app.count(old_handler) != 1:
    fail(f"Reviewed secure-session submit handler anchor drifted: {app.count(old_handler)}")
app = app.replace(old_handler, new_handler, 1)

for invariant, expected in (
    (MARKER, 1),
    ("createKeyBtn:$('createKeyBtn')", 1),
    ("if(UI.createKeyBtn.disabled)return;UI.createKeyBtn.disabled=true;", 1),
    ("UI.createKeyBtn.addEventListener('click',()=>{void createKeySession()});", 1),
    ("UI.keyForm.addEventListener('submit',e=>{e.preventDefault();void createKeySession()});", 1),
    ("UI.createKeyBtn.disabled=false", 1),
):
    if app.count(invariant) != expected:
        fail(f"Firefox key-dialog app invariant drifted: {invariant} -> {app.count(invariant)} (expected {expected})")
write(APP, app)


# 2. Strengthen the exact Windows-Firefox interaction.
spec = read(SPEC)
old_e2e = "  await page.locator('#apiKeyInput').fill(seeded);\n  await page.getByRole('button',{name:/Create secure session/i}).click();\n  await expect(page.locator('#apiKeyInput')).toHaveValue('');"
new_e2e = "  await page.locator('#apiKeyInput').fill(seeded);\n  const createKeySessionButton=page.getByRole('button',{name:/Create secure session/i});\n  await expect(createKeySessionButton).toHaveAttribute('type','button');\n  const keySessionResponse=page.waitForResponse(res=>new URL(res.url()).pathname==='/api/key/session'&&res.status()===200);\n  await createKeySessionButton.click();\n  await keySessionResponse;\n  await expect(page.locator('#apiKeyInput')).toHaveValue('');"
if spec.count(old_e2e) != 1:
    fail(f"Reviewed secure-session E2E anchor drifted: {spec.count(old_e2e)}")
spec = spec.replace(old_e2e, new_e2e, 1)
for invariant in (
    "await expect(createKeySessionButton).toHaveAttribute('type','button');",
    "const keySessionResponse=page.waitForResponse(res=>new URL(res.url()).pathname==='/api/key/session'&&res.status()===200);",
    "await createKeySessionButton.click();",
    "await keySessionResponse;",
):
    if spec.count(invariant) != 1:
        fail(f"Firefox key-dialog E2E invariant missing/duplicated: {invariant}")
write(SPEC, spec)


# 3. Built-app probe.
mock = read(MOCK)
build_anchor = "if(!ctwBuiltApp.includes('// CTW_CANCEL_RACE_REPAIR'))throw new Error('Built E2E app is missing the reviewed cancellation-race repair.');"
build_check = "if(!ctwBuiltApp.includes('// CTW_FIREFOX_KEY_DIALOG_CLICK_REPAIR'))throw new Error('Built E2E app is missing the reviewed Firefox key-dialog click repair.');"
if mock.count(build_anchor) != 1 or build_check in mock:
    fail("Firefox key-dialog repair could not bind uniquely to the E2E built-app probe")
mock = mock.replace(build_anchor, build_anchor + "\n" + build_check, 1)
write(MOCK, mock)


# 4. Static safeguards.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Stable Firefox key-dialog audit insertion anchor drifted: {audit.count(audit_anchor)}")
for label in (PROD_LABEL, E2E_LABEL):
    if label in audit:
        fail(f"Firefox key-dialog safeguard unexpectedly already present: {label}")

prod_expr = (
    's("public/index.html").includes("<button id=\\"createKeyBtn\\" class=\\"primary\\" type=\\"button\\">Create secure session</button>")'
    ' && !s("public/index.html").includes("<button class=\\"primary\\" type=\\"submit\\">Create secure session</button>")'
    ' && s("public/js/app.js").includes("// CTW_FIREFOX_KEY_DIALOG_CLICK_REPAIR")'
    ' && s("public/js/app.js").includes("if(UI.createKeyBtn.disabled)return;UI.createKeyBtn.disabled=true;")'
    + " && s(\"public/js/app.js\").includes(\"UI.createKeyBtn.addEventListener('click',()=>{void createKeySession()});\")"
    + " && s(\"public/js/app.js\").includes(\"UI.keyForm.addEventListener('submit',e=>{e.preventDefault();void createKeySession()});\")"
    ' && s("tests/e2e/mock-server.mjs").includes("reviewed Firefox key-dialog click repair")'
)
e2e_expr = (
    "s(\"tests/e2e/app.spec.js\").includes(\"await expect(createKeySessionButton).toHaveAttribute('type','button');\")"
    + " && s(\"tests/e2e/app.spec.js\").includes(\"const keySessionResponse=page.waitForResponse(res=>new URL(res.url()).pathname==='/api/key/session'&&res.status()===200);\")"
    + ' && s("tests/e2e/app.spec.js").includes("await createKeySessionButton.click();")'
    + ' && s("tests/e2e/app.spec.js").includes("await keySessionResponse;")'
)
checks = [
    f'    ,["{PROD_LABEL}", () => {prod_expr}]',
    f'    ,["{E2E_LABEL}", () => {e2e_expr}]',
]
audit = audit.replace(audit_anchor, "\n".join(checks) + "\n" + audit_anchor, 1)
write(AUDIT, audit)


# 5. Mutation coverage.
mutations = read(MUTATIONS)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable Firefox key-dialog mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")

mutation_specs = [
    (
        "restore native dialog submit button -> secure key creation bypasses native dialog-submit click path and is single-flight",
        "public/index.html",
        '<button id="createKeyBtn" class="primary" type="button">Create secure session</button>',
        '<button class="primary" type="submit">Create secure session</button>',
    ),
    (
        "remove explicit secure-key button click handler -> secure key creation bypasses native dialog-submit click path and is single-flight",
        "public/js/app.js",
        "UI.createKeyBtn.addEventListener('click',()=>{void createKeySession()});",
        "void createKeySession;",
    ),
    (
        "make secure-key implicit submit handler asynchronous again -> secure key creation bypasses native dialog-submit click path and is single-flight",
        "public/js/app.js",
        "UI.keyForm.addEventListener('submit',e=>{e.preventDefault();void createKeySession()});",
        "UI.keyForm.addEventListener('submit',async e=>{e.preventDefault();await createKeySession()});",
    ),
    (
        "stop E2E from proving explicit secure-key button semantics -> E2E secure key creation proves explicit button semantics and successful session response",
        "tests/e2e/app.spec.js",
        "await expect(createKeySessionButton).toHaveAttribute('type','button');",
        "void createKeySessionButton;",
    ),
    (
        "stop E2E from awaiting successful secure-key session response -> E2E secure key creation proves explicit button semantics and successful session response",
        "tests/e2e/app.spec.js",
        "await keySessionResponse;",
        "void keySessionResponse;",
    ),
]
for label, _, _, _ in mutation_specs:
    if label in mutations:
        fail(f"Firefox key-dialog mutation unexpectedly already present: {label}")
entries = [
    f'  [{json.dumps(label)}, {json.dumps(path)}, {js_regex_exact(target)}, {json.dumps(replacement)}],'
    for label, path, target, replacement in mutation_specs
]
mutations = mutations.replace(mutation_anchor, "\n".join(entries) + "\n" + mutation_anchor, 1)
write(MUTATIONS, mutations)

final_audit = read(AUDIT)
final_mutations = read(MUTATIONS)
for label in (PROD_LABEL, E2E_LABEL):
    if final_audit.count(f'"{label}"') != 1:
        fail(f"Final Firefox key-dialog safeguard missing or duplicated: {label}")
for label, _, _, _ in mutation_specs:
    if final_mutations.count(label) != 1:
        fail(f"Final Firefox key-dialog mutation missing or duplicated: {label}")

print("Windows Firefox key-dialog production repair PASS: explicit pointer button bypasses native dialog-submit click semantics while implicit submit remains synchronously prevented.")
print("Secure-session request is single-flight and E2E proves explicit type=button plus an HTTP 200 key-session response.")
print("Firefox key-dialog built-app probe, two static safeguards, and five deliberate mutations installed.")
