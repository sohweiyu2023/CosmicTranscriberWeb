from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
INTEGRATION = WORK / "tests" / "integration" / "worker.test.js"
OPENAI = WORK / "src" / "openai.js"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"Redirect repair required file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"Redirect repair expected UTF-8 file: {path}")
        raise


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def matching_paren(text: str, open_index: int) -> int:
    depth = 0
    state = "normal"
    i = open_index
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if state in {"single", "double", "template"}:
            quote = {"single": "'", "double": '"', "template": "`"}[state]
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
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
        elif ch == '"':
            state = "double"
        elif ch == "`":
            state = "template"
        elif ch == "/" and nxt == "/":
            state = "line-comment"
            i += 1
        elif ch == "/" and nxt == "*":
            state = "block-comment"
            i += 1
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    fail("Could not find end of outbound OpenAI fetch() call")
    raise AssertionError("unreachable")


# Preserve the reviewed integration harness policy.
integration = read(INTEGRATION)
policies = list(re.finditer(r"onUnhandledRequest\s*:\s*['\"]error['\"]", integration))
listens = list(re.finditer(r"(?m)^\s*await\s+([A-Za-z_$][\w$]*)\.listen\(\)\s*;\s*$", integration))
if len(policies) != 1 or len(listens) != 1:
    fail(f"Integration harness policy/listen drift: policies={len(policies)} listens={len(listens)}")
msw_listen = integration.rfind(".listen(", 0, policies[0].start())
if msw_listen < 0 or integration.rfind("\n", 0, msw_listen) + 1 > listens[0].start():
    fail("Integration harness must start MSW before Wrangler listen()")
for marker in ("CTW_DIAGNOSTIC_ONLY", "CTW_UPSTREAM_FETCH_EXCEPTION"):
    if marker in integration:
        fail(f"Temporary diagnostic marker unexpectedly present: {marker}")
for assertion in (
    "OpenAI MSW mock must be reached exactly once",
    "redirect MSW mock must be reached exactly once",
):
    if integration.count(assertion) != 1:
        fail(f"Integration assertion missing or duplicated: {assertion}")


# Current workerd rejects Request.redirect="error". Replace only the unique
# outbound fetch option with "manual" and wrap that exact fetch call so every
# 3xx is rejected before the response can reach production parsing logic.
source = read(OPENAI)
if "CTW_WORKER_REDIRECT_FAIL_CLOSED" in source:
    fail("Reviewed source unexpectedly already contains redirect repair")
redirect_re = re.compile(r'\bredirect\s*:\s*(?P<q>["\'])error(?P=q)')
redirects = list(redirect_re.finditer(source))
if len(redirects) != 1:
    fail(f'Expected exactly one redirect:"error" option; found {len(redirects)}')
redirect = redirects[0]
fetch_re = re.compile(r"(?<![\w$])(?:[A-Za-z_$][\w$]*\.)*fetch\s*\(")
fetches = list(fetch_re.finditer(source, 0, redirect.start()))
if not fetches:
    fail('Could not locate fetch() before redirect:"error" option')
fetch_match = fetches[-1]
open_paren = source.find("(", fetch_match.start(), fetch_match.end())
close_paren = matching_paren(source, open_paren)
if not (open_paren < redirect.start() < close_paren):
    fail('Nearest fetch() does not contain unique redirect:"error" option')
call = source[fetch_match.start(): close_paren + 1]
manual_call, replaced = redirect_re.subn('redirect: "manual"', call)
if replaced != 1:
    fail(f"Expected one redirect replacement inside target fetch(); got {replaced}")
line_start = source.rfind("\n", 0, fetch_match.start()) + 1
base_indent = re.match(r"[ \t]*", source[line_start:fetch_match.start()]).group(0)
inner = base_indent + "  "
var = "ctwRedirectResponse"
guard = "\n".join([
    f"{inner}// CTW_WORKER_REDIRECT_FAIL_CLOSED",
    f"{inner}if ({var}.status >= 300 && {var}.status <= 399) {{",
    f'{inner}  throw new Error("Unexpected OpenAI redirect blocked after dispatch.");',
    f"{inner}}}",
])
wrapper = (
    "(async () => {\n"
    f"{inner}const {var} = await {manual_call};\n"
    f"{guard}\n"
    f"{inner}return {var};\n"
    f"{base_indent}}})()"
)
source = source[:fetch_match.start()] + wrapper + source[close_paren + 1:]
if source.count('redirect: "manual"') != 1 or redirect_re.search(source):
    fail("Derived source redirect mode invariant failed")
