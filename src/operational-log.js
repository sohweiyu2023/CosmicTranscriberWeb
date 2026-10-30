import {diagnosticFields,safeCategory} from '../public/js/diagnostic-policy.js';
const ROUTES=new Set(['/api/transcribe','/api/key/test','/api/key/session','/api/key/forget','/api/session/status','/api/admin/overview','/api/admin/users','/api/admin/settings/registration']);
let dropped=0;
// A failed sink must not recurse into another sink or alter billing.
export function safeOperationalLog(event,sink=line=>console.log(line)){
  try{
    const row={...diagnosticFields(event),schema:'cosmic-worker-operational-2',ts:new Date().toISOString(),
      route:ROUTES.has(event.route)?event.route:event.route?.startsWith('/api/admin/users/')?'/api/admin/users/:id':'other',
      category:safeCategory(event.category),droppedBefore:dropped};
    sink(JSON.stringify(row));dropped=0;return true;
  }catch{dropped=Math.min(2147483647,dropped+1);return false}
}
