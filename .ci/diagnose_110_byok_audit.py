from __future__ import annotations
import pathlib

ROOT=pathlib.Path(__file__).resolve().parents[1]
path=ROOT/'work'/'scripts'/'audit-lib.mjs'
label='worker tests inject test-only BYOK secret'
if not path.is_file():
    raise SystemExit(f'Missing {path}')
text=path.read_text(encoding='utf-8')
pos=text.find(label)
if pos<0:
    raise SystemExit('BYOK audit label not found')
start=max(0,pos-1200)
end=min(len(text),pos+1800)
print('=== TEMP DIAGNOSTIC: ORIGINAL BYOK AUDIT CONTEXT BEGIN ===',flush=True)
print(text[start:end],flush=True)
print('=== TEMP DIAGNOSTIC: ORIGINAL BYOK AUDIT CONTEXT END ===',flush=True)
raise SystemExit('Temporary diagnostic stop before CI compatibility transform')
