from __future__ import annotations

import json
import pathlib
import re
import runpy

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
RELEASE_VERIFY = WORK / "scripts" / "release-verify.mjs"
RELEASE = WORK / "RELEASE-WINDOWS.ps1"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"
LOCK_LABEL = "Windows release verifies dependency freshness without rewriting the reviewed graph"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"Windows package certification v2 required file missing: {path}")
    return path.read_text(encoding="utf-8")


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def js_regex_exact(text: str) -> str:
    if "\n" in text or "\r" in text:
        fail("js_regex_exact only supports one-line targets")
    return "/" + re.sub(r"([\\^$.*+?()\[\]{}|/])", r"\\\1", text) + "/"


# Apply the substantive v1 repair first, then preserve the exact legacy branded
# Windows release statement so its long-standing safeguard and mutation remain
# valid. This is additive hardening, not a weakening/rewrite of that older gate.
runpy.run_path(str(ROOT / ".ci" / "repair_windows_package_certification.py"), run_name="__main__")

release_verify = read(RELEASE_VERIFY)
old_block = (
    "if(process.platform==='win32'){\n"
    "  steps.push(['run','test:e2e:firefox-key-stress']);\n"
    "  steps.push(['run','test:e2e:branded']);\n"
    "}"
)
stress_line = "if(process.platform==='win32')steps.push(['run','test:e2e:firefox-key-stress']);"
branded_line = "if(process.platform==='win32')steps.push(['run','test:e2e:branded']);"
new_lines = stress_line + "\n" + branded_line
if release_verify.count(old_block) != 1:
    fail(f"Expected exactly one v1 Windows release block; found {release_verify.count(old_block)}")
release_verify = release_verify.replace(old_block, new_lines, 1)
write(RELEASE_VERIFY, release_verify)

# Retarget only the newly-added stress mutation to the final conditional line.
# The legacy branded mutation is deliberately left untouched and becomes valid
# again because branded_line is restored byte-for-byte.
firefox_label = (
    "remove Firefox secure-key stress from Windows release verification -> "
    "Windows release stress-tests the repaired Firefox secure-key pointer path"
)
mutations = read(MUTATIONS)
lines = mutations.splitlines()
hits = [i for i, line in enumerate(lines) if firefox_label in line]
if len(hits) != 1:
    fail(f"Expected exactly one new Firefox stress mutation row; found {len(hits)}")
lines[hits[0]] = (
    f'  [{json.dumps(firefox_label)}, "scripts/release-verify.mjs", '
    f'{js_regex_exact(stress_line)}, "void 0;"],'
)
mutations = "\n".join(lines) + ("\n" if mutations.endswith("\n") else "")
write(MUTATIONS, mutations)

# Preserve the reviewed dependency graph during Windows certification. The
# resolve-lock job owns graph resolution and proves direct dependencies current.
# Windows may fail closed if something becomes outdated meanwhile, but it must
# never call deps:latest and silently rewrite the graph after review.
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

# Add the static graph-integrity invariant.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Stable lock-integrity audit insertion anchor drifted: {audit.count(audit_anchor)}")
if LOCK_LABEL in audit:
    fail(f"Lock-integrity safeguard unexpectedly already present: {LOCK_LABEL}")
lock_expr = (
    's("RELEASE-WINDOWS.ps1").includes("=== Verify reviewed dependency graph is still current without mutating it ===")'
    ' && s("RELEASE-WINDOWS.ps1").includes("& npm run deps:check; Require-Success \'npm run deps:check\'")'
    ' && !s("RELEASE-WINDOWS.ps1").includes("npm run deps:latest")'
)
audit = audit.replace(audit_anchor, f'    ,["{LOCK_LABEL}", () => {lock_expr}]\n' + audit_anchor, 1)
write(AUDIT, audit)

# Add deliberate graph-integrity mutations after the v1/v2 mutation edits.
mutations = read(MUTATIONS)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail(f"Stable lock-integrity mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")
lock_mutations = [
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
for label, _, _, _ in lock_mutations:
    if label in mutations:
        fail(f"Lock-integrity mutation unexpectedly already present: {label}")
entries = [
    f'  [{json.dumps(label)}, {json.dumps(path)}, {js_regex_exact(target)}, {json.dumps(replacement)}],'
    for label, path, target, replacement in lock_mutations
]
mutations = mutations.replace(mutation_anchor, "\n".join(entries) + "\n" + mutation_anchor, 1)
write(MUTATIONS, mutations)

final_release_verify = read(RELEASE_VERIFY)
final_release = read(RELEASE)
final_audit = read(AUDIT)
final_mutations = read(MUTATIONS)
if final_release_verify.count(stress_line) != 1:
    fail("Final conditional Windows Firefox stress line missing or duplicated")
if final_release_verify.count(branded_line) != 1:
    fail("Legacy Windows branded release line was not preserved exactly once")
if final_release_verify.count("if(process.platform==='win32'){") != 0:
    fail("Temporary v1 Windows block unexpectedly remains")
if final_release.count(new_command) != 1 or "npm run deps:latest" in final_release:
    fail("Final Windows release dependency graph remains mutable or freshness gate drifted")
if final_audit.count(f'"{LOCK_LABEL}"') != 1:
    fail("Final Windows lock-integrity safeguard missing or duplicated")
for label, _, _, _ in lock_mutations:
    if final_mutations.count(label) != 1:
        fail(f"Final lock-integrity mutation missing or duplicated: {label}")

print("Legacy Windows branded release invariant preserved byte-for-byte while the new Firefox 10x stress gate remains independently fail-fast.")
print("Windows release lock-integrity repair PASS: dependency freshness is fail-closed via deps:check and the reviewed package.json/package-lock.json are never re-resolved during certification.")
