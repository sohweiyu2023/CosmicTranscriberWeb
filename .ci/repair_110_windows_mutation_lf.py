from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / 'work'
SUITE = WORK / 'scripts' / 'mutation-suite.mjs'


def fail(message: str) -> None:
    raise SystemExit(message)


if not WORK.is_dir() or not SUITE.is_file():
    fail('1.1.0 Windows mutation-LF repair requires a materialized work tree and mutation suite')

suite_text = SUITE.read_text(encoding='utf-8')
# Mutation entries are arrays whose first two fields are the mutation label and
# repository-relative target path. Discover targets from the reviewed suite so
# this repair follows the suite as it evolves instead of maintaining a weaker
# hand-written allowlist.
entry = re.compile(r'''\[\s*["'][^"'\r\n]+["']\s*,\s*["'](?P<path>[^"'\r\n]+)["']\s*,''')
targets = sorted({m.group('path') for m in entry.finditer(suite_text)})
if len(targets) < 20:
    fail(f'Mutation target discovery unexpectedly found only {len(targets)} target(s)')

# The previous hosted Windows run proved that mutation application can be
# platform-fragile when reviewed regexes contain literal LF while checkout/apply
# materializes CRLF. Canonicalize exactly the files the mutation suite intends to
# edit. This does not weaken a mutation, analyzer, or production invariant; it
# makes the same deliberate edits run against identical source bytes on every OS.
work_root = WORK.resolve()
changed: list[str] = []
for rel in targets:
    path = (WORK / rel).resolve()
    if path != work_root and work_root not in path.parents:
        fail(f'Mutation target escapes work tree: {rel}')
    if not path.is_file():
        fail(f'Mutation target is missing: {rel}')
    raw = path.read_bytes()
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError as exc:
        fail(f'Mutation target is not UTF-8 text: {rel}')
        raise exc
    normalized = text.replace('\r\n', '\n').replace('\r', '\n').encode('utf-8')
    if normalized != raw:
        path.write_bytes(normalized)
        changed.append(rel)
    if b'\r' in path.read_bytes():
        fail(f'Carriage return survived mutation-target canonicalization: {rel}')

# Fail closed on the concrete targets whose mutations failed to apply in the
# hosted Windows run, while still deriving the complete set from the suite.
for required in (
    '.github/workflows/ci.yml',
    'tests/e2e/mock-server.mjs',
    'src/index.js',
    'wrangler.jsonc',
):
    if required not in targets:
        fail(f'Expected reviewed Windows mutation target was not discovered: {required}')

print(
    'Cosmic Transcriber Web 1.1.0 Windows mutation target LF repair PASS '
    f'(targets={len(targets)}, normalized={len(changed)}).'
)
