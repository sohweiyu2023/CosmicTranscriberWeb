from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
SAFARI = WORK / "tests" / "safari" / "safari-smoke.mjs"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"

LABEL = "real Safari smoke uses HTTPS mock origin and explicit insecure-cert test capability"
HTTPS_MARKER = "CTW_REAL_SAFARI_HTTPS"
TLS_MARKER = "CTW_REAL_SAFARI_LOCALHOST_TLS_ONLY"
TLS_LINE = "process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'; // CTW_REAL_SAFARI_LOCALHOST_TLS_ONLY"


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
# smoke harness owns its own loopback origin and must move with that protocol.
#
# The harness is allowed to spell loopback as either localhost or 127.0.0.1.
# Bind the candidate to the variable explicitly passed as COSMIC_E2E_PORT so a
# separate plain-HTTP SafariDriver control endpoint can never be upgraded by
# accident.
safari = read(SAFARI)
if HTTPS_MARKER in safari or TLS_MARKER in safari:
    fail("Real-Safari HTTPS/TLS repair marker unexpectedly already present")

http_hits = list(
    re.finditer(
        r"http://(?P<host>localhost|127\.0\.0\.1):\$\{(?P<var>[A-Za-z_$][A-Za-z0-9_$]*)\}",
        safari,
    )
)
if not http_hits:
    fail("Real-Safari smoke no longer contains a reviewed HTTP loopback template origin")

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
    # A single reviewed HTTP loopback template is safe only when there is no
    # competing SafariDriver template that could be confused with the mock.
    hit = http_hits[0]
else:
    fail(
        "Could not uniquely bind real-Safari mock origin to COSMIC_E2E_PORT: "
        f"{len(http_hits)} loopback HTTP templates, {len(candidates)} port-bound candidates"
    )

old_origin = hit.group(0)
new_origin = "https://" + old_origin[len("http://") :]
safari = safari[: hit.start()] + new_origin + safari[hit.end() :]

# Mark the exact repaired origin line so static and mutation gates bind to this
# Safari-specific contract rather than to another unrelated loopback URL.
origin_line_re = re.compile(rf"(?m)^(?P<line>[^\n]*{re.escape(new_origin)}[^\n]*)$")
origin_lines = list(origin_line_re.finditer(safari))
if len(origin_lines) != 1:
    fail(f"Derived real-Safari HTTPS origin line count drifted: {len(origin_lines)}")
origin_line = origin_lines[0].group("line")
repaired_origin_line = origin_line + f" // {HTTPS_MARKER}"
safari = safari[: origin_lines[0].start()] + repaired_origin_line + safari[origin_lines[0].end() :]

# The Node side of this dedicated test process also probes the ephemeral
# self-signed HTTPS loopback server. Disable certificate verification only in
# this test-only process, never in app, Worker, deployment, or release code.
imports = list(re.finditer(r"(?ms)^import\b.*?;[ \t]*(?:\r?\n|$)", safari))
if not imports:
    fail("Could not locate import block in real-Safari smoke for local TLS scoping")
insert_at = imports[-1].end()
safari = safari[:insert_at] + TLS_LINE + "\n" + safari[insert_at:]

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

if safari.count(HTTPS_MARKER) != 1 or safari.count(TLS_MARKER) != 1:
    fail("Real-Safari HTTPS/TLS markers were not installed exactly once")
if old_origin in safari:
    fail("Reviewed real-Safari HTTP mock origin survived HTTPS repair")
if safari.count(new_origin) != 1:
    fail(f"Derived real-Safari HTTPS mock origin count drifted: {safari.count(new_origin)}")
if safari.count(TLS_LINE) != 1:
    fail("Real-Safari Node TLS relaxation is missing or duplicated")
if len(re.findall(r"\bacceptInsecureCerts\s*:\s*true\b", safari)) != 1:
    fail("Safari WebDriver acceptInsecureCerts=true is missing or duplicated")
write(SAFARI, safari)

# Add source-level safeguard for all three pieces required by real Safari:
# protocol parity with the shared HTTPS mock, Node access to the ephemeral local
# certificate, and Safari's standard WebDriver insecure-cert session capability.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Stable real-Safari audit insertion anchor drifted: {audit.count(audit_anchor)}")
if LABEL in audit:
    fail(f"Real-Safari safeguard unexpectedly already present: {LABEL}")
check = (
    f'    ,["{LABEL}", () => '
    f's("tests/safari/safari-smoke.mjs").includes({json.dumps(HTTPS_MARKER)})'
    f' && s("tests/safari/safari-smoke.mjs").includes({json.dumps(TLS_LINE)})'
    ' && /https:\\/\\/(?:localhost|127\\.0\\.0\\.1):\\$\\{/.test(s("tests/safari/safari-smoke.mjs"))'
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
        "restore real Safari Node certificate verification for ephemeral test cert -> " + LABEL,
        "tests/safari/safari-smoke.mjs",
        TLS_LINE,
        "process.env.NODE_TLS_REJECT_UNAUTHORIZED='1'; // CTW_REAL_SAFARI_LOCALHOST_TLS_ONLY",
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
if final_safari.count(HTTPS_MARKER) != 1 or final_safari.count(new_origin) != 1:
    fail("Final real-Safari HTTPS binding missing or duplicated")
if final_safari.count(TLS_LINE) != 1:
    fail("Final test-local Node TLS allowance missing or duplicated")
if len(re.findall(r"\bacceptInsecureCerts\s*:\s*true\b", final_safari)) != 1:
    fail("Final Safari insecure-cert WebDriver capability missing or duplicated")
if final_audit.count(f'"{LABEL}"') != 1:
    fail("Final real-Safari safeguard missing or duplicated")
for mutation_label, _, _, _ in mutation_specs:
    if final_mutations.count(mutation_label) != 1:
        fail(f"Final real-Safari mutation missing or duplicated: {mutation_label}")

print(
    "Real Safari HTTPS harness repair PASS: Safari mock origin follows the shared HTTPS server, "
    "the dedicated Node smoke process accepts only its ephemeral self-signed test path, "
    "and WebDriver requests acceptInsecureCerts for Safari navigation."
)
print("Real Safari HTTPS safeguard + three deliberate mutations installed.")
