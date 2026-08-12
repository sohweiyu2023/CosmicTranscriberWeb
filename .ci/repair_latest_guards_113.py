from __future__ import annotations

import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"


def fail(message: str) -> None:
    raise SystemExit(message)


def update(rel: str, transforms: list[tuple[str, str, int]]) -> None:
    path = WORK / rel
    if not path.is_file():
        fail(f"1.0.13 dependency safeguard file missing: {rel}")
    text = path.read_text(encoding="utf-8")
    for old, new, expected in transforms:
        count = text.count(old)
        if count != expected:
            fail(f"{rel}: expected {expected} occurrence(s) of {old!r}; found {count}")
        text = text.replace(old, new)
    path.write_text(text, encoding="utf-8", newline="")


update(
    "scripts/audit-lib.mjs",
    [("^0.21.0", "^0.21.1", 2)],
)
update(
    "scripts/mutation-suite.mjs",
    [
        ("^0.21.0", "^0.21.1", 1),
        (r"\^0\.21\.0", r"\^0\.21\.1", 1),
    ],
)

print("1.0.13 dependency safeguard modernization PASS: Workers Vitest pool ^0.21.1 is now the guarded current range.")
