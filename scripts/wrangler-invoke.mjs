import {readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const packagePath=path.join(root,'node_modules','wrangler','package.json');
let pkg;
try{pkg=JSON.parse(await readFile(packagePath,'utf8'));}catch{console.error('wrangler is not installed. Run npm install or npm ci first.');process.exit(1)}
const bin=typeof pkg.bin==='string'?pkg.bin:(pkg.bin?.wrangler||pkg.bin?.wrangler2);
if(typeof bin!=='string'||!bin){console.error('The installed wrangler package does not expose the expected CLI bin.');process.exit(1)}
const cli=path.resolve(path.dirname(packagePath),bin);
try{await access(cli)}catch{console.error(`Wrangler CLI is missing: ${cli}`);process.exit(1)}
const result=spawnSync(process.execPath,[cli,...process.argv.slice(2)],{cwd:root,stdio:'inherit',env:process.env,shell:false});
if(result.error){console.error(`Unable to start the installed Wrangler CLI: ${result.error.message}`);process.exit(1)}
process.exit(result.status??1);
