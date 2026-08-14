from __future__ import annotations
import hashlib, json, pathlib, shutil, tarfile

ROOT=pathlib.Path(__file__).resolve().parents[1]
WORK=ROOT/'work'
OVERLAY=ROOT/'.ci'/'upgrade_110_overlay.tar.xz'
EXPECTED_SIZE=112816
EXPECTED_SHA256='7cd1229222e59d166bcddfc048cff3b687fc012c8a80c8e74bfc841f59b38582'
VERSION='1.1.0'

def fail(msg): raise SystemExit(msg)
if not WORK.is_dir(): fail('1.1.0 upgrade requires materialized 1.0.15 work tree')
if not OVERLAY.is_file(): fail('missing reviewed 1.1.0 overlay')
raw=OVERLAY.read_bytes()
if len(raw)!=EXPECTED_SIZE: fail(f'1.1.0 overlay size mismatch: expected {EXPECTED_SIZE}, got {len(raw)}')
sha=hashlib.sha256(raw).hexdigest()
if sha!=EXPECTED_SHA256: fail(f'1.1.0 overlay SHA-256 mismatch: expected {EXPECTED_SHA256}, got {sha}')

work=WORK.resolve()
with tarfile.open(OVERLAY,'r:xz') as tf:
    members=tf.getmembers()
    if not members: fail('1.1.0 overlay is empty')
    for member in members:
        name=member.name.replace('\\','/')
        rel=pathlib.PurePosixPath(name)
        if not name or rel.is_absolute() or '..' in rel.parts: fail(f'unsafe 1.1.0 overlay path: {member.name}')
        if not member.isfile(): fail(f'unsupported 1.1.0 overlay entry: {member.name}')
        dest=WORK.joinpath(*rel.parts)
        resolved=dest.resolve()
        if work not in resolved.parents: fail(f'1.1.0 overlay escapes work tree: {member.name}')
        dest.parent.mkdir(parents=True,exist_ok=True)
        src=tf.extractfile(member)
        if src is None: fail(f'could not read 1.1.0 overlay entry: {member.name}')
        with src,dest.open('wb') as out: shutil.copyfileobj(src,out)

# A new release must resolve/review a fresh registry-latest graph in certification.
lock=WORK/'package-lock.json'
if lock.exists(): lock.unlink()

pkg=json.loads((WORK/'package.json').read_text(encoding='utf-8'))
manifest=json.loads((WORK/'RELEASE_MANIFEST.json').read_text(encoding='utf-8'))
checks=[
    (pkg.get('version')==VERSION,'package version'),
    (manifest.get('version')==VERSION and manifest.get('releaseReady') is False,'candidate manifest'),
    (manifest.get('dependencyLock',{}).get('status')=='candidate-unverified','candidate dependency lock'),
    ((WORK/'migrations/0001_user_registry.sql').is_file(),'registry migration'),
    ((WORK/'src/user-registry.js').is_file(),'registry Worker module'),
    ((WORK/'public/js/admin.js').is_file(),'admin UI module'),
    ('REPLACE_WITH_STAGING_USER_DB_ID' in (WORK/'wrangler.jsonc').read_text(encoding='utf-8'),'staging D1 placeholder'),
    ('REPLACE_WITH_PRODUCTION_USER_DB_ID' in (WORK/'wrangler.jsonc').read_text(encoding='utf-8'),'production D1 placeholder'),
    ('apply-registry-migrations.mjs staging' in (WORK/'package.json').read_text(encoding='utf-8'),'staging migration-before-deploy'),
    ('apply-registry-migrations.mjs production' in (WORK/'package.json').read_text(encoding='utf-8'),'production migration-before-deploy'),
    ("$node.Text -ne 'v26.5.1'" in (WORK/'FIRST-DEPLOY-WINDOWS.ps1').read_text(encoding='utf-8'),'guided Node alignment'),
    (not lock.exists(),'no inherited package lock'),
]
for ok,label in checks:
    if not ok: fail(f'1.1.0 promotion assertion failed: {label}')
print(f'Cosmic Transcriber Web {VERSION} candidate overlay PASS ({len(members)} files, sha256={sha}).')
