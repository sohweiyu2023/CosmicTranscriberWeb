from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
SAFARI = WORK / "tests" / "safari" / "safari-smoke.mjs"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"
OUTER_WORKFLOW = ROOT / ".github" / "workflows" / "certify.yml"

LABEL = "real Safari smoke uses HTTPS mock origin and explicit insecure-cert test capability"
HTTPS_MARKER = "CTW_REAL_SAFARI_HTTPS"
TLS_ENV = "NODE_TLS_REJECT_UNAUTHORIZED: '0'"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"Real-Safari certification repair required file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"Real-Safari certification repair expected UTF-8 file: {path}")
        raise


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def js_regex_exact(text: str) -> str:
    if "\n" in text or "\r" in text:
        fail("js_regex_exact only supports one-line targets")
    return "/" + re.sub(r"([\\^$.*+?()\[\]{}|/])", r"\\\1", text) + "/"


# repair_e2e.py deliberately converted the shared E2E mock server to HTTPS so
# Secure __Host cookies are exercised correctly. The separate native-Safari
# smoke harness owns its own localhost origin and must move with that protocol.
safari = read(SAFARI)
if HTTPS_MARKER in safari:
    fail("Real-Safari HTTPS repair marker unexpectedly already present")

http_hits = list(re.finditer(r"http://localhost:\$\{(?P<var>[A-Za-z_$][A-Za-z0-9_$]*)\}", safari))
if not http_hits:
    fail("Real-Safari smoke no longer contains the reviewed HTTP localhost template origin")

# Prefer the localhost template whose port variable is explicitly passed to the
# shared mock server as COSMIC_E2E_PORT. This avoids touching SafariDriver's own
# local WebDriver REST endpoint if that endpoint also uses HTTP.
candidates = []
for hit in http_hits:
    var = hit.group("var")
    escaped = re.escape(var)
    if (
        re.search(rf"COSMIC_E2E_PORT[^\n]{{0,160}}\b{escaped}\b", safari)
        or re.search(rf"\b{escaped}\b[^\n]{{0,160}}COSMIC_E2E_PORT", safari)
    ):
        candidates.append(hit)
if len(candidates) == 1:
    hit = candidates[0]
elif len(http_hits) == 1:
    hit = http_hits[0]
else:
    fail(
        "Could not uniquely bind real-Safari mock origin to COSMIC_E2E_PORT: "
        f"{len(http_hits)} localhost HTTP templates, {len(candidates)} port-bound candidates"
    )

old_origin = hit.group(0)
new_origin = "https://" + old_origin[len("http://") :]
safari = safari[: hit.start()] + new_origin + safari[hit.end() :]

# Mark the exact repaired origin line so static and mutation gates bind to this
# Safari-specific contract rather than to another unrelated localhost URL.
origin_line_re = re.compile(rf"(?m)^(?P<line>[^\n]*{re.escape(new_origin)}[^\n]*)$")
origin_lines = list(origin_line_re.finditer(safari))
if len(origin_lines) != 1:
    fail(f"Derived real-Safari HTTPS origin line count drifted: {len(origin_lines)}")
origin_line = origin_lines[0].group("line")
if "//" in origin_line:
    repaired_origin_line = origin_line + f" {HTTPS_MARKER}"
else:
    repaired_origin_line = origin_line + f" // {HTTPS_MARKER}"
safari = safari[: origin_lines[0].start()] + repaired_origin_line + safari[origin_lines[0].end() :]

# W3C WebDriver defines acceptInsecureCerts for self-signed/untrusted TLS during
# navigation. Add it only to the Safari New Session capability object.
if re.search(r"\bacceptInsecureCerts\s*:\s*true\b", safari):
    pass
else:
    browser_patterns = [
        re.compile(r"(?P<browser>browserName\s*:\s*['\"]Safari['\"])(?P<tail>\s*)"),
        re.compile(r"(?P<browser>['\"]browserName['\"]\s*:\s*['\"]Safari['\"])(?P<tail>\s*)"),
    ]
    browser_hits = []
    chosen = None
    for pattern in browser_patterns:
        hits = list(pattern.finditer(safari))
        browser_hits.extend(hits)
        if len(hits) == 1 and chosen is None:
            chosen = hits[0]
    if chosen is not None and len(browser_hits) == 1:
        browser = chosen.group("browser")
        safari = safari[: chosen.start()] + browser + ",acceptInsecureCerts:true" + safari[chosen.end() :]
    else:
        always = list(re.finditer(r"(?:alwaysMatch|['\"]alwaysMatch['\"])\s*:\s*\{", safari))
        if len(always) != 1:
            fail(
                "Could not uniquely locate Safari WebDriver capabilities for acceptInsecureCerts: "
                f"browserName hits={len(browser_hits)}, alwaysMatch hits={len(always)}"
            )
        insert_at = always[0].end()
        safari = safari[:insert_at] + "acceptInsecureCerts:true," + safari[insert_at:]

