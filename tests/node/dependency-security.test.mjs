import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const lock=JSON.parse(readFileSync(new URL('../../package-lock.json',import.meta.url),'utf8'));
const atLeast=(version,floor)=>{const a=version.split('.').map(Number),b=floor.split('.').map(Number);return a.every(Number.isInteger)&&a.reduce((result,x,i)=>result||Math.sign(x-b[i]),0)>=0};
test('every locked Undici and Zod copy meets its advisory patch floor before dependencies are installed',()=>{
 let undici=0,zod=0;
 for(const [name,meta] of Object.entries(lock.packages)){
  if(name.endsWith('/node_modules/undici')||name==='node_modules/undici'){
   const floor={6:'6.29.1',7:'7.30.1',8:'8.12.2'}[meta.version.split('.')[0]];assert.ok(floor&&atLeast(meta.version,floor),name);undici++;
  }
  if(name.endsWith('/node_modules/zod')||name==='node_modules/zod'){assert.ok(atLeast(meta.version,'4.6.6'),name);zod++;}
 }
 assert.ok(undici>0&&zod>0);
});