if source.count("CTW_WORKER_REDIRECT_FAIL_CLOSED") != 1 or source.count(f"return {var};") != 1:
    fail("Derived source fail-closed wrapper invariant failed")
write(OPENAI, source)


# Narrowly migrate tests that inspect the request redirect mode itself.
def manual_value(match: re.Match[str]) -> str:
    return match.group(1) + match.group(2) + "manual" + match.group(2)

patterns = [
    re.compile(r'(\bredirect\s*:\s*)(["\'])error\2'),
    re.compile(r'(\.redirect\s*,\s*)(["\'])error\2'),
    re.compile(r'(\.redirect\s*===?\s*)(["\'])error\2'),
    re.compile(r'(\.redirect\)\.(?:toBe|toEqual)\(\s*)(["\'])error\2'),
]
test_changes: list[str] = []
for path in sorted(WORK.joinpath("tests").rglob("*")):
    if not path.is_file() or path.suffix.lower() not in {".js", ".mjs", ".cjs"}:
        continue
    before = read(path)
    after = before
    for pattern in patterns:
        after = pattern.sub(manual_value, after)
    if after != before:
        write(path, after)
        test_changes.append(path.relative_to(WORK).as_posix())


# Strengthen the source's own static redirect safeguard.
audit = read(AUDIT)
audit_re = re.compile(r'(?m)^(?P<prefix>[ \t]*,?[ \t]*)\["redirect errors".*$')
audit_hits = list(audit_re.finditer(audit))
if len(audit_hits) != 1:
    fail(f'Static safeguard "redirect errors" count drifted: {len(audit_hits)}')
hit = audit_hits[0]
replacement = (
    hit.group("prefix")
    + '["redirect errors", () => '
    + 's("src/openai.js").includes(\'redirect: "manual"\')'
    + f' && s("src/openai.js").includes({json.dumps(guard)})'
    + f' && s("src/openai.js").includes({json.dumps(f"return {var};")})'
    + ' && !s("src/openai.js").includes(\'redirect: "error"\')]'
)
audit = audit[:hit.start()] + replacement + audit[hit.end():]
write(AUDIT, audit)


# Strengthen mutation coverage: insecure follow mode and removal of the explicit
# all-3xx guard must both be detected by the static safeguard.
mutations = read(MUTATIONS)
mutation_re = re.compile(r'(?m)^(?P<indent>[ \t]*)\["follow redirects -> redirect errors".*$')
mutation_hits = list(mutation_re.finditer(mutations))
if len(mutation_hits) != 1:
    fail(f'Redirect mutation count drifted: {len(mutation_hits)}')
hit = mutation_hits[0]
mi = hit.group("indent")
replacement = (
    f'{mi}["follow redirects -> redirect errors", "src/openai.js", /redirect: "manual"/, \'redirect: "follow"\'],\n'
    f'{mi}["remove explicit redirect status rejection -> redirect errors", "src/openai.js", '
    r'/\/\/ CTW_WORKER_REDIRECT_FAIL_CLOSED\n\s*if \(ctwRedirectResponse\.status >= 300 && ctwRedirectResponse\.status <= 399\) \{\n\s*throw new Error\("Unexpected OpenAI redirect blocked after dispatch\."\);\n\s*\}/, ""],'
)
mutations = mutations[:hit.start()] + replacement + mutations[hit.end():]
write(MUTATIONS, mutations)

if read(AUDIT).count('"redirect errors"') != 1:
    fail('Final static redirect safeguard count drifted')
if read(MUTATIONS).count("follow redirects -> redirect errors") != 1:
    fail("Final follow-redirect mutation count drifted")
if read(MUTATIONS).count("remove explicit redirect status rejection -> redirect errors") != 1:
    fail("Explicit redirect-guard removal mutation missing or duplicated")

print(f"Integration harness verification PASS: harness={listens[0].group(1)}; MSW precedes Wrangler.")
print('Worker redirect repair PASS: redirect="manual" + checked all-3xx fail-closed wrapper.')
print('Static redirect safeguard + two redirect mutations PASS.')
if test_changes:
    print("Redirect-mode test migrations: " + ", ".join(test_changes))
else:
    print("No standalone redirect-mode test expectation required migration.")
