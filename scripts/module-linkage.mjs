import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const files = [];

async function walk(dir) {
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) await walk(rel);
    else if (entry.name.endsWith('.js')) files.push(rel);
  }
}

for (const dir of ['src', 'public/js']) await walk(dir);

const exported = new Map();
for (const file of files) {
  const text = await readFile(path.join(root, file), 'utf8');
  const names = new Set();
  for (const match of text.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1] || match[2]);
  }
  for (const match of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const item of match[1].split(',')) {
      const name = item.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  exported.set(file, names);
}

let failures = 0;
for (const file of files) {
  const text = await readFile(path.join(root, file), 'utf8');
  for (const match of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[2]));
    const targetFile = target.endsWith('.js') ? target : `${target}.js`;
    if (!exported.has(targetFile)) {
      console.error(`FAIL ${file}: local import target not found ${targetFile}`);
      failures++;
      continue;
    }
    for (const item of match[1].split(',')) {
      const sourceName = item.trim().split(/\s+as\s+/)[0];
      if (sourceName && !exported.get(targetFile).has(sourceName)) {
        console.error(`FAIL ${file}: ${sourceName} not exported by ${targetFile}`);
        failures++;
      }
    }
  }
}

if (failures) process.exit(1);
console.log(`Local ES-module linkage PASS (${files.length} modules).`);
