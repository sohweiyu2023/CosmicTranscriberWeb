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

# The uploaded 1.0.12 snapshot is immutable evidence. Fresh certification found
# four CI-environment/coverage issues after that snapshot was reviewed:
# stale/tag-pinned first-party Actions; fresh runners that do not guarantee
# ffmpeg/ffprobe; and the packaged macOS and Windows jobs not running the full
# validation suite. Materialization repairs only those reviewed CI surfaces
# after verifying the source archive byte-for-byte. Every product/release gate
# runs on the derived tree and is free to reject it.
ACTION_MIGRATIONS = {
    'actions/checkout@v6.0.2': 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',  # v7.0.1
    'actions/setup-node@v6.4.0': 'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',  # v6.4.0
    'actions/upload-artifact@v7.0.1': 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',  # v7.0.1
    'actions/download-artifact@v8.0.1': 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',  # v8.0.1
}
ESCAPED_ACTION_MIGRATIONS = {
    old.replace('/', r'\/').replace('.', r'\.'):
        new.replace('/', r'\/')
    for old, new in ACTION_MIGRATIONS.items()
}


def fail(message: str) -> None:
    raise SystemExit(message)


def read_utf8(path: pathlib.Path) -> str:
    try:
        return path.read_text(encoding='utf-8')
    except UnicodeDecodeError as exc:
        fail(f'Expected UTF-8 text file could not be decoded: {path}')
        raise exc


if not ARCHIVE.is_file():
    fail(f'Missing reviewed CI source snapshot: {ARCHIVE}')
raw = ARCHIVE.read_bytes()
actual_sha = hashlib.sha256(raw).hexdigest()
if len(raw) != EXPECTED_SIZE:
    fail(f'CI source snapshot size mismatch: expected {EXPECTED_SIZE}, got {len(raw)}')
if actual_sha != EXPECTED_SHA256:
    fail(f'CI source snapshot SHA-256 mismatch: expected {EXPECTED_SHA256}, got {actual_sha}')

if WORK.exists():
    shutil.rmtree(WORK)
WORK.mkdir(parents=True)
work_resolved = WORK.resolve()

with tarfile.open(ARCHIVE, mode='r:xz') as tf:
    members = tf.getmembers()
    if not members:
        fail('CI source snapshot is empty')
    for member in members:
        name = member.name.replace('\\', '/')
        if name in ('', '.'):
            continue
        rel = pathlib.PurePosixPath(name)
        if rel.is_absolute() or '..' in rel.parts:
            fail(f'Unsafe path in CI source snapshot: {member.name}')
        if not (member.isdir() or member.isfile()):
            fail(f'Unsupported non-regular archive entry: {member.name}')
        clean_parts = [p for p in rel.parts if p not in ('', '.')]
        dest = WORK.joinpath(*clean_parts)
        resolved = dest.resolve()
        if resolved != work_resolved and work_resolved not in resolved.parents:
            fail(f'Archive entry escapes work directory: {member.name}')
        if member.isdir():
            dest.mkdir(parents=True, exist_ok=True)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        src = tf.extractfile(member)
        if src is None:
            fail(f'Could not read regular archive entry: {member.name}')
        with src, dest.open('wb') as out:
            shutil.copyfileobj(src, out)

required = [
    WORK / 'package.json',
    WORK / 'RELEASE_MANIFEST.json',
    WORK / 'WINDOWS-TOOLCHAIN.ps1',
    WORK / 'WINDOWS-TOOLCHAIN-SELFTEST.ps1',
    WORK / 'RELEASE-WINDOWS.ps1',
    WORK / '.github' / 'workflows' / 'ci.yml',
    WORK / 'scripts' / 'audit-lib.mjs',
    WORK / 'scripts' / 'mutation-suite.mjs',
]
missing = [str(p.relative_to(ROOT)) for p in required if not p.is_file()]
if missing:
    fail('Materialized source is missing required files: ' + ', '.join(missing))

changed: set[str] = set()
counts = {old: 0 for old in ACTION_MIGRATIONS}
escaped_counts = {old: 0 for old in ESCAPED_ACTION_MIGRATIONS}
needles = [x.encode() for x in ACTION_MIGRATIONS] + [x.encode() for x in ESCAPED_ACTION_MIGRATIONS]

