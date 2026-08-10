from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
TEST = WORK / "tests" / "integration" / "worker.test.js"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATION = WORK / "scripts" / "mutation-suite.mjs"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"Integration repair required file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"Integration repair expected UTF-8 file: {path}")
        raise


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def js_regex_escape(text: str) -> str:
    # Escape a concrete already-reviewed source fragment for a JavaScript regex literal.
    out = []
    for ch in text:
        if ch == "\n":
            out.append(r"\n")
        elif ch == "\r":
            out.append(r"\r")
        elif ch in r"\\/^$.*+?()[]{}|":
            out.append("\\" + ch)
        else:
            out.append(ch)
    return "".join(out)


text = read(TEST)

# Cloudflare's current createTestHarness() integration documentation starts the
# Node request interceptor before server.listen(). The harness proxies Worker
# outbound fetches through Node globalThis.fetch, so make that ordering explicit
# and deterministic in the certified source.
on_unhandled_positions = [m.start() for m in re.finditer(r"onUnhandledRequest\s*:\s*['\"]error['\"]", text)]
if len(on_unhandled_positions) != 1:
    fail(f"Expected exactly one MSW onUnhandledRequest:error policy; found {len(on_unhandled_positions)}")
policy_pos = on_unhandled_positions[0]

listen_start = text.rfind(".listen(", 0, policy_pos)
if listen_start < 0:
    fail("Could not locate MSW listen() call owning onUnhandledRequest:error")
line_start = text.rfind("\n", 0, listen_start) + 1
# Find the end of the listen statement. The reviewed source uses a normal call
# statement; cap the search so an unrelated later statement cannot be moved.
statement_end = text.find(";", policy_pos)
if statement_end < 0 or statement_end - line_start > 500:
    fail("Could not bound the MSW listen() statement")
statement_end += 1
if statement_end < len(text) and text[statement_end] == "\n":
    statement_end += 1
msw_statement = text[line_start:statement_end]

harness_listens = list(re.finditer(r"(?m)^(?P<indent>\s*)await\s+(?P<name>[A-Za-z_$][\w$]*)\.listen\(\)\s*;\s*$", text))
if len(harness_listens) != 1:
    fail(f"Expected exactly one awaited Wrangler harness listen(); found {len(harness_listens)}")
harness_match = harness_listens[0]
harness_name = harness_match.group("name")
harness_line_start = harness_match.start()

moved = False
if line_start > harness_line_start:
    # Move the complete MSW listener statement immediately before the Wrangler
    # harness listener. Recompute the harness position after removal to avoid
    # stale offsets.
    text = text[:line_start] + text[statement_end:]
    harness_listens = list(re.finditer(r"(?m)^(?P<indent>\s*)await\s+(?P<name>[A-Za-z_$][\w$]*)\.listen\(\)\s*;\s*$", text))
    if len(harness_listens) != 1 or harness_listens[0].group("name") != harness_name:
        fail("Wrangler harness listener drifted while reordering MSW startup")
    insert_at = harness_listens[0].start()
    text = text[:insert_at] + msw_statement + text[insert_at:]
    moved = True

# Re-derive concrete lifecycle fragments from the repaired text and prove order.
policy_match = re.search(r"onUnhandledRequest\s*:\s*['\"]error['\"]", text)
harness_match = re.search(r"(?m)^\s*await\s+([A-Za-z_$][\w$]*)\.listen\(\)\s*;\s*$", text)
if policy_match is None or harness_match is None or policy_match.start() > harness_match.start():
    fail("Integration harness must start MSW interception before Wrangler listen()")
harness_name = harness_match.group(1)

# Re-derive the exact repaired MSW statement for the adversarial mutation below.
listen_start = text.rfind(".listen(", 0, policy_match.start())
msw_line_start = text.rfind("\n", 0, listen_start) + 1
msw_statement_end = text.find(";", policy_match.start()) + 1
if msw_statement_end <= 0 or msw_statement_end - msw_line_start > 500:
    fail("Could not bound repaired MSW listener statement")
if msw_statement_end < len(text) and text[msw_statement_end] == "\n":
    msw_statement_end += 1
