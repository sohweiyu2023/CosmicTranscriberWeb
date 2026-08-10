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

# Verify the reviewed integration harness still fails closed: MSW must start
# before Wrangler and unhandled Node-side network remains an error.
policy_matches = list(re.finditer(r"onUnhandledRequest\s*:\s*['\"]error['\"]", text))
if len(policy_matches) != 1:
    fail(f"Expected exactly one MSW onUnhandledRequest:error policy; found {len(policy_matches)}")
policy_match = policy_matches[0]

harness_matches = list(
    re.finditer(r"(?m)^\s*await\s+([A-Za-z_$][\w$]*)\.listen\(\)\s*;\s*$", text)
)
if len(harness_matches) != 1:
    fail(f"Expected exactly one awaited Wrangler harness listen(); found {len(harness_matches)}")
harness_match = harness_matches[0]
harness_name = harness_match.group(1)

listen_start = text.rfind(".listen(", 0, policy_match.start())
if listen_start < 0:
    fail("Could not locate MSW listen() call owning onUnhandledRequest:error")
msw_line_start = text.rfind("\n", 0, listen_start) + 1
if msw_line_start > harness_match.start():
    fail("Integration harness must start MSW interception before Wrangler listen()")

# The previous foreign-Miniflare Request adapter was disproved by hosted
# Linux/macOS/Windows evidence. Do not install or retain any bridge adapter.
if "CTW_HARNESS_FETCH_BRIDGE" in text or "ctwInstallHarnessFetchAdapter" in text:
    fail("Reviewed integration test unexpectedly already contains diagnostic bridge adapter")
if "CTW_DIAGNOSTIC_ONLY" in text:
    fail("Diagnostic sentinel unexpectedly already present in reviewed integration test")

# Preserve strict hit-count assertions and add bounded failure context around
# them. The response body here is Cosmic's own fixed-schema error response, not
# an upstream body or secret.
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

if text.count("OpenAI MSW mock must be reached exactly once") != 1:
    fail("Successful outbound MSW hit-count assertion was altered unexpectedly")
if text.count("redirect MSW mock must be reached exactly once") != 1:
    fail("Redirect outbound MSW hit-count assertion was altered unexpectedly")

# Diagnostic-only safety latch. It executes after the real integration cases,
# guaranteeing that no browser/release job can certify this temporary tree.
text += (
    "\n\nit('CI diagnostic sentinel prevents release certification', () => {\n"
    "  throw new Error('CTW_DIAGNOSTIC_ONLY');\n"
    "});\n"
)
write(TEST, text)

print(
    "Integration harness verification PASS: MSW precedes Wrangler listen; "
    f"harness={harness_name}."
)
print("Disproved Miniflare Request adapter removed; strict outbound assertions preserved.")
print("Diagnostic release sentinel installed.")

# Production behavior remains unchanged. Add only a bounded classifier in the
# derived certification tree. Never emit arbitrary exception message text,
# headers, API keys, URLs, audio, request bodies, or response bodies.
openai_text = read(OPENAI_SOURCE)
if re.search(r"(?m)^\s*duplex\s*:", openai_text):
    fail("Reviewed OpenAI source unexpectedly contains a duplex option")

catch_anchor = (
    '  } catch (error) {\n'
    '    if (error instanceof ApiError) throw error;\n'
    '    const reason = String(error?.message || error || "");\n'
)
if openai_text.count(catch_anchor) != 1:
    fail("Expected exactly one outbound-fetch billing-safe catch anchor")

