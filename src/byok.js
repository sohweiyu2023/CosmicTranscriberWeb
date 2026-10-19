import {
  APP_SCHEMA, COOKIE_MAX_CHARS, COOKIE_NAME, SESSION_ABSOLUTE_SECONDS,
  SESSION_RENEW_THRESHOLD_SECONDS, SESSION_SLIDING_SECONDS
} from "./config.js";
import { ApiError } from "./errors.js";
import { b64urlDecode, b64urlEncode, decodeUtf8, getCookie, randomId, utf8 } from "./utils.js";

function parseMasterKey(secret, label) {
  if (typeof secret !== "string" || !secret) throw new ApiError(500, "byok_secret_missing", `${label} is not configured.`);
  let bytes;
  try { bytes = b64urlDecode(secret, 64); } catch { throw new ApiError(500, "byok_secret_invalid", `${label} is not valid base64url.`); }
  if (bytes.byteLength !== 32) throw new ApiError(500, "byok_secret_invalid", `${label} must decode to exactly 32 bytes.`);
  return bytes;
}

async function importMasterKey(secret, label) {
  return crypto.subtle.importKey("raw", parseMasterKey(secret, label), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function aad(env, sub, keyVersion) {
  const origin = new URL(env.APP_ORIGIN).origin;
  return utf8(`cosmic-transcriber-web|byok|${APP_SCHEMA}|${origin}|${sub}|${keyVersion}`);
}

function cookieAttributes(maxAge) {
  return `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
}

export function clearCredentialCookie() {
  return `${COOKIE_NAME}=; ${cookieAttributes(0)}`;
}

export async function createCredentialSession(apiKey, principal, env, nowSeconds = Math.floor(Date.now() / 1000)) {
  const version = String(env.BYOK_KEY_VERSION_CURRENT || "").trim();
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(version)) throw new ApiError(500, "byok_version_invalid", "Credential encryption key version is invalid.");
  const key = await importMasterKey(env.BYOK_SESSION_MASTER_KEY_CURRENT, "BYOK_SESSION_MASTER_KEY_CURRENT");
  const absoluteExp = nowSeconds + SESSION_ABSOLUTE_SECONDS;
  const exp = Math.min(nowSeconds + SESSION_SLIDING_SECONDS, absoluteExp);
  const payload = {
    s: APP_SCHEMA,
    k: apiKey,
    iat: nowSeconds,
    exp,
    abs: absoluteExp,
    sid: randomId("ks"),
    sub: principal.sub,
    kv: version
  };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(env, principal.sub, version), tagLength: 128 }, key, utf8(JSON.stringify(payload)));
  const envelope = b64urlEncode(utf8(JSON.stringify({ v: APP_SCHEMA, kv: version, iv: b64urlEncode(iv), ct: b64urlEncode(new Uint8Array(ciphertext)) })));
  if (envelope.length > COOKIE_MAX_CHARS) throw new ApiError(500, "byok_cookie_oversize", "Encrypted credential session exceeds the safe cookie size.");
  return { envelope, expiresAt: exp, absoluteExpiresAt: absoluteExp, sessionId: payload.sid, setCookie: `${COOKIE_NAME}=${envelope}; ${cookieAttributes(exp - nowSeconds)}` };
}

function parseEnvelope(raw) {
  if (!raw || raw.length > COOKIE_MAX_CHARS) throw new ApiError(401, "key_session_invalid", "The API-key session is missing or invalid.");
  try {
    const obj = JSON.parse(decodeUtf8(b64urlDecode(raw, 4096)));
    if (!obj || obj.v !== APP_SCHEMA || typeof obj.kv !== "string" || typeof obj.iv !== "string" || typeof obj.ct !== "string") throw new Error();
    const iv = b64urlDecode(obj.iv, 32); const ct = b64urlDecode(obj.ct, 4096);
    if (iv.byteLength !== 12 || ct.byteLength < 17) throw new Error();
    return { ...obj, iv, ct };
  } catch {
    throw new ApiError(401, "key_session_invalid", "The API-key session is malformed or invalid.");
  }
}

async function decryptWith(secret, label, envelope, principal, env) {
  const key = await importMasterKey(secret, label);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: envelope.iv, additionalData: aad(env, principal.sub, envelope.kv), tagLength: 128 }, key, envelope.ct);
  const payload = JSON.parse(decodeUtf8(new Uint8Array(plain)));
  if (!payload || payload.s !== APP_SCHEMA || payload.kv !== envelope.kv || payload.sub !== principal.sub || typeof payload.k !== "string" || typeof payload.iat !== "number" || typeof payload.exp !== "number" || typeof payload.abs !== "number" || typeof payload.sid !== "string") throw new Error("invalid payload");
  return payload;
}

export async function readCredentialSession(request, principal, env, { renew = true, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  const envelope = parseEnvelope(getCookie(request, COOKIE_NAME));
  const currentVersion = String(env.BYOK_KEY_VERSION_CURRENT || "").trim();
  const previousVersion = String(env.BYOK_KEY_VERSION_PREVIOUS || "").trim();
  let payload; let usedPrevious = false;
  try {
    if (envelope.kv === currentVersion) {
      payload = await decryptWith(env.BYOK_SESSION_MASTER_KEY_CURRENT, "BYOK_SESSION_MASTER_KEY_CURRENT", envelope, principal, env);
    } else if (previousVersion && envelope.kv === previousVersion && env.BYOK_SESSION_MASTER_KEY_PREVIOUS) {
      payload = await decryptWith(env.BYOK_SESSION_MASTER_KEY_PREVIOUS, "BYOK_SESSION_MASTER_KEY_PREVIOUS", envelope, principal, env);
      usedPrevious = true;
    } else {
      throw new Error("unknown key version");
    }
  } catch {
    throw new ApiError(401, "key_session_invalid", "The API-key session could not be authenticated.");
  }
  if (payload.exp <= nowSeconds || payload.abs <= nowSeconds || payload.iat > nowSeconds + 60 || payload.abs - payload.iat > SESSION_ABSOLUTE_SECONDS + 60) {
    throw new ApiError(401, "key_session_expired", "The API-key session has expired.");
  }

  let renewal = null;
  let effectiveExpiresAt = payload.exp;
  if (renew && (usedPrevious || payload.exp - nowSeconds <= SESSION_RENEW_THRESHOLD_SECONDS)) {
    const version = currentVersion;
    const master = await importMasterKey(env.BYOK_SESSION_MASTER_KEY_CURRENT, "BYOK_SESSION_MASTER_KEY_CURRENT");
    const exp = Math.min(nowSeconds + SESSION_SLIDING_SECONDS, payload.abs);
    const renewed = { ...payload, exp, kv: version };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(env, principal.sub, version), tagLength: 128 }, master, utf8(JSON.stringify(renewed)));
    const raw = b64urlEncode(utf8(JSON.stringify({ v: APP_SCHEMA, kv: version, iv: b64urlEncode(iv), ct: b64urlEncode(new Uint8Array(ciphertext)) })));
    if (raw.length <= COOKIE_MAX_CHARS) {
      renewal = `${COOKIE_NAME}=${raw}; ${cookieAttributes(exp - nowSeconds)}`;
      effectiveExpiresAt = exp;
    }
  }
  return { apiKey: payload.k, sessionId: payload.sid, expiresAt: effectiveExpiresAt, absoluteExpiresAt: payload.abs, renewal };
}
