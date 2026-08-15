from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / 'work'
VERSION = '1.1.0'
TEST_BYOK_MASTER_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'


def fail(message: str) -> None:
    raise SystemExit(message)


def canonicalize_utf8_lf(path: pathlib.Path, label: str) -> str:
    if not path.is_file():
        fail(f'Missing {label}: {path}')
    try:
        text = path.read_text(encoding='utf-8')
    except UnicodeDecodeError as exc:
        fail(f'{label} is not valid UTF-8: {path}')
        raise exc
    normalized = text.replace('\r\n', '\n').replace('\r', '\n')
    path.write_bytes(normalized.encode('utf-8'))
    final = path.read_bytes()
    if b'\r' in final:
        fail(f'{label} canonical-LF normalization failed: carriage return survived')
    return final.decode('utf-8')


if not WORK.is_dir():
    fail('1.1.0 CI compatibility repair requires a materialized work tree')

# Cloudflare's current Workers Vitest integration uses cloudflareTest() from the
# package root. Preserve all reviewed V1.1 test-state plumbing while migrating
# the removed configuration API: the synthetic BYOK key, D1 migration array,
# and the existing setupFiles hook that actually applies those migrations.
vitest_path = WORK / 'vitest.config.js'
if not vitest_path.is_file():
    fail('Missing work/vitest.config.js')
old_vitest = vitest_path.read_text(encoding='utf-8')
for required in [
    'tests/worker/wrangler.test.jsonc',
    'BYOK_SESSION_MASTER_KEY_CURRENT',
    'TEST_MIGRATIONS',
    'readD1Migrations',
    'setupFiles',
    'tests/worker/**/*.test.js',
    '20000',
]:
    if required not in old_vitest:
        fail(f'1.1.0 Vitest migration precondition missing: {required}')

# Preserve the reviewed setupFiles value exactly. This is standard Vitest
# configuration and Cloudflare runs setupFiles inside the Workers runtime, where
# cloudflare:test can apply TEST_MIGRATIONS to USER_DB. Refuse ambiguous config.
setup_matches = list(re.finditer(
    r'setupFiles\s*:\s*(?P<value>\[[^\]]*\]|["\'][^"\']+["\'])',
    old_vitest,
    flags=re.S,
))
if len(setup_matches) != 1:
    fail(f'Expected exactly one reviewed Vitest setupFiles value; found {len(setup_matches)}')
setup_files_value = setup_matches[0].group('value').strip()
if not re.search(r'worker|setup|migration', setup_files_value, flags=re.I):
    fail(f'Reviewed setupFiles value is not recognizably Worker/migration setup: {setup_files_value}')

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
  test:{{
    include:['tests/worker/**/*.test.js'],
    setupFiles:{setup_files_value},
    testTimeout:20000
  }}
}});
"""
vitest_path.write_bytes(new_vitest.encode('utf-8'))

# The setup file itself must still contain an explicit D1 migration application.
# We discover the reviewed setup path from setupFiles rather than inventing one.
setup_paths = re.findall(r'["\']([^"\']+)["\']', setup_files_value)
if len(setup_paths) != 1:
    fail(f'Expected one reviewed Worker setup file; found {setup_paths}')
setup_rel = setup_paths[0]
setup_path = (WORK / setup_rel).resolve()
work_root = WORK.resolve()
if work_root not in setup_path.parents:
    fail(f'Vitest setup file escapes work tree: {setup_rel}')
if not setup_path.is_file():
    fail(f'Reviewed Vitest setup file is missing: {setup_rel}')
setup_text = setup_path.read_text(encoding='utf-8')
for invariant in ('applyD1Migrations', 'USER_DB', 'TEST_MIGRATIONS'):
    if invariant not in setup_text:
        fail(f'Reviewed D1 setup file no longer contains {invariant}: {setup_rel}')

# Hosted Windows certification proved two otherwise-valid safeguards were
# platform-fragile because their reviewed byte-level contracts intentionally use
# literal LF adjacency. Windows candidate materialization contained CRLF in the
# two source files those safeguards inspect, while Linux/macOS contained LF.
# Canonicalize ONLY those audited generated sources to UTF-8 LF. We leave the
# safeguards unchanged and then re-prove their exact semantic shapes below.
app_path = WORK / 'public' / 'js' / 'app.js'
first_deploy_path = WORK / 'scripts' / 'first-deploy.mjs'
app_text = canonicalize_utf8_lf(app_path, 'browser application source')
first_deploy_text = canonicalize_utf8_lf(first_deploy_path, 'first-deploy source')

checkpoint_import = 'import {checkpointResultReusable} from "./retry-policy.js"; // CTW_CHECKPOINT_REUSE_BINDING'
prompt_marker = '// CTW_RESTORED_PROMPT_BOUND'
if checkpoint_import + '\n' + prompt_marker not in app_text:
    fail('Canonical-LF browser source no longer preserves exact checkpoint/prompt repair adjacency')
for invariant in (
    'const ctwPreferencesKey = "cosmic-transcriber-web-preferences-v1";',
    'ctwParsed.prompt = ctwPromptBounded;',
    'ctwParsed.keywords = ctwKeywordsBounded;',
    'last >= 0xD800 && last <= 0xDBFF',
):
    if invariant not in app_text:
        fail(f'Canonical-LF browser source lost restored-prompt invariant: {invariant}')
if not re.search(r'try \{\n  await writeFile\(secretsFile', first_deploy_text):
    fail('Canonical-LF first-deploy source lost try/writeFile temporary-secret structure')
if not re.search(r'finally \{\n  await rm\(tempDir', first_deploy_text):
    fail('Canonical-LF first-deploy source lost finally/rm temporary-secret cleanup structure')

# Windows checkout/apply can also produce CRLF in the patched README while the
# version-consistency gate intentionally checks an exact release heading. Keep
# the exact heading invariant and normalize this generated candidate surface too.
readme_path = WORK / 'README.md'
if not readme_path.is_file():
    fail('Missing work/README.md')
readme = readme_path.read_text(encoding='utf-8').replace('\r\n', '\n').replace('\r', '\n')
lines = readme.splitlines()
if not lines or not lines[0].startswith('# Cosmic Transcriber Web '):
    fail('README release-heading precondition changed')
lines[0] = f'# Cosmic Transcriber Web {VERSION}'
readme_path.write_bytes(('\n'.join(lines).rstrip('\n') + '\n').encode('utf-8'))

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
version_path.write_bytes(version_text.replace('\r\n', '\n').replace('\r', '\n').encode('utf-8'))

# Add executable regressions so a future registry-latest/configuration refresh
# cannot silently restore the removed Workers API, drop D1 migration setup, or
# reintroduce platform-dependent source bytes into these exact audit surfaces.
test_path = WORK / 'tests' / 'node' / 'vitest-config-current.test.mjs'
test_path.write_bytes(f"""import test from 'node:test';
import assert from 'node:assert/strict';
import {{readFile}} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');

