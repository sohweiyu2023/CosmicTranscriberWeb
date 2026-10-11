import test from 'node:test';
import assert from 'node:assert/strict';
import {compatibleCheckpoint} from '../../public/js/checkpoint-identity.js';

const h1='1'.repeat(64),h2='2'.repeat(64);
function chunks(){return [
  {index:1,sourceStart:100,sourceEnd:1000,bytes:900,sha256:h1},
  {index:2,sourceStart:1000,sourceEnd:1800,bytes:800,sha256:h2}
]}
function checkpoint(){return {principalScope:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',sourceFingerprint:'sha256:a',sourceSize:1800,settingsIdentity:'settings-a',audioFormat:'mp3',processingRevision:'rev-a',chunks:chunks()}}
function wanted(patch={}){return {principalScope:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',sourceFingerprint:'sha256:a',sourceSize:1800,settingsIdentity:'settings-a',audioFormat:'mp3',processingRevision:'rev-a',chunks:chunks(),...patch}}

test('checkpoint exact source/settings/format/chunk identity matches',()=>assert.equal(compatibleCheckpoint(checkpoint(),wanted()),true));
test('checkpoint refuses source fingerprint and size mismatch',()=>{assert.equal(compatibleCheckpoint(checkpoint(),wanted({sourceFingerprint:'sha256:b'})),false);assert.equal(compatibleCheckpoint(checkpoint(),wanted({sourceSize:1801})),false)});
test('checkpoint refuses settings/model-language identity mismatch',()=>assert.equal(compatibleCheckpoint(checkpoint(),wanted({settingsIdentity:'settings-b'})),false));
test('checkpoint refuses format/revision/boundary/byte/hash changes',()=>{assert.equal(compatibleCheckpoint(checkpoint(),wanted({audioFormat:'wav'})),false);assert.equal(compatibleCheckpoint(checkpoint(),wanted({processingRevision:'rev-b'})),false);const moved=chunks();moved[1]={...moved[1],sourceStart:999};assert.equal(compatibleCheckpoint(checkpoint(),wanted({chunks:moved})),false);const resized=chunks();resized[0]={...resized[0],bytes:899};assert.equal(compatibleCheckpoint(checkpoint(),wanted({chunks:resized})),false);const rehashed=chunks();rehashed[0]={...rehashed[0],sha256:'3'.repeat(64)};assert.equal(compatibleCheckpoint(checkpoint(),wanted({chunks:rehashed})),false)});
test('checkpoint refuses missing/malformed chunk records',()=>{assert.equal(compatibleCheckpoint({...checkpoint(),chunks:null},wanted()),false);assert.equal(compatibleCheckpoint({...checkpoint(),chunks:[{index:1,sourceStart:100,sourceEnd:1000,bytes:'900'},chunks()[1]]},wanted()),false)});
test('checkpoint refuses reuse across authenticated Access principals',()=>assert.equal(compatibleCheckpoint(checkpoint(),wanted({principalScope:'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'})),false));
