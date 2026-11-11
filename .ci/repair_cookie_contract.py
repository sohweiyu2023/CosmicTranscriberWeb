from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
SPEC = WORK / "tests" / "e2e" / "app.spec.js"
MOCK = WORK / "tests" / "e2e" / "mock-server.mjs"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"

LABEL = "E2E proves BYOK cookie secrecy and transmission without BrowserContext metadata"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"Cookie-contract certification repair required file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"Cookie-contract certification repair expected UTF-8 file: {path}")
        raise


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def js_regex_exact(text: str) -> str:
    if "\n" in text or "\r" in text:
        fail("js_regex_exact only supports one-line targets")
    return "/" + re.sub(r"([\\^$.*+?()\[\]{}|/])", r"\\\1", text) + "/"


# Hosted run 31443947494 proved the complete outer Windows Chrome/Edge E2E gate
# (30/30) and the complete Linux Chromium/Firefox/WebKit/mobile-Safari gate.
# The actual RELEASE-WINDOWS.ps1 then reran the core matrix and Windows WebKit
# reported false only for BrowserContext.cookies() metadata, while the app flow
# itself completed. Do not weaken the production cookie. Replace that automation
# metadata oracle with browser/network behavior: JavaScript cannot see the cookie,
# and the browser actually sends the __Host cookie on a subsequent authenticated
# session-status request over the already-required HTTPS E2E origin.

spec = read(SPEC)
old_block = "\n".join([
    "  expect(stores.docCookie).not.toContain('__Host-cosmic_byok');",
    "  const cookies=await context.cookies();",
    "  expect(cookies.some(c=>c.name==='__Host-cosmic_byok'&&c.httpOnly&&c.secure&&c.sameSite==='Strict')).toBeTruthy();",
])
new_block = "\n".join([
    "  expect(stores.docCookie).not.toContain('__Host-cosmic_byok');",
    "  const sessionStatusRequestPromise=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/session/status');",
    "  await page.reload();",
    "  const sessionStatusRequest=await sessionStatusRequestPromise;",
    "  const sessionStatusHeaders=await sessionStatusRequest.allHeaders();",
    "  expect(sessionStatusHeaders.cookie??'').toContain('__Host-cosmic_byok=');",
])

if spec.count(old_block) != 1:
    fail(f"Reviewed BrowserContext cookie-metadata assertion drifted: {spec.count(old_block)}")
if "sessionStatusRequest.allHeaders()" in spec:
    fail("Behavioral BYOK cookie transmission proof unexpectedly already present")
spec = spec.replace(old_block, new_block, 1)
if old_block in spec or spec.count(new_block) != 1:
    fail("Behavioral BYOK cookie proof was not installed exactly once")
if "context.cookies()" in spec:
    fail("BrowserContext cookie metadata oracle survived behavioral repair")
write(SPEC, spec)

# The behavioral proof complements, rather than replaces, the exact static
# production-like Set-Cookie and HTTPS test-harness contract already installed by
# repair_e2e.py.
mock = read(MOCK)
for invariant in (
    "HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600",
    "https.createServer(tlsOptions,async(req,res)=>{",
    "const ORIGIN=`https://localhost:${PORT}`;",
):
    if mock.count(invariant) != 1:
        fail(f"Required HTTPS/Set-Cookie invariant drifted: {invariant} -> {mock.count(invariant)}")

# Add a source-level safeguard. It must simultaneously prove exact hardened
# response directives, JS non-visibility, and actual browser transmission.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Stable cookie-contract audit insertion anchor drifted: {audit.count(audit_anchor)}")
if LABEL in audit:
    fail(f"Cookie-contract safeguard unexpectedly already present: {LABEL}")
check = (
    f'    ,["{LABEL}", () => '
    's("tests/e2e/app.spec.js").includes("expect(stores.docCookie).not.toContain(\'__Host-cosmic_byok\');")'
    ' && s("tests/e2e/app.spec.js").includes("page.waitForRequest(request=>new URL(request.url()).pathname===\'/api/session/status\')")'
    ' && s("tests/e2e/app.spec.js").includes("sessionStatusRequest.allHeaders()")'
    ' && s("tests/e2e/app.spec.js").includes("expect(sessionStatusHeaders.cookie??\'\').toContain(\'__Host-cosmic_byok=\');")'
    ' && !s("tests/e2e/app.spec.js").includes("context.cookies()")'
    ' && s("tests/e2e/mock-server.mjs").includes("HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600")'
    ' && s("tests/e2e/mock-server.mjs").includes("https.createServer(tlsOptions,async(req,res)=>{")]\n'
)
audit = audit.replace(audit_anchor, check + audit_anchor, 1)
write(AUDIT, audit)

# Two independent mutations prove neither half of the runtime contract can be
# silently weakened: JS secrecy and actual Cookie-header transmission.
mutations = read(MUTATIONS)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable cookie-contract mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")
mutation_specs = [
    (
        "expose BYOK cookie to document -> " + LABEL,
        "tests/e2e/app.spec.js",
        "expect(stores.docCookie).not.toContain('__Host-cosmic_byok');",
        "expect(typeof stores.docCookie).toBe('string');",
    ),
    (
        "drop runtime BYOK cookie transmission proof -> " + LABEL,
        "tests/e2e/app.spec.js",
        "expect(sessionStatusHeaders.cookie??'').toContain('__Host-cosmic_byok=');",
        "expect(typeof sessionStatusHeaders).toBe('object');",
    ),
]
for mutation_label, _, _, _ in mutation_specs:
    if mutation_label in mutations:
        fail(f"Cookie-contract mutation unexpectedly already present: {mutation_label}")
entries = [
    f'  [{json.dumps(label)}, {json.dumps(path)}, {js_regex_exact(target)}, {json.dumps(replacement)}],'
    for label, path, target, replacement in mutation_specs
]
mutations = mutations.replace(mutation_anchor, "\n".join(entries) + "\n" + mutation_anchor, 1)
write(MUTATIONS, mutations)

# Final fail-closed invariants.
final_spec = read(SPEC)
final_audit = read(AUDIT)
final_mutations = read(MUTATIONS)
for invariant in (
    "expect(stores.docCookie).not.toContain('__Host-cosmic_byok');",
    "page.waitForRequest(request=>new URL(request.url()).pathname==='/api/session/status')",
    "sessionStatusRequest.allHeaders()",
    "expect(sessionStatusHeaders.cookie??'').toContain('__Host-cosmic_byok=');",
):
    if final_spec.count(invariant) != 1:
        fail(f"Final behavioral BYOK cookie invariant missing or duplicated: {invariant}")
if "context.cookies()" in final_spec:
    fail("Final E2E still trusts BrowserContext cookie metadata")
if final_audit.count(f'"{LABEL}"') != 1:
    fail("Final BYOK cookie behavioral safeguard missing or duplicated")
for mutation_label, _, _, _ in mutation_specs:
    if final_mutations.count(mutation_label) != 1:
        fail(f"Final BYOK cookie mutation missing or duplicated: {mutation_label}")

print(
    "BYOK cookie behavioral proof repair PASS: exact hardened HTTPS Set-Cookie "
    "contract retained; document.cookie secrecy + subsequent Cookie-header "
    "transmission replace unreliable BrowserContext metadata assertion."
)
print("BYOK cookie behavioral safeguard + two deliberate mutations installed.")
