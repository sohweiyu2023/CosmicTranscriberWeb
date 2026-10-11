import test from 'node:test';
import assert from 'node:assert/strict';
import {npmInvocation} from '../../scripts/npm-invoke.mjs';

test('npm helper invokes npm JavaScript CLI directly when npm_execpath is available',()=>{
  const p=npmInvocation(['install','x@latest'],{npmExecPath:'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js',platform:'win32',nodeExecPath:'C:/Program Files/nodejs/node.exe'});
  assert.equal(p.command,'C:/Program Files/nodejs/node.exe');
  assert.deepEqual(p.args,['C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js','install','x@latest']);
  assert.equal(p.shell,false);
});

test('npm helper has an explicit Windows fallback instead of silently swallowing cmd spawn failure',()=>{
  const p=npmInvocation(['audit'],{npmExecPath:'',platform:'win32',nodeExecPath:'node'});
  assert.equal(p.command,'npm.cmd');
  assert.deepEqual(p.args,['audit']);
  assert.equal(p.shell,true);
});
