import {it as test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const atRoot=createRequire(new URL('../../package.json',import.meta.url));
const installed=(name,requireFrom=atRoot)=>JSON.parse(readFileSync(requireFrom.resolve(name+'/package.json'),'utf8'));
const miniflareRequire=createRequire(atRoot.resolve('miniflare'));
const pluginPackage=new URL('../../node_modules/@cloudflare/vitest-plugin/package.json',import.meta.url);
const pluginRequire=createRequire(pluginPackage);
test('actual tooling parents resolve the patched same-major libraries',()=>{
 assert.equal(installed('undici',miniflareRequire).version,'7.30.1');assert.equal(installed('zod',pluginRequire).version,'4.6.6');
 assert.match(installed('miniflare').version,/^5\./);assert.match(JSON.parse(readFileSync(pluginPackage,'utf8')).version,/^1\./);
});
test('patched Undici verifies uppercase integrity tokens and rejects wrong response bytes',async()=>{
 const {fetch,MockAgent}=miniflareRequire('undici'),expected='fixed local integrity fixture';
 const integrity='SHA256-'+createHash('sha256').update(expected).digest('base64');
 const dispatcher=new MockAgent();dispatcher.disableNetConnect();
 const origin='https://integrity.example.test',pool=dispatcher.get(origin);
 pool.intercept({path:'/valid',method:'GET'}).reply(200,expected);pool.intercept({path:'/invalid',method:'GET'}).reply(200,'different local bytes');
 try{
  const good=await fetch(origin+'/valid',{integrity,dispatcher});assert.equal(await good.text(),expected);
  await assert.rejects(fetch(origin+'/invalid',{integrity,dispatcher}),/fetch failed|integrity/i);dispatcher.assertNoPendingInterceptors();
 }finally{await dispatcher.close();}
});
test('patched Zod rejects oversized constrained input without collecting an issue for every element',()=>{
 const {z}=pluginRequire('zod');const result=z.array(z.string()).max(2).safeParse(Array(1000).fill(1));
 assert.equal(result.success,false);assert.ok(result.error.issues.length<100);assert.ok(result.error.issues.some(issue=>issue.code==='too_big'));
});
