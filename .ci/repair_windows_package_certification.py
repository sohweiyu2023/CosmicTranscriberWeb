from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
VERIFY = WORK / "scripts" / "verify-source-package.mjs"
PACKAGE = WORK / "package.json"
RELEASE_VERIFY = WORK / "scripts" / "release-verify.mjs"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"

TEMP_LABEL = "Windows fresh-extraction release verification stays isolated on the release drive"
FIREFOX_LABEL = "Windows release stress-tests the repaired Firefox secure-key pointer path"
FIREFOX_GREP = "secure key setup, native controls, queue, mocked transcript and downloads"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"Windows package certification repair required file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"Windows package certification repair expected UTF-8 file: {path}")
        raise


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def js_regex_exact(text: str) -> str:
    if "\n" in text or "\r" in text:
        fail("js_regex_exact only supports one-line targets")
    return "/" + re.sub(r"([\\^$.*+?()\[\]{}|/])", r"\\\1", text) + "/"


# 1. Keep the mandatory fresh-extraction round trip isolated while avoiding the
# current Vitest 4.1.10 Windows runner/config path-identity failure seen only
# after the project moves from the checked-out release drive into OS TEMP.
verify = read(VERIFY)
old_temp = "const tmp=await mkdtemp(path.join(os.tmpdir(),'cosmic-package-'));"
new_parent = "const packageTempParent=process.platform==='win32'?path.dirname(root):os.tmpdir();"
new_temp = "const tmp=await mkdtemp(path.join(packageTempParent,'.cosmic-package-'));"
if verify.count(old_temp) != 1:
    fail(f"Reviewed fresh-extraction temp anchor drifted: {verify.count(old_temp)}")
if new_parent in verify or new_temp in verify:
    fail("Windows same-drive fresh-extraction repair unexpectedly already present")
verify = verify.replace(old_temp, new_parent + "\n" + new_temp, 1)
write(VERIFY, verify)

# 2. Promote the proven Windows-Firefox regression from a diagnostic-only proof
# into the actual release contract. No retries, force clicks, evaluate(), or
# timeout inflation: the exact repaired native pointer path must pass ten times.
package = read(PACKAGE)
old_script = '    "test:e2e:branded": "npm run build && playwright test --project=chrome --project=edge",'
stress_command = (
    'npm run build && node scripts/playwright-invoke.mjs test --project=firefox '
    f'--grep \\"{FIREFOX_GREP}\\" --repeat-each=10 --workers=1'
)
new_script = old_script + "\n" + f'    "test:e2e:firefox-key-stress": "{stress_command}",'
if package.count(old_script) != 1:
    fail(f"Reviewed branded E2E package-script anchor drifted: {package.count(old_script)}")
if '"test:e2e:firefox-key-stress"' in package:
    fail("Windows Firefox stress release script unexpectedly already present")
package = package.replace(old_script, new_script, 1)
# Parse immediately so an escaping error cannot reach certification.
try:
    parsed_package = json.loads(package)
except json.JSONDecodeError as exc:
    fail(f"Windows Firefox stress script produced invalid package.json: {exc}")
expected_stress = (
    'npm run build && node scripts/playwright-invoke.mjs test --project=firefox '
    f'--grep "{FIREFOX_GREP}" --repeat-each=10 --workers=1'
)
if parsed_package.get("scripts", {}).get("test:e2e:firefox-key-stress") != expected_stress:
    fail("Windows Firefox stress script did not round-trip to the exact reviewed command")
write(PACKAGE, package)

release_verify = read(RELEASE_VERIFY)
old_windows = "if(process.platform==='win32')steps.push(['run','test:e2e:branded']);"
new_windows = (
    "if(process.platform==='win32'){\n"
    "  steps.push(['run','test:e2e:firefox-key-stress']);\n"
    "  steps.push(['run','test:e2e:branded']);\n"
    "}"
)
if release_verify.count(old_windows) != 1:
    fail(f"Reviewed Windows release E2E anchor drifted: {release_verify.count(old_windows)}")
if "steps.push(['run','test:e2e:firefox-key-stress']);" in release_verify:
    fail("Windows Firefox stress release gate unexpectedly already present")
release_verify = release_verify.replace(old_windows, new_windows, 1)
write(RELEASE_VERIFY, release_verify)

# 3. Static safeguards so both repairs are part of the release invariants.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Stable Windows package-cert audit insertion anchor drifted: {audit.count(audit_anchor)}")
for label in (TEMP_LABEL, FIREFOX_LABEL):
    if label in audit:
        fail(f"Windows package-cert safeguard unexpectedly already present: {label}")

