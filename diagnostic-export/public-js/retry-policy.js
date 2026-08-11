export function knownSafeRetry(error){
  return error?.code === "openai_rate_limited" && error?.details?.billingState === "explicit_rejection";
}


export function automaticRetryDelayMs(error,retryNumber,{nowMs=Date.now(),random=Math.random}={}){
  if(!knownSafeRetry(error))return null;
  const raw=error?.details?.retryAfter;
  let minimum=null;
  if(typeof raw==='string'&&raw.trim()){
    const text=raw.trim();
    if(/^\d+(?:\.\d+)?$/.test(text))minimum=Math.ceil(Number(text)*1000);
    else {const when=Date.parse(text);if(Number.isFinite(when))minimum=Math.max(0,when-nowMs)}
    if(minimum!==null&&(!Number.isFinite(minimum)||minimum<0))minimum=null;
    // Do not make the browser appear hung for a long server-requested delay.
    // A long Retry-After stays a safe explicit rejection, but requires the user to retry later.
    if(minimum!==null&&minimum>30_000)return null;
  }
  const n=Math.max(1,Math.min(8,Number.isInteger(retryNumber)?retryNumber:1));
  const fallback=Math.min(8000,1000*2**(n-1));
  const base=minimum===null?fallback:minimum;
  const jitter=Math.floor(Math.max(0,Math.min(1,Number(random())||0))*250);
  return base+jitter;
}

export function ambiguousPaidFailure(error){
  const billing = error?.details?.billingState;
  if (billing === "explicit_rejection") return false;
  if (billing === "ambiguous_after_dispatch" || billing === "completed_or_ambiguous" || billing === "completed_response_not_durable") return true;
  if (["upstream_ambiguous","openai_server_error","upstream_malformed","upstream_response_too_large","audio_stream_limit","upstream_result_invalid","malformed_response"].includes(error?.code)) return true;
  // A browser/network exception without a definitive server error response is conservative:
  // the Worker/OpenAI may have received the upload even though JavaScript did not receive the result.
  if (!error?.status && (!error?.code || error.code === "unknown_error")) return true;
  return false;
}


export function systemicJobFailure(error){
  return ["checkpoint_persist_before_dispatch_failed","checkpoint_persist_after_dispatch_failed","checkpoint_persist_after_success_failed"].includes(error?.code) || ["ambiguous_checkpoint_not_durable","classified_failure_checkpoint_not_durable","completed_response_not_durable"].includes(error?.details?.billingState);
}

export function checkpointResultReusable({status,hasResult,previousContext,chainReusable}){
  if(status !== "completed" || !hasResult) return false;
  return !previousContext || chainReusable;
}

export function checkpointAttemptNeedsConfirmation(status){
  return status === "ambiguous" || status === "in_flight";
}

export function completedResultValidationError(cause){
  const error = new Error("OpenAI returned a completed response, but its transcription payload failed strict validation. Retrying could create a second transcription charge.");
  error.code = "upstream_result_invalid";
  error.details = { billingState: "completed_or_ambiguous" };
  error.cause = cause;
  return error;
}
