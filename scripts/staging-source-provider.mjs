// Pure preparation/response component. No fetch, credentials or execution permit.
import {createHash} from 'node:crypto';
import {PLAN,FIXTURES} from './staging-source-admission.mjs';
import {speechWavDuration,assertSpeechDiarization,assertSpeechTranscription} from './staging-paid-audio.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const mime=Object.freeze({mp3:'audio/mpeg',flac:'audio/flac',mp4:'audio/mp4',mpeg:'audio/mpeg',mpga:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',wav:'audio/wav',webm:'audio/webm'});
const fail=code=>{const e=Error('Provider component rejected');e.code=code;throw e};
const need=(v,c)=>{if(!v)fail(c)};
const fixtureFor=format=>{const f=FIXTURES.find(f=>f.format===format);need(f,'provider_fixture_unknown');return f};
export function prepareSourceProviderRequestComponent({runId,claim,format,bytes}){
 const f=fixtureFor(format),slot=FIXTURES.indexOf(f)+11;
 need(typeof runId==='string'&&/^[1-9][0-9]{0,19}$/.test(runId),'provider_run_invalid');
 need(Buffer.isBuffer(bytes)||bytes instanceof Uint8Array,'provider_fixture_bytes_required');
 const copy=Buffer.from(bytes);need(copy.length===f.bytes&&hash(copy)===f.sha256,'provider_fixture_changed');
 if(format==='wav')need(speechWavDuration(copy)===f.durationSeconds,'provider_wav_duration_changed');
 const attemptId='attempt-'+hash(PLAN.campaign+'|'+runId+'|'+slot+'|'+f.sha256).slice(0,24);
 need(claim?.slot===slot&&claim?.format===format&&claim?.model===f.model&&claim?.maximumMicroUsd===f.reservationMicroUsd&&claim?.attemptId===attemptId,'provider_claim_mismatch');
 const metadata={v:2,audioFormat:format,jobId:'source-'+runId,fileId:'fixture-'+format,attemptId,chunkIndex:1,chunkCount:1,declaredBytes:f.bytes,durationSeconds:f.durationSeconds,model:f.model,languages:[],keywords:[],prompt:'',requestKind:'transcription'};
 return Object.freeze({schema:'cosmic-source-provider-preparation-1',url:PLAN.origin+'/api/transcribe',method:'POST',headers:Object.freeze({'content-type':mime[format],'x-cosmic-metadata':Buffer.from(JSON.stringify(metadata)).toString('base64url')}),body:copy,source:PLAN.source,format,model:f.model,slot,maximumMicroUsd:f.reservationMicroUsd,automaticRetry:false,admission:false,releaseReady:false});
}
export function parseSourceProviderResponseComponent({format,httpStatus,contentType,responseBytes}){
 const f=fixtureFor(format);
 const uncertain=code=>Object.freeze({accepted:false,requestIdPresent:false,definitiveDenial:false,code,format,model:f.model,billingState:'uncertain',reservationReleased:false,automaticRetry:false,fullAcceptance:false,releaseReady:false});
 if(!Number.isInteger(httpStatus)||httpStatus<100||httpStatus>599)return uncertain('worker_status_unknown');
 // An error/redirect is never proof that the provider did not execute.
 if(httpStatus<200||httpStatus>=300)return uncertain(httpStatus>=300&&httpStatus<400?'access_redirect':'worker_http_rejected');
 if(typeof contentType!=='string'||contentType.split(';',1)[0].trim().toLowerCase()!=='application/json')return uncertain('worker_not_json');
 if(!(Buffer.isBuffer(responseBytes)||responseBytes instanceof Uint8Array))return uncertain('worker_response_missing');
 if(responseBytes.byteLength>131072)return uncertain('worker_response_oversized');
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(responseBytes))}catch{return uncertain('worker_response_invalid_json')}
 if(body?.ok!==true||!body.result||typeof body.result!=='object')return uncertain('worker_response_unrecognized');
 const id=body.diagnostics?.openaiRequestId;
 if(typeof id!=='string'||id.length<1||id.length>128||/[\s\x00-\x1f]/.test(id))return uncertain('provider_request_id_missing');
 try{
  const count=format==='wav'?assertSpeechDiarization(body.result,f.durationSeconds):assertSpeechTranscription(body.result);
  return Object.freeze({accepted:true,requestIdPresent:true,definitiveDenial:false,format,model:f.model,...(format==='wav'?{speakerCount:count.speakers,segmentCount:count.segments}:{speechWordCount:count.wordCount}),invoiceVerified:false,reservationReleased:false,automaticRetry:false,fullAcceptance:false,releaseReady:false});
 }catch{return uncertain('provider_speech_invalid')}
}