temp_expr = (
    's("scripts/verify-source-package.mjs").includes("const packageTempParent=process.platform===\'win32\'?path.dirname(root):os.tmpdir();")'
    ' && s("scripts/verify-source-package.mjs").includes("const tmp=await mkdtemp(path.join(packageTempParent,\'.cosmic-package-\'));")'
    ' && !s("scripts/verify-source-package.mjs").includes("mkdtemp(path.join(os.tmpdir(),\'cosmic-package-\'))")'
)
firefox_expr = (
    's("package.json").includes("\\\"test:e2e:firefox-key-stress\\\"")'
    ' && s("package.json").includes("--project=firefox")'
    f' && s("package.json").includes({json.dumps("--grep \\\"" + FIREFOX_GREP + "\\\"")})'
    ' && s("package.json").includes("--repeat-each=10 --workers=1")'
    ' && s("scripts/release-verify.mjs").includes("steps.push([\'run\',\'test:e2e:firefox-key-stress\']);")'
)
checks = [
    f'    ,["{TEMP_LABEL}", () => {temp_expr}]',
    f'    ,["{FIREFOX_LABEL}", () => {firefox_expr}]',
]
audit = audit.replace(audit_anchor, "\n".join(checks) + "\n" + audit_anchor, 1)
write(AUDIT, audit)

# 4. Deliberate mutations prove that same-drive isolation, release wiring, and
# the ten-pass stress strength cannot silently disappear.
mutations = read(MUTATIONS)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable Windows package-cert mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")
mutation_specs = [
    (
        "move Windows fresh extraction back to OS TEMP -> Windows fresh-extraction release verification stays isolated on the release drive",
        "scripts/verify-source-package.mjs",
        new_parent,
        "const packageTempParent=os.tmpdir();",
    ),
    (
        "remove Firefox secure-key stress from Windows release verification -> Windows release stress-tests the repaired Firefox secure-key pointer path",
        "scripts/release-verify.mjs",
        "  steps.push(['run','test:e2e:firefox-key-stress']);",
        "  void 0;",
    ),
    (
        "weaken Firefox secure-key stress from ten passes to one -> Windows release stress-tests the repaired Firefox secure-key pointer path",
        "package.json",
        "--repeat-each=10 --workers=1",
        "--repeat-each=1 --workers=1",
    ),
]
for label, _, _, _ in mutation_specs:
    if label in mutations:
        fail(f"Windows package-cert mutation unexpectedly already present: {label}")
entries = [
    f'  [{json.dumps(label)}, {json.dumps(path)}, {js_regex_exact(target)}, {json.dumps(replacement)}],'
    for label, path, target, replacement in mutation_specs
]
mutations = mutations.replace(mutation_anchor, "\n".join(entries) + "\n" + mutation_anchor, 1)
write(MUTATIONS, mutations)

# 5. Final local invariants before returning control to the certification job.
final_verify = read(VERIFY)
final_package_text = read(PACKAGE)
final_release = read(RELEASE_VERIFY)
final_audit = read(AUDIT)
final_mutations = read(MUTATIONS)
if final_verify.count(new_parent) != 1 or final_verify.count(new_temp) != 1:
    fail("Final Windows same-drive extraction invariant missing or duplicated")
if json.loads(final_package_text).get("scripts", {}).get("test:e2e:firefox-key-stress") != expected_stress:
    fail("Final Windows Firefox stress package script drifted")
if final_release.count("steps.push(['run','test:e2e:firefox-key-stress']);") != 1:
    fail("Final Windows Firefox stress release gate missing or duplicated")
for label in (TEMP_LABEL, FIREFOX_LABEL):
    if final_audit.count(f'"{label}"') != 1:
        fail(f"Final Windows package-cert safeguard missing or duplicated: {label}")
for label, _, _, _ in mutation_specs:
    if final_mutations.count(label) != 1:
        fail(f"Final Windows package-cert mutation missing or duplicated: {label}")

print("Windows fresh-extraction repair PASS: round-trip verification stays isolated but uses the release-tree drive on Windows; non-Windows keeps OS TEMP.")
print("Windows Firefox release regression PASS: exact secure-key native pointer path is now a fail-fast 10x release gate with one worker and no retries.")
print("Windows package certification safeguards and three deliberate regression mutations installed.")
