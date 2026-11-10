import test from 'node:test';
import assert from 'node:assert/strict';
import {safeOperationalLog} from '../../src/operational-log.js';
const secret='PRIVATE_TOKEN raw recording transcript';
const event={route:'/api/transcribe',category:'success',status:200,requestId:'app-'+secret};
test('native rejected Promise with shadowed then is consumed intrinsically',async()=>{
 const seen=[];const handler=e=>seen.push(e);process.on('unhandledRejection',handler);
 try{for(const value of ['throw','nonfunction']){
 const promise=Promise.reject(Error(secret));Object.defineProperty(promise,'then',value==='throw'?{get(){throw Error(secret)}}:{value:123});
 assert.equal(safeOperationalLog(event,()=>promise),false);
 }await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(seen,[]);
 }finally{process.off('unhandledRejection',handler)}
});
test('synchronous sink preserves billing-neutral boolean contract',()=>{
 let line;assert.equal(safeOperationalLog(event,value=>{line=value}),true);
 assert.equal(JSON.parse(line).status,200);assert.equal(line.includes(secret),false);
});
test('synchronous throw cannot escape and subsequent event reports loss',()=>{
 assert.equal(safeOperationalLog(event,()=>{throw Error(secret)}),false);
 let next;assert.equal(safeOperationalLog(event,line=>{next=JSON.parse(line)}),true);assert.ok(next.droppedBefore>=1);
});
test('rejected asynchronous sink is consumed without unhandled rejection',async()=>{
 const observed=[];const handler=e=>observed.push(e);process.on('unhandledRejection',handler);
 try{assert.equal(safeOperationalLog(event,async()=>{throw Error(secret)}),false);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(observed,[]);
 let next;safeOperationalLog(event,line=>{next=JSON.parse(line)});assert.ok(next.droppedBefore>=1);assert.equal(JSON.stringify(next).includes(secret),false);
 }finally{process.off('unhandledRejection',handler)}
});
test('resolved asynchronous sink is conservatively unconfirmed',async()=>{
 assert.equal(safeOperationalLog(event,async()=>{}),false);await new Promise(resolve=>setImmediate(resolve));
});
test('throwing or changing then getters cannot leak or reject unhandled',async()=>{
 assert.equal(safeOperationalLog(event,()=>Object.defineProperty({},'then',{get(){throw Error(secret)}})),false);
 let reads=0;const changing={get then(){if(++reads===1)return ()=>{};throw Error(secret)}};
 assert.equal(safeOperationalLog(event,()=>changing),false);await new Promise(resolve=>setImmediate(resolve));
});
test('raw arbitrary fields and unadmitted provider detail are excluded',()=>{
 let line;assert.equal(safeOperationalLog({...event,privatePayload:secret,providerExplanation:{message:secret}},value=>{line=value}),true);assert.equal(line.includes(secret),false);assert.equal(JSON.parse(line).providerExplanation,undefined);
});
