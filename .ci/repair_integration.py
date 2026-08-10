from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
INTEGRATION_TEST = WORK / "tests" / "integration" / "worker.test.js"
OPENAI_SOURCE = WORK / "src" / "openai.js"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"Redirect compatibility repair required file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"Redirect compatibility repair expected UTF-8 file: {path}")
        raise


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def find_matching_paren(text: str, open_index: int) -> int:
    if open_index < 0 or open_index >= len(text) or text[open_index] != "(":
        fail("Internal redirect repair error: fetch call opening parenthesis not found")
    depth = 0
    state = "normal"
    i = open_index
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""

        if state == "single":
            if ch == "\\":
                i += 2
                continue
            if ch == "'":
                state = "normal"
            i += 1
            continue
        if state == "double":
            if ch == "\\":
                i += 2
                continue
            if ch == '"':
                state = "normal"
            i += 1
            continue
        if state == "template":
            if ch == "\\":
                i += 2
                continue
            if ch == "`":
                state = "normal"
            i += 1
            continue
        if state == "line-comment":
            if ch == "\n":
                state = "normal"
            i += 1
            continue
        if state == "block-comment":
            if ch == "*" and nxt == "/":
                state = "normal"
                i += 2
                continue
            i += 1
            continue

        if ch == "'":
            state = "single"
            i += 1
            continue
        if ch == '"':
            state = "double"
            i += 1
            continue
        if ch == "`":
            state = "template"
            i += 1
            continue
        if ch == "/" and nxt == "/":
            state = "line-comment"
            i += 2
            continue
        if ch == "/" and nxt == "*":
            state = "block-comment"
            i += 2
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
            if depth < 0:
                break
        i += 1
    fail("Could not find the end of the outbound OpenAI fetch() call")
    raise AssertionError("unreachable")


# ---------------------------------------------------------------------------
# Verify the reviewed whole-Worker integration harness still fails closed.
# ---------------------------------------------------------------------------
integration = read(INTEGRATION_TEST)
policy_matches = list(
    re.finditer(r"onUnhandledRequest\s*:\s*['\"]error['\"]", integration)
)
if len(policy_matches) != 1:
    fail(
        "Expected exactly one MSW onUnhandledRequest:error policy; "
        f"found {len(policy_matches)}"
    )
policy_match = policy_matches[0]

harness_matches = list(
    re.finditer(r"(?m)^\s*await\s+([A-Za-z_$][\w$]*)\.listen\(\)\s*;\s*$", integration)
)
if len(harness_matches) != 1:
    fail(
        "Expected exactly one awaited Wrangler harness listen(); "
        f"found {len(harness_matches)}"
    )
harness_match = harness_matches[0]
harness_name = harness_match.group(1)

listen_start = integration.rfind(".listen(", 0, policy_match.start())
if listen_start < 0:
    fail("Could not locate MSW listen() call owning onUnhandledRequest:error")
msw_line_start = integration.rfind("\n", 0, listen_start) + 1
if msw_line_start > harness_match.start():
    fail("Integration harness must start MSW interception before Wrangler listen()")

if "CTW_DIAGNOSTIC_ONLY" in integration:
    fail("Diagnostic release sentinel unexpectedly present in reviewed integration test")
if "CTW_UPSTREAM_FETCH_EXCEPTION" in integration:
    fail("Temporary upstream diagnostic unexpectedly present in reviewed integration test")
if integration.count("OpenAI MSW mock must be reached exactly once") != 1:
    fail("Successful outbound MSW hit-count assertion is missing or duplicated")
if integration.count("redirect MSW mock must be reached exactly once") != 1:
    fail("Redirect outbound MSW hit-count assertion is missing or duplicated")


# ---------------------------------------------------------------------------
# Repair the real Worker incompatibility discovered by hosted certification.
#
# Current workerd rejects Request.redirect="error". Preserve fail-closed redirect
# security by using "manual" and rejecting every 3xx immediately after fetch(),
# before any upstream response body is consumed or trusted.
# ---------------------------------------------------------------------------
openai = read(OPENAI_SOURCE)
if "CTW_WORKER_REDIRECT_FAIL_CLOSED" in openai:
    fail("Reviewed OpenAI source unexpectedly already contains redirect compatibility repair")