if safari.count(HTTPS_MARKER) != 1:
    fail("Real-Safari HTTPS marker was not installed exactly once")
if old_origin in safari:
    fail("Reviewed real-Safari HTTP mock origin survived HTTPS repair")
if safari.count(new_origin) != 1:
    fail(f"Derived real-Safari HTTPS mock origin count drifted: {safari.count(new_origin)}")
if len(re.findall(r"\bacceptInsecureCerts\s*:\s*true\b", safari)) != 1:
    fail("Safari WebDriver acceptInsecureCerts=true is missing or duplicated")
write(SAFARI, safari)

# Node's own health probe must accept the ephemeral self-signed localhost test
# certificate too. Keep that relaxation scoped to this single CI step; never set
# it globally for validation, dependency resolution, deployment, or production.
workflow = read(OUTER_WORKFLOW)
step_anchor = "      - name: Real Safari WebDriver smoke\n        working-directory: work\n        run: npm run test:safari:real"
step_replacement = (
    "      - name: Real Safari WebDriver smoke\n"
    "        working-directory: work\n"
    "        env:\n"
    f"          {TLS_ENV}\n"
    "        run: npm run test:safari:real"
)
if workflow.count(step_anchor) != 1:
    fail(f"Real Safari workflow step anchor drifted: {workflow.count(step_anchor)}")
if TLS_ENV in workflow:
    fail("Real Safari Node TLS test relaxation unexpectedly already present")
workflow = workflow.replace(step_anchor, step_replacement, 1)
if workflow.count(TLS_ENV) != 1:
    fail("Node TLS self-signed relaxation is not scoped exactly once to real Safari smoke")
write(OUTER_WORKFLOW, workflow)

# Add source-level safeguard for the shipped Safari smoke harness. Workflow
# scoping is also verified directly by this repair before any hosted test runs.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Stable real-Safari audit insertion anchor drifted: {audit.count(audit_anchor)}")
if LABEL in audit:
    fail(f"Real-Safari safeguard unexpectedly already present: {LABEL}")
check = (
    f'    ,["{LABEL}", () => '
    f's("tests/safari/safari-smoke.mjs").includes({json.dumps(HTTPS_MARKER)})'
    ' && s("tests/safari/safari-smoke.mjs").includes("https://localhost:${")'
    ' && s("tests/safari/safari-smoke.mjs").includes("acceptInsecureCerts:true")]\n'
)
audit = audit.replace(audit_anchor, check + audit_anchor, 1)
write(AUDIT, audit)

mutations = read(MUTATIONS)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable real-Safari mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")
mutation_specs = [
    (
        "downgrade real Safari mock origin to HTTP -> " + LABEL,
        "tests/safari/safari-smoke.mjs",
        new_origin,
        old_origin,
    ),
    (
        "disable real Safari insecure-cert session capability -> " + LABEL,
        "tests/safari/safari-smoke.mjs",
        "acceptInsecureCerts:true",
        "acceptInsecureCerts:false",
    ),
]
for mutation_label, _, _, _ in mutation_specs:
    if mutation_label in mutations:
        fail(f"Real-Safari mutation unexpectedly already present: {mutation_label}")
entries = [
    f'  [{json.dumps(label)}, {json.dumps(path)}, {js_regex_exact(target)}, {json.dumps(replacement)}],'
    for label, path, target, replacement in mutation_specs
]
mutations = mutations.replace(mutation_anchor, "\n".join(entries) + "\n" + mutation_anchor, 1)
write(MUTATIONS, mutations)

final_safari = read(SAFARI)
final_audit = read(AUDIT)
final_mutations = read(MUTATIONS)
final_workflow = read(OUTER_WORKFLOW)
if final_safari.count(HTTPS_MARKER) != 1 or final_safari.count(new_origin) != 1:
    fail("Final real-Safari HTTPS binding missing or duplicated")
if len(re.findall(r"\bacceptInsecureCerts\s*:\s*true\b", final_safari)) != 1:
    fail("Final Safari insecure-cert WebDriver capability missing or duplicated")
if final_workflow.count(TLS_ENV) != 1:
    fail("Final Node self-signed TLS relaxation is not single-step scoped")
if final_audit.count(f'"{LABEL}"') != 1:
    fail("Final real-Safari safeguard missing or duplicated")
for mutation_label, _, _, _ in mutation_specs:
    if final_mutations.count(mutation_label) != 1:
        fail(f"Final real-Safari mutation missing or duplicated: {mutation_label}")

print(
    "Real Safari HTTPS harness repair PASS: Safari mock origin follows the shared HTTPS server, "
    "WebDriver requests acceptInsecureCerts for the ephemeral self-signed localhost certificate, "
    "and Node TLS relaxation is scoped only to the native-Safari smoke step."
)
print("Real Safari HTTPS safeguard + two deliberate mutations installed.")
