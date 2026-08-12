from __future__ import annotations
import json, pathlib

ROOT=pathlib.Path(__file__).resolve().parents[1]
WORK=ROOT/'work'
PACKAGE=WORK/'package.json'
OLD='workerd@1.20260804.1'
OLDER='workerd@1.20260801.1'
NEW='workerd@1.20260811.1'


def replace_once(path:pathlib.Path, old:str, new:str)->None:
    text=path.read_text(encoding='utf-8')
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'Expected exactly one policy surface in {path.relative_to(WORK)}; found {count}')
    path.write_text(text.replace(old,new),encoding='utf-8',newline='')

if not PACKAGE.is_file():
    raise SystemExit('1.0.15 workerd policy repair missing package.json')

pkg=json.loads(PACKAGE.read_text(encoding='utf-8'))
allow=pkg.get('allowScripts')
if not isinstance(allow,dict):
    raise SystemExit('1.0.15 workerd policy repair missing allowScripts map')
if allow.get(OLDER) is not True:
    raise SystemExit(f'Expected retained exact reviewed lifecycle approval {OLDER}=true')
if allow.get(OLD) is not True:
    raise SystemExit(f'Expected exact prior reviewed lifecycle approval {OLD}=true before refresh')
if NEW in allow:
    raise SystemExit(f'Unexpected pre-existing approval for {NEW}')

del allow[OLD]
allow[NEW]=True
PACKAGE.write_text(json.dumps(pkg,indent=2)+'\n',encoding='utf-8',newline='')

audit=WORK/'scripts/audit-lib.mjs'
replace_once(
    audit,
    '["reviewed workerd lifecycle approvals are exact-version pinned to 1.20260801.1 and 1.20260804.1", () => s("package.json").includes("\\"workerd@1.20260801.1\\": true") && s("package.json").includes("\\"workerd@1.20260804.1\\": true") && !s("package.json").includes("\\"workerd\\": true")]',
    '["reviewed workerd lifecycle approvals are exact-version pinned to 1.20260801.1 and 1.20260811.1", () => s("package.json").includes("\\"workerd@1.20260801.1\\": true") && s("package.json").includes("\\"workerd@1.20260811.1\\": true") && !s("package.json").includes("\\"workerd@1.20260804.1\\"") && !s("package.json").includes("\\"workerd\\": true")]'
)

mutation=WORK/'scripts/mutation-suite.mjs'
replace_once(
    mutation,
    '["drop older reviewed workerd install-script approval -> reviewed workerd lifecycle approvals are exact-version pinned to 1.20260801.1 and 1.20260804.1", "package.json", /"workerd@1\\.20260801\\.1": true/, "\\"workerd@1.20260801.1\\": false"],',
    '["drop retained reviewed workerd install-script approval -> reviewed workerd lifecycle approvals are exact-version pinned to 1.20260801.1 and 1.20260811.1", "package.json", /"workerd@1\\.20260801\\.1": true/, "\\"workerd@1.20260801.1\\": false"],'
)
replace_once(
    mutation,
    '["drop newer reviewed workerd install-script approval -> reviewed workerd lifecycle approvals are exact-version pinned to 1.20260801.1 and 1.20260804.1", "package.json", /"workerd@1\\.20260804\\.1": true/, "\\"workerd@1.20260804.1\\": false"],',
    '["drop newest reviewed workerd install-script approval -> reviewed workerd lifecycle approvals are exact-version pinned to 1.20260801.1 and 1.20260811.1", "package.json", /"workerd@1\\.20260811\\.1": true/, "\\"workerd@1.20260811.1\\": false"],'
)

notes=WORK/'docs/RESEARCH_NOTES.md'
text=notes.read_text(encoding='utf-8')
entry='''\n## workerd 1.20260811.1 lifecycle-script review (2026-08-12)\n\nThe fresh 1.0.15 registry resolution introduced `workerd@1.20260811.1`, so the release gate stopped before executing its lifecycle hook. The exact Cloudflare tag `v1.20260811.1` was independently reviewed before approval. Its wrapper package retains the `postinstall: node install.js` lifecycle. Cloudflare's release workflow generates `install.js` from `npm/lib/node-install.ts`; that routine selects the official platform-specific `@cloudflare/workerd-*` package, can fall back to installing/downloading the exact same Workerd version from the npm registry if the optional platform package is absent, optionally replaces the JavaScript shim with the binary on supported non-Windows installs, and validates the resulting binary version. Approval therefore remains exact-version and fail-closed: `workerd@1.20260811.1: true`; the superseded `workerd@1.20260804.1` decision and its version-specific audit/mutation expectations are replaced rather than wildcarded. The separately required `workerd@1.20260801.1` approval remains exact because that version is still present elsewhere in the resolved graph.\n'''
if '## workerd 1.20260811.1 lifecycle-script review (2026-08-12)' not in text:
    notes.write_text(text.rstrip()+entry+'\n',encoding='utf-8',newline='')

print('Exact reviewed lifecycle approvals updated: retained workerd@1.20260801.1; replaced 1.20260804.1 with workerd@1.20260811.1; audit/mutation gates updated.')
