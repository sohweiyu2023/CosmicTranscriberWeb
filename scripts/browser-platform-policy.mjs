// Prospective release policy. Historical Windows WebKit failures remain failures.
export const BROWSER_POLICY_REVISION = '2026-10-11-target-platforms-v1';
const gates = Object.freeze({
  win32: Object.freeze(['test:e2e:windows', 'test:e2e:firefox-key-stress', 'test:e2e:branded']),
  linux: Object.freeze(['test:e2e:core']),
  darwin: Object.freeze(['test:e2e:macos', 'test:safari:real'])
});
export function browserGates(platform) {
  if (!Object.hasOwn(gates, platform)) throw new Error(`No reviewed release browser policy for ${platform}.`);
  return [...gates[platform]];
}
