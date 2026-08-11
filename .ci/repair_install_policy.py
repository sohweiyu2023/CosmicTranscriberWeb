from __future__ import annotations

import copy
import json
import pathlib
import re
import runpy

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
PACKAGE = WORK / "package.json"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"

OLDER_WORKERD = "workerd@1.20260801.1"
NEWER_WORKERD = "workerd@1.20260804.1"
VITEST_POOL = "@cloudflare/vitest-pool-workers"
OLD_POOL_SPECS = {"^0.20.3", "~0.20.3", "0.20.3"}
NEW_POOL_SPEC = "^0.21.0"

REVIEWED_INSTALL_SOURCE_BLOB = "b3275c6b1bfba80e2d2d830434b18a71b129cb2a"
REVIEWED_POOL_SOURCE_COMMIT = "72154fde812da6f5ca996b8657827137cb7746ee"
REVIEWED_POOL_PACKAGE_BLOB = "a8d0be3f023e27ff8a4574f5966672785ff04713"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"Install/dependency certification repair required file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"Install/dependency certification repair expected UTF-8 file: {path}")
        raise


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


package_text = read(PACKAGE)
before_obj = json.loads(package_text)

older_line = f'    "{OLDER_WORKERD}": true,'
newer_line = f'    "{NEWER_WORKERD}": true,'
if package_text.count(older_line) != 1:
    fail(
        f"Expected exactly one reviewed workerd lifecycle approval {OLDER_WORKERD}; "
        f"found {package_text.count(older_line)}"
    )
if newer_line in package_text:
    fail(f"Newer workerd lifecycle approval unexpectedly already present: {NEWER_WORKERD}")

before_policy = before_obj.get("allowScripts")
if not isinstance(before_policy, dict):
    fail("package.json allowScripts policy is missing or malformed")
if before_policy.get(OLDER_WORKERD) is not True:
    fail(f"Older reviewed workerd approval is not a positive exact-version entry: {OLDER_WORKERD}")
if NEWER_WORKERD in before_policy:
    fail(f"Newer workerd version already appears in allowScripts: {NEWER_WORKERD}")
if before_policy.get("workerd") is True:
    fail("Broad unversioned workerd lifecycle approval is forbidden")

pool_locations = [
    section
    for section in ("dependencies", "devDependencies")
    if isinstance(before_obj.get(section), dict) and VITEST_POOL in before_obj[section]
]
if len(pool_locations) != 1:
    fail(
        f"Expected {VITEST_POOL} in exactly one direct dependency section; "
        f"found {pool_locations}"
    )
pool_section = pool_locations[0]
old_pool_spec = before_obj[pool_section][VITEST_POOL]
if old_pool_spec not in OLD_POOL_SPECS:
    fail(
        f"Reviewed Workers Vitest pool spec drifted: expected one of "
        f"{sorted(OLD_POOL_SPECS)}, got {old_pool_spec!r}"
    )

package_text = package_text.replace(older_line, older_line + "\n" + newer_line, 1)

pool_pattern = re.compile(
    rf'(?m)^(?P<indent>[ \t]*)"{re.escape(VITEST_POOL)}"[ \t]*:[ \t]*'
    rf'"(?P<spec>[^"]+)"(?P<comma>,?)[ \t]*$'
)
pool_hits = list(pool_pattern.finditer(package_text))
if len(pool_hits) != 1:
    fail(f"Expected exactly one textual {VITEST_POOL} dependency entry; found {len(pool_hits)}")
if pool_hits[0].group("spec") != old_pool_spec:
    fail(
        f"Workers Vitest pool textual spec disagrees with parsed package.json: "
        f"{pool_hits[0].group('spec')!r} != {old_pool_spec!r}"
    )
pool_replacement = (
    f'{pool_hits[0].group("indent")}"{VITEST_POOL}": '
    f'"{NEW_POOL_SPEC}"{pool_hits[0].group("comma")}'
)
package_text = (
    package_text[: pool_hits[0].start()]
    + pool_replacement
    + package_text[pool_hits[0].end() :]
)

after_obj = json.loads(package_text)
expected_obj = copy.deepcopy(before_obj)
expected_obj["allowScripts"][NEWER_WORKERD] = True
expected_obj[pool_section][VITEST_POOL] = NEW_POOL_SPEC
if after_obj != expected_obj:
    fail("Install/dependency certification repair changed an unrelated package.json semantic field")
write(PACKAGE, package_text)

audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
workerd_label = (
    "reviewed workerd lifecycle approvals are exact-version pinned to "
    "1.20260801.1 and 1.20260804.1"
)
pool_label = "current Workers Vitest pool direct dependency is ^0.21.0"
if audit.count(audit_anchor) != 1:
    fail(f"Stable audit insertion anchor drifted: {audit.count(audit_anchor)}")
