from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
PACKAGE = WORK / "package.json"
HELPER = WORK / "scripts" / "vitest-windows-runtime-compat.mjs"
AUDIT = WORK / "scripts" / "audit-lib.mjs"
MUTATIONS = WORK / "scripts" / "mutation-suite.mjs"

LABEL = "Windows Vitest 4.1.10 duplicate-runtime compatibility is exact and precedes every Vitest command"
MARKER = "CTW_VITEST_WINDOWS_RUNTIME_CASE_REPAIR_10843"
PRE = "node scripts/vitest-windows-runtime-compat.mjs"


def fail(message: str) -> None:
    raise SystemExit(message)


def read(path: pathlib.Path) -> str:
    if not path.is_file():
        fail(f"Vitest Windows repair required file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        fail(f"Vitest Windows repair expected UTF-8 file: {path}")
        raise


def write(path: pathlib.Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def js_regex_exact(text: str) -> str:
    if "\n" in text or "\r" in text:
        fail("js_regex_exact only supports one-line targets")
    return "/" + re.sub(r"([\\^$.*+?()\[\]{}|/])", r"\\\1", text) + "/"


if HELPER.exists():
    fail("Vitest Windows runtime compatibility helper unexpectedly already exists")

helper = r'''import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const EXPECTED_VERSION='4.1.10';
const MARKER='CTW_VITEST_WINDOWS_RUNTIME_CASE_REPAIR_10843';
const root=path.resolve(import.meta.dirname,'..');
function fail(message){throw new Error(`Vitest Windows runtime compatibility FAILED: ${message}`)}
function sha256(text){return createHash('sha256').update(text).digest('hex')}
function replaceOnce(text,oldText,newText,label){const count=text.split(oldText).length-1;if(count!==1)fail(`expected exactly one ${label}; found ${count}`);return text.replace(oldText,newText)}
async function jsFiles(dir){const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())out.push(...await jsFiles(full));else if(entry.isFile()&&entry.name.endsWith('.js'))out.push(full)}return out}
if(process.platform!=='win32'){console.log('Vitest Windows runtime compatibility: non-Windows platform; no patch required.');process.exit(0)}
const pkgPath=path.join(root,'node_modules','vitest','package.json');
let pkg;try{pkg=JSON.parse(await readFile(pkgPath,'utf8'))}catch{fail('installed Vitest package is missing; run npm ci first')}
if(pkg.version!==EXPECTED_VERSION)fail(`expected Vitest ${EXPECTED_VERSION}; found ${pkg.version??'(missing)'}`);
const dist=path.join(root,'node_modules','vitest','dist');
const candidates=[];
for(const file of await jsFiles(dist)){const text=await readFile(file,'utf8');if(text.includes('function getCachedVitestImport(id, state)')&&(text.includes('const normalizedDistDir = normalize(distDir);')||text.includes(MARKER)))candidates.push([file,text])}
if(candidates.length!==1)fail(`expected exactly one compiled cached resolver; found ${candidates.length}`);
const [target,original]=candidates[0];
const oldOwnDist='\tif (id.includes(distDir) || id.includes(normalizedDistDir)) {';
const oldDistExternalize='\t\tconst externalize = id.startsWith("file://") ? id : `${pathToFileURL(file)}${postfix}`;';
const oldRootExternalize='\t\tconst externalize = `${pathToFileURL(join(root, file))}${postfix}`;';
const helperAnchor='const externalizeMap = /* @__PURE__ */ new Map();\n';
const helperBlock=`const externalizeMap = /* @__PURE__ */ new Map();
// ${MARKER}: compiled equivalent of upstream vitest-dev/vitest#10843.
const ctwVitestRuntimeIsWindows = process.platform === "win32";
const ctwVitestRuntimeDistDirUrl = pathToFileURL(distDir).href;
const ctwVitestRuntimeLowerDistDir = distDir.toLowerCase();
const ctwVitestRuntimeLowerNormalizedDistDir = normalizedDistDir.toLowerCase();
const ctwVitestRuntimeLowerDistDirUrl = ctwVitestRuntimeDistDirUrl.toLowerCase();
function ctwVitestRuntimeIsDistId(id) {
\tif (id.includes(distDir) || id.includes(normalizedDistDir)) return true;
\tif (!ctwVitestRuntimeIsWindows) return false;
\tconst lowerId = id.toLowerCase();
\treturn lowerId.includes(ctwVitestRuntimeLowerDistDir) || lowerId.includes(ctwVitestRuntimeLowerNormalizedDistDir) || lowerId.includes(ctwVitestRuntimeLowerDistDirUrl);
}
function ctwVitestRuntimeWithLoadedCasing(externalize) {
\tif (!ctwVitestRuntimeIsWindows) return externalize;
\tconst index = externalize.toLowerCase().indexOf(ctwVitestRuntimeLowerDistDirUrl);
\tif (index === -1) return externalize;
\treturn externalize.slice(0, index) + ctwVitestRuntimeDistDirUrl + externalize.slice(index + ctwVitestRuntimeDistDirUrl.length);
}
`;
function verifyPatched(text){
  if((text.split(MARKER).length-1)!==1)fail('compatibility marker must occur exactly once');
  for(const stale of [oldOwnDist,oldDistExternalize,oldRootExternalize])if(text.includes(stale))fail('old case-sensitive resolver form remains after patch');
  for(const required of ['if (ctwVitestRuntimeIsDistId(id)) {','id.startsWith("file://") ? ctwVitestRuntimeWithLoadedCasing(id)','ctwVitestRuntimeWithLoadedCasing(pathToFileURL(file).href)','ctwVitestRuntimeWithLoadedCasing(pathToFileURL(join(root, file)).href)'])if(!text.includes(required))fail(`patched resolver invariant missing: ${required}`);
}
if(original.includes(MARKER)){verifyPatched(original);console.log(`Vitest ${EXPECTED_VERSION} Windows runtime compatibility PASS (already applied): ${path.relative(root,target)}`);console.log(`patched_sha256=${sha256(original)}`);process.exit(0)}
let text=replaceOnce(original,helperAnchor,helperBlock,'compiled resolver helper anchor');
text=replaceOnce(text,oldOwnDist,'\tif (ctwVitestRuntimeIsDistId(id)) {','own-dist match');
text=replaceOnce(text,oldDistExternalize,'\t\tconst externalize = id.startsWith("file://") ? ctwVitestRuntimeWithLoadedCasing(id) : `${ctwVitestRuntimeWithLoadedCasing(pathToFileURL(file).href)}${postfix}`;','dist externalization');
text=replaceOnce(text,oldRootExternalize,'\t\tconst externalize = `${ctwVitestRuntimeWithLoadedCasing(pathToFileURL(join(root, file)).href)}${postfix}`;','relative-root externalization');
verifyPatched(text);
const before=sha256(original),after=sha256(text);if(before===after)fail('resolver SHA-256 did not change');
await writeFile(target,text,'utf8');
console.log(`Vitest ${EXPECTED_VERSION} Windows runtime compatibility PASS: ${path.relative(root,target)}`);
console.log(`before_sha256=${before}`);console.log(`after_sha256=${after}`);console.log('upstream_semantics=vitest-dev/vitest#10843');
'''
HELPER.write_text(helper, encoding="utf-8", newline="")

# Keep the reviewed test commands unchanged so existing build-first release safeguards stay valid.
# npm automatically runs pre<name> before `npm run <name>`, including in freshly extracted packages.
pkg = read(PACKAGE)
worker = '    "test:worker": "vitest run --config vitest.config.js",'
integration = '    "test:integration": "npm run build && vitest run tests/integration --config vitest.integration.config.js",'
pre_worker = f'    "pretest:worker": "{PRE}",'
pre_integration = f'    "pretest:integration": "{PRE}",'
if pkg.count(worker) != 1 or pkg.count(integration) != 1:
    fail("Reviewed Vitest-backed package commands drifted")
for pre in (pre_worker, pre_integration):
    if pre in pkg:
        fail(f"Vitest compatibility pre-script unexpectedly already present: {pre}")
pkg = pkg.replace(worker, pre_worker + "\n" + worker, 1)
pkg = pkg.replace(integration, pre_integration + "\n" + integration, 1)
write(PACKAGE, pkg)

# Static safeguard binds the exact affected version/upstream semantics and both npm lifecycle preflights.
audit = read(AUDIT)
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1 or LABEL in audit:
    fail("Vitest Windows audit insertion anchor drifted or safeguard already exists")
expr = (
    's("scripts/vitest-windows-runtime-compat.mjs").includes("const EXPECTED_VERSION=\'4.1.10\';")'
    ' && s("scripts/vitest-windows-runtime-compat.mjs").includes("CTW_VITEST_WINDOWS_RUNTIME_CASE_REPAIR_10843")'
    ' && s("scripts/vitest-windows-runtime-compat.mjs").includes("vitest-dev/vitest#10843")'
    ' && s("scripts/vitest-windows-runtime-compat.mjs").includes("ctwVitestRuntimeIsDistId(id)")'
    ' && s("scripts/vitest-windows-runtime-compat.mjs").includes("ctwVitestRuntimeWithLoadedCasing(pathToFileURL(file).href)")'
    ' && s("package.json").includes("\\\"pretest:worker\\\": \\\"node scripts/vitest-windows-runtime-compat.mjs\\\"")'
    ' && s("package.json").includes("\\\"pretest:integration\\\": \\\"node scripts/vitest-windows-runtime-compat.mjs\\\"")'
)
audit = audit.replace(audit_anchor, f'    ,["{LABEL}", () => {expr}]\n' + audit_anchor, 1)
write(AUDIT, audit)

mutations = read(MUTATIONS)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail("Vitest Windows mutation insertion anchor drifted")
mutation_specs = [
    ("remove Worker Vitest compatibility preflight -> " + LABEL, "package.json", pre_worker.strip().rstrip(','), '"pretest:worker": "node -e \\\"process.exit(0)\\\""'),
    ("remove integration Vitest compatibility preflight -> " + LABEL, "package.json", pre_integration.strip().rstrip(','), '"pretest:integration": "node -e \\\"process.exit(0)\\\""'),
    ("weaken exact affected Vitest version guard -> " + LABEL, "scripts/vitest-windows-runtime-compat.mjs", "const EXPECTED_VERSION='4.1.10';", "const EXPECTED_VERSION='4';"),
    ("remove loaded-casing preservation -> " + LABEL, "scripts/vitest-windows-runtime-compat.mjs", "ctwVitestRuntimeWithLoadedCasing(pathToFileURL(file).href)", "pathToFileURL(file).href"),
]
entries = []
for label, path, target, replacement in mutation_specs:
    if label in mutations:
        fail(f"Vitest Windows mutation unexpectedly already present: {label}")
    entries.append(f'  [{json.dumps(label)}, {json.dumps(path)}, {js_regex_exact(target)}, {json.dumps(replacement)}],')
mutations = mutations.replace(mutation_anchor, "\n".join(entries) + "\n" + mutation_anchor, 1)
write(MUTATIONS, mutations)

final_pkg = read(PACKAGE)
for invariant in (worker, integration, pre_worker, pre_integration):
    if final_pkg.count(invariant) != 1:
        fail(f"Vitest Windows package invariant missing or duplicated: {invariant}")
if read(AUDIT).count(LABEL) != 1:
    fail("Vitest Windows static safeguard missing or duplicated")
for label, _, _, _ in mutation_specs:
    if read(MUTATIONS).count(label) != 1:
        fail(f"Vitest Windows deliberate mutation missing or duplicated: {label}")

print("Vitest Windows runtime repair integration PASS: exact npm pre-scripts apply an idempotent 4.1.10 compatibility helper before Worker and integration collection.")
print("Reviewed test commands remain unchanged; fresh ZIP verification is covered after its own npm ci.")
print("One static safeguard and four deliberate regression mutations installed; production Worker/browser code unchanged.")
