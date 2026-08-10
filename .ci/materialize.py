from __future__ import annotations

import base64
import hashlib
import pathlib
import shutil
import subprocess
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
PARTS = sorted((ROOT / ".ci").glob("source.part*"))
EXPECTED_ARCHIVE_SHA256 = "995bd4d1f4e2933eb96d2fa96fe19bb708aa9109a1650d48adcc46f52fa7bd08"

if not PARTS:
    raise SystemExit("No CI source archive parts found")

part_texts = [part.read_text(encoding="utf-8").strip() for part in PARTS]
encoded = "".join(part_texts)
archive = base64.b64decode(encoded, validate=True)
actual = hashlib.sha256(archive).hexdigest()
print("CI source transport diagnostics:")
for part, text in zip(PARTS, part_texts):
    print(f"  {part.name}: chars={len(text)} sha256={hashlib.sha256(text.encode()).hexdigest()}")
print(f"  combined-base64-chars={len(encoded)}")
print(f"  decoded-bytes={len(archive)}")
print(f"  first16={archive[:16].hex()}")
print(f"  last22={archive[-22:].hex() if len(archive) >= 22 else archive.hex()}")
print(f"  decoded-sha256={actual}")
if actual != EXPECTED_ARCHIVE_SHA256:
    raise SystemExit(f"CI source archive SHA-256 mismatch: expected {EXPECTED_ARCHIVE_SHA256}, got {actual}")

archive_path = ROOT / ".ci" / "source.zip"
work = ROOT / "work"
archive_path.write_bytes(archive)
if work.exists():
    shutil.rmtree(work)
work.mkdir()

if not zipfile.is_zipfile(archive_path):
    raise SystemExit("CI source transport is not a complete ZIP archive")
with zipfile.ZipFile(archive_path) as zf:
    bad = zf.testzip()
    if bad is not None:
        raise SystemExit(f"CI source ZIP CRC failure: {bad}")
    zf.extractall(work)

subprocess.run(
    ["git", "apply", "--check", "--directory=work", ".ci/latest.patch"],
    cwd=ROOT,
    check=True,
)
subprocess.run(
    ["git", "apply", "--directory=work", ".ci/latest.patch"],
    cwd=ROOT,
    check=True,
)

print(f"Materialized audited Cosmic Transcriber Web source in {work}")
print(f"Base archive SHA-256: {actual}")