repaired_msw_statement = text[msw_line_start:msw_statement_end]

# Make future outbound-interception failures diagnostically useful while keeping
# the original strict hit-count assertions intact. No production credential is
# logged; certification uses synthetic test credentials.
if "CTW_INTEGRATION_OUTBOUND_DIAGNOSTIC" not in text:
    success_assertion = re.search(
        r"(?m)^(?P<indent>\s*)expect\(mockHits\s*,\s*['\"]OpenAI MSW mock must be reached exactly once['\"]\)\.toBe\(1\);\s*$",
        text,
    )
    if success_assertion is None:
        fail("Could not locate strict successful OpenAI MSW hit assertion")
    indent = success_assertion.group("indent")
    diagnostic = (
        f"{indent}if(mockHits!==1){{\n"
        f"{indent}  {harness_name}.debug();\n"
        f"{indent}  console.error('CTW_INTEGRATION_OUTBOUND_DIAGNOSTIC',{{status:r.status,responseText,handlerError:handlerError?String(handlerError):null}});\n"
        f"{indent}}}\n"
    )
    text = text[:success_assertion.start()] + diagnostic + text[success_assertion.start():]

    redirect_assertion = re.search(
        r"(?m)^(?P<indent>\s*)expect\(redirectMockHits\s*,\s*['\"]redirect MSW mock must be reached exactly once['\"]\)\.toBe\(1\);\s*$",
        text,
    )
    if redirect_assertion is None:
        fail("Could not locate strict redirect MSW hit assertion")
    indent = redirect_assertion.group("indent")
    diagnostic = (
        f"{indent}if(redirectMockHits!==1){{\n"
        f"{indent}  {harness_name}.debug();\n"
        f"{indent}  console.error('CTW_INTEGRATION_REDIRECT_DIAGNOSTIC',{{status:r.status,responseText:await r.clone().text()}});\n"
        f"{indent}}}\n"
    )
    text = text[:redirect_assertion.start()] + diagnostic + text[redirect_assertion.start():]

write(TEST, text)

# Add a static release invariant for the documented startup ordering. Use a
# generic identifier matcher so the guard does not depend on a cosmetic variable
# name such as `server` versus `harness`.
audit = read(AUDIT)
order_label = "integration starts outbound interception before Wrangler harness"
if order_label not in audit:
    anchor = '["integration harness lifecycle current"'
    idx = audit.find(anchor)
    if idx < 0:
        fail("Could not locate integration lifecycle safeguard anchor")
    line = audit.rfind("\n", 0, idx) + 1
    guard = (
        '    ,["integration starts outbound interception before Wrangler harness", () => '
        '/\\.listen\\(\\{[\\s\\S]{0,300}?onUnhandledRequest\\s*:\\s*["\\\']error["\\\'][\\s\\S]{0,300}?\\}\\);'
        '[\\s\\S]{0,500}?await\\s+[A-Za-z_$][\\w$]*\\.listen\\(\\)\\s*;/'
        '.test(s("tests/integration/worker.test.js"))]\n'
    )
    audit = audit[:line] + guard + audit[line:]
    write(AUDIT, audit)

# Add an adversarial mutation that removes the exact reviewed MSW startup
# statement. The new static lifecycle invariant must reject that mutation. This
# intentionally does not depend on the two listen statements being adjacent.
mutation = read(MUTATION)
mutation_label = "remove outbound interceptor startup before Wrangler harness"
if mutation_label not in mutation:
    anchor = '["remove integration server listen"'
    idx = mutation.find(anchor)
    if idx < 0:
        fail("Could not locate integration lifecycle mutation anchor")
    line = mutation.rfind("\n", 0, idx) + 1
    pattern = js_regex_escape(repaired_msw_statement)
    case = (
        f'  ["{mutation_label}", "tests/integration/worker.test.js", /{pattern}/, ""],\n'
    )
    mutation = mutation[:line] + case + mutation[line:]
    write(MUTATION, mutation)

print(
    "Integration harness repair PASS: MSW interception precedes Wrangler listen; "
    f"startup_moved={str(moved).lower()}, harness={harness_name}."
)
print("Integration failure diagnostics and lifecycle static/mutation guards are present.")
