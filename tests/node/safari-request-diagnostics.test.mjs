import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestDiagnostics,safeRequestDiagnostics,safeProcessDiagnostics} from '../safari/local-request-diagnostics.mjs';
import {sanitizeSafariAcceptanceReport} from '../safari/safari-report-sanitize.mjs';
const secret='PRIVATE-CANARY-AUDIO-TOKEN';
test('session timeout retains phase and command without payload',()=>{
 const d=createRequestDiagnostics();d.phase('driver_session');const t=d.begin('http://127.0.0.1:5555/session?token='+secret,'POST');t.end(Object.assign(new Error(secret),{name:'TimeoutError'}));
 const persisted=JSON.parse(JSON.stringify(sanitizeSafariAcceptanceReport({status:'FAIL',platform:'darwin',error:secret,requestDiagnostics:d.snapshot()})));
 assert.equal(persisted.requestDiagnostics.firstFailure.command,'driver_session_create');assert.equal(persisted.requestDiagnostics.firstFailure.phase,'driver_session');assert.equal(persisted.requestDiagnostics.firstFailure.errorType,'TimeoutError');assert.equal(persisted.requestDiagnostics.firstFailure.httpStatus,null);assert.ok(!JSON.stringify(persisted).includes(secret));assert.equal(persisted.status,'FAIL');assert.equal(persisted.capabilities.browserName,'OTHER');
});
test('HTTP protocol failure preserves safe facts and first failure through cleanup',()=>{
 const d=createRequestDiagnostics();d.phase('driver_session');let t=d.begin('http://localhost/session','POST');t.response(500,'session not created');t.end(new Error(secret));d.phase('cleanup');t=d.begin('http://localhost/session/'+secret,'DELETE');t.response(200);t.end();const s=d.snapshot();assert.equal(s.firstFailure.httpStatus,500);assert.equal(s.firstFailure.protocolError,'session not created');assert.equal(s.last.command,'driver_session_delete');assert.ok(!JSON.stringify(s).includes(secret));
});
test('readiness probes do not replace the decisive failure',()=>{
 const d=createRequestDiagnostics();let t=d.begin('http://localhost/status','GET',true);t.end(new TypeError(secret));assert.equal(d.snapshot().firstFailure,null);d.phase('app_shell');t=d.begin('http://localhost/session/'+secret+'/url','POST');t.end(new Error(secret));assert.equal(d.snapshot().firstFailure.command,'driver_navigation');assert.equal(d.snapshot().requestCount,2);
});
test('non JSON and interrupted response retain observed status only',()=>{
 for(const error of [new SyntaxError('<html>'+secret),new TypeError(secret)]){const d=createRequestDiagnostics();const t=d.begin('http://localhost/session','POST');t.response(502);t.end(error);assert.equal(d.snapshot().firstFailure.httpStatus,502);assert.equal(d.snapshot().firstFailure.protocolError,'unavailable');assert.ok(!JSON.stringify(d.snapshot()).includes(secret))}
});
test('projection excludes hostile fields, nesting, prose, unknown codes and getter failures',()=>{
 const value={phase:secret,requestCount:Infinity,last:{phase:secret,command:secret,httpStatus:999,errorType:secret,protocolError:secret,elapsedMs:-1,body:secret},firstFailure:null,rawOutput:secret};Object.defineProperty(value,'firstFailure',{get(){throw new Error(secret)}});value.cycle=value;
 const s=safeRequestDiagnostics(value);assert.equal(s.phase,'unknown');assert.equal(s.last.command,'other');assert.equal(s.last.httpStatus,null);assert.equal(s.last.elapsedMs,null);assert.equal(s.firstFailure,null);assert.ok(!JSON.stringify(s).includes(secret));
});
test('snapshot is detached and bounded, command URL identifiers are omitted',()=>{
 const d=createRequestDiagnostics();for(const [suffix,cmd] of [['/timeouts','driver_timeouts'],['/execute/async','driver_execute'],['/element/'+secret+'/value','driver_element'],['/cookie','driver_cookie'],['/unknown/'+secret,'other']]){let t=d.begin('http://localhost/session/'+secret+suffix,'POST');t.response(200,secret);t.end();assert.equal(d.snapshot().last.command,cmd)}const s=d.snapshot();s.last.command=secret;assert.notEqual(d.snapshot().last.command,secret);assert.ok(!JSON.stringify(d.snapshot()).includes(secret));assert.equal(d.snapshot().requestCount,5);
});

test('native fixture reports remain serializable with optional diagnostics',()=>{
 const d=createRequestDiagnostics();const result=sanitizeSafariAcceptanceReport({status:'FAIL',platform:'darwin',fixtures:[{native:{isFile:true,error:'NotReadableError: The I/O read operation failed.'}}],requestDiagnostics:d.snapshot(),failurePhase:'driver_session',processDiagnostics:{driverExitCode:0,serverExitCode:null}});
 assert.equal(result.fixtures[0].native.isFile,true);assert.equal(result.fixtures[0].native.error,'NotReadableError: The I/O read operation failed.');assert.equal(result.failurePhase,'driver_session');assert.equal(result.processDiagnostics.driverExitCode,0);assert.equal(JSON.parse(JSON.stringify(result)).status,'FAIL');
});

test('changing getters cannot substitute secrets after validation',()=>{
 const fixture={phase:'driver_session',command:'driver_session_create',httpStatus:500,elapsedMs:2,errorType:'TimeoutError',protocolError:'timeout'};
 const changing={};for(const [key,val] of Object.entries(fixture)){let calls=0;Object.defineProperty(changing,key,{get(){return ++calls===1?val:secret}})}
 let phaseReads=0;const root={get phase(){return ++phaseReads===1?'driver_session':secret},last:changing};const s=safeRequestDiagnostics(root);assert.equal(s.last.command,'driver_session_create');assert.ok(!JSON.stringify(s).includes(secret));
 let reads=0;assert.deepEqual(safeProcessDiagnostics({get driverExitCode(){return ++reads===1?0:secret},serverExitCode:999999}),{driverExitCode:0,serverExitCode:null});
});
test('readiness error facts survive later cleanup commands',()=>{
 const d=createRequestDiagnostics();d.phase('driver_startup');let t=d.begin('http://localhost/status','GET',true);t.response(503);t.end(new TypeError(secret));d.phase('cleanup');t=d.begin('http://localhost/session/'+secret,'DELETE');t.response(200);t.end();const s=d.snapshot();assert.equal(s.lastReadinessFailure.phase,'driver_startup');assert.equal(s.lastReadinessFailure.httpStatus,503);assert.equal(s.firstFailure,null);assert.ok(!JSON.stringify(s).includes(secret));
});
