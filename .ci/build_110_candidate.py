from __future__ import annotations
import pathlib, subprocess, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
for name in ['build_115_candidate.py','upgrade_110.py']:
    path=ROOT/'.ci'/name
    if not path.is_file(): raise SystemExit(f'1.1.0 candidate build missing {path}')
    print(f'=== {name} ===',flush=True)
    subprocess.run([sys.executable,str(path)],cwd=ROOT,check=True)
print('Cosmic Transcriber Web 1.1.0 candidate materialization PASS.',flush=True)
