import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateReleaseManifest,verifyReleaseProvenance,wranglerReleaseFingerprint} from '../../scripts/deploy-provenance.mjs';
const h=x=>createHash('sha256').update(x).digest('hex');

function wrangler(){return {workers_dev:false,preview_urls:false,env:{
  staging:{vars:{ACCESS_TEAM_DOMAIN:'https://YOUR_TEAM.cloudflareaccess.com',ACCESS_AUDIENCE:'REPLACE_WITH_STAGING_ACCESS_AUD_TAG',ADMIN_EMAILS:'REPLACE_WITH_STAGING_ADMIN_EMAILS',APP_ORIGIN:'https://transcriber-staging.awakeningtoreality.com'},d1_databases:[{binding:'USER_DB',database_name:'cosmic-transcriber-web-staging-users',database_id:'REPLACE_WITH_STAGING_USER_DB_ID',migrations_dir:'migrations'}]},
  production:{vars:{ACCESS_TEAM_DOMAIN:'https://YOUR_TEAM.cloudflareaccess.com',ACCESS_AUDIENCE:'REPLACE_WITH_PRODUCTION_ACCESS_AUD_TAG',ADMIN_EMAILS:'REPLACE_WITH_PRODUCTION_ADMIN_EMAILS',APP_ORIGIN:'https://transcriber.awakeningtoreality.com'},d1_databases:[{binding:'USER_DB',database_name:'cosmic-transcriber-web-production-users',database_id:'REPLACE_WITH_PRODUCTION_USER_DB_ID',migrations_dir:'migrations'}]}
}}}

function validManifest(w=wrangler()){
  return {product:'Cosmic Transcriber Web',version:'1.1.1',releaseReady:true,certificationLevel:'release',dependencyLock:{status:'verified',sha256:'a'.repeat(64),registry:'https://registry.npmjs.org/'},wranglerReleaseFingerprint:wranglerReleaseFingerprint(w)};
}

async function makeTree(){
  const dir=await mkdtemp(path.join(tmpdir(),'cosmic-provenance-'));
  const w=wrangler();
  const pkg='{"name":"cosmic","version":"1.1.1"}\n',src='immutable\n',wranglerText=JSON.stringify(w,null,2)+'\n';
  const manifest=JSON.stringify(validManifest(w))+'\n';
  await Promise.all([writeFile(path.join(dir,'package.json'),pkg),writeFile(path.join(dir,'app.txt'),src),writeFile(path.join(dir,'wrangler.jsonc'),wranglerText),writeFile(path.join(dir,'RELEASE_MANIFEST.json'),manifest)]);
  const sums=[[manifest,'RELEASE_MANIFEST.json'],[pkg,'package.json'],[src,'app.txt'],[wranglerText,'wrangler.jsonc']].map(([v,n])=>`${h(v)}  ${n}`).join('\n')+'\n';
  await writeFile(path.join(dir,'SHA256SUMS.txt'),sums);
  return {dir,w};
}

test('deployment provenance permits only Access/admin-email/D1 identifier values to change after certification',async()=>{
  const initialWrangler=wrangler();
  const valid=validManifest(initialWrangler);
  assert.deepEqual(validateReleaseManifest(valid,'1.1.1'),[]);
  assert.match(validateReleaseManifest({...valid,releaseReady:false},'1.1.1',{targetEnv:'production'}).join(' '),/not final release-certified/i);
  const staging={...valid,releaseReady:false,certificationLevel:'staging'};
  assert.deepEqual(validateReleaseManifest(staging,'1.1.1',{targetEnv:'staging'}),[]);
  assert.match(validateReleaseManifest(staging,'1.1.1',{targetEnv:'production'}).join(' '),/production requires releaseReady:true/i);
  assert.match(validateReleaseManifest({...valid,dependencyLock:{status:'candidate-unverified',sha256:null,registry:'https://registry.npmjs.org/'}},'1.1.1').join(' '),/dependency lock is not verified/i);
  const {dir}=await makeTree();
  try{
    assert.deepEqual(await verifyReleaseProvenance(dir,{packageVersion:'1.1.1'}),[]);
    const filled=structuredClone(initialWrangler);
    filled.env.staging.vars.ACCESS_TEAM_DOMAIN='https://citeledger.cloudflareaccess.com';
    filled.env.staging.vars.ACCESS_AUDIENCE='staging-audience-123456';
    filled.env.staging.vars.ADMIN_EMAILS='admin@example.test';
    filled.env.staging.d1_databases[0].database_id='11111111-1111-4111-8111-111111111111';
    filled.env.production.vars.ACCESS_TEAM_DOMAIN='https://citeledger.cloudflareaccess.com';
    filled.env.production.vars.ACCESS_AUDIENCE='production-audience-123456';
    filled.env.production.vars.ADMIN_EMAILS='admin@example.test,admin2@example.test';
    filled.env.production.d1_databases[0].database_id='22222222-2222-4222-8222-222222222222';
    await writeFile(path.join(dir,'wrangler.jsonc'),JSON.stringify(filled,null,2)+'\n');
    assert.deepEqual(await verifyReleaseProvenance(dir,{packageVersion:'1.1.1'}),[]);
    filled.env.staging.d1_databases[0].database_name='tampered-db';
    await writeFile(path.join(dir,'wrangler.jsonc'),JSON.stringify(filled,null,2)+'\n');
    assert.match((await verifyReleaseProvenance(dir,{packageVersion:'1.1.1'})).join(' '),/Wrangler security\/configuration fingerprint mismatch/i);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('deployment provenance rejects extra uncertified source files',async()=>{
  const {dir}=await makeTree();
  try{
    await writeFile(path.join(dir,'uncertified.txt'),'not in checksum manifest\n');
    assert.match((await verifyReleaseProvenance(dir,{packageVersion:'1.1.1'})).join(' '),/uncertified source file present: uncertified\.txt/i);
  }finally{await rm(dir,{recursive:true,force:true})}
});
