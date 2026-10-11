export function classifyTransportFailure(error,{cancelRequested=false,signal=null,online=true}={}){
  const status=Number.isInteger(error?.status)?error.status:null;
  const signalAborted=!!signal?.aborted;
  const userCancelled=!!cancelRequested&&signalAborted;
  if(userCancelled)return {code:'user_cancelled',userCancelled:true,billingAmbiguous:true,signalAborted:true};
  if(error?.name==='AbortError')return {code:'browser_transport_abort',userCancelled:false,billingAmbiguous:true,signalAborted};
  if(!status&&error?.name==='TypeError')return {code:online?'browser_network_error':'browser_offline',userCancelled:false,billingAmbiguous:true,signalAborted};
  if(!status&&(!error?.code||error.code==='unknown_error'))return {code:online?'browser_transport_error':'browser_offline',userCancelled:false,billingAmbiguous:true,signalAborted};
  return {code:error?.code||null,userCancelled:false,billingAmbiguous:false,signalAborted};
}

export function applyTransportClassification(error,context={}){
  const classification=classifyTransportFailure(error,context);
  if(error&&typeof error==='object'){
    if(classification.code&&(!error.code||error.code==='unknown_error'||classification.userCancelled))error.code=classification.code;
    error.ctwUserCancelled=classification.userCancelled;
    error.ctwTransport=classification;
  }
  return classification;
}

export function isExplicitUserCancellation(error,{cancelRequested=false}={}){
  return !!cancelRequested||error?.ctwUserCancelled===true||error?.code==='user_cancelled';
}
