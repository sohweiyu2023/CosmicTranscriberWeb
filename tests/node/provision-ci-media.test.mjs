import test from 'node:test';
import assert from 'node:assert/strict';
import {provision,probe,aptPlan,ENCODERS,DECODER_GROUPS,hasCapabilities} from '../../scripts/provision-ci-media.mjs';
const listing=names=>names.map(x=>' A..... '+x+' fixture codec').join('\n');
const ready=(command,args)=>({status:0,stdout:args.includes('-encoders')?listing(ENCODERS):args.includes('-decoders')?listing(DECODER_GROUPS.map(x=>x[0])):'tool version'});
test('reuse requires actual tool versions and required encoder/decoder capabilities',()=>{
 const calls=[];const result=provision((c,a,o)=>{calls.push({c,a,o});return ready(c,a)},'linux',()=>{});assert.equal(result,'existing');assert.equal(calls.length,4);assert.ok(calls.every(x=>x.c!=='sudo'&&x.c!=='timeout'));
 assert.equal(probe((c,a)=>a.includes('-decoders')?{status:0,stdout:' A..... mp3 wrong/incomplete'}:ready(c,a)),false);
});
test('missing tools invoke only bounded update/install and then reverify',()=>{
 let installed=false;const apt=[];const result=provision((c,a,o)=>{
  if(c==='timeout'){apt.push({a,o});if(a.includes('install'))installed=true;return {status:0};}
  return installed?ready(c,a):{status:127};
 },'linux',()=>{});assert.equal(result,'installed');assert.equal(apt.length,2);assert.equal(apt[0].o.timeout,200000);assert.equal(apt[1].o.timeout,260000);
});
test('APT options retain signature validation, bounded retries, network and lock limits',()=>{
 const plans=aptPlan();assert.equal(plans[0].command,'timeout');assert.equal(plans[0].args[1],'180s');assert.equal(plans[1].args[1],'240s');
 for(const {args,timeout} of plans){assert.ok(args.includes('Acquire::Retries=2'));assert.ok(args.includes('Acquire::http::Timeout=20'));assert.ok(args.includes('Acquire::https::Timeout=20'));assert.ok(args.includes('DPkg::Lock::Timeout=30'));assert.ok(args.includes('DEBIAN_FRONTEND=noninteractive'));assert.ok(timeout<300000);for(const bad of ['--allow-unauthenticated','--fix-missing','trusted=yes'])assert.equal(args.includes(bad),false);}
});
test('timeout/update/install failures cannot report success or continue to validation',()=>{
 for(const failAt of [1,2]){let apt=0;assert.throws(()=>provision((c)=>c==='timeout'?{status:++apt===failAt?124:0}:{status:127},'linux',()=>{}));assert.equal(apt,failAt);}
 assert.throws(()=>provision(c=>c==='timeout'?{status:null,error:{code:'ETIMEDOUT'}}:{status:127},'linux',()=>{}));
});
test('successful package commands do not replace codec or ffprobe verification',()=>{
 assert.throws(()=>provision(c=>c==='timeout'?{status:0}:{status:127},'linux',()=>{}));
 assert.equal(hasCapabilities(listing(['mp3float','flac']),[['mp3','mp3float'],['flac']]),true);assert.equal(hasCapabilities('text naming libmp3lame but no codec listing',[['libmp3lame']]),false);
});
test('unsupported platform never runs installation or host commands',()=>{
 let calls=0;assert.throws(()=>provision(()=>{calls++;return {status:0}},'win32',()=>{}));assert.equal(calls,0);
});
