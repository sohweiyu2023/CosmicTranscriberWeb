from __future__ import annotations

import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"


def fail(message: str) -> None:
    raise SystemExit(message)


def replace_once(path: pathlib.Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        fail(f"Expected exactly one {label} in {path}; found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="")


# The original mutation target appears both in verifyPatched() and in the executable
# resolver rewrite. Mutation-suite replaces only the first match, so it could mutate
# the verifier string while leaving the actual rewrite intact. Bind the safeguard and
# deliberate mutation to the unique executable replaceOnce call instead.
audit_old = 's("scripts/vitest-windows-runtime-compat.mjs").includes("ctwVitestRuntimeWithLoadedCasing(pathToFileURL(file).href)")'
audit_new = audit_old + ' && s("scripts/vitest-windows-runtime-compat.mjs").includes("text=replaceOnce(text,oldDistExternalize")'
replace_once(AUDIT, audit_old, audit_new, "Vitest executable-rewrite audit anchor")

mutation_old = r'/ctwVitestRuntimeWithLoadedCasing\(pathToFileURL\(file\)\.href\)/, "pathToFileURL(file).href"'
# Important: the replacement must not retain the safeguard substring
# "text=replaceOnce(text,oldDistExternalize"; otherwise the deliberate mutation
# leaves the guard true and mutation testing cannot prove the executable rewrite.
mutation_new = r'/text=replaceOnce\(text,oldDistExternalize/, "text=replaceOnce(text,ctwBrokenDistExternalize"'
replace_once(MUTATIONS, mutation_old, mutation_new, "Vitest loaded-casing deliberate mutation")

print("Vitest Windows mutation guard repair PASS: loaded-casing regression now targets and actually removes the unique executable resolver-rewrite safeguard substring.")
