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

# The uploaded 1.0.12 snapshot remains immutable evidence. During the fresh
# 2026-08-10 adversarial review, actions/checkout v7.0.1 superseded the older
# reviewed checkout release. Materialization therefore performs one narrowly
# scoped, deterministic CI-tooling migration after verifying the original
# archive byte-for-byte. The full source validation/mutation/release gates run
# only after this derived tree is produced.
OLD_CHECKOUT_SHA = 'de0fac2e4500dabe0009e67214ff5f5447ce83dd'  # v6.0.2
NEW_CHECKOUT_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1'  # v7.0.1
OLD_CHECKOUT_TAG = 'v6.0.2'
NEW_CHECKOUT_TAG = 'v7.0.1'

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

# Fail-closed current-tooling migration. Only UTF-8 text files containing the
# exact reviewed checkout identifiers are rewritten; binaries are never
# touched. Escaped v6\.0\.2 is included because the adversarial audit/mutation
# rules intentionally match the exact reviewed action release.
changed: list[str] = []
sha_replacements = 0
tag_replacements = 0
escaped_tag_replacements = 0
for path in sorted(p for p in WORK.rglob('*') if p.is_file()):
    data = path.read_bytes()
    if (OLD_CHECKOUT_SHA.encode() not in data and
            OLD_CHECKOUT_TAG.encode() not in data and
            b'v6\\.0\\.2' not in data):
        continue
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError as exc:
        raise SystemExit(f'Old checkout identifier unexpectedly appears in non-UTF-8 file: {path}') from exc
    before = text
    sha_replacements += text.count(OLD_CHECKOUT_SHA)
    tag_replacements += text.count(OLD_CHECKOUT_TAG)
    escaped_tag_replacements += text.count(r'v6\.0\.2')
    text = text.replace(OLD_CHECKOUT_SHA, NEW_CHECKOUT_SHA)
    text = text.replace(OLD_CHECKOUT_TAG, NEW_CHECKOUT_TAG)
    text = text.replace(r'v6\.0\.2', r'v7\.0\.1')
    if text != before:
        path.write_text(text, encoding='utf-8', newline='')
        changed.append(path.relative_to(WORK).as_posix())

ci_path = WORK / '.github' / 'workflows' / 'ci.yml'
ci_text = ci_path.read_text(encoding='utf-8')
new_checkout_ref = f'actions/checkout@{NEW_CHECKOUT_SHA}'
old_checkout_refs = (
    f'actions/checkout@{OLD_CHECKOUT_SHA}',
    f'actions/checkout@{OLD_CHECKOUT_TAG}',
)
if any(ref in ci_text for ref in old_checkout_refs):
    raise SystemExit('Checkout v6 reference survived the deterministic 1.0.12 materialization repair')
if ci_text.count(new_checkout_ref) < 4:
    raise SystemExit(
        'Expected checkout v7.0.1 immutable SHA in at least four inner CI jobs; '
        f'found {ci_text.count(new_checkout_ref)}'
    )
if sha_replacements == 0 and tag_replacements == 0:
    raise SystemExit('Reviewed snapshot no longer contains the expected checkout v6 identifiers; repair assumptions drifted')

# Prove the old exact checkout identifiers are gone from all UTF-8 files we can
# safely inspect. This prevents stale audit rules/comments from continuing to
# bless the superseded action release.
for path in sorted(p for p in WORK.rglob('*') if p.is_file()):
    data = path.read_bytes()
    if OLD_CHECKOUT_SHA.encode() in data or OLD_CHECKOUT_TAG.encode() in data or b'v6\\.0\\.2' in data:
        try:
            data.decode('utf-8')
        except UnicodeDecodeError:
            continue
        raise SystemExit(f'Stale checkout v6 identifier remains after materialization repair: {path.relative_to(WORK)}')

print(f'Materialized reviewed Cosmic Transcriber Web source in {WORK}')
print(f'CI source snapshot bytes: {len(raw)}')
print(f'CI source snapshot SHA-256: {actual_sha}')
print(
    'Checkout tooling migration: '
    f'v6.0.2 -> v7.0.1 ({NEW_CHECKOUT_SHA}); '
    f'{sha_replacements} SHA, {tag_replacements} tag, '
    f'{escaped_tag_replacements} escaped-tag replacement(s) across {len(changed)} file(s)'
)
for rel in changed:
    print(f'  migrated: {rel}')
