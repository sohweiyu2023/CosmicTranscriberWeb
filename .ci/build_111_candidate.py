from __future__ import annotations

import base64
import hashlib
import io
import json
import pathlib
import subprocess
import sys
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
EXPECTED_DELTA_SHA256 = "4138795bba6384709fb6f75d75ebd8cf6a7dcdfc44ba342f70cc217c013ed2bd"
EXPECTED_PARTS = [f"upgrade_111_delta.b64.{i:02d}" for i in range(20)]

# Start from the exact reviewed/certified 1.1.0 lineage. The existing
# materializer is itself part of that certified commit.
subprocess.run(
    [sys.executable, str(ROOT / ".ci" / "build_110_candidate.py")],
    cwd=ROOT,
    check=True,
)

parts = sorted((ROOT / ".ci").glob("upgrade_111_delta.b64.*"))
actual_names = [part.name for part in parts]
if actual_names != EXPECTED_PARTS:
    raise SystemExit(
        "1.1.1 delta part set incomplete or unexpected: "
        f"expected {EXPECTED_PARTS!r}, got {actual_names!r}"
    )

encoded = "".join(part.read_text(encoding="ascii").strip() for part in parts)
try:
    payload = base64.b64decode(encoded, validate=True)
except Exception as exc:  # fail closed before touching the candidate tree
    raise SystemExit(f"1.1.1 delta base64 decode failed: {exc}") from exc

got_sha256 = hashlib.sha256(payload).hexdigest()
if got_sha256 != EXPECTED_DELTA_SHA256:
    raise SystemExit(
        "1.1.1 delta SHA-256 mismatch: "
        f"expected {EXPECTED_DELTA_SHA256}, got {got_sha256}"
    )

with tarfile.open(fileobj=io.BytesIO(payload), mode="r:xz") as archive:
    for member in archive.getmembers():
        if not member.isfile():
            raise SystemExit(f"unsupported 1.1.1 delta member: {member.name}")

        relative = pathlib.PurePosixPath(member.name)
        if relative.is_absolute() or ".." in relative.parts:
            raise SystemExit(f"unsafe 1.1.1 delta path: {member.name}")
        if not relative.parts:
            raise SystemExit("empty 1.1.1 delta path")

        source = archive.extractfile(member)
        if source is None:
            raise SystemExit(f"could not read 1.1.1 delta member: {member.name}")

        destination = WORK.joinpath(*relative.parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source.read())

# Generated Windows evidence is never source and must not survive into a new
# release candidate even if an older materializer happened to leave it behind.
for generated in (
    "windows-release-output.log",
    "windows-release-transcript.log",
    "windows-release-exit-code.txt",
):
    (WORK / generated).unlink(missing_ok=True)

package = json.loads((WORK / "package.json").read_text(encoding="utf-8"))
manifest = json.loads((WORK / "RELEASE_MANIFEST.json").read_text(encoding="utf-8"))

if package.get("version") != "1.1.1":
    raise SystemExit(f"materialized package version is not 1.1.1: {package.get('version')!r}")
if manifest.get("version") != "1.1.1":
    raise SystemExit(f"materialized manifest version is not 1.1.1: {manifest.get('version')!r}")
if manifest.get("releaseReady") is not False:
    raise SystemExit("1.1.1 review candidate must materialize with releaseReady:false")

print(f"1.1.1 reviewed delta SHA-256 PASS: {got_sha256}")
print("Materialized reviewed CosmicTranscriberWeb 1.1.1 candidate (releaseReady:false).")