for label in (workerd_label, pool_label):
    if label in audit:
        fail(f"install/dependency safeguard unexpectedly already present: {label}")

workerd_old_fragment = json.dumps(f'"{OLDER_WORKERD}": true')
workerd_new_fragment = json.dumps(f'"{NEWER_WORKERD}": true')
workerd_broad_fragment = json.dumps('"workerd": true')
pool_new_fragment = json.dumps(f'"{VITEST_POOL}": "{NEW_POOL_SPEC}"')
pool_old_fragment = json.dumps(f'"{VITEST_POOL}": "^0.20.3"')
workerd_check = (
    f'    ,["{workerd_label}", () => '
    f's("package.json").includes({workerd_old_fragment})'
    f' && s("package.json").includes({workerd_new_fragment})'
    f' && !s("package.json").includes({workerd_broad_fragment})]\n'
)
pool_check = (
    f'    ,["{pool_label}", () => '
    f's("package.json").includes({pool_new_fragment})'
    f' && !s("package.json").includes({pool_old_fragment})]\n'
)
audit = audit.replace(audit_anchor, workerd_check + pool_check + audit_anchor, 1)
write(AUDIT, audit)

mutations = read(MUTATIONS)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
older_mutation = (
    "drop older reviewed workerd install-script approval -> "
    "reviewed workerd lifecycle approvals are exact-version pinned to "
    "1.20260801.1 and 1.20260804.1"
)
newer_mutation = (
    "drop newer reviewed workerd install-script approval -> "
    "reviewed workerd lifecycle approvals are exact-version pinned to "
    "1.20260801.1 and 1.20260804.1"
)
pool_mutation = (
    "restore superseded Workers Vitest pool direct dependency -> "
    "current Workers Vitest pool direct dependency is ^0.21.0"
)
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")
for mutation_label in (older_mutation, newer_mutation, pool_mutation):
    if mutation_label in mutations:
        fail(f"install/dependency mutation unexpectedly already present: {mutation_label}")

older_replacement = json.dumps(f'"{OLDER_WORKERD}": false')
newer_replacement = json.dumps(f'"{NEWER_WORKERD}": false')
pool_replacement_js = json.dumps(f'"{VITEST_POOL}": "^0.20.3"')
entries = (
    f'  [{json.dumps(older_mutation)}, "package.json", '
    r'/"workerd@1\.20260801\.1": true/, '
    f'{older_replacement}],\n'
    f'  [{json.dumps(newer_mutation)}, "package.json", '
    r'/"workerd@1\.20260804\.1": true/, '
    f'{newer_replacement}],\n'
    f'  [{json.dumps(pool_mutation)}, "package.json", '
    r'/"@cloudflare\/vitest-pool-workers": "\^0\.21\.0"/, '
    f'{pool_replacement_js}],\n'
)
mutations = mutations.replace(mutation_anchor, entries + mutation_anchor, 1)
write(MUTATIONS, mutations)

final_package = json.loads(read(PACKAGE))
final_policy = final_package.get("allowScripts", {})
if (
    final_policy.get(OLDER_WORKERD) is not True
    or final_policy.get(NEWER_WORKERD) is not True
):
    fail("Final workerd lifecycle allowScripts state is missing a reviewed exact-version approval")
if final_policy.get("workerd") is True:
    fail("Final workerd lifecycle policy contains forbidden broad unversioned approval")
if final_package.get(pool_section, {}).get(VITEST_POOL) != NEW_POOL_SPEC:
    fail("Final Workers Vitest pool direct dependency is not the reviewed current range")
for label in (workerd_label, pool_label):
    if read(AUDIT).count(f'"{label}"') != 1:
        fail(f"Final install/dependency safeguard missing or duplicated: {label}")
for mutation_label in (older_mutation, newer_mutation, pool_mutation):
    if read(MUTATIONS).count(mutation_label) != 1:
        fail(f"Final install/dependency mutation missing or duplicated: {mutation_label}")

print(
    "Reviewed workerd install-script approvals PASS: retained "
    f"{OLDER_WORKERD} and added {NEWER_WORKERD}; both lifecycle sources are "
    f"the reviewed blob {REVIEWED_INSTALL_SOURCE_BLOB}."
)
print(
    "Current direct dependency repair PASS: "
    f"{VITEST_POOL} {old_pool_spec} -> {NEW_POOL_SPEC}; "
    f"official package blob {REVIEWED_POOL_PACKAGE_BLOB} at "
    f"{REVIEWED_POOL_SOURCE_COMMIT}."
)
print(
    "workerd dual exact-version + current Workers Vitest pool safeguards and "
    "deliberate regression mutations installed."
)

# Run the cross-browser behavioral cookie-contract repair after the E2E and
# dependency repairs have established their stable derived anchors. Any failure
# propagates and stops certification on every platform.
runpy.run_path(str(ROOT / ".ci" / "repair_cookie_contract.py"), run_name="__main__")
