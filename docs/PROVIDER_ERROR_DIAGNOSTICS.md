# Provider error diagnostics candidate — privacy repair v2

This isolated local integration candidate is unpublished and undeployed. Its
baseline is the verified PR44 source at4f4710c8, with the separately reviewed
privacy-v2 delta applied locally. PR44/main and live systems are unchanged.
The baseline certification, manifest and checksums do not certify these edited
bytes; do not distribute them or manually relabel their flags. Current-source
review and local route checks supplement, not replace, final certification.

## Privacy contract

Provider explanations can contain a transcript, a prompt fragment, client names
or other private text without quotes or familiar secret patterns. Pattern-based
scrubbing cannot prove that such prose is safe. The earlier local candidate
persisted an unknown unquoted synthetic canary; that evidence and its original
source backup are retained. Version2 therefore omits ALL provider prose before
persistence, regardless of context, quotation or apparent harmlessness. There is
no raw-text opt-in or new telemetry destination in this implementation.

The server-only `cosmic-provider-explanation-2` envelope retains useful typed
facts only: exact finite provider/transport error codes and types, fixed protocol
parameter names, known error classes and integer HTTP statuses100–599. Unknown
values are omitted, not copied, hashed, coerced, guessed or matched by substring.
A future unrecognized provider code therefore needs reviewed vocabulary expansion.
The existing outer operational envelope retains its already bounded request IDs,
UTC timestamp, stage/category, status, elapsed time and conservative billing state.
Within the new structured-evidence channel, no classification inferred from prose
is presented as a confirmed provider cause. The legacy outer status classification
is unchanged: for example, its429 quota/billing category still uses body-text
matching and is not an independently confirmed provider cause. This privacy patch
does not alter billing state, retry admission or that existing heuristic.

## Explicit incompleteness and bounds

`prosePolicy: omitted-unconditionally`, `proseRetained:false` and the fixed
`proseOmissionReason` explain the privacy choice. Observed prose/omitted-field and
unknown-structured-field counts are retained. `otherProperties` explicitly says
arbitrary properties were not inspected or retained; the observed counts are not
a complete inventory of the provider response. `missing` means no admissible
facts, not that the provider supplied no explanation. `unavailable` marks hostile
accessors, partial/oversized/HTML bodies or inaccessible structures. `truncated`
and `cycleDetected` identify bounded or cyclic traversal. Both
`completeProviderExplanation` and legacy `completeSelectedDetails` remain false.
This does not claim full explanation logging, full application coverage, recovered
historical details, or an exhaustive code vocabulary.

Traversal probes only fixed own-property names. It never enumerates arbitrary
keys, invokes getters, follows inherited payload values or coerces unknown values.
Known native Error prototypes can yield a fixed class name without reading prose.
It visits at most32 nodes, depth4, eight array elements per array, and16 facts.
Fact paths contain only fixed keys and `[]`, never provider-controlled names.
No audio, transcript, prompt, filenames, API keys, cookies, full URLs or arbitrary
strings are admitted by this channel. HTML and incomplete bodies are withheld;
known status/correlation information remains in the outer existing envelope.

## Persistence and export

Only admitted, immutable in-process envelopes reach the existing Worker console
sink. Caller-created or JSON-cloned envelopes are rejected. The error association
is a WeakMap, excluded from client JSON and browser support exports. Restart does
not reconstruct it. A private operator export of an already persisted event
contains only these fixed-vocabulary facts and indicators, not raw provider prose.
There is no new endpoint, log service, permission, persistent-access change or
retention-policy change. Actual production Cloudflare retention/access still needs
authorized read-only verification and is not established by local tests.

Synthetic tests write/read temporary JSONL and support serialization, then remove
their temporary directories. Sink failures remain nonthrowing, feed the existing
dropped-event count, and cannot alter provider results, billing state or replay
admission. No provider request is replayed to recover a missing explanation.

## Remaining tradeoff and release boundary

The deliberate cost of fail-closed privacy is loss of explanatory prose, even
when it might be useful. Unknown codes are visibly omitted. A separate future
human/provider support investigation can request specific safe facts; this code
does not enable real payload capture or presume consent for it. The user need not
choose a weaker privacy mode to use this safe default candidate. Do not promise
full provider explanations with this representation.

This repair does not close separate launcher/Wrangler/browser logging gaps or
certify live Worker behavior. Local route checks exercise the actual fetch
handler under Node Web APIs with synthetic signed Access JWTs, encrypted fake
BYOK sessions, D1/rate-limit doubles, closed mock HTTP, persisted JSONL and support
exports. They do not run Miniflare/workerd, actual D1, Cloudflare Access, provider
services, production retention or a real browser. Final Workers-runtime/build
certification and then-current source reconciliation remain required before any
publication/release decision. It does not modify PR44, main, production, request
counters, paid reservations or Safari FAIL/WAIVED status.

The integration review also reproduced a raw database exception escaping through
the rejected background accounting promise. After the same three accounting
attempts, the local candidate now rejects that promise with a fixed typed
usage_result_persist_failed error and explicit rawCauseOmitted indicator, without
the underlying exception/cause. The already classified client response and one
provider dispatch are unchanged. This closes the locally observed rejection-value
path; it does not prove real D1 transaction state, unique constraints, platform
exception formatting, retention or production observability behavior.

Focused offline command (existing reviewed Node toolchain; synthetic fetch only):

The dependency-free command below excludes the route test. The route test lives in tests/integration/provider-privacy-worker-flow.test.js and is automatically required by the existing dependency-backed test:integration script and Vitest integration include; it must run after npm ci. Do not move a jose-importing route test into tests/node, which is executed before installation during fresh-package validation.

```text
node --test --test-concurrency=1 tests/node/provider-failure.test.mjs tests/node/openai.test.mjs tests/node/logging-privacy.test.mjs tests/node/diagnostics.test.mjs
```

