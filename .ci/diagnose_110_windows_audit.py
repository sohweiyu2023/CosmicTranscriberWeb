from __future__ import annotations
import os, pathlib, re

ROOT=pathlib.Path(__file__).resolve().parents[1]
WORK=ROOT/'work'
if os.name!='nt':
    print('Windows-only audit diagnostic skipped on non-Windows host.',flush=True)
    raise SystemExit(0)

labels=[
    'first-deploy temporary secret is covered by cleanup even if file creation fails',
    'restored prompt respects textarea maxLength with surrogate-safe truncation',
]
audit=(WORK/'scripts'/'audit-lib.mjs').read_text(encoding='utf-8')
print('=== WINDOWS-ONLY AUDIT DIAGNOSTIC BEGIN ===',flush=True)
for label in labels:
    lines=[line for line in audit.splitlines() if f'["{label}"' in line]
    print(f'LABEL {label!r} line_count={len(lines)}',flush=True)
    for line in lines:
        print(line,flush=True)

first=(WORK/'FIRST-DEPLOY-WINDOWS.ps1').read_bytes()
app=(WORK/'public'/'js'/'app.js').read_bytes()
for name,data in [('FIRST-DEPLOY-WINDOWS.ps1',first),('public/js/app.js',app)]:
    print(f'{name}: bytes={len(data)} CRLF={data.count(bytes([13,10]))} LF={data.count(bytes([10]))}',flush=True)

first_text=first.decode('utf-8')
print('--- FIRST DEPLOY secret/cleanup context ---',flush=True)
for i,line in enumerate(first_text.splitlines()):
    if re.search(r'secret|temp|finally|Remove-Item|BYOK_SESSION_MASTER_KEY_CURRENT',line,re.I):
        lo=max(0,i-2); hi=min(len(first_text.splitlines()),i+3)
        print(f'[{lo+1}:{hi}]',flush=True)
        print('\n'.join(first_text.splitlines()[lo:hi]),flush=True)

app_text=app.decode('utf-8')
checkpoint_line=next((line for line in app_text.splitlines() if 'CTW_CHECKPOINT_REUSE_BINDING' in line),'')
marker='// CTW_RESTORED_PROMPT_BOUND'
print('--- PROMPT ordering context ---',flush=True)
print(f'checkpoint_line={checkpoint_line!r}',flush=True)
print(f'checkpoint_index={app_text.find(checkpoint_line)} marker_index={app_text.find(marker)} delta={app_text.find(marker)-app_text.find(checkpoint_line) if checkpoint_line else None}',flush=True)
if checkpoint_line:
    expected_lf=checkpoint_line+'\n'+marker
    expected_crlf=checkpoint_line+'\r\n'+marker
    print(f'adjacent_lf={expected_lf in app_text} adjacent_crlf={expected_crlf in app_text}',flush=True)
for needle in [
    marker,
    'const ctwPreferencesKey = "cosmic-transcriber-web-preferences-v1";',
    'ctwParsed.prompt = ctwPromptBounded;',
    'ctwParsed.keywords = ctwKeywordsBounded;',
    'last >= 0xD800 && last <= 0xDBFF',
]:
    print(f'APP includes {needle!r}: {needle in app_text}',flush=True)
print('=== WINDOWS-ONLY AUDIT DIAGNOSTIC END ===',flush=True)
raise SystemExit('Temporary Windows-only audit diagnostic stop')
