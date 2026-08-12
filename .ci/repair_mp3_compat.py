from __future__ import annotations
import base64, pathlib, subprocess, tempfile, zlib

ROOT=pathlib.Path(__file__).resolve().parents[1]
WORK=ROOT/'work'
PARTS=[ROOT/'.ci'/f'mp3_compat_114.b64.{i}' for i in range(5)]

def fail(msg:str)->None:
    raise SystemExit(f'1.0.14 MP3 compatibility repair failed: {msg}')

def read(rel:str)->str:
    p=WORK/rel
    if not p.is_file(): fail(f'missing {rel}')
    return p.read_text(encoding='utf-8')

# Fail closed: this patch is reviewed specifically against the certified 1.0.13 lineage.
old_mp3=read('public/js/mp3.js')
old_tests=read('tests/node/mp3.test.mjs')
old_audit=read('scripts/audit-lib.mjs')
old_mut=read('scripts/mutation-suite.mjs')
required_before={
    'strict chunker revision':'web-mp3-frame-preroll-vbrmeta-id3v1-1.2' in old_mp3,
    'strict invalid-header failure':'Invalid MP3 frame header at byte' in old_mp3,
    'strict truncated-frame failure':'The MP3 ends with a truncated audio frame.' in old_mp3,
    'old trailing-byte regression':'standard trailing ID3v1 is accepted but arbitrary trailing bytes fail closed' in old_tests,
    'old audit invariant':'MP3 accepts only standard trailing ID3v1 metadata' in old_audit,
    'old mutation invariant':'reject valid trailing ID3v1 metadata' in old_mut,
}
bad=[k for k,v in required_before.items() if not v]
if bad: fail('certified 1.0.13 baseline drifted: '+', '.join(bad))
for part in PARTS:
    if not part.is_file(): fail(f'missing reviewed repair payload {part}')
try:
    patch_data=zlib.decompress(base64.b64decode(''.join(p.read_text(encoding='ascii').strip() for p in PARTS),validate=True))
except Exception as exc:
    fail(f'cannot decode reviewed repair payload: {exc}')
with tempfile.NamedTemporaryFile(prefix='ctw-mp3-compat-',suffix='.patch',delete=False) as fh:
    fh.write(patch_data)
    patch_path=pathlib.Path(fh.name)
try:
    cmd=['git','apply','--whitespace=nowarn','--directory=work',str(patch_path)]
    check=cmd.copy(); check.insert(2,'--check')
    subprocess.run(check,cwd=ROOT,check=True)
    subprocess.run(cmd,cwd=ROOT,check=True)
finally:
    patch_path.unlink(missing_ok=True)

new_mp3=read('public/js/mp3.js')
new_tests=read('tests/node/mp3.test.mjs')
new_audit=read('scripts/audit-lib.mjs')
new_mut=read('scripts/mutation-suite.mjs')
required_after={
    'tolerant chunker revision':'web-mp3-tolerant-resync-vbrmeta-1.3' in new_mp3,
    'trailing junk recovery':'recoveries.trailingBytes+=' in new_mp3,
    'midstream resynchronization':'allowSingle:false' in new_mp3 and 'findNextFrame' in new_mp3,
    'terminal partial retention':'terminalPartialBytes' in new_mp3,
    'no old invalid-header whole-file rejection':'Invalid MP3 frame header at byte' not in new_mp3,
    'realistic trailer regression':'arbitrary decoder-tolerable trailing bytes do not reject' in new_tests,
    'terminal partial regression':'terminally truncated MP3 is recovered and remains decoder-readable' in new_tests,
    'embedded junk regression':'leading junk and recoverable mid-stream junk are skipped instead of rejecting the whole recording' in new_tests,
    'new audit invariant':'MP3 recovers decoder-tolerable junk and terminal partial frames' in new_audit,
    'new trailing mutation':'reintroduce fail-closed trailing junk rejection' in new_mut,
    'new resync mutation':'remove recoverable MP3 resynchronization' in new_mut,
    'new terminal mutation':'reject terminal partial MP3 frame' in new_mut,
}
bad=[k for k,v in required_after.items() if not v]
if bad: fail('post-patch invariant failure(s): '+', '.join(bad))
print('Cosmic Transcriber Web tolerant MP3 compatibility repair PASS.')