test('Workers Vitest config uses current package-root API and preserves D1 test setup',async()=>{{
  const text=await readFile(path.join(root,'vitest.config.js'),'utf8');
  assert.match(text,/from ['\"]@cloudflare\\/vitest-pool-workers['\"]/);
  assert.doesNotMatch(text,/@cloudflare\\/vitest-pool-workers\\/config/);
  assert.match(text,/\\bcloudflareTest\\s*\\(/);
  assert.match(text,/\\breadD1Migrations\\b/);
  assert.match(text,/from ['\"]vitest\\/config['\"]/);
  assert.match(text,/tests\\/worker\\/wrangler\\.test\\.jsonc/);
  assert.match(text,/BYOK_SESSION_MASTER_KEY_CURRENT:TEST_BYOK_MASTER_KEY/);
  assert.match(text,/TEST_MIGRATIONS:await readD1Migrations/);
  assert.match(text,/setupFiles\\s*:/);
  const setup=await readFile(path.resolve(root,{setup_rel!r}),'utf8');
  assert.match(setup,/applyD1Migrations/);
  assert.match(setup,/USER_DB/);
  assert.match(setup,/TEST_MIGRATIONS/);
}});

test('byte-sensitive audited generated sources are canonical UTF-8 LF on every platform',async()=>{{
  for(const rel of ['public/js/app.js','scripts/first-deploy.mjs']){{
    const bytes=await readFile(path.join(root,rel));
    assert.equal(bytes.includes(13),false,`${{rel}} contains a carriage return`);
  }}
  const app=await readFile(path.join(root,'public/js/app.js'),'utf8');
  assert.ok(app.includes({(checkpoint_import + chr(10) + prompt_marker)!r}));
  const first=await readFile(path.join(root,'scripts/first-deploy.mjs'),'utf8');
  assert.ok(first.includes('try {{\\n  await writeFile(secretsFile'));
  assert.ok(first.includes('finally {{\\n  await rm(tempDir'));
}});
""".encode('utf-8'))

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
    f'setupFiles:{setup_files_value}',
):
    if final_vitest.count(invariant) != 1:
        fail(f'Required current Workers test invariant missing or duplicated: {invariant}')
if TEST_BYOK_MASTER_KEY in (WORK / 'wrangler.jsonc').read_text(encoding='utf-8'):
    fail('Synthetic Workers test BYOK key leaked into production Wrangler config')
for path, label in ((app_path, 'browser source'), (first_deploy_path, 'first-deploy source')):
    if b'\r' in path.read_bytes():
        fail(f'{label} is not canonical LF after repair')
if not readme_path.read_bytes().startswith(f'# Cosmic Transcriber Web {VERSION}\n'.encode('utf-8')):
    fail('README release heading is not canonical LF after normalization')

print(
    'Cosmic Transcriber Web 1.1.0 compatibility repair PASS: current Workers Vitest/D1 setup '
    'preserved; byte-sensitive browser and first-deploy audit sources canonicalized to UTF-8 LF.'
)
