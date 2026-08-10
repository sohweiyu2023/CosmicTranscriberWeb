from __future__ import annotations

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
PACKAGE = WORK / "package.json"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"

OLD_WORKERD = "workerd@1.20260801.1"
NEW_WORKERD = "workerd@1.20260804.1"

# Hosted run 31412902961 resolved Wrangler 4.120.1's current Cloudflare runtime
# and correctly stopped before lifecycle scripts because the reviewed positive
# approval was still pinned to workerd 1.20260801.1. Before changing this pin we
# reviewed Cloudflare's exact v1.20260804.1 release provenance:
#
# * cloudflare/workerd tag v1.20260804.1 exists;
# * npm/lib/node-install.ts is blob b3275c6b1bfba80e2d2d830434b18a71b129cb2a,
#   exactly the same blob as the previously approved v1.20260801.1;
# * the tagged release workflow builds npm/workerd/install.js from that source,
#   then publishes the wrapper and platform binaries to npm;
# * cloudflare/workers-sdk at the contemporaneous Wrangler 4.120.1 release pins
#   workerd 1.20260804.1 and explicitly allows workerd lifecycle/build scripts.
#
# Keep the approval exact-version fail-closed. A future workerd release must stop
# certification again until its lifecycle source/provenance is reviewed.
REVIEWED_INSTALL_SOURCE_BLOB = "b3275c6b1bfba80e2d2d830434b18a71b129cb2a"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"Install-policy certification repair required file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"Install-policy certification repair expected UTF-8 file: {path}")
        raise


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


# 1. Replace exactly the one previously-reviewed positive workerd approval.
package_text = read(PACKAGE)
old_line = f'    "{OLD_WORKERD}": true,'
new_line = f'    "{NEW_WORKERD}": true,'
if package_text.count(old_line) != 1:
    fail(
        f"Expected exactly one superseded workerd lifecycle approval {OLD_WORKERD}; "
        f"found {package_text.count(old_line)}"
    )
if new_line in package_text:
    fail(f"New workerd lifecycle approval unexpectedly already present: {NEW_WORKERD}")

before_obj = json.loads(package_text)
before_policy = before_obj.get("allowScripts")
if not isinstance(before_policy, dict):
    fail("package.json allowScripts policy is missing or malformed")
if before_policy.get(OLD_WORKERD) is not True:
    fail(f"Superseded workerd approval is not a positive exact-version entry: {OLD_WORKERD}")
if NEW_WORKERD in before_policy:
    fail(f"New workerd version already appears in allowScripts: {NEW_WORKERD}")

package_text = package_text.replace(old_line, new_line, 1)
after_obj = json.loads(package_text)
after_policy = after_obj.get("allowScripts")
expected_policy = dict(before_policy)
expected_policy.pop(OLD_WORKERD)
expected_policy[NEW_WORKERD] = True
if after_policy != expected_policy:
    fail("workerd lifecycle approval migration changed unrelated allowScripts policy")
write(PACKAGE, package_text)


# 2. Add a source-level safeguard so this reviewed exact version cannot silently
# regress or broaden after the repair.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
label = "reviewed workerd lifecycle approval is exact-version pinned to 1.20260804.1"
if audit.count(audit_anchor) != 1:
    fail(f"Stable audit insertion anchor drifted: {audit.count(audit_anchor)}")
if label in audit:
    fail(f"workerd lifecycle safeguard unexpectedly already present: {label}")
check = (
    f'    ,["{label}", () => '
    f's("package.json").includes("\\\"{NEW_WORKERD}\\\": true")'
    f' && !s("package.json").includes("\\\"{OLD_WORKERD}\\\": true")]\n'
)
audit = audit.replace(audit_anchor, check + audit_anchor, 1)
write(AUDIT, audit)


# 3. Add a deliberate mutation that restores the stale approval; validation must
# detect it. This proves the new safeguard is meaningful rather than decorative.
mutations = read(MUTATIONS)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
mutation_label = (
    "restore superseded workerd install-script approval -> "
    "reviewed workerd lifecycle approval is exact-version pinned to 1.20260804.1"
)
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")
if mutation_label in mutations:
    fail(f"workerd lifecycle mutation unexpectedly already present: {mutation_label}")
entry = (
    f'  ["{mutation_label}", "package.json", '
    r'/"workerd@1\.20260804\.1": true/, '
    '"\\\"workerd@1.20260801.1\\\": true"],\n'
)
mutations = mutations.replace(mutation_anchor, entry + mutation_anchor, 1)
write(MUTATIONS, mutations)


# Final fail-closed checks.
final_package = json.loads(read(PACKAGE))
final_policy = final_package.get("allowScripts", {})
if final_policy.get(NEW_WORKERD) is not True or OLD_WORKERD in final_policy:
    fail("Final workerd lifecycle allowScripts state is not the reviewed exact-version policy")
if read(AUDIT).count(f'"{label}"') != 1:
    fail("Final workerd lifecycle safeguard missing or duplicated")
if read(MUTATIONS).count(mutation_label) != 1:
    fail("Final workerd lifecycle mutation missing or duplicated")

print(
    "Reviewed workerd install-script approval PASS: "
    f"{OLD_WORKERD} -> {NEW_WORKERD}; lifecycle source blob unchanged at "
    f"{REVIEWED_INSTALL_SOURCE_BLOB}."
)
print("workerd lifecycle exact-version safeguard + deliberate stale-pin mutation installed.")