redirect_pattern = re.compile(r'\bredirect\s*:\s*(?P<quote>["\'])error(?P=quote)')
redirect_matches = list(redirect_pattern.finditer(openai))
if len(redirect_matches) != 1:
    fail(
        'Expected exactly one outbound redirect:"error" option in src/openai.js; '
        f"found {len(redirect_matches)}"
    )
redirect_match = redirect_matches[0]

assignment_pattern = re.compile(
    r"(?m)^(?P<indent>[ \t]*)(?:const|let)\s+"
    r"(?P<var>[A-Za-z_$][\w$]*)\s*=\s*await\s+fetch\s*\("
)
assignments = [
    match for match in assignment_pattern.finditer(openai, 0, redirect_match.start())
]
if not assignments:
    fail("Could not locate the outbound OpenAI await fetch() assignment")
assignment = assignments[-1]
open_paren = openai.find("(", assignment.start(), assignment.end())
close_paren = find_matching_paren(openai, open_paren)
if not (open_paren < redirect_match.start() < close_paren):
    fail('The unique redirect:"error" option is not inside the located outbound fetch() call')

cursor = close_paren + 1
while cursor < len(openai) and openai[cursor] in " \t\r\n":
    cursor += 1
if cursor >= len(openai) or openai[cursor] != ";":
    fail("Outbound OpenAI fetch() assignment must end in a semicolon")
statement_end = cursor + 1

call_text = openai[assignment.start():statement_end]
manual_call, replaced = redirect_pattern.subn('redirect: "manual"', call_text)
if replaced != 1:
    fail(f"Expected one redirect mode replacement in outbound fetch; got {replaced}")

indent = assignment.group("indent")
response_var = assignment.group("var")
guard_lines = [
    f"{indent}// CTW_WORKER_REDIRECT_FAIL_CLOSED",
    f"{indent}if ({response_var}.status >= 300 && {response_var}.status <= 399) {{",
    f'{indent}  throw new Error("Unexpected OpenAI redirect blocked after dispatch.");',
    f"{indent}}}",
]
guard_block = "\n".join(guard_lines)

openai = (
    openai[:assignment.start()]
    + manual_call
    + "\n"
    + guard_block
    + openai[statement_end:]
)
if openai.count('redirect: "manual"') != 1:
    fail('Derived OpenAI source must contain exactly one redirect: "manual" option')
if redirect_pattern.search(openai):
    fail('Derived OpenAI source still contains redirect: "error"')
if openai.count("CTW_WORKER_REDIRECT_FAIL_CLOSED") != 1:
    fail("Derived OpenAI source redirect guard was not installed exactly once")
write(OPENAI_SOURCE, openai)


# ---------------------------------------------------------------------------
# Migrate narrow test expectations that asserted the now-unsupported workerd
# redirect mode. Do not alter unrelated error handling.
# ---------------------------------------------------------------------------
test_changes: list[str] = []


def manual_value(match: re.Match[str]) -> str:
    return match.group(1) + match.group(2) + "manual" + match.group(2)


test_patterns = [
    re.compile(r'(\bredirect\s*:\s*)(["\'])error\2'),
    re.compile(r'(\.redirect\s*,\s*)(["\'])error\2'),
    re.compile(r'(\.redirect\s*===?\s*)(["\'])error\2'),
    re.compile(r'(\.redirect\)\.(?:toBe|toEqual)\(\s*)(["\'])error\2'),
]

for path in sorted(WORK.joinpath("tests").rglob("*")):
    if not path.is_file() or path.suffix.lower() not in {".js", ".mjs", ".cjs"}:
        continue
    before = read(path)
    after = before
    for pattern in test_patterns:
        after = pattern.sub(manual_value, after)
    if after != before:
        write(path, after)
        test_changes.append(path.relative_to(WORK).as_posix())


