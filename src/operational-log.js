import {diagnosticFields,safeCategory} from '../public/js/diagnostic-policy.js';
import {admittedProviderFailure} from './provider-failure.js';
const ROUTES=new Set(['/api/transcribe','/api/key/test','/api/key/session','/api/key/forget','/api/session/status','/api/admin/overview','/api/admin/users','/api/admin/settings/registration']);
let dropped=0;
// A failed sink must not recurse into another sink or alter billing.
export function safeOperationalLog(event,sink=line=>console.log(line)){
  try{
    const row={...diagnosticFields(event),schema:'cosmic-worker-operational-2',component:'cosmic-worker',diagnosticsRevision:'sink-confirmation-1',ts:new Date().toISOString(),
      route:ROUTES.has(event.route)?event.route:event.route?.startsWith('/api/admin/users/')?'/api/admin/users/:id':'other',
      category:safeCategory(event.category),droppedBefore:dropped,
      providerExplanation:admittedProviderFailure(event.providerExplanation)};
    const pending=sink(JSON.stringify(row));
    // The production console sink is synchronous. A thenable has no confirmed
    // delivery here: consume rejection and report the event as unconfirmed.
    // Never let a logging rejection escape into successful paid work.
    let nativePromise=false;
    if(pending!=null&&(typeof pending==='object'||typeof pending==='function')){
      // Intrinsic attachment consumes genuine Promise rejections even when a
      // sink shadows its public then property. Plain thenables fail this brand check.
      try{Promise.prototype.then.call(pending,undefined,()=>{});nativePromise=true}catch{}
    }
    if(nativePromise){dropped=Math.min(2147483647,dropped+1);return false}
    if(pending!=null&&(typeof pending==='object'||typeof pending==='function')&&typeof pending.then==='function'){
      Promise.resolve(pending).catch(()=>{});dropped=Math.min(2147483647,dropped+1);return false;
    }
    dropped=0;return true;
  }catch{dropped=Math.min(2147483647,dropped+1);return false}
}
