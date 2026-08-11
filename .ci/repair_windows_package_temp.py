from __future__ import annotations

import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
VERIFY = WORK / "scripts" / "verify-source-package.mjs"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"Windows package-temp repair required file missing: {path}")
    return path.read_text(encoding="utf-8")


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


text = read(VERIFY)
old = "const tmp=await mkdtemp(path.join(os.tmpdir(),'cosmic-package-'));"
new = (
    "const packageTempParent=process.platform==='win32'?path.dirname(root):os.tmpdir();\n"
    "const tmp=await mkdtemp(path.join(packageTempParent,'.cosmic-package-'));"
)
if text.count(old) != 1:
    fail(f"Reviewed fresh-extraction temp anchor drifted: {text.count(old)}")
if "packageTempParent=process.platform==='win32'?path.dirname(root):os.tmpdir()" in text:
    fail("Windows same-drive fresh-extraction repair unexpectedly already present")
text = text.replace(old, new, 1)
write(VERIFY, text)

final = read(VERIFY)
if final.count("packageTempParent=process.platform==='win32'?path.dirname(root):os.tmpdir()") != 1:
    fail("Windows package-temp repair invariant missing or duplicated")
if final.count("mkdtemp(path.join(packageTempParent,'.cosmic-package-'))") != 1:
    fail("Windows package-temp mkdtemp invariant missing or duplicated")

print("Windows fresh-extraction package-temp repair installed: isolated round-trip verification remains fresh but stays on the release tree drive, avoiding cross-drive Vitest runner identity drift.")