# ---------------------------------------------------------------------------
# Strengthen the static safeguard: "manual" alone is not sufficient; the exact
# immediate all-3xx rejection block is mandatory.
# ---------------------------------------------------------------------------
audit = read(AUDIT)
audit_line_pattern = re.compile(
    r'(?m)^(?P<prefix>[ \t]*,?[ \t]*)\["redirect errors".*$'
)
audit_matches = list(audit_line_pattern.finditer(audit))
if len(audit_matches) != 1:
    fail(
        'Expected exactly one static safeguard named "redirect errors"; '
        f"found {len(audit_matches)}"
    )
audit_match = audit_matches[0]
source_guard_literal = json.dumps(guard_block)
audit_replacement = (
    audit_match.group("prefix")
    + '["redirect errors", () => '
    + 's("src/openai.js").includes(\'redirect: "manual"\')'
    + f' && s("src/openai.js").includes({source_guard_literal})'
    + ' && !s("src/openai.js").includes(\'redirect: "error"\')]'
)
audit = (
    audit[:audit_match.start()]
    + audit_replacement
    + audit[audit_match.end():]
)
write(AUDIT, audit)


# ---------------------------------------------------------------------------
# Migrate the original redirect mutation from unsupported "error" -> "follow"
# to secure "manual" -> insecure "follow", and add a second mutation that
# removes the explicit 3xx guard. Both must be caught by the strengthened audit.
# ---------------------------------------------------------------------------
mutations = read(MUTATIONS)
mutation_line_pattern = re.compile(
    r'(?m)^(?P<indent>[ \t]*)\["follow redirects -> redirect errors".*$'
)
mutation_matches = list(mutation_line_pattern.finditer(mutations))
if len(mutation_matches) != 1:
    fail(
        'Expected exactly one mutation named "follow redirects -> redirect errors"; '
        f"found {len(mutation_matches)}"
    )
mutation_match = mutation_matches[0]
mi = mutation_match.group("indent")
mutation_replacement = (
    f'{mi}["follow redirects -> redirect errors", "src/openai.js", '
    '/redirect: "manual"/, \'redirect: "follow"\'],'
    "\n"
    f'{mi}["remove explicit redirect status rejection -> redirect errors", '
    '"src/openai.js", '
    r'/\/\/ CTW_WORKER_REDIRECT_FAIL_CLOSED\n\s*if \([A-Za-z_$][\w$]*\.status >= 300 && [A-Za-z_$][\w$]*\.status <= 399\) \{\n\s*throw new Error\("Unexpected OpenAI redirect blocked after dispatch\."\);\n\s*\}/, ""],'
)
mutations = (
    mutations[:mutation_match.start()]
    + mutation_replacement
    + mutations[mutation_match.end():]
)
write(MUTATIONS, mutations)


# Final fail-closed verification over the derived tree.
if read(AUDIT).count('"redirect errors"') != 1:
    fail('Static "redirect errors" safeguard count drifted after migration')
if read(MUTATIONS).count("follow redirects -> redirect errors") != 1:
    fail("Follow-redirect mutation count drifted after migration")
if read(MUTATIONS).count("remove explicit redirect status rejection -> redirect errors") != 1:
    fail("Explicit redirect-guard removal mutation was not installed exactly once")
if "CTW_DIAGNOSTIC_ONLY" in read(INTEGRATION_TEST):
    fail("Diagnostic sentinel must not survive permanent redirect repair")

print(
    "Integration harness verification PASS: MSW precedes Wrangler listen; "
    f"harness={harness_name}."
)
print(
    'Worker redirect compatibility repair PASS: redirect="manual" + immediate '
    "all-3xx fail-closed rejection."
)
print('Static "redirect errors" safeguard strengthened for manual + explicit 3xx rejection.')
print("Redirect mutation coverage strengthened with explicit guard-removal mutation.")
if test_changes:
    print(
        "Migrated unsupported redirect-mode expectations in "
        f"{len(test_changes)} test file(s):"
    )
    for rel in test_changes:
        print(f"  migrated: {rel}")
else:
    print("No standalone test expectation required redirect-mode migration.")
