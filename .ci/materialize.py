from __future__ import annotations

import hashlib
import pathlib
import shutil
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / 'ctw112_ci_source.tar.xz'
WORK = ROOT / 'work'
EXPECTED_SIZE = 139944
EXPECTED_SHA256 = '7633e6ed8f133b3de3a096ee176bd072f2110eb9b39a59fbbc15cb18453a8efb'

if not ARCHIVE.is_file():
    raise SystemExit(f'Missing reviewed CI source snapshot: {ARCHIVE}')
raw = ARCHIVE.read_bytes()
actual_sha = hashlib.sha256(raw).hexdigest()
if len(raw) != EXPECTED_SIZE:
    raise SystemExit(f'CI source snapshot size mismatch: expected {EXPECTED_SIZE}, got {len(raw)}')
if actual_sha != EXPECTED_SHA256:
    raise SystemExit(f'CI source snapshot SHA-256 mismatch: expected {EXPECTED_SHA256}, got {actual_sha}')

if WORK.exists():
    shutil.rmtree(WORK)
WORK.mkdir(parents=True)
work_resolved = WORK.resolve()

with tarfile.open(ARCHIVE, mode='r:xz') as tf:
    members = tf.getmembers()
    if not members:
        raise SystemExit('CI source snapshot is empty')
    for member in members:
        name = member.name.replace('\\', '/')
        if name in ('', '.'):
            continue
        rel = pathlib.PurePosixPath(name)
        if rel.is_absolute() or '..' in rel.parts:
            raise SystemExit(f'Unsafe path in CI source snapshot: {member.name}')
        if not (member.isdir() or member.isfile()):
            raise SystemExit(f'Unsupported non-regular archive entry: {member.name}')
        clean_parts = [p for p in rel.parts if p not in ('', '.')]
        dest = WORK.joinpath(*clean_parts)
        resolved = dest.resolve()
        if resolved != work_resolved and work_resolved not in resolved.parents:
            raise SystemExit(f'Archive entry escapes work directory: {member.name}')
        if member.isdir():
            dest.mkdir(parents=True, exist_ok=True)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        src = tf.extractfile(member)
        if src is None:
            raise SystemExit(f'Could not read regular archive entry: {member.name}')
        with src, dest.open('wb') as out:
            shutil.copyfileobj(src, out)

required = [
    WORK / 'package.json',
    WORK / 'RELEASE_MANIFEST.json',
    WORK / 'WINDOWS-TOOLCHAIN.ps1',
    WORK / 'WINDOWS-TOOLCHAIN-SELFTEST.ps1',
    WORK / 'RELEASE-WINDOWS.ps1',
    WORK / '.github' / 'workflows' / 'ci.yml',
]
missing = [str(p.relative_to(ROOT)) for p in required if not p.is_file()]
if missing:
    raise SystemExit('Materialized source is missing required files: ' + ', '.join(missing))

print(f'Materialized reviewed Cosmic Transcriber Web source in {WORK}')
print(f'CI source snapshot bytes: {len(raw)}')
print(f'CI source snapshot SHA-256: {actual_sha}')
