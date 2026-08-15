from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / 'work'
VERSION = '1.1.0'
AUDIT_LABEL = 'worker tests inject test-only BYOK secret'
TEST_BYOK_MASTER_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'


def fail(message: str) -> None:
    raise SystemExit(message)


def replace_top_level_audit_entry(text: str, label: str, replacement_body: str) -> str:
    pattern = re.compile(rf'(?m)^(?P<indent>[ \t]*)(?P<comma>,?)[ \t]*\["{re.escape(label)}"')
    hits = list(pattern.finditer(text))
    if len(hits) != 1:
        fail(f'Expected exactly one audit safeguard {label!r}; found {len(hits)}')
    hit = hits[0]
    indent = hit.group('indent')
    comma = hit.group('comma')
    nxt = re.search(rf'(?m)^{re.escape(indent)},?[ \t]*\["', text[hit.end():])
    end = hit.end() + nxt.start() if nxt else len(text)
    old_entry = text[hit.start():end]
    if 'vitest.config.js' not in old_entry or 'BYOK_SESSION_MASTER_KEY_CURRENT' not in old_entry:
        fail('Reviewed worker-test BYOK safeguard no longer inspects the expected Vitest binding')
    replacement = f'{indent}{comma}["{label}", {replacement_body}]\n'
    return text[:hit.start()] + replacement + text[end:]


def replace_mutation_for_safeguard(text: str, label: str) -> str:
    replacement = (
        '  ["remove Workers test BYOK binding -> worker tests inject test-only BYOK secret", '
        '"vitest.config.js", /BYOK_SESSION_MASTER_KEY_CURRENT:TEST_BYOK_MASTER_KEY/, '
        '"CTW_TEST_BYOK_BINDING_REMOVED:true"],\n'
    )

    # Older reviewed mutation labels are not guaranteed to repeat the safeguard
    # label verbatim. Identify the mutation by the security surface it mutates,
    # not by prose. Parse same-indentation array entries fail-closed, then replace
    # exactly one Vitest/BYOK candidate if present. If the reviewed candidate has
    # no dedicated mutation at all, add one at the stable mutation-list anchor.
    entry_start = re.compile(r'(?m)^(?P<indent>[ \t]*)(?P<comma>,?)[ \t]*\["')
    starts = list(entry_start.finditer(text))
    candidates: list[tuple[int, int, str]] = []
    semantic_markers = (
        'BYOK_SESSION_MASTER_KEY_CURRENT',
        'TEST_BYOK_MASTER_KEY',
        'defineWorkersConfig',
        'poolOptions',
        'miniflare',
    )
    for hit in starts:
        indent = hit.group('indent')
        nxt = re.search(rf'(?m)^{re.escape(indent)},?[ \t]*\["', text[hit.end():])
        end = hit.end() + nxt.start() if nxt else len(text)
        block = text[hit.start():end]
        if 'vitest.config.js' in block and (label in block or any(marker in block for marker in semantic_markers)):
            candidates.append((hit.start(), end, block))

    if len(candidates) > 1:
        detail = ' | '.join(re.sub(r'\s+', ' ', block)[:220] for _, _, block in candidates)
        fail(f'Expected at most one reviewed Vitest/BYOK mutation; found {len(candidates)}: {detail}')
    if len(candidates) == 1:
        start, end, old = candidates[0]
        if 'vitest.config.js' not in old:
            fail('Reviewed worker-test BYOK mutation candidate no longer targets vitest.config.js')
        return text[:start] + replacement + text[end:]

    anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
    if text.count(anchor) != 1:
        fail(
            'No existing Vitest/BYOK mutation was found and the stable mutation insertion '
            f'anchor count was {text.count(anchor)} instead of 1'
        )
    return text.replace(anchor, replacement + anchor, 1)


if not WORK.is_dir():
    fail('1.1.0 CI compatibility repair requires a materialized work tree')

# Cloudflare's current Workers Vitest integration exports cloudflareTest() from
# the package root. 1.1.0 resolves every direct dependency to registry latest,
# so the candidate must migrate forward instead of pinning an obsolete package
# solely to retain the removed /config subpath API.
vitest_path = WORK / 'vitest.config.js'
if not vitest_path.is_file():
    fail('Missing work/vitest.config.js')
old_vitest = vitest_path.read_text(encoding='utf-8')
for required in [
    'tests/worker/wrangler.test.jsonc',
    'BYOK_SESSION_MASTER_KEY_CURRENT',
    'tests/worker/**/*.test.js',
    '20000',
]:
    if required not in old_vitest:
        fail(f'1.1.0 Vitest migration precondition missing: {required}')

new_vitest = f"""import {{ cloudflareTest }} from '@cloudflare/vitest-pool-workers';
import {{ defineConfig }} from 'vitest/config';

// Synthetic TEST-ONLY 32-byte base64url master key injected only into the
// Workers-runtime test isolate. Production Wrangler still requires a real secret.
const TEST_BYOK_MASTER_KEY = '{TEST_BYOK_MASTER_KEY}';

export default defineConfig({{
  plugins:[cloudflareTest({{
    wrangler:{{configPath:'./tests/worker/wrangler.test.jsonc'}},
    miniflare:{{bindings:{{BYOK_SESSION_MASTER_KEY_CURRENT:TEST_BYOK_MASTER_KEY}}}}
  }})],
  test:{{include:['tests/worker/**/*.test.js'],testTimeout:20000}}
}});
"""
vitest_path.write_text(new_vitest, encoding='utf-8', newline='')

