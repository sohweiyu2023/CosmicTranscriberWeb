#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const tool=path.join(import.meta.dirname,'v12-batch3-prebilling-hardening.mjs');
const argv=process.argv.slice(2);
function arg(name){const i=argv.indexOf(name);return i>=0?argv[i+1]:undefined;}
const sourceRoot=path.resolve(arg('--root')||'/mnt/data/CosmicTranscriberWeb-1.2.0-dev');
const integrationRel='tests/integration/worker.test.js';
const auditRel='scripts/audit-lib.mjs';
const mutationRel='scripts/mutation-suite.mjs';
const markers=[
  'rejects malformed direct-format audio before paid dispatch and leaves the attempt reusable',
  'rejects direct-format MIME mismatch before paid dispatch and leaves the attempt reusable',
  'rejects oversized direct-format metadata before paid dispatch and leaves the attempt reusable',
  'Worker direct-format validation precedes paid-dispatch receipt and has zero-dispatch integration proof',
  'bypass Worker direct-format body validation before paid dispatch'
];
let passed=0;const total=8;
function ok(cond,label){if(!cond){console.error(`FAIL: ${label}`);process.exit(1);}passed++;console.log(`PASS: ${label}`);}
function run(root){return spawnSync(process.execPath,[tool,'--root',root],{encoding:'utf8'});}
function copyThree(root){for(const rel of [integrationRel,auditRel,mutationRel]){const dest=path.join(root,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(sourceRoot,rel),dest);}}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ctw-b3-hardening-'));
try{
  const clean=path.join(tmp,'clean');copyThree(clean);
  const sentinel="\n  it('OFFICIAL_BATCH2_SENTINEL_PRESERVE_ME',()=>{expect(true).toBe(true);});";
  const iPath=path.join(clean,integrationRel);
  let originalIntegration=fs.readFileSync(iPath,'utf8');
  const close='\n});\n';
  if(!originalIntegration.endsWith(close))throw new Error('fixture integration terminator missing');
  originalIntegration=originalIntegration.slice(0,-close.length)+sentinel+close;
  fs.writeFileSync(iPath,originalIntegration);
  const originalAudit=fs.readFileSync(path.join(clean,auditRel),'utf8');
  const originalMutation=fs.readFileSync(path.join(clean,mutationRel),'utf8');

  const first=run(clean);
  ok(first.status===0,'clean/sentinel-bearing source accepts additive hardening');
  const hardenedIntegration=fs.readFileSync(iPath,'utf8');
  const hardenedAudit=fs.readFileSync(path.join(clean,auditRel),'utf8');
  const hardenedMutation=fs.readFileSync(path.join(clean,mutationRel),'utf8');
  ok(hardenedIntegration.includes('OFFICIAL_BATCH2_SENTINEL_PRESERVE_ME')&&hardenedIntegration.startsWith(originalIntegration.slice(0,-close.length))&&hardenedIntegration.endsWith(close),'existing integration content including simulated official Batch2 test is preserved');
  ok(markers.slice(0,3).every(m=>hardenedIntegration.includes(m))&&hardenedAudit.includes(markers[3])&&hardenedMutation.includes(markers[4]),'all five hardening markers are inserted');
  ok(hardenedAudit.startsWith(originalAudit.slice(0,originalAudit.indexOf('\n  ];\n}\n')))&&hardenedMutation.startsWith(originalMutation.slice(0,originalMutation.indexOf('\n];\n\nconst baselineFailures = '))),'audit and mutation edits are additive before exact structural anchors');

  const beforeSecond=[hardenedIntegration,hardenedAudit,hardenedMutation];
  const second=run(clean);
  const afterSecond=[fs.readFileSync(iPath,'utf8'),fs.readFileSync(path.join(clean,auditRel),'utf8'),fs.readFileSync(path.join(clean,mutationRel),'utf8')];
  ok(second.status===0&&beforeSecond.every((x,i)=>x===afterSecond[i]),'fully hardened source is idempotent and byte-stable');

  const partial=path.join(tmp,'partial');copyThree(partial);
  fs.appendFileSync(path.join(partial,integrationRel),`\n// ${markers[0]}\n`);
  const partialRun=run(partial);
  ok(partialRun.status===1&&partialRun.stderr.includes('partial prior application'),'partial prior application fails closed');

  const badAnchor=path.join(tmp,'bad-anchor');copyThree(badAnchor);
  const mPath=path.join(badAnchor,mutationRel);
  fs.writeFileSync(mPath,fs.readFileSync(mPath,'utf8').replace('\n];\n\nconst baselineFailures = ','\n// removed mutation anchor\nconst baselineFailures = '));
  const badRun=run(badAnchor);
  ok(badRun.status===1&&badRun.stderr.includes('anchor count'),'missing/ambiguous structural anchor fails closed');

  const noSource=path.join(tmp,'missing');fs.mkdirSync(noSource);
  const missingRun=run(noSource);
  ok(missingRun.status===1&&missingRun.stderr.includes('is not a regular file'),'missing target source fails closed');

  console.log(`V1.2 Batch3 prebilling-hardening self-test: ${passed}/${total} PASS`);
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
