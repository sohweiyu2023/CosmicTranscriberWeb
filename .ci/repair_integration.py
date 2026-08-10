from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
TEST = WORK / "tests" / "integration" / "worker.test.js"
OPENAI_SOURCE = WORK / "src" / "openai.js"


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
# failure useful: Wrangler's server.debug() prints the harness timeline/runtime
# logs, and the synthetic test response status/body tells us whether the request
# was rejected before reaching Node/MSW.
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
    if not re.search(r"onUnhandledRequest\s*:\s*['\"]error['\"]", text):
        fail("MSW fail-closed unhandled-request policy disappeared")

# This commit is diagnostic-only. Even if the two target integration assertions
# unexpectedly turn green, a sentinel test prevents browser/release gates from
# certifying a tree containing temporary transport diagnostics.
diagnostic_sentinel = (
    "\n\nit('CI diagnostic sentinel prevents release certification', () => {\n"
    "  throw new Error('CTW_DIAGNOSTIC_ONLY');\n"
    "});\n"
)
if "CTW_DIAGNOSTIC_ONLY" in text:
    fail("Diagnostic sentinel unexpectedly already present in reviewed integration test")
text += diagnostic_sentinel

write(TEST, text)
print(
    "Integration harness verification PASS: existing MSW interception already "
    f"precedes Wrangler listen; harness={harness_name}."
)
print("Strict outbound assertions preserved; failure diagnostics installed.")

# The prior duplex='half' experiment was intentionally removed: hosted Linux,
# macOS, and Windows evidence showed no behavioral change. Keep the reviewed
# request semantics intact and expose only non-secret categorical information
# about the exception swallowed by the production billing-safe error wrapper.
openai_text = read(OPENAI_SOURCE)
if re.search(r"(?m)^\s*duplex\s*:", openai_text):
    fail("Reviewed OpenAI source unexpectedly contains a duplex option")

catch_anchor = (
    '  } catch (error) {\n'
    '    if (error instanceof ApiError) throw error;\n'
    '    const reason = String(error?.message || error || "");\n'
)
catch_matches = [m.start() for m in re.finditer(re.escape(catch_anchor), openai_text)]
if len(catch_matches) != 1:
    fail(
        "Expected exactly one outbound-fetch billing-safe catch anchor; "
        f"found {len(catch_matches)}"
    )

transport_diagnostic = (
    '  } catch (error) {\n'
    '    if (error instanceof ApiError) throw error;\n'
    '    const reason = String(error?.message || error || "");\n'
    '    const causeReason = String(error?.cause?.message || error?.cause || "");\n'
    '    console.error("CTW_UPSTREAM_FETCH_EXCEPTION", {\n'
    '      name: String(error?.name || "").slice(0, 80),\n'
    '      code: String(error?.code || "").slice(0, 80),\n'
    '      causeName: String(error?.cause?.name || "").slice(0, 80),\n'
    '      causeCode: String(error?.cause?.code || "").slice(0, 80),\n'
    '      errorKeys: Object.keys(error || {}).slice(0, 20),\n'
    '      causeKeys: Object.keys(error?.cause || {}).slice(0, 20),\n'
    '      flags: {\n'
    '        typeError: error?.name === "TypeError",\n'
    '        duplex: /duplex/i.test(reason) || /duplex/i.test(causeReason),\n'
    '        stream: /stream/i.test(reason) || /stream/i.test(causeReason),\n'
    '        locked: /locked/i.test(reason) || /locked/i.test(causeReason),\n'
    '        body: /body/i.test(reason) || /body/i.test(causeReason),\n'
    '        unsupported: /unsupported|not supported/i.test(reason) || /unsupported|not supported/i.test(causeReason),\n'
    '        invalid: /invalid/i.test(reason) || /invalid/i.test(causeReason),\n'
    '        fetch: /fetch/i.test(reason) || /fetch/i.test(causeReason),\n'
    '        network: /network/i.test(reason) || /network/i.test(causeReason),\n'
    '        proxy: /proxy/i.test(reason) || /proxy/i.test(causeReason),\n'
    '        request: /request/i.test(reason) || /request/i.test(causeReason),\n'
    '        contentLength: /content[- ]?length/i.test(reason) || /content[- ]?length/i.test(causeReason),\n'
    '        abort: /abort/i.test(reason) || /abort/i.test(causeReason)\n'
    '      }\n'
    '    });\n'
)
openai_text = openai_text.replace(catch_anchor, transport_diagnostic, 1)
if openai_text.count("CTW_UPSTREAM_FETCH_EXCEPTION") != 1:
    fail("Expected exactly one bounded upstream-fetch exception diagnostic")
