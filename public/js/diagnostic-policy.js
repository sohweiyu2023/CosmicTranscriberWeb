// Finite diagnostic vocabulary. Unknown strings are never copied into logs.
const ERROR_CODES = new Set(["access_config_invalid", "access_config_missing", "access_identity_invalid", "access_identity_missing", "access_invalid", "access_required", "account_blocked", "account_inactive", "admin_config_invalid", "admin_required", "admin_status_protected", "ambiguous_retry_answered", "ambiguous_retry_shown", "app_loaded", "assets_binding_missing", "audio_missing", "audio_read_failed", "audio_signature_rejected", "audio_stream_limit", "audio_too_large", "browser_network_error", "browser_offline", "browser_timeout", "browser_transport_abort", "browser_transport_error", "byok_cookie_oversize", "byok_secret_invalid", "byok_secret_missing", "byok_version_invalid", "checkpoint_chunk_reused", "checkpoint_corrupt", "checkpoint_created", "checkpoint_loaded", "checkpoint_persist_after_dispatch_failed", "checkpoint_persist_after_response_failed", "checkpoint_persist_after_success_failed", "checkpoint_persist_before_dispatch_failed", "checkpoint_write_failure_after_dispatch", "checkpoint_write_failure_after_success", "checkpoint_write_failure_before_dispatch", "chunk", "chunk_dispatch_started", "chunk_failure", "chunk_success", "confirmation_answered", "confirmation_required", "confirmation_shown", "content_type_rejected", "dispatch_start", "duplicate_usage_attempt", "file_prepare_error", "file_prepare_started", "file_prepared", "file_run_finished", "file_run_started", "identity_email_mismatch", "identity_reconciliation_failed", "internal_error", "invalid_admin_filter", "invalid_json", "invalid_keywords", "invalid_language", "invalid_metadata", "invalid_prompt", "invalid_registration_mode", "invalid_usage_attempt", "invalid_user_id", "invalid_user_status", "job_cancelled", "job_finished", "job_started", "job_stopped", "key_malformed", "key_session_expired", "key_session_invalid", "key_test_failure", "key_test_success", "malformed_response", "method_not_allowed", "model_parameter_unsupported", "network_offline", "network_online", "openai_authentication_failed", "openai_error", "openai_model_unavailable", "openai_permission_denied", "openai_quota_or_billing", "openai_rate_limited", "openai_request_rejected", "openai_server_error", "operation_finished", "operation_started", "origin_rejected", "preference_failure", "rate_limit_config_missing", "rate_limited", "registration_closed", "registration_pending", "request_complete", "request_failed", "request_too_large", "rerun_completed_answered", "rerun_completed_queued", "rerun_completed_shown", "route_not_found", "session_status_error", "size_mismatch", "success", "unhandled_rejection", "unknown_error", "unknown_event", "unsafe_auth_bypass", "unsupported_audio_format", "unsupported_model", "upstream_ambiguous", "upstream_malformed", "upstream_response_too_large", "upstream_result_invalid", "usage_attempt_dispatch_missing", "usage_attempt_identity_mismatch", "usage_attempt_result_conflict", "usage_job_identity_mismatch", "usage_result_persist_failed", "user_cancel_requested", "user_cancelled", "user_not_found", "user_registry_invalid", "user_registry_unavailable", "visibility_changed", "window_error"]);
const EVENT_CATEGORIES = new Set(["ambiguous_retry_answered", "ambiguous_retry_shown", "app_loaded", "checkpoint_chunk_reused", "checkpoint_corrupt", "checkpoint_created", "checkpoint_loaded", "checkpoint_write_failure_after_dispatch", "checkpoint_write_failure_after_success", "checkpoint_write_failure_before_dispatch", "chunk", "chunk_dispatch_started", "chunk_failure", "chunk_success", "confirmation_answered", "confirmation_shown", "dispatch_start", "file_prepare_error", "file_prepare_started", "file_prepared", "file_run_finished", "file_run_started", "job_cancelled", "job_finished", "job_started", "job_stopped", "key_test_failure", "key_test_success", "network_offline", "network_online", "operation_finished", "operation_started", "preference_failure", "request_complete", "request_failed", "rerun_completed_answered", "rerun_completed_queued", "rerun_completed_shown", "session_status_error", "success", "unhandled_rejection", "unknown_event", "usage_result_persist_failed", "user_cancel_requested", "visibility_changed", "window_error"]);
const MODELS = new Set(['gpt-transcribe','gpt-4o-transcribe','gpt-4o-mini-transcribe','gpt-4o-transcribe-diarize']);
export const enumValue = (value, values, fallback='unknown') => typeof value==='string' && value.length<=80 && values.has(value) ? value : fallback;
export const safeCode = value => enumValue(value, ERROR_CODES, 'unknown_error');
export const safeCategory = value => enumValue(value, EVENT_CATEGORIES, 'unknown_event');
export function safeCorrelation(value) {
  if(typeof value!=='string' || value.length>100)return undefined;
  return /^(?:req|page|run|job|file|f|attempt|keytest-job|keytest-file|keytest-attempt)-(?:[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value) ? value : undefined;
}
export const safeProviderId = value => typeof value==='string' && /^req_[0-9a-f]{3,64}$/i.test(value) ? value : undefined;
export const safeInteger = (value,max=2147483647) => Number.isInteger(value) && value>=0 && value<=max ? value : undefined;
export const safeDuration = value => typeof value==='number' && Number.isFinite(value) && value>=0 && value<=2592000000 ? Math.round(value) : undefined;
const ENUMS={
  accountStatus:new Set(['active','pending','blocked','registration_closed']),
  registrationMode:new Set(['open','approval','closed']),
  transportCode:new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','ABORT_ERR']),
  billingState:new Set(['explicit_rejection','ambiguous_after_dispatch','completed_or_ambiguous','not_dispatched']),
  billingRisk:new Set(['ambiguous','classified']),
  errorName:new Set(['Error','ApiError','TypeError','SyntaxError','AbortError','TimeoutError','SecurityError','QuotaExceededError','InvalidStateError','NotReadableError','NotAllowedError','DataError']),
  causeCategory:new Set(['timeout','caller_abort','redirect','upload_size','transport','body_read','response_limit','malformed_json','html_response','provider_rejection','unknown']),
  providerCode:new Set(['insufficient_quota','rate_limit_exceeded','invalid_api_key','model_not_found','context_length_exceeded','invalid_value','unsupported_value','invalid_request_error','server_error']),
  providerType:new Set(['invalid_request_error','authentication_error','permission_error','rate_limit_error','server_error','insufficient_quota']),
  visibility:new Set(['visible','hidden','prerender']),
  phase:new Set(['prepare','hash','hashing','upload','upload_openai_wait','transcribe','transcription','checkpoint','export','inspect','decode','preflight','dispatch','response','request','accounting','storage']),
  operation:new Set(['read','parse','write','repair','load','save']),
  storageCategory:new Set(['unavailable','quota','malformed','unknown']),
  result:new Set(['finished','success','failed','cancelled','response_received']),
  reason:new Set(['user_requested']), invocation:new Set(['start','rerun_completed']),
  requestKind:new Set(['transcription','key-test']),
  audioFormat:new Set(['mp3','flac','mp4','mpeg','mpga','m4a','ogg','wav','webm'])
};
const NUMBERS=new Set(['chunk','chunkIndex','chunkCount','chunks','attempt','declaredBytes','bytes','files','completed','failed','sameSettings','size','position','totalFiles','completedChunks','ambiguousChunks','leadingBytes','trailingBytes','gapCount','gapBytes','terminalPartialBytes','languageHintCount','keywordCount','chunkMb','maxMinutes']);
const DURATIONS=new Set(['elapsedMs','browserElapsedMs','workerElapsedMs','duration','durationSeconds']);
const BOOLEANS=new Set(['running','online','signalAborted','userCancelled','mixedSettings','cancelRequested','configured','previousContext','includeTimestamps','secureContext','accepted','principalScopeAvailable','isAdmin']);
export function safeDiagnosticField(key,value) {
  if(value===undefined||value===null)return undefined;
  if(ENUMS[key])return enumValue(value,ENUMS[key]);
  if(key==='activePhase')return enumValue(value,ENUMS.phase);
  if(key==='model'||key==='completedModel')return enumValue(value,MODELS);
  if(key==='code'||key==='errorCode')return safeCode(value);
  if(key==='openaiRequestId')return safeProviderId(value);
  if(['requestId','appRequestId','jobId','attemptId','runId','fileRef','ref','pageSessionId'].includes(key))return safeCorrelation(value);
  if(key==='status')return Number.isInteger(value)&&value>=100&&value<=599?value:undefined;
  if(key==='appVersion'||key==='serverVersion')return typeof value==='string'&&/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)?value:undefined;
  if(NUMBERS.has(key))return safeInteger(value);
  if(DURATIONS.has(key))return safeDuration(value);
  if(BOOLEANS.has(key))return typeof value==='boolean'?value:undefined;
  return undefined;
}
export function diagnosticFields(data) {
  const result={};
  // Enumerate known keys only: no traversal of caller objects, arrays or cycles.
  const keys=[...Object.keys(ENUMS),...NUMBERS,...DURATIONS,...BOOLEANS,'activePhase','model','completedModel','code','errorCode','openaiRequestId','requestId','appRequestId','jobId','attemptId','runId','fileRef','ref','pageSessionId','status','appVersion','serverVersion'];
  for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(data||{},key);if(!descriptor||!('value' in descriptor))continue;const value=safeDiagnosticField(key,descriptor.value);if(value!==undefined)result[key]=value;}
  return result;
}
