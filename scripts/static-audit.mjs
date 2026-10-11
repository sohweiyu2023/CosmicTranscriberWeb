import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {safeguards} from './audit-lib.mjs';
const root=path.resolve(import.meta.dirname,'..');
const wanted=['src','public','tests','scripts','migrations'];
const files={};
async function walk(dir){for(const e of await readdir(path.join(root,dir),{withFileTypes:true})){const rel=path.join(dir,e.name).replaceAll('\\','/');if(e.isDirectory())await walk(rel);else if(/\.(js|mjs|html|css|jsonc|sql|ps1)$/.test(e.name)||rel==='public/_headers')files[rel]=await readFile(path.join(root,rel),'utf8')}}
for(const d of wanted)await walk(d);
for(const f of ['wrangler.jsonc','vitest.config.js','vitest.integration.config.js','playwright.config.js','package.json','.github/workflows/ci.yml','RELEASE-WINDOWS.ps1','FIRST-DEPLOY-WINDOWS.ps1','PASTE-ONCE-WINDOWS.ps1','WINDOWS-TOOLCHAIN.ps1','WINDOWS-TOOLCHAIN-SELFTEST.ps1','.npmrc','.nvmrc','RELEASE_MANIFEST.json','README.md'])files[f]=await readFile(path.join(root,f),'utf8');
let fail=0;for(const [name,test] of safeguards(files)){const ok=!!test();console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)fail++}if(fail){console.error(`${fail} safeguard audit failure(s).`);process.exit(1)}console.log(`Static safeguard audit PASS (${safeguards(files).length} checks).`);
