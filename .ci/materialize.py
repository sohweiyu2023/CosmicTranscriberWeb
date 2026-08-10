from __future__ import annotations

import hashlib
import pathlib
import re
import shutil
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / 'ctw112_ci_source.tar.xz'
WORK = ROOT / 'work'
EXPECTED_SIZE = 139944
EXPECTED_SHA256 = '7633e6ed8f133b3de3a096ee176bd072f2110eb9b39a59fbbc15cb18453a8efb'

# The uploaded 1.0.12 snapshot remains immutable evidence. A fresh 2026-08-10
# adversarial review found that its CI action references had become stale and
# were tag-pinned. Materialization therefore performs one narrowly scoped,
# deterministic CI-tooling migration only after the original archive passes its
# exact size/SHA-256 check. All product validation/mutation/release gates run on
# the resulting derived tree.
ACTION_MIGRATIONS = {
    'actions/checkout@v6.0.2': 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',  # v7.0.1
    'actions/setup-node@v6.4.0': 'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',  # v6.4.0
    'actions/upload-artifact@v7.0.1': 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',  # v7.0.1
    'actions/download-artifact@v8.0.1': 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',  # v8.0.1
}

# The source's audit/mutation rules also contain regex-literal spellings of the
# same refs. Rewrite those exact spellings as well so the safeguards validate
# the derived, SHA-pinned workflow rather than continuing to bless old tags.
ESCAPED_ACTION_MIGRATIONS = {
    old.replace('/', r'\/').replace('.', r'\.'):
        new.replace('/', r'\/')
    for old, new in ACTION_MIGRATIONS.items()
}

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

changed: list[str] = []
counts: dict[str, int] = {old: 0 for old in ACTION_MIGRATIONS}
escaped_counts: dict[str, int] = {old: 0 for old in ESCAPED_ACTION_MIGRATIONS}

for path in sorted(p for p in WORK.rglob('*') if p.is_file()):
    data = path.read_bytes()
    needles = [x.encode() for x in ACTION_MIGRATIONS] + [x.encode() for x in ESCAPED_ACTION_MIGRATIONS]
    if not any(needle in data for needle in needles):
        continue
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError as exc:
        raise SystemExit(f'Expected CI action identifier unexpectedly appears in non-UTF-8 file: {path}') from exc

    before = text
    for old, new in ACTION_MIGRATIONS.items():
        counts[old] += text.count(old)
        text = text.replace(old, new)
    for old, new in ESCAPED_ACTION_MIGRATIONS.items():
        escaped_counts[old] += text.count(old)
        text = text.replace(old, new)

    if text != before:
        path.write_text(text, encoding='utf-8', newline='')
        changed.append(path.relative_to(WORK).as_posix())

# Fail closed if our reviewed assumptions about the uploaded snapshot drift.
for old in ACTION_MIGRATIONS:
    if counts[old] == 0:
        raise SystemExit(f'Reviewed snapshot no longer contains expected CI action ref: {old}')

ci_path = WORK / '.github' / 'workflows' / 'ci.yml'
ci_text = ci_path.read_text(encoding='utf-8')

# Every first-party GitHub Action invocation in the actual inner CI must now be
# immutable. Comments are intentionally ignored; only executable `uses:` lines
# are evaluated.
uses_refs = re.findall(r'^\s*-?\s*uses:\s*([^\s#]+)', ci_text, flags=re.M)
action_refs = [ref for ref in uses_refs if ref.startswith('actions/')]
if not action_refs:
    raise SystemExit('Inner CI contains no first-party GitHub Action refs after materialization')
bad_refs = [ref for ref in action_refs if not re.fullmatch(r'actions/[A-Za-z0-9_.-]+@[0-9a-f]{40}', ref)]
if bad_refs:
    raise SystemExit('Non-immutable inner CI action refs remain: ' + ', '.join(sorted(set(bad_refs))))

expected_refs = set(ACTION_MIGRATIONS.values())
missing_expected = sorted(ref for ref in expected_refs if ref not in action_refs)
if missing_expected:
    raise SystemExit('Expected current SHA-pinned action refs missing from inner CI: ' + ', '.join(missing_expected))

# Prove no executable/source safeguard still contains one of the superseded
# exact tag refs (plain or regex-literal form) in UTF-8 text.
for path in sorted(p for p in WORK.rglob('*') if p.is_file()):
    data = path.read_bytes()
    stale = [old for old in ACTION_MIGRATIONS if old.encode() in data]
    stale += [old for old in ESCAPED_ACTION_MIGRATIONS if old.encode() in data]
    if not stale:
        continue
    try:
        data.decode('utf-8')
    except UnicodeDecodeError:
        continue
    raise SystemExit(
        f'Stale CI action identifier remains after materialization repair in {path.relative_to(WORK)}: '
        + ', '.join(stale)
    )

print(f'Materialized reviewed Cosmic Transcriber Web source in {WORK}')
print(f'CI source snapshot bytes: {len(raw)}')
print(f'CI source snapshot SHA-256: {actual_sha}')
print(f'Inner CI immutable action pin gate PASS ({len(action_refs)} refs).')
for old, new in ACTION_MIGRATIONS.items():
    print(f'  migrated {old} -> {new}: {counts[old]} plain + {escaped_counts[old.replace("/", r"\/").replace(".", r"\.")]} escaped occurrence(s)')
print(f'CI action migration touched {len(changed)} UTF-8 file(s):')
for rel in changed:
    print(f'  migrated: {rel}')
