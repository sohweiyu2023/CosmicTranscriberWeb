from __future__ import annotations
import json, pathlib

ROOT=pathlib.Path(__file__).resolve().parents[1]
WORK=ROOT/'work'
PACKAGE=WORK/'package.json'
OLD='workerd@1.20260804.1'
NEW='workerd@1.20260811.1'

if not PACKAGE.is_file():
    raise SystemExit('1.0.15 workerd policy repair missing package.json')

pkg=json.loads(PACKAGE.read_text(encoding='utf-8'))
allow=pkg.get('allowScripts')
if not isinstance(allow,dict):
    raise SystemExit('1.0.15 workerd policy repair missing allowScripts map')
if allow.get(OLD) is not True:
    raise SystemExit(f'Expected exact prior reviewed lifecycle approval {OLD}=true before refresh')
if NEW in allow:
    raise SystemExit(f'Unexpected pre-existing approval for {NEW}')

del allow[OLD]
allow[NEW]=True
PACKAGE.write_text(json.dumps(pkg,indent=2)+'\n',encoding='utf-8',newline='')

notes=WORK/'docs/RESEARCH_NOTES.md'
text=notes.read_text(encoding='utf-8')
entry='''\n## workerd 1.20260811.1 lifecycle-script review (2026-08-12)\n\nThe fresh 1.0.15 registry resolution introduced `workerd@1.20260811.1`, so the release gate stopped before executing its lifecycle hook. The exact Cloudflare tag `v1.20260811.1` was independently reviewed before approval. Its wrapper package retains the `postinstall: node install.js` lifecycle. Cloudflare's release workflow generates `install.js` from `npm/lib/node-install.ts`; that routine selects the official platform-specific `@cloudflare/workerd-*` package, can fall back to installing/downloading the exact same Workerd version from the npm registry if the optional platform package is absent, optionally replaces the JavaScript shim with the binary on supported non-Windows installs, and validates the resulting binary version. Approval therefore remains exact-version and fail-closed: `workerd@1.20260811.1: true`; the superseded `workerd@1.20260804.1` decision is removed so stale approvals cannot survive graph refreshes.\n'''
if '## workerd 1.20260811.1 lifecycle-script review (2026-08-12)' not in text:
    notes.write_text(text.rstrip()+entry+'\n',encoding='utf-8',newline='')

print('Exact reviewed lifecycle approval updated: workerd@1.20260811.1.')
