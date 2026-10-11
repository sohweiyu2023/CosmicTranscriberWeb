import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTransportClassification,classifyTransportFailure,isExplicitUserCancellation} from '../../public/js/transport-policy.js';

test('explicit user abort is distinct from a browser transport abort',()=>{
  const c=new AbortController();c.abort('user cancellation');
  const err=new DOMException('Aborted','AbortError');
  const user=classifyTransportFailure(err,{cancelRequested:true,signal:c.signal,online:true});
  assert.equal(user.code,'user_cancelled');assert.equal(user.userCancelled,true);assert.equal(user.billingAmbiguous,true);
  const transport=classifyTransportFailure(new DOMException('Aborted','AbortError'),{cancelRequested:false,signal:new AbortController().signal,online:true});
  assert.equal(transport.code,'browser_transport_abort');assert.equal(transport.userCancelled,false);assert.equal(transport.billingAmbiguous,true);
});

test('browser TypeError is a diagnosable ambiguous network failure',()=>{
  const e=new TypeError('Failed to fetch');
  const c=applyTransportClassification(e,{cancelRequested:false,signal:new AbortController().signal,online:true});
  assert.equal(c.code,'browser_network_error');assert.equal(e.code,'browser_network_error');assert.equal(isExplicitUserCancellation(e),false);
});

test('offline browser failure is classified separately',()=>assert.equal(classifyTransportFailure(new TypeError('fetch'),{online:false}).code,'browser_offline'));
