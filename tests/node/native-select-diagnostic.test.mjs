import test from 'node:test';
import assert from 'node:assert/strict';
import {safeNativeSelectObservation,selectNativeModelWithDiagnostics} from '../e2e/native-select-diagnostic.mjs';
const sample={left:10,top:20,width:120,height:30,viewportWidth:1280,viewportHeight:720,optionCount:4,selectedIndex:0,openDialogs:0,connected:true,disabled:false,hidden:false,displayed:true,visible:true,pointerEventsEnabled:true,focused:false,documentFocused:true,documentComplete:true,fontsLoaded:true,cancelDisabled:true};
test('native-select success preserves one native action and produces no diagnostic',async()=>{
 const calls=[],logs=[];const model={evaluate:async(...args)=>{calls.push(['snapshot',args[2]]);return sample},selectOption:async value=>calls.push(['select',value])};
 await selectNativeModelWithDiagnostics(model,'gpt-transcribe',{emit:x=>logs.push(x)});assert.deepEqual(calls,[['snapshot',{timeout:15000}],['select','gpt-transcribe']]);assert.deepEqual(logs,[]);
});
test('native-select failure emits only allowlisted prior state without another browser request or retry',async()=>{
 const failure=Error('secret credential and private page text'),calls=[],logs=[];
 const model={evaluate:async()=>{calls.push('snapshot');return {...sample,text:'PRIVATE',value:'SECRET',cookie:'TOKEN',url:'PRIVATE_URL'}},selectOption:async()=>{calls.push('select');throw failure}};
 await assert.rejects(()=>selectNativeModelWithDiagnostics(model,'gpt-transcribe',{ordinal:2,emit:x=>logs.push(x)}),e=>e===failure);
 assert.deepEqual(calls,['snapshot','select']);assert.equal(logs.length,1);const d=JSON.parse(logs[0].slice('NATIVE_SELECT_DIAGNOSTIC '.length));assert.equal(d.phase,'select');assert.equal(d.ordinal,2);assert.equal(d.selectionInFlight,true);assert.equal(d.snapshotInFlight,false);assert.deepEqual(d.lastSample,sample);
 for(const privateValue of ['PRIVATE','SECRET','TOKEN','credential','gpt-transcribe'])assert.equal(logs[0].includes(privateValue),false);
});
test('snapshot failure performs no native selection and never probes the browser again',async()=>{
 const failure=Error('snapshot timeout'),calls=[],logs=[];const model={evaluate:async()=>{calls.push('snapshot');throw failure},selectOption:async()=>calls.push('select')};
 await assert.rejects(()=>selectNativeModelWithDiagnostics(model,'gpt-transcribe',{emit:x=>logs.push(x)}),e=>e===failure);assert.deepEqual(calls,['snapshot']);const d=JSON.parse(logs[0].slice('NATIVE_SELECT_DIAGNOSTIC '.length));assert.equal(d.phase,'snapshot');assert.equal(d.snapshotInFlight,true);assert.equal(d.lastSample,null);
 await assert.rejects(()=>selectNativeModelWithDiagnostics(model,'gpt-transcribe',{emit:()=>{throw Error('logger failed')}}),e=>e===failure);
});
test('native-select observations reject unknown/private fields and bound non-finite or malformed values',()=>{
 const safe=safeNativeSelectObservation({...sample,left:Infinity,width:2000000,disabled:'SECRET',text:'SECRET'});assert.equal(safe.left,null);assert.equal(safe.width,1000000);assert.equal(safe.disabled,null);assert.equal('text'in safe,false);assert.equal(JSON.stringify(safe).includes('SECRET'),false);
});
