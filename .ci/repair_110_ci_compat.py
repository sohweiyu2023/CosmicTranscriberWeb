from __future__ import annotations

import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / 'work'
VERSION = '1.1.0'
TEST_BYOK_MASTER_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'


def fail(message: str) -> None:
    raise SystemExit(message)


if not WORK.is_dir():
    fail('1.1.0 CI compatibility repair requires a materialized work tree')

# Cloudflare's current Workers Vitest integration uses cloudflareTest() from the
# package root. Preserve BOTH reviewed test-only bindings from the pre-migration
# config: the synthetic BYOK key and the D1 migration array. The existing static
# safeguard and mutation suite already verify those security/test properties, so
# do not rewrite those gates merely to fit a new configuration shape.
vitest_path = WORK / 'vitest.config.js'
if not vitest_path.is_file():
    fail('Missing work/vitest.config.js')
old_vitest = vitest_path.read_text(encoding='utf-8')
for required in [
    'tests/worker/wrangler.test.jsonc',
    'BYOK_SESSION_MASTER_KEY_CURRENT',
    'TEST_MIGRATIONS',
    'readD1Migrations',
    'tests/worker/**/*.test.js',
    '20000',
]:
    if required not in old_vitest:
        fail(f'1.1.0 Vitest migration precondition missing: {required}')

new_vitest = f"""import {{ cloudflareTest, readD1Migrations }} from '@cloudflare/vitest-pool-workers';
import {{ defineConfig }} from 'vitest/config';

// Synthetic TEST-ONLY 32-byte base64url master key injected only into the
// Workers-runtime test isolate. Production Wrangler still requires a real secret.
const TEST_BYOK_MASTER_KEY = '{TEST_BYOK_MASTER_KEY}';

export default defineConfig({{
  plugins:[cloudflareTest(async()=>({{
    wrangler:{{configPath:'./tests/worker/wrangler.test.jsonc'}},
    miniflare:{{bindings:{{
      BYOK_SESSION_MASTER_KEY_CURRENT:TEST_BYOK_MASTER_KEY,
      TEST_MIGRATIONS:await readD1Migrations('./migrations')
    }}}}
  }}))],
  test:{{include:['tests/worker/**/*.test.js'],testTimeout:20000}}
}});
"""
vitest_path.write_text(new_vitest, encoding='utf-8', newline='')

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
# silently restore the removed package subpath or drop D1 migration injection.
test_path = WORK / 'tests' / 'node' / 'vitest-config-current.test.mjs'
test_path.write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');

test('Workers Vitest config uses current package-root API and preserves test bindings',async()=>{
  const text=await readFile(path.join(root,'vitest.config.js'),'utf8');
  assert.match(text,/from ['\"]@cloudflare\\/vitest-pool-workers['\"]/);
  assert.doesNotMatch(text,/@cloudflare\\/vitest-pool-workers\\/config/);
  assert.match(text,/\\bcloudflareTest\\s*\\(/);
  assert.match(text,/\\breadD1Migrations\\b/);
  assert.match(text,/from ['\"]vitest\\/config['\"]/);
  assert.match(text,/tests\\/worker\\/wrangler\\.test\\.jsonc/);
  assert.match(text,/BYOK_SESSION_MASTER_KEY_CURRENT:TEST_BYOK_MASTER_KEY/);
  assert.match(text,/TEST_MIGRATIONS:await readD1Migrations/);
});
""", encoding='utf-8', newline='')

# Postconditions make the repair fail closed if any future candidate structure
# makes these assumptions invalid.
final_vitest = vitest_path.read_text(encoding='utf-8')
if '@cloudflare/vitest-pool-workers/config' in final_vitest:
    fail('Obsolete Workers Vitest /config import survived migration')
if "import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';" not in final_vitest:
    fail('Current Workers Vitest package-root imports missing after migration')
for invariant in (
    'BYOK_SESSION_MASTER_KEY_CURRENT:TEST_BYOK_MASTER_KEY,',
    "TEST_MIGRATIONS:await readD1Migrations('./migrations')",
):
    if final_vitest.count(invariant) != 1:
        fail(f'Required current Workers test binding missing or duplicated: {invariant}')
if TEST_BYOK_MASTER_KEY in (WORK / 'wrangler.jsonc').read_text(encoding='utf-8'):
    fail('Synthetic Workers test BYOK key leaked into production Wrangler config')
if not readme_path.read_bytes().startswith(f'# Cosmic Transcriber Web {VERSION}\n'.encode('utf-8')):
    fail('README release heading is not canonical LF after normalization')

print('Cosmic Transcriber Web 1.1.0 current Workers Vitest + preserved BYOK/D1 binding repair PASS.')