for path in sorted(p for p in WORK.rglob('*') if p.is_file()):
    data = path.read_bytes()
    if not any(needle in data for needle in needles):
        continue
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError as exc:
        fail(f'Expected CI action identifier unexpectedly appears in non-UTF-8 file: {path}')
        raise exc
    before = text
    for old, new in ACTION_MIGRATIONS.items():
        counts[old] += text.count(old)
        text = text.replace(old, new)
    for old, new in ESCAPED_ACTION_MIGRATIONS.items():
        escaped_counts[old] += text.count(old)
        text = text.replace(old, new)
    if text != before:
        path.write_text(text, encoding='utf-8', newline='')
        changed.add(path.relative_to(WORK).as_posix())

for old, count in counts.items():
    if count == 0:
        fail(f'Reviewed snapshot no longer contains expected CI action ref: {old}')

ci_path = WORK / '.github' / 'workflows' / 'ci.yml'
ci_text = read_utf8(ci_path)


def insert_before_unique(text: str, anchor: str, insertion: str, label: str) -> str:
    count = text.count(anchor)
    if count != 1:
        fail(f'Expected exactly one {label} anchor; found {count}')
    return text.replace(anchor, insertion + anchor, 1)


fixture_anchor = '      - name: Generate deterministic MP3 fixtures\n'
fixture_block = '''      - name: Provision MP3 fixture toolchain
        shell: bash
        run: |
          sudo apt-get update
          sudo apt-get install -y --no-install-recommends ffmpeg
          command -v ffmpeg
          command -v ffprobe
          ffmpeg -version | head -n 1
          ffprobe -version | head -n 1
'''
ci_text = insert_before_unique(ci_text, fixture_anchor, fixture_block, 'fixture-generation')

linux_media = '''      - name: Provision media validation toolchain
        shell: bash
        run: |
          sudo apt-get update
          sudo apt-get install -y --no-install-recommends ffmpeg
          command -v ffmpeg
          command -v ffprobe
          ffmpeg -version | head -n 1
          ffprobe -version | head -n 1
'''
mac_media = '''      - name: Provision media validation toolchain
        shell: bash
        run: |
          if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
            brew install ffmpeg
          fi
          command -v ffmpeg
          command -v ffprobe
          ffmpeg -version | head -n 1
          ffprobe -version | head -n 1
'''
windows_media = '''      - name: Provision media validation toolchain
        shell: pwsh
        run: |
          if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -or -not (Get-Command ffprobe -ErrorAction SilentlyContinue)) {
            choco install ffmpeg -y --no-progress
          }
          $ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
          $ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
          if ($null -eq $ffmpeg -or $null -eq $ffprobe) { throw 'ffmpeg/ffprobe provisioning failed.' }
          & $ffmpeg.Source -version | Select-Object -First 1
          & $ffprobe.Source -version | Select-Object -First 1
'''
validate_step = '''      - working-directory: work
        run: npm run validate
'''


def isolate_job(text: str, job: str, next_job: str) -> tuple[int, int, str]:
    start_marker = f'  {job}:\n'
    end_marker = f'  {next_job}:\n'
    start = text.find(start_marker)
    end = text.find(end_marker, start + len(start_marker))
    if start < 0 or end < 0:
        fail(f'Could not isolate inner CI job {job}')
    return start, end, text[start:end]


def step_blocks(segment: str) -> list[re.Match[str]]:
    return list(re.finditer(r'(?ms)^      - .*?(?=^      - |\Z)', segment))


def simple_run_commands(segment: str) -> list[str]:
    commands: list[str] = []
    for step in step_blocks(segment):
        commands.extend(re.findall(r'(?m)^\s*(?:-\s*)?run:\s*([^|>][^\n]*)$', step.group(0)))
    return commands


def command_step_hits(segment: str, command: str) -> list[re.Match[str]]:
    hits: list[re.Match[str]] = []
    pattern = re.compile(rf'(?m)^\s*(?:-\s*)?run:\s*{re.escape(command)}\s*$')
    for step in step_blocks(segment):
        if pattern.search(step.group(0)):
            hits.append(step)
    return hits


def inject_before_required_command(text: str, job: str, next_job: str, command: str, block: str) -> str:
    start, end, segment = isolate_job(text, job, next_job)
    hits = command_step_hits(segment, command)
    if len(hits) != 1:
        fail(
            f'Expected exactly one {command} step in inner CI job {job}; found {len(hits)}. '
            f'Discovered simple run commands: {simple_run_commands(segment)}'
        )
    hit = hits[0]
    segment = segment[:hit.start()] + block + segment[hit.start():]
    return text[:start] + segment + text[end:]


