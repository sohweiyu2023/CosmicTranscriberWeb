import test from 'node:test';
import assert from 'node:assert/strict';
import {ambiguousPaidFailure,automaticRetryDelayMs,checkpointAttemptNeedsConfirmation,checkpointResultReusable,completedResultValidationError,knownSafeRetry,systemicJobFailure} from '../../public/js/retry-policy.js';

test('only explicit OpenAI rate-limit rejection is known-safe automatic retry',()=>{assert.equal(knownSafeRetry({code:'openai_rate_limited',details:{billingState:'explicit_rejection'}}),true);assert.equal(knownSafeRetry({code:'openai_server_error',details:{billingState:'ambiguous_after_dispatch'}}),false)});
test('network loss, malformed post-dispatch response and oversized upstream result are ambiguous',()=>{for(const e of [{},{code:'malformed_response',status:200},{code:'upstream_response_too_large',details:{billingState:'completed_or_ambiguous'}},{code:'openai_server_error',details:{billingState:'ambiguous_after_dispatch'}}])assert.equal(ambiguousPaidFailure(e),true)});
test('explicit authentication/permission rejection is not mislabeled billable ambiguous',()=>{assert.equal(ambiguousPaidFailure({code:'openai_authentication_failed',status:401,details:{billingState:'explicit_rejection'}}),false);assert.equal(ambiguousPaidFailure({code:'openai_permission_denied',status:403,details:{billingState:'explicit_rejection'}}),false)});
test('restored in-flight or ambiguous checkpoint cannot silently resend',()=>{assert.equal(checkpointAttemptNeedsConfirmation('in_flight'),true);assert.equal(checkpointAttemptNeedsConfirmation('ambiguous'),true);assert.equal(checkpointAttemptNeedsConfirmation('pending'),false);assert.equal(checkpointAttemptNeedsConfirmation('completed'),false)});
test('invalid completed response is marked completed-or-ambiguous',()=>{const e=completedResultValidationError(new Error('bad segments'));assert.equal(e.code,'upstream_result_invalid');assert.equal(e.details.billingState,'completed_or_ambiguous');assert.equal(ambiguousPaidFailure(e),true)});


test('checkpoint result reuse requires completed status and a valid context chain',()=>{
  const base={hasResult:true,previousContext:false,chainReusable:true};
  assert.equal(checkpointResultReusable({...base,status:'completed'}),true);
  for(const status of ['in_flight','ambiguous','pending'])assert.equal(checkpointResultReusable({...base,status}),false);
  assert.equal(checkpointResultReusable({status:'completed',hasResult:true,previousContext:true,chainReusable:false}),false);
  assert.equal(checkpointResultReusable({status:'completed',hasResult:true,previousContext:true,chainReusable:true}),true);
});


test('rate-limit retry honors bounded Retry-After and otherwise uses jittered exponential backoff',()=>{
  const rate={code:'openai_rate_limited',details:{billingState:'explicit_rejection',retryAfter:'2'}};
  assert.equal(automaticRetryDelayMs(rate,1,{nowMs:0,random:()=>0}),2000);
  const date={code:'openai_rate_limited',details:{billingState:'explicit_rejection',retryAfter:'Thu, 01 Jan 1970 00:00:03 GMT'}};
  assert.equal(automaticRetryDelayMs(date,1,{nowMs:1000,random:()=>0}),2000);
  const noHeader={code:'openai_rate_limited',details:{billingState:'explicit_rejection'}};
  assert.equal(automaticRetryDelayMs(noHeader,3,{nowMs:0,random:()=>0.5}),4125);
  const long={code:'openai_rate_limited',details:{billingState:'explicit_rejection',retryAfter:'31'}};
  assert.equal(automaticRetryDelayMs(long,1,{nowMs:0,random:()=>0}),null);
  assert.equal(automaticRetryDelayMs({code:'openai_server_error',details:{billingState:'ambiguous_after_dispatch'}},1,{random:()=>0}),null);
});

test('completed response whose checkpoint was not durable is never treated as safe to resend',()=>assert.equal(ambiguousPaidFailure({code:'checkpoint_persist_after_success_failed',details:{billingState:'completed_response_not_durable'}}),true));

test('any billing-critical checkpoint persistence failure is a systemic job stop',()=>{for(const e of [{code:'checkpoint_persist_before_dispatch_failed'},{code:'checkpoint_persist_after_dispatch_failed'},{code:'checkpoint_persist_after_success_failed'},{details:{billingState:'ambiguous_checkpoint_not_durable'}},{details:{billingState:'classified_failure_checkpoint_not_durable'}},{details:{billingState:'completed_response_not_durable'}}])assert.equal(systemicJobFailure(e),true);assert.equal(systemicJobFailure({code:'invalid_mp3'}),false)});
