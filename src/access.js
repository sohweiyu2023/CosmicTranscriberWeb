import { createRemoteJWKSet, jwtVerify } from "jose";
import { ApiError } from "./errors.js";

const jwksCache = new Map();

function normalizeTeamDomain(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || !url.hostname.endsWith(".cloudflareaccess.com") || url.hostname === ".cloudflareaccess.com") {
    throw new ApiError(500, "access_config_invalid", "Cloudflare Access is not configured correctly.");
  }
  return url.origin;
}

function localBypassAllowed(request, env) {
  if (env.LOCAL_AUTH_BYPASS !== "true") return false;
  if (env.DEPLOYMENT_ENV !== "development") throw new ApiError(500, "unsafe_auth_bypass", "Local authentication bypass is forbidden outside development.");
  const url = new URL(request.url);
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
  if (!localHost) throw new ApiError(403, "unsafe_auth_bypass", "Local authentication bypass is restricted to loopback hosts.");
  return true;
}

export async function verifyAccessToken(token, env, verificationKey) {
  if (!env.ACCESS_AUDIENCE || !env.ACCESS_TEAM_DOMAIN) throw new ApiError(500, "access_config_missing", "Cloudflare Access configuration is missing.");
  if (!token || token.length > 16_384) throw new ApiError(401, "access_required", "Cloudflare Access authentication is required.");
  const issuer = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const { payload, protectedHeader } = await jwtVerify(token, verificationKey, {
    issuer,
    audience: env.ACCESS_AUDIENCE,
    algorithms: ["RS256"],
    clockTolerance: 5
  });
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (protectedHeader.alg !== "RS256" || payload.type !== "app" || typeof payload.sub !== "string" || payload.sub.length < 1 || payload.sub.length > 512 || email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) || payload.iat > Math.floor(Date.now() / 1000) + 60) {
    throw new Error("required Access claims missing");
  }
  return { sub: payload.sub, email, country: typeof payload.country === "string" ? payload.country.slice(0, 8) : null, source: "access" };
}

export async function authenticateAccess(request, env) {
  if (localBypassAllowed(request, env)) {
    return { sub: "local-development-user", email: "local-development@example.invalid", country: null, source: "local-bypass" };
  }
  if (!env.ACCESS_AUDIENCE || !env.ACCESS_TEAM_DOMAIN) throw new ApiError(500, "access_config_missing", "Cloudflare Access configuration is missing.");
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 16_384) throw new ApiError(401, "access_required", "Cloudflare Access authentication is required.");

  const issuer = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 });
    jwksCache.set(issuer, jwks);
  }
  try {
    return await verifyAccessToken(token, env, jwks);
  } catch {
    throw new ApiError(401, "access_invalid", "The Cloudflare Access session is invalid or expired.");
  }
}
