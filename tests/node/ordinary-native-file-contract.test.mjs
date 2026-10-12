import test from 'node:test';
import assert from 'node:assert/strict';
import {isOrdinarySafariGenuineFile} from '../safari/ordinary-native-file-contract.mjs';
const expected={size:16941,sha256:'a'.repeat(64),sliceSha256:'b'.repeat(64),mtimeNs:'315532800000000000'};
const valid={isTrusted:true,name:'format.mp3',type:'audio/mpeg',size:16941,bytesRead:16941,sha256:expected.sha256,sliceSha256:expected.sliceSha256,lastModified:315532800000,duration:1};
test('ordinary Safari native picker passes only genuine matching disk identity and duration',()=>assert.equal(isOrdinarySafariGenuineFile(valid,expected),true));
for(const [field,value] of [['isTrusted',false],['name','injected.mp3'],['type',''],['size',99],['bytesRead',0],['sha256','0'.repeat(64)],['sliceSha256','1'.repeat(64)],['lastModified',0],['duration',0],['error','NotReadableError']]){
  test(`ordinary Safari native picker fails closed on ${field}`,()=>assert.equal(isOrdinarySafariGenuineFile({...valid,[field]:value},expected),false));
}
test('ordinary Safari picker rejects a missing native event or source identity',()=>{
 assert.equal(isOrdinarySafariGenuineFile(null,expected),false);
 assert.equal(isOrdinarySafariGenuineFile(valid,null),false);
});
