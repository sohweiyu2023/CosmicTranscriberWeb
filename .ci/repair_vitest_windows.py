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
function replaceOnce(text,oldText,newText,label){
  const count=text.split(oldText).length-1;
  if(count!==1)fail(`expected exactly one ${label}; found ${count}`);
  return text.replace(oldText,newText);
}
async function jsFiles(dir){
  const out=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...await jsFiles(full));
    else if(entry.isFile()&&entry.name.endsWith('.js'))out.push(full);
  }
  return out;
}

if(process.platform!=='win32'){
  console.log('Vitest Windows runtime compatibility: non-Windows platform; no patch required.');
  process.exit(0);
}

const pkgPath=path.join(root,'node_modules','vitest','package.json');
let pkg;
try{pkg=JSON.parse(await readFile(pkgPath,'utf8'))}catch{fail('installed Vitest package is missing; run npm ci first')}
if(pkg.version!==EXPECTED_VERSION)fail(`expected Vitest ${EXPECTED_VERSION}; found ${pkg.version??'(missing)'}`);

const dist=path.join(root,'node_modules','vitest','dist');
const candidates=[];
for(const file of await jsFiles(dist)){
  const text=await readFile(file,'utf8');
  if(text.includes('function getCachedVitestImport(id, state)')&&(text.includes('const normalizedDistDir = normalize(distDir);')||text.includes(MARKER)))candidates.push([file,text]);
}
if(candidates.length!==1)fail(`expected exactly one compiled cached resolver; found ${candidates.length}`);
const [target,original]=candidates[0];

