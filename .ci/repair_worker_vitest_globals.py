from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / 'work'
TEST = WORK / 'tests' / 'worker' / 'runtime.test.js'
CONFIG = WORK / 'vitest.config.js'
AUDIT = WORK / 'scripts' / 'audit-lib.mjs'
MUTATIONS = WORK / 'scripts' / 'mutation-suite.mjs'

LABEL = 'Worker runtime tests use runner-provided Vitest globals and never import a second Vitest runtime'
IMPORT = "import {describe,it,expect} from 'vitest';\n"
CONFIG_OLD = "  test:{include:['tests/worker/**/*.test.js'],testTimeout:20000}\n"
CONFIG_NEW = "  test:{globals:true,include:['tests/worker/**/*.test.js'],testTimeout:20000}\n"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f'Worker Vitest globals repair required file missing: {path}')
    return path.read_text(encoding='utf-8')


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding='utf-8', newline='')


def js_regex_exact(text: str) -> str:
    if '\n' in text or '\r' in text:
        fail('js_regex_exact only supports one-line targets')
    return '/' + re.sub(r'([\\^$.*+?()\[\]{}|/])', r'\\\1', text) + '/'


test = read(TEST)
if test.count(IMPORT) != 1:
    fail(f'Expected exactly one explicit Vitest API import in Worker runtime test; found {test.count(IMPORT)}')
test = test.replace(IMPORT, '', 1)
write(TEST, test)

config = read(CONFIG)
if config.count(CONFIG_OLD) != 1:
    fail(f'Expected exact Worker Vitest test config once; found {config.count(CONFIG_OLD)}')
config = config.replace(CONFIG_OLD, CONFIG_NEW, 1)
write(CONFIG, config)

# Bind the workaround to the exact failure boundary: Worker tests must receive
# the active runner API as globals and must not externalize/import `vitest` from
# inside the Workers runtime. All original test bodies and assertions remain.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1 or LABEL in audit:
    fail('Worker Vitest globals audit anchor drifted or safeguard already exists')
expr = (
    '!s("tests/worker/runtime.test.js").includes("from \'vitest\'")'
    ' && s("vitest.config.js").includes("test:{globals:true,include:[\'tests/worker/**/*.test.js\'],testTimeout:20000}")'
    ' && s("tests/worker/runtime.test.js").includes("describe(\'Workers-runtime security primitives\'")'
    ' && s("tests/worker/runtime.test.js").includes("expect(made.setCookie).toContain(\'HttpOnly\')")'
)
audit = audit.replace(audit_anchor, f'    ,["{LABEL}", () => {expr}]\n' + audit_anchor, 1)
write(AUDIT, audit)

mutations = read(MUTATIONS)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail('Worker Vitest globals mutation anchor drifted')
mutation_specs = [
    (
        'restore explicit Worker Vitest runtime import -> ' + LABEL,
        'tests/worker/runtime.test.js',
        "const env={APP_ORIGIN:",
        "import {describe,it,expect} from 'vitest';\\nconst env={APP_ORIGIN:",
    ),
    (
        'disable Worker Vitest globals -> ' + LABEL,
        'vitest.config.js',
        "test:{globals:true,include:['tests/worker/**/*.test.js'],testTimeout:20000}",
        "test:{include:['tests/worker/**/*.test.js'],testTimeout:20000}",
    ),
]
entries = []
for label, path, target, replacement in mutation_specs:
    if label in mutations:
        fail(f'Worker Vitest globals mutation unexpectedly already present: {label}')
    entries.append(f'  [{json.dumps(label)}, {json.dumps(path)}, {js_regex_exact(target)}, {json.dumps(replacement)}],')
mutations = mutations.replace(mutation_anchor, '\n'.join(entries) + '\n' + mutation_anchor, 1)
write(MUTATIONS, mutations)

final_test = read(TEST)
final_config = read(CONFIG)
if "from 'vitest'" in final_test:
    fail('Explicit Worker Vitest import remains after globals repair')
if final_config.count("test:{globals:true,include:['tests/worker/**/*.test.js'],testTimeout:20000}") != 1:
    fail('Worker Vitest globals config missing or duplicated')
if read(AUDIT).count(LABEL) != 1:
    fail('Worker Vitest globals safeguard missing or duplicated')
for label, _, _, _ in mutation_specs:
    if read(MUTATIONS).count(label) != 1:
        fail(f'Worker Vitest globals deliberate mutation missing: {label}')

print('Worker Vitest globals repair PASS: Worker security tests keep all test bodies/assertions but use the active runner globals instead of importing another Vitest runtime.')
print('One static safeguard and two deliberate regression mutations installed; production Worker/browser code unchanged.')