def ensure_validation_before_command(
    text: str,
    job: str,
    next_job: str,
    media_block: str,
    anchor_command: str,
) -> str:
    start, end, segment = isolate_job(text, job, next_job)
    validate_hits = command_step_hits(segment, 'npm run validate')
    if len(validate_hits) > 1:
        fail(
            f'Expected at most one npm run validate step in inner CI job {job}; found {len(validate_hits)}. '
            f'Discovered simple run commands: {simple_run_commands(segment)}'
        )
    if len(validate_hits) == 1:
        hit = validate_hits[0]
        segment = segment[:hit.start()] + media_block + segment[hit.start():]
    else:
        anchor_hits = command_step_hits(segment, anchor_command)
        if len(anchor_hits) != 1:
            fail(
                f'Expected exactly one {anchor_command} anchor in inner CI job {job} when adding validation; '
                f'found {len(anchor_hits)}. Discovered simple run commands: {simple_run_commands(segment)}'
            )
        hit = anchor_hits[0]
        segment = segment[:hit.start()] + media_block + validate_step + segment[hit.start():]
    return text[:start] + segment + text[end:]


# Linux already had full validation; preserve it and put the decoder/probe
# prerequisite immediately before that existing step.
ci_text = inject_before_required_command(
    ci_text, 'linux-full', 'macos-safari', 'npm run validate', linux_media
)

# Fresh hosted evidence proved that the packaged macOS and Windows jobs never
# ran full validation. Add it before their existing build/browser/release stages.
# If a future source already contains exactly one validation step, keep it and
# only add the media prerequisite immediately before it.
ci_text = ensure_validation_before_command(
    ci_text, 'macos-safari', 'windows-release', mac_media, 'npm run build'
)
ci_text = ensure_validation_before_command(
    ci_text, 'windows-release', 'all-green', windows_media, 'npm run build'
)

if ci_text.count('name: Provision media validation toolchain') != 3:
    fail('Inner CI media provisioning was not inserted into all three platform jobs')
if ci_text.count('name: Provision MP3 fixture toolchain') != 1:
    fail('Inner CI fixture media provisioning was not inserted exactly once')
if 'brew install ffmpeg' not in ci_text or 'choco install ffmpeg -y --no-progress' not in ci_text:
    fail('Inner CI is missing macOS or Windows ffmpeg provisioning')

validation_jobs = (
    ('resolve-lock', 'linux-full'),
    ('linux-full', 'macos-safari'),
    ('macos-safari', 'windows-release'),
    ('windows-release', 'all-green'),
)
validation_counts: dict[str, int] = {}
for job, next_job in validation_jobs:
    _, _, segment = isolate_job(ci_text, job, next_job)
    validation_counts[job] = len(command_step_hits(segment, 'npm run validate'))

if any(count != 1 for count in validation_counts.values()):
    detail = ', '.join(f'{job}={count}' for job, count in validation_counts.items())
    fail('Derived inner CI must contain exactly one full validation step in each certification job; ' + detail)
if sum(validation_counts.values()) != 4:
    fail(f'Derived inner CI normalized validation count must be 4; got {sum(validation_counts.values())}')

ci_path.write_text(ci_text, encoding='utf-8', newline='')
changed.add('.github/workflows/ci.yml')

# Extend the source's own static and mutation gates so the repaired packaged CI
# cannot later lose its fresh-runner media prerequisite or platform validation.
audit_path = WORK / 'scripts' / 'audit-lib.mjs'
audit_text = read_utf8(audit_path)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
audit_guard = r'''    ,["CI provisions ffprobe and runs full validation in resolve-lock Linux macOS and Windows", () => (s(".github/workflows/ci.yml").match(/name: Provision media validation toolchain/g)||[]).length===3 && (s(".github/workflows/ci.yml").match(/name: Provision MP3 fixture toolchain/g)||[]).length===1 && (s(".github/workflows/ci.yml").match(/run: npm run validate/g)||[]).length===4 && /resolve-lock:[\s\S]*?run: npm run validate[\s\S]*?linux-full:/.test(s(".github/workflows/ci.yml")) && /linux-full:[\s\S]*?run: npm run validate[\s\S]*?macos-safari:/.test(s(".github/workflows/ci.yml")) && /macos-safari:[\s\S]*?run: npm run validate[\s\S]*?windows-release:/.test(s(".github/workflows/ci.yml")) && /windows-release:[\s\S]*?run: npm run validate[\s\S]*?all-green:/.test(s(".github/workflows/ci.yml")) && /sudo apt-get install -y --no-install-recommends ffmpeg/.test(s(".github/workflows/ci.yml")) && /brew install ffmpeg/.test(s(".github/workflows/ci.yml")) && /choco install ffmpeg -y --no-progress/.test(s(".github/workflows/ci.yml")) && /Get-Command ffprobe/.test(s(".github/workflows/ci.yml"))]
'''
if audit_text.count(audit_anchor) != 1:
    fail('Could not locate unique inner CI safeguard insertion anchor')
