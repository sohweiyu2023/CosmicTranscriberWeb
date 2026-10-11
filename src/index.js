import { authenticateAccess } from "./access.js";
import { clearCredentialCookie, createCredentialSession, readCredentialSession } from "./byok.js";
import { COOKIE_NAME, MODEL_ALLOWLIST_REVISION, MODELS, PRICING_LAST_VERIFIED } from "./config.js";
import { ApiError, errorToSafeJson } from "./errors.js";
import { dispatchTranscription, safeOperationalLog } from "./openai.js";
import { readAndValidateAudioBody } from "./audio-formats.js";
import { rateLimit } from "./rate-limit.js";
import { getKeyTestMp3 } from "./test-audio.js";
import { jsonResponse, randomId, sha256Base64Url } from "./utils.js";
import { decodeMetadataHeader, readSmallJson, validateApiKey, validateAudioRequestHeaders, validateOrigin, validateTranscriptionMetadata } from "./validation.js";
import { adminListUsers, adminOverview, adminSetRegistrationMode, adminSetUserStatus, recordTranscriptionDispatch, recordTranscriptionResult, requireActiveAccount, requireAdminAccount, resolveUserAccount } from "./user-registry.js";


const STATIC_SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin"
});
function staticCsp(isHttps) {
  return `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; manifest-src 'none'; media-src 'self' blob:; worker-src 'none'${isHttps ? '; upgrade-insecure-requests' : ''}`;
}
async function authenticatedAssetResponse(request, env) {
  if (!env.ASSETS?.fetch) throw new ApiError(500, "assets_binding_missing", "Static assets are not configured.");
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) headers.set(name, value);
  const isHttps = new URL(request.url).protocol === "https:";
  headers.set("Content-Security-Policy", staticCsp(isHttps));
  if (isHttps) headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains"); else headers.delete("Strict-Transport-Security");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function setCookieHeader(response, value) {
  if (!value) return response;
  const headers = new Headers(response.headers); headers.append("Set-Cookie", value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function principalHash(sub, env) { const origin=new URL(env.APP_ORIGIN).origin; return (await sha256Base64Url(`ctw-user|${origin}|${sub}`)).slice(0, 16); }
async function checkpointPrincipalScope(principal, env) {
  const origin = new URL(env.APP_ORIGIN).origin;
  return (await sha256Base64Url(`ctw-checkpoint-scope|${origin}|${principal.sub}`)).slice(0, 32);
}

function method(request, expected) {
  if (request.method !== expected) throw new ApiError(405, "method_not_allowed", `Use ${expected} for this route.`);
}

function publicAccount(account) {
  return {
    status: account.status,
    email: account.email,
    isAdmin: account.isAdmin === true,
    registrationMode: account.registrationMode,
    createdAt: account.createdAt ?? null,
    lastSeenAt: account.lastSeenAt ?? null
  };
}

async function statusRoute(request, env, principal, account) {
  method(request, "GET");
  const principalScope = await checkpointPrincipalScope(principal, env);
  const accountInfo = publicAccount(account);
  if (!(account.isAdmin || account.status === "active")) {
    return setCookieHeader(jsonResponse({ ok: true, configured: false, principalScope, account: accountInfo, version: env.APP_VERSION, modelAllowlistRevision: MODEL_ALLOWLIST_REVISION, pricingLastVerified: PRICING_LAST_VERIFIED }), clearCredentialCookie());
  }
  try {
    const session = await readCredentialSession(request, principal, env, { renew: true });
    return setCookieHeader(jsonResponse({ ok: true, configured: true, expiresAt: session.expiresAt, absoluteExpiresAt: session.absoluteExpiresAt, principalScope, account: accountInfo, version: env.APP_VERSION, modelAllowlistRevision: MODEL_ALLOWLIST_REVISION, pricingLastVerified: PRICING_LAST_VERIFIED }), session.renewal);
  } catch (e) {
    if (e instanceof ApiError && (e.code === "key_session_invalid" || e.code === "key_session_expired")) {
      return setCookieHeader(jsonResponse({ ok: true, configured: false, principalScope, account: accountInfo, version: env.APP_VERSION, modelAllowlistRevision: MODEL_ALLOWLIST_REVISION, pricingLastVerified: PRICING_LAST_VERIFIED }), clearCredentialCookie());
    }
    throw e;
  }
}

async function createKeyRoute(request, env, principal) {
  method(request, "POST"); validateOrigin(request, env); await rateLimit(env, "RL_KEY_SESSION", principal, "key-session");
  const body = await readSmallJson(request, 2048);
  for (const key of Object.keys(body)) if (key !== "apiKey") throw new ApiError(400, "invalid_json", "Request contains an unsupported field.");
  const key = validateApiKey(body.apiKey);
  const created = await createCredentialSession(key, principal, env);
  return setCookieHeader(jsonResponse({ ok: true, configured: true, expiresAt: created.expiresAt, absoluteExpiresAt: created.absoluteExpiresAt }), created.setCookie);
}

async function forgetKeyRoute(request, env, principal) {
  method(request, "DELETE"); validateOrigin(request, env); await rateLimit(env, "RL_KEY_SESSION", principal, "key-forget");
  return setCookieHeader(jsonResponse({ ok: true, configured: false, note: "This browser cookie was cleared. If key compromise is suspected, revoke or rotate the OpenAI key at OpenAI." }), clearCredentialCookie());
}

async function testKeyRoute(request, env, principal) {
  method(request, "POST"); validateOrigin(request, env); await rateLimit(env, "RL_KEY_TEST", principal, "key-test");
  const body = await readSmallJson(request, 2048);
  for (const key of Object.keys(body)) if (key !== "confirmMinimalUsage") throw new ApiError(400, "invalid_json", "Request contains an unsupported field.");
  if (body.confirmMinimalUsage !== true) throw new ApiError(400, "confirmation_required", "Confirm that the tiny transcription-permission test may incur minimal OpenAI API usage.");
  const session = await readCredentialSession(request, principal, env, { renew: true });
  const audio = getKeyTestMp3();
  const metadata = validateTranscriptionMetadata({
    v: 1, jobId: randomId("keytest-job"), fileId: randomId("keytest-file"), chunkIndex: 1, chunkCount: 1,
    attemptId: randomId("keytest-attempt"), declaredBytes: audio.byteLength, durationSeconds: 0.25, model: "gpt-transcribe",
    languages: [], keywords: [], prompt: "", requestKind: "key-test"
  });
  const result = await dispatchTranscription({ requestBody: new Blob([audio], { type: "audio/mpeg" }).stream(), metadata, apiKey: session.apiKey });
  const response = jsonResponse({ ok: true, permitted: true, diagnostics: result.diagnostics });
  return setCookieHeader(response, session.renewal);
}

const RESULT_ACCOUNTING_RETRY_DELAYS_MS = Object.freeze([0, 75, 250]);

async function persistTranscriptionResultWithRetry(env, principal, metadata, success, logContext) {
  let lastError;
  for (const delayMs of RESULT_ACCOUNTING_RETRY_DELAYS_MS) {
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    try {
      await recordTranscriptionResult(env, principal, metadata, { success });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  safeOperationalLog({ ...logContext, status: 500, category: "usage_result_persist_failed" });
  // Keep this background accounting failure isolated from the already-classified
  // paid transcription response. Throwing here makes waitUntil surface the task
  // failure to Workers observability without changing the client response.
  throw lastError;
}

function scheduleTranscriptionResult(ctx, env, principal, metadata, success, logContext) {
  const task = persistTranscriptionResultWithRetry(env, principal, metadata, success, logContext);
  if (ctx?.waitUntil) {
    ctx.waitUntil(task);
    return;
  }
  // Non-Workers harnesses should not create an unhandled floating promise.
  task.catch(() => {});
}

async function transcribeRoute(request, env, principal, requestId, ctx) {
  method(request, "POST"); validateOrigin(request, env); await rateLimit(env, "RL_TRANSCRIBE", principal, "transcribe");
  const metadata = decodeMetadataHeader(request);
  if (metadata.requestKind !== "transcription") throw new ApiError(400, "invalid_metadata", "This route accepts transcription requests only.");
  validateAudioRequestHeaders(request, metadata);
  const session = await readCredentialSession(request, principal, env, { renew: true });
  const verifiedAudio = await readAndValidateAudioBody(request, metadata);
  const user = await principalHash(principal.sub, env);
  const started = Date.now();
  await recordTranscriptionDispatch(env, principal, metadata);
  safeOperationalLog({ route: "/api/transcribe", requestId, user, jobId: metadata.jobId, attemptId: metadata.attemptId, requestKind: metadata.requestKind, model: metadata.model, chunkIndex: metadata.chunkIndex, chunkCount: metadata.chunkCount, declaredBytes: metadata.declaredBytes, category: "dispatch_start", elapsedMs: 0 });
  try {
    const result = await dispatchTranscription({ requestBody: new Blob([verifiedAudio]).stream(), metadata, apiKey: session.apiKey, signal: request.signal });
    safeOperationalLog({ route: "/api/transcribe", requestId, user, jobId: metadata.jobId, attemptId: metadata.attemptId, requestKind: metadata.requestKind, model: metadata.model, chunkIndex: metadata.chunkIndex, chunkCount: metadata.chunkCount, declaredBytes: metadata.declaredBytes, status: 200, category: "success", openaiRequestId: result.diagnostics.openaiRequestId, elapsedMs: Date.now() - started });
    scheduleTranscriptionResult(ctx, env, principal, metadata, true, { route: "/api/transcribe", requestId, user, jobId: metadata.jobId, attemptId: metadata.attemptId, requestKind: metadata.requestKind, model: metadata.model, chunkIndex: metadata.chunkIndex, chunkCount: metadata.chunkCount, declaredBytes: metadata.declaredBytes });
    return setCookieHeader(jsonResponse({ ok: true, result: result.result, diagnostics: { ...result.diagnostics, appRequestId: requestId } }), session.renewal);
  } catch (error) {
    const details = error instanceof ApiError ? error.details : undefined;
    safeOperationalLog({ route: "/api/transcribe", requestId, user, jobId: metadata.jobId, attemptId: metadata.attemptId, requestKind: metadata.requestKind, model: metadata.model, chunkIndex: metadata.chunkIndex, chunkCount: metadata.chunkCount, declaredBytes: metadata.declaredBytes, status: error?.status || 502, category: error?.code || "unknown", openaiRequestId: details?.openaiRequestId, elapsedMs: Date.now() - started });
    scheduleTranscriptionResult(ctx, env, principal, metadata, false, { route: "/api/transcribe", requestId, user, jobId: metadata.jobId, attemptId: metadata.attemptId, requestKind: metadata.requestKind, model: metadata.model, chunkIndex: metadata.chunkIndex, chunkCount: metadata.chunkCount, declaredBytes: metadata.declaredBytes });
    throw error;
  }
}

async function adminRoute(request, env, principal, account, url) {
  requireAdminAccount(account);
  await rateLimit(env, "RL_ADMIN", principal, "admin");
  if (url.pathname === "/api/admin/overview") {
    method(request, "GET");
    return jsonResponse({ ok: true, ...(await adminOverview(env)) });
  }
  if (url.pathname === "/api/admin/users") {
    method(request, "GET");
    const status = url.searchParams.get("status") || "all";
    const limit = Number(url.searchParams.get("limit") || 100);
    const offset = Number(url.searchParams.get("offset") || 0);
    return jsonResponse({ ok: true, ...(await adminListUsers(env, { status, limit, offset })) });
  }
  if (url.pathname === "/api/admin/settings/registration") {
    method(request, "PUT");
    validateOrigin(request, env);
    const body = await readSmallJson(request, 1024);
    for (const key of Object.keys(body)) if (key !== "mode") throw new ApiError(400, "invalid_json", "Request contains an unsupported field.");
    return jsonResponse({ ok: true, ...(await adminSetRegistrationMode(env, account, body.mode)) });
  }
  if (url.pathname.startsWith("/api/admin/users/")) {
    method(request, "PATCH");
    validateOrigin(request, env);
    let userId;
    try { userId = decodeURIComponent(url.pathname.slice("/api/admin/users/".length)); } catch { throw new ApiError(400, "invalid_user_id", "User identifier is malformed."); }
    const body = await readSmallJson(request, 1024);
    for (const key of Object.keys(body)) if (key !== "status") throw new ApiError(400, "invalid_json", "Request contains an unsupported field.");
    return jsonResponse({ ok: true, ...(await adminSetUserStatus(env, account, userId, body.status)) });
  }
  throw new ApiError(404, "route_not_found", "Admin API route not found.");
}

export default {
  async fetch(request, env, ctx) {
    const requestId = randomId("req");
    const url = new URL(request.url);
    try {
      const principal = await authenticateAccess(request, env);
      if (!url.pathname.startsWith("/api/")) return await authenticatedAssetResponse(request, env);
      const account = await resolveUserAccount(env, principal);
      if (url.pathname === "/api/session/status") return await statusRoute(request, env, principal, account);
      if (url.pathname.startsWith("/api/admin/")) return await adminRoute(request, env, principal, account, url);
      if (url.pathname === "/api/key/forget") return await forgetKeyRoute(request, env, principal);
      requireActiveAccount(account);
      if (url.pathname === "/api/key/session") return await createKeyRoute(request, env, principal);
      if (url.pathname === "/api/key/test") return await testKeyRoute(request, env, principal);
      if (url.pathname === "/api/transcribe") return await transcribeRoute(request, env, principal, requestId, ctx);
      throw new ApiError(404, "route_not_found", "API route not found.");
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      const response = jsonResponse(errorToSafeJson(error, requestId), status);
      if (error instanceof ApiError && ["key_session_invalid", "key_session_expired"].includes(error.code)) return setCookieHeader(response, clearCredentialCookie());
      return response;
    }
  }
};