// Explicit transport/session-header ports only. No global fetch, environment
// credential reads, BYOK creation, default launcher or admission permit.
export function createSourceDispatchTransportComponent({runId,send,getSessionHeaders,diagnostics,timeoutMs=90000}={}){
 need(typeof runId==='string'&&/^[1-9][0-9]{0,19}$/.test(runId),'provider_run_invalid');
 need(typeof send==='function'&&typeof getSessionHeaders==='function'&&Number.isInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=90000,'provider_transport_ports_invalid');
 const used=new Set();let inFlight=false,stopped=false;
 const emit=(result,errorCategory,httpStatus=null)=>{try{diagnostics?.record({operation:'source-acceptance',phase:'dispatch',result,errorCategory,httpStatus,reconciliationRequired:result!=='success'})}catch{}};
 const authHeaders=value=>{
  const token=value?.authHeader||'',access=value?.accessCookie||'',byok=value?.byokCookie;
  need(typeof token==='string'&&typeof access==='string'&&typeof byok==='string','provider_session_headers_invalid');
  need(token.length<=16384&&access.length<=16401&&byok.length<=3820,'provider_session_headers_invalid');
  need((!!token)!=(!!access),'provider_session_headers_invalid');
  if(token)need(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token),'provider_session_headers_invalid');
  if(access)need(/^CF_Authorization=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(access),'provider_session_headers_invalid');
  need(/^__Host-cosmic_byok=[A-Za-z0-9_-]{61,3800}$/.test(byok),'provider_session_headers_invalid');
  return {Cookie:[access,byok].filter(Boolean).join('; '),...(token?{'Cf-Access-Token':token}:{})};
 };
 const uncertain=(format,code,transportInvoked)=>Object.freeze({accepted:false,requestIdPresent:false,definitiveDenial:false,format,model:fixtureFor(format).model,code,transportInvoked,billingState:'uncertain',reservationReleased:false,automaticRetry:false,fullAcceptance:false,releaseReady:false});
 return Object.freeze({
  async dispatch({claim,fixture,bytes}){
   need(!stopped&&!inFlight,'provider_transport_stopped');
   const prepared=prepareSourceProviderRequestComponent({runId,claim,format:fixture?.format,bytes});
   need(!used.has(claim.attemptId),'provider_transport_duplicate');used.add(claim.attemptId);inFlight=true;
   const abort=new AbortController();let timer,response,reader,transportInvoked=false,timedOut=false;
   const cancelBody=()=>{try{const pending=reader?reader.cancel():response?.body?.cancel();Promise.resolve(pending).catch(()=>{})}catch{}};
   emit('started','none');
   const operation=(async()=>{
    let credentials;try{credentials=await getSessionHeaders({signal:abort.signal})}catch{fail('provider_session_headers_unavailable')}
    need(!abort.signal.aborted,'provider_transport_timeout');const privateHeaders=authHeaders(credentials);
    // No await between the final abort check and invoking this one transport.
    need(!abort.signal.aborted,'provider_transport_timeout');transportInvoked=true;
    try{response=await send(prepared.url,{method:'POST',body:prepared.body,headers:{...prepared.headers,...privateHeaders,Origin:PLAN.origin},redirect:'manual',signal:abort.signal})}catch{fail(abort.signal.aborted?'provider_transport_timeout':'provider_transport_failed')}
    if(abort.signal.aborted){cancelBody();fail('provider_transport_timeout')}
    const status=response?.status,type=response?.headers?.get('content-type');
    if(!Number.isInteger(status)||status<200||status>=300){cancelBody();return uncertain(prepared.format,status>=300&&status<400?'access_redirect':'worker_http_rejected',true)}
    if(typeof type!=='string'||type.split(';',1)[0].trim().toLowerCase()!=='application/json'){cancelBody();return uncertain(prepared.format,'worker_not_json',true)}
    const declared=response.headers.get('content-length');if(declared!==null&&/^\d+$/.test(declared)&&Number(declared)>131072){cancelBody();return uncertain(prepared.format,'worker_response_oversized',true)}
    reader=response.body?.getReader();if(!reader)return uncertain(prepared.format,'worker_response_missing',true);
    const chunks=[];let count=0,done=false;
    try{
     while(true){const item=await reader.read();need(!abort.signal.aborted,'provider_transport_timeout');if(item.done){done=true;break}if(!(item.value instanceof Uint8Array))fail('provider_response_stream_invalid');count+=item.value.byteLength;if(count>131072)fail('provider_response_oversized');chunks.push(Buffer.from(item.value))}
    }catch{cancelBody();fail(abort.signal.aborted?'provider_transport_timeout':'provider_response_read_uncertain')}
    finally{if(!done)cancelBody();try{reader.releaseLock()}catch{}}
    return Object.freeze({...parseSourceProviderResponseComponent({format:prepared.format,httpStatus:status,contentType:type,responseBytes:Buffer.concat(chunks)}),transportInvoked:true});
   })();
   let outcome;
   try{outcome=await Promise.race([operation,new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;abort.abort();cancelBody();resolve(uncertain(prepared.format,'provider_transport_timeout',transportInvoked))},timeoutMs)})])}
   catch{outcome=uncertain(prepared.format,abort.signal.aborted?'provider_transport_timeout':transportInvoked?'provider_transport_failed':'provider_session_unavailable',transportInvoked)}
   finally{clearTimeout(timer);abort.abort();inFlight=false}
   if(!outcome.accepted)stopped=true;
   emit(outcome.accepted?'success':timedOut?'timeout':'unknown',outcome.accepted?'none':timedOut?'timeout':outcome.code==='access_redirect'?'access_redirect':'unknown',Number.isInteger(response?.status)?response.status:null);
   return outcome;
  },
  snapshot(){return Object.freeze({schema:'cosmic-source-transport-component-1',attempts:used.size,inFlight,stopped,automaticRetry:false,admission:false,releaseReady:false})}
 });
}