audit_path.write_text(audit_text.replace(audit_anchor, audit_guard + audit_anchor, 1), encoding='utf-8', newline='')
changed.add('scripts/audit-lib.mjs')

mutation_path = WORK / 'scripts' / 'mutation-suite.mjs'
mutation_text = read_utf8(mutation_path)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
mutation_guard = r'''  ["remove per-platform ffprobe provisioning from CI", ".github/workflows/ci.yml", /name: Provision media validation toolchain/g, "name: Removed media validation toolchain"],
  ["remove fixture ffprobe provisioning from CI", ".github/workflows/ci.yml", /name: Provision MP3 fixture toolchain/g, "name: Removed MP3 fixture toolchain"],
  ["remove Linux full validation from CI", ".github/workflows/ci.yml", /(?:      - run: npm run validate|        run: npm run validate)\n(?=[\s\S]{0,160}?run: npm run test:worker)/, ""],
  ["remove macOS full validation from CI", ".github/workflows/ci.yml", /(?:      - run: npm run validate|        run: npm run validate)\n(?=[\s\S]{0,220}?run: npm run browsers:install:webkit)/, ""],
  ["remove Windows full validation from CI", ".github/workflows/ci.yml", /(?:      - run: npm run validate|        run: npm run validate)\n(?=[\s\S]{0,220}?run: npm run browsers:install:branded)/, ""],
'''
if mutation_text.count(mutation_anchor) != 1:
    fail('Could not locate unique inner CI mutation insertion anchor')
mutation_path.write_text(mutation_text.replace(mutation_anchor, mutation_guard + mutation_anchor, 1), encoding='utf-8', newline='')
changed.add('scripts/mutation-suite.mjs')

# Every executable first-party Action reference in the packaged CI must now be
# a full immutable SHA and must include the four reviewed current Actions.
uses_refs = re.findall(r'^\s*-?\s*uses:\s*([^\s#]+)', ci_text, flags=re.M)
action_refs = [ref for ref in uses_refs if ref.startswith('actions/')]
if not action_refs:
    fail('Inner CI contains no first-party GitHub Action refs after materialization')
bad_refs = [ref for ref in action_refs if not re.fullmatch(r'actions/[A-Za-z0-9_.-]+@[0-9a-f]{40}', ref)]
if bad_refs:
    fail('Non-immutable inner CI action refs remain: ' + ', '.join(sorted(set(bad_refs))))
missing_expected = sorted(ref for ref in set(ACTION_MIGRATIONS.values()) if ref not in action_refs)
if missing_expected:
    fail('Expected current SHA-pinned action refs missing from inner CI: ' + ', '.join(missing_expected))

# No superseded tag spelling may survive in inspectable UTF-8 source/audit text.
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
    fail(
        f'Stale CI action identifier remains after materialization repair in '
        f'{path.relative_to(WORK)}: ' + ', '.join(stale)
    )

print(f'Materialized reviewed Cosmic Transcriber Web source in {WORK}')
print(f'CI source snapshot bytes: {len(raw)}')
print(f'CI source snapshot SHA-256: {actual_sha}')
print(f'Inner CI immutable action pin gate PASS ({len(action_refs)} refs).')
print('Inner CI fresh-runner ffmpeg/ffprobe provisioning gate PASS (fixture + Linux + macOS + Windows).')
print('Inner CI full validation coverage gate PASS (resolve-lock + Linux + macOS + Windows).')
for old, new in ACTION_MIGRATIONS.items():
    escaped_old = old.replace('/', r'\/').replace('.', r'\.')
    print(
        f'  migrated {old} -> {new}: {counts[old]} plain + '
        f'{escaped_counts[escaped_old]} escaped occurrence(s)'
    )
print(f'Deterministic certification repair touched {len(changed)} UTF-8 file(s):')
for rel in sorted(changed):
    print(f'  migrated: {rel}')
