import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const read=p=>readFile(path.join(root,p),'utf8');
const pkg=JSON.parse(await read('package.json'));
const lock=JSON.parse(await read('package-lock.json'));
assert.equal(pkg.license,'MIT');
assert.equal(lock.packages[''].license,'MIT');
const owner=await read('LICENSE');
assert.ok(owner.includes('Copyright (c) 2026 Soh Wei Yu'));
assert.ok(owner.includes('Permission is hereby granted, free of charge'));
assert.ok(owner.includes('THE SOFTWARE IS PROVIDED "AS IS"'));
const entries=Object.entries(lock.packages).filter(([p])=>p).sort(([a],[b])=>a.localeCompare(b,'en')).map(([path,p])=>({path,version:p.version,license:p.license||null,dev:!!p.dev,optional:!!p.optional,resolved:p.resolved||null,integrity:p.integrity||null}));
assert.deepEqual(JSON.parse(await read('docs/DEPENDENCY_LICENSE_INVENTORY.json')).entries,entries,'License inventory must match every exact lock entry');
const runtime=[['@noble/hashes','2.4.0','LICENSE','licenses/noble-hashes-MIT.txt'],['jose','6.2.13','LICENSE.md','licenses/jose-MIT.txt']];
assert.deepEqual(Object.keys(pkg.dependencies).sort(),runtime.map(([name])=>name).sort(),'Review legal files for changed runtime dependencies');
for(const [name,version,upstream,notice] of runtime){
  const p=lock.packages[`node_modules/${name}`];
  assert.equal(p.version,version,'Runtime dependency changed: review license text');
  assert.equal(p.license,'MIT');
  assert.match(p.integrity,/^sha512-/);
  assert.equal(JSON.parse(await read(`node_modules/${name}/package.json`)).version,version);
  assert.equal(await read(notice),await read(`node_modules/${name}/${upstream}`),'Preserved license must be byte-for-byte upstream text');
}
if(process.argv.includes('--build')){
  for(const p of ['LICENSE','THIRD-PARTY-NOTICES.md','licenses/noble-hashes-MIT.txt','licenses/jose-MIT.txt'])assert.equal(await read(`dist/public/${p}`),await read(p),`Built grant missing/changed: ${p}`);
  assert.equal(await read('dist/public/vendor/noble-hashes/LICENSE'),await read('licenses/noble-hashes-MIT.txt'));
}
console.log(`Licensing PASS: ${entries.length} locked dependencies, both exact runtime grants${process.argv.includes('--build')?', built distribution notices':''}.`);
