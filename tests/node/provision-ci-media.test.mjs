import test from 'node:test';
import assert from 'node:assert/strict';
import {provision,probe,aptPlan,ENCODERS,DECODER_GROUPS,hasCapabilities,reviewedMirrorList,preferOfficialMirror,mediaFailureDiagnostic} from '../../scripts/provision-ci-media.mjs';
const hosted={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux'};
const originalMirrors='http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
const noHost={env:{}};
const listing=names=>names.map(x=>' A..... '+x+' fixture codec').join('\n');
const ready=(command,args)=>({status:0,stdout:args.includes('-encoders')?listing(ENCODERS):args.includes('-decoders')?listing(DECODER_GROUPS.map(x=>x[0])):'tool version'});
test('reuse requires actual tool versions and required encoder/decoder capabilities',()=>{
 const calls=[];const result=provision((c,a,o)=>{calls.push({c,a,o});return ready(c,a)},'linux',()=>{},{env:hosted,read:()=>assert.fail('ready toolchain must not read mirror configuration')});assert.equal(result,'existing');assert.equal(calls.length,4);assert.ok(calls.every(x=>x.c!=='sudo'&&x.c!=='timeout'));
 assert.equal(probe((c,a)=>a.includes('-decoders')?{status:0,stdout:' A..... mp3 wrong/incomplete'}:ready(c,a)),false);
});
test('missing tools invoke only bounded update/install and then reverify',()=>{
 let installed=false;const apt=[];const result=provision((c,a,o)=>{
  if(c==='timeout'){apt.push({a,o});if(a.includes('install'))installed=true;return {status:0};}
  return installed?ready(c,a):{status:127};
 },'linux',()=>{},noHost);assert.equal(result,'installed');assert.equal(apt.length,2);assert.equal(apt[0].o.timeout,200000);assert.equal(apt[1].o.timeout,260000);
});
test('APT options retain signature validation, bounded retries, network and lock limits',()=>{
 const plans=aptPlan();assert.equal(plans[0].command,'timeout');assert.equal(plans[0].args[1],'180s');assert.equal(plans[1].args[1],'240s');
 for(const {args,timeout} of plans){assert.ok(args.includes('Acquire::Retries=2'));assert.ok(args.includes('Acquire::http::Timeout=20'));assert.ok(args.includes('Acquire::https::Timeout=20'));assert.ok(args.includes('DPkg::Lock::Timeout=30'));assert.ok(args.includes('DEBIAN_FRONTEND=noninteractive'));assert.ok(timeout<300000);for(const bad of ['--allow-unauthenticated','--fix-missing','trusted=yes'])assert.equal(args.includes(bad),false);}
});
test('timeout/update/install failures cannot report success or continue to validation',()=>{
 for(const failAt of [1,2]){let apt=0;assert.throws(()=>provision((c)=>c==='timeout'?{status:++apt===failAt?124:0}:{status:127},'linux',()=>{},noHost));assert.equal(apt,failAt);}
 assert.throws(()=>provision(c=>c==='timeout'?{status:null,error:{code:'ETIMEDOUT'}}:{status:127},'linux',()=>{},noHost));
});
test('successful package commands do not replace codec or ffprobe verification',()=>{
 assert.throws(()=>provision(c=>c==='timeout'?{status:0}:{status:127},'linux',()=>{},noHost));
 assert.equal(hasCapabilities(listing(['mp3float','flac']),[['mp3','mp3float'],['flac']]),true);assert.equal(hasCapabilities('text naming libmp3lame but no codec listing',[['libmp3lame']]),false);
});
test('unsupported platform never runs installation or host commands',()=>{
 let calls=0;assert.throws(()=>provision(()=>{calls++;return {status:0}},'win32',()=>{}));assert.equal(calls,0);
});

test('only the exact pre-existing official mirror set is reordered, idempotently',()=>{
 const after=reviewedMirrorList(originalMirrors);assert.ok(after.startsWith('https://archive.ubuntu.com/ubuntu/\tpriority:1\n'));
 assert.equal(reviewedMirrorList(after),after);
 for(const text of [originalMirrors.replace('azure.archive.ubuntu.com','unrecognized.example'),originalMirrors.replace('https://archive.ubuntu.com','http://archive.ubuntu.com'),originalMirrors+'https://extra.example/ priority:3\n',originalMirrors.replace('priority:2','priority:1')])assert.throws(()=>reviewedMirrorList(text));
});

test('mirror preference never reads or writes outside identified hosted Linux CI',()=>{
 for(const env of [{},{...hosted,RUNNER_OS:'Windows'},{...hosted,RUNNER_ENVIRONMENT:'self-hosted'},{...hosted,GITHUB_ACTIONS:'false'}]){
  assert.equal(preferOfficialMirror(()=>assert.fail('unexpected command'),{env,read:()=>assert.fail('unexpected read')}),false);
 }
 const calls=[];assert.equal(preferOfficialMirror((...args)=>{calls.push(args);return {status:0}},{env:hosted,read:(file,encoding)=>{assert.equal(file,'/etc/apt/apt-mirrors.txt');assert.equal(encoding,'utf8');return originalMirrors;}}),true);
 assert.equal(calls.length,1);assert.deepEqual(calls[0].slice(0,2),['sudo',['-n','tee','/etc/apt/apt-mirrors.txt']]);assert.equal(calls[0][2].input,reviewedMirrorList(originalMirrors));assert.equal(calls[0][2].timeout,10000);
 assert.equal(preferOfficialMirror(()=>assert.fail('already preferred'),{env:hosted,read:()=>reviewedMirrorList(originalMirrors)}),true);
});

test('unknown mirrors and preference write failure stop before APT or validation',()=>{
 let commands=0;assert.throws(()=>provision(()=>{commands++;return {status:127}},'linux',()=>{},{env:hosted,read:()=>originalMirrors.replace('https://archive.ubuntu.com','https://unknown.example')}));assert.equal(commands,1);
 const calls=[];assert.throws(()=>provision((c)=>{calls.push(c);return {status:127}},'linux',()=>{},{env:hosted,read:()=>originalMirrors}));assert.deepEqual(calls,['ffmpeg','sudo']);
});

test('missing, unreadable and unrecognized mirror evidence has distinct safe causes and never reaches APT',()=>{
 for(const [read,code,phase] of [[()=>{throw Object.assign(Error('synthetic-private-path'),{code:'ENOENT'})},'media_mirror_file_missing','mirror-read'],[()=>{throw Object.assign(Error('synthetic-private-path'),{code:'EACCES'})},'media_mirror_read_failed','mirror-read'],[()=>originalMirrors.replace('archive.ubuntu.com','synthetic-private-mirror.example'),'media_mirror_list_unrecognized','mirror-verify']]){
  let apt=0;try{provision(c=>{if(c==='timeout')apt++;return {status:127}},'linux',()=>{},{env:hosted,read});assert.fail('must reject')}catch(error){const d=mediaFailureDiagnostic(error,{env:{ImageOS:'ubuntu26',ImageVersion:'20261018.50.1'}});assert.equal(d.code,code);assert.equal(d.phase,phase);assert.equal(d.imageVersion,'20261018.50.1');assert.equal(d.validationGateSkipped,false);assert.equal(d.automaticRetry,false);assert.equal(JSON.stringify(d).includes('synthetic-private'),false)}assert.equal(apt,0);
 }
});

test('write, timeout, platform and codec failures remain fail-closed with bounded redacted metadata',()=>{
 const scenarios=[{run:()=>({status:127}),platform:'linux',options:{env:hosted,read:()=>originalMirrors},code:'media_mirror_write_failed',phase:'mirror-write'}, {run:c=>c==='timeout'?{status:124,error:{code:'ETIMEDOUT',message:'synthetic-private-token'}}:{status:127},platform:'linux',options:noHost,code:'media_apt_failed',phase:'apt-update'},{run:()=>({status:0}),platform:'win32',options:noHost,code:'media_platform_rejected',phase:'platform'},{run:c=>c==='timeout'?{status:0}:{status:127},platform:'linux',options:noHost,code:'media_codec_verification_failed',phase:'probe-installed'}];
 for(const s of scenarios){try{provision(s.run,s.platform,()=>{},s.options);assert.fail('must reject')}catch(e){const d=mediaFailureDiagnostic(e);assert.equal(d.code,s.code);assert.equal(d.phase,s.phase);assert.equal(d.provisioningVerified,false);assert.equal(JSON.stringify(d).includes('synthetic-private'),false)}}
 const forged=mediaFailureDiagnostic({mediaCode:'synthetic-private-token',mediaPhase:'synthetic-private-path'},{env:{ImageOS:'synthetic-private',ImageVersion:'synthetic-private'}});assert.equal(forged.code,'media_unknown_failure');assert.equal(forged.imageOS,null);assert.equal(JSON.stringify(forged).includes('synthetic-private'),false);
});

test('mutating a minted Error cannot replace its private diagnostic payload',()=>{
 let owned;try{preferOfficialMirror(()=>({status:0}),{env:hosted,read:()=>{throw Object.assign(Error('synthetic-private-path'),{code:'ENOENT'})}})}catch(error){owned=error}
 assert.ok(owned);Object.assign(owned,{mediaCode:'synthetic-private-token',mediaPhase:'synthetic-private-path',exitCode:'synthetic-private-token',systemCode:'synthetic-private-token',message:'synthetic-private-token'});
 const diagnostic=mediaFailureDiagnostic(owned);assert.equal(diagnostic.code,'media_mirror_file_missing');assert.equal(diagnostic.phase,'mirror-read');assert.equal(diagnostic.systemCode,'ENOENT');assert.equal(diagnostic.exitCode,null);assert.equal(JSON.stringify(diagnostic).includes('synthetic-private'),false);
});
