import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..');

function fail(message){throw new Error(`Version consistency FAILED: ${message}`)}
function exactMatch(text,re,label){const m=re.exec(text);if(!m)fail(`${label} is missing`);return m[1]}
function requireVersion(label,value,version){if(String(value)!==version)fail(`${label} ${value??'(missing)'} does not match package.json ${version}`)}
function requireAllLiteralVersions(text,re,label,version){
  const found=[...text.matchAll(re)].map(m=>m[1]);
  if(found.length===0)fail(`${label} has no version literal`);
  const bad=found.filter(v=>v!==version);
  if(bad.length)fail(`${label} contains stale version(s): ${[...new Set(bad)].join(', ')}; expected ${version}`);
}

export async function verifyVersionConsistency(base=root){
  const [pkgText,manifestText,wranglerText,modelsText,indexText,readmeText,workerWranglerText,integrationWranglerText,workerRuntimeText,e2eMockText,pasteOnceText,nvmrcText,toolchainText]=await Promise.all([
    readFile(path.join(base,'package.json'),'utf8'),
    readFile(path.join(base,'RELEASE_MANIFEST.json'),'utf8'),
    readFile(path.join(base,'wrangler.jsonc'),'utf8'),
    readFile(path.join(base,'public/js/models.js'),'utf8'),
    readFile(path.join(base,'public/index.html'),'utf8'),
    readFile(path.join(base,'README.md'),'utf8'),
    readFile(path.join(base,'tests/worker/wrangler.test.jsonc'),'utf8'),
    readFile(path.join(base,'tests/integration/wrangler.test.jsonc'),'utf8'),
    readFile(path.join(base,'tests/worker/runtime.test.js'),'utf8'),
    readFile(path.join(base,'tests/e2e/mock-server.mjs'),'utf8'),
    readFile(path.join(base,'PASTE-ONCE-WINDOWS.ps1'),'utf8'),
    readFile(path.join(base,'.nvmrc'),'utf8'),
    readFile(path.join(base,'WINDOWS-TOOLCHAIN.ps1'),'utf8')
  ]);
  const pkg=JSON.parse(pkgText);
  const manifest=JSON.parse(manifestText);
  const wrangler=JSON.parse(wranglerText);
  const workerWrangler=JSON.parse(workerWranglerText);
  const integrationWrangler=JSON.parse(integrationWranglerText);
  const version=String(pkg.version||'');
  if(!/^\d+\.\d+\.\d+$/.test(version))fail(`package.json version is not plain semver: ${version||'(missing)'}`);
  requireVersion('RELEASE_MANIFEST.json version',manifest.version,version);
  for(const [scope,value] of [
    ['wrangler top-level APP_VERSION',wrangler?.vars?.APP_VERSION],
    ['wrangler staging APP_VERSION',wrangler?.env?.staging?.vars?.APP_VERSION],
    ['wrangler production APP_VERSION',wrangler?.env?.production?.vars?.APP_VERSION],
    ['Worker Vitest Wrangler APP_VERSION',workerWrangler?.vars?.APP_VERSION],
    ['integration Wrangler APP_VERSION',integrationWrangler?.vars?.APP_VERSION]
  ]) requireVersion(scope,value,version);
  const browserVersion=exactMatch(modelsText,/export const APP_VERSION\s*=\s*["']([^"']+)["']\s*;/,'public/js/models.js APP_VERSION');
  requireVersion('public/js/models.js APP_VERSION',browserVersion,version);
  if(!indexText.includes(`id="versionText">v${version}<`))fail(`public/index.html footer does not declare v${version}`);
  if(!indexText.includes(`<strong>Web version ${version}</strong>`))fail(`public/index.html About dialog does not declare Web version ${version}`);
  const readmeHeading=`# Cosmic Transcriber Web ${version}`;
  if(!readmeText.startsWith(`${readmeHeading}\n`)&&!readmeText.startsWith(`${readmeHeading}\r\n`))fail(`README.md heading does not declare ${version}`);
  const runtimeVersion=exactMatch(workerRuntimeText,/APP_VERSION\s*:\s*["']([^"']+)["']/,'tests/worker/runtime.test.js APP_VERSION');
  requireVersion('tests/worker/runtime.test.js APP_VERSION',runtimeVersion,version);
  requireAllLiteralVersions(e2eMockText,/\bversion\s*:\s*["']([^"']+)["']/g,'tests/e2e/mock-server.mjs runtime responses',version);
  const launcherVersion=exactMatch(pasteOnceText,/\$Version\s*=\s*["']([^"']+)["']/,'PASTE-ONCE-WINDOWS.ps1 version');
  requireVersion('PASTE-ONCE-WINDOWS.ps1 version',launcherVersion,version);
  const expectedNode='26.7.0';
  const expectedNpm='12.0.2';
  if(nvmrcText.trim()!==expectedNode)fail(`.nvmrc ${nvmrcText.trim()||'(empty)'} does not match reviewed Node ${expectedNode}`);
  if(!String(pkg?.engines?.node||'').includes('>=26.7.0')||!String(pkg?.engines?.node||'').includes('<27'))fail('package.json Node engine does not preserve the reviewed Node 26.7.0 floor');
  if(!String(pkg?.engines?.npm||'').includes('>=12.0.2')||!String(pkg?.engines?.npm||'').includes('<13'))fail('package.json npm engine does not preserve the reviewed npm 12.0.2 floor');
  const toolNode=exactMatch(toolchainText,/\$script:CosmicNodeVersion\s*=\s*["']([^"']+)["']/,'WINDOWS-TOOLCHAIN.ps1 Node version');
  const toolNpm=exactMatch(toolchainText,/\$script:CosmicNpmVersion\s*=\s*["']([^"']+)["']/,'WINDOWS-TOOLCHAIN.ps1 npm version');
  requireVersion('WINDOWS-TOOLCHAIN.ps1 Node version',toolNode,expectedNode);
  requireVersion('WINDOWS-TOOLCHAIN.ps1 npm version',toolNpm,expectedNpm);
  return version;
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  try{const version=await verifyVersionConsistency();console.log(`Version consistency PASS (${version}) across package, manifest, production/test Wrangler configs, Worker runtime, E2E mock, paste-once launcher, browser UI, README, .nvmrc and private Windows toolchain.`)}
  catch(error){console.error(error?.message||error);process.exit(1)}
}
