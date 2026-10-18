// Offline-only transport replacement. This module must be loaded via --import
// in a child process; it never sends network requests or logs credentials.
import {writeFileSync} from 'node:fs';
const scenario=process.env.COSMIC_MOCK_SCENARIO;
const reportFile=process.env.COSMIC_MOCK_LOG;
let paid=0,configured=false,oversizeCancelled=false,declaredOversizeCancelled=false,redirectCancelled=false,nonJsonCancelled=false;
const calls=[];
process.on('exit',()=>writeFileSync(reportFile,JSON.stringify({paid,calls,oversizeCancelled,declaredOversizeCancelled,redirectCancelled,nonJsonCancelled})));
const json=(payload,status=200,headers={})=>new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json',...headers}});
globalThis.fetch=async function(url,options={}){
 const target=new URL(url),route=target.pathname;
 if(target.origin!=='https://transcriber-staging.awakeningtoreality.com')throw Error('Unexpected network origin in offline staging test');
 calls.push({route,method:options.method||'GET',hasAccessHeader:!!options.headers?.['Cf-Access-Token'],hasByokCookie:!!options.headers?.Cookie?.includes('__Host-cosmic_byok=')});
 if(scenario==='redirect'&&route==='/api/session/status')return new Response(new ReadableStream({cancel(){redirectCancelled=true}},{highWaterMark:0}),{status:302,headers:{location:'https://access.invalid/'}});
 if(['non-json-status','json-suffix-status','json-parameter-spoof-status'].includes(scenario)&&route==='/api/session/status'){
  const type=scenario==='json-suffix-status'?'application/jsonp':scenario==='json-parameter-spoof-status'?'text/plain; hint=application/json':'text/html';
  return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({ok:true,version:'1.2.0',account:{status:'active'},principalScope:'active-principal',configured:false})))},cancel(){nonJsonCancelled=true}},{highWaterMark:0}),{status:200,headers:{'content-type':type}});
 }
 if(scenario==='oversized-status'&&route==='/api/session/status'){
  let pulls=0;
  const stream=new ReadableStream({
   pull(controller){
    pulls++;
    if(pulls<=2)controller.enqueue(new Uint8Array(pulls===1?100000:40000).fill(65));
    else controller.error(Error('Oversized response was incorrectly read beyond the safety limit'));
   },
   cancel(){oversizeCancelled=true}
  },{highWaterMark:0});
  return new Response(stream,{status:200,headers:{'content-type':'application/json'}});
 }
 if(scenario==='declared-oversized-status'&&route==='/api/session/status'){
  const stream=new ReadableStream({cancel(){declaredOversizeCancelled=true}},{highWaterMark:0});
  return new Response(stream,{status:200,headers:{'content-type':'application/json','content-length':'140000'}});
 }
 if(scenario==='invalid-utf8-status'&&route==='/api/session/status')
  return new Response(new Uint8Array([0xff,0xfe]),{status:200,headers:{'content-type':'application/json'}});

 if(route==='/api/session/status')return json({ok:true,version:'1.2.0',account:{status:'active'},principalScope:'active-principal',configured});
 if(route==='/api/key/session'){
  configured=true;
  const attrs=scenario==='session-no-path'?'Secure; HttpOnly; SameSite=Strict; Max-Age=28800'
   :scenario==='session-domain'?'Path=/; Domain=awakeningtoreality.com; Secure; HttpOnly; SameSite=Strict; Max-Age=28800'
   :scenario==='session-expired'?'Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'
   :scenario==='session-duplicate-path'?'Path=/; Path=/elsewhere; Secure; HttpOnly; SameSite=Strict; Max-Age=28800'
   :scenario==='session-too-long'?'Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=999999'
   :'Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800';
  return json({ok:true,configured:true},200,{'set-cookie':'__Host-cosmic_byok='+('A'.repeat(100))+'; '+attrs});
 }
 if(route==='/api/transcribe'){
  paid++;
  if(scenario==='midstream-access-redirect'&&paid===5)return new Response('',{status:302,headers:{location:'https://access.invalid/login'}});
  if(scenario==='midstream-timeout'&&paid===5)throw new DOMException('Simulated ambiguous network timeout','TimeoutError');
  if((scenario==='fifth-failure'||scenario==='cleanup-failure'||scenario==='forget-no-expiry')&&paid===5)return json({ok:false,error:{code:'upstream_failed'}},502);
  const meta=JSON.parse(Buffer.from(options.headers['x-cosmic-metadata'],'base64url').toString());
  const result=meta.audioFormat==='wav'
   ?{text:'Two speakers take turns.',segments:[{speaker:'A',start:0,end:2,text:'Speaker A.'},{speaker:'B',start:3,end:5,text:'Speaker B.'}]}
   :{text:'Mock transcription result.'};
  if(scenario==='one-speaker'&&meta.audioFormat==='wav')result.segments[1].speaker='A';
  if(scenario==='nonwav-empty-transcript'&&meta.audioFormat==='mp3')result.text='';
  if(scenario==='nonwav-short-transcript'&&meta.audioFormat==='mp3')result.text='Yes';
  if(scenario==='wav-out-of-range'&&meta.audioFormat==='wav')result.segments[1].end=meta.durationSeconds+30;
  if(scenario==='wav-out-of-order'&&meta.audioFormat==='wav'){result.segments[0].start=4;result.segments[0].end=5;result.segments[1].start=3;result.segments[1].end=6;}
  return json({ok:true,result,diagnostics:{openaiRequestId:'mock'}});
 }
 if(route==='/api/key/forget'){
  if(scenario==='midstream-access-redirect')return new Response('',{status:302,headers:{location:'https://access.invalid/login'}});
  if(scenario==='cleanup-failure')return json({ok:false,error:{code:'cleanup_rejected'}},503);
  configured=false;
  const expiry=(scenario==='forget-no-expiry'||scenario==='all-pass-no-expiry')?'3600':'0';
  const clear='__Host-cosmic_byok=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+expiry;
  if(scenario==='all-pass-forget-duplicate-cookie'){
   const headers=new Headers({'content-type':'application/json'});
   headers.append('set-cookie',clear);
   headers.append('set-cookie','__Host-cosmic_byok='+('B'.repeat(100))+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800');
   return new Response(JSON.stringify({ok:true,configured:false}),{status:200,headers});
  }
  if(scenario==='all-pass-forget-duplicate-path')return json({ok:true,configured:false},200,{'set-cookie':clear+'; Path=/elsewhere'});
  if(scenario==='all-pass-forget-domain')return json({ok:true,configured:false},200,{'set-cookie':clear+'; Domain=awakeningtoreality.com'});
  return json({ok:true,configured:false},200,{'set-cookie':clear});
 }
 throw Error('Unexpected route in offline staging test: '+route);
};
