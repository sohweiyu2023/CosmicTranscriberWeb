import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {statusEnvironment,observeWranglerStatus} from '../../scripts/wrangler-status-observed.mjs';
test('Windows mixed-case credentials, Node options, log overrides and profiles are scrubbed case-insensitively',()=>{
 const env=statusEnvironment('synthetic-profile','1'.repeat(32),{Path:'system-path',cloudflare_api_token:'private',StAgInG_OpEnAi_ApI_KeY:'private',node_options:'private',wrangler_write_logs:'true',xdg_config_home:'wrong',Gh_ToKeN:'private'});
 assert.equal(env.Path,'system-path');assert.equal(env.XDG_CONFIG_HOME,'synthetic-profile');assert.equal(env.WRANGLER_WRITE_LOGS,'false');assert.equal(env.CLOUDFLARE_AUTH_USE_KEYRING,'true');assert.equal(Object.values(env).includes('private'),false);assert.equal(Object.values(env).includes('wrong'),false);
});
test('read-only observer preserves safe cause/account boolean with no authentication mutation or real execution',async()=>{
 const root=await fs.mkdtemp(path.join(tmpdir(),'cosmic-status-test-'));
 try{
  const bin=path.join(root,'node_modules/wrangler/bin');await fs.mkdir(bin,{recursive:true});await fs.writeFile(path.join(bin,'wrangler.js'),'// synthetic, not executed');await fs.writeFile(path.join(bin,'../package.json'),JSON.stringify({name:'wrangler',version:'4.153.0'}));
  let calls=0;const result=await observeWranglerStatus({cliFile:path.join(bin,'wrangler.js'),profile:path.join(root,'profile'),expectedAccount:'1'.repeat(32),logDirectory:path.join(root,'logs'),spawnImpl:(_file,args,options)=>{calls++;assert.equal(args[1],'whoami');assert.equal(options.env.WRANGLER_WRITE_LOGS,'false');const c=new EventEmitter();c.pid=123;c.stdout=new EventEmitter();c.stderr=new EventEmitter();queueMicrotask(()=>{c.stdout.emit('data',Buffer.from('You are logged in: synthetic-private-email@example.test '+ '1'.repeat(32)));c.emit('exit',0,null);c.emit('close')});return c}});
  assert.equal(calls,1);assert.equal(result.status,'success');assert.equal(result.expectedAccountMatched,true);assert.equal(result.newLoginFlow,false);assert.equal(JSON.stringify(result).includes('synthetic-private-email'),false);assert.equal(JSON.stringify(result).includes('1'.repeat(32)),false);
  await fs.writeFile(path.join(bin,'../package.json'),'malformed-synthetic-private');const blocked=await observeWranglerStatus({cliFile:path.join(bin,'wrangler.js'),profile:path.join(root,'profile'),expectedAccount:'1'.repeat(32),logDirectory:path.join(root,'logs'),spawnImpl:()=>assert.fail('No command on bad metadata')});assert.equal(blocked.errorCategory,'malformed_response');assert.equal(JSON.stringify(blocked).includes('malformed-synthetic-private'),false);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
