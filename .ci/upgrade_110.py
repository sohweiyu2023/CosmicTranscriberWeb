from __future__ import annotations
import base64, hashlib, json, lzma, pathlib, subprocess, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / 'work'
VERSION = '1.1.0'
CHUNK_PREFIX = 'upgrade_110_patch.b64.'
EXPECTED_CHUNKS = [f'{i:02d}' for i in range(11)]
EXPECTED_CHUNK_SIZES = {**{f'{i:02d}': 8000 for i in range(10)}, '10': 3244}
COMPRESSED_SIZE = 62432
COMPRESSED_SHA256 = '2de087f6993aaa77713a86e0b375099679557a29eef5a29399b12a0808638541'
PATCH_SIZE = 281874
PATCH_SHA256 = '0b94a3a977395fd116cb9558203450d75b18940f7b0cd7145613699d62bdeef1'

def fail(msg: str) -> None:
    raise SystemExit(msg)

if not WORK.is_dir():
    fail('1.1.0 upgrade requires materialized 1.0.15 work tree')

ci = ROOT / '.ci'
actual = sorted(p.name.removeprefix(CHUNK_PREFIX) for p in ci.glob(CHUNK_PREFIX + '*'))
if actual != EXPECTED_CHUNKS:
    fail(f'1.1.0 patch chunk set mismatch: expected {EXPECTED_CHUNKS}, got {actual}')

pieces: list[str] = []
for suffix in EXPECTED_CHUNKS:
    path = ci / f'{CHUNK_PREFIX}{suffix}'
    text = path.read_text(encoding='ascii')
    expected = EXPECTED_CHUNK_SIZES[suffix]
    if len(text) != expected:
        fail(f'1.1.0 patch chunk {suffix} size mismatch: expected {expected}, got {len(text)}')
    pieces.append(text)

encoded = ''.join(pieces)
try:
    compressed = base64.b64decode(encoded, validate=True)
except Exception as exc:
    fail(f'1.1.0 patch base64 decode failed: {exc}')
if len(compressed) != COMPRESSED_SIZE:
    fail(f'1.1.0 compressed patch size mismatch: expected {COMPRESSED_SIZE}, got {len(compressed)}')
sha = hashlib.sha256(compressed).hexdigest()
if sha != COMPRESSED_SHA256:
    fail(f'1.1.0 compressed patch SHA-256 mismatch: expected {COMPRESSED_SHA256}, got {sha}')

try:
    patch = lzma.decompress(compressed)
except Exception as exc:
    fail(f'1.1.0 patch decompression failed: {exc}')
if len(patch) != PATCH_SIZE:
    fail(f'1.1.0 patch size mismatch: expected {PATCH_SIZE}, got {len(patch)}')
patch_sha = hashlib.sha256(patch).hexdigest()
if patch_sha != PATCH_SHA256:
    fail(f'1.1.0 patch SHA-256 mismatch: expected {PATCH_SHA256}, got {patch_sha}')

with tempfile.NamedTemporaryFile(prefix='ctw-1.1.0-', suffix='.patch', dir=ROOT, delete=False) as tmp:
    tmp.write(patch)
    patch_path = pathlib.Path(tmp.name)
try:
    cmd = ['git', 'apply', '--directory=work', '-p1', '--whitespace=nowarn', '--exclude=*RELEASE_MANIFEST.json', str(patch_path)]
    subprocess.run(cmd[:2] + ['--check'] + cmd[2:], cwd=ROOT, check=True)
    subprocess.run(cmd, cwd=ROOT, check=True)
finally:
    patch_path.unlink(missing_ok=True)

# RELEASE_MANIFEST is certification-state metadata. The 1.0.15 CI baseline is
# deliberately releaseReady:false, while the reviewed V1.1 patch was derived
# from the immutable certified 1.0.15 artifact. Apply source changes without
# that one file, then write the reviewed V1.1 candidate manifest explicitly.
manifest_target = {
    'product': 'Cosmic Transcriber Web',
    'version': VERSION,
    'generatedAt': None,
    'releaseReady': False,
    'dependencyLock': {
        'status': 'candidate-unverified',
        'sha256': None,
        'registry': 'https://registry.npmjs.org',
    },
    'unicodeFixture': 'tests/fixtures/ID3 Unicode 東京.mp3',
    'archiveEncoding': 'UTF-8 filenames (general-purpose bit 11 set for every entry)',
    'wranglerReleaseFingerprint': None,
    'wranglerMutableAfterRelease': [
        'env.staging.vars.ACCESS_TEAM_DOMAIN',
        'env.staging.vars.ACCESS_AUDIENCE',
        'env.staging.vars.ADMIN_EMAILS',
        'env.staging.d1_databases.USER_DB.database_id',
        'env.production.vars.ACCESS_TEAM_DOMAIN',
        'env.production.vars.ACCESS_AUDIENCE',
        'env.production.vars.ADMIN_EMAILS',
        'env.production.d1_databases.USER_DB.database_id',
    ],
    'notes': [],
}
(WORK / 'RELEASE_MANIFEST.json').write_text(
    json.dumps(manifest_target, indent=2, ensure_ascii=True) + '\n', encoding='utf-8'
)

# A new release resolves/reviews a fresh registry-latest graph in certification.
lock = WORK / 'package-lock.json'
if lock.exists():
    lock.unlink()

pkg = json.loads((WORK / 'package.json').read_text(encoding='utf-8'))
manifest = json.loads((WORK / 'RELEASE_MANIFEST.json').read_text(encoding='utf-8'))
wrangler = (WORK / 'wrangler.jsonc').read_text(encoding='utf-8')
package_text = (WORK / 'package.json').read_text(encoding='utf-8')
first_deploy = (WORK / 'FIRST-DEPLOY-WINDOWS.ps1').read_text(encoding='utf-8')
checks = [
    (pkg.get('version') == VERSION, 'package version'),
    (manifest.get('version') == VERSION and manifest.get('releaseReady') is False, 'candidate manifest'),
    (manifest.get('dependencyLock', {}).get('status') == 'candidate-unverified', 'candidate dependency lock'),
    ((WORK / 'migrations/0001_user_registry.sql').is_file(), 'registry migration'),
    ((WORK / 'src/user-registry.js').is_file(), 'registry Worker module'),
    ((WORK / 'public/js/admin.js').is_file(), 'admin UI module'),
    ('REPLACE_WITH_STAGING_USER_DB_ID' in wrangler, 'staging D1 placeholder'),
    ('REPLACE_WITH_PRODUCTION_USER_DB_ID' in wrangler, 'production D1 placeholder'),
    ('apply-registry-migrations.mjs staging' in package_text, 'staging migration-before-deploy'),
    ('apply-registry-migrations.mjs production' in package_text, 'production migration-before-deploy'),
    ("$node.Text -ne 'v26.5.1'" in first_deploy, 'guided Node alignment'),
    (not lock.exists(), 'no inherited package lock'),
]
for ok, label in checks:
    if not ok:
        fail(f'1.1.0 promotion assertion failed: {label}')
print(
    f'Cosmic Transcriber Web {VERSION} candidate patch PASS '
    f'(chunks={len(EXPECTED_CHUNKS)}, compressed_sha256={sha}, patch_sha256={patch_sha}).'
)
