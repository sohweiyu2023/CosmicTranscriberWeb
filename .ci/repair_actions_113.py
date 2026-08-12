from __future__ import annotations

import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
OLD = "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e"  # setup-node v6.4.0
NEW = "820762786026740c76f36085b0efc47a31fe5020"  # setup-node v7.0.0


def fail(message: str) -> None:
    raise SystemExit(message)


def replace(rel: str, expected: int) -> None:
    path = WORK / rel
    if not path.is_file():
        fail(f"setup-node v7 migration required file missing: {rel}")
    text = path.read_text(encoding="utf-8")
    count = text.count(OLD)
    if count != expected:
        fail(f"{rel}: expected {expected} setup-node v6 SHA occurrence(s), found {count}")
    text = text.replace(OLD, NEW)
    if OLD in text or text.count(NEW) < expected:
        fail(f"{rel}: setup-node v7 immutable SHA migration failed")
    path.write_text(text, encoding="utf-8", newline="")


replace(".github/workflows/ci.yml", 4)
replace("scripts/audit-lib.mjs", 1)

print("Packaged CI setup-node modernization PASS: v6.4.0 SHA -> v7.0.0 immutable SHA.")
