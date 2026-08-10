from __future__ import annotations

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
PACKAGE = WORK / "package.json"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"

OLDER_WORKERD = "workerd@1.20260801.1"
NEWER_WORKERD = "workerd@1.20260804.1"

# Hosted runs exposed both reviewed workerd versions in the same current lock:
# run 31412902961 stopped on 1.20260804.1 while 1.20260801.1 was approved; after
# replacing that approval, run 31421523082 stopped on 1.20260801.1. The correct
# policy is therefore to retain the older exact approval and add the newer exact
# approval, not replace one with the other.
#
# Before approving 1.20260804.1 we reviewed Cloudflare's release provenance:
# * cloudflare/workerd tag v1.20260804.1 exists;
# * npm/lib/node-install.ts is blob b3275c6b1bfba80e2d2d830434b18a71b129cb2a;
# * v1.20260801.1 has the exact same lifecycle-source blob;
# * the tagged release workflow builds npm/workerd/install.js from that source
#   and publishes the wrapper/platform binaries;
# * Cloudflare workers-sdk at Wrangler 4.120.1 pins workerd 1.20260804.1 and
#   explicitly allows workerd lifecycle/build scripts.
#
# Keep both approvals exact-version and fail-closed. Any other workerd version
# must stop certification for a fresh lifecycle/provenance review.
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


# 1. Preserve the previously reviewed older approval and add exactly the newly
# reviewed version. Prove no unrelated allowScripts entry changes.
package_text = read(PACKAGE)
older_line = f'    "{OLDER_WORKERD}": true,'
newer_line = f'    "{NEWER_WORKERD}": true,'
if package_text.count(older_line) != 1:
    fail(
        f"Expected exactly one reviewed workerd lifecycle approval {OLDER_WORKERD}; "
        f"found {package_text.count(older_line)}"
    )
if newer_line in package_text:
    fail(f"Newer workerd lifecycle approval unexpectedly already present: {NEWER_WORKERD}")

before_obj = json.loads(package_text)
before_policy = before_obj.get("allowScripts")
if not isinstance(before_policy, dict):
    fail("package.json allowScripts policy is missing or malformed")
if before_policy.get(OLDER_WORKERD) is not True:
    fail(f"Older reviewed workerd approval is not a positive exact-version entry: {OLDER_WORKERD}")
if NEWER_WORKERD in before_policy:
    fail(f"Newer workerd version already appears in allowScripts: {NEWER_WORKERD}")
if before_policy.get("workerd") is True:
    fail("Broad unversioned workerd lifecycle approval is forbidden")

package_text = package_text.replace(older_line, older_line + "\n" + newer_line, 1)
after_obj = json.loads(package_text)
after_policy = after_obj.get("allowScripts")
expected_policy = dict(before_policy)
expected_policy[NEWER_WORKERD] = True
if after_policy != expected_policy:
    fail("workerd lifecycle approval addition changed unrelated allowScripts policy")
write(PACKAGE, package_text)


# 2. Add a static safeguard requiring both reviewed exact versions and rejecting
# any broad unversioned positive approval.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
label = "reviewed workerd lifecycle approvals are exact-version pinned to 1.20260801.1 and 1.20260804.1"
if audit.count(audit_anchor) != 1:
    fail(f"Stable audit insertion anchor drifted: {audit.count(audit_anchor)}")
if label in audit:
    fail(f"workerd lifecycle safeguard unexpectedly already present: {label}")
check = (
    f'    ,["{label}", () => '
    f's("package.json").includes("\\\"{OLDER_WORKERD}\\\": true")'
    f' && s("package.json").includes("\\\"{NEWER_WORKERD}\\\": true")'
    ' && !s("package.json").includes("\\\"workerd\\\": true")]\n'
)
audit = audit.replace(audit_anchor, check + audit_anchor, 1)
write(AUDIT, audit)


# 3. Add deliberate mutations for each exact approval. Validation must detect
# loss of either one, proving the dual-version policy is enforced.
mutations = read(MUTATIONS)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
older_mutation = (
    "drop older reviewed workerd install-script approval -> "
    "reviewed workerd lifecycle approvals are exact-version pinned to 1.20260801.1 and 1.20260804.1"
)
newer_mutation = (
    "drop newer reviewed workerd install-script approval -> "
    "reviewed workerd lifecycle approvals are exact-version pinned to 1.20260801.1 and 1.20260804.1"
)
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")
for mutation_label in (older_mutation, newer_mutation):
    if mutation_label in mutations:
        fail(f"workerd lifecycle mutation unexpectedly already present: {mutation_label}")
entries = (
    f'  ["{older_mutation}", "package.json", '
    r'/"workerd@1\.20260801\.1": true/, '
    '"\\\"workerd@1.20260801.1\\\": false"],\n'
    f'  ["{newer_mutation}", "package.json", '
    r'/"workerd@1\.20260804\.1": true/, '
    '"\\\"workerd@1.20260804.1\\\": false"],\n'
)
mutations = mutations.replace(mutation_anchor, entries + mutation_anchor, 1)
write(MUTATIONS, mutations)


# Final fail-closed checks.
final_package = json.loads(read(PACKAGE))
final_policy = final_package.get("allowScripts", {})
if final_policy.get(OLDER_WORKERD) is not True or final_policy.get(NEWER_WORKERD) is not True:
    fail("Final workerd lifecycle allowScripts state is missing a reviewed exact-version approval")
if final_policy.get("workerd") is True:
    fail("Final workerd lifecycle policy contains forbidden broad unversioned approval")
if read(AUDIT).count(f'"{label}"') != 1:
    fail("Final workerd lifecycle safeguard missing or duplicated")
for mutation_label in (older_mutation, newer_mutation):
    if read(MUTATIONS).count(mutation_label) != 1:
        fail(f"Final workerd lifecycle mutation missing or duplicated: {mutation_label}")

print(
    "Reviewed workerd install-script approvals PASS: retained "
    f"{OLDER_WORKERD} and added {NEWER_WORKERD}; both lifecycle sources are "
    f"the reviewed blob {REVIEWED_INSTALL_SOURCE_BLOB}."
)
print("workerd dual exact-version safeguard + deliberate per-version mutations installed.")
