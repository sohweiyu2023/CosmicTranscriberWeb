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


# Preserve the reviewed whole-Worker integration contract.
integration = read(INTEGRATION)
policies = list(re.finditer(r'onUnhandledRequest\s*:\s*["\']error["\']', integration))
wrangler_listens = list(re.finditer(r'(?m)^\s*await\s+([A-Za-z_$][\w$]*)\.listen\(\)\s*;\s*$', integration))
if len(policies) != 1 or len(wrangler_listens) != 1:
    fail(f"Integration harness policy/listen drift: policies={len(policies)} listens={len(wrangler_listens)}")
msw_listen = integration.rfind(".listen(", 0, policies[0].start())
if msw_listen < 0 or integration.rfind("\n", 0, msw_listen) + 1 > wrangler_listens[0].start():
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


# Hosted evidence from the exact pinned 1.0.12 snapshot shows:
#   response = await fetchImpl(OPENAI_TRANSCRIPT_URL, { ... redirect: "error" ... });
# Current workerd rejects redirect="error". Preserve the no-redirect policy with
# manual handling and an immediate all-3xx rejection before reading any body.
source = read(OPENAI)
if "CTW_WORKER_REDIRECT_FAIL_CLOSED" in source:
    fail("Reviewed source unexpectedly already contains redirect repair")

redirect_re = re.compile(r'\bredirect\s*:\s*(?P<q>["\'])error(?P=q)')
redirects = list(redirect_re.finditer(source))
if len(redirects) != 1:
    fail(f'Expected exactly one redirect:"error" option; found {len(redirects)}')
redirect = redirects[0]

assignments = list(re.finditer(
    r'(?m)^(?P<indent>[ \t]*)(?P<var>[A-Za-z_$][\w$]*)\s*=\s*await\s+fetchImpl\s*\(',
    source[:redirect.start()],
))
if len(assignments) != 1:
    fail(f"Expected exactly one reviewed response = await fetchImpl(...) assignment; found {len(assignments)}")
assignment = assignments[0]
response_var = assignment.group("var")
indent = assignment.group("indent")

# The first `});` line after the redirect option is the reviewed fetchImpl call
# terminator. Require exactly the expected indentation relationship.
terminator_re = re.compile(r'(?m)^(?P<indent>[ \t]*)\}\);\s*$')
terminator = terminator_re.search(source, redirect.end())
if terminator is None:
    fail("Could not locate reviewed fetchImpl call terminator after redirect option")
if terminator.group("indent") != indent:
    fail("Reviewed fetchImpl terminator indentation drifted")

source, changed = redirect_re.subn('redirect: "manual"', source, count=1)
if changed != 1:
    fail(f"Expected one redirect replacement; got {changed}")

# Re-find terminator after equal-length replacement.
terminator = terminator_re.search(source, redirect.end())
if terminator is None:
    fail("Could not re-locate fetchImpl terminator after redirect replacement")
guard = "\n".join([
    f"{indent}// CTW_WORKER_REDIRECT_FAIL_CLOSED",
    f"{indent}if ({response_var}.status >= 300 && {response_var}.status <= 399) {{",
    f'{indent}  throw new Error("Unexpected OpenAI redirect blocked after dispatch.");',
    f"{indent}}}",
])
insert_at = terminator.end()
source = source[:insert_at] + "\n" + guard + source[insert_at:]
if source.count('redirect: "manual"') != 1 or redirect_re.search(source):
    fail("Derived source redirect mode invariant failed")
if source.count("CTW_WORKER_REDIRECT_FAIL_CLOSED") != 1:
    fail("Derived source fail-closed redirect guard invariant failed")
write(OPENAI, source)


# Migrate only tests that directly inspect the request redirect mode.
def manual_value(match: re.Match[str]) -> str:
    return match.group(1) + match.group(2) + "manual" + match.group(2)


test_patterns = [
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
    for pattern in test_patterns:
        after = pattern.sub(manual_value, after)
    if after != before:
        write(path, after)
        test_changes.append(path.relative_to(WORK).as_posix())


# Strengthen the source's existing static redirect safeguard.
audit = read(AUDIT)
audit_re = re.compile(r'(?m)^(?P<prefix>[ \t]*,?[ \t]*)\["redirect errors".*$')
audit_hits = list(audit_re.finditer(audit))
if len(audit_hits) != 1:
    fail(f'Static safeguard "redirect errors" count drifted: {len(audit_hits)}')
hit = audit_hits[0]
audit_replacement = (
    hit.group("prefix")
    + '["redirect errors", () => '
    + 's("src/openai.js").includes(\'redirect: "manual"\')'
    + f' && s("src/openai.js").includes({json.dumps(guard)})'
    + ' && !s("src/openai.js").includes(\'redirect: "error"\')]'
)
audit = audit[:hit.start()] + audit_replacement + audit[hit.end():]
write(AUDIT, audit)


# Migrate the existing follow-redirect mutation by its payload rather than its
# display label. Earlier validation proved the mutation exists, but its label is
# generated/non-literal in the source. Exactly one redirect-error target must be
# changed to manual; the insecure replacement remains "follow".
mutations = read(MUTATIONS)
target_forms = [
    ('redirect: "error"', 'redirect: "manual"'),
    ("redirect: 'error'", "redirect: 'manual'"),
    (r'redirect:\s*"error"', r'redirect:\s*"manual"'),
    (r"redirect:\s*'error'", r"redirect:\s*'manual'"),
]
hits = [(old, new, mutations.count(old)) for old, new in target_forms if mutations.count(old)]
total_hits = sum(count for _, _, count in hits)
if total_hits != 1:
    detail = ", ".join(f"{old}={count}" for old, _, count in hits) or "none"
    fail(f"Expected exactly one follow-redirect mutation payload target; found {total_hits} ({detail})")
for old, new, count in hits:
    if count:
        mutations = mutations.replace(old, new, 1)

# Add a second deliberate regression for removing the explicit all-3xx guard.
# This anchor is already required by materialize.py and therefore verified in
# the same derived mutation suite before this repair runs.
anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(anchor) != 1:
    fail(f"Stable mutation insertion anchor drifted: {mutations.count(anchor)}")
response_var_re = re.escape(response_var)
new_mutation = (
    '  ["remove explicit redirect status rejection -> redirect errors", "src/openai.js", '
    rf'/if \({response_var_re}\.status >= 300 && {response_var_re}\.status <= 399\) \{{\n\s*throw new Error\("Unexpected OpenAI redirect blocked after dispatch\."\);\n\s*\}}/, ""],'
)
mutations = mutations.replace(anchor, new_mutation + "\n" + anchor, 1)
write(MUTATIONS, mutations)

if read(AUDIT).count('"redirect errors"') != 1:
    fail("Final static redirect safeguard count drifted")
if read(MUTATIONS).count("remove explicit redirect status rejection -> redirect errors") != 1:
    fail("Explicit redirect-guard removal mutation missing or duplicated")
if any(old in read(MUTATIONS) for old, _ in target_forms):
    fail("Old redirect-error mutation payload target survived migration")

print(f"Integration harness verification PASS: harness={wrangler_listens[0].group(1)}; MSW precedes Wrangler.")
print(
    f'Worker redirect repair PASS: {response_var} = await fetchImpl(...) uses '
    'redirect="manual" + immediate all-3xx fail-closed rejection.'
)
print("Static redirect safeguard + payload-migrated follow mutation + explicit 3xx-guard mutation PASS.")
if test_changes:
    print("Redirect-mode test migrations: " + ", ".join(test_changes))
else:
    print("No standalone redirect-mode test expectation required migration.")
