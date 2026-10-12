import test from 'node:test';
import assert from 'node:assert/strict';
import {isGenuineDiskRead} from '../safari/disk-access-probe-contract.mjs';
const expected={size:16941,sha256:'a'.repeat(64),sliceSha256:'b'.repeat(64),mtimeNs:'315532800000000000'};
const valid={name:'format.mp3',type:'audio/mpeg',size:16941,bytesRead:16941,sha256:expected.sha256,sliceSha256:expected.sliceSha256,changeCount:1,lastModified:315532800000};
test('native probe accepts only matching real full and slice digests, metadata, and one change',()=>{
  assert.equal(isGenuineDiskRead(valid,expected),true);
});
for(const [field,value] of [
  ['name','wrong.mp3'],['type',''],['size',0],['bytesRead',0],['sha256','c'.repeat(64)],
  ['sliceSha256','d'.repeat(64)],['changeCount',0],['lastModified',0],['error','NotReadableError']
])test(`native disk probe fails closed on ${field} discrepancy`,()=>{
  assert.equal(isGenuineDiskRead({...valid,[field]:value},expected),false);
});
test('native disk probe fails closed without native file or expected disk identity',()=>{
  assert.equal(isGenuineDiskRead(null,expected),false);
  assert.equal(isGenuineDiskRead(valid,null),false);
});
