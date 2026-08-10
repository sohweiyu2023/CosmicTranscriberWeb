from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
TEST = WORK / "tests" / "integration" / "worker.test.js"


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


text = read(TEST)

# Cloudflare's createTestHarness integration contract proxies Worker outbound
# fetches through Node globalThis.fetch(), where MSW can intercept them. The
# reviewed 1.0.12 source already starts the interceptor before Wrangler; verify
# that contract here instead of rewriting unrelated validation machinery.
policy_matches = list(
    re.finditer(r"onUnhandledRequest\s*:\s*['\"]error['\"]", text)
)
if len(policy_matches) != 1:
    fail(
        "Expected exactly one MSW onUnhandledRequest:error policy; "
        f"found {len(policy_matches)}"
    )
policy_match = policy_matches[0]

harness_matches = list(
    re.finditer(
        r"(?m)^\s*await\s+([A-Za-z_$][\w$]*)\.listen\(\)\s*;\s*$",
        text,
    )
)
if len(harness_matches) != 1:
    fail(
        "Expected exactly one awaited Wrangler harness listen(); "
        f"found {len(harness_matches)}"
    )
harness_match = harness_matches[0]
harness_name = harness_match.group(1)

listen_start = text.rfind(".listen(", 0, policy_match.start())
if listen_start < 0:
    fail("Could not locate MSW listen() call owning onUnhandledRequest:error")
msw_line_start = text.rfind("\n", 0, listen_start) + 1
if msw_line_start > harness_match.start():
    fail("Integration harness must start MSW interception before Wrangler listen()")

# Keep the two outbound-interception assertions strict, but make any remaining
# failure useful: Wrangler's documented server.debug() prints the harness
# timeline/runtime logs, and the synthetic test response status/body tells us
# whether the request was rejected before reaching Node/MSW.
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
        f"{indent}  console.error('CTW_INTEGRATION_OUTBOUND_DIAGNOSTIC',"
        "{status:r.status,responseText,handlerError:handlerError?String(handlerError):null});\n"
        f"{indent}}}\n"
    )
    text = text[: success_assertion.start()] + diagnostic + text[success_assertion.start() :]

if "CTW_INTEGRATION_REDIRECT_DIAGNOSTIC" not in text:
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
        f"{indent}  console.error('CTW_INTEGRATION_REDIRECT_DIAGNOSTIC',"
        "{status:r.status,responseText:await r.clone().text()});\n"
        f"{indent}}}\n"
    )
    text = text[: redirect_assertion.start()] + diagnostic + text[redirect_assertion.start() :]

# Fail closed if the repair accidentally weakened the original proof points.
if text.count("OpenAI MSW mock must be reached exactly once") != 1:
    fail("Successful outbound MSW hit-count assertion was altered unexpectedly")
if text.count("redirect MSW mock must be reached exactly once") != 1:
    fail("Redirect outbound MSW hit-count assertion was altered unexpectedly")
if text.count("onUnhandledRequest:'error'") + text.count('onUnhandledRequest:"error"') < 1:
    # The exact spacing/quote style can vary, but the semantic regex above has
    # already proved the policy exists. This branch is only a defensive check.
    if not re.search(r"onUnhandledRequest\s*:\s*['\"]error['\"]", text):
        fail("MSW fail-closed unhandled-request policy disappeared")

write(TEST, text)
print(
    "Integration harness verification PASS: existing MSW interception already "
    f"precedes Wrangler listen; harness={harness_name}."
)
print("Strict outbound assertions preserved; failure diagnostics installed.")
