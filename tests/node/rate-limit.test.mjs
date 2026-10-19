import test from "node:test";
import assert from "node:assert/strict";
import {rateLimit} from "../../src/rate-limit.js";

test("rate limiting fails closed outside development when its binding is missing",async()=>{
  await assert.rejects(()=>rateLimit({DEPLOYMENT_ENV:"production"},"RL_TRANSCRIBE",{sub:"u"},"transcribe"),e=>e?.code==="rate_limit_config_missing");
  await rateLimit({DEPLOYMENT_ENV:"development"},"RL_TRANSCRIBE",{sub:"u"},"transcribe");
});

test("rate limiter uses a privacy-preserving derived key and enforces rejection",async()=>{
  let seen;
  const env={DEPLOYMENT_ENV:"production",RL_TRANSCRIBE:{limit:async x=>{seen=x.key;return {success:false}}}};
  await assert.rejects(()=>rateLimit(env,"RL_TRANSCRIBE",{sub:"person@example.invalid"},"transcribe"),e=>e?.code==="rate_limited");
  assert.equal(typeof seen,"string");assert.ok(seen.length>20);assert.equal(seen.includes("person@example.invalid"),false);
});
