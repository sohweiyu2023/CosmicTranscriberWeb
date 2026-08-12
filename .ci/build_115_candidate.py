from __future__ import annotations
import pathlib, subprocess, sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
steps=[
    'materialize.py',
    'repair_integration.py',
    'repair_e2e.py',
    'repair_install_policy.py',
    'repair_windows_package_certification_v2.py',
    'upgrade_113.py',
    'repair_mp3_compat.py',
    'upgrade_114.py',
    'upgrade_115.py',
    'repair_115_workerd_policy.py',
]
for name in steps:
    path=ROOT/'.ci'/name
    if not path.is_file(): raise SystemExit(f'1.0.15 candidate build missing {path}')
    print(f'=== {name} ===',flush=True)
    subprocess.run([sys.executable,str(path)],cwd=ROOT,check=True)
print('Cosmic Transcriber Web 1.0.15 candidate materialization PASS.',flush=True)
