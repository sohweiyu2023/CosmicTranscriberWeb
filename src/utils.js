const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function utf8(value) { return encoder.encode(value); }
export function decodeUtf8(value) { return decoder.decode(value); }

export function b64urlEncode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function b64urlDecode(value, maxBytes = 16_384) {
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes * 4 / 3) + 8 || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Invalid base64url value");
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  if (binary.length > maxBytes) throw new Error("Decoded value too large");
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomId(prefix = "ctw") {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

export function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const piece of header.split(";")) {
    const trimmed = piece.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

export function constantTimeStringEqual(a, b) {
  const aa = utf8(String(a));
  const bb = utf8(String(b));
  const n = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < n; i++) diff |= (aa[i % (aa.length || 1)] || 0) ^ (bb[i % (bb.length || 1)] || 0);
  return diff === 0;
}

export function safeLogValue(value, max = 180) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").slice(0, max);
}

export async function sha256Base64Url(value) {
  const bytes = typeof value === "string" ? utf8(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return b64urlEncode(new Uint8Array(digest));
}
