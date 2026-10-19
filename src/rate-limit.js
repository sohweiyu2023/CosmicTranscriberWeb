import { ApiError } from "./errors.js";
import { sha256Base64Url } from "./utils.js";

export async function rateLimit(env, bindingName, principal, route) {
  const limiter = env[bindingName];
  if (!limiter?.limit) {
    if (env.DEPLOYMENT_ENV !== "development") throw new ApiError(500, "rate_limit_config_missing", "Required rate limiting is not configured.");
    return;
  }
  const derived = await sha256Base64Url(`ctw-rl|${principal.sub}|${route}`);
  const { success } = await limiter.limit({ key: derived.slice(0, 43) });
  if (!success) throw new ApiError(429, "rate_limited", "Too many requests. Please try again shortly.");
}
