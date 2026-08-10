from __future__ import annotations

import base64
import hashlib
import pathlib
import shutil
import subprocess
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
PARTS = sorted((ROOT / ".ci").glob("source.part*"))
EXPECTED_ARCHIVE_SHA256 = "efb3f6c794d8f0ecbcaa42b8d9ce3f584a310c4832218ae8b087a3e1d3d27a47"

if not PARTS:
    raise SystemExit("No CI source archive parts found")

encoded = "".join(part.read_text(encoding="utf-8").strip() for part in PARTS)
archive = base64.b64decode(encoded, validate=True)
actual = hashlib.sha256(archive).hexdigest()
if actual != EXPECTED_ARCHIVE_SHA256:
    raise SystemExit(f"CI source archive SHA-256 mismatch: expected {EXPECTED_ARCHIVE_SHA256}, got {actual}")

archive_path = ROOT / ".ci" / "source.zip"
work = ROOT / "work"
archive_path.write_bytes(archive)
if work.exists():
    shutil.rmtree(work)
work.mkdir()

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