# The old static safeguard coupled the security property to the removed
# defineWorkersConfig()/poolOptions syntax. Migrate the gate to the current API
# while preserving the actual fail-closed property: a synthetic key exists only
# in the Workers test isolate, is wired through Miniflare bindings, and never
# appears in production Wrangler configuration.
audit_path = WORK / 'scripts' / 'audit-lib.mjs'
if not audit_path.is_file():
    fail('Missing work/scripts/audit-lib.mjs')
audit = audit_path.read_text(encoding='utf-8')
audit_body = (
    '() => { const v=s("vitest.config.js"); return '
    'v.includes("import { cloudflareTest } from \'@cloudflare/vitest-pool-workers\';")'
    ' && v.includes("const TEST_BYOK_MASTER_KEY = \'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\';")'
    ' && v.includes("plugins:[cloudflareTest({")'
    ' && v.includes("wrangler:{configPath:\'./tests/worker/wrangler.test.jsonc\'}")'
    ' && v.includes("miniflare:{bindings:{BYOK_SESSION_MASTER_KEY_CURRENT:TEST_BYOK_MASTER_KEY}}")'
    ' && !v.includes("@cloudflare/vitest-pool-workers/config")'
    ' && !s("wrangler.jsonc").includes("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"); }'
)
audit = replace_top_level_audit_entry(audit, AUDIT_LABEL, audit_body)
audit_path.write_text(audit, encoding='utf-8', newline='')

# Keep mutation coverage in lockstep with the migrated safeguard. The mutation
# removes the exact test-only Miniflare binding; validation must then report the
# same named safeguard as failed. This replaces, rather than deletes, an old
# Vitest/BYOK mutation when one exists; otherwise it adds a dedicated mutation.
mutation_path = WORK / 'scripts' / 'mutation-suite.mjs'
if not mutation_path.is_file():
    fail('Missing work/scripts/mutation-suite.mjs')
mutations = mutation_path.read_text(encoding='utf-8')
mutations = replace_mutation_for_safeguard(mutations, AUDIT_LABEL)
mutation_path.write_text(mutations, encoding='utf-8', newline='')

# Windows checkout/apply can produce CRLF in the patched README while the
# version-consistency gate intentionally checks an exact release heading. Keep
# the exact heading invariant, but normalize this generated candidate surface
# deterministically so the same source bytes are tested on every OS.
readme_path = WORK / 'README.md'
if not readme_path.is_file():
    fail('Missing work/README.md')
readme = readme_path.read_text(encoding='utf-8').replace('\r\n', '\n').replace('\r', '\n')
lines = readme.splitlines()
if not lines or not lines[0].startswith('# Cosmic Transcriber Web '):
    fail('README release-heading precondition changed')
lines[0] = f'# Cosmic Transcriber Web {VERSION}'
readme_path.write_text('\n'.join(lines).rstrip('\n') + '\n', encoding='utf-8', newline='')

# Fix stale diagnostic wording without changing the actual fail-closed engine
# requirement. The code has required Node 26.5.1 since 1.0.13.
version_path = WORK / 'scripts' / 'version-consistency.mjs'
if not version_path.is_file():
    fail('Missing work/scripts/version-consistency.mjs')
version_text = version_path.read_text(encoding='utf-8')
version_text = version_text.replace(
    'package.json Node engine does not preserve the reviewed Node 24.19 floor',
    'package.json Node engine does not preserve the reviewed Node 26.5.1 floor',
)
version_path.write_text(version_text, encoding='utf-8', newline='')

# Add an executable regression test so a future registry-latest refresh cannot
# silently restore the removed package subpath. This is intentionally a source
# contract test, not a version-number pin.
test_path = WORK / 'tests' / 'node' / 'vitest-config-current.test.mjs'
test_path.write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');

test('Workers Vitest config uses the current package-root cloudflareTest API',async()=>{
  const text=await readFile(path.join(root,'vitest.config.js'),'utf8');
  assert.match(text,/from ['\"]@cloudflare\\/vitest-pool-workers['\"]/);
  assert.doesNotMatch(text,/@cloudflare\\/vitest-pool-workers\\/config/);
  assert.match(text,/\\bcloudflareTest\\s*\\(/);
  assert.match(text,/from ['\"]vitest\\/config['\"]/);
  assert.match(text,/tests\\/worker\\/wrangler\\.test\\.jsonc/);
  assert.match(text,/BYOK_SESSION_MASTER_KEY_CURRENT/);
});
""", encoding='utf-8', newline='')

# Postconditions make the repair fail closed if any future candidate structure
# makes these assumptions invalid.
final_vitest = vitest_path.read_text(encoding='utf-8')
final_audit = audit_path.read_text(encoding='utf-8')
final_mutations = mutation_path.read_text(encoding='utf-8')
if '@cloudflare/vitest-pool-workers/config' in final_vitest:
    fail('Obsolete Workers Vitest /config import survived migration')
if "import { cloudflareTest } from '@cloudflare/vitest-pool-workers';" not in final_vitest:
    fail('Current Workers Vitest cloudflareTest import missing after migration')
if final_audit.count(f'"{AUDIT_LABEL}"') != 1:
    fail('Migrated worker-test BYOK safeguard is missing or duplicated')
if final_mutations.count('remove Workers test BYOK binding -> worker tests inject test-only BYOK secret') != 1:
    fail('Migrated worker-test BYOK mutation is missing or duplicated')
if not readme_path.read_bytes().startswith(f'# Cosmic Transcriber Web {VERSION}\n'.encode('utf-8')):
    fail('README release heading is not canonical LF after normalization')

print('Cosmic Transcriber Web 1.1.0 CI compatibility + BYOK safeguard repair PASS.')
