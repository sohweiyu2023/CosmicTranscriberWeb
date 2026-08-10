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

# Cloudflare's createTestHarness contract proxies Worker outbound fetches through
# Node globalThis.fetch(), where MSW can intercept them. Keep the reviewed
# fail-closed ordering and direct-Worker proof intact.
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

if "CTW_HARNESS_FETCH_BRIDGE" in text or "ctwInstallHarnessFetchAdapter" in text:
    fail("Harness fetch adapter unexpectedly already present in reviewed integration test")
if "CTW_DIAGNOSTIC_ONLY" in text:
    fail("Diagnostic sentinel unexpectedly already present in reviewed integration test")

# Wrangler 4.120.0's test harness forwards Miniflare's own undici Request as the
# RequestInit to globalThis.fetch(). MSW then reconstructs that with Node's
# global Request. GET subrequests already pass, while POST bodies fail before
# the MSW handler. Normalize ONLY this foreign-Request/body bridge in the test
# process: explicit method/headers/body/redirect, Node-compatible AbortSignal,
# and duplex:'half'. Production Worker fetch semantics are not modified.
adapter = r'''
let ctwRestoreHarnessFetch=null;
function ctwInstallHarnessFetchAdapter(){
  const mswFetch=globalThis.fetch;
  globalThis.fetch=(input,init)=>{
    const foreignRequest=Boolean(
      init && typeof init==='object' &&
      init.constructor?.name==='Request' &&
      !(init instanceof Request)
    );
    if(!foreignRequest || init.body==null)return mswFetch(input,init);

    const body=init.body;
    let signal=init.signal;
    let signalBridged=false;
    if(signal && typeof AbortSignal!=='undefined' && !(signal instanceof AbortSignal)){
      const bridge=new AbortController();
      signalBridged=true;
      if(signal.aborted)bridge.abort(signal.reason);
      else signal.addEventListener?.('abort',()=>bridge.abort(signal.reason),{once:true});
      signal=bridge.signal;
    }

    const normalized={
      method:init.method,
      headers:new Headers(init.headers),
      body,
      redirect:init.redirect,
      signal,
      duplex:'half'
    };
    console.error('CTW_HARNESS_FETCH_BRIDGE',{
      foreignRequest:true,
      method:String(init.method||''),
      mode:String(init.mode||''),
      modeNavigate:init.mode==='navigate',
      redirect:String(init.redirect||''),
      hasBody:true,
      bodyLocked:Boolean(body?.locked),
      signalBridged
    });
    return mswFetch(input,normalized);
  };
  return ()=>{globalThis.fetch=mswFetch;};
}
'''.strip("\n") + "\n\n"

before_all = re.search(r"(?m)^beforeAll\(async\(\)=>\{\s*$", text)
if before_all is None:
    fail("Could not locate integration beforeAll()")
text = text[: before_all.start()] + adapter + text[before_all.start() :]

network_listen = re.search(
    r"(?m)^(?P<indent>\s*)network\.listen\(\{onUnhandledRequest:['\"]error['\"]\}\);\s*$",
    text,
)
if network_listen is None:
    fail("Could not locate exact MSW network.listen() startup")
indent = network_listen.group("indent")
startup_replacement = (
    network_listen.group(0)
    + "\n"
    + f"{indent}ctwRestoreHarnessFetch=ctwInstallHarnessFetchAdapter();"
)
text = text[: network_listen.start()] + startup_replacement + text[network_listen.end() :]

network_close = re.search(r"(?m)^(?P<indent>\s*)network\.close\(\);\s*$", text)
if network_close is None:
    fail("Could not locate MSW network.close() cleanup")
indent = network_close.group("indent")
cleanup_replacement = (
    f"{indent}ctwRestoreHarnessFetch?.();\n"
    f"{indent}ctwRestoreHarnessFetch=null;\n"
    + network_close.group(0)
)
text = text[: network_close.start()] + cleanup_replacement + text[network_close.end() :]

# Preserve strict hit-count assertions, but make a failure expose only bounded
# non-secret status information and Wrangler's own debug timeline.
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
if text.count("ctwRestoreHarnessFetch=ctwInstallHarnessFetchAdapter()") != 1:
    fail("Harness fetch adapter startup was not installed exactly once")
if text.count("ctwRestoreHarnessFetch?.()") != 1:
    fail("Harness fetch adapter cleanup was not installed exactly once")

# Diagnostic-only safety latch: integration tests execute first, then this test
# deliberately fails so browsers/release packaging cannot bless temporary
# bridge diagnostics even if the two target tests turn green.
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
print("Foreign Miniflare POST-body fetch bridge adapter installed for diagnostic run.")
print("Strict outbound assertions preserved; diagnostic release sentinel installed.")

# Keep the production source behavior unchanged except for a bounded temporary
# exception classifier. Never print arbitrary exception text, request headers,
# API keys, audio, or bodies.
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
    '    console.error("CTW_UPSTREAM_FETCH_EXCEPTION", {\n'
    '      name: String(error?.name || "").slice(0, 80),\n'
    '      code: String(error?.code || "").slice(0, 80),\n'
    '      causeName: String(error?.cause?.name || "").slice(0, 80),\n'
    '      causeCode: String(error?.cause?.code || "").slice(0, 80),\n'
    '      flags: {\n'
    '        typeError: error?.name === "TypeError",\n'
    '        invalid: /invalid/i.test(reason) || /invalid/i.test(causeReason),\n'
    '        mode: /mode/i.test(reason) || /mode/i.test(causeReason),\n'
    '        navigate: /navigate/i.test(reason) || /navigate/i.test(causeReason),\n'
    '        duplex: /duplex/i.test(reason) || /duplex/i.test(causeReason),\n'
    '        stream: /stream/i.test(reason) || /stream/i.test(causeReason),\n'
    '        locked: /locked/i.test(reason) || /locked/i.test(causeReason),\n'
    '        body: /body/i.test(reason) || /body/i.test(causeReason),\n'
    '        signal: /signal/i.test(reason) || /signal/i.test(causeReason),\n'
    '        header: /header/i.test(reason) || /header/i.test(causeReason),\n'
    '        referrer: /referrer/i.test(reason) || /referrer/i.test(causeReason),\n'
    '        requestCtor: /Request constructor/i.test(reason) || /Request constructor/i.test(causeReason),\n'
    '        mswStack: /@mswjs[\\/]interceptors|interceptors[\\/]fetch/i.test(stack),\n'
    '        undiciStack: /undici/i.test(stack),\n'
    '        workerdStack: /workerd|wrangler|\.wrangler/i.test(stack)\n'
    '      }\n'
    '    });\n'
)
openai_text = openai_text.replace(catch_anchor, transport_diagnostic, 1)
if openai_text.count("CTW_UPSTREAM_FETCH_EXCEPTION") != 1:
    fail("Expected exactly one bounded upstream-fetch exception diagnostic")
if 'message: String(error?.message' in openai_text or 'causeMessage:' in openai_text:
    fail("Diagnostic must not log arbitrary transport exception message text")
write(OPENAI_SOURCE, openai_text)
print("Bounded upstream-fetch classifier installed; raw messages remain unlogged.")