transport_diagnostic = (
    '  } catch (error) {\n'
    '    if (error instanceof ApiError) throw error;\n'
    '    const reason = String(error?.message || error || "");\n'
    '    const causeReason = String(error?.cause?.message || error?.cause || "");\n'
    '    const stack = String(error?.stack || "");\n'
    '    const reasonPair = `${reason}\\n${causeReason}`;\n'
    '    const stackLines = stack.split(/\\r?\\n/).slice(1, 8);\n'
    '    const safeFrames = stackLines.map((line) => {\n'
    '      const trimmed = line.trim().slice(0, 320);\n'
    '      const fn = trimmed.match(/^at\\s+(?:async\\s+)?([A-Za-z0-9_$.[\\]<>-]{1,120})/)?.[1] || "";\n'
    '      const loc = trimmed.match(/(?:^|[\\\\/(])([A-Za-z0-9_.-]{1,80}\\.(?:js|mjs|cjs)):(\\d{1,6}):(\\d{1,6})\\)?$/);\n'
    '      return {fn, file:loc?.[1] || "", line:loc ? Number(loc[2]) : 0, col:loc ? Number(loc[3]) : 0};\n'
    '    });\n'
    '    console.error("CTW_UPSTREAM_FETCH_EXCEPTION", {\n'
    '      name: String(error?.name || "").slice(0, 80),\n'
    '      code: String(error?.code || "").slice(0, 80),\n'
    '      causeName: String(error?.cause?.name || "").slice(0, 80),\n'
    '      causeCode: String(error?.cause?.code || "").slice(0, 80),\n'
    '      messageLength: Math.min(10000, reason.length),\n'
    '      causeMessageLength: Math.min(10000, causeReason.length),\n'
    '      flags: {\n'
    '        typeError: error?.name === "TypeError",\n'
    '        invalid: /invalid/i.test(reasonPair),\n'
    '        url: /\\burl\\b/i.test(reasonPair),\n'
    '        method: /\\bmethod\\b/i.test(reasonPair),\n'
    '        redirect: /redirect/i.test(reasonPair),\n'
    '        mode: /\\bmode\\b/i.test(reasonPair),\n'
    '        navigate: /navigate/i.test(reasonPair),\n'
    '        duplex: /duplex/i.test(reasonPair),\n'
    '        stream: /stream/i.test(reasonPair),\n'
    '        locked: /locked/i.test(reasonPair),\n'
    '        reader: /reader/i.test(reasonPair),\n'
    '        body: /\\bbody\\b/i.test(reasonPair),\n'
    '        signal: /signal/i.test(reasonPair),\n'
    '        abort: /abort/i.test(reasonPair),\n'
    '        header: /header/i.test(reasonPair),\n'
    '        content: /content/i.test(reasonPair),\n'
    '        length: /length/i.test(reasonPair),\n'
    '        referrer: /referrer/i.test(reasonPair),\n'
    '        request: /request/i.test(reasonPair),\n'
    '        response: /response/i.test(reasonPair),\n'
    '        fetch: /fetch/i.test(reasonPair),\n'
    '        input: /input/i.test(reasonPair),\n'
    '        argument: /argument/i.test(reasonPair),\n'
    '        value: /value/i.test(reasonPair),\n'
    '        source: /source/i.test(reasonPair),\n'
    '        controller: /controller/i.test(reasonPair),\n'
    '        transfer: /transfer/i.test(reasonPair),\n'
    '        fixed: /fixed/i.test(reasonPair),\n'
    '        known: /known/i.test(reasonPair),\n'
    '        chunk: /chunk/i.test(reasonPair),\n'
    '        byte: /byte/i.test(reasonPair),\n'
    '        protocol: /protocol|scheme/i.test(reasonPair),\n'
    '        host: /host/i.test(reasonPair),\n'
    '        port: /port/i.test(reasonPair),\n'
    '        service: /service/i.test(reasonPair),\n'
    '        subrequest: /subrequest/i.test(reasonPair),\n'
    '        constructor: /constructor/i.test(reasonPair),\n'
    '        mswStack: /@mswjs[\\\\/]interceptors|interceptors[\\\\/]fetch/i.test(stack),\n'
    '        undiciStack: /undici/i.test(stack),\n'
    '        wranglerStack: /wrangler|\\.wrangler/i.test(stack),\n'
    '        openaiStack: /openai\\.js/i.test(stack),\n'
    '        dispatchStack: /dispatchTranscription/i.test(stack),\n'
    '        multipartStack: /buildMultipartStream/i.test(stack),\n'
    '        boundedResponseStack: /readBoundedResponse/i.test(stack)\n'
    '      },\n'
    '      safeFrames\n'
    '    });\n'
)

openai_text = openai_text.replace(catch_anchor, transport_diagnostic, 1)
if openai_text.count("CTW_UPSTREAM_FETCH_EXCEPTION") != 1:
    fail("Expected exactly one bounded upstream-fetch exception diagnostic")
if 'message: String(error?.message' in openai_text or "causeMessage:" in openai_text:
    fail("Diagnostic must not log arbitrary transport exception message text")
if "safeFrames" not in openai_text or "messageLength" not in openai_text:
    fail("Stack fingerprint diagnostic was not installed")
write(OPENAI_SOURCE, openai_text)
print("Bounded fetch rejection fingerprint installed; raw messages remain unlogged.")