const oldOwnDist='\tif (id.includes(distDir) || id.includes(normalizedDistDir)) {';
const oldDistExternalize='\t\tconst externalize = id.startsWith("file://") ? id : `${pathToFileURL(file)}${postfix}`;';
const oldRootExternalize='\t\tconst externalize = `${pathToFileURL(join(root, file))}${postfix}`;';
const helperAnchor='const externalizeMap = /* @__PURE__ */ new Map();\n';
const helperBlock=`const externalizeMap = /* @__PURE__ */ new Map();
// ${MARKER}: compiled equivalent of upstream vitest-dev/vitest#10843.
// Windows paths are case-insensitive but Node ESM cache keys are URL-string-sensitive.
// Preserve the spelling used by the Vitest instance that initialized collector state.
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
  for(const required of [
    'if (ctwVitestRuntimeIsDistId(id)) {',
    'id.startsWith("file://") ? ctwVitestRuntimeWithLoadedCasing(id)',
    'ctwVitestRuntimeWithLoadedCasing(pathToFileURL(file).href)',
    'ctwVitestRuntimeWithLoadedCasing(pathToFileURL(join(root, file)).href)'
  ])if(!text.includes(required))fail(`patched resolver invariant missing: ${required}`);
}

if(original.includes(MARKER)){
  verifyPatched(original);
  console.log(`Vitest ${EXPECTED_VERSION} Windows runtime compatibility PASS (already applied): ${path.relative(root,target)}`);
  console.log(`patched_sha256=${sha256(original)}`);
  process.exit(0);
}

let text=replaceOnce(original,helperAnchor,helperBlock,'compiled resolver helper anchor');
text=replaceOnce(text,oldOwnDist,'\tif (ctwVitestRuntimeIsDistId(id)) {','own-dist match');
text=replaceOnce(text,oldDistExternalize,'\t\tconst externalize = id.startsWith("file://") ? ctwVitestRuntimeWithLoadedCasing(id) : `${ctwVitestRuntimeWithLoadedCasing(pathToFileURL(file).href)}${postfix}`;','dist externalization');
text=replaceOnce(text,oldRootExternalize,'\t\tconst externalize = `${ctwVitestRuntimeWithLoadedCasing(pathToFileURL(join(root, file)).href)}${postfix}`;','relative-root externalization');
verifyPatched(text);
const before=sha256(original),after=sha256(text);
if(before===after)fail('resolver SHA-256 did not change');
await writeFile(target,text,'utf8');
console.log(`Vitest ${EXPECTED_VERSION} Windows runtime compatibility PASS: ${path.relative(root,target)}`);
console.log(`before_sha256=${before}`);
console.log(`after_sha256=${after}`);
console.log('upstream_semantics=vitest-dev/vitest#10843');
'''
HELPER.write_text(helper, encoding="utf-8", newline="")

# Make every Vitest-backed project command invoke the idempotent compatibility helper.
pkg = read(PACKAGE)
old_worker = '    "test:worker": "vitest run --config vitest.config.js",'
new_worker = '    "test:worker": "node scripts/vitest-windows-runtime-compat.mjs && vitest run --config vitest.config.js",'
old_integration = '    "test:integration": "npm run build && vitest run tests/integration --config vitest.integration.config.js",'
new_integration = '    "test:integration": "npm run build && node scripts/vitest-windows-runtime-compat.mjs && vitest run tests/integration --config vitest.integration.config.js",'
for old, new, label in ((old_worker,new_worker,'test:worker'),(old_integration,new_integration,'test:integration')):
    if pkg.count(old) != 1 or new in pkg:
        fail(f"Reviewed package.json {label} anchor drifted")
    pkg = pkg.replace(old,new,1)
write(PACKAGE,pkg)

# Add a static safeguard: exact version guard, exact upstream marker, and both Vitest entry points protected.
audit = read(AUDIT)
if LABEL in audit:
    fail("Vitest Windows compatibility safeguard unexpectedly already present")
audit_anchor = '    ,["CI resolves one reviewed lock and reuses it across every platform",'
if audit.count(audit_anchor) != 1:
    fail(f"Vitest Windows audit insertion anchor drifted: {audit.count(audit_anchor)}")
expr = (
    's("scripts/vitest-windows-runtime-compat.mjs").includes("const EXPECTED_VERSION=\'4.1.10\';")'
    ' && s("scripts/vitest-windows-runtime-compat.mjs").includes("CTW_VITEST_WINDOWS_RUNTIME_CASE_REPAIR_10843")'
    ' && s("scripts/vitest-windows-runtime-compat.mjs").includes("vitest-dev/vitest#10843")'
    ' && s("scripts/vitest-windows-runtime-compat.mjs").includes("ctwVitestRuntimeIsDistId(id)")'
    ' && s("scripts/vitest-windows-runtime-compat.mjs").includes("ctwVitestRuntimeWithLoadedCasing(pathToFileURL(file).href)")'
    ' && s("package.json").includes("\\\"test:worker\\\": \\\"node scripts/vitest-windows-runtime-compat.mjs && vitest run --config vitest.config.js\\\"")'
    ' && s("package.json").includes("\\\"test:integration\\\": \\\"npm run build && node scripts/vitest-windows-runtime-compat.mjs && vitest run tests/integration --config vitest.integration.config.js\\\"")'
)
check = f'    ,["{LABEL}", () => {expr}]\n'
audit = audit.replace(audit_anchor,check+audit_anchor,1)
write(AUDIT,audit)

# Deliberate mutations must kill the new safeguard.
mutations = read(MUTATIONS)
mutation_anchor = '  ["stop CI from sharing one reviewed lock across platforms",'
if mutations.count(mutation_anchor) != 1:
    fail(f"Vitest Windows mutation insertion anchor drifted: {mutations.count(mutation_anchor)}")
mutation_specs = [
    (
        "remove Worker Vitest compatibility preflight -> Windows Vitest 4.1.10 duplicate-runtime compatibility is exact and precedes every Vitest command",
        "package.json",
        "node scripts/vitest-windows-runtime-compat.mjs && vitest run --config vitest.config.js",
        "vitest run --config vitest.config.js",
    ),
    (
        "remove integration Vitest compatibility preflight -> Windows Vitest 4.1.10 duplicate-runtime compatibility is exact and precedes every Vitest command",
        "package.json",
        "node scripts/vitest-windows-runtime-compat.mjs && vitest run tests/integration --config vitest.integration.config.js",
        "vitest run tests/integration --config vitest.integration.config.js",
    ),
    (
        "weaken exact affected Vitest version guard -> Windows Vitest 4.1.10 duplicate-runtime compatibility is exact and precedes every Vitest command",
        "scripts/vitest-windows-runtime-compat.mjs",
        "const EXPECTED_VERSION='4.1.10';",
        "const EXPECTED_VERSION='4';",
    ),
    (
        "remove loaded-casing preservation -> Windows Vitest 4.1.10 duplicate-runtime compatibility is exact and precedes every Vitest command",
        "scripts/vitest-windows-runtime-compat.mjs",
        "ctwVitestRuntimeWithLoadedCasing(pathToFileURL(file).href)",
        "pathToFileURL(file).href",
    ),
]
entries=[]
for label,path,target,replacement in mutation_specs:
    if label in mutations:
        fail(f"Vitest Windows mutation unexpectedly already present: {label}")
    entries.append(f'  [{json.dumps(label)}, {json.dumps(path)}, {js_regex_exact(target)}, {json.dumps(replacement)}],')
mutations = mutations.replace(mutation_anchor,"\n".join(entries)+"\n"+mutation_anchor,1)
write(MUTATIONS,mutations)

# Final exact postconditions.
for invariant in (new_worker,new_integration):
    if read(PACKAGE).count(invariant) != 1:
        fail(f"Vitest Windows package command invariant missing: {invariant}")
if read(AUDIT).count(LABEL) != 1:
    fail("Vitest Windows static safeguard missing or duplicated")
for label,_,_,_ in mutation_specs:
    if read(MUTATIONS).count(label) != 1:
        fail(f"Vitest Windows deliberate mutation missing or duplicated: {label}")

print("Vitest Windows runtime repair integration PASS: every project Vitest entry point now applies an idempotent, exact-version compatibility helper before collection.")
print("Fresh ZIP verification is covered automatically because it runs npm ci followed by the same release test scripts.")
print("One static safeguard and four deliberate regression mutations installed; production Worker/browser code unchanged.")
