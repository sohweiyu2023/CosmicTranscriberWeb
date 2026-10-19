# Security Header Policy

Cosmic Transcriber uses **Worker-first Static Assets** in every environment (`assets.run_worker_first:true`) so Cloudflare Access JWT verification occurs in the Worker before the application shell or matching static files are returned. This is intentional: current Cloudflare Static Assets documentation identifies authentication as a common `run_worker_first` use case.

Because the Worker is in the response path, the security policy does **not** rely on `_headers` for Worker-generated responses. The Worker attaches the release security headers to successful static-asset responses, including:

- `Cache-Control: no-store`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`;
- `X-Frame-Options: DENY`;
- restrictive `Permissions-Policy`;
- `Cross-Origin-Opener-Policy: same-origin`;
- `Cross-Origin-Resource-Policy: same-origin`;
- HSTS on HTTPS;
- self-only CSP with no inline/eval/remote CDN dependency: `default-src`, `script-src`, `style-src`, and `connect-src` restricted to self, no objects/base/frame ancestors, forms self.

`public/_headers` is retained as defense in depth for static-serving paths, but it is not the release trust anchor. API JSON responses are also `no-store`. Core APIs remain same-origin and no wildcard CORS is permitted.

Staging acceptance must verify that unauthenticated requests cannot retrieve the app shell or static assets, that Access login still completes normally, and that the final application response contains the expected headers.
