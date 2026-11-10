// Server-only diagnostic facts. Untrusted provider prose is NEVER retained.
const admitted=new WeakSet(),byError=new WeakMap();
const CHILD_KEYS=['error','errors','details','cause','innererror'];
const TEXT_KEYS=['message','detail','description','reason'];
const FIELD_VALUES={
 code:new Set(['invalid_api_key','invalid_request','invalid_value','invalid_parameter','unsupported_parameter','unsupported_value','invalid_request_error','authentication_error','permission_denied','rate_limit_exceeded','insufficient_quota','model_not_found','context_length_exceeded','server_error','service_unavailable','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','EPIPE','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT']),
 type:new Set(['invalid_request_error','authentication_error','permission_error','rate_limit_error','server_error','api_error','insufficient_quota']),
 param:new Set(['model','response_format','language','prompt','temperature','timestamp_granularities','chunking_strategy','file','stream','include']),
 name:new Set(['Error','TypeError','AbortError','TimeoutError','AggregateError','RangeError','SyntaxError','URIError']),
};
const MAX_FACTS=16,MAX_NODES=32,MAX_DEPTH=4,MAX_ARRAY_ITEMS=8;
const BODY_KINDS=new Set(['json','plain_text','html','transport','interrupted','oversize']);
const ERROR_NAMES=new Map([[Error.prototype,'Error'],[TypeError.prototype,'TypeError'],[RangeError.prototype,'RangeError'],[SyntaxError.prototype,'SyntaxError'],[URIError.prototype,'URIError'],[AggregateError.prototype,'AggregateError']]);
export function captureProviderFailure(value,options={}){
 const facts=[],ancestors=new WeakSet();let nodes=0,omitted=0,prose=0,unknown=0,truncated=false,unavailable=false,cycle=false;
 const slot=(object,key)=>{
  try{const d=Object.getOwnPropertyDescriptor(object,key);if(!d)return {found:false};if(!('value'in d)){unavailable=true;return {found:true,unreadable:true}}return {found:true,value:d.value}}
  catch{unavailable=true;return {found:true,unreadable:true}}
 };
 const kind=options&&typeof options==='object'?slot(options,'bodyKind'):{};
 const bodyKind=typeof kind.value==='string'&&BODY_KINDS.has(kind.value)?kind.value:'unknown';
 unavailable||=kind.unreadable||['html','interrupted','oversize'].includes(bodyKind);
 const omit=(text=false)=>{omitted++;if(text)prose++};
 const add=(path,field,v)=>{
  if(facts.length>=MAX_FACTS){truncated=true;return}
  facts.push(Object.freeze({path,field,value:v}));
 };
 const visit=(node,path,depth)=>{
  if(depth>MAX_DEPTH||nodes>=MAX_NODES){truncated=true;return}nodes++;
  if(typeof node==='string'){omit(true);return}
  if(!node||typeof node!=='object')return;
  if(ancestors.has(node)){cycle=true;truncated=true;return}ancestors.add(node);
  try{
  let array;try{array=Array.isArray(node)}catch{unavailable=true;return}
  if(array){
   const length=slot(node,'length');if(length.unreadable||!Number.isSafeInteger(length.value)||length.value<0){unavailable=true;return}
   if(length.value>MAX_ARRAY_ITEMS)truncated=true;
   for(let i=0;i<Math.min(length.value,MAX_ARRAY_ITEMS);i++){const v=slot(node,String(i));if(!v.unreadable&&v.found)visit(v.value,`${path}[]`,depth+1)}
   return;
  }
  // Probe only fixed keys: never enumerate/copy arbitrary keys or invoke getters.
  for(const field of Object.keys(FIELD_VALUES)){
   const v=slot(node,field);if(!v.found||v.unreadable||v.value===undefined||v.value===null)continue;
   if(typeof v.value==='string'&&FIELD_VALUES[field].has(v.value))add(path,field,v.value);
   else{unknown++;omit()}
  }
  if(!slot(node,'name').found){try{const name=ERROR_NAMES.get(Object.getPrototypeOf(node));if(name)add(path,'name',name)}catch{unavailable=true}}
  for(const field of ['status','statusCode']){
   const v=slot(node,field);if(!v.found||v.unreadable||v.value===undefined||v.value===null)continue;
   if(Number.isInteger(v.value)&&v.value>=100&&v.value<=599)add(path,field,v.value);else{unknown++;omit()}
  }
  for(const key of TEXT_KEYS){const v=slot(node,key);if(v.found&&!v.unreadable&&v.value!==undefined&&v.value!==null)omit(true)}
  for(const key of CHILD_KEYS){const v=slot(node,key);if(v.found&&!v.unreadable)visit(v.value,`${path}.${key}`,depth+1)}
  }finally{ancestors.delete(node)}
 };
 try{if(!['html','interrupted','oversize'].includes(bodyKind))visit(value,'error',0)}catch{unavailable=true}
 const result=Object.freeze({schema:'cosmic-provider-explanation-2',component:'openai-transcription',endpoint:'https://api.openai.com/v1/audio/transcriptions',bodyKind,
  facts:Object.freeze(facts),prosePolicy:'omitted-unconditionally',proseFieldsObserved:prose,proseRetained:false,
  proseOmissionReason:'untrusted-provider-prose-may-contain-private-payload',otherProperties:'not-inspected-or-retained',unknownStructuredFields:unknown,
  omittedFields:omitted,redacted:omitted>0||['html','interrupted','oversize'].includes(bodyKind),truncated,cycleDetected:cycle,unavailable:!!unavailable,missing:facts.length===0,
  completeProviderExplanation:false,completeSelectedDetails:false,privacyScope:'fixed-vocabulary-structured-facts-only',rawBodyRetained:false});
 admitted.add(result);return result;
}
export function attachProviderFailure(error,evidence){try{if(error&&typeof error==='object'&&admitted.has(evidence))byError.set(error,evidence)}catch{}return error}
export function providerFailureFor(error){try{return byError.get(error)}catch{return undefined}}
export function admittedProviderFailure(value){return admitted.has(value)?value:undefined}