if 'message: String(error?.message' in openai_text or 'causeMessage:' in openai_text:
    fail("Diagnostic must not log arbitrary transport exception message text")

write(OPENAI_SOURCE, openai_text)
print("Bounded upstream-fetch exception diagnostic installed; raw messages remain unlogged.")

# Print the integration dispatch path explicitly. Cloudflare's documented MSW
# example uses the direct Worker handle; this bounded excerpt lets hosted logs
# prove which handle/path this reviewed suite actually invokes.
print("CTW_INTEGRATION_PATH_DIAGNOSTIC_BEGIN")
test_lines = text.splitlines()
path_hits = [
    i for i, line in enumerate(test_lines)
    if any(marker in line for marker in (
        "createTestHarness",
        "getWorker(",
        ".getWorker<",
        ".fetch(",
        "mockHits",
        "redirectMockHits",
        "setupServer",
    ))
]
path_windows: list[tuple[int, int]] = []
for hit in path_hits:
    start = max(0, hit - 5)
    end = min(len(test_lines), hit + 9)
    if path_windows and start <= path_windows[-1][1] + 2:
        path_windows[-1] = (path_windows[-1][0], max(path_windows[-1][1], end))
    else:
        path_windows.append((start, end))
path_printed = 0
for start, end in path_windows:
    if path_printed >= 180:
        break
    allowed_end = min(end, start + (180 - path_printed))
    print(f"--- tests/integration/worker.test.js:{start + 1}-{allowed_end} ---")
    for lineno in range(start, allowed_end):
        print(f"{lineno + 1:04d}: {test_lines[lineno]}")
        path_printed += 1
print(f"CTW_INTEGRATION_PATH_DIAGNOSTIC_END lines={path_printed}")

# Hosted evidence proves the remaining failure is inside the Worker streaming
# dispatch boundary: /api/transcribe enters post-dispatch ambiguity in a few ms
# and the Node-side MSW mock never observes the request. Print only bounded
# excerpts from first-party source containing the dispatch/error markers.
source_markers = (
    "upstream_ambiguous",
    "api.openai.com/v1/audio/transcriptions",
)
stream_markers = (
    "request.body",
    ".body",
    "getReader(",
    "ReadableStream",
    "TransformStream",
    "fetch(",
    "CTW_UPSTREAM_FETCH_EXCEPTION",
)
excluded_parts = {"node_modules", "dist", ".wrangler", ".git"}
interesting: list[tuple[pathlib.Path, str]] = []
for path in sorted(WORK.rglob("*")):
    if not path.is_file() or any(part in excluded_parts for part in path.parts):
        continue
    if path.suffix.lower() not in {".js", ".mjs", ".ts"}:
        continue
    try:
        if path.stat().st_size > 1_000_000:
            continue
        body = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    if any(marker in body for marker in source_markers):
        interesting.append((path, body))

if not interesting:
    fail("Could not locate first-party Worker source containing OpenAI dispatch/error markers")

print("CTW_STREAM_SOURCE_DIAGNOSTIC_BEGIN")
printed_lines = 0
for path, body in interesting[:3]:
    lines = body.splitlines()
    hits = [
        i for i, line in enumerate(lines)
        if any(marker in line for marker in source_markers)
        or any(marker in line for marker in stream_markers)
    ]
    # Merge nearby source windows; cap output globally so CI logs remain bounded.
    windows: list[tuple[int, int]] = []
    for hit in hits:
        start = max(0, hit - 24)
        end = min(len(lines), hit + 36)
        if windows and start <= windows[-1][1] + 8:
            windows[-1] = (windows[-1][0], max(windows[-1][1], end))
        else:
            windows.append((start, end))
    rel = path.relative_to(WORK).as_posix()
    for start, end in windows[:3]:
        if printed_lines >= 260:
            break
        allowed_end = min(end, start + (260 - printed_lines))
        print(f"--- {rel}:{start + 1}-{allowed_end} ---")
        for lineno in range(start, allowed_end):
            print(f"{lineno + 1:04d}: {lines[lineno]}")
            printed_lines += 1
    if printed_lines >= 260:
        break
print(f"CTW_STREAM_SOURCE_DIAGNOSTIC_END lines={printed_lines} files={len(interesting)}")
