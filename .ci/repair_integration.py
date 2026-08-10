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
        fail(f"Certification repair required file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"Certification repair expected UTF-8 file: {path}")
        raise


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def top_level_entry(text: str, label: str) -> tuple[int, int, str]:
    pattern = re.compile(rf'(?m)^(?P<indent>[ \t]*)(?P<comma>,?)[ \t]*\["{re.escape(label)}"')
    hits = list(pattern.finditer(text))
    if len(hits) != 1:
        fail(f'Safeguard "{label}" entry count drifted: {len(hits)}')
    hit = hits[0]
    indent = hit.group("indent")
    nxt = re.search(rf'(?m)^{re.escape(indent)},?[ \t]*\["', text[hit.end():])
    end = hit.end() + nxt.start() if nxt else len(text)
    return hit.start(), end, text[hit.start():end]


# Preserve the reviewed whole-Worker integration contract. This diagnostic run
# keeps the current test-only foreign Request normalizer, but emits only bounded
# booleans/type names so we can determine the actual Wrangler -> Node/MSW call
# shape without logging URLs, header values, multipart boundaries, keys, bodies,
# audio, or arbitrary exception text. A sentinel is appended below so no release
# can be certified from this diagnostic commit.
integration = read(INTEGRATION)
policies = list(re.finditer(r'onUnhandledRequest\s*:\s*["\']error["\']', integration))
wrangler_listens = list(re.finditer(r'(?m)^\s*await\s+([A-Za-z_$][\w$]*)\.listen\(\)\s*;\s*$', integration))
if len(policies) != 1 or len(wrangler_listens) != 1:
    fail(f"Integration harness policy/listen drift: policies={len(policies)} listens={len(wrangler_listens)}")
wrangler_listen = wrangler_listens[0]
msw_listen_start = integration.rfind(".listen(", 0, policies[0].start())
if msw_listen_start < 0 or integration.rfind("\n", 0, msw_listen_start) + 1 > wrangler_listen.start():
    fail("Integration harness must start MSW before Wrangler listen()")
for marker in ("CTW_DIAGNOSTIC_ONLY", "CTW_UPSTREAM_FETCH_EXCEPTION", "ctwInstallHarnessFetchAdapter"):
    if marker in integration:
        fail(f"Temporary/legacy integration marker unexpectedly present: {marker}")
for assertion in (
    "OpenAI MSW mock must be reached exactly once",
    "redirect MSW mock must be reached exactly once",
):
    if integration.count(assertion) != 1:
        fail(f"Integration assertion missing or duplicated: {assertion}")
if len(re.findall(r'request\s*\.\s*clone\s*\(\s*\)\s*\.\s*formData\s*\(\s*\)', integration)) != 1:
    fail("Reviewed direct streamed multipart parser drifted")

adapter = r'''
let ctwRestoreHarnessFetch=null;
function ctwInstallHarnessRequestNormalizer(){
  const mswFetch=globalThis.fetch;
  let diagnosticCount=0;
  globalThis.fetch=(input,init)=>{
    const hasInit=Boolean(init && typeof init==='object');
    const hasBody=Boolean(hasInit && init.body!=null);
    const foreignRequest=Boolean(
      hasBody && init.constructor?.name==='Request' && !(init instanceof Request)
    );
    let copiedHeaders=null;
    if(hasBody){
      copiedHeaders=new Headers();
      init.headers?.forEach?.((value,name)=>copiedHeaders.append(name,value));
      if(diagnosticCount<4){
        const sourceContentType=typeof init.headers?.get==='function'
          ? init.headers.get('content-type')
          : null;
        const copiedContentType=copiedHeaders.get('content-type');
        console.error('CTW_HARNESS_REQUEST_DIAGNOSTIC',{
          inputCtor:String(input?.constructor?.name||typeof input).slice(0,40),
          inputNativeRequest:typeof Request!=='undefined' && input instanceof Request,
          inputHasBody:Boolean(input && typeof input==='object' && input.body!=null),
          initCtor:String(init?.constructor?.name||typeof init).slice(0,40),
          initNativeRequest:typeof Request!=='undefined' && init instanceof Request,
          initHasBody:hasBody,
          headersGet:typeof init.headers?.get==='function',
          headersForEach:typeof init.headers?.forEach==='function',
          headersIterable:Boolean(init.headers?.[Symbol.iterator]),
          sourceContentTypePresent:Boolean(sourceContentType),
          sourceContentTypeMultipart:/^multipart\/form-data(?:;|$)/i.test(String(sourceContentType||'')),
          sourceBoundaryPresent:/boundary=/i.test(String(sourceContentType||'')),
          copiedContentTypePresent:Boolean(copiedContentType),
          copiedContentTypeMultipart:/^multipart\/form-data(?:;|$)/i.test(String(copiedContentType||'')),
          copiedBoundaryPresent:/boundary=/i.test(String(copiedContentType||'')),
          foreignRequest
        });
        diagnosticCount++;
      }
    }
    if(!foreignRequest)return mswFetch(input,init);

    let signal=init.signal;
    if(signal && typeof AbortSignal!=='undefined' && !(signal instanceof AbortSignal)){
      const bridge=new AbortController();
      if(signal.aborted)bridge.abort(signal.reason);
      else signal.addEventListener?.('abort',()=>bridge.abort(signal.reason),{once:true});
      signal=bridge.signal;
    }

    return mswFetch(input,{
      method:init.method,
      headers:copiedHeaders,
      body:init.body,
      redirect:init.redirect,
      signal,
      duplex:'half'
    });
  };
  return ()=>{globalThis.fetch=mswFetch;};
}
'''.strip("\n") + "\n\n"

before_all = re.search(r"(?m)^beforeAll\(async\(\)=>\{\s*$", integration)
if before_all is None:
    fail("Could not locate integration beforeAll()")
integration = integration[:before_all.start()] + adapter + integration[before_all.start():]

network_listen = re.search(
    r"(?m)^(?P<indent>\s*)network\.listen\(\{onUnhandledRequest:['\"]error['\"]\}\);\s*$",
    integration,
)
if network_listen is None:
    fail("Could not locate exact MSW network.listen() startup")
indent = network_listen.group("indent")
startup = network_listen.group(0) + "\n" + f"{indent}ctwRestoreHarnessFetch=ctwInstallHarnessRequestNormalizer();"
integration = integration[:network_listen.start()] + startup + integration[network_listen.end():]

network_close = re.search(r"(?m)^(?P<indent>\s*)network\.close\(\);\s*$", integration)
if network_close is None:
    fail("Could not locate MSW network.close() cleanup")
indent = network_close.group("indent")
cleanup = (
    f"{indent}ctwRestoreHarnessFetch?.();\n"
    f"{indent}ctwRestoreHarnessFetch=null;\n"
    + network_close.group(0)
)
integration = integration[:network_close.start()] + cleanup + integration[network_close.end():]

# Also classify the Content-Type seen by MSW itself immediately before the
# existing Request.formData() call. Only booleans/type names are printed.
content_type_assignment = re.compile(
    r"(?m)^(?P<indent>\s*)seenContentType\s*=\s*request\.headers\.get\(['\"]content-type['\"]\)\s*\|\|\s*['\"]['\"]\s*;\s*$"
)
ct_hits = list(content_type_assignment.finditer(integration))
if len(ct_hits) != 1:
    fail(f"Expected exactly one seenContentType assignment; found {len(ct_hits)}")
ct = ct_hits[0]
ct_indent = ct.group("indent")
msw_diag = "\n".join([
    ct.group(0),
    f"{ct_indent}console.error('CTW_MSW_MULTIPART_DIAGNOSTIC',{{",
    f"{ct_indent}  requestCtor:String(request?.constructor?.name||typeof request).slice(0,40),",
    f"{ct_indent}  requestNativeRequest:typeof Request!=='undefined' && request instanceof Request,",
    f"{ct_indent}  contentTypePresent:Boolean(seenContentType),",
    f"{ct_indent}  contentTypeMultipart:/^multipart\\/form-data(?:;|$)/i.test(seenContentType),",
    f"{ct_indent}  boundaryPresent:/boundary=/i.test(seenContentType)",
    f"{ct_indent}}});",
])
integration = integration[:ct.start()] + msw_diag + integration[ct.end():]

for invariant, count in (
    ("ctwRestoreHarnessFetch=ctwInstallHarnessRequestNormalizer()", 1),
    ("ctwRestoreHarnessFetch?.()", 1),
    ("CTW_HARNESS_REQUEST_DIAGNOSTIC", 1),
    ("CTW_MSW_MULTIPART_DIAGNOSTIC", 1),
    ("duplex:'half'", 1),
):
    if integration.count(invariant) != count:
        fail(f"Harness diagnostic invariant drifted: {invariant}")

# Diagnostic safety latch: even if the target 9 production/integration tests
# become green, this extra test forces the job red and prevents browser/release
# certification until diagnostics are removed in the follow-up commit.
integration += (
    "\n\nit('CI diagnostic sentinel prevents release certification',()=>{\n"
    "  throw new Error('CTW_DIAGNOSTIC_ONLY');\n"
    "});\n"
)
write(INTEGRATION, integration)


# Current workerd rejects redirect="error". Preserve the no-redirect policy by
# using manual mode and rejecting every 3xx before any response body is read.
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
terminator_re = re.compile(r'(?m)^(?P<indent>[ \t]*)\}\);\s*$')
terminator = terminator_re.search(source, redirect.end())
if terminator is None or terminator.group("indent") != indent:
    fail("Reviewed fetchImpl terminator missing or indentation drifted")
source, changed = redirect_re.subn('redirect: "manual"', source, count=1)
if changed != 1:
    fail(f"Expected one redirect replacement; got {changed}")
terminator = terminator_re.search(source, redirect.end())
if terminator is None:
    fail("Could not re-locate fetchImpl terminator after redirect replacement")
guard = "\n".join([
    f"{indent}// CTW_WORKER_REDIRECT_FAIL_CLOSED",
    f"{indent}if ({response_var}.status >= 300 && {response_var}.status <= 399) {{",
    f'{indent}  throw new Error("Unexpected OpenAI redirect blocked after dispatch.");',
    f"{indent}}}",
])
source = source[:terminator.end()] + "\n" + guard + source[terminator.end():]
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


# Preserve the existing redirect safeguard and current normalizer safeguard.
audit = read(AUDIT)
entry_start, entry_end, entry = top_level_entry(audit, "redirect errors")
mode_tokens = list(re.finditer(r'(?P<q>["\'])error(?P=q)', entry))
if len(mode_tokens) != 1:
    fail(f'Existing "redirect errors" safeguard mode token count drifted: {len(mode_tokens)}')
m = mode_tokens[0]
entry = entry[:m.start()] + m.group("q") + "manual" + m.group("q") + entry[m.end():]
audit = audit[:entry_start] + entry + audit[entry_end:]

audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Stable audit insertion anchor drifted: {audit.count(audit_anchor)}")
guard_check = (
    '    ,["redirect manual mode rejects every 3xx before body parsing", () => '
    + 's("src/openai.js").includes(\'redirect: "manual"\')'
    + ' && s("src/openai.js").includes("// CTW_WORKER_REDIRECT_FAIL_CLOSED")'
    + f' && s("src/openai.js").includes({json.dumps(f"if ({response_var}.status >= 300 && {response_var}.status <= 399) {{")})'
    + ' && s("src/openai.js").includes(\'throw new Error("Unexpected OpenAI redirect blocked after dispatch.");\')'
    + ' && !s("src/openai.js").includes(\'redirect: "error"\')]\n'
)
bridge_check = (
    '    ,["integration normalizes foreign harness Request before MSW", () => '
    + 's("tests/integration/worker.test.js").includes("function ctwInstallHarnessRequestNormalizer()")'
    + ' && s("tests/integration/worker.test.js").includes("init.headers?.forEach?.((value,name)=>copiedHeaders.append(name,value))")'
    + ' && s("tests/integration/worker.test.js").includes("duplex:\'half\'")'
    + ' && s("tests/integration/worker.test.js").includes("ctwRestoreHarnessFetch=ctwInstallHarnessRequestNormalizer()")'
    + ' && s("tests/integration/worker.test.js").includes("ctwRestoreHarnessFetch?.()")'
    + ' && /request\\s*\\.\\s*clone\\s*\\(\\s*\\)\\s*\\.\\s*formData\\s*\\(\\s*\\)/'
    + '.test(s("tests/integration/worker.test.js"))]\n'
)
audit = audit.replace(audit_anchor, guard_check + bridge_check + audit_anchor, 1)
write(AUDIT, audit)


# Migrate the existing follow-redirect mutation payload and keep deliberate
# regressions for both the explicit redirect guard and normalized header bridge.
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

mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")
response_var_re = re.escape(response_var)
new_mutations = "\n".join([
    (
        '  ["remove explicit redirect status rejection -> redirect errors", "src/openai.js", '
        + rf'/if \({response_var_re}\.status >= 300 && {response_var_re}\.status <= 399\) \{{\n\s*throw new Error\("Unexpected OpenAI redirect blocked after dispatch\."\);\n\s*\}}/, ""],'
    ),
    (
        '  ["drop foreign harness Request header normalization -> integration normalizes foreign harness Request before MSW", '
        '"tests/integration/worker.test.js", '
        r'/\s*init\.headers\?\.forEach\?\.\(\(value,name\)=>copiedHeaders\.append\(name,value\)\);/, ""],'
    ),
])
mutations = mutations.replace(mutation_anchor, new_mutations + "\n" + mutation_anchor, 1)
write(MUTATIONS, mutations)

final_audit = read(AUDIT)
final_mutations = read(MUTATIONS)
for label in (
    '"redirect errors"',
    '"redirect manual mode rejects every 3xx before body parsing"',
    '"integration normalizes foreign harness Request before MSW"',
):
    if final_audit.count(label) != 1:
        fail(f"Final audit safeguard missing or duplicated: {label}")
for label in (
    "remove explicit redirect status rejection -> redirect errors",
    "drop foreign harness Request header normalization -> integration normalizes foreign harness Request before MSW",
):
    if final_mutations.count(label) != 1:
        fail(f"Final mutation missing or duplicated: {label}")
if any(old in final_mutations for old, _ in target_forms):
    fail("Old redirect-error mutation payload target survived migration")

print(f"Integration harness verification PASS: harness={wrangler_listen.group(1)}; MSW precedes Wrangler.")
print("Diagnostic foreign Request normalizer installed; direct request.clone().formData() proof preserved.")
print("Bounded harness/MSW multipart shape diagnostics installed; no header values or body data are logged.")
print("Diagnostic release sentinel installed: this commit cannot certify a release.")
print(f'Worker redirect repair PASS: {response_var} = await fetchImpl(...) uses redirect="manual" + immediate all-3xx fail-closed rejection.')
print("Redirect and harness-normalizer safeguards/mutations installed.")
if test_changes:
    print("Redirect-mode test migrations: " + ", ".join(test_changes))
else:
    print("No standalone redirect-mode test expectation required migration.")
