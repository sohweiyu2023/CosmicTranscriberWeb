from __future__ import annotations

import json
import pathlib
import re
import runpy

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
RELEASE_VERIFY = WORK / "scripts" / "release-verify.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
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
label = (
    "remove Firefox secure-key stress from Windows release verification -> "
    "Windows release stress-tests the repaired Firefox secure-key pointer path"
)
mutations = read(MUTATIONS)
lines = mutations.splitlines()
hits = [i for i, line in enumerate(lines) if label in line]
if len(hits) != 1:
    fail(f"Expected exactly one new Firefox stress mutation row; found {len(hits)}")
lines[hits[0]] = (
    f'  [{json.dumps(label)}, "scripts/release-verify.mjs", '
    f'{js_regex_exact(stress_line)}, "void 0;"],'
)
mutations = "\n".join(lines) + ("\n" if mutations.endswith("\n") else "")
write(MUTATIONS, mutations)

final_release = read(RELEASE_VERIFY)
if final_release.count(stress_line) != 1:
    fail("Final conditional Windows Firefox stress line missing or duplicated")
if final_release.count(branded_line) != 1:
    fail("Legacy Windows branded release line was not preserved exactly once")
if final_release.count("if(process.platform==='win32'){") != 0:
    fail("Temporary v1 Windows block unexpectedly remains")

print("Legacy Windows branded release invariant preserved byte-for-byte while the new Firefox 10x stress gate remains independently fail-fast.")
