from __future__ import annotations

import json
import pathlib
import re
import runpy

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
RELEASE = WORK / "RELEASE-WINDOWS.ps1"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"

LABEL = "Windows release verifies dependency freshness without rewriting the reviewed graph"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"Windows release lock-integrity repair required file missing: {path}")
    return path.read_text(encoding="utf-8")


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def js_regex_exact(text: str) -> str:
    if "\n" in text or "\r" in text:
        fail("js_regex_exact only supports one-line targets")
    return "/" + re.sub(r"([\\^$.*+?()\[\]{}|/])", r"\\\1", text) + "/"


# Apply all prior package/Firefox certification hardening first.
runpy.run_path(str(ROOT / ".ci" / "repair_windows_package_certification_v2.py"), run_name="__main__")

release = read(RELEASE)
old_heading = "  Write-Host \"`n=== Resolve current dependencies without lifecycle scripts, review them, then validate ===\""
old_command = "  & npm run deps:latest; Require-Success 'npm run deps:latest'"
new_heading = "  Write-Host \"`n=== Verify reviewed dependency graph is still current without mutating it ===\""
new_command = "  & npm run deps:check; Require-Success 'npm run deps:check'"
if release.count(old_heading) != 1 or release.count(old_command) != 1:
    fail(
        "Reviewed Windows dependency-resolution anchors drifted: "
        f"heading={release.count(old_heading)} command={release.count(old_command)}"
    )
if new_heading in release or new_command in release:
    fail("Non-mutating Windows dependency freshness gate unexpectedly already present")
release = release.replace(old_heading, new_heading, 1).replace(old_command, new_command, 1)
write(RELEASE, release)

# Add a static release invariant: the Windows certifier may test freshness but
# must never call the graph-mutating deps:latest workflow after CI has reviewed
# and distributed one exact lockfile.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Stable lock-integrity audit insertion anchor drifted: {audit.count(audit_anchor)}")
if LABEL in audit:
    fail(f"Lock-integrity safeguard unexpectedly already present: {LABEL}")
expr = (
    's("RELEASE-WINDOWS.ps1").includes("=== Verify reviewed dependency graph is still current without mutating it ===")'
    ' && s("RELEASE-WINDOWS.ps1").includes("& npm run deps:check; Require-Success \'npm run deps:check\'")'
    ' && !s("RELEASE-WINDOWS.ps1").includes("npm run deps:latest")'
)
audit = audit.replace(audit_anchor, f'    ,["{LABEL}", () => {expr}]\n' + audit_anchor, 1)
write(AUDIT, audit)

# Mutations prove both halves: reintroducing deps:latest or removing the
# fail-closed freshness check must be detected.
mutations = read(MUTATIONS)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable lock-integrity mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")
mutation_specs = [
    (
        "re-resolve dependencies inside Windows release after lock review -> Windows release verifies dependency freshness without rewriting the reviewed graph",
        "RELEASE-WINDOWS.ps1",
        new_command,
        "  & npm run deps:latest; Require-Success 'npm run deps:latest'",
    ),
    (
        "remove fail-closed dependency freshness check from Windows release -> Windows release verifies dependency freshness without rewriting the reviewed graph",
        "RELEASE-WINDOWS.ps1",
        new_command,
        "  Write-Host 'dependency freshness check removed'",
    ),
]
for label, _, _, _ in mutation_specs:
    if label in mutations:
        fail(f"Lock-integrity mutation unexpectedly already present: {label}")
entries = [
    f'  [{json.dumps(label)}, {json.dumps(path)}, {js_regex_exact(target)}, {json.dumps(replacement)}],'
    for label, path, target, replacement in mutation_specs
]
mutations = mutations.replace(mutation_anchor, "\n".join(entries) + "\n" + mutation_anchor, 1)
write(MUTATIONS, mutations)

final_release = read(RELEASE)
final_audit = read(AUDIT)
final_mutations = read(MUTATIONS)
if final_release.count(new_command) != 1 or "npm run deps:latest" in final_release:
    fail("Final Windows release dependency graph remains mutable or freshness gate drifted")
if final_audit.count(f'"{LABEL}"') != 1:
    fail("Final Windows lock-integrity safeguard missing or duplicated")
for label, _, _, _ in mutation_specs:
    if final_mutations.count(label) != 1:
        fail(f"Final lock-integrity mutation missing or duplicated: {label}")

print("Windows release lock-integrity repair PASS: dependency freshness is fail-closed via deps:check and the reviewed package.json/package-lock.json are never re-resolved during certification.")
